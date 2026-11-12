/**
 * 骰子平局重掷回归：
 *   - 最大点数并列时，仅并列者重摇，其余玩家点数保留并退出庄家选择
 *   - 重摇后再比较只在并列者之间进行（退出者即使点数更高也不当庄）
 *   - 定庄后仍保留 2 秒停留再发牌
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
    code: 'tie1',
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

/** 用序列控制随机数：random = [n]/6 时骰子点数为 n+1（需 await 整个等待过程） */
async function withRandom(seq, fn) {
  const orig = Math.random;
  const queue = seq.slice();
  Math.random = () => (queue.length ? queue.shift() : orig());
  try {
    return await fn();
  } finally {
    Math.random = orig;
  }
}

const evOf = (events, type) => events.filter((e) => e.type === type);

async function testTieReroll() {
  console.log('--- 两人并列最大：只重摇这两人 ---');
  const { t, events } = mkTable();
  t.startRound();
  clearTimeout(t.rollTimer);
  // 初始：me=10, left=10（并列最大），right=4（应退出庄家选择）
  t.resolveDealer({ me: [5, 5], left: [5, 5], right: [2, 2] });
  ok('并列时不立即定庄', !evOf(events, 'dealer').length);

  // 重摇：me=[5,2]=7，left=[1,1]=2 —— right 原 4 分更高但不参与比较
  await withRandom([4 / 6, 1 / 6, 0, 0], () => new Promise((r) => setTimeout(r, 1700)));

  const diceEv = evOf(events, 'dice').pop();
  ok('重掷事件标记并列者', diceEv && JSON.stringify(diceEv.data.reroll) === '["me","left"]', diceEv && JSON.stringify(diceEv.data.reroll));
  ok('重掷候选集只含并列者', diceEv && JSON.stringify(diceEv.data.seats) === '["me","left"]', diceEv && JSON.stringify(diceEv.data.seats));
  ok('第三人退出庄家选择', diceEv && JSON.stringify(diceEv.data.out) === '["right"]', diceEv && JSON.stringify(diceEv.data.out));
  ok('退出者点数保留不变', diceEv && diceEv.data.rolls.right.join() === '2,2', diceEv && JSON.stringify(diceEv.data.rolls));

  const dealerEv = evOf(events, 'dealer').pop();
  ok('重摇后定庄为并列者中的最大者', dealerEv && dealerEv.data.dealer === 'me', dealerEv && dealerEv.data.dealer);
  ok('庄家不是点数更高的退出者', dealerEv && dealerEv.data.dealer !== 'right');
  ok('最终点数同步给客户端', dealerEv && dealerEv.data.rolls && diceTotalOf(dealerEv.data.rolls.me) === 7, dealerEv && JSON.stringify(dealerEv.data.rolls));
  t.destroy();
}

function diceTotalOf(pair) {
  return (pair[0] || 0) + (pair[1] || 0);
}

async function testTieTwice() {
  console.log('\n--- 并列者连续平局：继续只重摇并列者 ---');
  const { t, events } = mkTable();
  t.startRound();
  clearTimeout(t.rollTimer);
  t.resolveDealer({ me: [3, 3], left: [3, 3], right: [1, 1] }); // me/left 并列 6
  // 第一次重摇仍平：me=[2,2]=4，left=[2,2]=4
  await withRandom([1 / 6, 1 / 6, 1 / 6, 1 / 6], () => new Promise((r) => setTimeout(r, 1700)));
  const firstDice = evOf(events, 'dice').pop();
  ok('第一次重掷后仍平局', firstDice && JSON.stringify(firstDice.data.reroll) === '["me","left"]', firstDice && JSON.stringify(firstDice.data.reroll));
  ok('第一次重掷后仍未定庄', !evOf(events, 'dealer').length);

  // 第二次重摇：me=[6,6]=12，left=[1,1]=2
  await withRandom([5 / 6, 5 / 6, 0, 0], () => new Promise((r) => setTimeout(r, 1700)));
  const dealerEv = evOf(events, 'dealer').pop();
  ok('第二次重掷定庄为 me', dealerEv && dealerEv.data.dealer === 'me', dealerEv && dealerEv.data.dealer);
  t.destroy();
}

async function testThreeWayTie() {
  console.log('\n--- 三人并列最大：三家全部重摇 ---');
  const { t, events } = mkTable();
  t.startRound();
  clearTimeout(t.rollTimer);
  t.resolveDealer({ me: [4, 4], left: [4, 4], right: [4, 4] });
  await withRandom([5 / 6, 5 / 6, 1 / 6, 1 / 6, 0, 0], () => new Promise((r) => setTimeout(r, 1700)));
  const diceEv = evOf(events, 'dice').pop();
  ok('三人并列 → 三家均重摇', diceEv && diceEv.data.reroll.length === 3, diceEv && JSON.stringify(diceEv.data.reroll));
  ok('三人并列 → 无退出者', diceEv && diceEv.data.out.length === 0, diceEv && JSON.stringify(diceEv.data.out));
  const dealerEv = evOf(events, 'dealer').pop();
  ok('重摇后唯一最大者坐庄', dealerEv && dealerEv.data.dealer === 'me', dealerEv && dealerEv.data.dealer);
  t.destroy();
}

async function testHoldAfterTie() {
  console.log('\n--- 平局重掷后仍保留 2 秒定庄停留 ---');
  const { t, events } = mkTable();
  t.startRound();
  clearTimeout(t.rollTimer);
  t.resolveDealer({ me: [5, 5], left: [5, 5], right: [1, 1] });
  await withRandom([5 / 6, 5 / 6, 0, 0], () => new Promise((r) => setTimeout(r, 1700)));
  const dealerEv = evOf(events, 'dealer').pop();
  const first = evOf(events, 'dealStep')[0];
  ok('定庄瞬间未发牌', !!dealerEv && !first, first ? `提前 ${first.at - dealerEv.at}ms` : '');
  await new Promise((r) => setTimeout(r, DEALER_HOLD_MS + 300));
  const step = evOf(events, 'dealStep')[0];
  const gapMs = step && dealerEv ? step.at - dealerEv.at : -1;
  ok(`定庄 → 发牌 ≈ ${DEALER_HOLD_MS}ms`, Math.abs(gapMs - DEALER_HOLD_MS) <= 250, `${gapMs}ms`);
  t.destroy();
}

await testTieReroll();
await testTieTwice();
await testThreeWayTie();
await testHoldAfterTie();

console.log(`\n合计 ${passed + failed} 项：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
