import './render.js'; // 初始化Canvas
import {
  PHYS_WIDTH,
  PHYS_HEIGHT,
  ctx,
  uiScale,
  isLandscape,
  applyRotationTransform,
  applyFrameTransform,
  resetFrameTransform,
  toVirtualPoint,
  onViewportChange,
} from './render.js';
import LobbyScene from './lobby/lobbyScene.js';
import RulesScene from './rules/rulesScene.js';
import HistoryScene from './history/historyScene.js';
import HistoryDetailScene from './history/historyDetailScene.js';
import SettingsScene from './settings/settingsScene.js';
import CreateScene from './create/createScene.js';
import JoinScene from './join/joinScene.js';
import RoomScene from './room/roomScene.js';
import GameScene from './game/gameScene.js';
import ResultScene from './result/resultScene.js';
import { net } from './net/ws.js';
import {
  ensureLogin,
  getUser,
  createRoom as apiCreateRoom,
  joinRoom as apiJoinRoom,
  getHistory,
  getHistoryDetail,
} from './net/api.js';
import { adaptSummary, adaptRecord, adaptDetail } from './history/historyAdapter.js';
import { setBackendUser } from './user/userInfo.js';
import { ensureWxProfile, requestWxProfile, syncWxProfile } from './user/wxProfile.js';
import { enableShareMenu, shareRoom, parseLaunchQuery } from './net/share.js';

const HISTORY_PAGE_SIZE = 20;

/**
 * 游戏主函数：场景管理（大厅 / 规则 / 战绩 / 设置 / 创建房间 / 等待开局 / 对局）
 */
export default class Main {
  constructor() {
    this.aniId = 0;
    this.current = 'lobby';
    this.rulesFrom = 'lobby'; // 规则页的返回目标（大厅/设置/创建房间）
    if (typeof GameGlobal !== 'undefined') GameGlobal.__scenes = this; // 调试句柄
    this.scenes = {
      lobby: new LobbyScene(),
      rules: new RulesScene(),
      history: new HistoryScene(),
      detail: new HistoryDetailScene(),
      settings: new SettingsScene(),
      create: new CreateScene(),
      join: new JoinScene(),
      room: new RoomScene(),
      game: new GameScene(),
      result: new ResultScene(),
    };

    // 场景间跳转
    this.scenes.lobby.onButton = (id) => this.onLobbyButton(id);
    this.scenes.rules.onBack = () => {
      this.current = this.rulesFrom;
    };
    this.scenes.history.onBack = () => {
      this.current = 'lobby';
    };
    this.currentDetailId = null;
    this.scenes.history.onOpenDetail = (id) => this.openHistoryDetail(id);
    this.scenes.history.onLoadMore = () => this.loadHistory(false);
    this.scenes.history.onRetry = () => this.loadHistory(true);
    this.scenes.detail.onBack = () => {
      this.current = 'history';
    };
    this.scenes.detail.onRetry = () => {
      if (this.currentDetailId != null) this.openHistoryDetail(this.currentDetailId);
    };
    this.scenes.settings.onBack = () => {
      this.current = 'lobby';
    };
    this.scenes.settings.onNavigate = (target) => {
      if (target === 'rules') {
        this.rulesFrom = 'settings';
        this.current = 'rules';
      }
    };
    this.scenes.create.onBack = () => {
      this.current = 'lobby';
    };
    this.scenes.create.onNavigate = (target) => {
      if (target === 'rules') {
        this.rulesFrom = 'create';
        this.current = 'rules';
      }
    };
    // 创建房间 → 后端建房 → WS 进房 → 等待房
    this.scenes.create.onEnterRoom = async (cfg) => {
      try {
        const r = await apiCreateRoom({
          mode: '三人经典',
          laps: cfg.laps || cfg.rounds || 2,
          base: cfg.base || 1,
          password: cfg.pwd || cfg.password || undefined,
        });
        this.scenes.room.setRoom({ ...r.room, chips: cfg.chips, base: cfg.base || 1, pwd: cfg.pwd, online: true });
        net.join(r.room.code);
        this.current = 'room';
      } catch (e) {
        wx.showToast({ title: e.message || '创建房间失败', icon: 'none' });
      }
    };
    this.scenes.join.onBack = () => {
      this.current = 'lobby';
    };
    // 加入房间 → 后端校验并占座 → WS 进房
    this.scenes.join.onJoin = async ({ code, pwd }) => {
      try {
        const r = await apiJoinRoom(code, pwd || undefined);
        this.scenes.room.setRoom({ ...r.room, pwd, online: true });
        net.join(r.room.code);
        wx.showToast({ title: '已加入房间', icon: 'success' });
        this.current = 'room';
        return true;
      } catch (e) {
        wx.showToast({ title: e.message || '加入房间失败', icon: 'none' });
        return false;
      }
    };
    this.scenes.room.onBack = () => {
      net.leave();
      this.current = 'lobby';
    };
    // 房间内「邀请好友加入」→ 微信分享（带房号 + 密码）
    this.scenes.room.onInvite = () => this.inviteFriend();
    this.lastShareAt = 0;
    this.lastShareKey = '';
    // 开始游戏：联机由服务器广播 gameStart 后进入对局页
    this.scenes.room.onStart = () => {
      if (this.online) {
        net.send('startGame', {});
        return;
      }
      this.scenes.game.setMatch({ code: this.scenes.room.room.code, chips: this.scenes.room.room.chips, base: this.scenes.room.room.base || 1, laps: this.scenes.room.room.laps || 2 });
      this.current = 'game';
    };
    this.scenes.game.onExit = () => {
      this.current = 'lobby';
    };
    this.scenes.game.onFinish = (result) => {
      this.scenes.result.setResult(result);
      this.current = 'result';
    };
    this.scenes.result.onReady = (next) => {
      this.scenes.room.resume(next || {});
      this.current = 'room';
    };
    this.scenes.result.onLobby = () => {
      this.current = 'lobby';
    };

    this.online = false;
    if (typeof GameGlobal !== 'undefined') GameGlobal.__net = net; // 调试句柄
    this.initNet();

    this.bindTouch();
    this.start();
  }

