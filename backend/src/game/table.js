import {
  buildDeck,
  drawLiveTile,
  drawGangTile,
  deckFingerprint,
  sortHand,
  canPeng,
  canGang,
  canHu,
  canAngang,
  canBugang,
  isThirteenOrphans,
  listenCandidates,
  tilePoint,
  removeFromHand,
  WALL_KEEP,
  LISTEN_MIN_WIN_POINT,
  LISTEN_MIN_DISCARD_POINT,
} from './engine.js';
import { evaluate, settlePoints, drawPoints, gangPoints } from './scoring.js';
import { SEAT_CLOCKWISE as ORDER, nextSeat, roundName, lapName, rollAll, rollDice, diceTotal } from './gameRules.js';
import { saveGameRecord } from '../db/index.js';

/**
 * 牌局状态机：一场对局 = 房间内连续多局（打满 rounds 局或返回大厅结束）
 *
 * 座位：'me' | 'left' | 'right'（与前端一致，视觉顺时针）
 * 阶段：dice（掷骰定庄）→ play（摸打）→ settle（结算）→ 下一局 / matchOver
 * 每个动作产生的状态变化通过 push 事件回调广播（由 ws 层分发）。
 */

/** 定庄结果展示时长：dealer 事件后停顿 2 秒再开始发牌（对局） */
export const DEALER_HOLD_MS = 2000;

/** 出牌时限 / 碰杠胡决策时限 / 最后警告时长（毫秒） */
export const TURN_MS = 15_000;
export const OFFER_MS = 15_000;
export const WARN_MS = 3_000;

export class Table {
  constructor(room, emit) {
    this.room = room; // 引用房间（players 顺序即座位）
    this.emit = emit; // (type, data, targetSeat|null) 回调
    this.roundNo = 0; // 已打局数（含连庄，每局 +1）
    this.rotations = 0; // 累计下庄次数：每圈 3 巡，floor(rotations/3)+1 = 圈号
    this.laps = room.laps || room.rounds || 2; // 房间设定圈数
    this.base = [1, 2, 5].includes(Number(room.base)) ? Number(room.base) : 1; // 底分：所有分数 × base
    this.dealer = null;
    this.phase = 'idle';
    this.turn = null; // 当前行动座位
    this.wall = []; // 牌库 [{t, id}]（每张牌唯一编号，开局前定序不可变）
    this.wallHash = null; // 牌库定序指纹（wallCommit）
    this.hands = {};
    this.melds = {};
    this.discards = {};
    this.lastDiscard = null; // {seat, tile} 待碰杠胡判定
    this.pendingActions = {}; // seat → ['peng','gang','hu']
    this.listening = { me: false, left: false, right: false }; // 报听状态
    this.listenWaits = { me: [], left: [], right: [] }; // 报听时记住的听口（可胡牌型）
    this.listenDiscard = { me: null, left: null, right: null }; // 报听扣牌在牌河中的下标
    this.points = { me: 0, left: 0, right: 0 }; // 整场累计积分（胡牌 + 杠即时分 + 流局）
    this.lastDraw = { me: null, left: null, right: null }; // 本次摸到的牌（报听后只能打它）
    this.robGang = null; // 抢杠询问中 { seat:杠家, tile, robbers:待询问的听牌人 }
    this.picks = { me: null, left: null, right: null }; // 各家当前选中的手牌（超时自动打这张）
    this.turnTimer = null;
    this.dealerTimer = null; // 定庄 → 发牌 的 2 秒停留
  }

  /**
   * 记录玩家当前选中的手牌：出牌超时后优先打出这张；
   * 传空则清除选择（超时时打牌面最右侧一张）。
   */
  pickTile(seat, tile) {
    if (!this.turn || this.turn !== seat) return false;
    if (this.picks[seat] === undefined) this.picks[seat] = null;
    if (!tile) {
      this.picks[seat] = null;
      return true;
    }
    const key = String(tile);
    if (!(this.hands[seat] || []).includes(key)) return false;
    this.picks[seat] = key;
    return true;
  }

  /**
   * 出牌超时兜底：
   *   有选中牌 → 打选中牌；无选中 → 打牌面最右侧（排序后最大）的一张
   */
  autoDiscard(seat) {
    if (this.phase !== 'play' || this.turn !== seat) return false;
    const hand = this.hands[seat] || [];
    if (!hand.length) return false;
    const pick = this.picks[seat];
    const tile = pick && hand.includes(pick) ? pick : sortHand(hand)[hand.length - 1];
    this.picks[seat] = null;
    return this.discard(seat, tile, { auto: true });
  }

  seatOf(userId) {
    const p = this.room.players.find((x) => x.userId === userId);
    return p ? p.seat : null;
  }
  player(seat) {
    return this.room.players.find((x) => x.seat === seat);
  }
  isAI(seat) {
    return this.player(seat)?.isAI;
  }

  /* ==================== 开局 / 换局 ==================== */

  startMatch() {
    this.roundNo = 0;
    this.rotations = 0;
    this.dealer = null; // 新一场对局重新掷骰定庄
    this.startRound();
  }

