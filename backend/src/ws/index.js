import { WebSocketServer } from 'ws';
import { getSession, getUser, logLogin, logGame } from '../db/index.js';
import { getRoom, setRoom, deleteRoom } from '../services/hotStore.js';
import { joinRoom, toggleReady, leaveRoom, addAI, allReady, pubRoom } from '../services/roomService.js';
import { Table } from '../game/table.js';
import { lapName } from '../game/gameRules.js';

/**
 * WebSocket 实时联机
 *
 * 消息格式：JSON { t: '类型', data: {...} }
 * C→S：auth / join / rejoin / ready / addAI / leave / startGame /
 *       discard / action(peng|gang|pass) / hu
 * S→C：authOk / error / roomState / gameStart / wallCommit / dice / dealer / deal / turn /
 *       draw / discard / offer / action / settle / matchOver / roomClosed
 */

const conns = new Set(); // 所有连接
const userConns = new Map(); // userId → ws（同用户多端取最新）

export function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', (ws) => {
    conns.add(ws);
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (raw) => onMessage(ws, raw));
    ws.on('close', () => onClose(ws));
    ws.on('error', () => {});
  });

  // 心跳清理死连接
  setInterval(() => {
    for (const ws of conns) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch { /* ignore */ }
    }
  }, 30_000).unref();
}

function send(ws, t, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t, data }));
}

function sendError(ws, message) {
  send(ws, 'error', { message });
}

/** 日志脱敏：token、密码、整手牌、牌库指纹等不进日志 */
function sanitizeLogData(type, data) {
  if (!data || typeof data !== 'object') return { value: data ?? null };
  const out = { ...data };
  for (const k of ['token', 'password', 'hands', 'tiles', 'ids', 'wallHash', 'listenWaits']) delete out[k];
  if (type === 'deal' || type === 'draw') delete out.tile;
  return out;
}

function wsIp(ws) {
  return String((ws._socket && ws._socket.remoteAddress) || '').slice(0, 64);
}

async function onMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return sendError(ws, '消息格式错误');
  }
  const { t, data = {} } = msg;

  // 客户端行为日志（C→S）：记录操作意图，不记录敏感字段
  const room = ws.roomCode ? getRoom(ws.roomCode) : null;
  logGame({
    roomCode: ws.roomCode || null,
    roundNo: room && room.table ? room.table.roundNo : null,
    userId: ws.user ? ws.user.id : null,
    seat: room && room.table && ws.user ? room.table.seatOf(ws.user.id) : null,
    event: `client:${String(t).slice(0, 30)}`,
    direction: 'in',
    payload: sanitizeLogData(t, data),
  });

  try {
    switch (t) {
      case 'auth':
        return await handleAuth(ws, data);
      case 'join':
      case 'rejoin':
        return handleJoin(ws, data);
      case 'ready':
        return handleReady(ws);
      case 'addAI':
        return handleAddAI(ws);
      case 'leave':
        return handleLeave(ws);
      case 'startGame':
        return handleStart(ws);
      case 'discard':
        return handleDiscard(ws, data);
      case 'pick':
        return handlePick(ws, data);
      case 'action':
        return handleAction(ws, data);
      case 'gang':
        return handleGang(ws, data);
      case 'listen':
        return handleListen(ws, data);
      case 'hu':
        return handleHu(ws);
      case 'nextRound':
        return handleNextRound(ws);
      default:
        return sendError(ws, `未知消息类型: ${t}`);
    }
  } catch (e) {
    console.error('[ws]', e);
    sendError(ws, '服务器内部错误');
  }
}

async function handleAuth(ws, { token } = {}) {
  const ip = wsIp(ws);
  const tokenHint = String(token || '').slice(0, 8);
  const session = await getSession(token);
  if (!session) {
    logLogin({ kind: 'ws_auth', loginType: 'token', success: false, ip, detail: { reason: 'session_expired', tokenHint } });
    return sendError(ws, '登录已过期，请重新登录');
  }
  const user = await getUser(session.userId);
  if (!user) {
    logLogin({ userId: session.userId, kind: 'ws_auth', loginType: 'token', success: false, ip, detail: { reason: 'user_missing' } });
    return sendError(ws, '用户不存在');
  }
  ws.user = user;
  if (userConns.has(user.id)) {
    const old = userConns.get(user.id);
    if (old !== ws && old.readyState === 1) {
      send(old, 'kicked', { reason: '在其他设备登录' });
      logLogin({ userId: user.id, kind: 'kicked', loginType: 'token', success: true, ip, detail: { reason: 'other_device' } });
    }
  }
  userConns.set(user.id, ws);
  logLogin({ userId: user.id, nickname: user.nickname, kind: 'ws_auth', loginType: 'token', success: true, ip, detail: { tokenHint } });
  send(ws, 'authOk', { user });
}

