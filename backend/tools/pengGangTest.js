/**
 * 碰 / 杠逻辑测试
 *
 * 规则：
 *  1. 每次打出一张牌，检测其余两人是否存在碰/杠
 *  2. 存在则向该玩家下发 offer（页面显示碰/杠按钮），用户可选择
 *  3. 超时未选择 → 自动过，按行动顺序进入下一玩家回合
 *  4. 优先级：胡 > 碰/杠；同级按离弃牌者的下家顺序依次询问
 *  5. 碰后该玩家继续出牌（不摸牌）；明杠从牌库最后一张补摸
 */
import { Table } from '../src/game/table.js';
import { canPeng, canGang } from '../src/game/engine.js';

let passed = 0;
let failed = 0;
function ok(name, cond, extra = '') {
  if (cond) passed += 1;
  else failed += 1;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' · ' + extra : ''}`);
}

function makeTable(hands, opts = {}) {
  const aiSeats = opts.aiSeats || [];
  const room = {
    code: 'pg', mode: '三人经典', rounds: 4, ownerId: 1, status: 'playing',
    players: [
      { userId: 1, nickname: '甲', seat: 'me', ready: true, isAI: aiSeats.includes('me') },
      { userId: 2, nickname: '乙', seat: 'left', ready: true, isAI: aiSeats.includes('left') },
      { userId: 3, nickname: '丙', seat: 'right', ready: true, isAI: aiSeats.includes('right') },
    ],
  };
  const events = [];
  const t = new Table(room, (type, data, target) => events.push([type, data, target]));
  room.table = t;
  t.phase = 'play';
  t.turn = opts.turn || 'me';
  t.dealer = 'me';
  t.hands = { me: [], left: [], right: [], ...hands };
  t.melds = { me: [], left: [], right: [] };
  t.discards = { me: [], left: [], right: [] };
  t.listening = { me: false, left: false, right: false };
  t.listenWaits = { me: [], left: [], right: [] };
  t.listenDiscard = { me: null, left: null, right: null };
  t.lastDraw = { me: null, left: null, right: null };
  t.wall = Array.from({ length: 40 }, (_, i) => ({ t: '9p', id: 9000 + i }));
  return { t, events };
}

/** 14 张杂牌（含一张 5s 供打出） */
const J14 = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '9s', '5s'];
/** 13 张杂牌 */
const J13 = J14.slice(0, 13);
/** 13 张含 5s 对子（可碰 5s；加一张 5s 也不成胡，纯碰型） */
const PENG13 = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '9p', '5s', '5s'];
/** 13 张含 5s 刻子（可明杠 5s） */
const GANG13 = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '1p', '5s', '5s'].concat('9s').slice(0, 13).map((x, i) => (i === 10 ? '5s' : x));
/** 13 张听 5m/6s（报听态；6s 为 6 点，可被点炮胡） */
const HU6S13 = ['1p', '1p', '1p', '2s', '3s', '4s', '7s', '8s', '9s', '5m', '5m', '6s', '6s'];
/** 13 张含 6s 对子（可碰 6s） */
const PENG6 = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '9p', '6s', '6s'];
/** 14 张杂牌（含一张 6s 供打出） */
const ME6 = [...J13, '6s'];

/* ============ 一、打出牌后检测其余两人 ============ */
console.log('\n--- 打牌后检测碰/杠 ---');
{
  const { t } = makeTable({ me: J14.slice(), left: PENG13.slice(), right: J13.slice() });
  t.discard('me', '5s');
  ok('检测到 left 可碰', (t.pendingActions.left || []).includes('peng'));
  ok('right 无动作', !t.pendingActions.right);
  ok('碰牌判定正确（canPeng）', canPeng(PENG13, '5s') === true);
}
{
  const g = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '1p', '5s', '5s'];
  g.splice(10, 1, '5s'); // 5s ×3
  const { t } = makeTable({ me: J14.slice(), left: g, right: J13.slice() });
  t.discard('me', '5s');
  ok('检测到 left 可杠（明杠）', (t.pendingActions.left || []).includes('gang'));
  ok('canGang 判定正确', canGang(g, '5s') === true);
}

/* ============ 二、offer 下发（页面显示碰/杠按钮） ============ */
console.log('\n--- offer 按钮下发 ---');
{
  const { t, events } = makeTable({ me: J14.slice(), left: PENG13.slice(), right: J13.slice() });
  t.discard('me', '5s');
  const offer = events.filter((e) => e[0] === 'offer').pop();
  ok('可碰玩家收到 offer', !!offer && offer[2] === 'left');
  ok('offer 带 actions 与牌面', !!offer && offer[1].actions.includes('peng') && offer[1].tile === '5s');
}

/* ============ 三、用户点碰 → 碰后继续出牌 ============ */
console.log('\n--- 碰 ---');
{
  const { t, events } = makeTable({ me: J14.slice(), left: PENG13.slice(), right: J13.slice() });
  t.discard('me', '5s');
  t.performAction('left', 'peng');
  ok('碰后副露 +1（type=peng）', t.melds.left.length === 1 && t.melds.left[0].type === 'peng' && t.melds.left[0].tile === '5s');
  ok('碰后手牌 11 张（-2）', t.hands.left.length === 11);
  ok('弃牌者的牌归碰者（牌河不变）', t.discards.me.length === 1);
  const turnEvt = events.filter((e) => e[0] === 'turn').pop();
  ok('碰后轮到碰者出牌', !!turnEvt && turnEvt[1].seat === 'left' && turnEvt[1].after === 'peng');
  ok('碰后不摸牌（壁牌不变）', t.wall.length === 40);
  // 非法动作：没有对子不能碰
  const b = makeTable({ me: J14.slice(), left: J13.slice(), right: J13.slice() });
  b.t.discard('me', '5s');
  b.t.pendingActions = { left: ['peng'] }; // 模拟伪造询问
  b.t.lastDiscard = { seat: 'me', tile: '5s' };
  b.t.performAction('left', 'peng');
  ok('手牌无对子时碰被拒', b.t.melds.left.length === 0);
}

/* ============ 四、用户点杠 → 明杠 + 从牌库最后补摸 ============ */
console.log('\n--- 杠 ---');
{
  const g = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '1p', '5s', '5s'];
  g.splice(10, 1, '5s'); // 5s ×3
  const { t, events } = makeTable({ me: J14.slice(), left: g, right: J13.slice() });
  t.discard('me', '5s');
  t.performAction('left', 'gang');
  ok('明杠副露（type=gang）', t.melds.left.length === 1 && t.melds.left[0].type === 'gang');
  ok('杠后手牌 = 13-3+1 = 11 张', t.hands.left.length === 11);
  const drawEvt = events.filter((e) => e[0] === 'draw').pop();
  ok('杠牌从牌库最后一张补摸', !!drawEvt && drawEvt[1].source === 'tail' && drawEvt[1].tile === '9p');
  ok('杠后轮到杠者出牌', events.filter((e) => e[0] === 'turn').pop()?.[1]?.seat === 'left');
}

/* ============ 五、超时未选择 → 自动过 → 下一玩家回合 ============ */
console.log('\n--- 超时自动过 ---');
await (async () => {
  const realST = globalThis.setTimeout;
  const fired = [];
  globalThis.setTimeout = (fn, ms, ...a) => (ms === 15_000 ? (fired.push(fn), 0) : realST(fn, ms, ...a));
  try {
    const { t, events } = makeTable({ me: J14.slice(), left: PENG13.slice(), right: J13.slice() });
    t.discard('me', '5s');
    ok('left 收到碰询问', !!events.filter((e) => e[0] === 'offer').pop());
    fired[0](); // 模拟 15s 超时未选
    ok('超时自动过（动作清空）', Object.keys(t.pendingActions).length === 0);
    const turnEvt = events.filter((e) => e[0] === 'turn').pop();
    ok('按顺序进入下一玩家回合（下家 left）', !!turnEvt && turnEvt[1].seat === 'left');
    ok('left 正常摸牌（14 张）', t.hands.left.length === 14);
    ok('超时后无人碰牌', t.melds.left.length === 0);
  } finally {
    globalThis.setTimeout = realST;
  }
})();

/* ============ 六、两人都有动作 → 依次询问 ============ */
console.log('\n--- 依次询问两位玩家 ---');
await (async () => {
  const realST = globalThis.setTimeout;
  const fired = [];
  globalThis.setTimeout = (fn, ms, ...a) => (ms === 15_000 ? (fired.push(fn), 0) : realST(fn, ms, ...a));
  try {
    const { t, events } = makeTable({ me: J14.slice(), left: PENG13.slice(), right: PENG13.slice() });
    t.discard('me', '5s');
    const offers = () => events.filter((e) => e[0] === 'offer').map((e) => e[2]);
    ok('先询问下家 left', offers()[0] === 'left');
    fired[0](); // left 超时
    ok('left 过后再询问 right', offers()[1] === 'right');
    fired[fired.length - 1](); // right 超时（最新一次询问的定时器）
    ok('全部过后轮到下家 left 出牌', events.filter((e) => e[0] === 'turn').pop()?.[1]?.seat === 'left');
    ok('无人碰牌', t.melds.left.length === 0 && t.melds.right.length === 0);
  } finally {
    globalThis.setTimeout = realST;
  }
})();

/* ============ 七、胡优先于碰/杠 ============ */
console.log('\n--- 优先级：胡 > 碰/杠 ---');
{
  // left 可碰 6s，right 已报听可胡 6s（6 点）→ 必须先问 right（胡）
  const { t, events } = makeTable({ me: ME6.slice(), left: PENG6.slice(), right: HU6S13.slice() });
  t.listening.right = true;
  t.listenWaits.right = ['5m', '6s'];
  t.discard('me', '6s');
  const offers = events.filter((e) => e[0] === 'offer').map((e) => e[2]);
  ok('能胡的 right 先收到询问', offers[0] === 'right' && events.filter((e) => e[0] === 'offer')[0][1].actions.includes('hu'));
  t.performAction('right', 'hu');
  ok('right 胡牌结算（碰未抢先）', t.phase === 'settle' && t.melds.left.length === 0);
}
await (async () => {
  // AI 能胡时同样优先于真人碰
  const realST = globalThis.setTimeout;
  const fired = [];
  globalThis.setTimeout = (fn, ms, ...a) => (ms === 15_000 ? (fired.push(fn), 0) : realST(fn, ms, ...a));
  try {
    const { t } = makeTable({ me: ME6.slice(), left: PENG6.slice(), right: HU6S13.slice() }, { aiSeats: ['right'] });
    t.listening.right = true;
    t.listenWaits.right = ['5m', '6s'];
    t.discard('me', '6s');
    ok('AI 立即胡（真人碰不再被询问）', t.phase === 'settle' && t.melds.left.length === 0);
    ok('无 offer 发给碰者', !fired.length);
  } finally {
    globalThis.setTimeout = realST;
  }
})();

/* ============ 八、抢杠胡 ============ */
console.log('\n--- 抢杠：补杠的牌是他人听口（≥6 点）可被抢杠 ---');
const ROB13 = ['1p', '1p', '1p', '2s', '3s', '4s', '6s', '7s', '8s', '5m', '5m', '6m', '6m']; // 听 5m/6m
const BUG14 = [...J13, '6m']; // 杠家手牌（含补杠的 6m，J13 本身也有 6m）
{
  // 听口不含补杠牌 → 直接补杠，无询问
  const { t } = makeTable({ me: ROB13.slice(), left: BUG14.slice() }, { turn: 'left' });
  t.melds.left.push({ type: 'peng', tile: '6m', from: 'me' });
  t.listening.me = true;
  t.listenWaits.me = ['3m']; // 听口不含 6m
  t.gangSelf('left', '6m');
  ok('听口不含补杠牌：直接补杠', t.melds.left[0].type === 'bugang');
  ok('直接补杠：从牌库最后补摸', t.hands.left.length === 14);
}
{
  // 未报听他人 → 不可抢杠，直接补杠
  const { t } = makeTable({ me: ROB13.slice(), left: BUG14.slice() }, { turn: 'left' });
  t.melds.left.push({ type: 'peng', tile: '6m', from: 'me' });
  t.gangSelf('left', '6m');
  ok('未听牌者不可抢杠（直接补杠）', t.melds.left[0].type === 'bugang');
}
{
  // AI 听口含 6m（6 点 ≥6）→ 立即抢杠胡，杠家算点炮赔付
  const { t, events } = makeTable(
    { me: ROB13.slice(), left: BUG14.slice() },
    { turn: 'left', aiSeats: ['me'] },
  );
  t.melds.left.push({ type: 'peng', tile: '6m', from: 'me' });
  t.listening.me = true;
  t.listenWaits.me = ['6m'];
  const wallBefore = t.wall.length;
  t.gangSelf('left', '6m');
  ok('AI 听口含补杠牌：立即抢杠胡', t.phase === 'settle');
  ok('杠家（未听）算点炮：只赔一份', events.filter((e) => e[0] === 'settle').pop()?.[1]?.delta.left < 0
    && events.filter((e) => e[0] === 'settle').pop()?.[1]?.delta.right === 0);
  ok('结算带 robGang 标记', events.filter((e) => e[0] === 'settle').pop()?.[1]?.robGang === true);
  ok('碰未被改成杠（被抢）', t.melds.left[0].type === 'peng');
  ok('未发生杠后补摸', t.wall.length === wallBefore);
}
await (async () => {
  // 真人听口含 → 收到抢杠询问；点击「胡」→ 抢杠胡结算
  const { t, events } = makeTable({ me: ROB13.slice(), left: BUG14.slice() }, { turn: 'left' });
  t.melds.left.push({ type: 'peng', tile: '6m', from: 'me' });
  t.listening.me = true;
  t.listenWaits.me = ['6m'];
  t.gangSelf('left', '6m');
  const offer = events.filter((e) => e[0] === 'offer').pop();
  ok('真人收到抢杠询问（仅胡）', !!offer && offer[2] === 'me' && offer[1].actions.join() === 'hu' && offer[1].robGang === true);
  t.performAction('me', 'hu');
  ok('点击胡 → 抢杠胡结算', t.phase === 'settle');
  const st = events.filter((e) => e[0] === 'settle').pop()?.[1];
  ok('抢杠胜者=me · 败者=杠家 left', st && st.winnerSeat === 'me' && st.loserSeat === 'left');
  ok('杠家未听：declarerListening=false（点炮口径）', st && st.declarerListening === false);
})();
await (async () => {
  // 真人超时未点 → 视为放弃 → 照常补杠
  const realST = globalThis.setTimeout;
  const fired = [];
  globalThis.setTimeout = (fn, ms, ...a) => (ms === 8000 ? (fired.push(fn), 0) : realST(fn, ms, ...a));
  try {
    const { t, events } = makeTable({ me: ROB13.slice(), left: BUG14.slice() }, { turn: 'left' });
    t.melds.left.push({ type: 'peng', tile: '6m', from: 'me' });
    t.listening.me = true;
    t.listenWaits.me = ['6m'];
    t.gangSelf('left', '6m');
    fired[0](); // 抢杠询问 8s 超时
    ok('超时放弃 → 照常补杠', t.melds.left[0].type === 'bugang' && t.phase === 'play');
    ok('补杠后杠家从牌库最后补摸', t.hands.left.length === 14 && events.filter((e) => e[0] === 'draw').pop()?.[1]?.source === 'tail');
    ok('轮到杠家出牌', events.filter((e) => e[0] === 'turn').pop()?.[1]?.seat === 'left');
  } finally {
    globalThis.setTimeout = realST;
  }
})();

/* ============ 九、报听者补杠（可杠不可碰）与抢杠口径 ============ */
{
  // 报听者补杠后无听口 → 不能补杠
  const { t } = makeTable(
    { left: ['9s', '9s', '9s', '9s', '1m', '1m', '4m', '4m', '7m', '7m', '1p', '1p', '4p', '6m'] },
    { turn: 'left' },
  );
  t.melds.left.push({ type: 'peng', tile: '6m', from: 'me' });
  t.listening.left = true;
  t.listenWaits.left = ['6m'];
  t.gangSelf('left', '6m');
  ok('报听者不能补杠（报听后一律不能杠）', t.melds.left[0].type === 'peng' && t.hands.left.length === 14);
}
{
  // 补杠被抢 → 未报听的杠家被听牌人抢杠胡（declarerListening=false）
  const { t, events } = makeTable(
    { me: ROB13.slice(), left: BUG14.slice() },
    { turn: 'left', aiSeats: ['me'] },
  );
  t.melds.left.push({ type: 'peng', tile: '6m', from: 'me' });
  t.listening.me = true;
  t.listenWaits.me = ['6m'];
  t.gangSelf('left', '6m');
  const st = events.filter((e) => e[0] === 'settle').pop()?.[1];
  ok('杠家被抢杠 → 结算', t.phase === 'settle');
  ok('杠家未报听：declarerListening=false 且 robGang=true', !!st && st.declarerListening === false && st.robGang === true);
}
{
  // 补杠无人抢 → 照常补杠并从牌库最后补摸
  const { t, events } = makeTable({ me: ROB13.slice(), left: BUG14.slice() }, { turn: 'left' });
  t.melds.left.push({ type: 'peng', tile: '6m', from: 'me' });
  t.gangSelf('left', '6m');
  const act = events.filter((e) => e[0] === 'action' && e[1].type === 'bugang').pop();
  ok('补杠照常执行', t.melds.left[0].type === 'bugang' && t.phase === 'play');
  ok('补杠后从牌库最后补摸', !!act && events.filter((e) => e[0] === 'draw').pop()?.[1]?.source === 'tail');
}

/* ============ 汇总 ============ */
console.log(`\n合计 ${passed + failed} 项：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
