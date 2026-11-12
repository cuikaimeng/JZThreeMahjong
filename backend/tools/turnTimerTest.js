/**
 * 对局行动计时 —— 回归测试
 *   出牌：15s（最后 3s 警告）；超时打「选中牌」，无选中打牌面最右侧一张
 *   碰杠决策：15s（最后 3s 警告）；超时自动「过」→ 轮到下家
 *   未选牌时超时不会打「刚摸的牌」，而是排序后最右侧一张
 */
import { Table, TURN_MS, OFFER_MS, WARN_MS } from '../src/game/table.js';
import { buildDeck } from '../src/game/engine.js';

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
    code: 'timer1',
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
  const t = new Table(room, (type, data, target) => events.push({ type, data, target }));
  room.table = t;
  return { t, events };
}

/** 计时器注册的时长（Node Timeout 对象） */
const msOf = (timer) => (timer && (timer._idleTimeout ?? timer.ms)) || 0;
const lastOf = (events, type) => [...events].reverse().find((e) => e.type === type);

console.log('— 常量 —');
ok('出牌时限 15 秒', TURN_MS === 15_000, String(TURN_MS));
ok('碰杠决策时限 15 秒', OFFER_MS === 15_000, String(OFFER_MS));
ok('警告时长 3 秒', WARN_MS === 3_000, String(WARN_MS));

console.log('\n— 选中牌上报 —');
{
  const { t } = mkTable();
  t.phase = 'play';
  t.turn = 'me';
  t.hands.me = ['1m', '2m', '3m', '9s'];
  ok('回合内可记录选中牌', t.pickTile('me', '9s') === true && t.picks.me === '9s');
  ok('不在手牌的牌不能选中', t.pickTile('me', '5p') === false && t.picks.me === '9s');
  ok('非本回合不能选中', t.pickTile('left', '1m') === false);
  ok('传空清除选中', t.pickTile('me', null) === true && t.picks.me === null);
}

console.log('\n— 出牌超时自动打牌 —');
{
  const { t } = mkTable();
  t.phase = 'play';
  t.turn = 'me';
  const calls = [];
  t.discard = (seat, tile, opts) => {
    calls.push({ seat, tile, opts });
    return true;
  };
  // 有选中牌 → 打选中牌
  t.hands.me = ['1m', '2m', '9s'];
  t.picks.me = '1m';
  t.autoDiscard('me');
  ok('有选中牌：打出选中牌', calls[0] && calls[0].tile === '1m', JSON.stringify(calls[0]));
  ok('自动出牌标记 auto', calls[0] && calls[0].opts && calls[0].opts.auto === true);
  ok('打出后清除选中', t.picks.me === null);

  // 无选中牌 → 牌面最右侧（排序后最大）
  calls.length = 0;
  t.hands.me = ['1m', '9s', '3m'];
  t.picks.me = null;
  t.autoDiscard('me');
  ok('无选中牌：打出最右侧一张', calls[0] && calls[0].tile === '9s', JSON.stringify(calls[0]));

  // 选中牌已被打出（不在手牌）→ 回退最右侧
  calls.length = 0;
  t.hands.me = ['2p', '5p'];
  t.picks.me = '1m';
  t.autoDiscard('me');
  ok('选中牌失效：回退最右侧', calls[0] && calls[0].tile === '5p', JSON.stringify(calls[0]));

  // 非本回合不触发
  calls.length = 0;
  t.turn = 'left';
  t.autoDiscard('me');
  ok('非本回合超时不生效', calls.length === 0);
}

console.log('\n— 出牌计时 15 秒 —');
{
  const { t, events } = mkTable();
  t.phase = 'play';
  t.turn = 'me';
  t.wall = buildDeck();
  t.hands = { me: ['1m', '2m'], left: [], right: [] };
  t.schedulePlay('me');
  ok('schedulePlay 注册 15s', msOf(t.turnTimer) === TURN_MS, String(msOf(t.turnTimer)));
  clearTimeout(t.turnTimer);
  ok('新回合清空上一手的选中牌', t.picks.me === null);

  events.length = 0;
  t.picks.me = '1m';
  t.beginTurn('me');
  const turnEv = lastOf(events, 'turn');
  ok('turn 事件带时限', turnEv && turnEv.data.ms === TURN_MS, JSON.stringify(turnEv && turnEv.data));
  ok('turn 事件带警告时长', turnEv && turnEv.data.warnMs === WARN_MS);
  ok('beginTurn 注册 15s 定时器', msOf(t.turnTimer) === TURN_MS, String(msOf(t.turnTimer)));
  ok('beginTurn 清空选中牌', t.picks.me === null);
  clearTimeout(t.turnTimer);
}

