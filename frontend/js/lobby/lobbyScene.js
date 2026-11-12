import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  STATUS_BAR_HEIGHT,
  SAFE_BOTTOM,
} from '../render.js';
import {
  roundRect,
  spacedText,
  measureSpaced,
  drawTile,
  drawIcon,
} from '../ui/draw.js';
import { fetchUserInfo } from '../user/userInfo.js';

const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const SERIF = '"Songti SC","STSong","Noto Serif SC",serif';
const GOLD = '#e8c37a';

// 设计稿基准宽 380
const DESIGN_W = 380;

const RULE_ITEMS = [
  { icon: '牌', text: '136 张 · 万筒条 + 风牌字牌，无花牌，不可吃牌' },
  { icon: '听', text: '须有 6 点及以上可胡之牌，方可报听扣牌' },
  { icon: '点', text: '1~2 点不能胡 · 3~5 点仅自摸 · 6 点起可点炮' },
  { icon: '倍', text: '报听自摸点数翻倍 · 未报听放炮 ≥6 点包胡' },
  { icon: '黄', text: '流局规则可选 · 建房配置：摸完 / 留 7 垛 / 留 4 垛' },
];

const FOOT_ITEMS = [
  { id: 'rules', label: '规则', fx: 1 / 6 },
  { id: 'record', label: '战绩', fx: 1 / 2 },
  { id: 'settings', label: '设置', fx: 5 / 6 },
];

/**
 * 大厅场景：按设计稿绘制并管理可点击区域
 */
export default class LobbyScene {
  constructor() {
    this.k = SCREEN_WIDTH / DESIGN_W; // 缩放系数
    this.pressedId = null; // 当前按下的按钮
    this.buttons = []; // 可点击区域
    this.startTime = Date.now();
    this.userInfo = { nickName: '微信用户', avatarUrl: '' };
    this.avatarImg = null; // 微信头像图片（加载完成后替换占位）
    fetchUserInfo((u) => {
      this.userInfo = u;
      if (u.avatarUrl) this.loadAvatar(u.avatarUrl);
    });
    this.layout();
  }

  /** 联机登录完成后用后台真实用户覆盖占位资料 */
  setUserInfo(user) {
    if (!user) return;
    this.userInfo = user;
    if (user.avatarUrl) this.loadAvatar(user.avatarUrl);
  }

  /**
   * 加载微信头像图片
   */
  loadAvatar(url) {
    if (!url || typeof wx.createImage !== 'function') return;
    const img = wx.createImage();
    img.onload = () => {
      this.avatarImg = img;
    };
    img.onerror = () => {}; // 头像拉取失败时保留文字剪影
    img.src = url;
  }

  /* ---------- 触摸 ---------- */

