import { count, SUITS, ORPHANS, tilePoint } from './engine.js';

/**
 * 三人扣点麻将 · 计分
 *
 * 牌型倍数 k（多个特殊牌型并存取最高）：
 *   普通 1；七小对 / 一条龙 / 清一色 2；豪七对 / 十三幺 4
 * P = 胡牌张点数；B = 5 + P（庄家底 5 点）
 *
 * 胡牌结算：
 *   庄家胡   平胡(听牌者点炮) 两闲各 -kB，庄 +2kB
 *            点炮(未听者包赔) 点炮者 -2kB，庄 +2kB
 *            自摸             两闲各 -2kB，庄 +4kB
 *   非庄胡   平胡(听牌闲点炮) 庄 -kB，点炮闲 -kP，胡 +(kB+kP)
 *            自摸             庄 -2kB，另一闲 -2kP，胡 +(2kB+2kP)
 *            未听闲点炮       普通：点炮者 -2kP，胡 +2kP
 *                             特殊：点炮者包赔 -(kB+kP)
 *            庄家点炮         普通：庄 -2kB，胡 +2kB
 *                             特殊：庄包赔 -(kB+kP)
 * 杠即时结算（与胡牌无关，流局也算）：
 *   暗杠：另外两家各付 杠牌点数×2；补杠：另外两家各付 杠牌点数；
 *   点杠：点杠者付 杠牌点数×2，另一家无关
 * 流局：庄家 -10，两闲各 +5
 */

/** 特殊牌型番表（fan 即倍数） */
export const SPECIAL_HANDS = [
  { key: 'ssy', name: '十三幺', fan: 4, test: (ctx) => ctx.thirteenOrphans },
  { key: 'h7d', name: '豪七对', fan: 4, test: (ctx) => ctx.haoSevenPairs },
  { key: 'qys', name: '清一色', fan: 2, test: (ctx) => ctx.allOneSuit },
  { key: 'ytl', name: '一条龙', fan: 2, test: (ctx) => ctx.oneDragon },
  { key: '7d', name: '七小对', fan: 2, test: (ctx) => ctx.sevenPairs && !ctx.haoSevenPairs },
];

/** 评牌：返回 { fans:[{label,value}], multiplier, handName } */
export function evaluate({ hand14, melds = [], zimo }) {
  const cnt = count(hand14);
  // 副露计入花色/刻子判定（清一色、一条龙、对对胡允许副露；七对、十三幺必须门清）
  const meldCount = melds.length;
  const all = [...hand14];
  for (const m of melds) {
    const n = m.type === 'peng' ? 3 : 4; // 碰 3 张，杠/补杠/暗杠 4 张
    for (let i = 0; i < n; i++) all.push(m.tile);
  }
  const cntAll = count(all);
  const suits = new Set();
  const honors = [];
  for (const [k] of cntAll) {
    const m = /^([1-9])([mps])$/.exec(k);
    if (m) suits.add(m[2]);
    else honors.push(k);
  }
  const tri = [...cnt.values()].filter((c) => c === 3 || c === 4).length + meldCount;

  // 一条龙：全部牌（含副露）中存在同花色 1-9 齐全
  const oneDragon = SUITS.some((s) => {
    for (let n = 1; n <= 9; n++) if (!cntAll.has(`${n}${s}`)) return false;
    return true;
  });
  // 十三幺：14 张全为幺九字且 13 种齐全（门清）
  const thirteenOrphans =
    hand14.length === 14 && meldCount === 0 && [...cnt.keys()].every((k) => ORPHANS.includes(k)) && cnt.size === 13;
  // 七小对：每张恰 2 张；豪七对：存在 4 张相同（未起杠）充当两对（门清）
  const sevenPairs =
    hand14.length === 14 && meldCount === 0 && [...cnt.values()].every((c) => c === 2 || c === 4);
  const haoSevenPairs = sevenPairs && [...cnt.values()].some((c) => c === 4);

  const ctx = {
    // 清一色：全部为同一花色（条/万/饼）或全部为字牌（字一色）
    allOneSuit: (suits.size === 1 && honors.length === 0) || (suits.size === 0 && honors.length > 0),
    oneDragon,
    thirteenOrphans,
    sevenPairs,
    haoSevenPairs,
    allTriplets: tri >= 4,
  };

  // 命中的特殊牌型（可多个，展示全部；倍数取最高）
  const hits = SPECIAL_HANDS.filter((r) => r.test(ctx));
  const fans = hits.map((r) => ({ label: r.name, value: `${r.fan} 番` }));
  const multiplier = hits.length ? Math.max(...hits.map((r) => r.fan)) : 1;

  let handName = '平胡';
  if (ctx.thirteenOrphans) handName = '十三幺';
  else if (ctx.haoSevenPairs) handName = '豪七对';
  else if (ctx.allOneSuit) handName = '清一色';
  else if (ctx.oneDragon) handName = '一条龙';
  else if (ctx.sevenPairs) handName = '七小对';
  else if (ctx.allTriplets) handName = '对对胡';

  return { fans, multiplier, handName };
}

/** 分数计算式：庄家分量 =（胡牌点数P + 庄家点5）× 牌型k × 场景倍数 */
function dUnit(P, k, tag) {
  const head = `（胡牌点数${P} + 庄家点5）`;
  const parts = [];
  if (k > 1) parts.push(`牌型${k}`);
  if (tag) parts.push(tag);
  return parts.length ? `${head}× ${parts.join(' × ')}` : head;
}
/** 分数计算式：闲家分量 = 胡牌点数P × 牌型k × 场景倍数 */
function xUnit(P, k, tag) {
  const head = `胡牌点数${P}`;
  const parts = [];
  if (k > 1) parts.push(`牌型${k}`);
  if (tag) parts.push(tag);
  return parts.length ? `${head} × ${parts.join(' × ')}` : head;
}

