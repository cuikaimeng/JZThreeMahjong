/**
 * 后端冒烟测试：登录 → 建房 → 加入 → WS 联机 → AI 补位 → 打完一局 → 验证落库
 * 用法：node tools/smoke.js
 */
import WebSocket from 'ws';

const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, token) {
  const resp = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json().catch(() => ({}));
  return { status: resp.status, json };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:3000/ws');
    const state = { events: [], ws };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', data: { token } })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      state.events.push(msg);
      if (msg.t === 'authOk') resolve(state);
      if (msg.t === 'error') console.log(`  [ws-error] ${msg.data.message}`);
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('连接超时')), 5000);
  });
}

function waitEvent(state, type, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const found = state.events.find((e) => e.t === type);
    if (found) return resolve(found);
    const timer = setInterval(() => {
      const f = state.events.find((e) => e.t === type);
      if (f) {
        clearInterval(timer);
        resolve(f);
      }
    }, 100);
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`等待事件 ${type} 超时`));
    }, timeout);
  });
}

const log = (ok, label, extra = '') =>
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' · ' + extra : ''}`);

// ---------- 1. REST ----------
console.log('--- REST ---');
const a = await api('POST', '/api/auth/login', { nickname: '冒烟甲' });
log(a.status === 200 && a.json.token, '登录·甲', a.json.user?.nickname);
const b = await api('POST', '/api/auth/login', { nickname: '冒烟乙' });
log(b.status === 200 && b.json.token, '登录·乙', b.json.user?.nickname);
const tokenA = a.json.token;
const tokenB = b.json.token;

const created = await api('POST', '/api/rooms', { rounds: 4, password: '8241' }, tokenA);
log(created.status === 200 && created.json.room.code, '创建房间', created.json.room?.code);
const code = created.json.room.code;

const wrong = await api('POST', '/api/rooms/join', { code, password: '0000' }, tokenB);
log(wrong.status === 400, '错误密码被拒', wrong.json.error);
const joined = await api('POST', '/api/rooms/join', { code, password: '8241' }, tokenB);
log(joined.status === 200, '正确密码加入', joined.json.room?.players?.length + ' 人');

// ---------- 2. WebSocket 联机 ----------
console.log('--- WebSocket ---');
const A = await connect(tokenA);
const B = await connect(tokenB);
log(true, 'WS 连接+鉴权');

A.ws.send(JSON.stringify({ t: 'join', data: { code } }));
B.ws.send(JSON.stringify({ t: 'join', data: { code } }));
await sleep(300);
const roomState = A.events.find((e) => e.t === 'roomState');
log(roomState && roomState.data.players.length === 2, '双人进房');

B.ws.send(JSON.stringify({ t: 'ready', data: {} }));
await sleep(150);
A.ws.send(JSON.stringify({ t: 'ready', data: {} }));
A.ws.send(JSON.stringify({ t: 'addAI', data: {} }));
await sleep(300);
const rs2 = A.events.filter((e) => e.t === 'roomState').pop();
log(rs2.data.players.length === 3 && rs2.data.players.every((p) => p.ready), 'AI 补位 + 全员就绪');

A.ws.send(JSON.stringify({ t: 'startGame', data: {} }));
const dice = await waitEvent(A, 'dice');
log(true, '掷骰定庄', JSON.stringify(dice.data.totals));
const deal = await waitEvent(A, 'deal');
// 庄家 14 张（先手），闲家 13 张；座位从 roomState 同步推导（避免异步竞态）
const rsLast = A.events.filter((e) => e.t === 'roomState').pop();
const aSeat = (rsLast?.data?.players || []).find((p) => !p.isAI && p.nickname === '冒烟甲')?.seat;
const expectN = aSeat && deal.data.dealer === aSeat ? 14 : 13;
log(Array.isArray(deal.data.hand) && deal.data.hand.length === expectN,
  `发牌(${expectN}张)`, `壁牌 ${deal.data.wallCount} · 庄家=${deal.data.dealer}`);

// AI 自动打牌；真人轮到时自动出首张（模拟客户端行为）
const autoPlay = (state) => {
  setInterval(() => {
    const settle = state.events.find((e) => e.t === 'settle');
    if (settle) return;
    // 响应碰/杠/胡询问：能胡则胡，否则过
    const offer = state.events.filter((e) => e.t === 'offer').pop();
    if (offer && !offer._answered) {
      offer._answered = true;
      state.ws.send(JSON.stringify({ t: offer.data.actions.includes('hu') ? 'hu' : 'action', data: offer.data.actions.includes('hu') ? {} : { type: 'pass' } }));
      return;
    }
    const turn = state.events.filter((e) => e.t === 'turn').pop();
    if (turn && state.meSeat && turn.data.seat === state.meSeat) {
      if (state.myHand.length) {
        state.ws.send(JSON.stringify({ t: 'discard', data: { tile: state.myHand[0] } }));
      }
    }
  }, 300);
};
const trackHand = (state) => {
  setInterval(() => {
    for (const e of state.events) {
      if (e._seen) continue;
      e._seen = true;
      const d = e.data || {};
      if (e.t === 'roomState' && !state.meSeat) {
        state.meSeat = d.players.find((p) => !p.isAI && p.nickname === state.nick)?.seat;
      } else if (e.t === 'deal' && d.hand) {
        state.myHand = d.hand.slice();
      } else if (e.t === 'draw' && d.seat === state.meSeat && d.tile) {
        state.myHand.push(d.tile);
      } else if (e.t === 'discard' && d.seat === state.meSeat) {
        const i = state.myHand.indexOf(d.tile);
        if (i >= 0) state.myHand.splice(i, 1);
      } else if (e.t === 'action' && d.seat === state.meSeat) {
        // 碰/杠：从手牌移除对应张数
        const n = d.type === 'peng' ? 2 : 3;
        for (let k = 0; k < n; k++) {
          const i = state.myHand.indexOf(d.tile);
          if (i >= 0) state.myHand.splice(i, 1);
        }
      }
    }
  }, 80);
};
A.nick = '冒烟甲';
B.nick = '冒烟乙';
trackHand(A);
trackHand(B);
autoPlay(A);
autoPlay(B);

console.log('  对局进行中（AI 与自动出牌）…');
const settle = await waitEvent(A, 'settle', 240000).catch(() => null);
if (settle) {
  const s = settle.data;
  log(true, '一局结算', `${s.handName} · 赢家 ${s.winnerSeat} · ${JSON.stringify(s.delta)}`);
  // 确认下一局机制（收到 roundEnd 后甲乙确认 → dice 再次出现）
  A.ws.send(JSON.stringify({ t: 'nextRound', data: {} }));
  B.ws.send(JSON.stringify({ t: 'nextRound', data: {} }));
  // 续局不再掷骰：等待带 keep 标记的 dealer 事件（首局的 dealer 事件没有该标记）
  let dlr2 = null;
  for (let i = 0; i < 100 && !dlr2; i++) {
    dlr2 = A.events.filter((e) => e.t === 'dealer').find((e) => e.data.keep === true) || null;
    if (!dlr2) await sleep(100);
  }
  // 流局连庄；有人胡 → 顺时针下家；共同点：不重掷骰（keep=true）
  const SEATS = ['me', 'left', 'right'];
  const nextOf = (s) => SEATS[(SEATS.indexOf(s) + 1) % 3];
  log(!!dlr2 && dlr2.data.keep === true
    && (dlr2.data.dealer === deal.data.dealer || dlr2.data.dealer === nextOf(deal.data.dealer)),
  '下一局确认 → 庄家按胡牌结果轮转（不重掷骰）',
  dlr2 ? `庄家=${dlr2.data.dealer}` : '');
} else {
  log(false, '一局结算', '240s 内未出现');
  process.exit(1);
}

// ---------- 3. 战绩落库 ----------
console.log('--- 战绩落库 ---');
await sleep(500);
const hist = await api('GET', '/api/history', null, tokenA);
log(hist.status === 200, '战绩查询', `总场次 ${hist.json.summary?.total} · 点数 ${hist.json.summary?.points}`);
if (hist.json.records?.length) {
  const r0 = hist.json.records[0];
  log(!!r0.round_name && Array.isArray(r0.hand_tiles), '记录字段完整', `${r0.round_name} ${r0.win_type}`);
  const detail = await api('GET', `/api/history/${r0.id}`, null, tokenA);
  log(detail.status === 200 && detail.json.players?.length >= 2, '牌谱详情', `${detail.json.players?.length} 家明细（AI 不入库）`);
}

console.log('\n冒烟测试结束');
process.exit(0);
