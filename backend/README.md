# 后端 · HTTP + WebSocket + 对局引擎

Node.js（ESM）+ Express 4 + `ws`，PostgreSQL 存冷数据、Redis 存会话与房间镜像，对局热数据主存进程内 Map。规则引擎与网络层解耦：`game/` 只通过事件回调输出状态变化，由 `ws/` 分发。

## 启动

```bash
cd backend
npm install
cp .env.example .env
npm start        # 或 npm run dev（--watch 热重载）
```

要求 Node ≥ 18。默认监听 `:3000`，`GET /health` 返回 `{ok, ts}`。启动时会连接 PG / Redis（连不上自动降级内存）、执行幂等迁移、从 Redis 恢复 `waiting` 房间、开启 30s 心跳；SIGINT/SIGTERM 优雅关闭。

### 环境变量（`.env`）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | HTTP 与 WS 共用端口 |
| `PG_HOST/PORT/USER/PASSWORD/DATABASE` | `localhost/5432/postgres/postgres/mahjong` | PostgreSQL；不可用则内存降级 |
| `REDIS_HOST/PORT` | `localhost/6379` | Redis；不可用则内存降级 |
| `WX_APPID` / `WX_SECRET` | 空 | 配置后 `/api/auth/login` 用 code 换真实 openid；留空走游客登录 |
| `TOKEN_TTL_DAYS` | `7` | Bearer token 有效期 |

降级时服务照常运行，但**重启后数据丢失**，仅用于开发。CORS 当前为本地调试配置（`Allow-Origin: *`，放行 GET/POST/PUT/PATCH/DELETE/OPTIONS），上线需收紧。

## 目录

```
backend/src/
├── server.js            HTTP + WS 入口、恢复房间、优雅退出
├── app.js               Express 装配、CORS、路由挂载
├── config.js            极简 .env 读取
├── db/                  postgres / redis / memory / index（统一读写与降级）
├── middleware/auth.js   Bearer → session → user
├── routes/              auth / users / history / logs / rooms
├── services/            hotStore（热数据 Map + Redis 镜像）、roomService
├── game/                engine（牌墙/判定）、gameRules、scoring（计分）、table（状态机 + AI）
└── ws/                  连接、鉴权、消息路由、私密信息过滤、事件落日志
```

## REST 接口

除 `POST /api/auth/login` 外均需 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查（无鉴权） |
| POST | `/api/auth/login` | `{code?, nickname?, avatarUrl?}` → `{token, user}`；有 AppID/Secret 时 `jscode2session` 换 openid，否则 `guest:<code>` |
| GET | `/api/users/me` | 当前用户（含 `avatar_url`、累计点数/场次/胜局） |
| PUT | `/api/users/me` | `{nickname?, avatarUrl?}` 更新资料（昵称 ≤32、头像需 http(s)） |
| GET | `/api/history?limit=20&offset=0` | `{summary:{points,total,wins,winRate}, records[]}`，仅本人 |
| GET | `/api/history/:id` | 单局牌谱 `{...game_records, players[]}`，含 `snapshot` 结算快照 |
| GET | `/api/logs/login?limit=20` | 本人登录日志 |
| GET | `/api/logs/game?roomCode=&limit=100` | 对局流水；传房号时校验本人参与过该房间 |
| POST | `/api/rooms` | `{mode?, laps?, base?, password?}` 建房，返回 6 位房号（后端生成） |
| POST | `/api/rooms/join` | `{code, password?}` 校验并占座（幂等），返回 `{room, seat}` |
| GET | `/api/rooms/:code` | 房间公开状态 |

房间参数：`laps ∈ {2,4,8}`（圈）、`base ∈ {1,2,5}`（底分）、`password ≤ 8` 位。

## WebSocket（`/ws`）

消息统一为 `{"t":"类型","data":{...}}`，连接后先发 `auth`；断线重连后发 `rejoin` 可拿 `gameResume` 快照。

### 客户端 → 服务端

| t | 数据 / 作用 |
|---|---|
| `auth` | `{token}` 绑定连接；重复登录会向旧连接发 `kicked` |
| `join` / `rejoin` | `{code}` 进房 / 对局中重连补快照 |
| `ready` / `addAI` / `leave` | 准备切换、AI 补位、离开房间 |
| `startGame` | 全员就绪后开局 |
| `discard` / `pick` | `{tile}` 出牌 / 上报当前选中牌（超时自动打这张） |
| `action` | `{type: peng\|gang\|hu\|pass}` 对他家弃牌的响应 |
| `gang` / `listen` / `hu` | 暗杠补杠 / 报听 / 自摸点炮胡 |
| `nextRound` | 局间确认 |

### 服务端 → 客户端