  startRound() {
    // 公平性：对局开始前一次性洗牌定序并生成指纹，此后牌库顺序不可变
    this.wall = buildDeck(); // [{t, id}]，每张牌唯一编号
    this.wallHash = deckFingerprint(this.wall);
    this.emit('wallCommit', { roundNo: this.roundNo, hash: this.wallHash, count: this.wall.length });
    this.hands = { me: [], left: [], right: [] };
    this.melds = { me: [], left: [], right: [] };
    this.discards = { me: [], left: [], right: [] };
    this.lastDiscard = null;
    this.pendingActions = {};
    this.listening = { me: false, left: false, right: false };
    this.listenWaits = { me: [], left: [], right: [] };
    this.listenDiscard = { me: null, left: null, right: null };
    this.lastDraw = { me: null, left: null, right: null };
    this.picks = { me: null, left: null, right: null };
    this.robGang = null;
    // 续局：庄家已由上一局结果确定（庄家胡连庄 / 他人胡顺时针下移 / 流局连庄），不再掷骰
    if (this.dealer) {
      this.phase = 'deal';
      this.emit('dealer', {
        roundNo: this.roundNo,
        roundName: lapName(this.rotations),
        dealer: this.dealer,
        keep: true,
      });
      // 定庄（连庄）结果展示 2 秒后再发牌
      clearTimeout(this.dealerTimer);
      this.dealerTimer = setTimeout(() => this.deal(), DEALER_HOLD_MS);
      return;
    }
    // 首局：掷骰定庄
    this.phase = 'dice';
    this.rolls = rollAll();
    this.emit('dice', {
      roundNo: this.roundNo,
      roundName: lapName(this.rotations),
      rolls: this.rolls,
      totals: Object.fromEntries(Object.entries(this.rolls).map(([s, r]) => [s, diceTotal(r)])),
    });
    // 留出摇骰动画时间（客户端逐家定格约 1.4s）
    this.rollTimer = setTimeout(() => this.resolveDealer(this.rolls), 1600);
  }

  /**
   * 比点定庄
   * @param {object} rolls 全场骰子点数 { me|left|right: [d1, d2] }
   * @param {string[]|null} candidates 参与庄家比较的座位（null = 三家）
   *
   * 规则：点数最大者坐庄；若最大点数并列，仅并列者重新摇骰，
   *      其余玩家点数保留并退出庄家选择，直到产生唯一最大者。
   */
  resolveDealer(rolls, candidates = null) {
    this.rolls = { ...rolls };
    const pool = candidates && candidates.length ? candidates : ORDER;
    const totals = pool.map((seat) => ({ seat, total: diceTotal(this.rolls[seat]) }));
    const max = Math.max(...totals.map((t) => t.total));
    const winners = totals.filter((t) => t.total === max);
    if (winners.length > 1) {
      const tied = winners.map((w) => w.seat);
      const losers = ORDER.filter((s) => !tied.includes(s));
      // 只重掷并列最大者；其余玩家退出庄家选择（前端提示重掷/退出）
      this.rollTimer = setTimeout(() => {
        const next = { ...this.rolls };
        for (const seat of tied) next[seat] = rollDice();
        this.rolls = next;
        this.emit('dice', {
          roundNo: this.roundNo,
          roundName: lapName(this.rotations),
          rolls: this.rolls,
          totals: Object.fromEntries(ORDER.map((s) => [s, diceTotal(this.rolls[s])])),
          tie: true, // 平局重掷中
          reroll: tied, // 本次重掷的座位
          seats: tied, // 仍在争夺庄家的候选座位
          out: losers, // 已退出庄家选择的座位
        });
        this.resolveDealer(this.rolls, tied);
      }, 1500);
      return;
    }
    this.dealer = winners[0].seat;
    this.phase = 'deal';
    this.emit('dealer', {
      roundNo: this.roundNo,
      roundName: lapName(this.rotations),
      dealer: this.dealer,
      rolls: this.rolls, // 最终点数（含平局重掷结果）
    });
    // 定庄结果展示 2 秒后再开始发牌（前端播放定庄/骰子定格动画）
    clearTimeout(this.dealerTimer);
    this.dealerTimer = setTimeout(() => this.deal(), DEALER_HOLD_MS);
  }

  /**
   * 发牌：按真实牌桌顺序逐垛下发（供前端播放发牌动画）
   *   从庄家起顺时针，每家每次 3 垛 = 6 张，发两轮（每人 12 张）
   *   → 每家再 1 张（每人 13 张）→ 庄家再 1 张（14 张，先手）
   * 每步推 dealStep 事件，结束后推 deal（完整手牌）并轮到庄家出牌。
   */
  deal() {
    this.phase = 'deal';
    const startIdx = ORDER.indexOf(this.dealer);
    const order = [0, 1, 2].map((i) => ORDER[(startIdx + i) % 3]);

    const steps = [];
    for (let round = 0; round < 2; round++) {
      for (const seat of order) steps.push({ seat, count: 6, stage: 'stack' });
    }
    for (const seat of order) steps.push({ seat, count: 1, stage: 'single' });
    steps.push({ seat: this.dealer, count: 1, stage: 'dealer' });

    const run = (i) => {
      if (i >= steps.length) return this.finishDeal();
      const s = steps[i];
      const tiles = [];
      const ids = [];
      for (let n = 0; n < s.count; n++) {
        const c = drawLiveTile(this.wall); // 发牌严格按牌库顺序
        if (!c) break;
        this.hands[s.seat].push(c.t);
        tiles.push(c.t);
        ids.push(c.id);
      }
      this.emit('dealStep', {
        seat: s.seat,
        stage: s.stage,
        tiles, // ws 层：仅本人可见牌面，其他人只收数量
        ids, // 每张牌的唯一编号（仅本人可见）
        count: tiles.length,
        step: i,
        total: steps.length,
        wallCount: this.wall.length,
      });
      this.dealTimer = setTimeout(() => run(i + 1), s.stage === 'stack' ? 240 : 320);
    };
    run(0);
  }

