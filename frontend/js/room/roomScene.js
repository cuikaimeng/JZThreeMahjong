import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  STATUS_BAR_HEIGHT,
  SAFE_BOTTOM,
} from '../render.js';
import { roundRect, spacedText, drawAvatar } from '../ui/draw.js';
import { lapName, SEAT_CLOCKWISE as ORDER } from '../game/gameRules.js';
import { net } from '../net/ws.js';
import { getUser } from '../net/api.js';

const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const SERIF = '"Songti SC","STSong","Noto Serif SC",serif';
const GOLD = '#e8c37a';
const GREEN = '#7ee2b8';

/**
 * 等待开局页：沿用对局页（设计稿 03）牌桌框架
 * 去掉牌河/手牌/操作按钮，展示三家席位、准备状态与空位
 */
export default class RoomScene {
  constructor() {
    this.k = SCREEN_WIDTH / 380;
    this.startTime = Date.now();
    this.room = { code: '456789', mode: '三人经典', chips: ['4 局', '2 分', '留7垛'] };
    this.seats = [this.emptySeat(), this.emptySeat()]; // 左右两家
    this.me = { name: '你', score: 0, ready: false, host: true };
    this.onBack = null; // 返回大厅
    this.onStart = null; // 开始对局
    this.onInvite = null; // 邀请微信好友（分享），由 main 注入
    this.pressed = null;
    this.layout = null;
    this.timer = null;
    this.readyToastShown = false;

    // 联机状态
    this.online = false; // 由服务器房间状态驱动
    this.pub = null; // 服务器房间快照
    this.mySeat = 'me'; // 我的服务器座位
    this.myUserId = null;
  }

  emptySeat() {
    return { joined: false, name: '', score: 0, ready: false, avatar: '' };
  }

  /** 由创建房间页传入：房号 / 配置项 */
  setRoom(room) {
    if (room) this.room = room;
    this.seats = [this.emptySeat(), this.emptySeat()];
    this.me.ready = false;
    this.layout = null;
    this.readyToastShown = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // 联机模式：等服务器 roomState 驱动，不做本地演示
    if (room && room.online) {
      this.online = true;
      return;
    }
    this.online = false;
    // 演示：好友 1.2s 后进入并准备，用于展示「已准备 / 空位」两种状态
    this.timer = setTimeout(() => {
      const names = ['青鸾', '白鹭', '墨客'];
      const n = names[Math.floor(Math.random() * names.length)];
      this.seats[0] = {
        joined: true,
        name: n,
        score: 0,
        ready: true,
        avatar: n[0],
      };
      this.checkAllReady();
    }, 1200);
  }

  /**
   * 应用服务器房间状态（roomState）
   * 服务器座位是「房间绝对座位」，本页面按我的座位重映射为左右两家
   */
  applyServer(pub) {
    if (!pub || !Array.isArray(pub.players)) return;
    this.pub = pub;
    this.online = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.room = {
      ...this.room,
      code: pub.code,
      mode: pub.mode || this.room.mode,
      rounds: pub.rounds || this.room.rounds,
      laps: pub.laps || pub.rounds || this.room.laps || 2,
      chips: this.room.chips || [`${pub.laps || pub.rounds || 2} 圈`, '留 7 垛'],
      hasPassword: pub.hasPassword,
      status: pub.status,
    };

    const user = getUser();
    this.myUserId = user ? user.id : null;
    const me = pub.players.find((p) => String(p.userId) === String(this.myUserId));
    this.mySeat = me ? me.seat : 'me';
    if (me) {
      this.me.ready = !!me.ready;
      this.me.name = me.nickname || this.me.name;
      this.me.avatar = (me.nickname || '我')[0];
      this.me.host = String(pub.ownerId) === String(me.userId);
    }

    const slots = [this.emptySeat(), this.emptySeat()];
    const myIdx = ORDER.indexOf(this.mySeat);
    for (const p of pub.players) {
      if (me && p.userId === me.userId) continue;
      const rel = (ORDER.indexOf(p.seat) - myIdx + ORDER.length) % ORDER.length;
      const slot = this.toSeatData(p);
      if (rel === 1) slots[0] = slot;
      else if (rel === 2) slots[1] = slot;
    }
    this.seats = slots;
    this.layout = null;
    this.checkAllReady();
  }

