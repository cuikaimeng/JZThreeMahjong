-- =====================================================================
-- 三人扣点麻将 · PostgreSQL 数据库设计（冷数据存储）
--
-- 原则：
--   · 对局中的热数据（房间、牌局状态、手牌、牌河）存 Redis，不进 PG
--   · 对局结束（整场打完 / 房间解散）后，结算数据落 PG
--   · 牌 ID 与前端一致：'1m'~'9m' 万 / '1p'~'9p' 筒 / '1s'~'9s' 条 /
--     'E','S','W','N','C','F','P' 字牌（东南西北中發白）
-- =====================================================================

-- ---------- 用户 ----------
CREATE TABLE IF NOT EXISTS users (
  id           BIGSERIAL PRIMARY KEY,
  openid       VARCHAR(64) UNIQUE,           -- 微信 openid（游客登录为空）
  nickname     VARCHAR(32)  NOT NULL DEFAULT '麻友',
  avatar       VARCHAR(16)  NOT NULL DEFAULT 'me', -- 前端头像枚举: me/qingluan/bailu
  avatar_url   TEXT,                                 -- 微信头像 URL（授权后写入，优先于 avatar 枚举）
  points       INTEGER      NOT NULL DEFAULT 0,    -- 累计点数
  total_games  INTEGER      NOT NULL DEFAULT 0,    -- 总场次
  total_wins   INTEGER      NOT NULL DEFAULT 0,    -- 胡牌次数
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------- 房间（归档；进行中的房间在 Redis） ----------
CREATE TABLE IF NOT EXISTS rooms (
  id           BIGSERIAL PRIMARY KEY,
  code         VARCHAR(6)   NOT NULL,        -- 6 位房号
  mode         VARCHAR(32)  NOT NULL DEFAULT '三人经典',
  rounds       SMALLINT     NOT NULL DEFAULT 4,   -- 总局数 4/8/16
  base_points  SMALLINT     NOT NULL DEFAULT 2,   -- 底分
  password     VARCHAR(8),                   -- 房间密码（可空=无密码房）
  owner_id     BIGINT       NOT NULL REFERENCES users(id),
  status       VARCHAR(16)  NOT NULL DEFAULT 'finished', -- finished / dismissed
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner_id);

-- ---------- 对局记录（一场 = 一个房间从开局到打满总局数） ----------
CREATE TABLE IF NOT EXISTS game_records (
  id           BIGSERIAL PRIMARY KEY,
  room_id      BIGINT       NOT NULL REFERENCES rooms(id),
  round_no     SMALLINT     NOT NULL,        -- 第几局（0 起）
  round_name   VARCHAR(16)  NOT NULL,        -- '东一局' / '南二局'
  dealer_seat  SMALLINT     NOT NULL,        -- 庄家座位 0=东位 1=南位 2=西位
  winner_seat  SMALLINT,                     -- 胡牌座位；流局为 NULL
  win_type     VARCHAR(8),                   -- zimo(自摸) / dianpao(点炮) / draw(流局)
  win_tile     VARCHAR(4),                   -- 胡的那张牌
  hand_owner   SMALLINT,                     -- 牌型归属座位（放炮时=胡家）
  hand_tiles   JSONB        NOT NULL DEFAULT '[]', -- 胡牌牌型 ["1m","2m",...]
  fans         JSONB        NOT NULL DEFAULT '[]', -- [{label,value}]
  total_points INTEGER      NOT NULL DEFAULT 0,    -- 本局合计点数
  wall_count   SMALLINT     NOT NULL DEFAULT 0,    -- 结束时壁牌剩余
  turn_no      SMALLINT     NOT NULL DEFAULT 0,    -- 结束时巡数
  snapshot     JSONB        NOT NULL DEFAULT '{}', -- 结算完整快照（三家牌面/副露/番型/点数明细）
  finished_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_records_room ON game_records(room_id);

-- ---------- 对局明细（每个玩家一行的结算结果） ----------
CREATE TABLE IF NOT EXISTS game_record_players (
  id           BIGSERIAL PRIMARY KEY,
  record_id    BIGINT       NOT NULL REFERENCES game_records(id) ON DELETE CASCADE,
  user_id      BIGINT       NOT NULL REFERENCES users(id),
  seat         SMALLINT     NOT NULL,        -- 座位
  delta        INTEGER      NOT NULL DEFAULT 0,  -- 本局点数变动
  is_win       BOOLEAN      NOT NULL DEFAULT FALSE,
  is_bao       BOOLEAN      NOT NULL DEFAULT FALSE, -- 是否包胡
  hand_tiles   JSONB        NOT NULL DEFAULT '[]',  -- 玩家当局手牌（放炮者/旁观可查）
  detail       TEXT         NOT NULL DEFAULT '',    -- 本局分数计算式（与结算页一致）
  UNIQUE (record_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_grp_record ON game_record_players(record_id);
CREATE INDEX IF NOT EXISTS idx_grp_user   ON game_record_players(user_id);

-- ---------- 会话令牌（简单 token 鉴权；也可换 JWT 无表方案） ----------
CREATE TABLE IF NOT EXISTS auth_tokens (
  token        VARCHAR(64) PRIMARY KEY,
  user_id      BIGINT       NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ  NOT NULL
);

-- ---------- 登录日志 ----------
CREATE TABLE IF NOT EXISTS login_logs (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT,                            -- 失败登录可能没有用户
  openid       VARCHAR(64),
  nickname     VARCHAR(32),
  kind         VARCHAR(16)  NOT NULL,            -- http_login / ws_auth / kicked
  login_type   VARCHAR(16),                     -- wechat / guest / token
  success      BOOLEAN      NOT NULL DEFAULT TRUE,
  ip           VARCHAR(64),
  user_agent   VARCHAR(256),
  detail       JSONB        NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_logs_time ON login_logs(created_at DESC);

-- ---------- 游戏对局日志（过程事件流水） ----------
CREATE TABLE IF NOT EXISTS game_logs (
  id           BIGSERIAL PRIMARY KEY,
  room_code    VARCHAR(6),
  round_no     SMALLINT,
  user_id      BIGINT,
  seat         VARCHAR(8),
  event        VARCHAR(40)  NOT NULL,            -- game_start / dice / discard / settle ...
  direction    VARCHAR(8)   NOT NULL DEFAULT 'sys', -- in(C→S) / out(S→C) / sys
  payload      JSONB        NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_game_logs_room ON game_logs(room_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_logs_user ON game_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_logs_event ON game_logs(event, created_at DESC);

-- =====================================================================
-- 常用查询示例
--
-- 战绩列表（某用户最近对局，含汇总）：
--   SELECT r.*, p.delta, p.is_win FROM game_record_players p
--   JOIN game_records r ON r.id = p.record_id
--   WHERE p.user_id = $1 ORDER BY r.finished_at DESC LIMIT 20;
--
-- 战绩详情（三家结算）：
--   SELECT u.nickname, p.seat, p.delta, p.is_win
--   FROM game_record_players p JOIN users u ON u.id = p.user_id
--   WHERE p.record_id = $1 ORDER BY p.seat;
-- =====================================================================
