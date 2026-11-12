# 数据库设计

存储分三层，职责不要混用：

| 层 | 内容 | 位置 |
|---|---|---|
| 热数据（主存） | 房间、牌局状态、手牌、牌河、庄家、巡数 | **Node 进程内 Map**（`backend/src/services/hotStore.js`），单实例部署 |
| 热数据（镜像 / 会话） | `room:{code}` 房间 JSON 镜像、`session:{token}` 登录会话 | Redis；启动时从 `room:*` 恢复 `waiting` 房间 |
| 冷数据 | 用户、房间归档、每局战绩、令牌、登录与对局日志 | PostgreSQL（`schema.sql`） |

PG / Redis 连不上时各自降级为 `backend/src/db/memory.js` 的内存表 / Map，服务照常运行，**重启数据丢失**，仅用于开发。

## 初始化

```bash
createdb mahjong
psql -U postgres -d mahjong -f database/schema.sql   # -U 换成 backend/.env 的 PG_USER
```

`schema.sql` 全部使用 `CREATE TABLE IF NOT EXISTS`。后端启动还会执行幂等迁移（`backend/src/db/postgres.js`）：补 `users.avatar_url`、`game_record_players.detail`、`game_records.snapshot` 三列，创建 `login_logs` / `game_logs` 两张表与 5 个索引。因此**已有老库无需手工升级**，直接启动后端即可。

## PostgreSQL 表（7 张）

### `users` 用户

`id` PK · `openid` UNIQUE（微信 openid 或 `guest:<code>`）· `nickname` · `avatar`（枚举 `me/qingluan/bailu`）· `avatar_url`（微信头像 URL，优先于 avatar 枚举）· `points`（累计点数）· `total_games` · `total_wins` · `created_at` / `updated_at`。

### `rooms` 房间归档

`id` PK · `code`（6 位房号）· `mode` · `rounds` · `base_points` · `password` · `owner_id → users` · `status`（finished/dismissed）· `started_at` / `finished_at`。索引：`idx_rooms_code`、`idx_rooms_owner`。

> 每局结算都会调用 `saveRoomArchive` 插入一条归档行（不是整场结束才写），因此同一房号可能对应多行；战绩通过 `game_records.room_id` 关联。

### `game_records` 每局战绩

`id` PK · `room_id` · `round_no` / `round_name` · `dealer_seat` · `winner_seat` · `win_type`（`zimo`/`dianpao`/`draw`）· `win_tile` · `hand_owner` · `hand_tiles JSONB`（胡家牌型）· `fans JSONB`（番型明细 `[{label,value}]`）· `total_points` · `wall_count` · `turn_no` · `snapshot JSONB` · `finished_at`。索引：`idx_records_room`。

`snapshot` 是结算完整快照：三家 `hands` / `melds`、`players`（昵称 + 分数）、`fans`、`detail`（点数计算式）、`delta`、`handName`、`winTile`、`dealerSeat`、`winnerSeat`、房间号与底分等，供战绩详情页直接还原牌谱（老记录无快照时前端回退到 `players[]`）。

### `game_record_players` 每局玩家明细

`id` PK · `record_id`（级联删除）· `user_id` · `seat` · `delta`（点数变动）· `is_win` · `is_bao` · `hand_tiles JSONB` · `detail TEXT`（分数计算式）。约束 `UNIQUE(record_id,user_id)`；索引 `idx_grp_record`、`idx_grp_user`。**AI（负 userId）不入库**。

### `auth_tokens` 登录令牌

`token` PK · `user_id` · `created_at` · `expires_at`。

### `login_logs` 登录日志

`id` PK · `user_id` · `openid` · `nickname` · `kind`（`http_login`/`ws_auth`/`kicked`）· `login_type`（`guest`/`wechat`/`token`）· `success` · `ip` · `user_agent` · `detail JSONB`（失败原因 / token 前 8 位摘要，不存明文 token）· `created_at`。索引：`idx_login_logs_user`、`idx_login_logs_time`。

### `game_logs` 对局日志

`id` PK · `room_code` · `round_no` · `user_id` · `seat` · `event`（`game_start` / `dice` / `dealStep` / `client:discard` / `settle` / `room_closed` …）· `direction`（`in` C→S / `out` S→C / `sys`）· `payload JSONB`（已脱敏）· `created_at`。索引：`idx_game_logs_room`、`idx_game_logs_user`、`idx_game_logs_event`。

## Redis 键（实际实现）

| 键 | 类型 | 内容 |
|---|---|---|
| `session:{token}` | String | userId，带 TTL（默认 7 天） |
| `room:{code}` | String(JSON) | 房间镜像；启动时只恢复 `status === 'waiting'` 的房间 |

> 牌局状态与各家手牌**不写 Redis**（没有 `room:{code}:seats` / `game:{code}` / `game:{code}:hand:{seat}` 之类的键），只存在进程内 Map 中；这也是当前只能单实例部署的原因。

## 写入时机

1. `POST /api/auth/login` → `users` upsert + `session:{token}` / `auth_tokens` + `login_logs`
2. 每局 `settle`（胡牌或流局）→ `rooms` 归档、`game_records`（含 snapshot）、`game_record_players`、`users` 累计战绩
3. 对局全程 → `game_logs` 事件流水（异步、失败不阻塞）
4. 整场结束 → 只发 `matchOver`、房间状态回到 `waiting`，**不清除 Redis 房间键**；`deleteRoom` 仅在最后一人离开 / 房间解散时调用
5. `PUT /api/users/me`（微信授权）→ 更新 `users.nickname` / `avatar_url`

## 查询接口与常用 SQL

后端已封装，无需直接查库：`GET /api/history`（分页列表）、`GET /api/history/:id`（牌谱详情）、`GET /api/logs/login`、`GET /api/logs/game`（均需登录且按用户隔离）。

```sql
-- 某玩家最近 10 局
SELECT r.id, r.round_name, r.win_type, r.total_points, p.delta, r.finished_at
FROM game_record_players p JOIN game_records r ON r.id = p.record_id
WHERE p.user_id = 1 ORDER BY r.finished_at DESC LIMIT 10;

-- 某房间的完整对局流水
SELECT created_at, direction, event, payload FROM game_logs
WHERE room_code = '257369' ORDER BY created_at, id;

-- 登录失败排查
SELECT created_at, kind, login_type, ip, detail FROM login_logs
WHERE success = false ORDER BY created_at DESC LIMIT 20;
```

> 降级为内存模式时，上述数据存在 `MemoryStore` 中，重启即清空；需要持久化请保证 PostgreSQL 可连接。