/**
 * 胡牌结算。
 * 参数：multiplier 牌型倍数 k；winPoint 胡牌张点数 P；zimo 是否自摸；
 *      winnerSeat / loserSeat（点炮者）；loserListening 点炮者是否已报听；dealerSeat 庄家。
 * 返回 { delta, gain, detail }：gain = 胡牌者本局所得（不含杠分）；
 *      detail = 各座位分数计算式（0 分座位为空串）。
 */
export function settlePoints({ multiplier: k, winPoint: P, zimo, winnerSeat, loserSeat, loserListening, dealerSeat }) {
  const B = 5 + P;
  const delta = { me: 0, left: 0, right: 0 };
  const detail = { me: '', left: '', right: '' };
  const seats = ['me', 'left', 'right'];
  const others = seats.filter((s) => s !== winnerSeat);

  if (zimo) {
    if (winnerSeat === dealerSeat) {
      // 两闲各 -2kB，庄 +4kB
      const unit = dUnit(P, k, '自摸2');
      for (const s of others) {
        delta[s] -= 2 * k * B;
        detail[s] = unit;
      }
      delta[winnerSeat] += 4 * k * B;
      detail[winnerSeat] = `${unit} × 2家`;
    } else {
      // 庄 -2kB，另一闲 -2kP，胡 +(2kB+2kP)
      const other = others.find((s) => s !== dealerSeat);
      delta[dealerSeat] -= 2 * k * B;
      detail[dealerSeat] = dUnit(P, k, '自摸2');
      delta[other] -= 2 * k * P;
      detail[other] = xUnit(P, k, '自摸2');
      delta[winnerSeat] += 2 * k * B + 2 * k * P;
      detail[winnerSeat] = `${dUnit(P, k, '自摸2')} + ${xUnit(P, k, '自摸2')}`;
    }
    return { delta, gain: delta[winnerSeat], detail };
  }

  if (winnerSeat === dealerSeat) {
    if (loserListening) {
      // 平胡：两闲各 -kB，庄 +2kB
      const unit = dUnit(P, k, '平胡1');
      for (const s of others) {
        delta[s] -= k * B;
        detail[s] = unit;
      }
      delta[winnerSeat] += 2 * k * B;
      detail[winnerSeat] = `${unit} × 2家`;
    } else {
      // 未听者点炮包赔
      delta[loserSeat] -= 2 * k * B;
      detail[loserSeat] = dUnit(P, k, '点炮2');
      delta[winnerSeat] += 2 * k * B;
      detail[winnerSeat] = detail[loserSeat];
    }
    return { delta, gain: delta[winnerSeat], detail };
  }

  // 非庄家胡牌
  if (loserSeat === dealerSeat) {
    // 庄家点炮：普通付 2kB；特殊包赔全额 k(B+P)
    const pay = k === 1 ? 2 * k * B : k * B + k * P;
    delta[loserSeat] -= pay;
    delta[winnerSeat] += pay;
    detail[loserSeat] =
      k === 1 ? dUnit(P, k, '点炮2') : `${dUnit(P, k, '')} + ${xUnit(P, k, '')}`;
    detail[winnerSeat] = detail[loserSeat];
  } else if (loserListening) {
    // 平胡（听牌闲家点炮）：庄 -kB，点炮闲 -kP
    delta[dealerSeat] -= k * B;
    detail[dealerSeat] = dUnit(P, k, '平胡1');
    delta[loserSeat] -= k * P;
    detail[loserSeat] = xUnit(P, k, '平胡1');
    delta[winnerSeat] += k * B + k * P;
    detail[winnerSeat] = `${dUnit(P, k, '平胡1')} + ${xUnit(P, k, '平胡1')}`;
  } else {
    // 未听闲家点炮：普通付 2kP；特殊包赔全额 k(B+P)
    const pay = k === 1 ? 2 * k * P : k * B + k * P;
    delta[loserSeat] -= pay;
    delta[winnerSeat] += pay;
    detail[loserSeat] = k === 1 ? xUnit(P, k, '点炮2') : `${dUnit(P, k, '')} + ${xUnit(P, k, '')}`;
    detail[winnerSeat] = detail[loserSeat];
  }
  return { delta, gain: delta[winnerSeat], detail };
}

/** 流局结算：庄家 -10，两闲各 +5 */
export function drawPoints(dealerSeat) {
  const delta = { me: 0, left: 0, right: 0 };
  for (const s of ['me', 'left', 'right']) delta[s] = s === dealerSeat ? -10 : 5;
  return delta;
}

/**
 * 杠即时结算（type：angang 暗杠 / bugang 补杠 / diangang 点杠）。
 * 暗杠：另外两家各付 牌点×2；补杠：另外两家各付 牌点；点杠：点杠者付 牌点×2。
 * 返回 { delta, gain }。
 */
export function gangPoints({ type, tile, gangSeat, fromSeat }) {
  const p = tilePoint(tile);
  const delta = { me: 0, left: 0, right: 0 };
  let gain = 0;
  if (type === 'angang') {
    gain = 4 * p;
    for (const s of ['me', 'left', 'right']) if (s !== gangSeat) delta[s] -= 2 * p;
  } else if (type === 'bugang') {
    gain = 2 * p;
    for (const s of ['me', 'left', 'right']) if (s !== gangSeat) delta[s] -= p;
  } else {
    // 点杠：点杠者付 2×牌点，另一家无关
    gain = 2 * p;
    delta[fromSeat] -= 2 * p;
  }
  delta[gangSeat] += gain;
  return { delta, gain };
}
