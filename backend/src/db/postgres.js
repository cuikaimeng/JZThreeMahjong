import pg from 'pg';
import { PG } from '../config.js';

/** 连接 PostgreSQL；失败返回 null（调用方降级内存存储） */
export default async function connect() {
  let pool = null;
  try {
    pool = new pg.Pool({ ...PG, max: 10, connectionTimeoutMillis: 2000 });
    await pool.query('SELECT 1');
    // 幂等迁移：老库无需手工执行 schema.sql 也能获得新列 / 新表
    const migrations = [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
      `ALTER TABLE game_record_players ADD COLUMN IF NOT EXISTS detail TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE game_records ADD COLUMN IF NOT EXISTS snapshot JSONB NOT NULL DEFAULT '{}'`,
      `CREATE TABLE IF NOT EXISTS login_logs (
         id BIGSERIAL PRIMARY KEY,
         user_id BIGINT,
         openid VARCHAR(64),
         nickname VARCHAR(32),
         kind VARCHAR(16) NOT NULL,
         login_type VARCHAR(16),
         success BOOLEAN NOT NULL DEFAULT TRUE,
         ip VARCHAR(64),
         user_agent VARCHAR(256),
         detail JSONB NOT NULL DEFAULT '{}',
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_login_logs_time ON login_logs(created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS game_logs (
         id BIGSERIAL PRIMARY KEY,
         room_code VARCHAR(6),
         round_no SMALLINT,
         user_id BIGINT,
         seat VARCHAR(8),
         event VARCHAR(40) NOT NULL,
         direction VARCHAR(8) NOT NULL DEFAULT 'sys',
         payload JSONB NOT NULL DEFAULT '{}',
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS idx_game_logs_room ON game_logs(room_code, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_game_logs_user ON game_logs(user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_game_logs_event ON game_logs(event, created_at DESC)`,
    ];
    for (const sql of migrations) await pool.query(sql);
    return pool;
  } catch (e) {
    console.warn(`[db] PostgreSQL unavailable (${e.code || e.message}) — using memory fallback`);
    if (pool) await pool.end().catch(() => {});
    return null;
  }
}
