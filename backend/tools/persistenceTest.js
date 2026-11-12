/**
 * 日志与战绩持久化回归测试（强制 PG 不可用 → 内存降级，不污染真实数据库）
 * 覆盖：登录日志、对局日志、战绩快照、列表/详情查询、前端适配层
 */
process.env.PG_HOST = '127.0.0.1';
process.env.PG_PORT = '1'; // 连不上 → db/index.js 自动降级 MemoryStore

const db = await import('../src/db/index.js');
const {
  upsertUser, writeLoginLog, writeGameLog, logLogin, logGame,
  queryLoginLogs, queryGameLogs, saveGameRecord, queryHistory, queryRecordDetail,
} = db;
const { adaptSummary, adaptRecord, adaptDetail } = await import(
  '../../frontend/js/history/historyAdapter.js'
);

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`✓ ${name}`); }
  else { failed++; console.log(`✗ ${name}${extra ? ` → ${extra}` : ''}`); }
};

ok('PG 已降级为内存存储', !db.pg);
const me = await upsertUser({ openid: 'test:log:me', nickname: '甲', avatar: 'A' });
const other = await upsertUser({ openid: 'test:log:other', nickname: '乙', avatar: 'B' });

console.log('\n— 登录日志 —');
await writeLoginLog({ userId: me.id, openid: 'test:log:me', nickname: '甲', kind: 'http_login', loginType: 'guest', success: true, ip: '127.0.0.1', userAgent: 'test-agent', detail: { tokenHint: 'abcd1234' } });
await writeLoginLog({ userId: me.id, kind: 'ws_auth', loginType: 'token', success: true, ip: '::1' });
await writeLoginLog({ userId: me.id, kind: 'http_login', loginType: 'wechat', success: false, detail: { reason: 'code2session' } });
const logs = await queryLoginLogs(me.id, 10);
ok('写入 3 条登录日志', logs.length === 3, JSON.stringify(logs.map((l) => l.kind)));
ok('按时间倒序（最新在前）', logs[0].kind === 'http_login' && logs[0].success === false);
ok('记录失败登录原因', logs[0].detail && logs[0].detail.reason === 'code2session');
ok('记录 IP / UA / tokenHint', logs[2].ip === '127.0.0.1' && logs[2].userAgent === 'test-agent' && logs[2].detail.tokenHint === 'abcd1234');
ok('仅返回本人日志', (await queryLoginLogs(other.id, 10)).length === 0);
logLogin({ userId: me.id, kind: 'kicked' });
ok('logLogin 安全写入不抛异常', true);

console.log('\n— 对局日志 —');
const snapshot = {
  roundName: '第一圈第1巡', dealerSeat: 'me', winnerSeat: 'left', winTile: '9m',
  hands: { me: ['1m', '2m', '3m'], left: ['4m', '5m', '6m'], right: ['7m', '8m', '9m'] },
  melds: { me: [], left: [], right: [] },
  players: [
    { seat: 'me', nickname: '甲', d: -20 },
    { seat: 'left', nickname: '乙', d: 20 },
    { seat: 'right', nickname: '青鸾', d: 0 },
  ],
  fans: [{ label: '清一色', value: '2 番' }],
  detail: { me: '（点数10）× 倍数2', left: '（点数10）× 倍数2', right: '' },
  totalPoints: 20, wallCount: 12, turnNo: 24, winType: 'zimo',
};
const record = {
  code: 'TST001', mode: '三人经典', laps: 2, base: 1, ownerId: me.id,
  roundNo: 1, roundName: '第一圈第1巡', dealerSeat: 'me', winnerSeat: 'left',
  winType: 'zimo', winTile: '9m', handOwner: 'left', handTiles: ['4m', '5m', '6m'],
  fans: snapshot.fans, totalPoints: 20, wallCount: 12, turnNo: 24, snapshot,
  players: [
    { userId: me.id, seat: 0, delta: -20, isWin: false, isBao: true, handTiles: ['1m', '2m', '3m'], detail: '（点数10）× 倍数2' },
    { userId: other.id, seat: 1, delta: 20, isWin: true, isBao: false, handTiles: ['4m', '5m', '6m'], detail: '（点数10）× 倍数2' },
    { userId: -1, seat: 2, delta: 0, isWin: false, isBao: false, handTiles: ['7m', '8m', '9m'] },
  ],
};
const recordId = await saveGameRecord(record);
for (const [event, direction] of [
  ['game_start', 'sys'], ['dice', 'out'], ['turn', 'out'],
  ['client:discard', 'in'], ['discard', 'out'], ['settle', 'out'],
]) {
  await writeGameLog({ roomCode: 'TST001', roundNo: 1, userId: me.id, seat: 'me', event, direction, payload: { tile: '9m' } });
}
logGame({ roomCode: 'TST001', event: 'room_closed', direction: 'sys' });
const mineLogs = await queryGameLogs(me.id, {});
ok('本人动作日志可查', mineLogs.length === 6, String(mineLogs.length));
ok('日志含开局/结算/出牌', ['game_start', 'settle', 'discard'].every((e) => mineLogs.some((l) => l.event === e)));
ok('日志含客户端动作方向', mineLogs.some((l) => l.direction === 'in' && l.event === 'client:discard'));
const roomLogs = await queryGameLogs(me.id, { roomCode: 'TST001' });
ok('参与者可查整局流水（含系统事件）', roomLogs.length === 7, String(roomLogs.length));
ok('未参与者查不到该房间日志', (await queryGameLogs(99999, { roomCode: 'TST001' })).length === 0);

console.log('\n— 战绩快照与查询 —');
const { summary, records } = await queryHistory(me.id, 20, 0);
ok('列表返回 1 条记录', records.length === 1);
ok('汇总点数为本人累计', Number(summary.points) === -20, String(summary.points));
const r = records[0];
ok('列表含自己手牌', Array.isArray(r.my_hand_tiles) && r.my_hand_tiles[0] === '1m');
ok('列表含房号 / 番型 / 胜负', r.room_code === 'TST001' && r.fans[0].label === '清一色' && r.delta === -20);
const detail = await queryRecordDetail(recordId, me.id);
ok('详情含结算快照', detail && detail.snapshot && detail.snapshot.hands.left.length === 3);
ok('AI 玩家不落玩家明细', detail.players.length === 2, String(detail.players.length));
ok('无权用户取不到详情', !(await queryRecordDetail(recordId, 99999)));

console.log('\n— 前端适配层 —');
const s = adaptSummary({ points: -20, total: 1, wins: 0, winRate: 0 });
ok('汇总适配胜率', s.points === -20 && s.total === 1 && s.winRate === '0%');
const card = adaptRecord(r);
ok('列表适配牌面/结果/标签', card.hand[0] === '1m' && card.result === 'lose' && card.tags.includes('清一色'));
ok('列表适配时间可读', /今天|昨天|月/.test(card.time), card.time);
const view = adaptDetail(detail, me.id);
ok('详情适配三家牌谱', view.players.length === 3 && view.players[0].hand.length === 3);
ok('详情适配自己 / 庄家 / 胡家标记', view.players[0].me && view.players[0].dealer && view.players[1].winner);
ok('详情适配点数明细与分数', view.deltas[0].delta === -20 && view.deltas[0].detail.includes('倍数2'));
ok('详情适配番型与合计', view.fans[0].label === '清一色' && view.total.includes('20'));
ok('详情副标题无重复巡数', (view.round.match(/第 \d+ 巡/g) || []).length <= 1, view.round);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
