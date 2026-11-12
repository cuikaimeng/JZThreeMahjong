import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  GAME_WIDTH,
  GAME_HEIGHT,
  STATUS_BAR_HEIGHT,
  SAFE_BOTTOM,
  isLandscape,
} from '../render.js';
import { roundRect, spacedText, drawTileBody, drawAvatar } from '../ui/draw.js';
import { drawTileFace, drawTileBack, drawWinBadge } from '../ui/tileFace.js';
import {
  SEAT_CLOCKWISE,
  rollAll,
  diceTotal,
  determineDealer,
  nextDealer,
  lapName,
} from './gameRules.js';
import { net } from '../net/ws.js';
import {
  canHu,
  canAngang,
  canBugang,
  canDeclareListen as canDeclareListenLocal,
  isThirteenOrphans,
  tilePoint,
  listenCandidates,
  sortHand,
} from './handCheck.js';

const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const SERIF = '"Songti SC","STSong","Noto Serif SC",serif';
const GOLD = '#e8c37a';
const GREEN = '#7ee2b8';

/** 牌的中文显示名（听口提示用） */
const TILE_CN_MAP = {
  m: '万', p: '筒', s: '条',
  E: '东', S: '南', W: '西', N: '北', C: '中', F: '发', P: '白',
};
const NUM_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function tileCn(t) {
  const m = /^([1-9])([mps])$/.exec(t);
  return m ? NUM_CN[+m[1]] + TILE_CN_MAP[m[2]] : TILE_CN_MAP[t] || t;
}

/**
 * 对局页：按设计稿 03 布局
 * 顶栏（局次/巡目 + 壁牌 + 设置）+ 左右两家 + 牌河（弃牌/罗盘）+ 操作按钮 + 手牌 + 自己信息
 * 开局前先掷骰定庄：三人各掷两骰，点数合计最大者为庄
 */