  /** 发牌结束：整理手牌 → 推 deal → 轮到庄家出牌（庄家已有第 14 张） */
  finishDeal() {
    for (const seat of ORDER) this.hands[seat] = sortHand(this.hands[seat]);
    this.phase = 'play';
    this.emit('deal', {
      roundName: lapName(this.rotations),
      wallCount: this.wall.length,
      hands: this.hands, // ws 层按座位过滤下发
      dealer: this.dealer,
    });
    this.beginTurn(this.dealer, true);
  }

  /* ==================== 回合流转 ==================== */

  beginTurn(seat, first = false) {
    this.turn = seat;
    let drew = null;
    if (!first) {
      const c = drawLiveTile(this.wall); // 摸牌严格按牌库顺序
      if (!c) return this.onDraw();
      this.hands[seat].push(c.t);
      drew = c.t;
      this.lastDraw[seat] = c.t;
      // 广播：本人收牌面，其他人只收「摸了一张」（牌面由 ws 层置空）
      this.emit('draw', { seat, tile: c.t, tileId: c.id, wallCount: this.wall.length });
    }
    this.emit('turn', { seat, wallCount: this.wall.length, ms: TURN_MS, warnMs: WARN_MS });
    // 报听者：手牌锁定，摸什么打什么
    if (this.listening[seat]) return this.listenTurn(seat, drew);
    if (this.isAI(seat)) {
      setTimeout(() => this.aiPlay(seat), 300 + Math.random() * 400);
    } else {
      // 出牌计时 15s：超时自动打出选中牌，无选中则打最右侧一张
      this.picks[seat] = null;
      clearTimeout(this.turnTimer);
      this.turnTimer = setTimeout(() => this.autoDiscard(seat), TURN_MS);
    }
  }

  /**
   * 报听者的回合：只能打刚摸到的牌；
   * 摸到即胡时出现「胡」按钮由玩家点击，超时未点则打出该牌（不自动胡）
   */
  listenTurn(seat, drewTile) {
    clearTimeout(this.turnTimer);
    const hand = this.hands[seat];
    if (drewTile && this.canZimoNow(seat)) {
      // AI 主动胡（等同点击胡按钮）；真人等待点击，超时打出该牌
      if (this.isAI(seat)) return this.huSelf(seat);
      this.turnTimer = setTimeout(() => {
        if (this.phase !== 'play' || this.turn !== seat) return;
        this.discard(seat, drewTile, { auto: true });
      }, TURN_MS);
      return;
    }
    const tile = drewTile || hand[hand.length - 1];
    this.turnTimer = setTimeout(() => {
      if (this.phase !== 'play' || this.turn !== seat) return;
      this.discard(seat, tile, { auto: true });
    }, this.isAI(seat) ? 300 : 1200);
  }

  /**
   * 点炮胡判定（未报听一律不能胡）：
   *   报听者 → 只能胡「报听时记录的听口」且点数 ≥6
   *   未报听者 → 不能胡
   */
  canOtherHu(seat, tile) {
    if (!this.listening[seat]) return false;
    if (!canHu([...this.hands[seat], tile])) return false;
    if (!this.listenWaits[seat].includes(tile)) return false;
    if (tilePoint(tile) < LISTEN_MIN_WIN_POINT) return false;
    return true;
  }

  /**
   * 报听者自摸胡判定：
   *   已报听 + 胡型成立；十三幺十三面听实为 10 面 —— 1万/1条/1饼（1 点）不能胡
   */
  canZimoNow(seat) {
    if (!this.listening[seat]) return false;
    const hand = this.hands[seat];
    if (!canHu(hand)) return false;
    const winTile = this.lastDraw[seat] || hand[hand.length - 1];
    if (isThirteenOrphans(hand) && tilePoint(winTile) < LISTEN_MIN_DISCARD_POINT) return false;
    return true;
  }