  /* ---------- 战绩（真实数据库数据） ---------- */

  /** 加载战绩汇总 + 列表；append=false 为下拉首页，true 为滚动到底下一页 */
  async loadHistory(reset = true) {
    const scene = this.scenes.history;
    const offset = reset ? 0 : scene.records.length;
    if (reset) scene.setStatus('loading');
    try {
      await ensureLogin(); // 保证 token 可用（已有 token 时校验后复用）
      const r = await getHistory({ limit: HISTORY_PAGE_SIZE, offset });
      const records = (r.records || []).map(adaptRecord);
      scene.setData({
        summary: adaptSummary(r.summary),
        records,
        append: !reset,
      });
      scene.hasMore = records.length === HISTORY_PAGE_SIZE;
      scene.setStatus(records.length || !reset ? 'idle' : 'empty');
    } catch (e) {
      scene.hasMore = false;
      scene.setStatus('error', `战绩加载失败 · 点击重试（${e.message || ''}）`);
      wx.showToast({ title: e.message || '战绩加载失败', icon: 'none' });
    }
  }

  /** 打开单局详情：按 id 请求后端，适配后交给详情页渲染 */
  async openHistoryDetail(id) {
    this.currentDetailId = id;
    const scene = this.scenes.detail;
    scene.setStatus('loading');
    this.current = 'detail';
    try {
      const r = await getHistoryDetail(id);
      const me = getUser();
      scene.setRecord(adaptDetail(r, me && me.id));
    } catch (e) {
      scene.setStatus('error', `详情加载失败 · 点击重试（${e.message || ''}）`);
      wx.showToast({ title: e.message || '详情加载失败', icon: 'none' });
    }
  }

  /* ---------- 联机 ---------- */