  toSeatData(p) {
    const nick = p.nickname || '玩家';
    return {
      joined: true,
      name: nick,
      score: p.points || 0,
      ready: !!p.ready,
      avatar: nick[0],
      isAI: !!p.isAI,
      userId: p.userId,
    };
  }

  /* ---------- 状态 ---------- */

  seatList() {
    return [this.seats[0], this.seats[1], this.me];
  }

  readyCount() {
    if (this.online && this.pub) return this.pub.players.filter((p) => p.ready).length;
    return this.seatList().filter((s) => s.ready).length;
  }

  allReady() {
    if (this.online && this.pub) {
      return this.pub.players.length === 3 && this.pub.players.every((p) => p.ready);
    }
    return this.seatList().every((s) => s.ready);
  }

  checkAllReady() {
    if (this.allReady() && !this.readyToastShown) {
      this.readyToastShown = true;
      wx.showToast({ title: '全员已准备，可以开局', icon: 'success' });
    }
  }

  /** 好友加入空位（演示：随机昵称，已准备） */
  joinSeat(i) {
    if (this.seats[i].joined) return;
    const names = ['青鸾', '白鹭', '墨客'];
    const n = names[Math.floor(Math.random() * names.length)];
    this.seats[i] = {
      joined: true,
      name: n,
      score: 0,
      ready: true,
      avatar: n[0],
    };
    wx.showToast({ title: `${n} 已加入房间`, icon: 'none' });
    this.checkAllReady();
  }

  startGame() {
    if (this.onStart) {
      this.onStart({
        code: this.room.code,
        chips: this.room.chips,
        laps: this.room.laps || this.room.rounds || 2,
        handNo: this.room.handNo || 0,
        playedHands: this.room.playedHands || 0,
        dealer: this.room.dealer || null,
      });
    }
  }

  /** 结算后「准备」回到房间：带着上一局结果（圈巡 / 庄家 / 已打局数）开启下一局 */
  resume(info = {}) {
    if (this.timer) clearTimeout(this.timer);
    this.room = {
      ...this.room,
      handNo: info.handNo || 0,
      playedHands: info.playedHands || 0,
      dealer: info.dealer || null,
      rotations: info.rotations || this.room.rotations || 0,
      laps: info.laps || this.room.laps || 2,
      chips: info.chips && info.chips.length ? info.chips : this.room.chips,
    };
    // 两位好友仍在房间，均已准备；自己需重新准备
    this.seats = [
      { joined: true, name: '青鸾', score: 0, ready: true, avatar: '青' },
      { joined: true, name: '白鹭', score: 0, ready: true, avatar: '白' },
    ];
    this.me.ready = false;
    this.layout = null;
    this.readyToastShown = true; // 避免再次弹出全员准备提示
  }

  /* ---------- 触摸 ---------- */

  inRect(x, y, r) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  hit(x, y) {
    for (const it of this.layout ? this.layout.items : []) {
      if (this.inRect(x, y, it)) return it.id;
    }
    return null;
  }

  onTouchStart(x, y) {
    this.pressed = this.hit(x, y);
  }

  onTouchMove() {}

  onTouchEnd(x, y) {
    const pressed = this.pressed;
    this.pressed = null;
    if (pressed && this.hit(x, y) === pressed) this.handle(pressed);
  }

  handle(id) {
    switch (id) {
      case 'back':
      case 'exit':
        if (this.onBack) this.onBack();
        break;
      case 'invite':
      case 'inviteBtn': {
        if (this.online) {
          // 邀请微信好友（分享卡片带房号）；补 AI 仍可点击空席位
          if (this.onInvite) this.onInvite();
          break;
        }
        const i = this.seats[0].joined ? 1 : 0;
        this.joinSeat(i);
        break;
      }
      case 'seat:0':
      case 'seat:1': {
        const i = id === 'seat:0' ? 0 : 1;
        if (this.seats[i].joined) {
          wx.showToast({ title: '该席位已有玩家', icon: 'none' });
          break;
        }
        if (this.online) {
          net.send('addAI', {});
          break;
        }
        this.joinSeat(i);
        break;
      }
      case 'code':
        try {
          if (wx.setClipboardData) wx.setClipboardData({ data: this.room.code });
        } catch (e) {
          // 忽略剪贴板失败
        }
        wx.showToast({ title: '房号已复制', icon: 'none' });
        break;
      case 'ready':
        // 全员准备后按钮为「开始游戏」
        if (this.allReady()) {
          this.startGame();
          break;
        }
        if (this.online) {
          net.send('ready', {});
          break;
        }
        this.me.ready = !this.me.ready;
        if (this.me.ready) {
          wx.showToast({ title: '已准备', icon: 'none' });
          this.checkAllReady();
        } else {
          this.readyToastShown = false;
          wx.showToast({ title: '已取消准备', icon: 'none' });
        }
        break;
      case 'start':
        this.startGame();
        break;
      default:
        break;
    }
  }

