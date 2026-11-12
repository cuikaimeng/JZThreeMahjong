/**
 * 房间底分回归：所有分数结算 × 房间底分（1 / 2 / 5）
 * 覆盖：胡牌结算、杠即时分、流局结算、计算式后缀
 */
import { Table } from '../src/game/table.js';

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}${extra ? ` → ${extra}` : ''}`);
  }
};

const tableList = [];
/** 构造一局：庄=left，己方听 N（北=10 点），left 手中持 N 待打出 */
function mk(base) {
  const room = {
    code: `b${base}`,
    mode: 'x',
    laps: 1,
    base,
    ownerId: 1,
    status: 'playing',
    players: [
      { userId: 1, nickname: '甲', seat: 'me', ready: true },
      { userId: 2, nickname: '乙', seat: 'left', ready: true },
      { userId: 3, nickname: '丙', seat: 'right', ready: true },
    ],
  };
  const events = [];
  const t = new Table(room, (type, data) => events.push([type, data]));
  room.table = t;
  tableList.push(t);
  t.phase = 'play';
  t.turn = 'left';
  t.dealer = 'left';
  t.hands = {
    me: ['1m', '1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', 'N', 'N', 'N', 'N'],
    left: ['2m', 'N'],
    right: ['3m'],
  };
  t.melds = { me: [], left: [], right: [] };
  t.discards = { me: [], left: ['9s'], right: [] };
  t.listening = { me: true, left: false, right: false };
  t.listenWaits = { me: ['N'], left: [], right: [] };
  t.listenDiscard = { me: null, left: null, right: null };
  t.lastDraw = { me: null, left: 'N', right: null };
  t.points = { me: 0, left: 0, right: 0 };
  t.wall = Array.from({ length: 30 }, (_, i) => ({ t: '9p', id: 9000 + i }));
  return { t, events };
}

const settleOf = (events) => {
  const e = events.filter((x) => x[0] === 'settle').pop();
  return e && e[1];
};

/* ---------- 胡牌：庄家点炮 2(5+P) = 30，× 底分 ---------- */
console.log('--- 胡牌结算 × 底分 ---');
{
  const a = mk(5);
  a.t.discard('left', 'N');
  a.t.performAction('me', 'hu');
  const st = settleOf(a.events);
  ok('底分5 胡牌：30×5=150', st && st.delta.me === 150 && st.delta.left === -150, JSON.stringify(st && st.delta));
  ok('底分5 计算式带「× 底分5」', st && st.detail.me.includes('× 底分5'), st && st.detail.me);
  ok('底分5 无关座位计算式为空', st && st.detail.right === '', st && JSON.stringify(st.detail));
}
{
  const a = mk(2);
  a.t.discard('left', 'N');
  a.t.performAction('me', 'hu');
  const st = settleOf(a.events);
  ok('底分2 胡牌：30×2=60', st && st.delta.me === 60 && st.delta.left === -60, JSON.stringify(st && st.delta));
}
{
  const a = mk(1);
  a.t.discard('left', 'N');
  a.t.performAction('me', 'hu');
  const st = settleOf(a.events);
  ok('底分1 胡牌：30（不缩放、无后缀）', st && st.delta.me === 30 && !st.detail.me.includes('底分'), st && st.detail.me);
  ok('底分1 累计分同步', a.t.points.me === 30 && a.t.points.left === -30, JSON.stringify(a.t.points));
}

/* ---------- 杠即时分 × 底分：暗杠 N(10) 每家付 20 ---------- */
console.log('\n--- 杠即时分 × 底分 ---');
{
  const c = mk(5);
  c.t.settleGang({ type: 'angang', tile: 'N', gangSeat: 'me' });
  const gs = c.events.filter((e) => e[0] === 'gangSettle').pop()[1];
  ok('底分5 暗杠北：两家各 -100，杠家 +200', gs.delta.me === 200 && gs.delta.left === -100 && gs.gain === 200, JSON.stringify(gs.delta));
  ok('底分5 暗杠累计分同步', c.t.points.me === 200, JSON.stringify(c.t.points));
}
{
  const c = mk(2);
  c.t.settleGang({ type: 'angang', tile: 'N', gangSeat: 'me' });
  const gs = c.events.filter((e) => e[0] === 'gangSettle').pop()[1];
  ok('底分2 暗杠北：两家各 -40，杠家 +80', gs.delta.me === 80 && gs.delta.left === -40, JSON.stringify(gs.delta));
}

/* ---------- 流局 × 底分：庄 -10、闲 +5 ---------- */
console.log('\n--- 流局结算 × 底分 ---');
{
  const b = mk(2);
  b.t.onDraw();
  const st = settleOf(b.events);
  ok('底分2 流局：庄 -20 / 闲 +10', st && st.delta.left === -20 && st.delta.me === 10 && st.delta.right === 10, JSON.stringify(st && st.delta));
  ok('底分2 流局文案动态', st && st.detail.left === '流局 · 庄家-20' && st.detail.me === '流局 · 闲+10', JSON.stringify(st && st.detail));
}
{
  const b = mk(5);
  b.t.onDraw();
  const st = settleOf(b.events);
  ok('底分5 流局：庄 -50 / 闲 +25', st && st.delta.left === -50 && st.delta.me === 25, JSON.stringify(st && st.delta));
}

/* ---------- 汇总 ---------- */
for (const t of tableList) t.destroy();
console.log(`\n合计 ${passed + failed} 项：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
