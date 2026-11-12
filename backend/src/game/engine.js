/**
 * 三人麻将 · 牌与判定引擎
 *
 * 牌 ID 与前端一致：
 *   '1m'~'9m' 万 / '1p'~'9p' 筒(饼) / '1s'~'9s' 条 / 'E','S','W','N','C','F','P' 字牌
 * 三人麻将牌墙：万筒条各 36 张 + 字牌 28 张 = 136 张；留 7 垛（14 张）壁牌
 *
 * 公平性：每张牌有唯一编号（id 0-135）；牌库顺序在对局开始前一次性洗定并生成
 * 指纹（wallCommit），此后不可变；所有发牌/摸牌都严格按牌库顺序取牌。
 */

import { createHash } from 'node:crypto';

export const SUITS = ['m', 'p', 's'];
export const HONORS = ['E', 'S', 'W', 'N', 'C', 'F', 'P'];
export const WALL_KEEP = 14; // 壁牌 7 垛

/** 构建 136 张牌墙并洗牌 */
export function buildWall() {
  const wall = [];
  for (const s of SUITS) {
    for (let n = 1; n <= 9; n++) for (let i = 0; i < 4; i++) wall.push(n + s);
  }
  for (const h of HONORS) for (let i = 0; i < 4; i++) wall.push(h);
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

/**
 * 构建牌库（公平发牌用）：
 *   136 张牌各自持有唯一编号 id（0-135，编号在洗牌前固定 = 牌的物理身份）
 *   → 开局前一次性洗牌定序，此后顺序不可变
 * @returns {Array<{t:string, id:number}>}
 */
export function buildDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (let n = 1; n <= 9; n++) for (let i = 0; i < 4; i++) deck.push({ t: n + s, id: deck.length });
  }
  for (const h of HONORS) for (let i = 0; i < 4; i++) deck.push({ t: h, id: deck.length });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** 普通摸牌/发牌：严格按牌库顺序取牌；只剩壁牌（WALL_KEEP）时返回 null → 流局 */
export function drawLiveTile(deck) {
  return deck.length > WALL_KEEP ? deck.pop() : null;
}

/** 杠牌补摸：固定从牌库最后一张获取（壁牌区也参与，杠完即流局） */
export function drawGangTile(deck) {
  return deck.length ? deck.pop() : null;
}

/** 牌库定序指纹（SHA-256）：对局开始前生成并广播，用于公平性核验 */
export function deckFingerprint(deck) {
  return createHash('sha256').update(deck.map((d) => `${d.id}:${d.t}`).join('|')).digest('hex');
}

/** 摸牌；牌墙触底（剩壁牌）返回 null → 流局（旧接口，纯字符串牌墙） */
export function drawTile(wall) {
  return wall.length > WALL_KEEP ? wall.pop() : null;
}

/** 手牌排序（万 → 筒 → 条 → 字） */
export function sortHand(hand) {
  const order = (t) => {
    const m = /^([1-9])([mps])$/.exec(t);
    if (m) return SUITS.indexOf(m[2]) * 9 + Number(m[1]);
    return 27 + HONORS.indexOf(t);
  };
  return hand.slice().sort((a, b) => order(a) - order(b));
}

/** 碰：手里有 ≥2 张同牌 */
export function canPeng(hand, tile) {
  return hand.filter((t) => t === tile).length >= 2;
}

/** 明杠：手里有 ≥3 张同牌 */
export function canGang(hand, tile) {
  return hand.filter((t) => t === tile).length >= 3;
}

/** 从手牌移除 n 张同牌（碰/杠用） */
export function removeFromHand(hand, tile, n) {
  let cnt = 0;
  return hand.filter((t) => (t === tile && cnt++ < n ? false : true));
}

/** 暗杠：手里有 4 张同牌 → 可杠的牌列表 */
export function canAngang(hand) {
  const cnt = count(hand);
  return [...cnt.entries()].filter(([, c]) => c === 4).map(([k]) => k);
}

/** 补杠：已有碰副露 + 手里 1 张同牌 → 可补杠的牌列表 */
export function canBugang(hand, melds) {
  return (melds || [])
    .filter((m) => m.type === 'peng' && hand.includes(m.tile))
    .map((m) => m.tile);
}

/**
 * 牌面点数（扣点麻将口径）：
 *   数字牌 = 面值（1m=1 点 … 9s=9 点）；字牌按 HONOR_POINT 计（视作高点牌 10 点）
 * 如需把字牌改为不计点，把 HONOR_POINT 改成 0 即可。
 */
export const HONOR_POINT = 10;
export function tilePoint(t) {
  const m = /^([1-9])([mps])$/.exec(t);
  return m ? Number(m[1]) : HONOR_POINT;
}

/** 报听门槛：报听扣牌点数 ≥3；听口中至少一张 ≥6（可被点炮） */
export const LISTEN_MIN_DISCARD_POINT = 3;
export const LISTEN_MIN_WIN_POINT = 6;