  /* ---------- 布局 ---------- */

  buildLayout() {
    const k = this.k;
    const W = SCREEN_WIDTH;
    const H = SCREEN_HEIGHT;
    const items = [];

    const topY = STATUS_BAR_HEIGHT + 8 * k;
    const barH = 30 * k;
    items.push({ id: 'back', x: 16 * k, y: topY + 1 * k, w: 28 * k, h: 28 * k });
    items.push({ id: 'invite', x: W - 16 * k - 30 * k, y: topY, w: 30 * k, h: barH });

    const chipsY = topY + barH + 12 * k;
    const chipsH = 24 * k;

    const seatsY = chipsY + chipsH + 20 * k;
    const seatH = 146 * k;
    const seatW = 104 * k;
    const leftX = 16 * k;
    const rightX = W - 16 * k - seatW;
    items.push({ id: 'seat:0', x: leftX, y: seatsY, w: seatW, h: seatH });
    items.push({ id: 'seat:1', x: rightX, y: seatsY, w: seatW, h: seatH });

    const codeLabelY = seatsY + seatH + 34 * k;
    const codeDigitsY = codeLabelY + 34 * k;
    const codeHintY = codeDigitsY + 24 * k;
    items.push({
      id: 'code',
      x: W / 2 - 90 * k,
      y: codeLabelY - 16 * k,
      w: 180 * k,
      h: codeHintY - codeLabelY + 20 * k,
    });

    const titleY = codeHintY + 44 * k;
    const subY = titleY + 22 * k;
    const dotsY = subY + 28 * k;
    const inviteY = dotsY + 26 * k;
    items.push({ id: 'inviteBtn', x: 16 * k, y: inviteY, w: W - 32 * k, h: 44 * k });

    // 底部：准备按钮 + 退出
    const btnY = H - SAFE_BOTTOM - 34 * k - 52 * k;
    const meCardY = btnY - 12 * k - 64 * k;
    items.push({ id: 'ready', x: 16 * k, y: btnY, w: W - 32 * k, h: 52 * k });
    items.push({ id: 'exit', x: 16 * k, y: btnY + 56 * k, w: W - 32 * k, h: 22 * k });

    this.layout = {
      items,
      topY,
      barH,
      chipsY,
      chipsH,
      seatsY,
      seatH,
      seatW,
      leftX,
      rightX,
      codeLabelY,
      codeDigitsY,
      codeHintY,
      titleY,
      subY,
      dotsY,
      inviteY,
      btnY,
      meCardY,
    };
  }

  /* ---------- 渲染 ---------- */

  render(ctx) {
    if (!this.layout) this.buildLayout();
    const L = this.layout;

    this.drawBackground(ctx);
    this.drawTopBar(ctx, L);
    this.drawChips(ctx, L);
    this.drawSeats(ctx, L);
    this.drawCode(ctx, L);
    this.drawWaitState(ctx, L);
    this.drawInviteButton(ctx, L);
    this.drawMeCard(ctx, L);
    this.drawFoot(ctx, L);
  }

  drawBackground(ctx) {
    const W = SCREEN_WIDTH;
    const H = SCREEN_HEIGHT;
    const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, H * 0.78);
    g.addColorStop(0, '#16735a');
    g.addColorStop(0.4, '#0c4738');
    g.addColorStop(0.74, '#062a20');
    g.addColorStop(1, '#04150f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 桌面细网点
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    const step = 7;
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();
  }

  drawTopBar(ctx, L) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const cy = L.topY + L.barH / 2;

    // 返回
    const r = 14 * k;
    const bx = 16 * k + r;
    ctx.save();
    if (this.pressed === 'back') ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(bx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = '#cfe0d7';
    ctx.lineWidth = 2 * k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx + 3.2 * k, cy - 6 * k);
    ctx.lineTo(bx - 3.2 * k, cy);
    ctx.lineTo(bx + 3.2 * k, cy + 6 * k);
    ctx.stroke();
    ctx.restore();