function requireAuth(ws) {
  if (!ws.user) {
    sendError(ws, '请先鉴权（发送 auth）');
    return false;
  }
  return true;
}

function handleJoin(ws, { code }) {
  if (!requireAuth(ws)) return;
  if (!code || !/^\d{6}$/.test(String(code))) return sendError(ws, '请输入 6 位房间号');
  let room = getRoom(String(code));
  let seat;
  if (room && room.players.some((p) => p.userId === ws.user.id)) {
    seat = room.players.find((p) => p.userId === ws.user.id).seat; // 重连/重进
  } else {
    const r = joinRoom(ws.user, String(code), undefined);
    if (r.error) return sendError(ws, r.error);
    room = r.room;
    seat = r.seat;
  }
  ws.roomCode = room.code;
  broadcastRoom(room);
  if (room.table && room.table.phase !== 'over') {
    // 对局中重连：补发当前牌局快照
    send(ws, 'gameResume', tableSnapshot(room, seat));
  }
}

function handleReady(ws) {
  const room = roomOf(ws);
  if (!room) return sendError(ws, '你不在房间中');
  const r = toggleReady(ws.user, room.code);
  if (r.error) return sendError(ws, r.error);
  broadcastRoom(room);
}

function handleAddAI(ws) {
  const room = roomOf(ws);
  if (!room) return sendError(ws, '你不在房间中');
  const r = addAI(ws.user, room.code);
  if (r.error) return sendError(ws, r.error);
  broadcastRoom(room);
}

function handleLeave(ws) {
  const room = roomOf(ws);
  if (!room) return;
  const code = room.code;
  const r = leaveRoom(ws.user, room.code);
  ws.roomCode = null;
  if (r.dissolved) {
    logGame({ roomCode: code, userId: ws.user.id, event: 'room_closed', direction: 'sys', payload: { reason: '房主离开', by: ws.user.nickname } });
    broadcast(room, 'roomClosed', { reason: '房主离开，房间已解散' });
  } else if (r.room) {
    broadcastRoom(r.room);
  }
}

function handleStart(ws) {
  const room = roomOf(ws);
  if (!room) return sendError(ws, '你不在房间中');
  if (room.status === 'playing') return;
  if (!allReady(room)) return sendError(ws, '还有玩家未准备');
  room.status = 'playing';
  setRoom(room);
  logGame({
    roomCode: room.code,
    userId: ws.user.id,
    event: 'game_start',
    direction: 'sys',
    payload: {
      laps: room.laps || room.rounds || 2,
      base: room.base || 1,
      players: room.players.map((p) => ({ seat: p.seat, userId: p.userId, nickname: p.nickname, isAI: !!p.isAI })),
    },
  });
  broadcast(room, 'gameStart', { rounds: room.rounds, laps: room.laps || room.rounds || 2 });
  const table = new Table(room, makeEmitter(room));
  room.table = table;
  table.startMatch();
}

function handleDiscard(ws, { tile }) {
  const room = roomOf(ws);
  if (!room || !room.table) return sendError(ws, '不在对局中');
  const seat = room.table.seatOf(ws.user.id);
  if (!seat) return sendError(ws, '你不是对局玩家');
  room.table.discard(seat, String(tile));
}

/** 上报当前选中的手牌：出牌超时后优先打出这张（不转发给其他玩家） */
function handlePick(ws, { tile } = {}) {
  const room = roomOf(ws);
  if (!room || !room.table) return;
  const seat = room.table.seatOf(ws.user.id);
  if (!seat) return;
  room.table.pickTile(seat, tile ? String(tile) : null);
}

function handleAction(ws, { type }) {
  const room = roomOf(ws);
  if (!room || !room.table) return sendError(ws, '不在对局中');
  const seat = room.table.seatOf(ws.user.id);
  if (!seat || !['peng', 'gang', 'hu', 'pass'].includes(type)) return sendError(ws, '无效动作');
  room.table.performAction(seat, type);
}

function handleGang(ws, { tile }) {
  const room = roomOf(ws);
  if (!room || !room.table) return sendError(ws, '不在对局中');
  const t = room.table;
  const seat = t.seatOf(ws.user.id);
  if (!seat) return sendError(ws, '你不是对局玩家');
  if (!tile) return sendError(ws, '缺少杠的牌');
  if (t.phase !== 'play' || t.turn !== seat) return sendError(ws, '还没轮到你出牌');
  const hand = t.hands[seat] || [];
  const key = String(tile);
  const canA = hand.filter((x) => x === key).length >= 4;
  const canB = (t.melds[seat] || []).some((m) => m.type === 'peng' && m.tile === key);
  if (!canA && !canB) return sendError(ws, '当前无法杠这张牌');
  if (t.gangSelf(seat, key) === false) return sendError(ws, '报听后杠完必须仍有听口');
}