  /**
   * 出牌 → 检查他家碰/杠/胡
   * @param {object} [opts] faceDown: 报听扣牌（背面朝上）
   * @returns {boolean} 是否成功打出
   */
  discard(seat, tile, opts = {}) {
    if (this.phase !== 'play' || this.turn !== seat) return false;
    // 报听后手牌锁定：只能打刚摸到的牌（报听扣牌本身除外）
    if (this.listening[seat] && !opts.faceDown && !opts.auto && tile !== this.lastDraw[seat]) return false;
    const idx = this.hands[seat].indexOf(tile);
    if (idx < 0) return false;
    clearTimeout(this.turnTimer);
    this.hands[seat].splice(idx, 1);
    this.discards[seat].push(tile);
    if (opts.faceDown) this.listenDiscard[seat] = this.discards[seat].length - 1;
    this.lastDraw[seat] = null;
    this.lastDiscard = { seat, tile };
    this.lastDiscardSeat = seat;
    this.emit('discard', {
      seat,
      tile,
      wallCount: this.wall.length,
      faceDown: !!opts.faceDown,
      discardIndex: this.discards[seat].length - 1,
    });

    // 扣牌（背面朝上）：牌面不可见，任何家都不能碰/杠/胡
    if (opts.faceDown) {
      this.pendingActions = {};
      this.lastDiscard = null;
      this.beginTurn(nextSeat(seat));
      return true;
    }

    // 收集其他玩家的可行动作（报听者不能再碰/杠）
    this.pendingActions = {};
    for (const other of ['me', 'left', 'right']) {
      if (other === seat) continue;
      const acts = [];
      if (this.canOtherHu(other, tile)) acts.push('hu');
      if (!this.listening[other]) {
        if (canPeng(this.hands[other], tile)) acts.push('peng');
        if (canGang(this.hands[other], tile)) acts.push('gang');
      }
      if (acts.length) this.pendingActions[other] = acts;
    }
    if (Object.keys(this.pendingActions).length) {
      this.resolvePending();
    } else {
      this.lastDiscard = null;
      this.beginTurn(nextSeat(seat));
    }
    return true;
  }

  /**
   * 依次询问有动作的玩家：
   *   优先级 = 胡 > 碰/杠；同级按离弃牌者的行动顺序（下家 → 对家）
   *   AI 立即决策，真人 8s 超时自动过 → 进入下一位/下一家回合
   */
  resolvePending() {
    const seats = Object.keys(this.pendingActions);
    if (!seats.length) {
      this.lastDiscard = null;
      return this.beginTurn(nextSeat(this.lastDiscardSeat));
    }
    // 胡优先于碰/杠（防止碰/杠抢先胡）；同级按弃牌者的下家顺序
    const dist = (s) => {
      let d = 1;
      let cur = nextSeat(this.lastDiscardSeat);
      while (cur !== s && d < 3) {
        cur = nextSeat(cur);
        d += 1;
      }
      return d;
    };
    const order = seats.slice().sort((a, b) => {
      const ha = this.pendingActions[a].includes('hu') ? 0 : 1;
      const hb = this.pendingActions[b].includes('hu') ? 0 : 1;
      return ha !== hb ? ha - hb : dist(a) - dist(b);
    });
    for (const seat of order) {
      if (this.isAI(seat)) {
        const acts = this.pendingActions[seat];
        // AI 策略：能胡就胡，否则碰杠
        const type = acts.includes('hu') ? 'hu' : acts[0];
        this.performAction(seat, type);
        return;
      }
      this.emit(
        'offer',
        {
          actions: this.pendingActions[seat],
          tile: this.lastDiscard.tile,
          ms: OFFER_MS,
          warnMs: WARN_MS,
        },
        seat,
      );
      // 碰/杠/胡决策 15s：超时自动「过」，轮到下家
      clearTimeout(this.offerTimer);
      this.offerTimer = setTimeout(() => {
        if (this.pendingActions[seat]) this.performAction(seat, 'pass');
      }, OFFER_MS);
    }
  }