export default class GameScene {
  constructor() {
    this.setupViewport();
    this.startTime = Date.now();
    this.pressed = null;
    this.layout = null;
    this.selected = -1; // 抬起的手牌索引
    this.onExit = null;
    this.onFinish = null; // 本局结束 → 结算页

    this.chips = [];
    this.totalLaps = 2; // 房间设定圈数（每圈 3 巡 = 三人各坐庄一次）
    this.rotations = 0; // 累计下庄次数（与服务器同步）
    this.playedHands = 0; // 已结束局数

    this.match = { round: '东一局', turn: 6, wall: 24 };
    this.rule = '';

    // 定庄 / 轮庄
    this.phase = 'dice'; // 'dice' 定庄中 | 'play' 对局中
    this.handNo = 0; // 局序（0 = 东一局）
    this.dealer = null; // 当前庄家 seat
    this.rolls = { me: [1, 1], left: [1, 1], right: [1, 1] };
    this.rollStart = Date.now();
    this.rollLocked = { me: false, left: false, right: false };
    this.tieSeats = [];
    this.lastResult = null; // { winner, lianzhuang }
    this.diceBtn = null; // 定庄面板按钮矩形

    // 对局菜单
    this.menuOpen = false;
    this.menuItems = [];

    // 我的手牌（最后一张为摸牌）
    this.hand = ['1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '9m', '5p', '5p', '1s'];

    this.discards = {
      left: ['3p', '7s', '9m', '2p', '5s', '1m', '8p', 'E', '6s'],
      right: ['4s', '6m', '1p', '9s', '2m', 'C', '5p', '3s', '7m'],
      me: ['8s', '2s', '9p', '3m', 'N', '4p', '6p'],
    };

    this.seats = {
      left: { name: '青鸾', score: 0, avatar: '青', grad: ['#4aa88a', '#1b5c47'], countdown: 12, listen: false },
      right: { name: '白鹭', score: 0, avatar: '白', grad: ['#6f93c9', '#2a4470'], countdown: 0, listen: true },
      me: { name: '你', score: 0, avatar: '我', grad: ['#4aa88a', '#1b5c47'] },
    };

    /* ---------- 联机状态 ---------- */
    this.net = null; // 在线会话：{ meSeat, players }
    this.meSeat = 'me'; // 我的服务器座位
    this.turnSeat = null; // 当前行动座位（已本地化）
    this.handCounts = { me: 0, left: 0, right: 0 }; // 各家手牌数量（他人显示牌背）
    this.melds = { me: [], left: [], right: [] }; // 碰/杠副露
    this.offer = null; // 我的可执行动作 { actions, tile }
    this.settleInfo = null; // 本局结算数据
    this.turnNo = 1; // 巡目
    this.dealAnim = 0; // 发牌动画进度
    this.drag = null; // 拖动出牌状态
    this.lastTap = { i: -1, at: 0 }; // 双击检测
    this.listening = { me: false, left: false, right: false }; // 报听状态
    this.listenWaits = { me: [], left: [], right: [] }; // 报听时记录的听口（可胡牌型）
    this.listenDiscard = { me: -1, left: -1, right: -1 }; // 报听扣牌在牌河的下标
    this.lastDrawn = null; // 本人刚摸到的牌（报听后只能打它）
    this.lastDrawnIdx = -1; // 刚摸到的牌在手牌中的下标（唯一「摸」标记）
    this.latestDiscard = null; // 最新打出的一张：中上区域放大显示 { seat, tile, idx, faceDown }
    this.listenPick = false; // 报听选牌模式（选择要扣的牌）
    this.turnAutoTimer = null; // 出牌超时兜底（自动打出选中的牌）
    this.timer = null; // 行动计时 { end, total, warn, kind }：显示在牌局中央
    this.gangIdx = 0; // 多张可杠牌轮换指针
  }

  /** 由等待房间进入时传入配置；已有庄家（续局）则跳过掷骰定庄 */
  setMatch(cfg = {}) {
    this.chips = cfg.chips || [];
    this.rule = this.chips.join(' · ');
    this.baseScore = [1, 2, 5].includes(Number(cfg.base)) ? Number(cfg.base) : 1; // 房间底分
    this.totalLaps = cfg.laps || cfg.rounds || 2;
    this.handNo = cfg.handNo || 0;
    this.playedHands = cfg.playedHands || 0;
    this.dealer = cfg.dealer || null;
    this.selected = -1;
    this.layout = null;
    this.lastResult = null;
    this.menuOpen = false;

    if (this.dealer) {
      // 下一局：庄家已由上局结果确定，直接开打
      this.phase = 'play';
      this.resetHandData();
    } else {
      this.playedHands = 0;
      this.startDealerRoll();
    }
  }

  /** 重置一局的演示牌面数据 */
  resetHandData() {
    this.hand = ['2m', '3m', '3m', '4m', '5p', '6p', '7p', '7s', '8s', '8s', '9s', 'E', 'C', '5m'];
    this.discards = { left: [], right: [], me: [] };
    this.match.wall = 24;
    this.match.turn = 1;
    this.selected = -1;
    this.layout = null;
  }

  /* ==================== 联机对局 ==================== */

  /**
   * 进入在线对局：清空演示数据，等待服务器事件驱动
   * cfg: { code, rounds, players, meSeat }
   */
  setOnline(cfg = {}) {
    this.net = { online: true };
    this.roomCode = cfg.code;
    this.players = cfg.players || [];
    this.meSeat = cfg.meSeat || 'me';
    this.totalLaps = cfg.laps || cfg.rounds || 2;
    this.playedHands = 0;
    this.handNo = 0;

    this.hand = [];
    this.discards = { me: [], left: [], right: [] };
    this.melds = { me: [], left: [], right: [] };
    this.handCounts = { me: 0, left: 0, right: 0 };
    this.turnSeat = null;
    this.offer = null;
    this.settleInfo = null;
    this.canNext = false;
    this.settleReady = false; // 结算页「准备」状态
    this.readySeats = []; // 已确认继续下一局的座位
    this.drag = null;
    this.lastTap = { i: -1, at: 0 };
    this.listening = { me: false, left: false, right: false };
    this.listenWaits = { me: [], left: [], right: [] };
    this.listenDiscard = { me: -1, left: -1, right: -1 };
    this.lastDrawn = null;
    this.lastDrawnIdx = -1;
    this.latestDiscard = null;
    this.listenPick = false;
    this.clearTurnAuto();
    this.gangIdx = 0;

    this.phase = 'dice';
    this.dealer = null;
    this.rolls = { me: [1, 1], left: [1, 1], right: [1, 1] };
    this.rollLocked = { me: false, left: false, right: false };
    this.tieSeats = [];
    this.diceDone = false;
    this.selected = -1;
    this.menuOpen = false;
    this.layout = null;
    this.turnNo = 1;
    this.rotations = 0;
    this.match = { round: lapName(0), turn: 1, wall: 0 };

    this.applyPlayers();
  }

  /** 服务器座位 → 我的本地视角（me 下 / left 左 / right 右） */
  localSeat(server) {
    const i = (SEAT_CLOCKWISE.indexOf(server) - SEAT_CLOCKWISE.indexOf(this.meSeat) + 3) % 3;
    return SEAT_CLOCKWISE[i];
  }

  /** 本地视角 → 服务器座位 */
  serverSeat(local) {
    const i = (SEAT_CLOCKWISE.indexOf(local) + SEAT_CLOCKWISE.indexOf(this.meSeat)) % 3;
    return SEAT_CLOCKWISE[i];
  }

  applyPlayers() {
    const map = {};
    for (const p of this.players || []) map[p.seat] = p;
    SEAT_CLOCKWISE.forEach((local) => {
      const p = map[this.serverSeat(local)];
      if (!p) return;
      const nick = p.nickname || '玩家';
      this.seats[local] = {
        ...this.seats[local],
        name: nick,
        avatar: nick[0],
        score: p.points || 0,
        isAI: !!p.isAI,
      };
    });
  }

  /** 是否轮到我出牌 */
  myTurnNow() {
    return !!this.net && this.phase === 'play' && this.turnSeat === 'me' && !this.settleInfo;
  }

  /** 服务器事件入口（main.js 路由） */
  onNetEvent(t, d) {
    if (!this.net) return;
    switch (t) {
      case 'wallCommit':
        // 牌库定序指纹：对局开始前已确定、不可变（公平性核验用）
        this.wallHash = d.hash;
        return;
      case 'dice':
        return this.onDice(d);
      case 'dealer':
        return this.onDealer(d);
      case 'dealStep':
        return this.onDealStep(d);
      case 'deal':
        return this.onDeal(d);
      case 'turn':
        return this.onTurn(d);
      case 'draw':
        return this.onDraw(d);
      case 'discard':
        return this.onDiscard(d);
      case 'action':
        return this.onAction(d);
      case 'offer':
        return this.onOffer(d);
      case 'listen':
        return this.onListen(d);
      case 'settle':
        return this.onSettle(d);
      case 'gangSettle':
        return this.onGangSettle(d);
      case 'roundEnd':
        return this.onRoundEnd(d);
      case 'nextReady':
        return this.onNextReady(d);
      case 'matchOver':
        return this.onMatchOver(d);
      case 'gameResume':
        return this.onResume(d);
      default:
        return undefined;
    }
  }

  /** 每局重置（首局由 dice 事件触发，续局由 dealer 事件触发） */
  resetForRound(d) {
    if (d.roundNo != null) this.handNo = d.roundNo;
    if (d.rotations != null) this.rotations = d.rotations;
    this.roundText = d.roundName || lapName(this.rotations || 0);
    this.outSeats = []; // 平局重掷退出庄家选择的座位
    this.candidateSeats = SEAT_CLOCKWISE.slice(); // 参与比点的座位
    this.rollCount = 0;
    this.offer = null;
    this.settleInfo = null;
    this.canNext = false;
    this.settleReady = false;
    this.readySeats = [];
    this.listening = { me: false, left: false, right: false };
    this.listenWaits = { me: [], left: [], right: [] };
    this.listenDiscard = { me: -1, left: -1, right: -1 };
    this.lastDrawn = null;
    this.lastDrawnIdx = -1;
    this.latestDiscard = null;
    this.listenPick = false;
    this.clearTurnAuto();
    this.gangIdx = 0;
    this.hand = [];
    this.discards = { me: [], left: [], right: [] };
    this.melds = { me: [], left: [], right: [] };
    this.handCounts = { me: 0, left: 0, right: 0 };
    this.turnSeat = null;
    this.turnNo = 1;
    this.match = { round: this.roundText, turn: 1, wall: d.wallCount || 0 };
    this.selected = -1;
    this.layout = null;
  }

  /** 摇骰（仅首局）：套用服务器点数，本地只播放定格动画 */
  onDice(d) {
    const rolls = {};
    SEAT_CLOCKWISE.forEach((local) => {
      const s = this.serverSeat(local);
      rolls[local] = (d.rolls && d.rolls[s]) || [1, 1];
    });
    // 平局重掷：仅并列者重摇，其余玩家点数保留并退出庄家选择
    const reroll = (d.reroll || []).map((s) => this.localSeat(s));
    const seats = (d.seats || []).map((s) => this.localSeat(s));
    const out = (d.out || []).map((s) => this.localSeat(s));
    clearTimeout(this.playEntryTimer);
    this.playEntryTimer = null;
    this.rolls = rolls;
    this.phase = 'dice';
    this.dealer = null;
    this.diceDone = false;
    this.rollStart = Date.now();
    this.rollCount = (this.rollCount || 0) + 1;
    this.outSeats = out;
    this.candidateSeats = seats.length ? seats : SEAT_CLOCKWISE.slice();
    if (!reroll.length) {
      // 首轮：三家同时摇
      this.rollCount = 1;
      this.outSeats = [];
      this.resetForRound(d);
      this.rollStart = Date.now();
      this.rollLocked = { me: false, left: false, right: false };
      this.tieSeats = [];
    } else {
      // 重掷轮：只有并列者重新滚动，其他人保持定格
      this.rollLocked = {
        me: !reroll.includes('me'),
        left: !reroll.includes('left'),
        right: !reroll.includes('right'),
      };
      this.tieSeats = reroll;
      this.layout = null;
    }
  }

  /** 定庄：显示庄家并进入发牌阶段（续局无骰子事件，直接重置开局） */
  onDealer(d) {
    const keep = !!d.keep; // 续局/连庄：无骰子展示
    if (this.phase !== 'dice') this.resetForRound(d);
    clearTimeout(this.playEntryTimer);
    this.playEntryTimer = null;
    this.dealer = this.localSeat(d.dealer);
    this.diceDone = true;
    this.rollLocked = { me: true, left: true, right: true };
    this.tieSeats = [];
    this.outSeats = [];
    // 同步最终点数（含平局重掷结果）
    if (d.rolls) {
      SEAT_CLOCKWISE.forEach((local) => {
        const s = this.serverSeat(local);
        if (d.rolls[s]) this.rolls[local] = d.rolls[s];
      });
    }
    this.layout = null;
    wx.showToast({ title: `${this.seatName(this.dealer)} 坐庄`, icon: 'none' });
    if (keep) {
      this.phase = 'deal';
      return;
    }
    // 骰子摇完、三家点数全部确定后停留 2 秒展示定庄结果，再进入对局
    this.phase = 'dice';
    this.playEntryTimer = setTimeout(() => {
      this.playEntryTimer = null;
      this.phase = 'deal';
      this.layout = null;
    }, 2000);
  }

  /** 逐垛发牌：本人逐张可见，他人只加牌背数量 */
  onDealStep(d) {
    const local = this.localSeat(d.seat);
    if (local === 'me') {
      if (Array.isArray(d.tiles) && d.tiles.length) this.hand.push(...d.tiles);
      this.handCounts.me = this.hand.length;
    } else {
      this.handCounts[local] = (this.handCounts[local] || 0) + (d.count || 0);
    }
    if (d.wallCount != null) this.match.wall = d.wallCount;
    this.phase = 'deal';
    this.layout = null;
  }

  /** 发牌完成：校准手牌并自动理牌 */
  onDeal(d) {
    if (Array.isArray(d.hand)) this.hand = sortHand(d.hand);
    this.handCounts.me = this.hand.length;
    SEAT_CLOCKWISE.forEach((local) => {
      if (local !== 'me' && !this.handCounts[local]) this.handCounts[local] = 13;
    });
    if (d.wallCount != null) this.match.wall = d.wallCount;
    if (d.dealer) this.dealer = this.localSeat(d.dealer);
    if (d.roundName) this.roundText = d.roundName;
    this.selected = -1;
    this.layout = null;
    this.enterPlay(); // 发牌结束 → 进入对局（定庄停留已在骰子阶段完成）
  }

  /** 进入对局：发牌结束即可摸打 */
  enterPlay() {
    clearTimeout(this.playEntryTimer);
    this.playEntryTimer = null;
    if (this.phase === 'deal') {
      this.phase = 'play';
      this.layout = null;
    }
  }

  /** 轮到某家行动 */
  onTurn(d) {
    this.turnSeat = this.localSeat(d.seat);
    if (this.phase === 'deal') this.enterPlay();
    if (d.wallCount != null) this.match.wall = d.wallCount;
    this.offer = null;
    if (this.listenPick) this.listenPick = false; // 超时跳过选牌
    this.match.turn = this.turnNo;
    this.layout = null;
    // 出牌计时：与我有关时启动（服务器 15s 超时自动出牌，最后 3s 警告）
    if (this.turnSeat === 'me') this.startTimer(d.ms, d.warnMs, 'play');
    else this.stopTimer();
  }

  /* ---------- 行动计时（中央倒计时） ---------- */

  /** 启动计时：ms 为总时长，warnMs 为最后警告时长 */
  startTimer(ms, warnMs, kind) {
    const total = ms > 0 ? ms : 15_000;
    this.timer = {
      end: Date.now() + total,
      total,
      warn: warnMs > 0 ? warnMs : 3_000,
      kind: kind || 'play',
    };
    this.layout = null;
  }

  stopTimer() {
    if (this.timer) {
      this.timer = null;
      this.layout = null;
    }
  }

  /** 剩余毫秒（无计时返回 null） */
  timerRemain() {
    if (!this.timer) return null;
    return Math.max(0, this.timer.end - Date.now());
  }

  clearTurnAuto() {
    clearTimeout(this.turnAutoTimer);
    this.turnAutoTimer = null;
  }

  /** 摸牌：本人收牌面，他人牌背 +1 */
  onDraw(d) {
    const local = this.localSeat(d.seat);
    if (local === 'me') {
      // 新摸的牌先单独显示在最右侧，不理牌；出牌后再统一整理
      if (d.tile) this.hand.push(d.tile);
      this.lastDrawn = d.tile || null; // 报听后只能打这张
      this.lastDrawnIdx = d.tile ? this.hand.length - 1 : -1;
      this.handCounts.me = this.hand.length;
    } else {
      this.handCounts[local] = (this.handCounts[local] || 13) + 1;
    }
    if (d.wallCount != null) this.match.wall = d.wallCount;
    this.layout = null;
  }

  /** 出牌：更新牌河与手牌 */
  onDiscard(d) {
    const local = this.localSeat(d.seat);
    this.discards[local].push(d.tile);
    // 报听扣牌：记下牌河下标，渲染为背面朝上
    if (d.faceDown) this.listenDiscard[local] = this.discards[local].length - 1;
    // 最新打出的一张：中上区域放大显示；上一张自动回到对应牌河
    this.latestDiscard = {
      seat: local,
      tile: d.tile,
      idx: this.discards[local].length - 1,
      faceDown: !!d.faceDown,
    };
    if (local === 'me') {
      const i = this.hand.lastIndexOf(d.tile);
      if (i >= 0) this.hand.splice(i, 1);
      this.hand = sortHand(this.hand); // 出牌后自动理牌
      this.handCounts.me = this.hand.length;
      this.selected = -1;
      this.lastDrawn = null;
      this.lastDrawnIdx = -1;
      this.clearTurnAuto();
      this.stopTimer(); // 我出牌后倒计时结束
    } else {
      this.handCounts[local] = Math.max(1, (this.handCounts[local] || 14) - 1);
    }
    if (d.wallCount != null) this.match.wall = d.wallCount;
    const total = this.discards.me.length + this.discards.left.length + this.discards.right.length;
    this.turnNo = Math.floor(total / 3) + 1;
    this.match.turn = this.turnNo;
    this.offer = null;
    this.layout = null;
  }

  /** 碰 / 杠 / 补杠：记录副露并调整手牌 */
  onAction(d) {
    const local = this.localSeat(d.seat);
    // 被碰/明杠取走的弃牌不再作为「最新打出」放大显示
    if (d.type === 'peng' || (d.type === 'gang' && !d.concealed)) this.latestDiscard = null;
    // 报听者杠后听口可能变化：随动作事件同步
    if (Array.isArray(d.listenWaits)) this.listenWaits[local] = d.listenWaits.slice();
    // 补杠不新增副露，改已有碰的类型
    if (d.type === 'bugang') {
      const m = this.melds[local].find((x) => x.type === 'peng' && x.tile === d.tile);
      if (m) m.type = 'bugang';
      if (local === 'me') {
        const i = this.hand.indexOf(d.tile);
        if (i >= 0) this.hand.splice(i, 1);
        this.hand = sortHand(this.hand); // 补杠后理牌
        this.handCounts.me = this.hand.length;
        this.lastDrawnIdx = -1;
      }
      this.layout = null;
      return;
    }
    const n = d.type === 'peng' ? 2 : 3;
    this.melds[local].push({ type: d.type, tile: d.tile, concealed: d.concealed });
    if (local === 'me') {
      const remove = d.concealed ? 4 : n;
      for (let k = 0; k < remove; k++) {
        const i = this.hand.indexOf(d.tile);
        if (i >= 0) this.hand.splice(i, 1);
      }
      this.hand = sortHand(this.hand); // 碰/杠后理牌
      this.handCounts.me = this.hand.length;
      this.lastDrawnIdx = -1;
    } else {
      const remove = d.concealed ? 4 : n;
      this.handCounts[local] = Math.max(1, (this.handCounts[local] || 13) - remove);
    }
    if (d.type !== 'gang') this.selected = -1;
    this.layout = null;
  }

  /** 报听：标记听牌状态（听后不能再碰/杠） */
  onListen(d) {
    const local = this.localSeat(d.seat);
    this.listenPick = false;
    this.listening[local] = true;
    this.listenWaits[local] = Array.isArray(d.waits) ? d.waits.slice() : [];
    if (d.listening) {
      SEAT_CLOCKWISE.forEach((s) => {
        this.listening[s] = !!d.listening[this.serverSeat(s)];
      });
    }
    this.layout = null;
    const waits = (this.listenWaits[local] || []).map(tileCn).join(' / ');
    if (local === 'me') {
      wx.showToast({ title: waits ? `已报听：听 ${waits}` : '已报听：摸什么打什么，不能再碰杠', icon: 'none' });
    } else {
      wx.showToast({ title: `${this.seatName(local)} 报听${waits ? `：听 ${waits}` : ''}`, icon: 'none' });
    }
  }

  /** 我的碰/杠/胡询问 */
  onOffer(d) {
    this.offer = { actions: (d.actions || []).slice(), tile: d.tile, robGang: !!d.robGang };
    // 碰/杠/胡决策计时：15s，最后 3s 警告，超时自动「过」并轮到下家
    this.startTimer(d.ms, d.warnMs, 'offer');
    this.layout = null;
    if (d.robGang) {
      wx.showToast({ title: `可抢杠胡 ${tileCn(d.tile)}`, icon: 'none' });
    } else if (this.offer.actions.includes('hu')) {
      wx.showToast({ title: '可以胡牌', icon: 'none' });
    }
  }

  /** 本局结算 */
  onSettle(d) {
    this.settleInfo = d;
    this.phase = 'settle';
    this.offer = null;
    this.settleReady = false;
    this.readySeats = [];
    this.clearTurnAuto();
    this.stopTimer(); // 本局结束：隐藏中央倒计时
    clearTimeout(this.playEntryTimer);
    this.playEntryTimer = null;
    this.turnSeat = null;
    this.menuOpen = false;
    // 更新头像下方累计分数（负分原样显示）
    const cum = d.points || null;
    if (cum) {
      SEAT_CLOCKWISE.forEach((local) => {
        const s = this.seats[local];
        const v = cum[this.serverSeat(local)];
        if (s && typeof v === 'number') s.score = v;
      });
    }
    this.layout = null;
    const isHu = !!d.winnerSeat;
    wx.showToast({ title: isHu ? d.handName || '胡牌' : '流局', icon: 'none' });
  }

  /** 杠即时积分（暗杠/补杠/点杠，与胡牌无关） */
  onGangSettle(d) {
    const names = { angang: '暗杠', bugang: '补杠', diangang: '点杠' };
    const gain = d.gain || 0;
    wx.showToast({ title: `${names[d.type] || '杠'} ${gain > 0 ? `+${gain}` : gain} 点`, icon: 'none' });
  }

  /** 局间：标记可进入下一局 */
  onRoundEnd() {
    this.canNext = true;
    this.layout = null;
  }

  /** 其他玩家已准备（确认继续下一局） */
  onNextReady(d) {
    this.readySeats = ((d && d.confirmed) || []).map((s) => this.localSeat(s));
    if (this.readySeats.includes('me')) this.settleReady = true;
    this.layout = null;
  }

  /** 整场结束 */
  onMatchOver(d) {
    this.canNext = false;
    this.matchOver = true;
    wx.showToast({ title: `对局结束（${(d && d.laps) || this.totalLaps} 圈）`, icon: 'none' });
  }

  /** 断线重连快照 */
  onResume(d) {
    if (!d) return;
    if (d.roundNo != null) this.handNo = d.roundNo;
    if (d.rotations != null) this.rotations = d.rotations;
    if (d.roundName) this.roundText = d.roundName;
    if (d.laps != null) this.totalLaps = d.laps;
    if (d.dealer) this.dealer = this.localSeat(d.dealer);
    if (d.turn) this.turnSeat = this.localSeat(d.turn);
    if (Array.isArray(d.hand)) this.hand = sortHand(d.hand); // 断线重连：理牌恢复
    this.handCounts.me = this.hand.length;
    if (d.wallCount != null) this.match.wall = d.wallCount;
    if (d.discards) {
      SEAT_CLOCKWISE.forEach((local) => {
        this.discards[local] = (d.discards[this.serverSeat(local)] || []).slice();
      });
    }
    this.latestDiscard = null; // 重连后不放大显示旧牌
    if (d.melds) {
      SEAT_CLOCKWISE.forEach((local) => {
        this.melds[local] = (d.melds[this.serverSeat(local)] || []).slice();
      });
    }
    this.phase = d.phase === 'play' ? 'play' : d.phase || 'play';
    if (d.listening) {
      SEAT_CLOCKWISE.forEach((s) => {
        this.listening[s] = !!d.listening[this.serverSeat(s)];
      });
    }
    if (d.listenDiscard) {
      SEAT_CLOCKWISE.forEach((s) => {
        const v = d.listenDiscard[this.serverSeat(s)];
        this.listenDiscard[s] = v == null ? -1 : v;
      });
    }
    if (d.listenWaits) {
      SEAT_CLOCKWISE.forEach((s) => {
        this.listenWaits[s] = d.listenWaits[this.serverSeat(s)] || [];
      });
    }
    this.layout = null;
  }

  /**
   * 我当前可执行的动作（联机）：
   *   有服务器询问 → offer.actions（碰/杠/胡 + 过）
   *   我的出牌巡 → 自摸胡 / 暗杠补杠 / 报听
   */
  myActions() {
    if (!this.net) return null;
    if (this.offer) return [...this.offer.actions, 'pass'];
    if (!this.myTurnNow()) return null;
    if (this.hand.length % 3 !== 2) return null;
    const acts = [];
    // 未报听不能胡；十三幺十三面听实为 10 面（1万/1条/1饼 1 点不能胡）
    if (this.listening.me && canHu(this.hand)) {
      const winTile = this.lastDrawn || this.hand[this.hand.length - 1];
      if (!(isThirteenOrphans(this.hand) && tilePoint(winTile) < 3)) acts.push('hu');
    }
    if (this.gangCandidates().length) acts.push('gang');
    // 报听：需弃牌 ≥3 点，且听口至少一张 ≥6 点（报听后不能再听）
    if (!this.listening.me && canDeclareListenLocal(this.hand)) acts.push('listen');
    // 选牌模式：只保留「取消」入口，隐藏其他动作
    if (this.listenPick) return ['listen'];
    return acts;
  }

  /** 刚摸到的牌在手牌中的下标（未摸牌返回 -1）：用于「摸」字与末张抬升 */
  drawnIndex() {
    if (this.lastDrawnIdx >= 0 && this.lastDrawnIdx < this.hand.length) return this.lastDrawnIdx;
    // 兜底：14/11/8 张待出牌状态时末张即待出牌（发牌后、重连后）
    return this.hand.length % 3 === 2 ? this.hand.length - 1 : -1;
  }

  /**
   * 当前可杠的牌：
   *   未报听 → 有暗杠/补杠即可；
   *   已报听 → 不能杠（报听须门清，杠会拆散听口；豪七对同理）
   */
  gangCandidates() {
    if (this.listening.me) return [];
    return canAngang(this.hand).concat(canBugang(this.hand, this.melds.me));
  }

  /* ---------- 掷骰定庄 ---------- */

  startDealerRoll() {
    this.phase = 'dice';
    this.rolls = rollAll();
    this.rollLocked = { me: false, left: false, right: false };
    this.rollStart = Date.now();
    this.tieSeats = [];
    this.diceDone = false;
    this.dealer = null;
  }

  /** 逐家定格 + 比点，结果只结算一次 */
  updateDice() {
    if (this.phase !== 'dice') return;
    const now = Date.now();
    SEAT_CLOCKWISE.forEach((seat, i) => {
      if (!this.rollLocked[seat] && now >= this.rollStart + 520 + i * 420) {
        this.rollLocked[seat] = true;
      }
    });
    const allLocked = SEAT_CLOCKWISE.every((s) => this.rollLocked[s]);
    if (allLocked && !this.diceDone) {
      this.diceDone = true;
      // 仅在候选座位（平局重掷后为并列者）中比点
      const { dealer, tie } = determineDealer(this.rolls, this.candidateSeats);
      this.tieSeats = tie;
      if (dealer) this.dealer = dealer;
    }
  }

  /** 骰子当前展示值（滚动中为随机闪烁） */
  diceView(seat, i) {
    const idx = SEAT_CLOCKWISE.indexOf(seat);
    if (!this.rollLocked[seat]) {
      const t = Math.floor(Date.now() / 70 + idx * 11 + i * 5);
      return 1 + (t % 6);
    }
    return this.rolls[seat][i];
  }

  seatName(seat) {
    if (seat === 'me') return '你';
    return this.seats[seat] ? this.seats[seat].name : '';
  }

  /* ---------- 结算 / 轮庄 ---------- */

  /** 本局结束：按结果轮庄（庄赢连庄，他人赢则顺时针下一位坐庄 = 下庄），并进入结算页 */
  settle(winner) {
    const prevRoundName = lapName(this.rotations || 0);
    const prev = this.dealer;
    const next = nextDealer(prev, winner);
    const lianzhuang = next === prev;
    if (!lianzhuang) {
      this.handNo += 1;
      this.rotations = (this.rotations || 0) + 1; // 下庄：巡 +1
    }
    this.playedHands = (this.playedHands || 0) + 1;
    this.dealer = next;
    this.lastResult = { winner, lianzhuang };
    this.menuOpen = false;

    if (this.onFinish) {
      this.onFinish(this.buildResult(winner, lianzhuang, prevRoundName));
    }
  }

  /** 组装结算页数据 */
  buildResult(winner, lianzhuang, prevRoundName) {
    const isLast = this.playedHands >= this.totalLaps * 3;
    const meWin = winner === 'me';
    return {
      winTag: meWin ? '自 摸' : '点 炮',
      handName: '清一色 · 门清',
      roundText: `${prevRoundName} · 第 ${this.match.turn} 巡 · 壁牌 ${this.match.wall} 张`,
      hand: this.hand.slice(),
      winTileIndex: this.hand.length - 1,
      fans: [
        { name: '清一色', value: '6 番' },
        { name: '门清', value: '1 番' },
        { name: meWin ? '自摸' : '点炮', value: '1 番' },
      ],
      totalFan: '8 番',
      winner,
      deltas: SEAT_CLOCKWISE.map((seat) => ({
        seat,
        name: this.seatName(seat),
        avatar: this.seats[seat].avatar,
        grad: this.seats[seat].grad,
        delta: seat === winner ? 64 * this.baseScore : -32 * this.baseScore,
      })),
      lianzhuang,
      isLast,
      next: {
        handNo: this.handNo,
        playedHands: this.playedHands,
        dealer: this.dealer,
        rotations: this.rotations,
        laps: this.totalLaps,
        chips: this.chips || [],
      },
    };
  }

  /* ---------- 视口（横竖屏） ---------- */

  /** 绘制视口：竖屏 = 屏幕尺寸；横屏 = 812×375 虚拟视口（对局页横向重排） */
  setupViewport() {
    this.landscape = isLandscape;
    this.vw = isLandscape ? GAME_WIDTH : SCREEN_WIDTH;
    this.vh = isLandscape ? GAME_HEIGHT : SCREEN_HEIGHT;
    this.k = isLandscape ? this.vh / 420 : this.vw / 380;
  }

  /** 方向切换回调（main.js 触发）：更新视口与缩放，布局下帧重建 */
  handleViewportChange() {
    this.setupViewport();
    this.layout = null;
  }

  /* ---------- 布局 ---------- */

  buildLayout() {
    const k = this.k;
    const W = this.vw;
    const H = this.vh;
    const items = [];

    const topY = STATUS_BAR_HEIGHT + 8 * k;
    const barH = 30 * k;
    items.push({ id: 'gear', x: W - 16 * k - 30 * k, y: topY, w: 30 * k, h: barH });

    if (this.landscape) {
      this.buildLandscapeLayout(items, { k, W, H, topY, barH });
      return;
    }

    const oppY = topY + barH + 16 * k;
    const lcx = 60 * k;
    const rcx = W - 60 * k;

    // 手牌
    const handW = 25 * k;
    const handH = 36 * k;
    const handGap = 1 * k;
    const handTop = H - 62 * k - 64 * k;
    const totalW = this.hand.length * handW + (this.hand.length - 1) * handGap + 5 * k;
    const handX = (W - totalW) / 2;
    const handCy = handTop + 14 * k; // 牌底贴近 me 栏上方，避免遮挡
    this.hand.forEach((tile, i) => {
      const isDrawn = i === this.drawnIndex();
      const x = handX + i * (handW + handGap) + (isDrawn ? 5 * k : 0);
      const raised = this.selected === i ? 8 * k : isDrawn ? 5 * k : 0;
      items.push({
        id: `hand:${i}`,
        x: x - 1 * k,
        y: handCy - handH / 2 - 10 * k,
        w: handW + 2 * k,
        h: handH + 12 * k,
        cy: handCy - raised,
      });
    });

    // 操作按钮
    const actY = H - 172 * k - 46 * k;
    const actW = 46 * k;
    const actGap = 9 * k;
    const acts = ['hu', 'gang', 'peng', 'listen', 'pass'];
    const actsX = W - 16 * k - (acts.length * actW + (acts.length - 1) * actGap);
    acts.forEach((a, i) => {
      items.push({ id: `act:${a}`, x: actsX + i * (actW + actGap), y: actY, w: actW, h: actW });
    });

    this.layout = {
      items,
      topY,
      barH,
      oppY,
      lcx,
      rcx,
      handX,
      handW,
      handH,
      handGap,
      handCy,
      handTop,
      actY,
      actW,
      actGap,
      actsX,
    };
  }

  /** 横屏布局：宽幅重排（座位两侧居中、牌河中央宽幅、手牌底部中央、按钮右下） */
  buildLandscapeLayout(items, opt) {
    const { k, W, H, topY, barH } = opt;

    // 左右两家：头像组垂直居中于两侧
    const seatCy = topY + barH + 62 * k;
    const oppY = seatCy - 22 * k; // 兼容竖屏相对定位（头像中心 = oppY + 22k）
    const lcx = 36 * k;
    const rcx = W - 36 * k;

    // 手牌：底部中央
    const handW = 25 * k;
    const handH = 36 * k;
    const handGap = 1 * k;
    const handTop = H - 62 * k - 64 * k;
    const totalW = this.hand.length * handW + (this.hand.length - 1) * handGap + 5 * k;
    const handX = (W - totalW) / 2;
    const handCy = handTop + 14 * k;
    this.hand.forEach((tile, i) => {
      const isDrawn = i === this.drawnIndex();
      const x = handX + i * (handW + handGap) + (isDrawn ? 5 * k : 0);
      const raised = this.selected === i ? 8 * k : isDrawn ? 5 * k : 0;
      items.push({
        id: `hand:${i}`,
        x: x - 1 * k,
        y: handCy - handH / 2 - 10 * k,
        w: handW + 2 * k,
        h: handH + 12 * k,
        cy: handCy - raised,
      });
    });

    // 操作按钮：右下角（自己信息栏上方）
    const actW = 46 * k;
    const actGap = 9 * k;
    const acts = ['hu', 'gang', 'peng', 'listen', 'pass'];
    const actsX = W - 16 * k - (acts.length * actW + (acts.length - 1) * actGap);
    const meBarTop = H - SAFE_BOTTOM - 56 * k;
    const actY = meBarTop - actW - 12 * k;
    acts.forEach((a, i) => {
      items.push({ id: `act:${a}`, x: actsX + i * (actW + actGap), y: actY, w: actW, h: actW });
    });

    this.layout = {
      items,
      topY,
      barH,
      oppY,
      lcx,
      rcx,
      handX,
      handW,
      handH,
      handGap,
      handCy,
      handTop,
      actY,
      actW,
      actGap,
      actsX,
      // 牌河区域（drawPond 横屏分支使用）
      pond: { x: 56 * k, w: W - 112 * k, top: topY + barH + 14 * k, bottom: handTop - 14 * k },
    };
  }

  /* ---------- 触摸 ---------- */

  inRect(x, y, r) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  hit(x, y) {
    // 结算弹层优先
    if (this.settleInfo) {
      return this.inRect(x, y, this.settleBtn) ? 'settle:next' : 'settle:blank';
    }
    // 弹层优先：对局菜单 / 定庄面板
    if (this.menuOpen) {
      for (let i = this.menuItems.length - 1; i >= 0; i--) {
        if (this.inRect(x, y, this.menuItems[i])) return this.menuItems[i].id;
      }
      return 'menu:blank';
    }
    if (this.phase === 'dice') {
      if (this.diceBtn && this.inRect(x, y, this.diceBtn)) return 'dice:btn';
      return 'dice:blank';
    }
    // 手牌后画，命中优先
    const items = this.layout ? this.layout.items : [];
    for (let i = items.length - 1; i >= 0; i--) {
      if (this.inRect(x, y, items[i])) return items[i].id;
    }
    return null;
  }

  onTouchStart(x, y) {
    this.pressed = this.hit(x, y);
    // 手牌按下：记录拖动起点（拖动出牌）
    if (this.pressed && this.pressed.startsWith('hand:')) {
      this.drag = { i: +this.pressed.slice(5), x0: x, y0: y, x, y, moved: false };
    }
  }

  onTouchMove(x, y) {
    if (!this.drag) return;
    const d = this.drag;
    d.x = x;
    d.y = y;
    if (Math.abs(x - d.x0) + Math.abs(y - d.y0) > 10 * this.k) d.moved = true;
  }

  onTouchEnd(x, y) {
    const pressed = this.pressed;
    const drag = this.drag;
    this.pressed = null;
    this.drag = null;

    // 拖动出牌：松手落在牌河内即打出（选牌模式 → 扣牌报听）
    if (drag && drag.moved) {
      if (this.myTurnNow() && this.inRect(x, y, this.pondRect())) {
        if (this.listenPick) this.confirmListenPick(drag.i);
        else this.discardTile(drag.i);
      }
      return;
    }

    if (!pressed || this.hit(x, y) !== pressed) return;

    // 双击手牌出牌（选牌模式 → 扣牌报听）
    if (pressed.startsWith('hand:')) {
      const i = +pressed.slice(5);
      const now = Date.now();
      if (this.myTurnNow() && this.lastTap.i === i && now - this.lastTap.at < 320) {
        this.lastTap = { i: -1, at: 0 };
        if (this.listenPick) this.confirmListenPick(i);
        else this.discardTile(i);
        return;
      }
      this.lastTap = { i, at: now };
    }
    this.handle(pressed);
  }

  /** 牌河区域（拖动出牌的落点判定） */
  pondRect() {
    const { k } = this;
    const L = this.layout || {};
    if (this.landscape && L.pond) {
      return { x: L.pond.x, y: L.pond.top, w: L.pond.w, h: L.pond.bottom - L.pond.top };
    }
    const top = (L.oppY || 0) + 92 * k;
    return { x: 36 * k, y: top, w: this.vw - 72 * k, h: this.vh - 206 * k - top };
  }

  /** 打出一张手牌（联机） */
  discardTile(i) {
    if (!this.myTurnNow()) return;
    const tile = this.hand[i];
    if (!tile) return;
    // 报听后手牌锁定：只能打出刚摸到的牌
    if (this.net && this.listening.me && this.lastDrawn && tile !== this.lastDrawn) {
      wx.showToast({ title: '报听后只能打出摸到的牌', icon: 'none' });
      return;
    }
    this.selected = -1;
    this.drag = null;
    net.send('discard', { tile });
  }

  /** 报听选牌：双击/拖动候选牌 → 扣牌报听 */
  confirmListenPick(i) {
    const tile = this.hand[i];
    if (!tile) return;
    const ok = listenCandidates(this.hand).some((c) => c.tile === tile);
    if (!ok) {
      wx.showToast({ title: '这张不能扣：需 ≥3 点且听口含 ≥6 点', icon: 'none' });
      return;
    }
    this.listenPick = false;
    this.selected = -1;
    this.drag = null;
    net.send('listen', { tile });
  }

  handle(id) {
    // 结算页：准备（全员准备后服务器开下一局）
    if (id === 'settle:next') {
      if (this.settleReady) return;
      if (this.canNext) {
        this.settleReady = true; // 页面保持展示，等待其他玩家
        this.layout = null;
        if (this.net) net.send('nextRound', {});
      } else {
        // 整场已结束或尚未允许继续：关闭页面
        this.settleInfo = null;
        this.layout = null;
      }
      return;
    }
    if (id === 'dice:btn') {
      if (this.net) return; // 联机：由服务器推进发牌
      if (!this.diceDone) return;
      if (this.tieSeats.length > 0) {
        this.startDealerRoll();
        return;
      }
      // 定庄完成 → 进入对局
      this.phase = 'deal';
      this.enterPlay();
      this.selected = -1;
      wx.showToast({ title: `${this.seatName(this.dealer)} 坐庄`, icon: 'none' });
      return;
    }
    if (id === 'menu:resume') {
      this.menuOpen = false;
      return;
    }
    if (id === 'menu:exit') {
      this.menuOpen = false;
      if (this.onExit) this.onExit();
      return;
    }
    if (id.startsWith('menu:win:')) {
      this.settle(id.slice('menu:win:'.length));
      return;
    }
    if (id.startsWith('hand:')) {
      const i = +id.split(':')[1];
      // 报听选牌模式：不可扣的牌点击提示，可扣的牌高亮选中
      if (this.listenPick) {
        const tile = this.hand[i];
        const ok = tile && listenCandidates(this.hand).some((c) => c.tile === tile);
        if (!ok) {
          wx.showToast({ title: '这张不能扣：需 ≥3 点且听口含 ≥6 点', icon: 'none' });
          return;
        }
      }
      this.selected = this.selected === i ? -1 : i;
      // 上报选中牌：出牌超时后服务器优先打出这张（无选中则打最右侧一张）
      if (this.net) {
        const tile = this.selected >= 0 ? this.hand[this.selected] : '';
        net.send('pick', { tile: tile || '' });
      }
      return;
    }
    if (id.startsWith('act:')) {
      const act = id.split(':')[1];
      if (this.net) {
        // 联机：把动作交给服务器裁决
        if (this.offer) {
          // 服务器询问：碰/杠/胡/过
          if (act === 'pass') {
            net.send('action', { type: 'pass' });
          } else if (this.offer.actions.includes(act)) {
            net.send('action', { type: act });
          }
          this.offer = null;
          this.stopTimer(); // 已作出决策，结束倒计时
          this.layout = null;
          return;
        }
        // 我的出牌巡：自摸胡 / 暗杠补杠 / 报听
        if (act === 'hu') {
          net.send('hu', {});
        } else if (act === 'gang') {
          const cand = this.gangCandidates();
          if (!cand.length) return;
          const tile = cand[this.gangIdx % cand.length];
          this.gangIdx += 1;
          net.send('gang', { tile });
        } else if (act === 'listen') {
          // 报听：进入选牌模式，由玩家双击/拖动选择要扣的牌（再点一次取消）
          this.listenPick = !this.listenPick;
          this.selected = -1;
          if (this.listenPick) {
            wx.showToast({ title: '请双击或拖动要扣的牌', icon: 'none' });
          }
        }
        this.layout = null;
        return;
      }
      if (act === 'hu') {
        // 胡 → 本局结束，进入结算页（自己胡牌）
        this.settle('me');
        return;
      }
      const labels = { gang: '杠', peng: '碰', pass: '过' };
      wx.showToast({ title: `${labels[act]} · 对局演示`, icon: 'none' });
      return;
    }
    if (id === 'gear') {
      this.menuOpen = true;
    }
  }

  /* ---------- 渲染 ---------- */

  render(ctx) {
    if (!this.layout) this.buildLayout();
    const L = this.layout;
    this.updateDice(); // 推进掷骰定格

    this.drawBackground(ctx);
    this.drawPond(ctx, L);
    this.drawTurnTimer(ctx, L); // 牌局中央行动倒计时
    this.drawOpponentBacks(ctx, L);
    this.drawSeats(ctx, L);
    this.drawTopBar(ctx, L);
    this.drawActions(ctx, L);
    this.drawHand(ctx, L);
    this.drawListenHints(ctx, L);
    this.drawMeBar(ctx, L);
    if (this.net) {
      this.drawMelds(ctx, L);
      this.drawDragGhost(ctx, L);
    }

    if (this.phase === 'dice') this.drawDealerPanel(ctx);
    if (this.menuOpen) this.drawMenu(ctx);
    if (this.settleInfo) this.drawSettleOverlay(ctx);
  }

  drawBackground(ctx) {
    const W = this.vw;
    const H = this.vh;
    const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, H * 0.78);
    g.addColorStop(0, '#16735a');
    g.addColorStop(0.4, '#0c4738');
    g.addColorStop(0.74, '#062a20');
    g.addColorStop(1, '#04150f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    for (let y = 0; y < H; y += 8) {
      for (let x = 0; x < W; x += 8) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();
  }

  // 牌河底板 + 标签 + 三方弃牌 + 罗盘
  drawPond(ctx, L) {
    const { k } = this;
    const W = this.vw;
    const H = this.vh;
    let x;
    let w;
    let top;
    let bottom;
    if (this.landscape && L.pond) {
      // 横屏：宽幅居中，底缘避开手牌
      x = L.pond.x;
      w = L.pond.w;
      top = L.pond.top;
      bottom = L.pond.bottom;
    } else {
      x = 36 * k;
      w = W - 72 * k;
      top = L.oppY + 92 * k;
      bottom = H - 206 * k; // 与设计稿一致：牌河底距屏底 206
    }
    const h = bottom - top;

    roundRect(ctx, x, top, w, h, 26 * k);
    const g = ctx.createRadialGradient(W / 2, top, 0, W / 2, top, h);
    g.addColorStop(0, 'rgba(255,255,255,.055)');
    g.addColorStop(0.6, 'rgba(255,255,255,.012)');
    g.addColorStop(1, 'rgba(0,0,0,.12)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.075)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 牌河标签
    spacedText(ctx, '牌 河', W / 2, top + 16 * k, {
      font: `500 ${Math.round(9 * k)}px ${SANS}`,
      fill: 'rgba(255,255,255,.22)',
      spacing: 2.4 * k,
    });

    const tw = 17 * k;
    const th = 22 * k;
    const gap = 2 * k;

    // 左右两列（上→下、左→右 12 张一列）
    const colRows = 8;
    const colH = colRows * (th + gap) - gap;
    const colTop = top + (h - colH) / 2;
    // 最新打出的一张放大显示，暂不落到牌河；下一张打出后它回到这里
    const latest = this.latestDiscard;
    // 点选某张手牌时，牌河中同款牌加金框高亮，便于判断剩余张数
    const markTile = this.selected >= 0 ? this.hand[this.selected] : null;
    const drawCol = (list, cx, alignRight, backIdx, seatName) => {
      list.forEach((tile, i) => {
        if (latest && latest.seat === seatName && latest.idx === i) return;
        const col = Math.floor(i / colRows);
        const row = i % colRows;
        const tx = alignRight ? cx - col * (tw + gap) : cx + col * (tw + gap);
        const ty = colTop + row * (th + gap);
        if (i === backIdx) this.drawMiniTileBack(ctx, tx, ty, tw, th);
        else {
          this.drawMiniTile(ctx, tx, ty, tw, th, tile);
          if (markTile && tile === markTile) this.drawTileMark(ctx, tx, ty, tw, th);
        }
      });
    };
    drawCol(this.discards.left, x + 10 * k, false, this.listenDiscard.left, 'left');
    drawCol(this.discards.right, x + w - 10 * k - tw, true, this.listenDiscard.right, 'right');

    // 底部牌河：按屏宽换行（首行贴底，放不下时向上续行），保持出牌顺序
    const bottomList = this.discards.me;
    const perRow = Math.max(1, Math.floor((w - 12 * k) / (tw + gap)));
    const rowCount = Math.ceil(bottomList.length / perRow);
    for (let r = 0; r < rowCount; r++) {
      const start = r * perRow;
      const cnt = Math.min(perRow, bottomList.length - start);
      const rowW = cnt * (tw + gap) - gap;
      const rowX = W / 2 - rowW / 2;
      const rowY = bottom - 16 * k - th - r * (th + gap);
      for (let i = start; i < start + cnt; i++) {
        if (latest && latest.seat === 'me' && latest.idx === i) continue;
        const tx = rowX + (i - start) * (tw + gap);
        if (i === this.listenDiscard.me) this.drawMiniTileBack(ctx, tx, rowY, tw, th);
        else {
          this.drawMiniTile(ctx, tx, rowY, tw, th, bottomList[i]);
          if (markTile && bottomList[i] === markTile) this.drawTileMark(ctx, tx, rowY, tw, th);
        }
      }
    }

    // 中上区域：最新打出的牌放大展示（下家出牌后替换，旧牌回到对应牌河）
    if (latest) {
      const bw = 30 * k;
      const bh = 41 * k;
      const bcx = W / 2;
      const bcy = top + 28 * k + bh / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = 12 * k;
      ctx.shadowOffsetY = 3 * k;
      if (latest.faceDown) {
        this.drawMiniTileBack(ctx, bcx - bw / 2, bcy - bh / 2, bw, bh);
      } else {
        drawTileBody(ctx, bcx, bcy, bw, bh, { glow: true });
        drawTileFace(ctx, bcx, bcy, bw, bh, latest.tile, { glow: true });
        if (markTile && latest.tile === markTile) {
          this.drawTileMark(ctx, bcx - bw / 2, bcy - bh / 2, bw, bh);
        }
      }
      ctx.restore();
      ctx.font = `500 ${Math.round(9 * k)}px ${SANS}`;
      ctx.fillStyle = 'rgba(232,195,122,.85)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${this.seatName(latest.seat)} 打出`, bcx, bcy + bh / 2 + 13 * k);
    }

    // 中央罗盘
    const cx = W / 2;
    const cy = top + h / 2;
    const cr = 28 * k;
    const cg = ctx.createRadialGradient(cx, cy - cr * 0.4, cr * 0.2, cx, cy, cr);
    cg.addColorStop(0, 'rgba(232,195,122,.20)');
    cg.addColorStop(1, 'rgba(232,195,122,.03)');
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `700 ${Math.round(23 * k)}px ${SERIF}`;
    ctx.fillStyle = 'rgba(232,195,122,.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('东', cx, cy + 1 * k);

    ctx.font = `${Math.round(9 * k)}px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`壁牌 ${this.match.wall}`, cx, cy + cr + 16 * k);

    // 庄家（无宝牌）
    if (this.dealer) {
      ctx.font = `${Math.round(9 * k)}px ${SANS}`;
      ctx.fillStyle = 'rgba(232,195,122,.72)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`庄 · ${this.seatName(this.dealer)}`, cx, cy + cr + 32 * k);
    }
  }

  /**
   * 牌局中央倒计时：出牌 / 碰杠决策
   * 环 + 秒数；剩余 ≤ 警告时长（3s）时变红并脉冲
   */
  drawTurnTimer(ctx, L) {
    const { k } = this;
    const rem = this.timerRemain();
    if (rem == null) return;
    const W = this.vw;
    const H = this.vh;
    let top;
    let bottom;
    if (this.landscape && L.pond) {
      top = L.pond.top;
      bottom = L.pond.bottom;
    } else {
      top = L.oppY + 92 * k;
      bottom = H - 206 * k;
    }
    const cx = W / 2;
    const cy = top + (bottom - top) / 2;
    const r = 28 * k;
    const t = this.timer;
    const ratio = Math.max(0, Math.min(1, rem / (t.total || 15_000)));
    const isWarn = rem <= (t.warn || 3_000);
    const sec = Math.max(0, Math.ceil(rem / 1000));
    const color = isWarn ? '#f0715c' : GOLD;

    ctx.save();
    // 底圆（遮住中央罗盘文字）
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5,22,17,.94)';
    ctx.fill();

    // 进度轨道
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2 * k, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232,195,122,.16)';
    ctx.lineWidth = 3 * k;
    ctx.stroke();

    // 剩余进度（12 点起顺时针收缩）
    if (ratio > 0.001) {
      ctx.beginPath();
      ctx.arc(cx, cy, r - 2 * k, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 * k;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // 警告：外圈红色呼吸光
    if (isWarn) {
      const glow = 0.45 + 0.35 * Math.abs(Math.sin(Date.now() / 220));
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(240,113,92,${glow.toFixed(2)})`;
      ctx.lineWidth = 1.6 * k;
      ctx.stroke();
    }

    // 标签 + 秒数
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(8.5 * k)}px ${SANS}`;
    ctx.fillStyle = isWarn ? 'rgba(240,160,140,.95)' : 'rgba(232,195,122,.8)';
    ctx.fillText(t.kind === 'offer' ? '决策' : '出牌', cx, cy - 9 * k);

    // 警告时数字轻微脉冲
    const pulse = isWarn ? 1 + 0.07 * Math.sin(Date.now() / 110) : 1;
    ctx.save();
    ctx.translate(cx, cy + 7 * k);
    ctx.scale(pulse, pulse);
    ctx.font = `700 ${Math.round(20 * k)}px ${SANS}`;
    ctx.fillStyle = color;
    ctx.fillText(String(sec), 0, 0);
    ctx.restore();

    ctx.restore();
  }

  // 小号牌（牌河），简化为无阴影牌身
  drawMiniTile(ctx, x, y, w, h, tile) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#fffdf6');
    g.addColorStop(0.7, '#f3ead6');
    g.addColorStop(1, '#e4d9bc');
    roundRect(ctx, x, y, w, h, w * 0.16);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(95,80,45,.32)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    drawTileFace(ctx, x + w / 2, y + h / 2, w, h, tile);
  }

  /** 牌河同款牌高亮：金色描边 + 柔光 */
  drawTileMark(ctx, x, y, w, h) {
    const k = this.k;
    ctx.save();
    ctx.shadowColor = 'rgba(232,195,122,.85)';
    ctx.shadowBlur = 7 * k;
    roundRect(ctx, x - 1.4 * k, y - 1.4 * k, w + 2.8 * k, h + 2.8 * k, w * 0.2);
    ctx.strokeStyle = '#f4d79a';
    ctx.lineWidth = 1.6 * k;
    ctx.stroke();
    ctx.restore();
  }

  /** 牌河扣牌（报听扣牌背面朝上） */
  drawMiniTileBack(ctx, x, y, w, h) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#3d6b58');
    g.addColorStop(1, '#1d3f33');
    roundRect(ctx, x, y, w, h, w * 0.16);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.5)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    // 中央小菱形标记
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, w * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(232,195,122,.55)';
    ctx.fill();
  }

  // 两家手牌（牌背两列）
  drawOpponentBacks(ctx, L) {
    const { k } = this;
    const W = this.vw;
    const bw = 15 * k;
    const bh = 20 * k;
    const step = 8.5 * k;
    // 竖屏：紧贴座位下方；横屏：贴屏幕左右边缘、位于头像下方
    const top = this.landscape ? L.oppY + 58 * k : L.oppY + 108 * k;
    const bx = this.landscape ? 8 * k : 10 * k;

    const col = (cx, n) => {
      const hasDrawn = n % 3 === 2; // 13/10/7… 为待出牌状态，末张抬升
      for (let i = 0; i < n; i++) {
        const picked = hasDrawn && i === n - 1;
        drawTileBack(ctx, cx, top + bh / 2 + i * step, bw, bh, { picked });
      }
    };
    // 联机：按服务器手牌数量绘制；单机演示固定 13 张
    col(bx + bw / 2, this.net ? this.handCounts.left || 0 : 13);
    col(W - bx - bw / 2, this.net ? this.handCounts.right || 0 : 13);
  }

  drawTopBar(ctx, L) {
    const { k } = this;
    const W = this.vw;
    const cy = L.topY + L.barH / 2;

    // 圈巡徽章：第一圈第N巡（N = 本圈第几位坐庄；联机用服务器下发的圈巡名）
    const text = this.roundText || lapName(this.rotations || 0);
    ctx.font = `500 ${Math.round(11 * k)}px ${SANS}`;
    const badgeW = ctx.measureText(text).width + 22 * k;
    roundRect(ctx, 16 * k, L.topY, badgeW, L.barH, 8 * k);
    const bg = ctx.createLinearGradient(0, L.topY, 0, L.topY + L.barH);
    bg.addColorStop(0, 'rgba(232,195,122,.22)');
    bg.addColorStop(1, 'rgba(232,195,122,.06)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#f0e2c2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 16 * k + badgeW / 2, cy + 0.5 * k);

    // 壁牌
    const wallX = 16 * k + badgeW + 10 * k;
    ctx.font = `500 ${Math.round(10.5 * k)}px ${SANS}`;
    const wallText = String(this.match.wall);
    const wallW = ctx.measureText(wallText).width + 46 * k;
    roundRect(ctx, wallX, L.topY, wallW, L.barH, L.barH / 2);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.09)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 小牌图标
    roundRect(ctx, wallX + 10 * k, cy - 7 * k, 9 * k, 14 * k, 2 * k);
    const ig = ctx.createLinearGradient(0, cy - 7 * k, 0, cy + 7 * k);
    ig.addColorStop(0, '#2a7f63');
    ig.addColorStop(1, '#0e4433');
    ctx.fillStyle = ig;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.4)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(12.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#f4ecd8';
    ctx.fillText(wallText, wallX + 24 * k, cy + 0.5 * k);
    ctx.font = `${Math.round(9 * k)}px ${SANS}`;
    ctx.fillStyle = '#a9cfc1';
    ctx.fillText('张', wallX + 26 * k + ctx.measureText(wallText).width, cy + 1 * k);

    // 设置齿轮
    const gx = W - 16 * k - 15 * k;
    ctx.save();
    if (this.pressed === 'gear') ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(gx, cy, 15 * k, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = '#b6cec4';
    ctx.lineWidth = 1.6 * k;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(gx, cy, 3.2 * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.moveTo(gx + Math.cos(a) * 6.4 * k, cy + Math.sin(a) * 6.4 * k);
      ctx.lineTo(gx + Math.cos(a) * 9 * k, cy + Math.sin(a) * 9 * k);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawSeats(ctx, L) {
    const { k } = this;
    const W = this.vw;
    const left = this.seats.left;
    const right = this.seats.right;

    // 左家
    const lcx = L.lcx;
    drawAvatar(ctx, lcx, L.oppY + 22 * k, 22 * k, left.avatar, left.grad);
    this.drawSeatMeta(ctx, lcx, L.oppY + 56 * k, left.name, left.score);
    if (this.dealer === 'left') this.drawDealerBadge(ctx, lcx - 17 * k, L.oppY + 5 * k);
    if (this.listening.left) this.drawListenTag(ctx, lcx, L.oppY + 92 * k);

    // 右家
    const rcx = L.rcx;
    drawAvatar(ctx, rcx, L.oppY + 22 * k, 22 * k, right.avatar, right.grad);
    this.drawSeatMeta(ctx, rcx, L.oppY + 56 * k, right.name, right.score);
    if (this.listening.right) this.drawListenTag(ctx, rcx, L.oppY + 92 * k);
    if (this.dealer === 'right') this.drawDealerBadge(ctx, rcx - 17 * k, L.oppY + 5 * k);
  }

  /** 头像左上角「庄」角标 */
  drawDealerBadge(ctx, cx, cy) {
    const { k } = this;
    const r = 9 * k;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    g.addColorStop(0, '#f7e3b0');
    g.addColorStop(1, '#d3a859');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(6,33,25,.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `700 ${Math.round(9.5 * k)}px ${SERIF}`;
    ctx.fillStyle = '#3a2a0c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('庄', cx, cy + 0.5 * k);
    ctx.restore();
  }

  drawSeatMeta(ctx, cx, y, name, score) {
    const { k } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${Math.round(11.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#f0f5f2';
    ctx.fillText(name, cx, y);
    ctx.font = `${Math.round(10 * k)}px ${SANS}`;
    ctx.fillStyle = score < 0 ? '#f0a08a' : GOLD;
    ctx.fillText(String(score), cx, y + 15 * k);
  }

  drawListenTag(ctx, cx, cy) {
    const { k } = this;
    ctx.font = `500 ${Math.round(9 * k)}px ${SANS}`;
    const w = ctx.measureText('听牌').width + 12 * k;
    roundRect(ctx, cx - w / 2, cy - 8 * k, w, 16 * k, 5 * k);
    const g = ctx.createLinearGradient(0, cy - 8 * k, 0, cy + 8 * k);
    g.addColorStop(0, '#7ee2b8');
    g.addColorStop(1, '#3fbd8b');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = '#0a2a1e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('听牌', cx, cy + 0.5 * k);
  }

  drawActions(ctx, L) {
    const { k } = this;
    const acts = [
      { id: 'hu', text: '胡', gold: true },
      { id: 'gang', text: '杠' },
      { id: 'peng', text: '碰' },
      { id: 'listen', text: this.listenPick ? '取消' : '听' },
      { id: 'pass', text: '过', ghost: true },
    ];
    acts.forEach((a, i) => {
      // 联机：仅展示当前可执行动作（询问优先，其次自摸胡/杠/听）
      if (this.net) {
        const avail = this.myActions();
        if (!avail || !avail.includes(a.id)) return;
      }
      const x = L.actsX + i * (L.actW + L.actGap);
      const y = L.actY;
      const r = L.actW / 2;
      const cx = x + r;
      const cy = y + r;
      const pressed = this.pressed === `act:${a.id}`;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (a.gold) {
        const g = ctx.createLinearGradient(0, y, 0, y + L.actW);
        g.addColorStop(0, '#f6e0ac');
        g.addColorStop(0.55, '#dcb267');
        g.addColorStop(1, '#c2924a');
        ctx.fillStyle = g;
        ctx.shadowColor = 'rgba(232,195,122,.8)';
        ctx.shadowBlur = 14 * k;
        ctx.shadowOffsetY = 4 * k;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = 'rgba(255,240,200,.6)';
      } else if (a.ghost) {
        ctx.fillStyle = pressed ? 'rgba(0,0,0,.4)' : 'rgba(0,0,0,.25)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.14)';
      } else {
        const g = ctx.createLinearGradient(0, y, 0, y + L.actW);
        g.addColorStop(0, 'rgba(255,255,255,.14)');
        g.addColorStop(1, 'rgba(255,255,255,.05)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.16)';
      }
      if (!a.gold) {
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();

      ctx.font = a.ghost ? `500 ${Math.round(13 * k)}px ${SANS}` : `700 ${Math.round(16 * k)}px ${SERIF}`;
      ctx.fillStyle = a.gold ? '#3a2a0c' : a.ghost ? '#9fb8ae' : '#dceae3';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.text, cx, cy + 1 * k);
    });
  }

  drawHand(ctx, L) {
    const { k } = this;
    // 报听选牌模式：可扣的牌高亮，不可扣的牌置灰
    const pickSet = this.listenPick
      ? new Set(listenCandidates(this.hand).map((c) => c.tile))
      : null;
    this.hand.forEach((tile, i) => {
      const item = L.items.find((it) => it.id === `hand:${i}`);
      if (!item) return;
      // 摸牌标记按下标定位：只标在刚摸的那一张上（同牌不重复标记）
      const isDrawn = i === this.drawnIndex();
      const isCand = !!pickSet && pickSet.has(tile);
      const cx = item.x + item.w / 2;
      const raised = this.selected === i ? 8 * k : isDrawn ? 5 * k : isCand ? 3 * k : 0;
      const cy = L.handCy - raised;
      const glow = this.selected === i || isDrawn || isCand;

      ctx.globalAlpha = pickSet ? (isCand ? 1 : 0.32) : 1;
      drawTileBody(ctx, cx, cy, L.handW, L.handH, { glow });
      drawTileFace(ctx, cx, cy, L.handW, L.handH, tile, { glow });
      ctx.globalAlpha = 1;

      if (pickSet && isCand) {
        // 可扣标记（金点）
        ctx.beginPath();
        ctx.arc(cx, cy + L.handH / 2 + 5 * k, 2.2 * k, 0, Math.PI * 2);
        ctx.fillStyle = GOLD;
        ctx.fill();
      }
      if (isDrawn) {
        ctx.font = `${Math.round(8 * k)}px ${SANS}`;
        ctx.fillStyle = GOLD;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('摸', cx, cy - L.handH / 2 - 4 * k);
      }
    });
  }

  /** 某张牌的可见剩余张数：4 - 自己手牌 - 三家牌河 - 三家副露（他家暗杠不可见不计） */
  remainCount(tile) {
    let used = this.hand.filter((t) => t === tile).length;
    for (const seat of ['me', 'left', 'right']) {
      for (const m of this.melds[seat] || []) {
        if (m.tile !== tile) continue;
        if (m.concealed && seat !== 'me') continue;
        used += m.type === 'peng' ? 3 : 4;
      }
      used += (this.discards[seat] || []).filter((t) => t === tile).length;
    }
    return Math.max(0, 4 - used);
  }

  /** 待展示的胡口：报听选牌模式选中某张牌 → 该牌听口；已报听 → 全部听口 */
  previewWaits() {
    if (this.listenPick) {
      if (this.selected < 0) return null;
      const tile = this.hand[this.selected];
      if (!tile) return null;
      const cand = listenCandidates(this.hand).find((c) => c.tile === tile);
      return cand ? cand.waits : null;
    }
    if (this.listening.me) return this.listenWaits.me || [];
    return null;
  }

  /** 手牌上方：胡口牌面 + 剩余张数（如「3万 剩2张」），多听口自动换行自适应 */
  drawListenHints(ctx, L) {
    const waits = this.previewWaits();
    if (!waits || !waits.length) return;
    const { k } = this;
    const W = this.vw;
    const items = waits.map((t) => ({ tile: t, left: this.remainCount(t) }));

    const labelFont = `500 ${Math.round(8.5 * k)}px ${SANS}`;
    const titleFont = `600 ${Math.round(8.5 * k)}px ${SANS}`;
    ctx.font = labelFont;
    const maxLabelW = Math.max(...items.map((it) => ctx.measureText(it.left > 0 ? `剩${it.left}张` : '绝张').width));
    const tw = 20 * k;
    const th = 26 * k;
    const unitGap = 7 * k;
    const unitW = tw + 4 * k + maxLabelW;
    const rowH = th + 4 * k;

    const pad = 9 * k;
    ctx.font = titleFont;
    const titleW = ctx.measureText('听').width;
    const titleGap = 6 * k;

    // 行容量与行数（听口多时自动换行，如十三幺 13 面听）
    const maxW = W - 24 * k;
    const avail = maxW - pad * 2 - titleW - titleGap;
    const perRow = Math.max(1, Math.floor((avail + unitGap) / (unitW + unitGap)));
    const rows = Math.ceil(items.length / perRow);
    const rowGap = 2 * k;
    const contentH = rows * rowH + (rows - 1) * rowGap;
    let widest = 0;
    for (let r = 0; r < rows; r++) {
      const cnt = Math.min(perRow, items.length - r * perRow);
      widest = Math.max(widest, cnt * unitW + (cnt - 1) * unitGap);
    }
    const bandW = pad * 2 + titleW + titleGap + widest;
    const bandH = contentH + 8 * k;

    // 整体缩放兜底：宽度不超屏、高度不过分侵占牌河
    const maxH = 56 * k;
    const scale = Math.min(1, maxW / bandW, maxH / bandH);

    const bandX = W / 2;
    const bandY = L.handCy - L.handH / 2 - 8 * k - bandH * scale;

    ctx.save();
    ctx.translate(bandX, bandY + (bandH * scale) / 2);
    ctx.scale(scale, scale);

    // 背景条（宽度按内容自适应）
    roundRect(ctx, -bandW / 2, -bandH / 2, bandW, bandH, Math.min(bandH / 2, 14 * k));
    ctx.fillStyle = 'rgba(3,14,10,.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.30)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 「听」标题：垂直居中于内容区左侧
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = titleFont;
    ctx.fillStyle = 'rgba(232,195,122,.9)';
    const x0 = -bandW / 2 + pad;
    ctx.fillText('听', x0, 0);
    const cx0 = x0 + titleW + titleGap;

    for (let r = 0; r < rows; r++) {
      const start = r * perRow;
      const cnt = Math.min(perRow, items.length - start);
      const rowY = -contentH / 2 + rowH / 2 + r * (rowH + rowGap);
      let x = cx0;
      for (let i = start; i < start + cnt; i++) {
        const it = items[i];
        ctx.globalAlpha = it.left > 0 ? 1 : 0.38;
        this.drawMiniTile(ctx, x, rowY - th / 2, tw, th, it.tile);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
        ctx.font = labelFont;
        if (it.left > 0) {
          ctx.fillStyle = '#cfe0d7';
          ctx.fillText(`剩${it.left}张`, x + tw + 4 * k, rowY + 0.5 * k);
        } else {
          ctx.fillStyle = '#f0a08a';
          ctx.fillText('绝张', x + tw + 4 * k, rowY + 0.5 * k);
        }
        x += unitW + unitGap;
      }
    }
    ctx.restore();
  }

  drawMeBar(ctx, L) {
    const { k } = this;
    const W = this.vw;
    const H = this.vh;
    const me = this.seats.me;
    const top = H - SAFE_BOTTOM - 56 * k;

    const g = ctx.createLinearGradient(0, top - 10 * k, 0, H);
    g.addColorStop(0, 'rgba(4,18,13,0)');
    g.addColorStop(1, 'rgba(4,18,13,.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, top - 10 * k, W, H - top + 10 * k);

    const cy = top + 26 * k;
    drawAvatar(ctx, 34 * k, cy, 16 * k, me.avatar, me.grad, { isMe: true });
    if (this.dealer === 'me') this.drawDealerBadge(ctx, 34 * k - 13 * k, cy - 13 * k);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${Math.round(11.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#f0f5f2';
    ctx.fillText(me.name, 56 * k, cy - 2 * k);
    ctx.font = `${Math.round(10 * k)}px ${SANS}`;
    ctx.fillStyle = me.score < 0 ? '#f0a08a' : GOLD;
    ctx.fillText(String(me.score), 56 * k, cy + 12 * k);

    // 右侧提示：联机显示当前回合/可执行动作
    let chips;
    if (this.net) {
      chips = [];
      if (this.settleInfo) {
        chips.push({ text: '本局结束', gold: true });
      } else if (this.listenPick) {
        chips.push({ text: '双击或拖动要扣的牌', gold: true });
      } else if (this.listening.me) {
        const waits = (this.listenWaits.me || []).map(tileCn).join(' / ');
        chips.push({ text: waits ? `已听 ${waits}` : '已听牌', gold: true });
      } else if (this.offer) {
        const label = { hu: '胡', peng: '碰', gang: '杠' };
        const acts = this.offer.actions.map((a) => label[a] || a).join(' / ');
        chips.push({ text: `可 ${acts}`, gold: true });
      } else if (this.phase === 'deal') {
        chips.push({ text: '发牌中', gold: false });
      } else if (this.myTurnNow()) {
        chips.push({ text: '轮到你出牌', gold: true });
      } else if (this.turnSeat) {
        chips.push({ text: `等 ${this.seatName(this.turnSeat)} 出牌`, gold: false });
      }
    } else {
      chips = [
        { text: '缺 条', gold: false },
        { text: '听 · 五筒', gold: true },
      ];
    }
    let x = W - 18 * k;
    for (let i = chips.length - 1; i >= 0; i--) {
      const c = chips[i];
      ctx.font = `500 ${Math.round(9.5 * k)}px ${SANS}`;
      const cw = ctx.measureText(c.text).width + 16 * k;
      x -= cw;
      roundRect(ctx, x, cy - 9 * k, cw, 18 * k, 7 * k);
      if (c.gold) {
        ctx.fillStyle = 'rgba(232,195,122,.1)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(232,195,122,.35)';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
      }
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = c.gold ? GOLD : '#c7dbd2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.text, x + cw / 2, cy + 0.5 * k);
      ctx.textAlign = 'left';
      x -= 6 * k;
    }
  }

  /* ---------- 掷骰定庄面板 ---------- */

  drawDealerPanel(ctx) {
    const { k } = this;
    const W = this.vw;
    const H = this.vh;

    // 遮罩（仍可透视牌桌）
    ctx.fillStyle = 'rgba(3,14,10,.62)';
    ctx.fillRect(0, 0, W, H);

    const pw = 300 * k;
    const rowH = 54 * k;
    const ph = 96 * k + rowH * 3 + 70 * k;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2 - 16 * k;

    const bg = ctx.createLinearGradient(px, py, px + pw, py + ph);
    bg.addColorStop(0, 'rgba(20,58,45,.99)');
    bg.addColorStop(1, 'rgba(7,28,21,.99)');
    roundRect(ctx, px, py, pw, ph, 20 * k);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 标题
    spacedText(ctx, '定 庄', W / 2, py + 40 * k, {
      font: `700 ${Math.round(18 * k)}px ${SERIF}`,
      fill: '#f2d79b',
      spacing: 5 * k,
    });
    ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#8fb0a3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('三人各掷两骰 · 点数合计最大者为庄', W / 2, py + 64 * k);

    // 分隔线
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath();
    ctx.moveTo(px + 18 * k, py + 78 * k);
    ctx.lineTo(px + pw - 18 * k, py + 78 * k);
    ctx.stroke();

    // 三家点数
    SEAT_CLOCKWISE.forEach((seat, i) => {
      const rowY = py + 96 * k + i * rowH;
      const rowCy = rowY + rowH / 2 - 6 * k;
      const seatData = this.seats[seat];
      const isDealer = this.dealer === seat;
      const isTie = this.tieSeats.indexOf(seat) >= 0;
      const isOut = (this.outSeats || []).indexOf(seat) >= 0; // 平局重掷时已退出庄家选择

      // 行高亮
      if (isDealer || isTie) {
        roundRect(ctx, px + 14 * k, rowY + 2 * k, pw - 28 * k, rowH - 8 * k, 12 * k);
        ctx.fillStyle = isDealer ? 'rgba(232,195,122,.12)' : 'rgba(255,120,120,.10)';
        ctx.fill();
        ctx.strokeStyle = isDealer ? 'rgba(232,195,122,.45)' : 'rgba(255,120,120,.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      drawAvatar(ctx, px + 34 * k, rowCy, 15 * k, seatData.avatar, seatData.grad);
      if (isDealer) this.drawDealerBadge(ctx, px + 34 * k - 12 * k, rowCy - 12 * k);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(11.5 * k)}px ${SANS}`;
      ctx.fillStyle = isDealer ? '#f7e7c4' : '#e6f0ea';
      ctx.fillText(seatData.name, px + 56 * k, rowCy - 7 * k);
      ctx.font = `${Math.round(9 * k)}px ${SANS}`;
      ctx.fillStyle = isDealer ? GOLD : '#7fa094';
      ctx.fillText(
        isDealer ? '庄家' : isTie ? '并列 · 需重掷' : isOut ? '退出庄家选择' : '闲家',
        px + 56 * k,
        rowCy + 9 * k
      );

      // 两颗骰子
      const dieSize = 26 * k;
      const d1 = this.diceView(seat, 0);
      const d2 = this.diceView(seat, 1);
      this.drawDie(ctx, px + pw - 98 * k, rowCy, dieSize, d1);
      this.drawDie(ctx, px + pw - 64 * k, rowCy, dieSize, d2);

      // 合计
      const total = this.rollLocked[seat] ? diceTotal(this.rolls[seat]) : d1 + d2;
      ctx.textAlign = 'right';
      ctx.font = `700 ${Math.round(18 * k)}px ${SERIF}`;
      ctx.fillStyle = isDealer ? '#f2d79b' : isTie ? '#ffb3b3' : '#dceae3';
      ctx.fillText(String(total), px + pw - 18 * k, rowCy + 1 * k);
    });

    // 按钮
    const btnW = pw - 40 * k;
    const btnH = 44 * k;
    const btnX = px + 20 * k;
    const btnY = py + ph - 58 * k;
    this.diceBtn = { x: btnX, y: btnY, w: btnW, h: btnH };

    const ready = this.diceDone;
    const tie = this.tieSeats.length > 0;
    const label = !ready
      ? '掷 骰 中…'
      : tie
        ? '平局 · 并列者重掷'
        : this.dealer
          ? `${this.seatName(this.dealer)} 坐庄 · 即将开始`
          : '开 始 对 局';

    roundRect(ctx, btnX, btnY, btnW, btnH, 14 * k);
    if (ready) {
      const g = ctx.createLinearGradient(0, btnY, 0, btnY + btnH);
      g.addColorStop(0, '#f6e0ac');
      g.addColorStop(0.55, '#e4be79');
      g.addColorStop(1, '#d3a859');
      ctx.fillStyle = g;
      ctx.fill();
      if (this.pressed === 'dice:btn') {
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(14 * k)}px ${SANS}`;
    ctx.fillStyle = ready ? '#3a2a0c' : '#7f9a90';
    ctx.fillText(label, btnX + btnW / 2, btnY + btnH / 2 + 1 * k);
  }

  /** 骰子（白底黑点） */
  drawDie(ctx, cx, cy, size, value) {
    const x = cx - size / 2;
    const y = cy - size / 2;
    const r = Math.min(size * 0.22, 7);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.4)';
    ctx.shadowBlur = size * 0.2;
    ctx.shadowOffsetY = size * 0.06;
    roundRect(ctx, x, y, size, size, r);
    const g = ctx.createLinearGradient(0, y, 0, y + size);
    g.addColorStop(0, '#fffdf7');
    g.addColorStop(1, '#e8dfc9');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    roundRect(ctx, x, y, size, size, r);
    ctx.strokeStyle = 'rgba(95,80,45,.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    const dotR = size * 0.082;
    const d = size * 0.28;
    const layouts = {
      1: [[0, 0]],
      2: [[-1, -1], [1, 1]],
      3: [[-1, -1], [0, 0], [1, 1]],
      4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
      5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
      6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
    };
    ctx.fillStyle = '#1f3d33';
    (layouts[value] || layouts[1]).forEach(([gx, gy]) => {
      ctx.beginPath();
      ctx.arc(cx + gx * d, cy + gy * d, dotR, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /* ---------- 对局菜单 ---------- */

  /** 副露展示：碰 3 张横排；杠 3 张横排 + 第 4 张叠在中间那张上方（暗杠底下三张为背面） */
  drawMelds(ctx, L) {
    const { k } = this;
    const tw = 13 * k;
    const th = 17 * k;
    const gap = 1 * k;

    const group = (list, x, y, align = 'left') => {
      // 每组固定 3 列宽（杠第 4 张向上叠放）
      const width = list.length * (3 * tw + 2 * gap) + Math.max(0, list.length - 1) * 4 * k;
      let cx = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
      for (const m of list) {
        const concealedGang = m.type === 'gang' && m.concealed; // 暗杠：底下三张背面
        for (let i = 0; i < 3; i++) {
          const tx = cx + i * (tw + gap);
          if (concealedGang) this.drawMiniTileBack(ctx, tx, y, tw, th);
          else this.drawMiniTile(ctx, tx, y, tw, th, m.tile);
        }
        if (m.type !== 'peng') {
          // 明杠/补杠/暗杠：第 4 张正面叠在中间那张上方
          this.drawMiniTile(ctx, cx + tw + gap, y - th * 0.55, tw, th, m.tile);
        }
        cx += 3 * (tw + 2 * gap) + 4 * k;
      }
    };

    // 左右两家：名牌下方、牌背列上方
    if (this.melds.left && this.melds.left.length) {
      group(this.melds.left, L.lcx, L.oppY + 70 * k, 'center');
    }
    if (this.melds.right && this.melds.right.length) {
      group(this.melds.right, L.rcx, L.oppY + 70 * k, 'center');
    }
    // 自己：手牌左上
    if (this.melds.me && this.melds.me.length) {
      group(this.melds.me, 16 * k, L.handTop - 20 * k, 'left');
    }
  }

  /** 拖动中的手牌跟随手指 */
  drawDragGhost(ctx, L) {
    if (!this.drag || !this.drag.moved) return;
    const tile = this.hand[this.drag.i];
    if (!tile) return;
    const w = L.handW * 1.08;
    const h = L.handH * 1.08;
    ctx.save();
    ctx.globalAlpha = 0.92;
    drawTileBody(ctx, this.drag.x, this.drag.y - 6 * this.k, w, h, { glow: true });
    drawTileFace(ctx, this.drag.x, this.drag.y - 6 * this.k, w, h, tile, { glow: true });
    ctx.restore();
  }

  /** 本局结算：胡牌走「对局详情」页，流局保留轻量卡片 */
  drawSettleOverlay(ctx) {
    const { k } = this;
    const W = this.vw;
    const H = this.vh;
    const s = this.settleInfo;
    if (s && s.winnerSeat) return this.drawHuDetail(ctx);

    ctx.fillStyle = 'rgba(3,14,10,.72)';
    ctx.fillRect(0, 0, W, H);

    const pw = Math.min(310 * k, W - 36 * k);
    const anyHands = s.hands && SEAT_CLOCKWISE.some((l) => (s.hands[this.serverSeat(l)] || []).length);
    const handsZoneH = anyHands ? 3 * (15 * k * 1.4 * 1.55 + 6 * k) + 8 * k : 0;
    const ph = 286 * k + (s.detail ? 48 * k : 0) + handsZoneH;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;
    roundRect(ctx, px, py, pw, ph, 18 * k);
    const g = ctx.createLinearGradient(0, py, 0, py + ph);
    g.addColorStop(0, 'rgba(30,84,66,.96)');
    g.addColorStop(1, 'rgba(8,38,29,.98)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const cx = px + pw / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题
    const title = s.winnerSeat ? s.handName || '胡牌' : '流 局';
    ctx.font = `700 ${Math.round(22 * k)}px ${SERIF}`;
    ctx.fillStyle = GOLD;
    ctx.fillText(title, cx, py + 36 * k);

    // 局名 + 赢家
    const who = s.winnerSeat ? `${this.seatName(this.localSeat(s.winnerSeat))} 胡牌` : '无人胡牌';
    ctx.font = `500 ${Math.round(11 * k)}px ${SANS}`;
    ctx.fillStyle = '#c7dbd2';
    ctx.fillText(`${s.roundName || ''} · ${who}`, cx, py + 62 * k);

    // 番型
    if (s.fans && s.fans.length) {
      const fanText = s.fans.map((f) => `${f.name || f.label}${f.value ? ` ${f.value}` : ''}`).join(' · ');
      ctx.font = `${Math.round(10.5 * k)}px ${SANS}`;
      ctx.fillStyle = '#9fc4b6';
      ctx.fillText(fanText, cx, py + 84 * k);
    }

    // 三家点数（本局 + 累计 + 计算式）
    const delta = s.delta || {};
    const cum = s.points || null;
    const lightDetail = s.detail || {};
    let y = py + 116 * k;
    SEAT_CLOCKWISE.forEach((local) => {
      const server = this.serverSeat(local);
      const d = delta[server] || 0;
      const formula = lightDetail[server] || '';
      let txt = d > 0 ? `+${d}` : String(d);
      if (cum) {
        const c = cum[server] || 0;
        txt += `  累计 ${c > 0 ? '+' : ''}${c}`;
      }
      const nameY = formula ? y - 8 * k : y;
      ctx.font = `500 ${Math.round(11 * k)}px ${SANS}`;
      ctx.fillStyle = '#dceae3';
      ctx.textAlign = 'left';
      const name = this.seatName(local);
      ctx.fillText(name, px + 44 * k, nameY);
      // 庄家标签
      if (server === s.dealerSeat) {
        const nw = ctx.measureText(name).width;
        const bx = px + 44 * k + nw + 8 * k;
        ctx.beginPath();
        ctx.arc(bx + 8 * k, nameY, 8 * k, 0, Math.PI * 2);
        ctx.fillStyle = '#d9ae62';
        ctx.fill();
        ctx.fillStyle = '#3a2a0c';
        ctx.font = `700 ${Math.round(8.5 * k)}px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText('庄', bx + 8 * k, nameY + 0.5 * k);
        ctx.textAlign = 'left';
      }
      if (formula) {
        ctx.font = `${Math.round(8.5 * k)}px ${SANS}`;
        ctx.fillStyle = '#8fae9f';
        ctx.fillText(formula, px + 44 * k, y + 12 * k);
      }
      ctx.textAlign = 'right';
      ctx.font = `500 ${Math.round(11 * k)}px ${SANS}`;
      ctx.fillStyle = d > 0 ? '#7ee2b8' : d < 0 ? '#f0a08a' : '#8fae9f';
      ctx.fillText(txt, px + pw - 44 * k, nameY);
      y += formula ? 40 * k : 24 * k;
    });

    // 三家亮牌（流局也亮牌；碰/杠副露在前，杠第 4 张叠中间上方）
    if (anyHands) {
      let hy = y + 8 * k;
      for (const local of SEAT_CLOCKWISE) {
        const server = this.serverSeat(local);
        const tiles = s.hands[server] || [];
        const rowMelds = (s.melds && s.melds[server]) || [];
        if (!tiles.length) continue;
        const meldGap = 4 * k;
        const totalCols = tiles.length + rowMelds.length * 3;
        const tw = Math.min(
          15 * k,
          (pw - 74 * k - 48 * k - 2 * k * (totalCols - 1) - meldGap * Math.max(0, rowMelds.length - 1)) / totalCols,
        );
        const th = tw * 1.4;
        ctx.font = `500 ${Math.round(9.5 * k)}px ${SANS}`;
        ctx.fillStyle = '#c7dbd2';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.seatName(local), px + 24 * k, hy + th / 2);
        let x0 = px + 74 * k;
        for (const m of rowMelds) {
          const concealedGang = m.type === 'gang' && m.concealed;
          for (let i = 0; i < 3; i++) {
            const mx = x0 + i * (tw + 2 * k);
            if (concealedGang) this.drawMiniTileBack(ctx, mx, hy, tw, th);
            else this.drawMiniTile(ctx, mx, hy, tw, th, m.tile);
          }
          if (m.type !== 'peng') {
            this.drawMiniTile(ctx, x0 + tw + 2 * k, hy - th * 0.55, tw, th, m.tile);
          }
          x0 += 3 * (tw + 2 * k) + meldGap;
        }
        tiles.forEach((tile, i) => {
          const cx = x0 + i * (tw + 2 * k) + tw / 2;
          this.drawMiniTile(ctx, cx - tw / 2, hy, tw, th, tile);
        });
        hy += th * (rowMelds.some((m) => m.type !== 'peng') ? 1.55 : 1) + 6 * k;
      }
    }

    // 按钮
    const bw = pw - 80 * k;
    const bh = 40 * k;
    this.settleBtn = { x: cx - bw / 2, y: py + ph - bh - 24 * k, w: bw, h: bh };
    roundRect(ctx, this.settleBtn.x, this.settleBtn.y, bw, bh, bh / 2);
    const bg = ctx.createLinearGradient(0, this.settleBtn.y, 0, this.settleBtn.y + bh);
    bg.addColorStop(0, '#f6e0ac');
    bg.addColorStop(1, '#c2924a');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.font = `700 ${Math.round(14 * k)}px ${SANS}`;
    ctx.fillStyle = '#3a2a0c';
    ctx.textAlign = 'center';
    ctx.fillText(
      this.settleReady ? '已准 备' : this.canNext ? '准  备' : '返回房间',
      cx,
      this.settleBtn.y + bh / 2
    );
    if (this.settleReady) {
      ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillText('等待其他玩家准备', cx, this.settleBtn.y - 10 * k);
    }
  }

  /**
   * 胡牌后的「对局详情」页（沿用历史详情页版式）：
   * 胶囊（自摸/点炮/放炮…）+ 牌型标题 + 胡牌牌面 + 计分明细 + 三家点数，
   * 底部固定「准备」按钮（全员准备后开始下一局）
   */
  drawHuDetail(ctx) {
    const { k } = this;
    const W = this.vw;
    const H = this.vh;
    const s = this.settleInfo;

    // 与历史「对局详情」同款绿金渐变背景
    const bg = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.9);
    bg.addColorStop(0, '#2a6b4f');
    bg.addColorStop(0.42, '#0d3a2b');
    bg.addColorStop(0.78, '#061a14');
    bg.addColorStop(1, '#04110d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, 56 * k, 0, W / 2, 56 * k, 170 * k);
    glow.addColorStop(0, 'rgba(232,195,122,.20)');
    glow.addColorStop(0.62, 'rgba(232,195,122,.05)');
    glow.addColorStop(1, 'rgba(232,195,122,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // 顶部标题
    spacedText(ctx, '对 局 详 情', W / 2, 26 * k, {
      font: `600 ${Math.round(13 * k)}px ${SANS}`,
      fill: '#f1f7f3',
      spacing: 2.6 * k,
    });

    const isMeWinner = s.winnerSeat && this.localSeat(s.winnerSeat) === 'me';
    const winTag = s.zimo
      ? isMeWinner ? '自 摸' : '被 自 摸'
      : s.robGang
        ? isMeWinner ? '抢 杠 胡' : '被 抢 杠'
        : isMeWinner ? '点 炮 胡' : '放 炮';
    const title = s.handName || '胡牌';
    const winnerName = this.seatName(this.localSeat(s.winnerSeat));
    const sub = `${s.roundName || this.roundText || lapName(this.rotations || 0)} · ${winnerName} 胡牌 · 壁牌 ${this.match.wall} 张`;

    // 底部准备按钮
    const btnW = Math.min(W - 32 * k, 360 * k);
    const btnH = 46 * k;
    const btnX = (W - btnW) / 2;
    const btnY = H - SAFE_BOTTOM - 14 * k - btnH;
    this.settleBtn = { x: btnX, y: btnY, w: btnW, h: btnH };

    const cardW = Math.min(W - 32 * k, 360 * k);
    const cardX = (W - cardW) / 2;
    const innerX = cardX + 12 * k;
    const innerW = cardW - 24 * k;
    const hands = s.hands || {};
    const winLocal = s.winnerSeat ? this.localSeat(s.winnerSeat) : null;
    // 亮牌顺序：胡牌者最上层，其余按座位顺序
    const showSeats = SEAT_CLOCKWISE.slice().sort((a, b) => (a === winLocal ? -1 : b === winLocal ? 1 : 0));
    const fans = s.fans || [];
    const gap = 3 * k;
    const detail = s.detail || {};
    const deltaMap = s.delta || {};
    const hasDetail = SEAT_CLOCKWISE.some((l) => detail[this.serverSeat(l)]);

    // 垂直空间自适应（小屏时压缩行距）
    const topY = 44 * k;
    const avail = btnY - 14 * k - topY;
    const headH = 92 * k;
    // 每人一张卡：上方牌面、下方点数计算
    const tileMaxW = 24 * k;
    const nameRowH = 13 * k;
    const deltaZoneH = hasDetail ? 30 * k : 22 * k; // 卡内点数区（计算式 + 分数）
    const perCardH = 10 * k + nameRowH + 5 * k + tileMaxW * 1.4 * 1.55 + 8 * k + deltaZoneH + 8 * k;
    // 牌面 + 点数合并到同一张卡（胡牌者置顶）
    const rowsAll = showSeats
      .map((local) => ({
        local,
        server: this.serverSeat(local),
        tiles: hands[this.serverSeat(local)] || [],
        melds: (s.melds && s.melds[this.serverSeat(local)]) || [],
        delta: deltaMap[this.serverSeat(local)] || 0,
        formula: detail[this.serverSeat(local)] || '',
      }))
      .filter((r) => r.tiles.length);
    const showHands = rowsAll;
    const cardsH = showHands.length ? showHands.length * perCardH + (showHands.length - 1) * 6 * k : 0;
    const fansH = fans.length ? 12 * k + fans.length * 24 * k + 10 * k + 26 * k : 0;
    const gapY = 10 * k;
    const need = headH + cardsH + fansH + (cardsH ? gapY : 0) + (fansH ? gapY : 0) + gapY;
    const f = Math.min(1, avail / need);
    const tileScale = Math.max(0.68, f); // 小屏压缩牌面

    let y = topY;

    // 头部：胶囊 + 标题 + 副标题
    const pillH = 22 * k * f;
    ctx.font = `600 ${Math.round(11 * k)}px ${SANS}`;
    const pillTextW = ctx.measureText(winTag).width;
    const pillW = pillTextW + 26 * k;
    const pg = ctx.createLinearGradient(0, y, 0, y + pillH);
    pg.addColorStop(0, '#f6e0ac');
    pg.addColorStop(1, '#d9ae62');
    ctx.save();
    ctx.shadowColor = 'rgba(232,195,122,.8)';
    ctx.shadowBlur = 16 * k;
    ctx.shadowOffsetY = 5 * k;
    roundRect(ctx, W / 2 - pillW / 2, y, pillW, pillH, pillH / 2);
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.restore();
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(11 * k)}px ${SANS}`;
    ctx.fillStyle = '#3a2a0c';
    ctx.textAlign = 'center';
    ctx.fillText(winTag, W / 2, y + pillH / 2 + 0.5 * k);
    y += pillH + 14 * k * f;

    const titleFont = `700 ${Math.round(25 * k)}px ${SANS}`;
    const tg = ctx.createLinearGradient(0, y, 0, y + 26 * k);
    tg.addColorStop(0, '#fffaea');
    tg.addColorStop(0.6, '#eed3a0');
    tg.addColorStop(1, '#cda45c');
    spacedText(ctx, title, W / 2, y + 24 * k, {
      font: titleFont,
      fill: tg,
      spacing: 3.6 * k,
    });
    y += 30 * k * f + 6 * k * f;
    ctx.font = `${Math.round(10 * k)}px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(sub, W / 2, y + 11 * k);
    y += 18 * k * f;

    // 三家亮牌卡：胡牌者最上层（金边 + 「胡」标），其余按座位顺序
    if (showHands.length) {
      let hy = y;
      for (const row of showHands) {
        const { local, server, tiles, melds: rowMelds, delta: rowDelta, formula } = row;
        const isWinRow = local === winLocal;
        // 总列数 = 手牌张数 + 副露组数×3（杠第 4 张向上叠放），组间额外留 4k
        const totalCols = tiles.length + rowMelds.length * 3;
        const tileW =
          Math.min(
            tileMaxW,
            (innerW - gap * (totalCols - 1) - 4 * k * Math.max(0, rowMelds.length - 1)) / totalCols,
          ) * tileScale;
        const tileH = tileW * 1.4;
        const stackH = rowMelds.some((m) => m.type !== 'peng') ? tileH * 0.55 : 0;
        // 卡高：名字行 + 牌面行（含杠叠放）+ 点数计算区
        const rowCardH = 10 * k + nameRowH + 5 * k + stackH + tileH + 8 * k + deltaZoneH + 8 * k;

        roundRect(ctx, cardX, hy, cardW, rowCardH, 14 * k);
        if (isWinRow) {
          const hg = ctx.createLinearGradient(cardX, hy, cardX + cardW, hy + rowCardH);
          hg.addColorStop(0, 'rgba(232,195,122,.20)');
          hg.addColorStop(1, 'rgba(232,195,122,.05)');
          ctx.fillStyle = hg;
          ctx.fill();
          ctx.strokeStyle = 'rgba(232,195,122,.55)';
        } else {
          ctx.fillStyle = 'rgba(255,255,255,.05)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,.09)';
        }
        ctx.lineWidth = 1;
        ctx.stroke();

        // 名字行：头像 + 名字 + 胡标 / 庄标
        const nameCy = hy + 10 * k + nameRowH / 2;
        const seatInfo = this.seats[local] || {};
        drawAvatar(ctx, cardX + 22 * k, nameCy, 8.5 * k, seatInfo.avatar || '我', seatInfo.grad, {
          isMe: local === 'me',
        });
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `500 ${Math.round(11 * k)}px ${SANS}`;
        ctx.fillStyle = isWinRow ? '#f4e2bb' : '#c7dbd2';
        const name = this.seatName(local);
        ctx.fillText(name, cardX + 38 * k, nameCy + 0.5 * k);
        let tagX = cardX + 38 * k + ctx.measureText(name).width + 7 * k;
        if (isWinRow) {
          ctx.beginPath();
          ctx.arc(tagX + 7.5 * k, nameCy, 7.5 * k, 0, Math.PI * 2);
          ctx.fillStyle = '#d9ae62';
          ctx.fill();
          ctx.fillStyle = '#3a2a0c';
          ctx.font = `700 ${Math.round(8 * k)}px ${SANS}`;
          ctx.textAlign = 'center';
          ctx.fillText('胡', tagX + 7.5 * k, nameCy + 0.5 * k);
          tagX += 18 * k;
          ctx.textAlign = 'left';
        }
        if (server === s.dealerSeat) {
          ctx.beginPath();
          ctx.arc(tagX + 7.5 * k, nameCy, 7.5 * k, 0, Math.PI * 2);
          ctx.fillStyle = '#d9ae62';
          ctx.fill();
          ctx.fillStyle = '#3a2a0c';
          ctx.font = `700 ${Math.round(8 * k)}px ${SANS}`;
          ctx.textAlign = 'center';
          ctx.fillText('庄', tagX + 7.5 * k, nameCy + 0.5 * k);
        }

        // 牌面行：副露（碰/杠）在前，手牌在后（胡牌者胡的那张高亮）
        const tilesTop = hy + 10 * k + nameRowH + 5 * k + stackH;
        let tx = cardX + 12 * k;
        for (const m of rowMelds) {
          const concealedGang = m.type === 'gang' && m.concealed;
          for (let i = 0; i < 3; i++) {
            const mx = tx + i * (tileW + gap);
            if (concealedGang) this.drawMiniTileBack(ctx, mx, tilesTop, tileW, tileH);
            else {
              drawTileBody(ctx, mx + tileW / 2, tilesTop + tileH / 2, tileW, tileH, {});
              drawTileFace(ctx, mx + tileW / 2, tilesTop + tileH / 2, tileW, tileH, m.tile, {});
            }
          }
          if (m.type !== 'peng') {
            // 杠：第 4 张正面叠在中间那张上方
            const sx = tx + tileW + gap;
            drawTileBody(ctx, sx + tileW / 2, tilesTop - tileH * 0.55 + tileH / 2, tileW, tileH, { glow: true });
            drawTileFace(ctx, sx + tileW / 2, tilesTop - tileH * 0.55 + tileH / 2, tileW, tileH, m.tile, {});
          }
          tx += 3 * (tileW + gap) + 4 * k;
        }
        const winIdx = isWinRow && s.winTile ? tiles.lastIndexOf(s.winTile) : -1;
        tiles.forEach((tile, i) => {
          const cx = tx + i * (tileW + gap) + tileW / 2;
          const cy = tilesTop + tileH / 2;
          const isWin = i === winIdx;
          drawTileBody(ctx, cx, cy, tileW, tileH, { glow: isWin });
          drawTileFace(ctx, cx, cy, tileW, tileH, tile, { picked: isWin });
          if (isWin) drawWinBadge(ctx, cx + tileW / 2, cy - tileH / 2, 5.5 * k);
        });

        // 下方：点数计算（左）与本局得分（右）
        const lineY = tilesTop + tileH + 5 * k;
        ctx.save();
        ctx.setLineDash([4 * k, 4 * k]);
        ctx.strokeStyle = 'rgba(255,255,255,.10)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cardX + 12 * k, lineY);
        ctx.lineTo(cardX + cardW - 12 * k, lineY);
        ctx.stroke();
        ctx.restore();

        const scoreCy = lineY + 4 * k + deltaZoneH / 2;
        const scoreText = rowDelta > 0 ? `+${rowDelta}` : String(rowDelta);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = `600 ${Math.round(15 * k)}px ${SANS}`;
        ctx.fillStyle = rowDelta > 0 ? GOLD : '#8fb0a2';
        ctx.fillText(scoreText, cardX + cardW - 14 * k, scoreCy);
        const scoreW = ctx.measureText(scoreText).width;

        if (formula) {
          // 计算式：字号自适应缩小，超宽截断
          const maxW = innerW - scoreW - 18 * k;
          let fs = 9;
          let fText = formula;
          ctx.font = `${Math.round(fs * k)}px ${SANS}`;
          while (ctx.measureText(fText).width > maxW && fs > 7) {
            fs -= 1;
            ctx.font = `${Math.round(fs * k)}px ${SANS}`;
          }
          while (fText.length > 1 && ctx.measureText(`${fText}…`).width > maxW) fText = fText.slice(0, -1);
          if (fText !== formula && fText.length > 1) fText = `${fText}…`;
          ctx.textAlign = 'left';
          ctx.font = `${Math.round(fs * k)}px ${SANS}`;
          ctx.fillStyle = '#9fc4b6';
          ctx.fillText(fText, cardX + 14 * k, scoreCy);
        }
        hy += rowCardH + 6 * k;
      }
      y = hy + gapY * f;
    }

    // 计分明细卡
    if (fans.length) {
      roundRect(ctx, cardX, y, cardW, fansH, 14 * k);
      ctx.fillStyle = 'rgba(0,0,0,.24)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.lineWidth = 1;
      ctx.stroke();

      let cy = y + 10 * k;
      ctx.textBaseline = 'alphabetic';
      fans.forEach((fan) => {
        ctx.textAlign = 'left';
        ctx.font = `${Math.round(11.5 * k)}px ${SANS}`;
        ctx.fillStyle = '#cfe0d7';
        ctx.fillText(fan.label || fan.name || '', innerX, cy + 14 * k);
        ctx.textAlign = 'right';
        ctx.font = `${Math.round(11.5 * k)}px ${SANS}`;
        ctx.fillStyle = GOLD;
        ctx.fillText(String(fan.value || ''), innerX + innerW, cy + 14 * k);
        cy += 24 * k;
      });

      ctx.save();
      ctx.setLineDash([4 * k, 4 * k]);
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.beginPath();
      ctx.moveTo(innerX, cy + 4 * k);
      ctx.lineTo(innerX + innerW, cy + 4 * k);
      ctx.stroke();
      ctx.restore();

      ctx.textAlign = 'left';
      ctx.font = `${Math.round(10.5 * k)}px ${SANS}`;
      ctx.fillStyle = '#8fae9f';
      ctx.fillText('合 计', innerX, cy + 24 * k);
      ctx.textAlign = 'right';
      ctx.font = `600 ${Math.round(20 * k)}px ${SERIF}`;
      ctx.fillStyle = '#f4e2bb';
      ctx.fillText(`${s.fanTotal || 0} 番`, innerX + innerW, cy + 27 * k);
      y += fansH + gapY * f;
    }

    // 准备按钮
    roundRect(ctx, btnX, btnY, btnW, btnH, btnH / 2);
    if (this.settleReady) {
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      const bgg = ctx.createLinearGradient(0, btnY, 0, btnY + btnH);
      bgg.addColorStop(0, '#f6e0ac');
      bgg.addColorStop(1, '#c2924a');
      ctx.fillStyle = bgg;
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(14 * k)}px ${SANS}`;
    ctx.fillStyle = this.settleReady ? '#a9c6ba' : '#3a2a0c';
    const btnText = this.settleReady
      ? '已准备 · 等待其他玩家'
      : this.canNext
        ? '准  备'
        : '等待结算';
    ctx.fillText(btnText, btnX + btnW / 2, btnY + btnH / 2);
  }

  drawMenu(ctx) {
    const { k } = this;
    const W = this.vw;
    const H = this.vh;

    ctx.fillStyle = 'rgba(3,14,10,.6)';
    ctx.fillRect(0, 0, W, H);

    const pw = 300 * k;
    const ph = 372 * k;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2 - 10 * k;

    const bg = ctx.createLinearGradient(px, py, px + pw, py + ph);
    bg.addColorStop(0, 'rgba(20,58,45,.99)');
    bg.addColorStop(1, 'rgba(7,28,21,.99)');
    roundRect(ctx, px, py, pw, ph, 20 * k);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.32)';
    ctx.lineWidth = 1;
    ctx.stroke();

    spacedText(ctx, '对 局 菜 单', W / 2, py + 36 * k, {
      font: `700 ${Math.round(15 * k)}px ${SANS}`,
      fill: '#f1f7f3',
      spacing: 3 * k,
    });

    ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#8fb0a3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(
      `${this.roundText || lapName(this.rotations || 0)} · 庄家 ${this.dealer ? this.seatName(this.dealer) : '待定'}`,
      W / 2,
      py + 58 * k
    );

    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath();
    ctx.moveTo(px + 18 * k, py + 72 * k);
    ctx.lineTo(px + pw - 18 * k, py + 72 * k);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = `${Math.round(9 * k)}px ${SANS}`;
    ctx.fillStyle = '#7fa094';
    ctx.fillText('模拟本局结果（演示）', px + 20 * k, py + 94 * k);

    this.menuItems = [];
    const rowW = pw - 40 * k;
    const rowH = 46 * k;
    const gap = 8 * k;

    SEAT_CLOCKWISE.forEach((seat, i) => {
      const y = py + 104 * k + i * (rowH + gap);
      const name = this.seatName(seat);
      const next = nextDealer(this.dealer, seat);
      const lianzhuang = next === this.dealer;

      ctx.beginPath();
      ctx.moveTo(px + 20 * k, y);
      ctx.lineTo(px + pw - 20 * k, y);
      ctx.stroke();

      roundRect(ctx, px + 20 * k, y + 2 * k, rowW, rowH - 4 * k, 12 * k);
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(12 * k)}px ${SANS}`;
      ctx.fillStyle = '#e6f0ea';
      ctx.fillText(`${name} 胡牌`, px + 34 * k, y + rowH / 2);

      ctx.textAlign = 'right';
      ctx.font = `${Math.round(9 * k)}px ${SANS}`;
      ctx.fillStyle = lianzhuang ? GREEN : GOLD;
      ctx.fillText(lianzhuang ? '连庄' : `庄家转 ${this.seatName(next)}`, px + pw - 34 * k, y + rowH / 2);

      this.menuItems.push({ id: `menu:win:${seat}`, x: px + 20 * k, y: y + 2 * k, w: rowW, h: rowH - 4 * k });
    });

    // 继续 / 退出
    const btnW = rowW;
    const btnH = 40 * k;
    const resumeY = py + ph - 102 * k;
    roundRect(ctx, px + 20 * k, resumeY, btnW, btnH, 12 * k);
    ctx.fillStyle = 'rgba(232,195,122,.14)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(12.5 * k)}px ${SANS}`;
    ctx.fillStyle = GOLD;
    ctx.fillText('继续对局', px + 20 * k + btnW / 2, resumeY + btnH / 2);
    this.menuItems.push({ id: 'menu:resume', x: px + 20 * k, y: resumeY, w: btnW, h: btnH });

    const exitY = resumeY + btnH + 10 * k;
    roundRect(ctx, px + 20 * k, exitY, btnW, btnH, 12 * k);
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `${Math.round(12 * k)}px ${SANS}`;
    ctx.fillStyle = '#9fb8ae';
    ctx.fillText('退出对局', px + 20 * k + btnW / 2, exitY + btnH / 2);
    this.menuItems.push({ id: 'menu:exit', x: px + 20 * k, y: exitY, w: btnW, h: btnH });
  }
}