function handleListen(ws, { tile } = {}) {
  const room = roomOf(ws);
  if (!room || !room.table) return sendError(ws, '不在对局中');
  const seat = room.table.seatOf(ws.user.id);
  if (!seat) return sendError(ws, '你不是对局玩家');
  const r = room.table.declareListen(seat, tile ? String(tile) : undefined);
  if (!r.ok) return sendError(ws, r.reason || '当前不能报听');
}

function handleHu(ws) {
  const room = roomOf(ws);
  if (!room || !room.table) return sendError(ws, '不在对局中');
  const seat = room.table.seatOf(ws.user.id);
  if (!seat) return sendError(ws, '你不是对局玩家');
  room.table.huSelf(seat);
}

function handleNextRound(ws) {
  const room = roomOf(ws);
  if (!room || !room.table) return sendError(ws, '不在对局中');
  room.table.requestNextRound(ws.user.id);
}

function onClose(ws) {
  conns.delete(ws);
  if (ws.user && userConns.get(ws.user.id) === ws) userConns.delete(ws.user.id);
  // 等待中的房间：视为离开；对局中：保留座位（超时自动出牌兜底），README 说明
  if (ws.user && ws.roomCode) {
    const room = getRoom(ws.roomCode);
    if (room && room.status === 'waiting') {
      const r = leaveRoom(ws.user, room.code);
      if (r.dissolved) {
        logGame({ roomCode: room.code, userId: ws.user.id, event: 'room_closed', direction: 'sys', payload: { reason: '断线解散' } });
        broadcast(room, 'roomClosed', { reason: '房主离开，房间已解散' });
      }
      else if (r.room) broadcastRoom(r.room);
    }
  }
}

/* ---------- 工具 ---------- */

function roomOf(ws) {
  if (!requireAuth(ws)) return null;
  if (!ws.roomCode) return null;
  return getRoom(ws.roomCode);
}

function broadcast(room, t, data) {
  for (const ws of conns) {
    if (ws.roomCode === room.code && ws.user) send(ws, t, data);
  }
}

/** 房间状态广播 */
function broadcastRoom(room) {
  broadcast(room, 'roomState', pubRoom(room));
}

/**
 * 牌局事件分发：按座位过滤私密信息
 * emit(type, data, targetSeat?)  targetSeat=null 广播
 */
function makeEmitter(room) {
  return (type, data, targetSeat = null) => {
    // 对局过程日志（S→C）：定庄/发牌/摸打/碰杠/报听/结算等全流水
    const t = room.table;
    logGame({
      roomCode: room.code,
      roundNo: t ? t.roundNo : null,
      seat: data && typeof data === 'object' && data.seat ? String(data.seat) : null,
      event: String(type).slice(0, 40),
      direction: 'out',
      payload: sanitizeLogData(type, data),
    });
    for (const ws of conns) {
      if (ws.roomCode !== room.code || !ws.user) continue;
      const seat = room.table ? room.table.seatOf(ws.user.id) : null;
      let payload = data;
      if (type === 'deal') {
        if (!seat) continue; // 非对局玩家不下发手牌
        payload = { ...data, hand: data.hands[seat] };
        delete payload.hands;
      }
      if (type === 'dealStep') {
        if (!seat) continue;
        payload = { ...data };
        if (seat !== data.seat) {
          delete payload.tiles; // 他人发牌只给数量
          delete payload.ids; // 牌的唯一编号同样仅本人可见
        }
      }
      if (type === 'draw') {
        // 他人摸牌不下发牌面与牌编号（避免泄露牌库信息）
        payload = {
          ...data,
          tile: seat === data.seat ? data.tile : null,
          tileId: seat === data.seat ? data.tileId : null,
        };
      }
      if (targetSeat && seat !== targetSeat) continue;
      send(ws, type, payload);
    }
  };
}

function tableSnapshot(room, seat) {
  const t = room.table;
  return {
    phase: t.phase,
    roundNo: t.roundNo,
    rotations: t.rotations,
    roundName: lapName(t.rotations),
    laps: t.laps,
    dealer: t.dealer,
    turn: t.turn,
    hand: sortHandSafe(t.hands[seat]),
    wallCount: t.wall.length,
    wallHash: t.wallHash,
    discards: t.discards,
    melds: t.melds,
    listening: t.listening,
    listenWaits: t.listenWaits,
    listenDiscard: t.listenDiscard,
  };
}

function sortHandSafe(h) {
  return h || [];
}
