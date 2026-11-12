export const SEAT_CLOCKWISE = ['me', 'left', 'right'];

export function nextSeat(seat) {
  const i = SEAT_CLOCKWISE.indexOf(seat);
  if (i < 0) return 'me';
  return SEAT_CLOCKWISE[(i + 1) % SEAT_CLOCKWISE.length];
}

export function rollDice() {
  return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
}

export function rollAll() {
  return { me: rollDice(), left: rollDice(), right: rollDice() };
}

export function diceTotal(pair) {
  return (pair && pair[0] ? pair[0] : 0) + (pair && pair[1] ? pair[1] : 0);
}

export function roundName(no) {
  const winds = ['东', '南', '西', '北'];
  const w = winds[Math.floor(no / 4) % 4];
  return `${w}${['一', '二', '三', '四'][no % 4]}局`;
}

/**
 * 圈巡命名：第X圈第Y巡
 * rotations = 整场累计「下庄」次数（庄家轮转一次 +1）；
 * 每圈 3 巡（三人各坐庄一次），连庄不出巡（一圈局数无上限）。
 */
export function lapName(rotations = 0) {
  const lap = Math.floor(rotations / 3) + 1;
  const xun = (rotations % 3) + 1;
  const cn = ['一', '二', '三', '四', '五', '六', '七', '八'][Math.min(lap, 8) - 1];
  return `第${cn}圈第${xun}巡`;
}