  /** 启动：微信资料 → 静默登录 → WebSocket → 分享进房 */
  async initNet() {
    let wxProfile = null;
    try {
      wxProfile = await ensureWxProfile(); // 已授权则静默取，不弹窗
      let user = await ensureLogin(wxProfile && wxProfile.nickName, { avatarUrl: wxProfile && wxProfile.avatarUrl });
      // 已有 token 的旧账号首次拿到微信资料时补写一次
      if (wxProfile && user && !user.avatar_url && wxProfile.avatarUrl) {
        user = (await syncWxProfile(wxProfile)) || user;
      }
      const profile = setBackendUser(user);
      if (profile) this.scenes.lobby.setUserInfo(profile);
      await net.connect();
      this.online = true;
    } catch (e) {
      this.online = false;
      wx.showToast({ title: '联机服务未连接', icon: 'none' });
    }
    this.bindNet();

    // 转发菜单 + 冷/热启动分享参数
    enableShareMenu(() => (this.current === 'room' ? this.scenes.room.room : null));
    try {
      const opts = typeof wx.getLaunchOptionsSync === 'function' ? wx.getLaunchOptionsSync() : null;
      if (opts) this.handleLaunchQuery(opts.query);
      if (typeof wx.onShow === 'function') wx.onShow((res) => this.handleLaunchQuery(res && res.query));
    } catch (e) { /* 忽略不支持的环境 */ }
  }

  /** 大厅点击用户卡：授权微信头像昵称并自动生成 / 更新玩家资料 */
  async authorizeWxProfile() {
    try {
      const p = await requestWxProfile();
      if (!p) {
        wx.showToast({ title: '未获取到微信资料，可继续使用游客身份', icon: 'none' });
        return;
      }
      const user = await syncWxProfile(p);
      const profile = setBackendUser(user);
      if (profile) this.scenes.lobby.setUserInfo(profile);
      wx.showToast({
        title: p.anonymous ? '微信返回匿名资料，已更新昵称' : `已同步 ${p.nickName}`,
        icon: 'none',
      });
    } catch (e) {
      wx.showToast({ title: e.message || '资料同步失败', icon: 'none' });
    }
  }

  /** 邀请好友：分享带房号参数，不支持分享时降级复制房号 */
  inviteFriend() {
    const room = this.scenes.room.room || {};
    if (shareRoom(room)) {
      wx.showToast({ title: '选择好友发送房间邀请', icon: 'none' });
      return;
    }
    const text = room.hasPassword && room.pwd
      ? `三人扣点门板屋 房号 ${room.code} 密码 ${room.pwd}`
      : `三人扣点门板屋 房号 ${room.code}`;
    try {
      if (wx.setClipboardData) wx.setClipboardData({ data: text });
    } catch (e) { /* ignore */ }
    wx.showToast({ title: '已复制房号，发给好友即可加入', icon: 'none' });
  }

  /** 好友点击分享卡片：带 roomCode 自动登录并进房（冷启动 / 热启动共用） */
  async handleLaunchQuery(query) {
    const q = parseLaunchQuery(query);
    const code = q.roomCode || q.room || q.code;
    if (!code || !/^\d{6}$/.test(String(code))) return;
    const key = `${code}:${q.pwd || ''}`;
    const now = Date.now();
    if (this.lastShareKey === key && now - this.lastShareAt < 3000) return; // onShow 重复触发去重
    this.lastShareKey = key;
    this.lastShareAt = now;
    if (!this.online) {
      // 登录未完成：稍后重试（initNet 结束后再进房）
      setTimeout(() => this.handleLaunchQuery(query), 800);
      this.lastShareAt = 0;
      return;
    }
    try {
      const joined = await this.scenes.join.onJoin({ code: String(code), pwd: q.pwd || '' });
      if (joined) wx.showToast({ title: `已通过邀请进入房间 ${code}`, icon: 'none' });
    } catch (e) { /* onJoin 内部已提示 */ }
  }

