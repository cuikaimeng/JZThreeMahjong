/**
 * 客户端牌型判定（与 backend/src/game/engine.js 同源）
 * 仅用于按钮可用性预判；最终裁决在服务器。
 *
 * 牌 ID：'1m'~'9m' / '1p'~'9p' / '1s'~'9s' / 'E','S','W','N','C','F','P'
 */

export const SUITS = ['m', 'p', 's'];
export const HONORS = ['E', 'S', 'W', 'N', 'C', 'F', 'P'];

export function count(tiles) {
  const cnt = new Map();
  for (const t of tiles) cnt.set(t, (cnt.get(t) || 0) + 1);
  return cnt;
}

/** 幺九字牌（十三幺用）：1/9 数牌 + 全部字牌 */
export const ORPHANS = ['1m', '9m', '1p', '9p', '1s', '9s', 'E', 'S', 'W', 'N', 'C', 'F', 'P'];

/** 十三幺：幺九字 13 种各 1 张 + 其中任意 1 张成对（14 张） */
export function isThirteenOrphans(tiles) {
  if (tiles.length !== 14) return false;
  const cnt = count(tiles);
  const keys = [...cnt.keys()];
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
  const key = [...cnt.keys()].filter((k) => cnt.get(k) > 0).sort(byTile)[0];
  if (key === undefined) return true;
  const c = cnt.get(key);

  // 刻子
  if (c >= 3) {
    cnt.set(key, c - 3);
    if (decompose(cnt)) return true;
    cnt.set(key, c);
  }
  // 顺子（仅数字牌）：以当前牌为顺子起点
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

/** 听牌：13/10 张 → 能胡的等待牌列表 */
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

/**
 * 牌面点数：数字牌 = 面值；字牌 = HONOR_POINT（与后端保持一致）
 */
export const HONOR_POINT = 10;
export function tilePoint(t) {
  const m = /^([1-9])([mps])$/.exec(t);
  return m ? Number(m[1]) : HONOR_POINT;
}

/** 报听门槛：扣牌 ≥3 点，听口至少一张 ≥6 点 */
export const LISTEN_MIN_DISCARD_POINT = 3;
export const LISTEN_MIN_WIN_POINT = 6;

/**
 * 报听候选（按牌去重）
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

/** 报听：是否存在合法扣牌 */
export function canDeclareListen(hand) {
  return listenCandidates(hand).length > 0;
}

/**
 * 自动理牌：万 → 饼 → 条 → 东 → 南 → 西 → 北 → 中 → 发 → 白
 * 万/饼/条内部按 1-9 升序（与服务器 sortHand 同序）
 */
export function sortHand(hand) {
  const rank = (t) => {
    const m = /^([1-9])([mps])$/.exec(t);
    if (m) return SUITS.indexOf(m[2]) * 9 + Number(m[1]);
    return 27 + HONORS.indexOf(t);
  };
  return hand.slice().sort((a, b) => rank(a) - rank(b));
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