  hitTest(x, y) {
    return this.buttons.find(
      (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
    );
  }

  onTouchStart(x, y) {
    const btn = this.hitTest(x, y);
    this.pressedId = btn ? btn.id : null;
  }

  onTouchMove() {}

  onTouchEnd(x, y) {
    const pressed = this.pressedId;
    this.pressedId = null;
    if (!pressed) return;
    const btn = this.hitTest(x, y);
    if (btn && btn.id === pressed && this.onButton) {
      this.onButton(btn.id);
    }
  }

  /**
   * 布局：上半部分自上而下，底部区域自下而上，中间自然留白
   */
  layout() {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const H = SCREEN_HEIGHT;
    this.padX = 22 * k;

    // ---- 自上而下 ----
    let y = STATUS_BAR_HEIGHT + 26 * k;

    const tileW = 48 * k;
    const tileH = 66 * k;
    this.brandTileCy = y + 8 * k + tileH / 2;
    y = this.brandTileCy + tileH / 2 + 26 * k;

    this.titleBase = y + 26 * k; // 标题基线
    this.subBase = this.titleBase + 14 * k;

    this.userCardY = this.subBase + 18 * k;
    this.userCardH = 80 * k;

    this.rulesY = this.userCardY + this.userCardH + 24 * k;
    this.rulesH = 13 * k + 20 * k + RULE_ITEMS.length * 29 * k + 9 * k;

    // ---- 自下而上 ----
    let b = H - SAFE_BOTTOM - 18 * k;
    this.footTextBase = b;
    this.footIconCy = b - 11 * k - 6 * k - 10.5 * k;
    this.dividerY = this.footIconCy - 10.5 * k - 14 * k;

    const outlineH = 50 * k;
    this.outlineY = this.dividerY - 18 * k - outlineH;

    const primaryH = 56 * k;
    this.primaryY = this.outlineY - 11 * k - primaryH;

    // ---- 可点击区域 ----
    const bw = W - this.padX * 2;
    this.buttons = [
      { id: 'create', x: this.padX, y: this.primaryY, w: bw, h: primaryH, toast: '创建房间' },
      { id: 'join', x: this.padX, y: this.outlineY, w: bw, h: outlineH, toast: '加入房间' },
    ];
    const footItemY = this.footIconCy - 14 * k;
    const footItemH = b - footItemY + 4 * k;
    for (const item of FOOT_ITEMS) {
      this.buttons.push({
        id: item.id,
        x: W * item.fx - 26 * k,
        y: footItemY,
        w: 52 * k,
        h: footItemH,
        toast: item.label,
      });
    }
    // 用户资料卡：放在末尾，避免影响 buttons[0]/[1] 的绘制顺序
    this.buttons.push({
      id: 'profile',
      x: this.padX,
      y: this.userCardY,
      w: bw,
      h: this.userCardH,
      toast: '微信资料',
    });
  }

  render(ctx) {
    this.drawBackground(ctx);
    this.drawDeco(ctx);
    this.drawBrand(ctx);
    this.drawUserCard(ctx);
    this.drawRules(ctx);
    this.drawPrimaryButton(ctx);
    this.drawOutlineButton(ctx);
    this.drawFooter(ctx);
  }

  drawBackground(ctx) {
    const W = SCREEN_WIDTH;
    const H = SCREEN_HEIGHT;
    const g = ctx.createRadialGradient(W / 2, -H * 0.06, 0, W / 2, -H * 0.06, H * 0.75);
    g.addColorStop(0, '#1d6a50');
    g.addColorStop(0.38, '#0e3f31');
    g.addColorStop(0.72, '#072019');
    g.addColorStop(1, '#05130f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 顶部光晕
    ctx.save();
    ctx.globalAlpha = 0.35;
    const g2 = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.55);
    g2.addColorStop(0, 'rgba(255,255,255,.14)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // 背景装饰的虚线牌框
  drawDeco(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const H = SCREEN_HEIGHT;
    const dw = 120 * k;
    const dh = 160 * k;
    const deco = [
      { x: -46 * k, y: 120 * k, rot: -18, alpha: 1 },
      { x: W - dw + 52 * k, y: 60 * k, rot: 14, alpha: 1 },
      { x: W - dw + 30 * k, y: H - dh - 190 * k, rot: -8, alpha: 0.6 },
    ];
    ctx.save();
    for (const d of deco) {
      ctx.save();
      ctx.globalAlpha = 0.1 * d.alpha;
      ctx.translate(d.x + dw / 2, d.y + dh / 2);
      ctx.rotate((d.rot * Math.PI) / 180);
      ctx.strokeStyle = 'rgba(232,195,122,.9)';
      ctx.lineWidth = 1.5 * k;
      roundRect(ctx, -dw / 2, -dh / 2, dw, dh, 12 * k);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(232,195,122,.55)';
      roundRect(ctx, -dw / 2 + 12 * k, -dh / 2 + 12 * k, dw - 24 * k, dh - 24 * k, 8 * k);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  drawBrand(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const tileW = 48 * k;
    const tileH = 66 * k;
    const gap = 12 * k;
    const cy = this.brandTileCy;

    drawTile(ctx, W / 2 - tileW - gap, cy, tileW, tileH, '一', {
      glow: true,
      rotate: (-8 * Math.PI) / 180,
      dy: 4 * k,
    });
    drawTile(ctx, W / 2, cy, tileW, tileH, '指', { dy: -6 * k });
    drawTile(ctx, W / 2 + tileW + gap, cy, tileW, tileH, '彪', {
      rotate: (8 * Math.PI) / 180,
      dy: 4 * k,
    });

    // 标题：金色渐变字
    const titleFont = `700 ${Math.round(34 * k)}px ${SANS}`;
    ctx.font = titleFont;
    const g = ctx.createLinearGradient(0, this.titleBase - 26 * k, 0, this.titleBase + 6 * k);
    g.addColorStop(0, '#fff8e6');
    g.addColorStop(0.62, '#e8c37a');
    g.addColorStop(1, '#c19a52');
    spacedText(ctx, '三人门板屋', W / 2, this.titleBase, {
      font: titleFont,
      fill: g,
      spacing: 7.5 * k,
    });

    spacedText(ctx, 'THREE · PLAYER · MAHJONG', W / 2, this.subBase, {
      font: `${Math.round(9.5 * k)}px ${SANS}`,
      fill: 'rgba(232,195,122,.62)',
      spacing: 4 * k,
    });
  }

  /**
   * 当前用户信息卡：微信头像 + 昵称 + 段位进度
   */
  drawUserCard(ctx) {
    const { k, padX } = this;
    const W = SCREEN_WIDTH;
    const x = padX;
    const y = this.userCardY;
    const w = W - padX * 2;
    const h = this.userCardH;
    const r = 16 * k;

    // 卡片底
    const bg = ctx.createLinearGradient(x, y, x + w, y + h);
    bg.addColorStop(0, 'rgba(255,255,255,.10)');
    bg.addColorStop(1, 'rgba(255,255,255,.03)');
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 头像
    const avR = 30 * k;
    const avCx = x + 16 * k + avR;
    const avCy = y + h / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = avR * 0.3;
    ctx.shadowOffsetY = avR * 0.13;
    ctx.beginPath();
    ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
    ctx.fillStyle = '#2a5546';
    ctx.fill();
    ctx.restore();

    if (this.avatarImg && this.avatarImg.width) {
      const img = this.avatarImg;
      const s = (avR * 2) / Math.min(img.width, img.height);
      ctx.save();
      ctx.beginPath();
      ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        img,
        avCx - (img.width * s) / 2,
        avCy - (img.height * s) / 2,
        img.width * s,
        img.height * s
      );
      ctx.restore();
    } else {
      // 占位：人形剪影
      ctx.save();
      ctx.beginPath();
      ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath();
      ctx.arc(avCx, avCy - avR * 0.28, avR * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(avCx, avCy + avR * 0.72, avR * 0.62, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232,195,122,.75)';
    ctx.lineWidth = 2 * k;
    ctx.stroke();

    // 昵称
    const mx = avCx + avR + 14 * k;
    const mw = x + w - 16 * k - mx;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${Math.round(17 * k)}px ${SANS}`;
    ctx.fillStyle = '#ffffff';
    const name = this.userInfo.nickName || '微信用户';
    let shown = name;
    while (shown.length > 1 && ctx.measureText(shown).width > mw) {
      shown = shown.slice(0, -1);
    }
    if (shown !== name) shown += '…';
    ctx.fillText(shown, mx, avCy + 6 * k);

    // 微信资料授权入口提示
    ctx.font = `400 ${Math.round(9.5 * k)}px ${SANS}`;
    ctx.fillStyle = 'rgba(207,224,217,.62)';
    ctx.fillText(
      this.userInfo.fromServer && this.userInfo.avatarUrl
        ? '微信资料已同步 · 点击更新'
        : '点击授权微信头像昵称',
      mx,
      avCy + 22 * k
    );
  }

  drawRules(ctx) {
    const { k, padX } = this;
    const W = SCREEN_WIDTH;
    const x = padX;
    const y = this.rulesY;
    const w = W - padX * 2;
    const h = this.rulesH;

    const bg = ctx.createLinearGradient(x, y, x + w, y + h);
    bg.addColorStop(0, 'rgba(255,255,255,.06)');
    bg.addColorStop(1, 'rgba(255,255,255,.015)');
    roundRect(ctx, x, y, w, h, 16 * k);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    spacedText(ctx, '玩法速览', x + 15 * k, y + 13 * k + 8 * k, {
      font: `${Math.round(9.5 * k)}px ${SANS}`,
      fill: '#7fa89a',
      spacing: 2.1 * k,
      align: 'left',
    });

    RULE_ITEMS.forEach((item, i) => {
      const iy = y + 13 * k + 20 * k + i * 29 * k;
      roundRect(ctx, x + 15 * k, iy, 20 * k, 20 * k, 6 * k);
      ctx.fillStyle = 'rgba(232,195,122,.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,195,122,.24)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = `700 ${Math.round(10 * k)}px ${SERIF}`;
      ctx.fillStyle = GOLD;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.icon, x + 25 * k, iy + 10.5 * k);

      ctx.font = `${Math.round(10.5 * k)}px ${SANS}`;
      ctx.fillStyle = '#a9c4b8';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(item.text, x + 44 * k, iy + 14.5 * k);
    });
  }

  // 主按钮：创建房间（带流光动画）
  drawPrimaryButton(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const b = this.buttons[0];
    const x = b.x;
    const y = b.y;
    const w = b.w;
    const h = b.h;
    const r = 16 * k;

    ctx.save();
    if (this.pressedId === 'create') ctx.globalAlpha = 0.75;

    ctx.shadowColor = 'rgba(232,195,122,.75)';
    ctx.shadowBlur = 24 * k;
    ctx.shadowOffsetY = 10 * k;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#f2d79b');
    g.addColorStop(0.52, '#e0b76d');
    g.addColorStop(1, '#c99a4f');
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // 内部高光与暗边
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillRect(x, y + 0.5 * k, w, 1.4 * k);
    ctx.fillStyle = 'rgba(140,100,40,.3)';
    ctx.fillRect(x, y + h - 2 * k, w, 2 * k);

    // 流光
    const t = ((Date.now() - this.startTime) % 2800) / 2800;
    const bandW = w * 0.36;
    const sx = x + (t * 1.6 - 0.3) * w;
    ctx.transform(1, 0, -0.325, 1, 0, 0); // skewX(-18deg)
    const shine = ctx.createLinearGradient(sx, 0, sx + bandW, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0)');
    shine.addColorStop(0.5, 'rgba(255,255,255,.55)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(sx + 0.325 * y, y, bandW, h);
    ctx.restore();

    // 文案
    const label = '＋ 创建房间';
    const pill = '自定义规则';
    ctx.font = `700 ${Math.round(17 * k)}px ${SANS}`;
    const lw = measureSpaced(ctx, label, 2 * k);
    ctx.font = `500 ${Math.round(10 * k)}px ${SANS}`;
    const pw = measureSpaced(ctx, pill, 0) + 14 * k;
    const total = lw + 10 * k + pw;
    const sx0 = W / 2 - total / 2;

    spacedText(ctx, label, sx0, y + h / 2, {
      font: `700 ${Math.round(17 * k)}px ${SANS}`,
      fill: '#3a2a0c',
      spacing: 2 * k,
      align: 'left',
      baseline: 'middle',
    });

    const pillX = sx0 + lw + 10 * k;
    roundRect(ctx, pillX, y + h / 2 - 8.5 * k, pw, 17 * k, 8.5 * k);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fill();
    spacedText(ctx, pill, pillX + pw / 2, y + h / 2, {
      font: `500 ${Math.round(10 * k)}px ${SANS}`,
      fill: '#6b5015',
      baseline: 'middle',
    });
    ctx.restore();
  }

  // 次按钮：加入房间
  drawOutlineButton(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const b = this.buttons[1];
    const x = b.x;
    const y = b.y;
    const w = b.w;
    const h = b.h;

    ctx.save();
    if (this.pressedId === 'join') ctx.globalAlpha = 0.75;

    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(232,195,122,.14)');
    g.addColorStop(1, 'rgba(232,195,122,.035)');
    roundRect(ctx, x, y, w, h, 15 * k);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.42)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const label = '加入房间';
    const pill = '输入 6 位房号';
    ctx.font = `${Math.round(14.5 * k)}px ${SANS}`;
    const lw = measureSpaced(ctx, label, 1.7 * k);
    ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
    const pw = measureSpaced(ctx, pill, 0) + 14 * k;
    const total = lw + 9 * k + pw;
    const sx0 = W / 2 - total / 2;

    spacedText(ctx, label, sx0, y + h / 2, {
      font: `${Math.round(14.5 * k)}px ${SANS}`,
      fill: '#f0e2c2',
      spacing: 1.7 * k,
      align: 'left',
      baseline: 'middle',
    });

    const pillX = sx0 + lw + 9 * k;
    roundRect(ctx, pillX, y + h / 2 - 8 * k, pw, 16 * k, 8 * k);
    ctx.fillStyle = 'rgba(0,0,0,.26)';
    ctx.fill();
    spacedText(ctx, pill, pillX + pw / 2, y + h / 2, {
      font: `${Math.round(9.5 * k)}px ${SANS}`,
      fill: '#c2a978',
      baseline: 'middle',
    });
    ctx.restore();
  }

  drawFooter(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;

    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, this.dividerY);
    ctx.lineTo(W, this.dividerY);
    ctx.stroke();

    for (const item of FOOT_ITEMS) {
      const cx = W * item.fx;
      drawIcon(ctx, item.id, cx, this.footIconCy, 21 * k, '#a8c4b8');
      spacedText(ctx, item.label, cx, this.footTextBase, {
        font: `${Math.round(10 * k)}px ${SANS}`,
        fill: '#87a49a',
        spacing: 0.6 * k,
      });
    }
  }
}
