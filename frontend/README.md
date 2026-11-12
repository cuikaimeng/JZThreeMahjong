# 前端 · 微信小游戏

纯 Canvas 2D 的**微信小游戏**（不是小程序页面，没有 wxml）。入口 `game.js`，`game.json` 锁定竖屏；`js/main.js` 管理场景、触摸路由与逐帧渲染。

## 运行

| 方式 | 步骤 |
|---|---|
| 微信开发者工具 | 导入本目录（`project.config.json` 已配置 `compileType: game`、AppID、`urlCheck:false`）→ 勾选「不校验合法域名」→ 编译 |
| 浏览器预览 | 先启动后端（`:3000`），再 `cd frontend && node tools/dev-server.js`，打开 `http://localhost:8790/preview/index.html` |

预览页 `preview/index.html` 用 `window.wx` shim 模拟小游戏 API：`wx.request` 真实转发到 `localhost:3000`，`wx.connectSocket` 真实连 `ws://localhost:3000/ws`，其余为浏览器适配（触摸、存储、Toast、剪贴板、`createImage`、分享等）。**它不是数据源 mock**，联机走真实后端。

后端地址写在 `js/net/config.js`：

```js
API_BASE = 'http://localhost:3000'
WS_URL   = 'ws://localhost:3000/ws'
```

真机 / 上线前须替换为已备案的 https / wss 域名，并在小程序后台配置合法域名。

## 目录结构

```
frontend/
├── game.js / game.json          入口（竖屏）、预加载牌面后 new Main()
├── project.config.json          开发者工具项目配置（AppID、编译选项）
├── project.private.config.json  个人本地配置
├── js/
│   ├── main.js                  场景管理、联机初始化、战绩加载、分享进房
│   ├── render.js                Canvas 创建、缩放与竖/软件横屏坐标变换
│   ├── net/                     config / api(REST) / ws(长连接) / share(分享)
│   ├── user/                    userInfo(当前用户)、wxProfile(微信授权)
│   ├── ui/                      draw(通用绘制)、tileFace(牌面 PNG 绘制与矢量回退)
│   ├── lobby/ create/ join/     大厅、建房配置、房号密码输入
│   ├── room/                    等待开局
│   ├── game/                    对局页（含结算详情面板）、gameRules、handCheck
│   ├── result/                 单机结算页（在线结算不走此页）
│   ├── history/                战绩列表、牌谱详情、historyAdapter(后端数据适配)
│   │   └── historyData.js      离线设计稿示例，当前无页面引用
│   └── rules/ settings/         规则页（规则/番型双 Tab）、设置页
├── assets/images/               35 张牌面 PNG（万/筒/条 1-9、字牌、牌背）
├── audio/                       bgm/、effect/ 目录，当前为空
├── preview/index.html           浏览器预览 + wx API shim
└── tools/dev-server.js          预览静态服务器（:8790，禁用缓存）
```

## 场景（10 个，均由 `main.js` 注册与切换）

`lobby` 大厅 · `rules` 规则 · `history` 战绩列表 · `detail` 牌谱详情 · `settings` 设置 · `create` 建房 · `join` 加入 · `room` 等待开局 · `game` 对局 · `result` 单机结算。

场景通过回调与 `main.js` 通信（如 `onButton` / `onEnterRoom` / `onJoin` / `onOpenDetail` / `onInvite`），触摸事件由 `main.bindTouch()` 统一换算坐标后分发到当前场景。

## 网络层

- `net/api.js`：`wx.request` 封装（自动带 Bearer、401 清会话），提供 `login` / `ensureLogin` / `updateProfile` / `createRoom` / `joinRoom` / `getRoom` / `getHistory` / `getHistoryDetail` / `getLoginLogs` / `getGameLogs` 等接口；token 与用户缓存在 `wx.setStorageSync`
- `net/ws.js`：`Net` 单例，连接后立即发 `auth`，`authOk` 后 flush 待发队列；断线重连（最多 5 次、递增延迟）并自动 `rejoin`
- `net/share.js`：构造 / 解析分享参数 `roomCode=xxxxxx[&pwd=xxxx]`，注册 `wx.onShareAppMessage`、调起 `wx.shareAppMessage`
- `main.js` 订阅 `roomState / gameStart / dice / dealer / dealStep / deal / turn / draw / discard / offer / action / listen / settle / roundEnd / nextReady / matchOver / gameResume` 等事件并转交给 `gameScene.onNetEvent()`

## 微信能力

| 能力 | 实现 |
|---|---|
| 账号 | `wx.login` 取 code → `POST /api/auth/login`；后端配置 AppID/Secret 后换 openid，否则游客登录 |
| 头像昵称 | `user/wxProfile.js`：已授权时静默取；点击大厅用户卡时 `wx.getUserProfile`，不支持则降级 `wx.createUserInfoButton`；成功后 `PUT /api/users/me` 落库 |
| 分享进房 | 房间「＋邀请好友加入」与右上角转发菜单均带房号（密码房带 `pwd`）；好友点击后从 `wx.getLaunchOptionsSync().query`（冷启动）或 `wx.onShow`（热启动）解析，自动登录 → `/api/rooms/join` → WS join → 直接进房；3 秒内重复触发去重 |
| 降级 | 不支持分享时复制房号；微信返回匿名资料（「微信用户」+ 空头像）时保持游客身份并提示 |

## 真实数据 vs 离线演示

**真实后端数据**：大厅用户资料、房间状态与房号密码、对局全过程、战绩列表/牌谱详情（`/api/history`，含结算快照）、登录日志与对局日志接口。战绩页有 loading / 空数据 / 失败点击重试状态，触底分页加载 20 条。规则页为静态知识内容（规则 / 番型双 Tab，番型示例用真实牌面绘制）。

**仍为本地演示数据**（仅联机不可用时生效，或标注为设计稿）：

- `game/gameScene.js` 的固定演示牌面 / 模拟本局结果菜单
- `room/roomScene.js` 的定时模拟好友加入与随机昵称
- `result/resultScene.js` 的默认结算数据（在线结算走对局页内的 `drawHuDetail` 面板，不进入此页）
- `history/historyData.js` 示例战绩（无页面引用）
- 建房页「留4垛 / 摸完」「去风牌」开关仅作为展示，后端目前固定留 7 垛、不去风牌

## 预览调试参数与句柄

`preview/index.html?…` 支持：

| 参数 | 作用 |
|---|---|
| `wxAuthorized=1` | 模拟已授权，启动时静默拿微信资料 |
| `wxNick=…` / `wxAvatar=…` | 自定义模拟昵称 / 头像 URL |
| `wxProfileMode=button` | 强制 `getUserProfile` 失败，走原生授权按钮降级路径 |
| `roomCode=<6位>&pwd=<4位>` | 模拟好友点击分享卡片冷启动进房 |

浏览器控制台可用：`GameGlobal.__scenes`（主类与各场景）、`GameGlobal.__net`（WS 客户端）、`window.__wxTest`（`lastShare`、`getShare()`、`fireShow(query)`、`tapProfileButton()`、`profileCalls`）、`window.__setOrientation(w,h)`。

## 上线前检查

1. `js/net/config.js` 换成 https / wss 并在小程序后台配置合法域名
2. `backend/.env` 配好 `WX_APPID` / `WX_SECRET`，否则登录仍是游客模式
3. 后台 CORS 当前为 `Allow-Origin: *` 的开发配置，需收紧
4. 音频目录为空，暂无 BGM / 音效资源