  /** 玩家对弃牌作出反应（hu/peng/gang/pass） */
  performAction(seat, type) {
    if (this.phase !== 'play') return;
    // 抢杠询问中：仅待询问玩家可「胡」或「过」
    if (this.robGang) {
      const { tile, seat: gs, robbers } = this.robGang;
      if (!robbers.includes(seat)) return;
      clearTimeout(this.offerTimer);
      if (type === 'hu') {
        // 复核：该牌确在其听口且 ≥6 点
        if (
          !this.listening[seat] ||
          !this.listenWaits[seat].includes(tile) ||
          tilePoint(tile) < LISTEN_MIN_WIN_POINT
        ) {
          return;
        }
        this.robGang = null;
        return this.onHu(seat, tile, false, gs, true);
      }
      return this.robPass(seat);
    }
    if (type === 'pass') {
      // 过：总是允许，跳过该玩家的动作
      clearTimeout(this.offerTimer);
      delete this.pendingActions[seat];
      this.resolvePending();
      return;
    }
    const acts = this.pendingActions[seat];
    if (!acts || !acts.includes(type)) return;
    // 报听后不可再碰/杠（胡不受限，低点听口由 hu 分支另行校验）
    if (this.listening[seat] && (type === 'peng' || type === 'gang')) return;
    if (!this.lastDiscard) return;
    clearTimeout(this.offerTimer);
    const { tile, seat: fromSeat } = this.lastDiscard;
    // 复核手牌确实满足碰/杠（防伪造询问）
    if (type === 'peng' && !canPeng(this.hands[seat], tile)) return;
    if (type === 'gang' && !canGang(this.hands[seat], tile)) return;

    if (type === 'hu') {
      // 未报听不能胡；报听者听口 <6 点不能点炮胡（只能自摸）
      if (!this.listening[seat]) return;
      if (tilePoint(tile) < LISTEN_MIN_WIN_POINT) return;
      return this.onHu(seat, tile, false, fromSeat);
    }
    if (type === 'peng') {
      this.hands[seat] = removeFromHand(this.hands[seat], tile, 2);
      this.melds[seat].push({ type: 'peng', tile, from: fromSeat });
      this.emit('action', { seat, type, tile });
      this.lastDiscard = null;
      this.pendingActions = {};
      // 碰后该玩家继续出牌（不摸牌）
      this.turn = seat;
      this.emit('turn', { seat, wallCount: this.wall.length, after: 'peng' });
      this.schedulePlay(seat);
      return;
    }
    if (type === 'gang') {
      this.hands[seat] = removeFromHand(this.hands[seat], tile, 3);
      this.melds[seat].push({ type: 'gang', tile, from: fromSeat });
      this.emit('action', { seat, type, tile });
      this.settleGang({ type: 'diangang', tile, gangSeat: seat, fromSeat });
      this.lastDiscard = null;
      this.pendingActions = {};
      this.gangDrawAndTurn(seat);
      return;
    }
    // pass：跳过该玩家的动作
    delete this.pendingActions[seat];
    this.resolvePending();
  }

  /** 行动计时（AI 立即决策，真人 15s：超时打选中牌，无选中打最右侧一张） */
  schedulePlay(seat) {
    if (this.listening[seat]) return this.listenTurn(seat, this.lastDraw[seat]);
    if (this.isAI(seat)) setTimeout(() => this.aiPlay(seat), 350);
    else {
      clearTimeout(this.turnTimer);
      this.picks[seat] = null;
      this.turnTimer = setTimeout(() => this.autoDiscard(seat), TURN_MS);
    }
  }

  /** 杠后补摸一张并继续出牌（杠牌固定取牌库最后一张，含壁牌区） */
  gangDrawAndTurn(seat) {
    this.turn = seat;
    const c = drawGangTile(this.wall);
    if (!c) return this.onDraw();
    this.hands[seat].push(c.t);
    this.lastDraw[seat] = c.t;
    this.emit(
      'draw',
      { seat, tile: c.t, tileId: c.id, wallCount: this.wall.length, after: 'gang', source: 'tail' },
      seat,
    );
    this.emit('turn', { seat, wallCount: this.wall.length, after: 'gang' });
    this.schedulePlay(seat);
  }

  /**
   * 自摸阶段的杠：暗杠（手里 4 张）或补杠（已有碰 + 手里 1 张）
   * 杠后补摸一张。报听后不能杠：报听须门清 14 张，杠会拆散听口
   * （豪七对同理 —— 摸进第 4 张相同牌只能自摸胡，不能再做杠）
   * 返回是否成功执行（供网关给出明确拒绝原因）
   */
  gangSelf(seat, tile) {
    if (this.phase !== 'play' || this.turn !== seat) return false;
    const hand = this.hands[seat];
    const isAngang = hand.filter((t) => t === tile).length >= 4;
    const pengMeld = this.melds[seat].find((m) => m.type === 'peng' && m.tile === tile);
    if (!isAngang && !pengMeld) return false;
    if (this.listening[seat]) return false; // 报听后不能再杠

    if (isAngang) {
      this.hands[seat] = removeFromHand(hand, tile, 4);
      this.melds[seat].push({ type: 'gang', tile, from: seat, concealed: true });
      this.emit('action', { seat, type: 'gang', tile, concealed: true });
      this.settleGang({ type: 'angang', tile, gangSeat: seat });
      this.gangDrawAndTurn(seat);
      return true;
    }
    // 补杠：先检查抢杠胡 —— 该牌是他人听口（≥6 点）时，听牌人可抢杠
    const robbers = ORDER.filter(
      (s) =>
        s !== seat &&
        this.listening[s] &&
        this.listenWaits[s].includes(tile) &&
        tilePoint(tile) >= LISTEN_MIN_WIN_POINT,
    );
    if (robbers.length) {
      this.robGang = { seat, tile, robbers };
      this.askRobGang();
      return true;
    }
    this.completeBugang(seat, tile);
    return true;
  }

  /** 补杠落定：碰 → 补杠，广播动作并从牌库最后补摸 */
  completeBugang(seat, tile) {
    const pengMeld = this.melds[seat].find((m) => m.type === 'peng' && m.tile === tile);
    if (!pengMeld) return;
    this.hands[seat] = removeFromHand(this.hands[seat], tile, 1);
    pengMeld.type = 'bugang';
    this.emit('action', { seat, type: 'bugang', tile, concealed: false });
    this.settleGang({ type: 'bugang', tile, gangSeat: seat });
    this.gangDrawAndTurn(seat);
  }

