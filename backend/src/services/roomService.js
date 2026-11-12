import { getRoom, setRoom, deleteRoom } from './hotStore.js';

export const SEATS = ['me', 'left', 'right'];
export const SEAT_INDEX = { me: 0, left: 1, right: 2 };

const genCode = () => {
  let code;
  do {
    code = String(100000 + Math.floor(Math.random() * 900000));
  } while (getRoom(code));
  return code;
};

const pubRoom = (room) => ({
  code: room.code,
  mode: room.mode,
  laps: room.laps || room.rounds || 2,
  rounds: room.rounds, // 兼容旧客户端
  base: [1, 2, 5].includes(Number(room.base)) ? Number(room.base) : 1,
  hasPassword: !!room.password,
  status: room.status,
  ownerId: room.ownerId,
  players: room.players.map((p) => ({
    userId: p.userId,
    nickname: p.nickname,
    avatar: p.avatar,
    seat: p.seat,
    ready: p.ready,
    isAI: p.isAI,
  })),
});

export { pubRoom };

/**
 * 创建房间
 * opts: { mode, laps(2|4|8 圈数), password? }
 */
export function createRoom(user, opts = {}) {
  const laps = [2, 4, 8].includes(opts.laps)
    ? opts.laps
    : [2, 4, 8].includes(opts.rounds)
      ? opts.rounds
      : 2; // 兼容旧参数名 rounds
  const base = [1, 2, 5].includes(Number(opts.base)) ? Number(opts.base) : 1; // 底分：结算分数 × base
  const room = {
    code: genCode(),
    mode: opts.mode || '三人经典',
    laps,
    rounds: laps, // 兼容旧字段
    base,
    password: opts.password ? String(opts.password).slice(0, 8) : null,
    ownerId: user.id,
    status: 'waiting', // waiting | playing | finished
    createdAt: Date.now(),
    players: [
      { userId: user.id, nickname: user.nickname, avatar: user.avatar, seat: 'me', ready: false, isAI: false },
    ],
  };
  setRoom(room);
  return room;
}

/** 加入房间（校验房号与密码）；返回 {error?} 或 {room, seat} */
export function joinRoom(user, code, password) {
  const room = getRoom(code);
  if (!room) return { error: '房间不存在或已解散' };
  if (room.status !== 'waiting') return { error: '对局已开始，无法加入' };
  if (room.password && room.password !== String(password || '')) {
    return { error: '房间密码错误' };
  }
  if (room.players.some((p) => p.userId === user.id)) {
    return { room, seat: room.players.find((p) => p.userId === user.id).seat };
  }
  if (room.players.length >= 3) return { error: '房间已满' };
  const used = new Set(room.players.map((p) => p.seat));
  const seat = SEATS.find((s) => !used.has(s));
  room.players.push({
    userId: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    seat,
    ready: false,
    isAI: false,
  });
  setRoom(room);
  return { room, seat };
}

export function leaveRoom(user, code) {
  const room = getRoom(code);
  if (!room || room.status === 'playing') return { error: '对局中无法离开' };
  room.players = room.players.filter((p) => p.userId !== user.id);
  if (!room.players.length) {
    deleteRoom(room.code);
    return { dissolved: true };
  }
  if (room.ownerId === user.id) room.ownerId = room.players[0].userId;
  setRoom(room);
  return { room };
}

export function toggleReady(user, code) {
  const room = getRoom(code);
  if (!room) return { error: '房间不存在' };
  const p = room.players.find((x) => x.userId === user.id);
  if (!p) return { error: '你不在房间中' };
  p.ready = !p.ready;
  setRoom(room);
  return { room, ready: p.ready };
}

/** 邀请 AI 补位（补满三家） */
export function addAI(user, code) {
  const room = getRoom(code);
  if (!room) return { error: '房间不存在' };
  if (room.players.length >= 3) return { error: '房间已满' };
  const used = new Set(room.players.map((p) => p.seat));
  const aiNames = [
    { nickname: '青鸾', avatar: 'qingluan' },
    { nickname: '白鹭', avatar: 'bailu' },
  ];
  for (const info of aiNames) {
    if (room.players.length >= 3) break;
    const seat = SEATS.find((s) => !used.has(s));
    if (!seat) break;
    used.add(seat);
    room.players.push({ userId: -Date.now() - room.players.length, ...info, seat, ready: true, isAI: true });
  }
  setRoom(room);
  return { room };
}

/** 全员就绪？ */
export function allReady(room) {
  return room.players.length === 3 && room.players.every((p) => p.ready);
}
