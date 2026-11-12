import pgFactory from './postgres.js';
import redisFactory from './redis.js';
import { MemoryStore } from './memory.js';

/**
 * 存储抽象：
 * - PG 可用 → SQL 持久化；不可用 → 内存表（开发降级，重启丢失）
 * - Redis 可用 → 热数据进 Redis；不可用 → 进程内 Map
 */

export const pg = await pgFactory();
export const redis = await redisFactory();

// 内存降级实例（pg/redis 任一不可用时对应启用）
const mem = new MemoryStore();

/* ==================== 会话 ==================== */

export async function saveSession(token, userId, ttlMs) {
  if (redis) {
    await redis.set(`session:${token}`, String(userId), 'PX', ttlMs);
    return;
  }
  mem.sessions.set(token, { userId, expires: Date.now() + ttlMs });
}

export async function getSession(token) {
  if (redis) {
    const v = await redis.get(`session:${token}`);
    return v ? { userId: Number(v) } : null;
  }
  const s = mem.sessions.get(token);
  if (!s || s.expires < Date.now()) return null;
  return { userId: s.userId };
}

export async function dropSession(token) {
  if (redis) return redis.del(`session:${token}`);
  mem.sessions.delete(token);
}

/* ==================== 审计日志 ==================== */

/**
 * 登录日志：HTTP 登录 / WS 鉴权 / 顶号 / 失败登录
 * 写入是 fire-and-forget（logLogin 包装），失败不影响主流程
 */
export async function writeLoginLog(entry) {
  const row = {
    userId: entry.userId ?? null,
    openid: entry.openid ?? null,
    nickname: entry.nickname ?? null,
    kind: entry.kind || 'http_login',
    loginType: entry.loginType ?? null,
    success: entry.success !== false,
    ip: entry.ip ?? null,
    userAgent: String(entry.userAgent || '').slice(0, 256) || null,
    detail: entry.detail || {},
    createdAt: new Date(),
  };
  if (pg) {
    await pg.query(
      `INSERT INTO login_logs (user_id, openid, nickname, kind, login_type, success, ip, user_agent, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        row.userId,
        row.openid,
        row.nickname,
        row.kind,
        row.loginType,
        row.success,
        row.ip,
        row.userAgent,
        JSON.stringify(row.detail),
      ]
    );
    return;
  }
  mem.loginLogs.push({ id: mem.nextId(), ...row });
}

/** 游戏对局日志：开局 → 摸打/碰杠/报听 → 结算 → 整场结束 / 房间解散 */
export async function writeGameLog(entry) {
  const row = {
    roomCode: entry.roomCode ?? null,
    roundNo: entry.roundNo ?? null,
    userId: entry.userId ?? null,
    seat: entry.seat ?? null,
    event: String(entry.event || 'event').slice(0, 40),
    direction: entry.direction || 'sys',
    payload: entry.payload || {},
    createdAt: new Date(),
  };
  if (pg) {
    await pg.query(
      `INSERT INTO game_logs (room_code, round_no, user_id, seat, event, direction, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        row.roomCode,
        row.roundNo,
        row.userId,
        row.seat,
        row.event,
        row.direction,
        JSON.stringify(row.payload),
      ]
    );
    return;
  }
  mem.gameLogs.push({ id: mem.nextId(), ...row });
}

/** 安全写入：日志表异常只告警，绝不阻塞业务 */
export function logLogin(entry) {
  writeLoginLog(entry).catch((e) => console.warn('[log] login:', e.message));
}
export function logGame(entry) {
  writeGameLog(entry).catch((e) => console.warn('[log] game:', e.message));
}

/* ==================== 用户 ==================== */