  /** 杠即时积分：暗杠两家各付 牌点×2 / 补杠各付 牌点 / 点杠点杠者付 牌点×2（×底分） */
  settleGang({ type, tile, gangSeat, fromSeat }) {
    const { delta, gain } = gangPoints({ type, tile, gangSeat, fromSeat });
    for (const s of ['me', 'left', 'right']) this.points[s] += delta[s] * this.base;
    const scaled = {};
    for (const s of ['me', 'left', 'right']) scaled[s] = delta[s] * this.base;
    this.emit('gangSettle', { type, tile, gangSeat, gain: gain * this.base, delta: scaled, points: { ...this.points } });
  }

  /**
   * 抢杠询问：依次问听口可胡的玩家
   *   AI → 立即抢杠胡；真人 → 「胡」按钮，8s 超时视为过 → 全部过后照常补杠
   */
  askRobGang() {
    if (!this.robGang) return;
    const { seat, tile, robbers } = this.robGang;
    const cur = robbers[0];
    if (!cur) {
      const rg = this.robGang;
      this.robGang = null;
      return this.completeBugang(rg.seat, rg.tile);
    }
    if (this.isAI(cur)) {
      this.robGang.robbers = robbers.slice(1);
      return this.onHu(cur, tile, false, seat, true); // 抢杠胡（等同点炮）
    }
    this.emit('offer', { actions: ['hu'], tile, robGang: true, ms: 8000 }, cur);
    clearTimeout(this.offerTimer);
    this.offerTimer = setTimeout(() => this.robPass(cur), 8000);
  }

  /** 抢杠放弃（点击「过」或超时）→ 询问下一位；无人抢则照常补杠 */
  robPass(seat) {
    if (!this.robGang || !this.robGang.robbers.includes(seat)) return;
    clearTimeout(this.offerTimer);
    this.robGang.robbers = this.robGang.robbers.filter((s) => s !== seat);
    this.askRobGang();
  }

  /**
   * 报听：弃一张牌扣在桌面（点数 ≥3），且听口中至少一张 ≥6 点
   * 报听后手牌锁定：只能摸打，不能再碰/杠/换牌
   * @param {string} [tile] 指定扣牌；不传则由服务器挑选（听口最多者）
   * @returns {{ok:boolean, tile?:string, waits?:string[], reason?:string}}
   */
  declareListen(seat, tile) {
    if (this.phase !== 'play' || this.turn !== seat) return { ok: false, reason: '现在不能报听' };
    if (this.listening[seat]) return { ok: false, reason: '已经报听' };
    const hand = this.hands[seat];
    if (hand.length % 3 !== 2) return { ok: false, reason: '当前不能报听' };
    const cands = listenCandidates(hand);
    if (!cands.length) {
      return {
        ok: false,
        reason: `报听需弃牌 ≥3 点，且听口中至少一张 ≥${LISTEN_MIN_WIN_POINT} 点`,
      };
    }
    let pick = null;
    if (tile) pick = cands.find((c) => c.tile === tile) || null;
    else {
      pick = cands
        .slice()
        .sort((a, b) => b.waits.length - a.waits.length || tilePoint(b.tile) - tilePoint(a.tile))[0];
    }
    if (!pick) return { ok: false, reason: '该牌不能用于报听（需弃牌 ≥3 点且听口有 ≥6 点）' };

    this.listening[seat] = true;
    // 记住该玩家所有能胡的牌型（听口），点炮判定以此为准
    this.listenWaits[seat] = [...new Set(pick.waits)].sort();
    this.emit('listen', {
      seat,
      tile: pick.tile,
      waits: pick.waits,
      listening: { ...this.listening },
    });
    // 扣牌：打出并标记背面朝上
    const ok = this.discard(seat, pick.tile, { faceDown: true });
    if (!ok) {
      this.listening[seat] = false; // 兜底回滚
      return { ok: false, reason: '报听失败' };
    }
    return { ok: true, tile: pick.tile, waits: pick.waits };
  }

  /** 自摸胡（玩家出牌阶段点击胡 = 胡自己刚摸的牌；未报听不能胡） */
  huSelf(seat) {
    if (this.phase !== 'play' || this.turn !== seat) return;
    if (!this.canZimoNow(seat)) return;
    const winTile = this.lastDraw[seat] || this.hands[seat][this.hands[seat].length - 1];
    this.onHu(seat, winTile, true, seat);
  }

  /* ==================== 胡牌 / 流局 / 结算 ==================== */

