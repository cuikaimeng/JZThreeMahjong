/**
 * 部署后轻量连通性验证：REST 登录 / 资料 / 战绩 + WebSocket 鉴权
 * 用法：cd backend && node tools/verifyDeploy.js
 *
 * 与 smoke.js 的区别：不建房、不打牌、不写战绩，
 * 只会产生一个测试用户和对应登录日志，适合生产环境部署后自检。
 */
import WebSocket from 'ws';

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:3000';
const WS_URL = process.env.VERIFY_WS || 'ws://127.0.0.1:3000/ws';

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nickname: '部署验证' }),
});
const { token, user } = await login.json();
console.log('登录      :', login.status, user?.nickname || '-', token ? 'token ok' : 'token missing');
if (login.status !== 200 || !token) process.exit(1);

const auth = { Authorization: `Bearer ${token}` };
const me = await fetch(`${BASE}/api/users/me`, { headers: auth });
console.log('资料读取  :', me.status);

const hist = await fetch(`${BASE}/api/history`, { headers: auth });
const h = await hist.json().catch(() => ({}));
console.log('战绩读取  :', hist.status, '总场次', h.summary?.total ?? 0);
if (me.status !== 200 || hist.status !== 200) process.exit(1);

await new Promise((resolve, reject) => {
  const ws = new WebSocket(WS_URL);
  const timer = setTimeout(() => reject(new Error('WS 鉴权超时')), 5000);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', data: { token } })));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.t === 'authOk') {
      clearTimeout(timer);
      console.log('WS 鉴权   : authOk');
      ws.close();
      resolve();
    }
  });
  ws.on('error', reject);
});

console.log('部署验证通过');
process.exit(0);