  bindNet() {
    net.on('roomState', (d) => {
      if (this.current === 'room') this.scenes.room.applyServer(d);
    });
    net.on('roomClosed', (d) => {
      wx.showToast({ title: (d && d.reason) || '房间已解散', icon: 'none' });
      this.current = 'lobby';
    });
    // 开局：服务器广播后进入对局页（在线模式）
    net.on('gameStart', () => {
      const pub = this.scenes.room.room.pub;
      this.scenes.game.setOnline({
        code: this.scenes.room.room.code,
        laps: this.scenes.room.room.laps || this.scenes.room.room.rounds || 2,
        players: pub ? pub.players || [] : [],
        meSeat: this.scenes.room.mySeat || 'me',
      });
      this.current = 'game';
    });
    // 对局事件 → 对局页
    [
      'dice',
      'dealer',
      'dealStep',
      'deal',
      'turn',
      'wallCommit',
      'draw',
      'discard',
      'offer',
      'action',
      'listen',
      'settle',
      'roundEnd',
      'nextReady',
      'matchOver',
      'gameResume',
    ].forEach((t) => net.on(t, (d) => this.scenes.game.onNetEvent(t, d)));
  }

  cur() {
    return this.scenes[this.current];
  }

  onLobbyButton(id) {
    if (id === 'rules') {
      this.rulesFrom = 'lobby';
      this.current = 'rules';
      return;
    }
    if (id === 'profile') {
      this.authorizeWxProfile();
      return;
    }
    if (id === 'record') {
      this.current = 'history';
      this.loadHistory(true);
      return;
    }
    if (id === 'settings') {
      this.current = 'settings';
      return;
    }
    if (id === 'create') {
      this.current = 'create';
      return;
    }
    if (id === 'join') {
      this.current = 'join';
      return;
    }
    wx.showToast({ title: '加入房间 · 敬请期待', icon: 'none' });
  }

  /**
   * 触摸事件路由到当前场景：按下高亮、移动（滚动）、抬起触发点击
   */
  bindTouch() {
    // 横屏模式：先逆旋转（软件横屏），非对局场景再做竖幅换算
    const pt = (t) => {
      if (isLandscape) {
        const v = toVirtualPoint(t.clientX, t.clientY, this.current === 'game');
        return [v.x, v.y];
      }
      return [t.clientX, t.clientY];
    };
    wx.onTouchStart((e) => {
      const t = e.touches[0];
      if (t) {
        const [x, y] = pt(t);
        this.cur().onTouchStart(x, y);
      }
    });
    wx.onTouchMove((e) => {
      const t = e.touches[0];
      if (t) {
        const [x, y] = pt(t);
        this.cur().onTouchMove(x, y);
      }
    });
    wx.onTouchEnd((e) => {
      const t = e.changedTouches[0];
      if (t) {
        const [x, y] = pt(t);
        this.cur().onTouchEnd(x, y);
      }
    });
  }

  start() {
    cancelAnimationFrame(this.aniId);
    this.aniId = requestAnimationFrame(this.loop.bind(this));

    // 横竖屏切换：更新缩放系数并让各场景重建布局（对局页保留状态）
    onViewportChange(() => {
      Object.values(this.scenes).forEach((s) => {
        s.k = uiScale();
        s.layout = null;
        s.layoutCache = null;
        if (typeof s.handleViewportChange === 'function') s.handleViewportChange();
      });
    });
  }

  loop() {
    resetFrameTransform(ctx);
    ctx.clearRect(0, 0, PHYS_WIDTH, PHYS_HEIGHT);
    if (isLandscape) {
      // 软件横屏：内容旋转 90°；非对局页再叠加居中竖幅
      ctx.fillStyle = '#04110d';
      ctx.fillRect(0, 0, PHYS_WIDTH, PHYS_HEIGHT);
      applyRotationTransform(ctx);
      if (this.current !== 'game') applyFrameTransform(ctx);
    }
    this.cur().render(ctx);
    this.aniId = requestAnimationFrame(this.loop.bind(this));
  }
}