  onHu(winnerSeat, winTile, zimo, fromSeat, robGang = false) {
    clearTimeout(this.turnTimer);
    clearTimeout(this.offerTimer);
    this.robGang = null;
    this.phase = 'settle';
    this.pendingActions = {};
    const hand = zimo
      ? this.hands[winnerSeat]
      : [...this.hands[winnerSeat], winTile];
    const ev = evaluate({ hand14: hand, melds: this.melds[winnerSeat], zimo });
    const raw = settlePoints({
      multiplier: ev.multiplier,
      winPoint: tilePoint(winTile),
      zimo,
      winnerSeat,
      loserSeat: zimo ? null : fromSeat,
      loserListening: !zimo && !!this.listening[fromSeat],
      dealerSeat: this.dealer,
    });
    // 按房间底分缩放：分数 × base，计算式补「× 底分N」
    const scale = this.base;
    const delta = {};
    const detail = {};
    for (const s of ['me', 'left', 'right']) {
      delta[s] = raw.delta[s] * scale;
      detail[s] = scale > 1 && raw.detail[s] ? `${raw.detail[s]} × 底分${scale}` : raw.detail[s];
    }
    const gain = raw.gain * scale;
    for (const s of ['me', 'left', 'right']) this.points[s] += delta[s];

    const rec = {
      code: this.room.code,
      mode: this.room.mode,
      rounds: this.laps,
      password: this.room.password,
      ownerId: this.room.ownerId,
      roundNo: this.roundNo,
      roundName: lapName(this.rotations),
      dealerSeat: ['me', 'left', 'right'].indexOf(this.dealer),
      winnerSeat: ['me', 'left', 'right'].indexOf(winnerSeat),
      winType: zimo ? 'zimo' : 'dianpao',
      robGang: !!robGang, // 抢杠胡：杠家未听算点炮（包赔），已听算平胡（赔点相同）
      declarerListening: !!this.listening[fromSeat],
      winTile,
      handOwner: ['me', 'left', 'right'].indexOf(winnerSeat),
      handTiles: sortHand(hand),
      fans: ev.fans,
      totalPoints: gain,
      wallCount: this.wall.length,
      wallHash: this.wallHash, // 牌库定序指纹（公平性核验）
      turnNo: this.discards.me.length + this.discards.left.length + this.discards.right.length,
      players: this.room.players.map((p) => ({
        userId: p.userId,
        seat: ['me', 'left', 'right'].indexOf(p.seat),
        delta: delta[p.seat],
        isWin: p.seat === winnerSeat,
        isBao: !zimo && p.seat === fromSeat,
        handTiles: sortHand(this.hands[p.seat]),
        detail: detail[p.seat] || '',
      })),
    };
    const settleData = {
      roundName: rec.roundName,
      winnerSeat,
      zimo,
      loserSeat: zimo ? null : fromSeat,
      robGang: !!robGang,
      declarerListening: !!this.listening[fromSeat],
      winTile,
      handTiles: sortHand(hand),
      handOwner: winnerSeat,
      hands: {
        me: sortHand(this.hands.me),
        left: sortHand(this.hands.left),
        right: sortHand(this.hands.right),
      },
      melds: {
        me: this.melds.me,
        left: this.melds.left,
        right: this.melds.right,
      },
      handName: ev.handName,
      fans: ev.fans,
      fanTotal: ev.multiplier,
      multiplier: ev.multiplier,
      points: { ...this.points },
      dealerSeat: this.dealer,
      detail,
      delta,
      players: this.room.players.map((p) => ({
        seat: p.seat,
        nickname: p.nickname,
        avatar: p.avatar,
        d: delta[p.seat],
      })),
      winType: rec.winType,
      wallCount: rec.wallCount,
      turnNo: rec.turnNo,
      roomCode: rec.code,
      roomMode: rec.mode,
      base: this.base,
    };
    // 结算完整快照落库：战绩详情页直接还原三家牌面、副露、番型与点数明细
    rec.snapshot = settleData;
    saveGameRecord(rec).catch((e) => console.error('[db] save record failed:', e.message));
    this.emit('settle', settleData);

    // 轮庄：庄家赢连庄，否则顺时针下家（下庄换人 → 巡 +1）
    const prevDealer = this.dealer;
    this.dealer = winnerSeat === this.dealer ? this.dealer : nextSeat(this.dealer);
    if (this.dealer !== prevDealer) this.rotations += 1;
    this.roundNo += 1;
    this.afterRound();
  }

  /**
   * 局间流转：按圈数结束整场
   * 每圈 3 巡（三人各坐庄一次）；本圈第 3 巡下庄（换庄）→ 进入下一圈；
   * 最后一圈的第 3 巡结束且下庄（rotations 达到 圈数×3）→ 整场结束。
   * 连庄不出巡，一圈局数无上限。
   */
  afterRound() {
    if (this.rotations >= this.laps * 3) {
      this.phase = 'over';
      this.room.status = 'waiting';
      this.room.table = null;
      this.destroy();
      this.emit('matchOver', { laps: this.laps, rounds: this.laps, points: { ...this.points } });
      return;
    }
    this.nextConfirm = new Set(); // 真人确认后进入下一局
    this.emit('roundEnd', {
      nextRoundNo: this.roundNo,
      rotations: this.rotations,
      roundName: lapName(this.rotations),
    });
  }

  /** 玩家确认进入下一局（全部真人确认后开始） */
  requestNextRound(userId) {
    if (this.phase !== 'settle') return;
    const seat = this.seatOf(userId);
    if (!seat || this.isAI(seat)) return;
    this.nextConfirm.add(seat);
    this.emit('nextReady', { seat, confirmed: [...this.nextConfirm] });
    const humans = this.room.players.filter((p) => !p.isAI).map((p) => p.seat);
    if (humans.every((s) => this.nextConfirm.has(s))) {
      this.phase = 'idle';
      this.startRound();
    }
  }

