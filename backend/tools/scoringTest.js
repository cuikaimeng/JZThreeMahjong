/**
 * 积分规则单测：牌型倍数 / 胡牌结算矩阵 / 杠即时结算 / 流局
 * 口径：k=牌型倍数（普通1/特殊2/豪·幺4，多牌型取最高）；P=胡牌张点数；B=5+P
 */
import { evaluate, settlePoints, drawPoints, gangPoints } from '../src/game/scoring.js';
import { Table } from '../src/game/table.js';

let passed = 0;
let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${detail ? ` · ${detail}` : ''}`);
  }
}
const eqDelta = (a, b) =>
  ['me', 'left', 'right'].every((s) => (a[s] || 0) === (b[s] || 0));

/* ============ 一、牌型倍数 ============ */
console.log('\n--- 牌型倍数（多牌型取最高） ---');
{
  const P = evaluate({ hand14: ['2m', '3m', '4m', '5m', '6m', '7m', '8m', '8m', '8m', '1p', '2p', '3p', '5s', '5s'], zimo: true });
  ok('平胡倍数 1', P.multiplier === 1 && P.handName === '平胡', JSON.stringify(P));
  const D7 = evaluate({ hand14: ['1p', '1p', '2p', '2p', '3p', '3p', '7s', '7s', '3m', '3m', '5m', '5m', 'N', 'N'], zimo: true });
  ok('七小对倍数 2', D7.multiplier === 2);
  const QY = evaluate({ hand14: ['1m', '1m', '2m', '2m', '3m', '3m', '4m', '4m', '5m', '5m', '6m', '6m', '7m', '7m'], zimo: true });
  ok('清一色倍数 2', QY.multiplier === 2 && QY.handName === '清一色');
  const YL = evaluate({ hand14: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1m', '2m', '3m', '9m', '9m'], zimo: true });
  ok('一条龙倍数 2（命名优先清一色）', YL.multiplier === 2 && YL.handName === '清一色');
  const H7 = evaluate({ hand14: ['1p', '1p', '2p', '2p', '3p', '3p', '7s', '7s', '3m', '3m', 'N', 'N', 'N', 'N'], zimo: true });
  ok('豪七对倍数 4', H7.multiplier === 4 && H7.handName === '豪七对');
  const SSY = evaluate({ hand14: ['1m', '9m', '1p', '9p', '1s', '9s', 'E', 'S', 'W', 'N', 'C', 'F', 'P', 'C'], zimo: true });
  ok('十三幺倍数 4', SSY.multiplier === 4);
  // 清一色 + 一条龙 → 取最高 2
  ok('清一色+一条龙 → 取最高 2', YL.fans.length === 2 && YL.multiplier === 2, JSON.stringify(YL.fans));
  // 豪七对 + 清一色（同花色七对含四张）→ 取最高 4
  const H7Q = evaluate({ hand14: ['1m', '1m', '1m', '1m', '2m', '2m', '3m', '3m', '4m', '4m', '5m', '5m', '6m', '6m'], zimo: true });
  ok('清一色豪七对 → 取最高 4', H7Q.multiplier === 4 && H7Q.handName === '豪七对', JSON.stringify(H7Q));
  // 副露清一色：碰 1m + 碰 9m，手 8 张全万
  const MQ = evaluate({
    hand14: ['2m', '3m', '4m', '5m', '6m', '7m', '8m', '8m'],
    melds: [{ type: 'peng', tile: '1m' }, { type: 'peng', tile: '9m' }],
    zimo: true,
  });
  ok('副露清一色倍数 2', MQ.multiplier === 2 && MQ.handName === '清一色', JSON.stringify(MQ));
  // 副露对对胡：碰 5s + 碰 N，手 8 张两刻一对
  const MD = evaluate({
    hand14: ['3p', '3p', '3p', '7p', '7p', '7p', 'F', 'F'],
    melds: [{ type: 'peng', tile: '5s' }, { type: 'peng', tile: 'N' }],
    zimo: false,
  });
  ok('副露对对胡倍数 1', MD.multiplier === 1 && MD.handName === '对对胡', JSON.stringify(MD));
  // 副露一条龙：碰 1m，手 8 张含 2-9m
  const ML = evaluate({
    hand14: ['2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m'],
    melds: [{ type: 'peng', tile: '1m' }],
    zimo: true,
  });
  ok('副露一条龙倍数 2（与清一色取最高）', ML.multiplier === 2 && ML.fans.length === 2 && ML.handName === '清一色', JSON.stringify(ML));
}

/* ============ 二、庄家胡牌结算 ============ */
console.log('\n--- 庄家胡（庄=me，P=5 → B=10） ---');
{
  let r = settlePoints({ multiplier: 1, winPoint: 5, zimo: true, winnerSeat: 'me', dealerSeat: 'me' });
  ok('庄普通自摸：两闲各-20，庄+40', eqDelta(r.delta, { me: 40, left: -20, right: -20 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 1, winPoint: 5, zimo: false, winnerSeat: 'me', loserSeat: 'left', loserListening: true, dealerSeat: 'me' });
  ok('庄普通平胡（听牌者点炮）：两闲各-10，庄+20', eqDelta(r.delta, { me: 20, left: -10, right: -10 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 1, winPoint: 5, zimo: false, winnerSeat: 'me', loserSeat: 'left', loserListening: false, dealerSeat: 'me' });
  ok('庄普通点炮（未听包赔）：点炮者-20，庄+20，另一家0', eqDelta(r.delta, { me: 20, left: -20, right: 0 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 2, winPoint: 5, zimo: true, winnerSeat: 'me', dealerSeat: 'me' });
  ok('庄特殊自摸：两闲各-40，庄+80', eqDelta(r.delta, { me: 80, left: -40, right: -40 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 2, winPoint: 5, zimo: false, winnerSeat: 'me', loserSeat: 'left', loserListening: true, dealerSeat: 'me' });
  ok('庄特殊平胡：两闲各-20，庄+40', eqDelta(r.delta, { me: 40, left: -20, right: -20 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 2, winPoint: 5, zimo: false, winnerSeat: 'me', loserSeat: 'left', loserListening: false, dealerSeat: 'me' });
  ok('庄特殊点炮：点炮者-40，庄+40', eqDelta(r.delta, { me: 40, left: -40, right: 0 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 4, winPoint: 9, zimo: true, winnerSeat: 'me', dealerSeat: 'me' });
  ok('庄豪·幺自摸：两闲各-112，庄+224', eqDelta(r.delta, { me: 224, left: -112, right: -112 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 4, winPoint: 9, zimo: false, winnerSeat: 'me', loserSeat: 'left', loserListening: true, dealerSeat: 'me' });
  ok('庄豪·幺平胡：两闲各-56，庄+112', eqDelta(r.delta, { me: 112, left: -56, right: -56 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 4, winPoint: 9, zimo: false, winnerSeat: 'me', loserSeat: 'left', loserListening: false, dealerSeat: 'me' });
  ok('庄豪·幺点炮：点炮者-112，庄+112', eqDelta(r.delta, { me: 112, left: -112, right: 0 }), JSON.stringify(r.delta));
}

/* ============ 三、非庄家胡牌结算 ============ */
console.log('\n--- 非庄家胡（庄=me，胡=left，P=5 → B=10） ---');
{
  let r = settlePoints({ multiplier: 1, winPoint: 5, zimo: true, winnerSeat: 'left', dealerSeat: 'me' });
  ok('非庄普通自摸：庄-20，闲-10，胡+30', eqDelta(r.delta, { me: -20, left: 30, right: -10 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 1, winPoint: 5, zimo: false, winnerSeat: 'left', loserSeat: 'right', loserListening: true, dealerSeat: 'me' });
  ok('非庄普通平胡（听牌闲点炮）：庄-10，闲-5，胡+15', eqDelta(r.delta, { me: -10, left: 15, right: -5 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 1, winPoint: 5, zimo: false, winnerSeat: 'left', loserSeat: 'right', loserListening: false, dealerSeat: 'me' });
  ok('非庄普通未听闲点炮：点炮者-10，胡+10，庄0', eqDelta(r.delta, { me: 0, left: 10, right: -10 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 1, winPoint: 5, zimo: false, winnerSeat: 'left', loserSeat: 'me', loserListening: false, dealerSeat: 'me' });
  ok('非庄普通庄家点炮：庄-20，胡+20', eqDelta(r.delta, { me: -20, left: 20, right: 0 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 2, winPoint: 5, zimo: true, winnerSeat: 'left', dealerSeat: 'me' });
  ok('非庄特殊自摸：庄-40，闲-20，胡+60', eqDelta(r.delta, { me: -40, left: 60, right: -20 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 2, winPoint: 5, zimo: false, winnerSeat: 'left', loserSeat: 'right', loserListening: true, dealerSeat: 'me' });
  ok('非庄特殊平胡：庄-20，闲-10，胡+30', eqDelta(r.delta, { me: -20, left: 30, right: -10 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 2, winPoint: 5, zimo: false, winnerSeat: 'left', loserSeat: 'right', loserListening: false, dealerSeat: 'me' });
  ok('非庄特殊未听闲点炮：包赔-30，胡+30', eqDelta(r.delta, { me: 0, left: 30, right: -30 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 2, winPoint: 5, zimo: false, winnerSeat: 'left', loserSeat: 'me', loserListening: false, dealerSeat: 'me' });
  ok('非庄特殊庄家点炮：庄包赔-30，胡+30', eqDelta(r.delta, { me: -30, left: 30, right: 0 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 4, winPoint: 9, zimo: true, winnerSeat: 'left', dealerSeat: 'me' });
  ok('非庄豪·幺自摸：庄-112，闲-72，胡+184', eqDelta(r.delta, { me: -112, left: 184, right: -72 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 4, winPoint: 9, zimo: false, winnerSeat: 'left', loserSeat: 'right', loserListening: true, dealerSeat: 'me' });
  ok('非庄豪·幺平胡：庄-56，闲-36，胡+92', eqDelta(r.delta, { me: -56, left: 92, right: -36 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 4, winPoint: 9, zimo: false, winnerSeat: 'left', loserSeat: 'right', loserListening: false, dealerSeat: 'me' });
  ok('非庄豪·幺未听闲点炮：包赔-92，胡+92', eqDelta(r.delta, { me: 0, left: 92, right: -92 }), JSON.stringify(r.delta));
  r = settlePoints({ multiplier: 4, winPoint: 9, zimo: false, winnerSeat: 'left', loserSeat: 'me', loserListening: false, dealerSeat: 'me' });
  ok('非庄豪·幺庄家点炮：庄包赔-92，胡+92', eqDelta(r.delta, { me: -92, left: 92, right: 0 }), JSON.stringify(r.delta));
}

/* ============ 三.5、分数计算式（detail） ============ */
console.log('\n--- 分数计算式 ---');
{
  // 用户例：白鹭（庄）自摸 6万，k=1，P=6 → 两闲各-22，庄+44
  let r = settlePoints({ multiplier: 1, winPoint: 6, zimo: true, winnerSeat: 'me', dealerSeat: 'me' });
  ok('庄自摸计算式：（胡牌点数6 + 庄家点5）× 自摸2 × 2家', r.detail.me === '（胡牌点数6 + 庄家点5）× 自摸2 × 2家', r.detail.me);
  r = settlePoints({ multiplier: 1, winPoint: 6, zimo: false, winnerSeat: 'left', loserSeat: 'right', loserListening: true, dealerSeat: 'me' });
  ok('非庄平胡计算式：庄/闲/胡三式', r.detail.me === '（胡牌点数6 + 庄家点5）× 平胡1' && r.detail.right === '胡牌点数6 × 平胡1' && r.detail.left === '（胡牌点数6 + 庄家点5）× 平胡1 + 胡牌点数6 × 平胡1', JSON.stringify(r.detail));
  r = settlePoints({ multiplier: 2, winPoint: 6, zimo: false, winnerSeat: 'left', loserSeat: 'me', loserListening: false, dealerSeat: 'me' });
  ok('特殊庄点炮计算式：带牌型2分量', r.detail.me === '（胡牌点数6 + 庄家点5）× 牌型2 + 胡牌点数6 × 牌型2', r.detail.me);
  r = settlePoints({ multiplier: 1, winPoint: 6, zimo: false, winnerSeat: 'left', loserSeat: 'right', loserListening: false, dealerSeat: 'me' });
  ok('普通未听闲点炮计算式：胡牌点数 × 点炮2', r.detail.right === '胡牌点数6 × 点炮2' && r.detail.me === '', JSON.stringify(r.detail));
}

/* ============ 四、杠即时结算 ============ */
console.log('\n--- 杠即时结算（按杠牌点数） ---');
{
  let r = gangPoints({ type: 'angang', tile: '9p', gangSeat: 'me' });
  ok('暗杠9饼：两家各-18，杠家+36', eqDelta(r.delta, { me: 36, left: -18, right: -18 }) && r.gain === 36, JSON.stringify(r.delta));
  r = gangPoints({ type: 'angang', tile: '2s', gangSeat: 'left' });
  ok('暗杠2条：两家各-4，杠家+8', eqDelta(r.delta, { me: -4, left: 8, right: -4 }), JSON.stringify(r.delta));
  r = gangPoints({ type: 'bugang', tile: '9p', gangSeat: 'me' });
  ok('补杠9饼：两家各-9，杠家+18', eqDelta(r.delta, { me: 18, left: -9, right: -9 }), JSON.stringify(r.delta));
  r = gangPoints({ type: 'diangang', tile: '5m', gangSeat: 'left', fromSeat: 'me' });
  ok('点杠5万：点杠者-10，杠家+10，另一家无关', eqDelta(r.delta, { me: -10, left: 10, right: 0 }), JSON.stringify(r.delta));
  r = gangPoints({ type: 'diangang', tile: 'N', gangSeat: 'left', fromSeat: 'right' });
  ok('点杠北风（10点）：点杠者-20，杠家+20', eqDelta(r.delta, { me: 0, left: 20, right: -20 }), JSON.stringify(r.delta));
}

/* ============ 五、流局 ============ */
console.log('\n--- 流局 ---');
{
  let r = drawPoints('me');
  ok('流局：庄-10，两闲各+5', eqDelta(r, { me: -10, left: 5, right: 5 }), JSON.stringify(r));
  r = drawPoints('right');
  ok('流局（right坐庄）：right-10，其余+5', eqDelta(r, { me: 5, left: 5, right: -10 }), JSON.stringify(r));
}

/* ============ 六、桌面集成：杠分 / 流局 / 累计积分 ============ */
console.log('\n--- 桌面集成 ---');
{
  const room = {
    code: 'sc', mode: 'x', laps: 1, ownerId: 1, status: 'playing',
    players: [
      { userId: 1, nickname: '甲', seat: 'me', ready: true, isAI: false },
      { userId: 2, nickname: '乙', seat: 'left', ready: true, isAI: false },
      { userId: 3, nickname: '丙', seat: 'right', ready: true, isAI: false },
    ],
  };
  const events = [];
  const t = new Table(room, (type, data) => events.push([type, data]));
  room.table = t;
  t.phase = 'play';
  t.turn = 'me';
  t.dealer = 'me';
  t.hands = { me: ['9p', '9p', '9p', '9p', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '1m'], left: [], right: [] };
  t.melds = { me: [], left: [], right: [] };
  t.discards = { me: [], left: [], right: [] };
  t.listening = { me: false, left: false, right: false };
  t.listenWaits = { me: [], left: [], right: [] };
  t.listenDiscard = { me: null, left: null, right: null };
  t.lastDraw = { me: '1m', left: null, right: null };
  t.wall = Array.from({ length: 40 }, (_, i) => ({ t: '5m', id: 9000 + i }));

  // 暗杠即时结算：9p（9点）→ 两家各-18，me+36
  t.gangSelf('me', '9p');
  const gs = events.filter((e) => e[0] === 'gangSettle').pop();
  ok('桌面暗杠下发 gangSettle 且积分入账', !!gs && gs[1].gain === 36 && t.points.me === 36 && t.points.left === -18, JSON.stringify(t.points));

  // 流局：庄（me）-10，两闲各+5 → me 36-10=26, left -18+5=-13
  t.onDraw();
  const st = events.filter((e) => e[0] === 'settle').pop();
  ok(
    '流局结算：庄-10 两闲+5，累计积分正确',
    !!st && st[1].delta.me === -10 && st[1].delta.left === 5 && t.points.me === 26 && t.points.left === -13,
    JSON.stringify({ delta: st && st[1].delta, points: t.points }),
  );
  ok('流局事件带累计积分', !!st && eqDelta(st[1].points || {}, t.points));

  // 胡牌：right（报听）点炮 6m 给 left（报听）→ 平胡口径：庄-11，点炮闲-6，胡+17
  const events2 = [];
  const t2 = new Table({ ...room, code: 'sc2' }, (type, data) => events2.push([type, data]));
  room.table = t2;
  t2.phase = 'play';
  t2.turn = 'right';
  t2.dealer = 'me';
  t2.hands = {
    me: ['2s', '4s', '6s', '8s', '2p', '4p', '6p', '8p', '3m', '5m', '7m', '9m', '1m'],
    left: ['2s', '3s', '4s', '5s', '6s', '7s', '5m', '5m', '5m', '9p', '9p', '9p', '6m'],
    right: ['1p', '2p', '3p', '7p', '8p', '9p', '2m', '3m', '4m', '6m', '6m', '6m', '6s'],
  };
  t2.hands.right.push('6m');
  t2.melds = { me: [], left: [], right: [] };
  t2.discards = { me: [], left: [], right: [] };
  t2.listening = { me: false, left: true, right: true };
  t2.listenWaits = { me: [], left: ['6m'], right: ['6s'] };
  t2.listenDiscard = { me: null, left: null, right: null };
  t2.lastDraw = { me: null, left: null, right: '6m' };
  t2.wall = Array.from({ length: 40 }, (_, i) => ({ t: '5m', id: 9500 + i }));
  t2.points = { me: 0, left: 0, right: 0 };
  t2.discard('right', '6m');
  t2.performAction('left', 'hu');
  const st2 = events2.filter((e) => e[0] === 'settle').pop();
  ok(
    '平胡结算（庄-11 点炮闲-6 胡+17）并入累计',
    !!st2 && st2[1].delta.me === -11 && st2[1].delta.left === 17 && st2[1].delta.right === -6 && t2.points.left === 17,
    JSON.stringify({ delta: st2 && st2[1].delta, points: t2.points }),
  );
}

console.log(`\n合计 ${passed + failed} 项：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