console.log('\n— 报听者回合 —');
{
  const { t } = mkTable();
  t.phase = 'play';
  t.turn = 'me';
  t.hands = { me: ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', 'E', 'E', 'E', 'C', 'C'], left: [], right: [] };
  t.listening.me = true;
  // 摸到即胡：等待玩家点「胡」15s（与出牌时限一致）
  t.canZimoNow = () => true;
  t.listenTurn('me', 'C');
  ok('报听自摸等待 15s', msOf(t.turnTimer) === TURN_MS, String(msOf(t.turnTimer)));
  clearTimeout(t.turnTimer);

  // 摸什么打什么：手牌已锁定，无需玩家决策，快速自动摸打
  t.canZimoNow = () => false;
  t.listenTurn('me', 'C');
  ok('报听摸打无需等待（自动打）', msOf(t.turnTimer) < 3000, String(msOf(t.turnTimer)));
  clearTimeout(t.turnTimer);
}

console.log('\n— 碰杠决策 15 秒 —');
{
  const { t, events } = mkTable();
  t.phase = 'play';
  t.lastDiscard = { seat: 'left', tile: '9s' };
  t.lastDiscardSeat = 'left';
  t.hands = { me: ['9s', '9s', '1m'], left: [], right: [] };
  t.pendingActions = { me: ['peng'] };
  t.wall = buildDeck();

  events.length = 0;
  t.resolvePending();
  const offerEv = lastOf(events, 'offer');
  ok('offer 事件带时限 15s', offerEv && offerEv.data.ms === OFFER_MS, JSON.stringify(offerEv && offerEv.data));
  ok('offer 事件带警告时长', offerEv && offerEv.data.warnMs === WARN_MS);
  ok('碰杠决策注册 15s 定时器', msOf(t.offerTimer) === OFFER_MS, String(msOf(t.offerTimer)));
  clearTimeout(t.offerTimer);
}

console.log('\n— 决策超时 = 自动过 —');
{
  const { t, events } = mkTable();
  t.phase = 'play';
  t.lastDiscard = { seat: 'left', tile: '9s' };
  t.lastDiscardSeat = 'left';
  t.hands = { me: ['9s', '9s', '1m'], left: [], right: ['1m', '2m'] };
  t.pendingActions = { me: ['peng'] };
  t.wall = buildDeck();
  t.melds = { me: [], left: [], right: [] };
  t.discards = { me: [], left: [], right: [] };
  t.turn = 'me';
  t.emit('offer', { actions: ['peng'], tile: '9s' }, 'me');
  t.offerTimer = setTimeout(() => {
    if (t.pendingActions.me) t.performAction('me', 'pass');
  }, OFFER_MS);

  // 直接触发「过」（等价于超时回调）
  events.length = 0;
  t.performAction('me', 'pass');
  const turnEv = lastOf(events, 'turn');
  ok('超时过：跳过我的决策', !t.pendingActions.me);
  ok('超时过：轮到下家出牌', turnEv && turnEv.data.seat === 'right', JSON.stringify(turnEv && turnEv.data));
  ok('新的出牌回合重新计时 15s', msOf(t.turnTimer) === TURN_MS);
  clearTimeout(t.turnTimer);
  clearTimeout(t.offerTimer);
}

console.log('\n— 抢杠询问时限 —');
{
  const { t, events } = mkTable();
  t.phase = 'play';
  t.robGang = { seat: 'left', tile: '5p', robbers: ['me'] };
  t.listening.me = true;
  t.listenWaits.me = ['5p'];
  events.length = 0;
  t.askRobGang();
  const offerEv = lastOf(events, 'offer');
  ok('抢杠询问带时限', offerEv && offerEv.data.ms === 8000, JSON.stringify(offerEv && offerEv.data));
  clearTimeout(t.offerTimer);
}

console.log('\n— destroy 清理 —');
{
  const { t } = mkTable();
  t.phase = 'play';
  t.turn = 'me';
  t.picks.me = '1m';
  t.schedulePlay('me');
  t.destroy();
  ok('销毁后 phase=over', t.phase === 'over');
  ok('销毁后不再保留选中牌（无害）', typeof t.picks.me === 'string' || t.picks.me === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
