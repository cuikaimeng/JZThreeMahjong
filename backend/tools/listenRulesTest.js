/**
 * 报听规则单测
 *
 * 规则：
 *  1. 报听时打出最后一张牌扣在桌面上（背面朝上、不可被碰/杠/胡）
 *  2. 报听后不能再碰/杠/再听/换牌 —— 摸什么打什么，直到可以胡牌
 *  3. 报听门槛：
 *       a) 报听扣牌点数 ≥3
 *       b) 听口中至少一张点数 ≥6（保证可被点炮；<6 的听口只能自摸）
 *     牌点口径：数字牌 = 面值，字牌 = 10 点
 */
import { Table } from '../src/game/table.js';
import { tilePoint, listenCandidates, canDeclareListen, canHu } from '../src/game/engine.js';
import { lapName } from '../src/game/gameRules.js';

let passed = 0;
let failed = 0;
function ok(name, cond, extra = '') {
  if (cond) passed += 1;
  else failed += 1;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' · ' + extra : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tableList = [];
function makeTable(hands, opts = {}) {
  const aiSeats = opts.aiSeats || [];
  const room = {
    code: 'lt', mode: '三人经典', rounds: 4, ownerId: 1, status: 'playing',
    players: [
      { userId: 1, nickname: '甲', seat: 'me', ready: true, isAI: aiSeats.includes('me') },
      { userId: 2, nickname: '乙', seat: 'left', ready: true, isAI: aiSeats.includes('left') },
      { userId: 3, nickname: '丙', seat: 'right', ready: true, isAI: aiSeats.includes('right') },
    ],
  };
  const events = [];
  const t = new Table(room, (type, data) => events.push([type, data]));
  room.table = t;
  tableList.push(t);
  t.phase = 'play';
  t.turn = opts.turn || 'me';
  t.dealer = 'me';
  t.hands = { me: [], left: [], right: [], ...hands };
  t.melds = { me: [], left: [], right: [] };
  t.discards = { me: [], left: [], right: [] };
  t.listening = { me: false, left: false, right: false, ...(opts.listening || {}) };
  t.listenWaits = { me: [], left: [], right: [] };
  t.listenDiscard = { me: null, left: null, right: null };
  t.lastDraw = { me: null, left: null, right: null };
  t.wall = Array.from({ length: 40 }, (_, i) => ({ t: '9p', id: 9000 + i })); // 牌墙充足，摸到的都是 9p
  return { t, events };
}

/** 13 张听 3m/6m（含 9m 单钓）的两面听底牌 */
const H13 = ['1p', '1p', '1p', '2s', '3s', '4s', '5s', '6s', '7s', '4m', '5m', '9m', '9m'];

/* ============ 一、牌点口径 ============ */
console.log('\n--- 牌点 ---');
ok('数字牌点数 = 面值', tilePoint('3s') === 3 && tilePoint('9s') === 9 && tilePoint('5p') === 5);
ok('字牌按高点计（10）', tilePoint('E') === 10);

/* ============ 二、报听门槛：听口必须含 ≥6 点 ============ */
console.log('\n--- 规则3b：听口含 ≥6 点 ---');
// 例：听 3条 / 5饼（双碰），都 <6 → 不能报听
const case3s5p = ['1m', '1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '3s', '3s', '5p', '5p', '9m'];
ok('听 3条/5饼 → 不能报听', !canDeclareListen(case3s5p));
{
  const { t } = makeTable({ me: case3s5p.slice() });
  const r = t.declareListen('me');
  ok('听 3条/5饼 → 服务器拒绝并说明原因', !r.ok && /6 点/.test(r.reason || ''), r.reason || '');
}
// 例：听 5条 / 5万（双碰），都 <6 → 不能报听
const case5s5m = ['1p', '1p', '1p', '2s', '3s', '4s', '6s', '7s', '8s', '5m', '5m', '5s', '5s', '9m'];
ok('听 5条/5万 → 不能报听', !canDeclareListen(case5s5m));

/* ============ 三、报听门槛：弃牌点数 ≥3 ============ */
console.log('\n--- 规则3a：扣牌 ≥3 点 ---');
{
  // 14 张：123m 456m 789m 111p 9s + 1s（弃 1s 本可听 9s，但 1s 只有 1 点）
  const hand = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '1p', '1p', '9s', '1s'];
  const cands = listenCandidates(hand).map((c) => c.tile);
  ok('弃 1s（1 点）不能作为报听扣牌', !cands.includes('1s'), `候选=${cands.join(',') || '无'}`);
  const { t } = makeTable({ me: hand.slice() });
  const r = t.declareListen('me', '1s');
  ok('指定弃 1s 报听 → 被拒', !r.ok, r.reason || '');
}

/* ============ 四、合法报听 + 扣牌 ============ */
console.log('\n--- 规则1：扣牌（背面朝上、不可被响应） ---');
{
  const hand = [...H13, '9s']; // 弃 9s → 听 3m/6m/9m
  const { t, events } = makeTable({ me: hand });
  const r = t.declareListen('me', '9s');
  ok('听 3万/6万 → 可以报听', r.ok, r.ok ? `扣 ${r.tile}，听 ${r.waits.join('/')}` : r.reason);
  ok('听口中含 ≥6 点的 6万', r.ok && r.waits.includes('6m'));
  ok('报听后 listening.me = true', t.listening.me === true);
  ok('扣牌记录在牌河下标 0', t.listenDiscard.me === 0, String(t.listenDiscard.me));
  const discEvt = events.filter((e) => e[0] === 'discard').pop();
  ok('discard 事件带 faceDown 标记', !!discEvt && discEvt[1].faceDown === true);
  ok('扣牌后无人可碰/杠/胡', Object.keys(t.pendingActions).length === 0);
  ok('扣牌后手牌 13 张', t.hands.me.length === 13, String(t.hands.me.length));
}

/* ============ 五、报听后锁手牌 ============ */
console.log('\n--- 规则2：报听后不能再碰/杠/再听/换牌 ---');
{
  const { t, events } = makeTable({ me: [...H13, '9s'] });
  t.declareListen('me', '9s');
  t.turn = 'me'; // 回到自己的巡，测重复报听
  const again = t.declareListen('me', '1p');
  ok('不能重复报听', !again.ok && /已经报听/.test(again.reason || ''), again.reason || '');

  // 碰：即使服务器给出 peng 询问，报听者也不能碰
  t.pendingActions = { me: ['peng'] };
  t.lastDiscard = { seat: 'left', tile: '9s' };
  t.performAction('me', 'peng');
  ok('报听后碰被拒', t.melds.me.length === 0);

  // 杠：报听后一律不能杠（报听须门清，杠会拆散听口）
  t.turn = 'me';
  t.hands.me = ['1p', '1p', '1p', '1p', '2s', '3s', '4s', '5s', '6s', '7s', '4m', '5m', '9m', '9m'];
  const waBefore = t.wall.length;
  t.gangSelf('me', '1p');
  ok('报听后暗杠被拒', t.melds.me.length === 0 && t.hands.me.length === 14 && t.wall.length === waBefore);
  // 报听者补杠同样被拒
  t.melds.me.push({ type: 'peng', tile: '9m', from: 'left' });
  t.hands.me = ['1p', '1p', '1p', '1p', '2s', '3s', '4s', '5s', '6s', '7s', '4m', '5m', '9m', '9m'];
  t.gangSelf('me', '9m');
  ok('报听后补杠被拒', t.melds.me[0].type === 'peng' && t.hands.me.length === 14);
  t.melds.me.length = 0;

  // 换牌：只能打刚摸到的牌
  t.lastDraw.me = '5m';
  t.hands.me = [...H13, '5m'];
  t.turn = 'me';
  const before = t.discards.me.length;
  const rej = t.discard('me', '9m');
  ok('报听后打非摸牌被拒', rej === false && t.discards.me.length === before);
  const acc = t.discard('me', '5m');
  ok('报听后打摸到的牌成功', acc === true && t.discards.me.length === before + 1);
}

/* ============ 六、报听后自动摸打 ============ */
console.log('\n--- 规则2：摸什么打什么（自动出牌） ---');
await (async () => {
  const { t } = makeTable({ me: H13.slice() }, { listening: { me: true } });
  t.beginTurn('me');
  ok('摸牌后手牌 14 张', t.hands.me.length === 14, String(t.hands.me.length));
  ok('摸到 9p 且被记录', t.lastDraw.me === '9p');
  await sleep(1600);
  ok('报听后自动打出摸到的牌', t.discards.me.length === 1 && t.discards.me[0] === '9p');
  ok('自动出牌后手牌回到 13 张', t.hands.me.length === 13 && t.lastDraw.me === null);
})();

/* ============ 七、点炮点数限制：<6 只能自摸 ============ */
console.log('\n--- 规则3：3万只能自摸，6万可点炮 ---');
{
  const { t } = makeTable({ me: [...H13, '9s'] });
  t.declareListen('me', '9s');
  ok('报听者：3万点炮不可胡', t.canOtherHu('me', '3m') === false);
  ok('报听者：6万点炮可胡', t.canOtherHu('me', '6m') === true);
  ok('报听者：非听口 9万点炮不可胡', t.canOtherHu('me', '9m') === false);
  // 未报听者一律不能胡（新规则：必须先报听）
  const b = makeTable({ me: H13.slice() });
  ok('未报听者：3万点炮不可胡', b.t.canOtherHu('me', '3m') === false);
  ok('未报听者：6万点炮也不可胡', b.t.canOtherHu('me', '6m') === false);
}
{
  // 自摸 3万（低点听口）允许
  const { t } = makeTable({ me: [...H13, '3m'] }, { listening: { me: true } });
  ok('自摸 3万：牌型成立', canHu(t.hands.me) === true);
  t.huSelf('me');
  ok('报听者：低点听口可自摸胡', t.phase === 'settle');
}
{
  // 报听者点炮 3万：即使进入 hu 处理也会被拦下
  const { t } = makeTable({ me: H13.slice() }, { listening: { me: true } });
  t.pendingActions = { me: ['hu'] };
  t.lastDiscard = { seat: 'left', tile: '3m' };
  t.performAction('me', 'hu');
  ok('报听者点炮 3万被拦下（未结算）', t.phase === 'play');
}

/* ============ 八、AI 也遵守门槛 ============ */
console.log('\n--- AI 一致性 ---');
{
  const { t } = makeTable({ me: case3s5p.slice() });
  const r = t.declareListen('me');
  ok('低点听口对任何玩家都拒绝', !r.ok);
}

/* ============ 九、听口记录 ============ */
console.log('\n--- 胡牌规则：报听后记住所有能胡的牌型 ---');
{
  const { t, events } = makeTable({ me: [...H13, '9s'] });
  t.declareListen('me', '9s');
  ok('报听后记录听口（listenWaits）', Array.isArray(t.listenWaits.me) && t.listenWaits.me.length > 0,
    `听 ${t.listenWaits.me.join('/')}`);
  ok('listen 事件带 waits', (events.filter((e) => e[0] === 'listen').pop()?.[1]?.waits || []).length > 0);
  ok('点炮判定以记录听口为准：听口内可胡', t.canOtherHu('me', '6m') === true);
  ok('点炮判定以记录听口为准：听口外不可胡', t.canOtherHu('me', '9m') === false);
}

/* ============ 十、摸到即胡：不自动胡，超时打出该牌 ============ */
console.log('\n--- 胡牌规则：自摸出现胡按钮，超时打出该牌 ---');
await (async () => {
  // 捕获 15s 兜底定时器，模拟超时触发
  const realST = globalThis.setTimeout;
  const fired = [];
  globalThis.setTimeout = (fn, ms, ...a) => (ms === 15_000 ? (fired.push(fn), 0) : realST(fn, ms, ...a));
  try {
    // 真人报听者摸到即胡
    const { t } = makeTable({ me: H13.slice() }, { listening: { me: true } });
    t.listenWaits.me = ['3m', '6m'];
    t.hands.me = [...H13, '3m'];
    t.lastDraw.me = '3m';
    t.turn = 'me';
    t.listenTurn('me', '3m');
    ok('真人摸到即胡：不自动胡（等待点击）', t.phase === 'play' && fired.length === 1);
    if (fired.length) fired[0](); // 模拟 15s 超时未点胡
    ok('超时后打出该牌（未自动胡）', t.phase === 'play' && t.discards.me[0] === '3m' && t.hands.me.length === 13);

    // 真人未报听者：超时打「牌面最右侧」一张（此处摸到的 9p 恰好是排序后最右）
    fired.length = 0;
    const b = makeTable({ me: H13.slice() });
    b.t.beginTurn('me'); // 从假牌墙摸 9p
    ok('普通回合摸牌 14 张', b.t.hands.me.length === 14 && b.t.lastDraw.me === '9p');
    if (fired.length) fired[0]();
    ok('无选中牌：超时打出最右侧一张', b.t.discards.me[0] === '7s' && b.t.hands.me.length === 13);

    // 有选中牌：超时优先打出选中的牌
    fired.length = 0;
    const c = makeTable({ me: H13.slice() });
    c.t.beginTurn('me');
    c.t.pickTile('me', '9p'); // 选中刚摸到的牌
    if (fired.length) fired[0]();
    ok('有选中牌：超时打出选中牌', c.t.discards.me[0] === '9p' && c.t.hands.me.length === 13);
  } finally {
    globalThis.setTimeout = realST;
  }
})();
await (async () => {
  // AI 摸到即胡仍主动胡（等同点击胡按钮）
  const { t } = makeTable({ left: H13.slice() }, { listening: { left: true }, aiSeats: ['left'] });
  t.listenWaits.left = ['3m', '6m'];
  t.hands.left = [...H13, '3m'];
  t.lastDraw.left = '3m';
  t.turn = 'left';
  t.listenTurn('left', '3m');
  ok('AI 摸到即胡：主动胡牌结算', t.phase === 'settle');
})();

/* ============ 十一、定庄与轮庄 ============ */
console.log('\n--- 定庄：首局掷骰，续局沿用 ---');
{
  // 首局：掷骰定庄（清空预设庄家）
  const { t, events } = makeTable({});
  t.dealer = null;
  t.roundNo = 0;
  t.startRound();
  ok('首局掷骰定庄', events.some((e) => e[0] === 'dice') && t.phase === 'dice');
  clearTimeout(t.rollTimer);
}
{
  // 续局：庄家已定 → 不掷骰，直接沿用并发牌
  const { t, events } = makeTable({});
  t.roundNo = 1;
  t.dealer = 'left';
  t.startRound();
  ok('续局不掷骰（无 dice 事件）', !events.some((e) => e[0] === 'dice'));
  const dlr = events.filter((e) => e[0] === 'dealer').pop();
  ok('续局庄家沿用（keep 标记）', !!dlr && dlr[1].keep === true && dlr[1].dealer === 'left');
  ok('续局直接进入发牌', t.phase === 'deal');
  clearTimeout(t.rollTimer);
}
{
  // 庄家胡 → 连庄；他人胡 → 顺时针下家
  const HU13 = ['1p', '1p', '1p', '2s', '3s', '4s', '6s', '7s', '8s', '5m', '5m', '6m', '6m'];
  const { t } = makeTable({ left: HU13.slice() });
  t.roundNo = 1;
  t.dealer = 'me';
  t.phase = 'play';
  t.onHu('left', '5m', false, 'me'); // left 胡（点炮 me）
  ok('他人胡 → 庄家顺时针下家', t.dealer === 'left');
  const t2 = makeTable({ me: HU13.slice() }).t;
  t2.roundNo = 1;
  t2.dealer = 'me';
  t2.phase = 'play';
  t2.onHu('me', '5m', true, 'me'); // 庄家自摸
  ok('庄家胡 → 连庄', t2.dealer === 'me');
}
{
  // 流局 → 庄家连庄
  const { t } = makeTable({});
  t.roundNo = 1;
  t.dealer = 'right';
  t.phase = 'play';
  t.onDraw();
  ok('流局 → 庄家不变', t.dealer === 'right' && t.roundNo === 2);
}

/* ============ 十二、圈巡与场终 ============ */
console.log('\n--- 圈巡：每圈 3 巡（三人各坐庄一次），打满圈数且下庄 → 整场结束 ---');
{
  const HU13 = ['1p', '1p', '1p', '2s', '3s', '4s', '6s', '7s', '8s', '5m', '5m', '6m', '6m'];
  const { t, events } = makeTable({ left: HU13.slice() });
  t.laps = 1;
  t.dealer = 'me';
  t.phase = 'play';
  // 巡1：left 胡（点炮 me）→ 下庄，庄家 left
  t.onHu('left', '5m', false, 'me');
  ok('第1次下庄：rotations=1', t.rotations === 1);
  ok('圈巡名=第一圈第2巡', lapName(t.rotations) === '第一圈第2巡');
  ok('未打满圈数 → 对局继续', t.phase === 'settle' && !events.some((e) => e[0] === 'matchOver'));

  // 巡2：left（庄）自摸 → 连庄不出巡
  t.phase = 'play';
  const before = t.rotations;
  t.onHu('left', '5m', true, 'left');
  ok('庄家自摸连庄 → 不出巡', t.rotations === before && lapName(t.rotations) === '第一圈第2巡');

  // 巡2 结束：right 胡（点炮 left）→ 下庄第2次
  t.phase = 'play';
  t.onHu('right', '5m', false, 'left');
  ok('第2次下庄：第一圈第3巡', t.rotations === 2 && lapName(t.rotations) === '第一圈第3巡');

  // 巡3 结束：me 胡（点炮 right）→ 下庄第3次 = 一圈打满 → 整场结束
  t.phase = 'play';
  t.onHu('me', '5m', false, 'right');
  const over = events.filter((e) => e[0] === 'matchOver').pop();
  ok('1圈打满且下庄 → matchOver', t.rotations === 3 && !!over && over[1].laps === 1);
}
{
  // 两圈：第 4 次下庄 = 第2圈第2巡，第 6 次下庄 = 2圈打满结束
  const HU13 = ['1p', '1p', '1p', '2s', '3s', '4s', '6s', '7s', '8s', '5m', '5m', '6m', '6m'];
  const { t, events } = makeTable({ left: HU13.slice() });
  t.laps = 2;
  t.dealer = 'me';
  t.rotations = 4; // 已进入第2圈第2巡
  t.phase = 'play';
  t.onHu('left', '5m', false, 'me');
  ok('第5次下庄：第二圈第3巡', t.rotations === 5 && lapName(t.rotations) === '第二圈第3巡');
  t.phase = 'play';
  t.onHu('right', '5m', false, 'left');
  const over = events.filter((e) => e[0] === 'matchOver').pop();
  ok('第6次下庄 = 2圈打满 → 整场结束', t.rotations === 6 && !!over);
  ok('流局连庄不推进圈巡（未触发 matchOver）', (() => {
    const { t: t2, events: ev2 } = makeTable({});
    t2.laps = 1;
    t2.dealer = 'me';
    t2.rotations = 2;
    t2.phase = 'play';
    t2.onDraw();
    return t2.rotations === 2 && t2.phase === 'settle' && !ev2.some((e) => e[0] === 'matchOver');
  })());
}

/* ============ 副露玩家报听（单钓将） ============ */
console.log('\n--- 副露玩家单钓将报听（碰 2条 + 暗杠，手 8 张） ---');
{
  // 用户例：手中 6条×3 + 7条 8条 9条 + 發 + 摸 5饼 → 弃 5饼 单钓 發（字牌 10 点）
  const M8 = ['6s', '6s', '6s', '7s', '8s', '9s', 'F', '5p'];
  const mc = listenCandidates(M8);
  ok('副露玩家单钓将可报听（弃5饼听發）', mc.some((c) => c.tile === '5p' && c.waits.includes('F')), JSON.stringify(mc));
  ok('副露玩家胡口成牌可胡（666s 789s 發發）', canHu(['6s', '6s', '6s', '7s', '8s', '9s', 'F', 'F']));
  // 三副露玩家：手 5 张（摸牌巡），弃 9m 单钓北风
  const c5 = listenCandidates(['2s', '3s', '4s', 'N', '9m']);
  ok('三副露玩家单钓可报听（弃9m听北风）', c5.some((c) => c.tile === '9m' && c.waits.includes('N')), JSON.stringify(c5));

  // 桌面 e2e：副露玩家报听 → 被点炮胡 → 普通结算
  const room = {
    code: 'melt', mode: 'x', laps: 1, ownerId: 1, status: 'playing',
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
  t.dealer = 'left';
  t.hands = { me: [...M8], left: [], right: [] };
  t.melds = {
    me: [
      { type: 'peng', tile: '2s', from: 'left' },
      { type: 'gang', tile: '1p', from: 'right', concealed: true },
    ],
    left: [], right: [],
  };
  t.discards = { me: [], left: [], right: [] };
  t.listening = { me: false, left: false, right: false };
  t.listenWaits = { me: [], left: [], right: [] };
  t.listenDiscard = { me: null, left: null, right: null };
  t.lastDraw = { me: '5p', left: null, right: null };
  t.wall = Array.from({ length: 30 }, (_, i) => ({ t: '9m', id: 7000 + i }));
  const lr = t.declareListen('me', '5p');
  ok('副露玩家报听成功（扣5饼听發）', lr.ok && t.listening.me && t.listenWaits.me.includes('F'), JSON.stringify(lr));
  // left（庄家，未听）打出 發 → me 点炮胡（庄家点炮：庄付 2(5+P)=30）
  t.listening.left = false;
  t.listenWaits.left = [];
  t.listening.right = false;
  t.hands.left = ['F'];
  t.lastDraw = { me: null, left: 'F', right: null };
  t.points = { me: 0, left: 0, right: 0 };
  t.discard('left', 'F');
  t.performAction('me', 'hu');
  const st = events.filter((e) => e[0] === 'settle').pop();
  ok(
    '副露玩家被庄家点炮胡 → 庄付 2(5+P)=30',
    t.phase === 'settle' && !!st && st[1].handName === '平胡' && st[1].delta.me === 30 && st[1].delta.left === -30,
    JSON.stringify(st && { name: st[1].handName, delta: st[1].delta }),
  );
}

/* ============ 汇总 ============ */
for (const t of tableList) t.destroy();
console.log(`\n合计 ${passed + failed} 项：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