    // 房号徽章
    const badgeX = 52 * k;
    ctx.font = `500 ${Math.round(11 * k)}px ${SANS}`;
    const labelW = ctx.measureText(`房号 ${this.room.code}`).width;
    const badgeW = labelW + 24 * k;
    roundRect(ctx, badgeX, L.topY, badgeW, L.barH, 8 * k);
    const bg = ctx.createLinearGradient(0, L.topY, 0, L.topY + L.barH);
    bg.addColorStop(0, 'rgba(232,195,122,.22)');
    bg.addColorStop(1, 'rgba(232,195,122,.06)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#f0e2c2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`房号 ${this.room.code}`, badgeX + badgeW / 2, cy + 0.5 * k);

    // 邀请（＋）
    const ix = W - 16 * k - 30 * k + 15 * k;
    ctx.save();
    if (this.pressed === 'invite') ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(ix, cy, 15 * k, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = '#cfe0d7';
    ctx.lineWidth = 2 * k;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ix - 5 * k, cy);
    ctx.lineTo(ix + 5 * k, cy);
    ctx.moveTo(ix, cy - 5 * k);
    ctx.lineTo(ix, cy + 5 * k);
    ctx.stroke();
    ctx.restore();
  }

  drawChips(ctx, L) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const chips = this.room.chips || [];
    ctx.font = `500 ${Math.round(9.5 * k)}px ${SANS}`;
    const gap = 8 * k;
    const padX = 9 * k;
    const widths = chips.map((t) => ctx.measureText(t).width + padX * 2);
    const total = widths.reduce((a, b) => a + b, gap * (chips.length - 1)) || 0;
    let x = (W - total) / 2;
    chips.forEach((t, i) => {
      roundRect(ctx, x, L.chipsY, widths[i], L.chipsH, L.chipsH / 2);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.09)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#a9cfc1';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t, x + widths[i] / 2, L.chipsY + L.chipsH / 2 + 0.5 * k);
      x += widths[i] + gap;
    });
  }

  // 状态胶囊：返回宽度
  drawStatusPill(ctx, cx, cy, text, ok) {
    const { k } = this;
    ctx.font = `500 ${Math.round(9.5 * k)}px ${SANS}`;
    const w = ctx.measureText(text).width + 16 * k;
    const h = 20 * k;
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    if (ok) {
      ctx.fillStyle = 'rgba(126,226,184,.14)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(126,226,184,.45)';
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
    }
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = ok ? GREEN : '#9fb8ae';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 0.5 * k);
    return w;
  }

  drawSeatCard(ctx, x, y, w, h, seat, id) {
    const { k } = this;
    const cx = x + w / 2;
    const pressed = this.pressed === id;

    roundRect(ctx, x, y, w, h, 16 * k);
    if (seat.joined) {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, pressed ? 'rgba(255,255,255,.13)' : 'rgba(255,255,255,.10)');
      g.addColorStop(1, 'rgba(255,255,255,.03)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.10)';
      ctx.lineWidth = 1;
      ctx.stroke();

      drawAvatar(ctx, cx, y + 44 * k, 22 * k, seat.avatar, ['#4aa88a', '#1b5c47']);
      ctx.font = `600 ${Math.round(11.5 * k)}px ${SANS}`;
      ctx.fillStyle = '#f0f5f2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(seat.name, cx, y + 88 * k);
      ctx.font = `${Math.round(10 * k)}px ${SANS}`;
      ctx.fillStyle = seat.score < 0 ? '#f0a08a' : GOLD;
      ctx.fillText(String(seat.score), cx, y + 104 * k);
      this.drawStatusPill(ctx, cx, y + 124 * k, seat.ready ? '已准备' : '未准备', seat.ready);
    } else {
      ctx.fillStyle = pressed ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.035)';
      ctx.fill();
      ctx.save();
      ctx.setLineDash([6 * k, 5 * k]);
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // 虚线空头像
      ctx.save();
      ctx.setLineDash([4 * k, 4 * k]);
      ctx.beginPath();
      ctx.arc(cx, y + 44 * k, 22 * k, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      ctx.font = `500 ${Math.round(18 * k)}px ${SANS}`;
      ctx.fillStyle = '#5f8578';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('＋', cx, y + 44 * k + 1 * k);

      ctx.font = `500 ${Math.round(11 * k)}px ${SANS}`;
      ctx.fillStyle = '#7fa094';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('空位', cx, y + 88 * k);
      ctx.font = `${Math.round(9 * k)}px ${SANS}`;
      ctx.fillStyle = '#5f8578';
      ctx.fillText('点击邀请好友', cx, y + 106 * k);
    }
  }

  drawSeats(ctx, L) {
    const { k } = this;
    this.drawSeatCard(ctx, L.leftX, L.seatsY, L.seatW, L.seatH, this.seats[0], 'seat:0');
    this.drawSeatCard(ctx, L.rightX, L.seatsY, L.seatW, L.seatH, this.seats[1], 'seat:1');

    // 中央「待」圆徽
    const cx = SCREEN_WIDTH / 2;
    const cy = L.seatsY + 64 * k;
    const r = 27 * k;
    const g = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.2, cx, cy, r);
    g.addColorStop(0, 'rgba(232,195,122,.20)');
    g.addColorStop(1, 'rgba(232,195,122,.03)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.32)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `700 ${Math.round(20 * k)}px ${SERIF}`;
    ctx.fillStyle = 'rgba(232,195,122,.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('待', cx, cy + 1 * k);

    // 圆徽下方小字
    ctx.font = `${Math.round(9 * k)}px ${SANS}`;
    ctx.fillStyle = '#6f9287';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('三人局', cx, cy + r + 14 * k);
  }

  drawCode(ctx, L) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const pressed = this.pressed === 'code';

    ctx.font = `500 ${Math.round(9 * k)}px ${SANS}`;
    ctx.fillStyle = '#7fa094';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    spacedText(ctx, '房 号', W / 2, L.codeLabelY, {
      font: `500 ${Math.round(9 * k)}px ${SANS}`,
      fill: '#7fa094',
      spacing: 2.5 * k,
    });

    const code = String(this.room.code);
    const text = `${code.slice(0, 3)} ${code.slice(3)}`;
    ctx.save();
    if (pressed) ctx.globalAlpha = 0.65;
    spacedText(ctx, text, W / 2, L.codeDigitsY, {
      font: `700 ${Math.round(30 * k)}px ${SERIF}`,
      fill: '#f0d9a6',
      spacing: 4 * k,
    });
    ctx.restore();

    ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#6f9287';
    ctx.fillText('轻触复制房号', W / 2, L.codeHintY);
  }

  drawWaitState(ctx, L) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const ready = this.readyCount();
    const all = this.allReady();
    const resumed = !!this.room.dealer; // 续局：庄家已由上局结果确定
    // 庄家昵称取服务端房间玩家（不再写死机器人名字）
    const dealerPlayer = this.pub && Array.isArray(this.pub.players)
      ? this.pub.players.find((p) => p.seat === this.room.dealer)
      : null;
    const dealerName = (dealerPlayer && dealerPlayer.nickname) ||
      (this.room.dealer === this.mySeat ? this.me.name : '庄家');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${Math.round(16 * k)}px ${SANS}`;
    ctx.fillStyle = all ? GOLD : '#f0f6f3';
    ctx.fillText(
      resumed
        ? `下一局 · ${lapName(this.room.rotations || 0)} · 庄家 ${dealerName}`
        : all
          ? '全员已准备'
          : '等待牌友加入',
      W / 2,
      L.titleY
    );

    ctx.font = `${Math.round(10 * k)}px ${SANS}`;
    ctx.fillStyle = '#8fb0a3';
    ctx.fillText(
      resumed
        ? all
          ? '全员已准备，可以开局'
          : '准备后开始下一局'
        : all
          ? '对局即将开始'
          : '3 人齐聚 · 全员准备后自动开局',
      W / 2,
      L.subY
    );

    // 准备进度点
    const seats = this.seatList();
    const dotR = 4 * k;
    const gap = 14 * k;
    const totalW = dotR * 2 * 3 + gap * 2;
    let x = W / 2 - totalW / 2 + dotR;
    seats.forEach((s) => {
      ctx.beginPath();
      ctx.arc(x, L.dotsY, dotR, 0, Math.PI * 2);
      if (s.ready) {
        ctx.fillStyle = GOLD;
        ctx.fill();
      } else if (s.joined) {
        ctx.fillStyle = 'rgba(232,195,122,.18)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(232,195,122,.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.12)';
        ctx.fill();
      }
      x += dotR * 2 + gap;
    });

    ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#8fb0a3';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${ready} / 3`, W / 2 + totalW / 2 + 10 * k, L.dotsY + 0.5 * k);
  }

  drawInviteButton(ctx, L) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const x = 16 * k;
    const w = W - 32 * k;
    const pressed = this.pressed === 'inviteBtn';

    roundRect(ctx, x, L.inviteY, w, 44 * k, 14 * k);
    ctx.fillStyle = pressed ? 'rgba(232,195,122,.14)' : 'rgba(232,195,122,.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(13 * k)}px ${SANS}`;
    ctx.fillStyle = GOLD;
    ctx.fillText('＋  邀请好友加入', W / 2, L.inviteY + 22 * k);
  }

  drawMeCard(ctx, L) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const x = 16 * k;
    const w = W - 32 * k;
    const y = L.meCardY;
    const h = 64 * k;

    roundRect(ctx, x, y, w, h, 16 * k);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, 'rgba(232,195,122,.14)');
    g.addColorStop(1, 'rgba(232,195,122,.02)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.40)';
    ctx.lineWidth = 1;
    ctx.stroke();

    drawAvatar(ctx, x + 34 * k, y + h / 2, 19 * k, '我', ['#4aa88a', '#1b5c47'], { isMe: true });

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${Math.round(12 * k)}px ${SANS}`;
    ctx.fillStyle = '#f0f6f3';
    ctx.fillText('你', x + 62 * k, y + 28 * k);

    // 房主标签
    const tagX = x + 62 * k + ctx.measureText('你').width + 8 * k;
    ctx.font = `500 ${Math.round(8.5 * k)}px ${SANS}`;
    const tagW = ctx.measureText('房主').width + 12 * k;
    roundRect(ctx, tagX, y + 16 * k, tagW, 15 * k, 7.5 * k);
    ctx.fillStyle = 'rgba(232,195,122,.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('房主', tagX + tagW / 2, y + 23.5 * k);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${Math.round(10 * k)}px ${SANS}`;
    ctx.fillStyle = this.me.score < 0 ? '#f0a08a' : GOLD;
    ctx.fillText(String(this.me.score), x + 62 * k, y + 46 * k);

    // 右侧准备状态
    this.drawStatusPill(ctx, x + w - 40 * k, y + h / 2, this.me.ready ? '已准备' : '未准备', this.me.ready);
  }

  drawFoot(ctx, L) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const btnX = 16 * k;
    const btnW = W - 32 * k;
    const btnY = L.btnY;
    const btnH = 52 * k;
    const all = this.allReady();
    const label = all ? '开始游戏' : this.me.ready ? '取消准备' : '准备';
    const id = all ? 'start' : 'ready';

    const g = ctx.createLinearGradient(0, btnY, 0, btnY + btnH);
    g.addColorStop(0, '#f6e0ac');
    g.addColorStop(0.55, '#e4be79');
    g.addColorStop(1, '#d3a859');
    roundRect(ctx, btnX, btnY, btnW, btnH, 16 * k);
    ctx.save();
    ctx.shadowColor = 'rgba(232,195,122,.5)';
    ctx.shadowBlur = 20 * k;
    ctx.shadowOffsetY = 6 * k;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    if (this.pressed === id) {
      roundRect(ctx, btnX, btnY, btnW, btnH, 16 * k);
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.fill();
    }

    // 流光
    const t = ((Date.now() - this.startTime) % 2600) / 2600;
    ctx.save();
    roundRect(ctx, btnX, btnY, btnW, btnH, 16 * k);
    ctx.clip();
    const sx = btnX + (btnW + 60 * k) * t - 30 * k;
    const sg = ctx.createLinearGradient(sx - 30 * k, 0, sx + 30 * k, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, 'rgba(255,255,255,.35)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sx - 30 * k, btnY, 60 * k, btnH);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(16 * k)}px ${SANS}`;
    ctx.fillStyle = '#3a2a0c';
    ctx.fillText(label, W / 2, btnY + btnH / 2 + 1 * k);

    // 退出房间
    ctx.font = `${Math.round(10.5 * k)}px ${SANS}`;
    ctx.fillStyle = this.pressed === 'exit' ? 'rgba(127,160,148,.6)' : '#7fa094';
    ctx.textBaseline = 'middle';
    ctx.fillText('退出房间', W / 2, btnY + btnH + 21 * k);
  }
}