export async function upsertUser({ openid = null, nickname, avatar = 'me', avatarUrl = null }) {
  if (pg) {
    const r = await pg.query(
      `INSERT INTO users (openid, nickname, avatar, avatar_url) VALUES ($1,COALESCE($2,'麻友'),$3,$4)
       ON CONFLICT (openid) DO UPDATE SET
         nickname = CASE WHEN $5::boolean THEN EXCLUDED.nickname ELSE users.nickname END,
         avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
         updated_at = now()
       RETURNING id, openid, nickname, avatar, avatar_url, points, total_games, total_wins`,
      [openid, nickname, avatar, avatarUrl, Boolean(nickname)]
    );
    return r.rows[0];
  }
  let u = openid && mem.users.find((x) => x.openid === openid);
  if (!u) {
    u = {
      id: mem.nextId(),
      openid,
      nickname,
      avatar,
      avatar_url: avatarUrl || null,
      points: 0,
      total_games: 0,
      total_wins: 0,
      created_at: new Date(),
    };
    mem.users.push(u);
  } else {
    if (nickname) u.nickname = nickname;
    if (avatarUrl) u.avatar_url = avatarUrl;
  }
  return u;
}

/** 更新玩家资料（微信授权后自动写入昵称 / 头像） */
export async function updateUser(id, { nickname, avatarUrl } = {}) {
  if (pg) {
    const r = await pg.query(
      `UPDATE users SET
         nickname = COALESCE($2, nickname),
         avatar_url = COALESCE($3, avatar_url),
         updated_at = now()
       WHERE id=$1
       RETURNING id, openid, nickname, avatar, avatar_url, points, total_games, total_wins`,
      [id, nickname || null, avatarUrl || null]
    );
    return r.rows[0] || null;
  }
  const u = mem.users.find((x) => x.id === id);
  if (!u) return null;
  if (nickname) u.nickname = nickname;
  if (avatarUrl) u.avatar_url = avatarUrl;
  return { ...u };
}

export async function getUser(id) {
  if (pg) {
    const r = await pg.query(
      'SELECT id, nickname, avatar, avatar_url, points, total_games, total_wins FROM users WHERE id=$1',
      [id]
    );
    return r.rows[0] || null;
  }
  const u = mem.users.find((x) => x.id === id);
  if (!u) return null;
  const { openid, ...pub } = u;
  return pub;
}

/* ==================== 对局冷数据落库 ==================== */

export async function saveRoomArchive({ code, mode, rounds, password, ownerId, status }) {
  rounds = rounds ?? 2; // 兼容旧表：圈数缺省 2
  if (pg) {
    const r = await pg.query(
      `INSERT INTO rooms (code, mode, rounds, base_points, password, owner_id, status, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now()) RETURNING id`,
      [code, mode, rounds, 2, password || null, ownerId, status]
    );
    return r.rows[0].id;
  }
  const id = mem.nextId();
  mem.rooms.push({ id, code, mode, rounds, password, owner_id: ownerId, status });
  return id;
}

/**
 * 保存一局结算记录 + 三家明细，并累计用户战绩
 * record: { code, mode, rounds, password, ownerId, roundNo, roundName, dealerSeat,
 *           winnerSeat, winType, winTile, handOwner, handTiles, fans, totalPoints,
 *           wallCount, turnNo, snapshot（三家牌面/副露/番型完整快照）,
 *           players: [{userId, seat, delta, isWin, isBao, handTiles}] }
 */