  /** 牌墙耗尽 → 流局（庄 -10×底分，两闲各 +5×底分） */
  onDraw() {
    clearTimeout(this.turnTimer);
    this.phase = 'settle';
    const raw = drawPoints(this.dealer);
    const delta = {};
    for (const s of ['me', 'left', 'right']) delta[s] = raw[s] * this.base;
    for (const s of ['me', 'left', 'right']) this.points[s] += delta[s];
    const rec = {
      code: this.room.code,
      mode: this.room.mode,
      rounds: this.laps,
      password: this.room.password,
      ownerId: this.room.ownerId,
      roundNo: this.roundNo,
      roundName: lapName(this.rotations),
      dealerSeat: ['me', 'left', 'right'].indexOf(this.dealer),
      winnerSeat: null,
      winType: 'draw',
      winTile: null,
      handOwner: null,
      handTiles: [],
      fans: [],
      totalPoints: 0,
      wallCount: WALL_KEEP,
      wallHash: this.wallHash,
      turnNo: 0,
      players: this.room.players.map((p) => ({
        userId: p.userId,
        seat: ['me', 'left', 'right'].indexOf(p.seat),
        delta: delta[p.seat],
        isWin: false,
        isBao: false,
        handTiles: sortHand(this.hands[p.seat]),
        detail: p.seat === this.dealer ? `流局 · 庄家${-10 * this.base}` : `流局 · 闲+${5 * this.base}`,
      })),
    };
    const settleData = {
      roundName: rec.roundName,
      winnerSeat: null,
      zimo: false,
      loserSeat: null,
      winTile: null,
      handTiles: [],
      hands: {
        me: sortHand(this.hands.me),
        left: sortHand(this.hands.left),
        right: sortHand(this.hands.right),
      },
      melds: {
        me: this.melds.me,
        left: this.melds.left,
        right: this.melds.right,
      },
      handName: '流局',
      fans: [],
      fanTotal: 0,
      multiplier: 0,
      points: { ...this.points },
      dealerSeat: this.dealer,
      detail: {
        [this.dealer]: `流局 · 庄家${-10 * this.base}`,
        ...['me', 'left', 'right'].filter((s) => s !== this.dealer).reduce((m, s) => ({ ...m, [s]: `流局 · 闲+${5 * this.base}` }), {}),
      },
      delta,
      players: this.room.players.map((p) => ({
        seat: p.seat,
        nickname: p.nickname,
        avatar: p.avatar,
        d: delta[p.seat],
      })),
      winType: rec.winType,
      wallCount: rec.wallCount,
      turnNo: rec.turnNo,
      roomCode: rec.code,
      roomMode: rec.mode,
      base: this.base,
    };
    rec.snapshot = settleData;
    saveGameRecord(rec).catch((e) => console.error('[db] save record failed:', e.message));
    this.emit('settle', settleData);
    // 流局：庄家连庄（庄家不变）
    this.roundNo += 1;
    this.afterRound();
  }

  /* ==================== AI ==================== */

  aiPlay(seat) {
    const hand = this.hands[seat];
    if (this.phase !== 'play' || this.turn !== seat) return;
    // 已报听：能自摸就胡（十三幺 1数牌低点除外）；否则打摸到的牌（报听后不能杠）
    if (this.listening[seat]) {
      if (this.canZimoNow(seat)) return this.huSelf(seat);
      return this.discard(seat, this.lastDraw[seat] || hand[hand.length - 1]);
    }
    // 未报听不能胡：已有胡型时优先报听（合法即听），否则正常出牌
    if (canHu(hand)) {
      const r = this.declareListen(seat);
      if (r.ok) return;
      return this.discard(seat, this.lastDraw[seat] || hand[hand.length - 1]);
    }
    // 暗杠/补杠（大概率执行）
    const gangs = canAngang(hand).concat(canBugang(hand, this.melds[seat]));
    if (gangs.length && Math.random() < 0.8) return this.gangSelf(seat, gangs[0]);
    // 报听（概率性；不合法时自动跳过）
    if (Math.random() < 0.55) {
      const r = this.declareListen(seat);
      if (r.ok) return;
    }
    this.discard(seat, pickDiscard(hand));
  }

  destroy() {
    clearTimeout(this.turnTimer);
    clearTimeout(this.rollTimer);
    clearTimeout(this.offerTimer);
    clearTimeout(this.dealTimer);
    clearTimeout(this.dealerTimer);
    this.phase = 'over';
  }
}

/** 出牌选择：优先打孤张（相邻牌不在手），其次第一张 */
function pickDiscard(hand) {
  const has = (t) => hand.includes(t);
  for (const t of hand) {
    const m = /^([1-9])([mps])$/.exec(t);
    if (!m) return t; // 字牌先打
    const n = Number(m[1]);
    const s = m[2];
    const neighbors = [`${n - 1}${s}`, `${n + 1}${s}`].filter((x) => /^([1-9])/.test(x));
    if (!neighbors.some(has)) return t;
  }
  return hand[0];
}
