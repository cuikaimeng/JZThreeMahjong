/**
 * 公平发牌测试
 *
 * 规则：
 *  1. 对局开始前，136 张牌一次性洗牌定序，之后不可变（wallCommit 指纹承诺）
 *  2. 每张牌有唯一编号（id 0-135）
 *  3. 任何一次发牌/摸牌都严格按牌库顺序取牌
 *  4. 杠牌固定从牌库最后一张获取（含壁牌区）
 */
import {
  buildDeck,
  buildWall,
  drawLiveTile,
  drawGangTile,
  deckFingerprint,
  WALL_KEEP,
  SUITS,
  HONORS,
} from '../src/game/engine.js';
import { Table } from '../src/game/table.js';

let passed = 0;
let failed = 0;
function ok(name, cond, extra = '') {
  if (cond) passed += 1;
  else failed += 1;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' · ' + extra : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============ 一、牌库构成与唯一编号 ============ */
console.log('\n--- 牌库构成 ---');
{
  const deck = buildDeck();
  ok('总数 136 张', deck.length === 136, String(deck.length));
  const ids = deck.map((d) => d.id);
  ok('编号唯一且为 0-135', new Set(ids).size === 136 && Math.min(...ids) === 0 && Math.max(...ids) === 135);
  const cnt = new Map();
  for (const d of deck) cnt.set(d.t, (cnt.get(d.t) || 0) + 1);
  ok('34 种牌各 4 张', cnt.size === 34 && [...cnt.values()].every((c) => c === 4));
  ok('万筒条各 36 + 字牌 28', SUITS.every((s) => deck.filter((d) => d.t.endsWith(s)).length === 36)
    && deck.filter((d) => HONORS.includes(d.t)).length === 28);
  const deck2 = buildDeck();
  ok('每次开局洗牌（顺序随机）', JSON.stringify(deck.map((d) => d.id)) !== JSON.stringify(deck2.map((d) => d.id)));
}

/* ============ 二、定序指纹 ============ */
console.log('\n--- wallCommit 指纹 ---');
{
  const deck = buildDeck();
  const h1 = deckFingerprint(deck);
  ok('指纹为 64 位 hex', /^[0-9a-f]{64}$/.test(h1));
  ok('同一顺序 → 同一指纹', deckFingerprint(deck) === h1);
  const shuffled = deck.slice().reverse();
  ok('顺序不同 → 指纹不同', deckFingerprint(shuffled) !== h1);
  ok('指纹与旧接口 buildWall 兼容并存', Array.isArray(buildWall()) && buildWall().length === 136);
}

/* ============ 三、按牌库顺序发牌 ============ */
console.log('\n--- 发牌严格按牌库顺序 ---');
{
  const deck = buildDeck();
  ok('普通摸牌：剩壁牌时返回 null（流局）',
    drawLiveTile(Array(WALL_KEEP)) === null && drawLiveTile(Array(WALL_KEEP + 1)) !== null,
    `WALL_KEEP=${WALL_KEEP}`);
  // 依次摸牌 = 从牌库末尾按顺序消费（17 张 = 壁牌 14 + 可摸 3）
  const small = Array.from({ length: 17 }, (_, i) => ({ t: '9p', id: i }));
  const drawn = [];
  let c;
  while ((c = drawLiveTile(small))) drawn.push(c.id);
  ok('发牌顺序与牌库顺序一致（从末尾依序）', JSON.stringify(drawn) === JSON.stringify([16, 15, 14]),
    `摸到 ${drawn.join(',')}，剩壁牌 ${small.length} 张`);
}

/* ============ 四、杠牌取牌库最后一张 ============ */
console.log('\n--- 杠牌从牌库最后一张获取 ---');
{
  const deck = [{ t: '1m', id: 0 }, { t: '2m', id: 1 }, { t: '3m', id: 2 }];
  const c = drawGangTile(deck);
  ok('杠牌取最后一张', c.id === 2 && c.t === '3m' && deck.length === 2);
  // 壁牌区也参与杠牌：只剩 WALL_KEEP 张仍可杠
  const dead = Array.from({ length: WALL_KEEP }, (_, i) => ({ t: '9p', id: 100 + i }));
  const g = drawGangTile(dead);
  ok('壁牌区（最后 14 张）也能被杠取', g.id === 100 + WALL_KEEP - 1 && dead.length === WALL_KEEP - 1);
  ok('牌库耗尽后杠牌返回 null（流局）', drawGangTile([]) === null);
  // 普通摸牌不能动用壁牌，杠牌可以 —— 两者取牌位置不同
  ok('普通摸牌受壁牌保护，杠牌不受', drawLiveTile(dead) === null && drawGangTile(dead) !== null);
}

/* ============ 五、对局集成：wallCommit + 发牌顺序 ============ */
console.log('\n--- 对局集成 ---');
{
  const room = {
    code: 'ft', mode: '三人经典', rounds: 4, ownerId: 1, status: 'playing',
    players: [
      { userId: 1, nickname: '甲', seat: 'me', ready: true, isAI: false },
      { userId: 2, nickname: '乙', seat: 'left', ready: true, isAI: false },
      { userId: 3, nickname: '丙', seat: 'right', ready: true, isAI: false },
    ],
  };
  const events = [];
  const t = new Table(room, (type, data) => events.push([type, data]));
  // 手动定序（跳过掷骰动画）：等价于 startRound 的定序步骤
  t.phase = 'deal';
  t.dealer = 'me';
  t.wall = buildDeck();
  const deckSnapshot = t.wall.slice(); // 定序后的完整牌库（不可变承诺的对照基准）
  t.wallHash = deckFingerprint(deckSnapshot);
  t.hands = { me: [], left: [], right: [] };
  t.melds = { me: [], left: [], right: [] };
  t.discards = { me: [], left: [], right: [] };
  t.listening = { me: false, left: false, right: false };
  t.lastDraw = { me: null, left: null, right: null };
  t.emit('wallCommit', { roundNo: t.roundNo, hash: t.wallHash, count: t.wall.length });
  t.deal();

  // 等待发牌动画完成
  for (let i = 0; i < 60 && t.phase !== 'play'; i++) await sleep(100);

  const commits = events.filter((e) => e[0] === 'wallCommit');
  const steps = events.filter((e) => e[0] === 'dealStep');
  ok('wallCommit 先于发牌', commits.length === 1 && steps.length > 0);
  ok('指纹 = 开局定序的 SHA-256', commits[0][1].hash === deckFingerprint(deckSnapshot));
  ok('定序不可变：发牌后指纹不变', t.wallHash === deckFingerprint(deckSnapshot));

  // 发出的每张牌编号 = 牌库末尾依序消费
  const dealtIds = steps.flatMap(([, d]) => d.ids || []);
  const expectedIds = deckSnapshot.slice(-dealtIds.length).map((d) => d.id).reverse();
  ok('发牌编号序列 = 牌库末尾依序', JSON.stringify(dealtIds) === JSON.stringify(expectedIds),
    `共发 ${dealtIds.length} 张`);
  ok('每人 13 张、庄家 14 张', t.hands.me.length === 14 && t.hands.left.length === 13 && t.hands.right.length === 13);

  // 杠牌：从当前牌库最后一张获取
  const tailBefore = t.wall[t.wall.length - 1];
  t.phase = 'play';
  t.turn = 'me';
  const before = events.length;
  t.gangDrawAndTurn('me');
  const drawEvt = events.slice(before).find((e) => e[0] === 'draw');
  ok('杠牌事件 source=tail', !!drawEvt && drawEvt[1].source === 'tail');
  ok('杠到的编号 = 牌库最后一张', drawEvt[1].tileId === tailBefore.id && drawEvt[1].tile === tailBefore.t);
  t.destroy();
}

/* ============ 汇总 ============ */
console.log(`\n合计 ${passed + failed} 项：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
