/**
 * 联机流程验证：模拟前端（登录 → 建房 → WS 进房 → 补 AI → 准备 → 开局 → 出牌）
 * 断言：骰子 → 定庄 → 逐垛发牌(6×2+1+1) → deal → turn → 摸打循环
 */
import WebSocket from 'ws';

const BASE = 'http://localhost:3000';

const post = async (path, body, token) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, json: await res.json() };
};

const login = await post('/api/auth/login', { nickname: '联调甲' });
const token = login.json.token;
const me = login.json.user;
console.log('✓ 登录', me.nickname, me.id);

const created = await post('/api/rooms', { mode: '三人经典', rounds: 4 }, token);
const code = created.json.room.code;
console.log('✓ 建房', code, '座位', created.json.room.players[0].seat);

const ws = new WebSocket('ws://localhost:3000/ws');
const seen = [];
let myHand = [];
let mySeat = 'me';
let steps = 0;
let discards = 0;

const send = (t, data = {}) => ws.send(JSON.stringify({ t, data }));

ws.on('open', () => send('auth', { token }));
ws.on('message', (raw) => {
  const { t, data = {} } = JSON.parse(raw.toString());
  if (t === 'authOk') {
    send('join', { code });
    return;
  }
  if (t === 'roomState') {
    seen.push(`roomState(${data.players.length})`);
    // 补足 3 人后准备
    if (data.players.length < 3) return send('addAI', {});
    const mine = data.players.find((p) => String(p.userId) === String(me.id));
    if (mine) mySeat = mine.seat;
    const meReady = mine && mine.ready;
    if (!meReady) send('ready', {});
    else if (data.players.every((p) => p.ready) && data.status === 'waiting') send('startGame', {});
    return;
  }
  if (t === 'dice') {
    seen.push(`dice(${JSON.stringify(data.totals)})`);
    return;
  }
  if (t === 'dealer') {
    seen.push(`dealer(${data.dealer})`);
    return;
  }
  if (t === 'dealStep') {
    steps += 1;
    if (data.seat === mySeat && data.tiles) myHand.push(...data.tiles);
    return;
  }
  if (t === 'deal') {
    myHand = data.hand.slice();
    console.log(`✓ 发牌完成：steps=${steps} 手牌=${myHand.length} 壁牌=${data.wallCount}`);
    if (steps !== 10) console.log('✗ 发牌步骤数应为 10，实际', steps);
    return;
  }
  if (t === 'turn') {
    const seat = data.seat;
    if (seat === mySeat) {
      // 模拟玩家出牌（第一张）
      const tile = myHand.shift();
      setTimeout(() => send('discard', { tile }), 120);
    }
    return;
  }
  if (t === 'draw' && data.seat === mySeat && data.tile) {
    myHand.push(data.tile);
    return;
  }
  if (t === 'discard') {
    seen.push('discard');
    discards += 1;
    if (discards === 9) {
      console.log('✓ 9 次出牌完成，回合循环正常');
      console.log('  事件序列:', seen.join(' → '));
      process.exit(0);
    }
  }
  if (t === 'error') console.log('✗ 服务器错误:', data.message);
});

setTimeout(() => {
  console.log('✗ 超时，事件序列:', seen.join(' → '), 'discards=', discards);
  process.exit(1);
}, 60000);
