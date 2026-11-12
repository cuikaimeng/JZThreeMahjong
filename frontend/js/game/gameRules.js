/**
 * 三人麻将 · 牌局规则（定庄 / 轮庄）
 *
 * 座位 key：'me'（自己，屏幕下方）/ 'left'（左家）/ 'right'（右家）
 * 顺时针顺序（视觉）：下方 → 左侧 → 右侧 → 下方
 */
export const SEAT_CLOCKWISE = ['me', 'left', 'right'];

/** 顺时针下一位 */
export function nextSeat(seat) {
  const i = SEAT_CLOCKWISE.indexOf(seat);
  if (i < 0) return 'me';
  return SEAT_CLOCKWISE[(i + 1) % SEAT_CLOCKWISE.length];
}

/** 掷两颗骰子，返回 [a, b] */
export function rollDice() {
  return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
}

/** 三家各掷一次 */
export function rollAll() {
  return { me: rollDice(), left: rollDice(), right: rollDice() };
}

export function diceTotal(pair) {
  return (pair && pair[0] ? pair[0] : 0) + (pair && pair[1] ? pair[1] : 0);
}

/**
 * 比点定庄：点数相加后比较，最大者为庄
 * @param {object} rolls 各座位骰子点数
 * @param {string[]} [seats] 参与比较的座位（平局重掷后仅并列者，其余已退出庄家选择）
 * 返回 { dealer: seat|null, tie: seat[] }（并列最大时 dealer 为 null，需并列者重掷）
 */
export function determineDealer(rolls, seats) {
  const pool = Array.isArray(seats) && seats.length ? seats : SEAT_CLOCKWISE;
  const entries = pool.map((seat) => ({ seat, total: diceTotal(rolls[seat]) }));
  const max = Math.max(...entries.map((e) => e.total));
  const winners = entries.filter((e) => e.total === max);
  if (winners.length > 1) return { dealer: null, tie: winners.map((w) => w.seat) };
  return { dealer: winners[0].seat, tie: [] };
}

/**
 * 下一局庄家
 * - 庄家赢（连庄）：庄家不变
 * - 其他人赢：庄家顺时针由下一位继承
 */
export function nextDealer(dealer, winner) {
  if (!dealer) return winner || 'me';
  if (!winner || winner === dealer) return dealer;
  return nextSeat(dealer);
}

/** 局名：东一局…东四局 → 南一局…（保留兼容） */
export function roundName(no) {
  const winds = ['东', '南', '西', '北'];
  const w = winds[Math.floor(no / 4) % 4];
  return `${w}${['一', '二', '三', '四'][no % 4]}局`;
}

/**
 * 圈巡名：第X圈第Y巡
 * rotations = 累计下庄次数；每圈 3 巡（三人各坐庄一次），连庄不出巡。
 */
export function lapName(rotations = 0) {
  const lap = Math.floor(rotations / 3) + 1;
  const xun = (rotations % 3) + 1;
  const cn = ['一', '二', '三', '四', '五', '六', '七', '八'][Math.min(lap, 8) - 1];
  return `第${cn}圈第${xun}巡`;
}