/**
 * 报听候选：可弃之报听的牌（按牌去重）
 *   ① 弃牌点数 ≥3
 *   ② 弃后成听牌
 *   ③ 听口中存在点数 ≥6 的牌（保证可被点炮，不能只靠自摸）
 * @returns {Array<{tile:string, waits:string[]}>}
 */
export function listenCandidates(hand) {
  if (hand.length % 3 !== 2) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < hand.length; i++) {
    const tile = hand[i];
    if (seen.has(tile)) continue;
    seen.add(tile);
    if (tilePoint(tile) < LISTEN_MIN_DISCARD_POINT) continue;
    const rest = hand.slice(0, i).concat(hand.slice(i + 1));
    // 十三幺形态限制：扣牌后手牌若全为幺九字（十三幺形态），
    // 必须同时持有 1万/1条/1饼（即听口只能落在 9m/9p/9s/字牌，点数 ≥9）
    if (
      rest.every((t) => ORPHANS.includes(t)) &&
      !(rest.includes('1m') && rest.includes('1p') && rest.includes('1s'))
    ) {
      continue;
    }
    const waits = listens(rest);
    if (!waits.length) continue;
    if (!waits.some((w) => tilePoint(w) >= LISTEN_MIN_WIN_POINT)) continue;
    out.push({ tile, waits });
  }
  return out;
}

/** 报听：是否存在合法扣牌（点数门槛 + 多点听） */
export function canDeclareListen(hand) {
  return listenCandidates(hand).length > 0;
}

/** 幺九字牌（十三幺用）：1/9 数牌 + 全部字牌 */
export const ORPHANS = ['1m', '9m', '1p', '9p', '1s', '9s', 'E', 'S', 'W', 'N', 'C', 'F', 'P'];

/** 十三幺：幺九字 13 种各 1 张 + 其中任意 1 张成对（14 张） */
export function isThirteenOrphans(tiles) {
  if (tiles.length !== 14) return false;
  const cnt = count(tiles);
  const keys = [...cnt.keys()];
  // 14 张、13 种、全部为幺九字 → 恰好 13 种幺九字各 1 张 + 1 对
  return keys.length === 13 && keys.every((k) => ORPHANS.includes(k));
}

/** 判定能否胡（手牌 3n+2 张）：十三幺 / 七小对（含豪七对）/ 标准牌型 */
export function canHu(tiles) {
  // 门清 14 张；有碰/杠副露时为 8/5/2 张（总牌数恒为 3n+2）
  if (tiles.length % 3 !== 2 || tiles.length < 2) return false;
  return isThirteenOrphans(tiles) || isSevenPairs(tiles) || isStandard(tiles);
}

function isSevenPairs(tiles) {
  // 七小对：14 张、每张恰 2 张；豪七对：允许 4 张相同（未起杠）充当两对
  if (tiles.length !== 14) return false;
  return [...count(tiles).values()].every((c) => c === 2 || c === 4);
}

function isStandard(tiles) {
  const cnt = count(tiles);
  // 找对子作雀头
  for (const [k, c] of cnt) {
    if (c >= 2) {
      cnt.set(k, c - 2);
      if (decompose(cnt)) return true;
      cnt.set(k, c);
    }
  }
  return false;
}

/** 递归拆解：全部组成顺子/刻子 */
function decompose(cnt) {
  // 取第一张牌
  const key = [...cnt.keys()].filter((k) => cnt.get(k) > 0).sort(byTile)[0];
  if (key === undefined) return true;
  const c = cnt.get(key);

  // 刻子
  if (c >= 3) {
    cnt.set(key, c - 3);
    if (decompose(cnt)) return true;
    cnt.set(key, c);
  }
  // 顺子（仅数字牌）：以当前牌为顺子起点（当前牌必为剩余最小）
  const m = /^([1-9])([mps])$/.exec(key);
  if (m) {
    const n = Number(m[1]);
    const suit = m[2];
    if (n <= 7) {
      const seq = [0, 1, 2].map((i) => `${n + i}${suit}`);
      if (seq.every((t) => (cnt.get(t) || 0) > 0)) {
        seq.forEach((t) => cnt.set(t, cnt.get(t) - 1));
        if (decompose(cnt)) return true;
        seq.forEach((t) => cnt.set(t, cnt.get(t) + 1));
      }
    }
  }
  return false;
}

function byTile(a, b) {
  const rank = (t) => {
    const m = /^([1-9])([mps])$/.exec(t);
    return m ? SUITS.indexOf(m[2]) * 10 + Number(m[1]) : 100 + HONORS.indexOf(t);
  };
  return rank(a) - rank(b);
}

export function count(tiles) {
  const cnt = new Map();
  for (const t of tiles) cnt.set(t, (cnt.get(t) || 0) + 1);
  return cnt;
}

/** 听牌：弃一张后听哪些（简单枚举 34 种） */
export function listens(tiles) {
  const res = [];
  for (let n = 1; n <= 9; n++) {
    for (const s of SUITS) {
      if (canHu([...tiles, `${n}${s}`])) res.push(`${n}${s}`);
    }
  }
  for (const h of HONORS) if (canHu([...tiles, h])) res.push(h);
  return res;
}