export async function saveGameRecord(record) {
  const roomId = await saveRoomArchive({
    code: record.code,
    mode: record.mode,
    rounds: record.rounds,
    password: record.password,
    ownerId: record.ownerId,
    status: 'finished',
  });

  // AI 玩家（负数虚拟 userId）不入库，只结算真人
  const realPlayers = record.players.filter((p) => p.userId > 0);

  if (pg) {
    const r = await pg.query(
      `INSERT INTO game_records
         (room_id, round_no, round_name, dealer_seat, winner_seat, win_type, win_tile,
          hand_owner, hand_tiles, fans, total_points, wall_count, turn_no, snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [
        roomId,
        record.roundNo,
        record.roundName,
        record.dealerSeat,
        record.winnerSeat ?? null,
        record.winType,
        record.winTile ?? null,
        record.handOwner ?? null,
        JSON.stringify(record.handTiles || []),
        JSON.stringify(record.fans || []),
        record.totalPoints,
        record.wallCount,
        record.turnNo,
        JSON.stringify(record.snapshot || {}),
      ]
    );
    const recordId = r.rows[0].id;
    for (const p of realPlayers) {
      await pg.query(
        `INSERT INTO game_record_players
           (record_id, user_id, seat, delta, is_win, is_bao, hand_tiles, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [recordId, p.userId, p.seat, p.delta, p.isWin, p.isBao, JSON.stringify(p.handTiles || []), p.detail || '']
      );
      await applyUserStats(p);
    }
    return recordId;
  }

  // 内存降级
  const recordId = mem.nextId();
  mem.records.push({
    id: recordId,
    room_id: roomId,
    room_code: record.code,
    room_mode: record.mode,
    round_no: record.roundNo,
    round_name: record.roundName,
    dealer_seat: record.dealerSeat,
    wall_count: record.wallCount,
    turn_no: record.turnNo,
    hand_owner: record.handOwner ?? null,
    winner_seat: record.winnerSeat ?? null,
    win_type: record.winType,
    win_tile: record.winTile ?? null,
    hand_tiles: record.handTiles || [],
    fans: record.fans || [],
    total_points: record.totalPoints,
    snapshot: record.snapshot || {},
    finished_at: new Date(),
    players: realPlayers.map((p) => ({ ...p })),
  });
  for (const p of realPlayers) await applyUserStats(p);
  return recordId;
}

async function applyUserStats(p) {
  const d = p.delta || 0;
  if (pg) {
    await pg.query(
      `UPDATE users SET points = points + $1,
         total_games = total_games + 1,
         total_wins = total_wins + $2, updated_at = now()
       WHERE id = $3`,
      [d, p.isWin ? 1 : 0, p.userId]
    );
  } else {
    const u = mem.users.find((x) => x.id === p.userId);
    if (u) {
      u.points += d;
      u.total_games += 1;
      if (p.isWin) u.total_wins += 1;
    }
  }
}

/* ==================== 战绩查询 ==================== */

