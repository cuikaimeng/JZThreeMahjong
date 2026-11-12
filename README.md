# 三人扣点门板屋

微信小游戏形态的三人扣点麻将：Canvas 前端 + Express/WebSocket 后端 + PostgreSQL 冷数据 + Redis 热数据镜像。支持好友房联机、AI 补位、报听/碰杠/抢杠、战绩牌谱、微信分享直接进房。

| 子项目 | 目录 | 说明文档 |
|---|---|---|
| 前端（微信小游戏） | [`frontend/`](frontend/README.md) | 场景、网络层、微信能力、预览调试 |
| 后端（HTTP + WS + 规则引擎） | [`backend/`](backend/README.md) | 接口协议、对局规则、日志、测试 |
| 数据库 | [`database/`](database/README.md) | 表结构、Redis 键、落库时机 |

---

## 快速开始

前置：Node.js ≥ 18、PostgreSQL、Redis、微信开发者工具（真机/模拟器调试用）。

```bash
# 1) 建库建表（PG 不可用时可跳过，服务会自动降级为内存存储）
createdb mahjong
psql -U postgres -d mahjong -f database/schema.sql

# 2) 启动后端（:3000，HTTP + WS 同端口）
cd backend
npm install
cp .env.example .env      # 按需修改 PG_* / WX_APPID / WX_SECRET
npm start                 # 开发热重载：npm run dev
curl http://localhost:3000/health   # → {"ok":true,...}
```

`psql -U postgres` 请换成 `backend/.env` 中实际的 `PG_USER`（本机配置为 `cuikaimeng`）。

前端有两种运行方式：

- **微信开发者工具**：导入 `frontend/` 目录（`compileType: game`），勾选「不校验合法域名」，编译即可；AppID 已写在 `frontend/project.config.json`
- **浏览器预览**（无需开发者工具，用 wx API shim 转发到真实后端）：
  ```bash
  cd frontend && node tools/dev-server.js
  # 打开 http://localhost:8790/preview/index.html
  ```

后端启动时会自动执行幂等迁移（补 `avatar_url` / `snapshot` 列、创建日志表与索引），老库无需手工升级。PG 或 Redis 连不上时各自降级为进程内内存存储，服务照常启动，但**重启后数据丢失**。

---

## 仓库结构

```
JZThreeMahjong/
├── README.md                 ← 本文件
├── backend/
│   ├── .env / .env.example    环境变量
│   ├── package.json           npm start / dev
│   ├── src/
│   │   ├── server.js          HTTP + WS 入口、重启恢复、优雅退出
│   │   ├── app.js             Express 装配、CORS、路由挂载
│   │   ├── config.js          .env 读取
│   │   ├── db/                PG / Redis / 内存降级 / 数据读写
│   │   ├── middleware/        Bearer 鉴权
│   │   ├── routes/            auth / users / history / logs / rooms
│   │   ├── services/          房间服务、热数据 Map
│   │   ├── game/              牌引擎、计分、牌局状态机、AI
│   │   └── ws/                WebSocket 收发与私密信息过滤
│   └── tools/                 14 个回归 / 冒烟脚本
├── frontend/
│   ├── game.js / game.json    小游戏入口、竖屏配置
│   ├── project.config.json    开发者工具项目配置
│   ├── js/                    场景、网络、UI、规则等模块
│   ├── assets/images/         35 张牌面 PNG
│   ├── preview/index.html     浏览器预览 + wx API shim
│   └── tools/dev-server.js    预览静态服务器
└── database/
    └── schema.sql             7 张表的建表脚本
```

## 架构与数据流

```
微信小游戏 (Canvas)
   │  wx.request ── REST：登录 / 资料 / 房间校验 / 战绩 / 日志
   │  wx.connectSocket('ws://…/ws') ── 实时对局事件
   ▼
Node 服务 (:3000)
   ├─ 热数据：进程内 Map（房间、牌局、手牌），Redis 异步镜像
   │          session:{token} 会话 + room:{code} 房间镜像
   └─ 冷数据：PostgreSQL（用户、房间归档、每局战绩、登录/对局日志）
```

典型流程：`POST /api/auth/login`（wx.code → token）→ `POST /api/rooms` 建房 → WS `join` → `ready` / `addAI` → `startGame` → `dice` 定庄（2s 后发牌）→ 15s 出牌/决策 → `settle` 结算并**立即落库** → `roundEnd` / `matchOver`。好友点击分享卡片时，前端从启动参数解析 `roomCode`/`pwd` 自动登录并进房。

## 主要能力

- **规则**：136 张牌、留 7 垛（14 张）、掷骰定庄且并列最大者重摇、报听门槛（弃牌点数 ≥3 且听口 ≥6）、碰/杠/抢杠、庄闲结算矩阵、底分 1/2/5
- **番型倍数**：普通 1；清一色 / 一条龙 / 七小对 2；豪七对 / 十三幺 4（并存时取最高）
- **计时**：出牌与碰杠决策均 15 秒，最后 3 秒红色警告显示在牌局中央；超时自动打选中牌（无选中打最右侧），决策超时自动「过」
- **战绩**：列表 / 牌谱详情读取真实数据库，结算快照含三家牌面、副露、番型与点数计算式
- **微信**：`wx.login` code 换 openid、头像昵称授权写入用户资料、分享卡片带房号密码直接进房
- **审计**：`login_logs`（登录 / WS 鉴权 / 顶号）与 `game_logs`（开局到结算的事件流水，脱敏）
- **稳定性**：断线重连快照、顶号、心跳、AI 自动补位、PG/Redis 降级