| 类别 | 事件 |
|---|---|
| 连接 / 房间 | `authOk`、`kicked`、`error`、`roomState`、`roomClosed`、`gameStart`、`gameResume` |
| 开局 | `dice`（`rolls/totals/tie/reroll/seats/out`）、`dealer`（2s 停留后发牌）、`dealStep`、`deal`、`wallCommit` |
| 摸打 | `turn`（带 `ms/warnMs`）、`draw`、`discard`、`offer`（带 `ms/warnMs`）、`action`、`gangSettle`、`listen` |
| 结算 / 局间 | `settle`（含三家 hands/melds/fans/detail/delta）、`roundEnd`、`nextReady`、`matchOver` |

`deal` / `dealStep` / `draw` 按座位过滤：本人拿到牌面与 id，其他人 `tile=null`；日志写入前会脱敏 token / password / hands / tiles / ids 等字段。注意：前端当前**未订阅 `gangSettle`**，杠即时分提示不会到达客户端。

## 对局规则（以 `src/game/` 为准）

- **牌墙**：136 张（万筒条各 36 + 字牌 28），开局一次洗定并以 SHA-256 生成指纹；留 7 垛（14 张）壁牌，摸完流局
- **定庄**：三家掷骰比点；最大点数并列时**仅并列者重摇**（其余退出庄家选择），直到唯一最大；定庄事件 2 秒后发牌；庄赢连庄，否则顺时针下家坐庄
- **报听**：弃牌点数 ≥3 且听口至少一张 ≥6 才能报听；报听后手牌锁定、摸什么打什么、不可碰杠；未报听一律不能胡
- **碰 / 杠**：动作优先级胡 > 碰/杠，同级按下家顺序；支持暗杠、补杠、点杠与抢杠（抢杠询问 8s）
- **番型倍数**：普通 1；清一色 / 一条龙 / 七小对 2；豪七对 / 十三幺 4，并存时展示全部、取最高倍数
- **计分**：胡牌张点数 P（数字牌面值 / 字牌 10），`B = 5 + P`（庄家底 5 点），按庄闲 × 自摸/点炮/未听包赔矩阵结算后 **× 房间底分**；流局庄 −10、闲各 +5；杠即时分单独结算
- **计时**：出牌与碰杠决策均 15s，最后 3s 警告（`turn`/`offer` 事件下发 `ms` / `warnMs`）；出牌超时打选中牌，无选中打排序后最右侧一张；决策超时自动 `pass`
- **AI**：能胡则胡、优先报听、大概率暗杠，出牌打孤张 / 字牌

## 数据落库与日志

- **每局结束（胡牌或流局）立即写**：`rooms` 归档 + `game_records`（含 `snapshot` 结算快照）+ `game_record_players`（AI 不入库）+ 累计 `users.points/total_games/total_wins`
- 整场结束只发 `matchOver` 并把房间置回 `waiting`；`deleteRoom` 仅在最后一人离开时调用
- `login_logs` 记录 HTTP 登录 / WS 鉴权 / 顶号 / 失败原因；`game_logs` 记录开局、定庄、发牌、摸打、决策、结算、房间解散及客户端动作（C→S 以 `client:*` 标记），写入为 fire-and-forget，失败不影响对局
- 启动时幂等迁移会补 `users.avatar_url`、`game_record_players.detail`、`game_records.snapshot` 并创建两张日志表及索引，老库无需手工升级

表字段见 [`database/README.md`](../database/README.md)。

## 测试

`cd backend && node tools/<文件>.js`（无 `npm test`，逐个运行）：

| 类别 | 脚本 |
|---|---|
| 计分 / 规则 | `scoringTest.js`、`specialHandsTest.js`、`listenRulesTest.js`、`pengGangTest.js`、`baseScoreTest.js`、`deckFairnessTest.js` |
| 时序 / 计时 | `startDelayTest.js`、`dealerTieTest.js`、`turnTimerTest.js` |
| 存储 / 新功能 | `persistenceTest.js`、`wxAuthShareTest.js`（强制内存降级，不污染真实库） |
| 端到端 | `engineTest.js`（完整对局）、`smoke.js`、`netFlow.js`（后两者需先启动服务） |

注意：任何 import 到 `Table` / `db` 的脚本在 PG 可用时都会执行启动迁移；`engineTest` / `scoringTest` / `listenRulesTest` / `smoke` 会写入真实战绩数据。

## 部署注意

- 热数据主存进程内 Map，**仅适合单实例**；Redis 只做房间镜像与重启恢复（会话键 `session:{token}` 带 TTL）
- token 存 Redis / 内存，重启或降级后失效，客户端会重新登录
- 未配置微信 AppID/Secret 时始终是游客 openid；上线前配置并在前端换合法域名
- CORS、无管理员后台、日志仅本人可查，均为当前开发态设计
