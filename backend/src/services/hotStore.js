import { redis } from '../db/index.js';

/**
 * 热数据存储（房间 / 牌局进行时状态）
 *
 * 主存为进程内 Map（单实例部署）；Redis 可用时异步镜像 JSON 快照，
 * 用于多实例扩展与进程重启后的房间恢复。冷数据（结算）落 PostgreSQL。
 */
const rooms = new Map(); // code → room

const mirror = (code, room) => {
  if (redis && room) {
    redis.set(`room:${code}`, JSON.stringify(room)).catch(() => {});
  } else if (redis) {
    redis.del(`room:${code}`).catch(() => {});
  }
};

export function getRoom(code) {
  return rooms.get(String(code)) || null;
}

export function setRoom(room) {
  rooms.set(room.code, room);
  mirror(room.code, room);
}

export function deleteRoom(code) {
  rooms.delete(String(code));
  mirror(code, null);
}

export function roomCount() {
  return rooms.size;
}

/** 恢复（进程重启后从 Redis 拉回；仅恢复等待中的房间） */
export async function restoreRooms() {
  if (!redis) return 0;
  try {
    const keys = await redis.keys('room:*');
    let n = 0;
    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      const room = JSON.parse(raw);
      if (room.status === 'waiting') {
        rooms.set(room.code, room);
        n += 1;
      }
    }
    if (n) console.log(`[hot] restored ${n} waiting room(s) from redis`);
    return n;
  } catch {
    return 0;
  }
}