## 测试

所有测试脚本在 `backend/tools/`，命令形如 `cd backend && node tools/<文件>.js`：

| 类别 | 脚本 |
|---|---|
| 规则与计分 | `scoringTest.js`、`specialHandsTest.js`、`listenRulesTest.js`、`pengGangTest.js`、`baseScoreTest.js`、`deckFairnessTest.js` |
| 时序与计时 | `startDelayTest.js`、`dealerTieTest.js`、`turnTimerTest.js` |
| 存储与新功能 | `persistenceTest.js`、`wxAuthShareTest.js`（均强制内存降级，不污染真实库） |
| 端到端 | `engineTest.js`（跑完整对局）、`smoke.js`、`netFlow.js`（后两者需先 `npm start`） |

`engineTest` / `scoringTest` / `listenRulesTest` / `smoke` 在 PG 可用时会写入真实战绩数据；`persistenceTest` / `wxAuthShareTest` 用内存存储隔离。`package.json` 目前没有 `npm test`，需逐个运行。

## 配置速查

| 位置 | 内容 |
|---|---|
| `backend/.env.example` | **开发环境**后端模板：`PORT=3000`、本机 `PG_*` / `REDIS_*`、`CORS_ORIGINS=*`、`WX_*` 留空走游客登录 |
| `deploy/env.production.example` | **生产环境**后端模板：仅本机 PG/Redis + 强密码 + `CORS_ORIGINS` 白名单 |
| `frontend/js/net/env.js` | **两套前端地址**：DEV `http://localhost:3000` / `ws://localhost:3000/ws`；PROD `https://<PROD_DOMAIN>` / `wss://<PROD_DOMAIN>/ws`。部署时只改 `PROD_DOMAIN` |
| `frontend/js/net/config.js` | 兼容入口，业务代码仍从这里取 `API_BASE` / `WS_URL` |
| `frontend/project.config.json` | AppID、`compileType: game`、`urlCheck: false`（仅开发者工具本地联调） |
| `deploy/` | 服务器一键部署脚本、nginx HTTPS/WSS 模板、生产 `.env` 模板 |

### 两套环境如何切换

前端按运行环境自动选择：微信 `envVersion` 为 `develop` → DEV，`trial` / `release` → PROD；浏览器预览可用 `?env=prod` 强制切换；`frontend/js/net/env.js` 的 `ENV_OVERRIDE` 可手动锁定 `'dev'` / `'prod'`（开发者工具连生产联调时用）。后端靠服务器上的 `backend/.env` 区分，代码无需改动；`app.set('trust proxy', 1)` 与 nginx 的 `X-Real-IP` / `X-Forwarded-For` 保证反代后登录日志仍是真实 IP。

生产部署（服务器是全新环境，脚本负责装 Node / PG / Redis / nginx）：

```bash
sudo bash deploy/server-setup.sh --db-password '<强密码>' --domain game.example.com
certbot --nginx -d game.example.com                            # 首次申请证书
sudo bash deploy/server-setup.sh --domain game.example.com     # 证书就绪后重跑，自动切 HTTPS/WSS
```

**Node / PostgreSQL / Redis / nginx 已自行装好**时改用 `deploy/deploy-app.sh`，它不安装、不升级任何软件包，只做建库建表、生成 `.env`、`npm ci`、systemd 守护、nginx 反代与健康检查（幂等，重跑复用已有数据库密码）：

```bash
sudo bash deploy/deploy-app.sh --domain game.example.com --db-password '已有密码'
certbot --nginx -d game.example.com                          # 首次申请证书
sudo bash deploy/deploy-app.sh --domain game.example.com     # 证书就绪后重跑，自动切 HTTPS/WSS
```

从本机上传代码用 `./deploy/upload.sh <用户@IP> --app-only --domain 域名`（需先授权 SSH 公钥）；也可打包后用 OrcaTerm 上传。并在微信公众平台配置 `request` / `socket` / `downloadFile` 合法域名。

## 已知限制

- **微信资料**：平台自 2021 年起可能只返回匿名昵称与空头像；小游戏没有 `open-type=chooseAvatar` 组件，此时保持游客身份并提示
- **游客登录**：未配置 `WX_APPID`/`WX_SECRET` 时，openid 为 `guest:<code>`，不能换真实微信 openid
- **单机演示**：`gameScene` / `roomScene` / `resultScene` 仍保留离线演示分支（联机不可用时生效）；在线结算走对局页内面板，不进入 `resultScene`
- **待开发**：三人血战、邀请好友面板、流局方式/去风牌开关（UI 有但未接后端）、设置页协议/实名/注销/反馈；`gangSettle`（杠即时分）前端尚未订阅
- **部署**：热数据主存于进程内 Map，仅适合单实例；Redis 只做镜像与重启恢复；CORS 默认 `*` 便于浏览器预览，生产可用 `CORS_ORIGINS` 收紧
- **审计**：日志接口需登录且仅能查本人 / 本人参与房间的记录，暂无管理员后台

详细接口与字段见 `backend/README.md`，表结构见 `database/README.md`，前端调试参数见 `frontend/README.md`。