export async function queryHistory(userId, limit = 20, offset = 0) {
  if (pg) {
    const summary = await pg.query(
      `SELECT COALESCE(SUM(p.delta),0) AS points, COUNT(*) AS total,
              COUNT(*) FILTER (WHERE p.is_win) AS wins
       FROM game_record_players p WHERE p.user_id=$1`,
      [userId]
    );
    const rows = await pg.query(
      `SELECT r.id, r.round_name, r.round_no, r.turn_no, r.wall_count,
              r.dealer_seat, r.winner_seat, r.win_type, r.win_tile, r.hand_tiles,
              r.hand_owner, r.fans, r.total_points, r.finished_at,
              p.delta, p.is_win, p.is_bao, p.hand_tiles AS my_hand_tiles, p.detail,
              rm.code AS room_code, rm.mode AS room_mode
       FROM game_record_players p
       JOIN game_records r ON r.id = p.record_id
       JOIN rooms rm ON rm.id = r.room_id
       WHERE p.user_id = $1
       ORDER BY r.finished_at DESC, r.id DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return { summary: summary.rows[0], records: rows.rows };
  }

  const mine = mem.records.filter((r) => r.players.some((p) => p.userId === userId));
  const slice = mine.slice().reverse().slice(offset, offset + limit);
  const all = mem.records.filter((r) => r.players.some((p) => p.userId === userId));
  let points = 0;
  let wins = 0;
  for (const r of all) {
    const p = r.players.find((x) => x.userId === userId);
    if (p) {
      points += p.delta;
      if (p.isWin) wins += 1;
    }
  }
  return {
    summary: { points, total: all.length, wins },
    records: slice.map((r) => {
      const p = r.players.find((x) => x.userId === userId);
      return {
        id: r.id,
        round_name: r.round_name,
        round_no: r.round_no,
        turn_no: r.turn_no || 0,
        wall_count: r.wall_count || 0,
        dealer_seat: r.dealer_seat ?? null,
        winner_seat: r.winner_seat ?? null,
        win_type: r.win_type,
        win_tile: r.win_tile,
        hand_tiles: r.hand_tiles,
        hand_owner: r.hand_owner ?? null,
        fans: r.fans,
        total_points: r.total_points,
        finished_at: r.finished_at,
        delta: p.delta,
        is_win: p.isWin,
        is_bao: p.isBao || false,
        my_hand_tiles: p.handTiles || [],
        detail: p.detail || '',
        room_code: r.room_code || '',
        room_mode: r.room_mode || '',
        players: r.players,
      };
    }),
  };
}

export async function queryRecordDetail(recordId, userId) {
  if (pg) {
    const rec = await pg.query(
      `SELECT r.* FROM game_records r
       JOIN game_record_players p ON p.record_id = r.id
       WHERE r.id=$1 AND p.user_id=$2`,
      [recordId, userId]
    );
    if (!rec.rows[0]) return null;
    const players = await pg.query(
      `SELECT p.user_id, p.seat, p.delta, p.is_win, p.is_bao, p.hand_tiles, p.detail, u.nickname
       FROM game_record_players p JOIN users u ON u.id=p.user_id
       WHERE p.record_id=$1 ORDER BY p.seat`,
      [recordId]
    );
    return { ...rec.rows[0], players: players.rows };
  }
  const r = mem.records.find((x) => x.id === recordId && x.players.some((p) => p.userId === userId));
  if (!r) return null;
  return {
    ...r,
    players: r.players.map((p) => ({ ...p, nickname: mem.users.find((u) => u.id === p.userId)?.nickname || '' })),
  };
}

/* ==================== 日志查询 ==================== */

/** 某人最近的登录日志（仅本人可见） */
export async function queryLoginLogs(userId, limit = 20) {
  const n = Math.min(Math.max(Number(limit) || 20, 1), 50);
  if (pg) {
    const r = await pg.query(
      `SELECT id, kind, login_type, success, ip, user_agent, detail, created_at
       FROM login_logs WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [userId, n]
    );
    return r.rows;
  }
  return mem.loginLogs
    .filter((l) => l.userId === userId)
    .slice()
    .reverse()
    .slice(0, n);
}

/**
 * 对局日志：不传 roomCode 时返回本人产生的日志；
 * 传 roomCode 时校验本人参与过该房间，再返回整局流水。
 */
export async function queryGameLogs(userId, { roomCode, limit = 100 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), 200);
  if (pg) {
    if (roomCode) {
      const joined = await pg.query(
        `SELECT 1 FROM game_record_players p
         JOIN game_records r ON r.id=p.record_id
         JOIN rooms rm ON rm.id=r.room_id
         WHERE p.user_id=$1 AND rm.code=$2 LIMIT 1`,
        [userId, roomCode]
      );
      if (!joined.rows.length) return [];
    }
    const r = await pg.query(
      `SELECT id, room_code, round_no, seat, event, direction, payload, created_at
       FROM game_logs WHERE ${roomCode ? 'room_code=$1' : 'user_id=$1'}
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      roomCode ? [roomCode, n] : [userId, n]
    );
    return r.rows;
  }
  if (roomCode && !mem.records.some((r) => r.room_code === roomCode && r.players.some((p) => p.userId === userId))) {
    return [];
  }
  const rows = roomCode
    ? mem.gameLogs.filter((l) => l.roomCode === roomCode)
    : mem.gameLogs.filter((l) => l.userId === userId);
  return rows.slice().reverse().slice(0, n);
}
