/**
 * 定庄后延迟 2 秒再开始对局 —— 回归测试
 *   首局：resolveDealer（掷骰定庄）→ dealer 事件 → 2s → 首个 dealStep（开始发牌）
 *   续局：startRound（连庄/续局定庄）→ dealer 事件 → 2s → 首个 dealStep
 */
import { Table, DEALER_HOLD_MS } from '../src/game/table.js';

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

function mkTable() {
  const room = {
    code: 'delay1',
    mode: '三人经典',
    laps: 1,
    base: 1,
    ownerId: 1,
    status: 'playing',
    players: [
      { userId: 1, nickname: '甲', seat: 'me', ready: true },
      { userId: 2, nickname: '乙', seat: 'left', ready: true },
      { userId: 3, nickname: '丙', seat: 'right', ready: true },
    ],
  };
  const events = [];
  const t = new Table(room, (type, data) => events.push({ type, data, at: Date.now() }));
  room.table = t;
  return { t, events };
}

const firstOf = (events, type) => events.find((e) => e.type === type);
const gap = (a, b) => (a && b ? b.at - a.at : -1);

const near = (ms, target, tol = 220) => Math.abs(ms - target) <= tol;

async function testFirstRound() {
  console.log('--- 首局：掷骰定庄后延迟 ---');
  const { t, events } = mkTable();
  t.startRound(); // 首局：掷骰 → 1.6s 后 resolveDealer
  clearTimeout(t.rollTimer); // 跳过掷骰等待，直接给定骰子结果
  // 直接给出唯一最大点数的骰子结果，跳过 1.6s 等待与平局重掷
  t.resolveDealer({ me: [1, 1], left: [2, 2], right: [3, 3] }); // right 最大
  const dealerEv = firstOf(events, 'dealer');
  ok('定庄事件已下发', !!dealerEv && dealerEv.data.dealer === 'right', JSON.stringify(dealerEv && dealerEv.data));
  const early = firstOf(events, 'dealStep');
  ok('定庄瞬间尚未开始发牌', !early, early ? `已提前 ${early.at - dealerEv.at}ms 发牌` : '');

  await new Promise((r) => setTimeout(r, DEALER_HOLD_MS / 2));
  ok('1 秒时仍在等待（未发牌）', !firstOf(events, 'dealStep'));

  await new Promise((r) => setTimeout(r, DEALER_HOLD_MS));
  const step = firstOf(events, 'dealStep');
  const d = gap(dealerEv, step);
  ok(`定庄 → 开始发牌 ≈ ${DEALER_HOLD_MS}ms`, step && near(d, DEALER_HOLD_MS), `${d}ms`);
  t.destroy();
}

async function testNextRound() {
  console.log('\n--- 续局：连庄定庄后延迟 ---');
  const { t, events } = mkTable();
  t.dealer = 'left'; // 上一局确定庄家 → startRound 走 keep 分支
  t.startRound();
  const dealerEv = firstOf(events, 'dealer');
  ok('续局定庄事件 keep=true', !!dealerEv && dealerEv.data.keep === true, JSON.stringify(dealerEv && dealerEv.data));
  ok('续局定庄瞬间尚未开始发牌', !firstOf(events, 'dealStep'));
  await new Promise((r) => setTimeout(r, DEALER_HOLD_MS + 260));
  const step = firstOf(events, 'dealStep');
  const d = gap(dealerEv, step);
  ok(`续局定庄 → 开始发牌 ≈ ${DEALER_HOLD_MS}ms`, step && near(d, DEALER_HOLD_MS), `${d}ms`);
  t.destroy();
}

async function testCleanup() {
  console.log('\n--- 销毁清理 ---');
  const { t, events } = mkTable();
  t.dealer = 'me';
  t.startRound();
  t.destroy();
  await new Promise((r) => setTimeout(r, DEALER_HOLD_MS + 300));
  ok('destroy 后不再发牌', !firstOf(events, 'dealStep') && t.phase === 'over');
}

await testFirstRound();
await testNextRound();
await testCleanup();

console.log(`\n合计 ${passed + failed} 项：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
