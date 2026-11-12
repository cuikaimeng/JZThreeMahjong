import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  STATUS_BAR_HEIGHT,
  SAFE_BOTTOM,
} from '../render.js';
import { roundRect, spacedText, drawTileBody, drawAvatar } from '../ui/draw.js';
import { drawTileFace, drawWinBadge } from '../ui/tileFace.js';

const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const SERIF = '"Songti SC","STSong","Noto Serif SC",serif';
const GOLD = '#e8c37a';

/**
 * 结算页：按设计稿 04 布局
 * 胡牌标签 + 番型标题 + 胡牌手牌 + 番数明细 + 三家得分变化 + 底部单一按钮
 * 底部按钮：未完赛 → 「准备」；最后一局已结束 → 「返回大厅」
 */
export default class ResultScene {
  constructor() {
    this.k = SCREEN_WIDTH / 380;
    this.startTime = Date.now();
    this.pressed = null;
    this.btn = null;
    this.onReady = null; // 准备（进入下一局等待）
    this.onLobby = null; // 返回大厅
    this.data = this.defaultData();
  }

  defaultData() {
    return {
      winTag: '自 摸',
      handName: '清一色 · 门清',
      roundText: '东一局 · 第 6 巡 · 壁牌 24 张',
      hand: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '7m', '8m', '9m', '9m', '1m', '1m'],
      winTileIndex: 12,
      fans: [
        { name: '清一色', value: '6 番' },
        { name: '门清', value: '1 番' },
        { name: '自摸', value: '1 番' },
      ],
      totalFan: '8 番',
      deltas: [
        { seat: 'me', name: '你', avatar: '我', grad: ['#4aa88a', '#1b5c47'], delta: 64 },
        { seat: 'left', name: '青鸾', avatar: '青', grad: ['#4aa88a', '#1b5c47'], delta: -32 },
        { seat: 'right', name: '白鹭', avatar: '白', grad: ['#6f93c9', '#2a4470'], delta: -32 },
      ],
      isLast: false,
      next: null,
    };
  }

  setResult(data) {
    this.data = data || this.defaultData();
    this.pressed = null;
    this.startTime = Date.now();
  }

  isLast() {
    return !!this.data.isLast;
  }

  /* ---------- 触摸 ---------- */

  inRect(x, y, r) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  hit(x, y) {
    return this.inRect(x, y, this.btn) ? 'btn' : null;
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
    if (id !== 'btn') return;
    if (this.isLast()) {
      if (this.onLobby) this.onLobby();
    } else if (this.onReady) {
      this.onReady(this.data.next);
    }
  }

  /* ---------- 渲染 ---------- */

  render(ctx) {
    const k = this.k;
    const W = SCREEN_WIDTH;
    const H = SCREEN_HEIGHT;
    const d = this.data;

    // 背景
    const bg = ctx.createRadialGradient(W / 2, 0, 0, W / 2, H * 0.1, H);
    bg.addColorStop(0, '#2a6b4f');
    bg.addColorStop(0.42, '#0d3a2b');
    bg.addColorStop(0.78, '#061a14');
    bg.addColorStop(1, '#04110d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 顶部金色光晕
    const glow = ctx.createRadialGradient(W / 2, STATUS_BAR_HEIGHT - 20 * k, 0, W / 2, STATUS_BAR_HEIGHT - 20 * k, 190 * k);
    glow.addColorStop(0, 'rgba(232,195,122,.26)');
    glow.addColorStop(0.6, 'rgba(232,195,122,.06)');
    glow.addColorStop(1, 'rgba(232,195,122,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H * 0.45);

    const headTop = STATUS_BAR_HEIGHT + 46 * k;

    // 胡牌标签
    ctx.font = `600 ${Math.round(11 * k)}px ${SANS}`;
    const tagW = ctx.measureText(d.winTag).width + 28 * k;
    const tagH = 25 * k;
    const tagX = W / 2 - tagW / 2;
    roundRect(ctx, tagX, headTop, tagW, tagH, tagH / 2);
    const tg = ctx.createLinearGradient(0, headTop, 0, headTop + tagH);
    tg.addColorStop(0, '#f6e0ac');
    tg.addColorStop(1, '#d9ae62');
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.fillStyle = '#3a2a0c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.winTag, W / 2, headTop + tagH / 2 + 0.5 * k);

    // 番型标题（金色渐变）
    const titleY = headTop + tagH + 34 * k;
    const titleG = ctx.createLinearGradient(0, titleY - 24 * k, 0, titleY + 6 * k);
    titleG.addColorStop(0, '#fffaea');
    titleG.addColorStop(0.6, '#eed3a0');
    titleG.addColorStop(1, '#cda45c');
    spacedText(ctx, d.handName, W / 2, titleY, {
      font: `700 ${Math.round(25 * k)}px ${SANS}`,
      fill: titleG,
      spacing: 3.2 * k,
    });

    // 对局信息
    spacedText(ctx, d.roundText, W / 2, titleY + 25 * k, {
      font: `${Math.round(10 * k)}px ${SANS}`,
      fill: 'rgba(255,255,255,.42)',
      spacing: 2 * k,
    });

    // 胡牌手牌卡
    const hand = d.hand || [];
    const rows = hand.length > 7 ? 2 : 1;
    const tw = 29 * k;
    const th = 40 * k;
    const gap = 4 * k;
    const cardX = 20 * k;
    const cardW = W - 40 * k;
    const cardY = titleY + 46 * k;
    const cardH = th * rows + (rows - 1) * 6 * k + 26 * k;

    roundRect(ctx, cardX, cardY, cardW, cardH, 18 * k);
    const cg = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    cg.addColorStop(0, 'rgba(255,255,255,.09)');
    cg.addColorStop(1, 'rgba(255,255,255,.02)');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const perRow = Math.ceil(hand.length / rows);
    hand.forEach((tile, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const countInRow = Math.min(perRow, hand.length - row * perRow);
      const rowW = countInRow * tw + (countInRow - 1) * gap;
      const x0 = W / 2 - rowW / 2;
      const cx = x0 + col * (tw + gap) + tw / 2;
      const cy = cardY + 13 * k + th / 2 + row * (th + 6 * k);

      const isWin = i === d.winTileIndex;
      const dy = isWin ? -7 * k : 0; // 胡的牌抬高
      drawTileBody(ctx, cx, cy + dy, tw, th, { glow: isWin });
      drawTileFace(ctx, cx, cy + dy, tw, th, tile, { picked: isWin });
      if (isWin) drawWinBadge(ctx, cx + tw / 2 + 2 * k, cy + dy - th / 2 + 2 * k, 8.5 * k);
    });

    // 番数卡
    const fansY = cardY + cardH + 18 * k;
    const fansH = 16 * k + d.fans.length * 23 * k + 74 * k;
    roundRect(ctx, cardX, fansY, cardW, fansH, 16 * k);
    ctx.fillStyle = 'rgba(0,0,0,.24)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    d.fans.forEach((f, i) => {
      const y = fansY + 26 * k + i * 23 * k;
      ctx.font = `${Math.round(11.5 * k)}px ${SANS}`;
      ctx.fillStyle = '#cfe0d7';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.name, cardX + 18 * k, y);
      ctx.font = `${Math.round(11.5 * k)}px ${SANS}`;
      ctx.fillStyle = GOLD;
      ctx.textAlign = 'right';
      ctx.fillText(f.value, cardX + cardW - 18 * k, y);
    });

    // 合计
    const totalY = fansY + 26 * k + d.fans.length * 23 * k + 16 * k;
    ctx.save();
    ctx.setLineDash([5 * k, 5 * k]);
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath();
    ctx.moveTo(cardX + 18 * k, totalY - 4 * k);
    ctx.lineTo(cardX + cardW - 18 * k, totalY - 4 * k);
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    spacedText(ctx, '合 计', cardX + 18 * k, totalY + 18 * k, {
      font: `${Math.round(10.5 * k)}px ${SANS}`,
      fill: '#8fae9f',
      spacing: 2 * k,
      baseline: 'middle',
    });
    ctx.font = `600 ${Math.round(21 * k)}px ${SERIF}`;
    ctx.fillStyle = '#f4e2bb';
    ctx.textAlign = 'right';
    ctx.fillText(d.totalFan, cardX + cardW - 18 * k, totalY + 20 * k);

    // 得分变化
    const deltasY = fansY + fansH + 14 * k;
    const rowH = 40 * k;
    const rowGap = 6 * k;
    (d.deltas || []).forEach((item, i) => {
      const y = deltasY + i * (rowH + rowGap);
      const isWin = item.seat === d.winner || item.delta > 0;

      roundRect(ctx, cardX, y, cardW, rowH, 12 * k);
      if (isWin) {
        const wg = ctx.createLinearGradient(cardX, y, cardX + cardW, y);
        wg.addColorStop(0, 'rgba(232,195,122,.16)');
        wg.addColorStop(1, 'rgba(232,195,122,.04)');
        ctx.fillStyle = wg;
        ctx.fill();
        ctx.strokeStyle = 'rgba(232,195,122,.3)';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.04)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.06)';
      }
      ctx.lineWidth = 1;
      ctx.stroke();

      drawAvatar(ctx, cardX + 26 * k, y + rowH / 2, 13 * k, item.avatar, item.grad, {
        isMe: item.seat === 'me',
      });

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(11.5 * k)}px ${SANS}`;
      ctx.fillStyle = '#e6f0ea';
      ctx.fillText(item.name, cardX + 46 * k, y + rowH / 2);

      ctx.textAlign = 'right';
      ctx.font = `600 ${Math.round(13 * k)}px ${SANS}`;
      ctx.fillStyle = isWin ? GOLD : '#8fb0a2';
      ctx.fillText(`${item.delta > 0 ? '+' : ''}${item.delta}`, cardX + cardW - 16 * k, y + rowH / 2);
    });

    // 底部按钮：最后一局 → 返回大厅；否则 → 准备
    const last = this.isLast();
    const btnW = W - 40 * k;
    const btnH = 52 * k;
    const btnY = H - SAFE_BOTTOM - 26 * k - btnH;
    const btnX = 20 * k;
    this.btn = { x: btnX, y: btnY, w: btnW, h: btnH };

    const bG = ctx.createLinearGradient(0, btnY, 0, btnY + btnH);
    bG.addColorStop(0, '#f6e0ac');
    bG.addColorStop(0.55, '#e4be79');
    bG.addColorStop(1, '#d3a859');
    roundRect(ctx, btnX, btnY, btnW, btnH, 16 * k);
    ctx.save();
    ctx.shadowColor = 'rgba(232,195,122,.45)';
    ctx.shadowBlur = 18 * k;
    ctx.shadowOffsetY = 6 * k;
    ctx.fillStyle = bG;
    ctx.fill();
    ctx.restore();

    if (this.pressed === 'btn') {
      roundRect(ctx, btnX, btnY, btnW, btnH, 16 * k);
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.fill();
    }

    const label = last ? '返回大厅' : '准 备';
    spacedText(ctx, label, W / 2, btnY + btnH / 2 + 1 * k, {
      font: `700 ${Math.round(16 * k)}px ${SANS}`,
      fill: '#3a2a0c',
      spacing: last ? 3 * k : 4 * k,
    });

    // 底部提示
    if (!last) {
      ctx.font = `${Math.round(9 * k)}px ${SANS}`;
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('准备后进入下一局', W / 2, btnY + btnH + 18 * k);
    }
  }
}
