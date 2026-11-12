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
const NAV_H = 50;

const SUIT_COLOR = { 万: '#a8382c', 筒: '#1d5c96', 条: '#2e7d4f' };
const HONOR_COLOR = {
  东: '#1d5c96',
  南: '#1d5c96',
  西: '#1d5c96',
  北: '#1d5c96',
  白: '#1d5c96',
  中: '#a8382c',
  发: '#2e7d4f',
};

function deltaText(delta) {
  if (delta > 0) return `+${delta}`;
  return `${delta}`;
}

/**
 * 对局详情页：按设计稿 04 结算页布局
 * （顶部胶囊 + 牌型标题 + 胡牌牌面 + 计分明细 + 三家点数变动；
 *   底部操作按钮已去除，左上角为返回按钮）
 */
export default class HistoryDetailScene {
  constructor() {
    this.k = SCREEN_WIDTH / 380;
    this.rec = null;
    this.scrollY = 0;
    this.maxScroll = 0;
    this.layoutCache = null;
    this.backBtn = null;
    this.pressed = false;
    this.dragging = false;
    this.moved = false;
    this.onBack = null; // 返回回调，由 main 注入
    this.onRetry = null; // 详情加载失败后重试
    this.status = 'loading'; // loading / idle / error / empty
    this.statusText = '正在加载对局详情…';
  }

  setRecord(rec) {
    this.rec = rec;
    this.status = rec ? 'idle' : 'empty';
    this.statusText = rec ? '' : '暂无对局详情';
    this.scrollY = 0;
    this.layoutCache = null;
  }

  setStatus(status, text) {
    this.status = status;
    this.statusText = text || {
      loading: '正在加载对局详情…',
      empty: '暂无对局详情',
      error: '详情加载失败 · 点击重试',
    }[status] || '';
    if (status === 'loading') this.rec = null;
    this.layoutCache = null;
  }

  /* ---------- 触摸 ---------- */

  inRect(x, y, r) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  onTouchStart(x, y) {
    this.pressed = this.inRect(x, y, this.backBtn);
    this.dragging = true;
    this.moved = false;
    this.startY = y;
    this.startScroll = this.scrollY;
  }

  onTouchMove(x, y) {
    if (!this.dragging) return;
    const dy = y - this.startY;
    if (Math.abs(dy) > 4) {
      this.moved = true;
      this.pressed = false;
    }
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.startScroll - dy));
  }

  onTouchEnd(x, y) {
    const pressed = this.pressed;
    this.pressed = false;
    this.dragging = false;
    if (!this.moved && pressed && this.inRect(x, y, this.backBtn)) {
      if (this.onBack) this.onBack();
      return;
    }
    if (!this.moved && this.status === 'error' && this.hitStatus(x, y) && this.onRetry) {
      this.onRetry();
    }
  }

  /* ---------- 布局 ---------- */

  buildLayout(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const navH = NAV_H * k;
    const contentTop = STATUS_BAR_HEIGHT + navH + 10 * k;
    const contentBottom = SCREEN_HEIGHT - SAFE_BOTTOM - 16 * k;
    const viewH = contentBottom - contentTop;
    const contentX = 20 * k;
    const contentW = W - contentX * 2;
    const innerX = contentX + 12 * k;
    const innerW = contentW - 24 * k;

    const rec = this.rec;
    const blocks = [];
    let y = 0;

    // 加载中 / 失败 / 空数据：只显示状态卡
    if (!rec || this.status !== 'idle') {
      blocks.push({ type: 'status', y, h: 80 * k, text: this.statusText });
      y += 80 * k;
      const totalH = y + 10 * k;
      this.maxScroll = Math.max(0, totalH - viewH);
      this.layoutCache = { blocks, totalH, viewH, contentTop, contentX, contentW, innerX, innerW };
      return;
    }

    // 头部：胶囊 + 标题 + 副标题
    const headH = 22 * k + 16 * k + 30 * k + 9 * k + 13 * k;
    blocks.push({ type: 'head', y, h: headH });
    y += headH + 8 * k;

    // 三家亮牌卡（与结算详情页同款）：胡牌者最上层；无牌谱数据时回退单牌面卡
    if (rec.players && rec.players.length) {
      const ordered = rec.players.slice().sort((a, b) => (a.winner ? -1 : b.winner ? 1 : 0));
      const gap = 3 * k;
      const tileMaxW = 24 * k;
      const nameRowH = 14 * k;
      const rows = ordered.map((p) => {
        const melds = p.melds || [];
        const totalCols = p.hand.length + melds.length * 3;
        const tileW = Math.min(
          tileMaxW,
          (innerW - gap * (totalCols - 1) - 4 * k * Math.max(0, melds.length - 1)) / totalCols,
        );
        const tileH = tileW * 1.4;
        const stackH = melds.some((m) => m.type !== 'peng') ? tileH * 0.55 : 0;
        const cardH = 10 * k + nameRowH + 5 * k + stackH + tileH + 10 * k;
        return { p, tileW, tileH, stackH, cardH };
      });
      const playersH = rows.reduce((n, r) => n + r.cardH, 0) + (rows.length - 1) * 8 * k;
      blocks.push({ type: 'players', y, h: playersH, rows, gap, nameRowH });
      y += playersH + 14 * k;
    } else if (rec.hand && rec.hand.length) {
      const tileW = Math.min(30 * k, (innerW - 6 * 3 * k) / 7);
      const tileH = tileW * 1.4;
      const rows = Math.ceil(rec.hand.length / 7);
      const handH = 14 * k + rows * tileH + (rows - 1) * 5 * k + 16 * k;
      blocks.push({ type: 'hand', y, h: handH, tileW, tileH, rows });
      y += handH + 14 * k;
    }

    // 计分明细
    if (rec.fans && rec.fans.length) {
      const fansH =
        14 * k + rec.fans.length * 27 * k + 10 * k + 1 * k + 10 * k + 26 * k + 12 * k;
      blocks.push({ type: 'fans', y, h: fansH });
      y += fansH + 14 * k;
    }

    // 三家点数变动（有计算过程的行加高）
    const deltas = rec.deltas || [];
    const deltaRowH = deltas.some((d) => d.detail) ? 58 * k : 44 * k;
    const deltasH = deltas.length * deltaRowH + (deltas.length - 1) * 6 * k;
    blocks.push({ type: 'deltas', y, h: deltasH, rowH: deltaRowH });
    y += deltasH;

    const totalH = y + 10 * k;
    this.maxScroll = Math.max(0, totalH - viewH);
    this.layoutCache = {
      blocks,
      totalH,
      viewH,
      contentTop,
      contentX,
      contentW,
      innerX,
      innerW,
    };
  }

  /* ---------- 渲染 ---------- */

  render(ctx) {
    if (!this.layoutCache) this.buildLayout(ctx);
    const W = SCREEN_WIDTH;
    const L = this.layoutCache;

    this.drawBackground(ctx);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, L.contentTop, W, L.viewH);
    ctx.clip();
    ctx.translate(0, L.contentTop - this.scrollY);
    for (const b of L.blocks) {
      if (b.type === 'status') this.drawStatus(ctx, b);
      else if (b.type === 'head') this.drawHead(ctx, b);
      else if (b.type === 'hand') this.drawHand(ctx, b);
      else if (b.type === 'players') this.drawPlayers(ctx, b);
      else if (b.type === 'fans') this.drawFans(ctx, b);
      else if (b.type === 'deltas') this.drawDeltas(ctx, b);
    }
    ctx.restore();

    this.drawScrollbar(ctx);
    this.drawNav(ctx);
  }

  // 结算页背景：偏绿的径向渐变 + 顶部金色光晕
  drawBackground(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const H = SCREEN_HEIGHT;
    const L = this.layoutCache;
    const g = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.9);
    g.addColorStop(0, '#2a6b4f');
    g.addColorStop(0.42, '#0d3a2b');
    g.addColorStop(0.78, '#061a14');
    g.addColorStop(1, '#04110d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 金色光晕
    const glow = ctx.createRadialGradient(
      W / 2,
      L.contentTop,
      0,
      W / 2,
      L.contentTop,
      170 * k
    );
    glow.addColorStop(0, 'rgba(232,195,122,.22)');
    glow.addColorStop(0.62, 'rgba(232,195,122,.06)');
    glow.addColorStop(1, 'rgba(232,195,122,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  hitStatus(x, y) {
    const L = this.layoutCache;
    if (!L || this.status === 'idle') return false;
    const b = L.blocks.find((q) => q.type === 'status');
    if (!b) return false;
    const sy = L.contentTop - this.scrollY + b.y;
    return x >= L.contentX && x <= L.contentX + L.contentW && y >= sy && y <= sy + b.h;
  }

  drawStatus(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    roundRect(ctx, L.contentX, b.y, L.contentW, b.h, 14 * k);
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `500 ${Math.round(11.5 * k)}px ${SANS}`;
    ctx.fillStyle = this.status === 'error' ? '#e8a098' : '#9cb8ad';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.text || '', L.contentX + L.contentW / 2, b.y + b.h / 2);
  }

  drawHead(ctx, b) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const rec = this.rec;
    let y = b.y;

    // 顶部胶囊
    ctx.font = `600 ${Math.round(11 * k)}px ${SANS}`;
    const tw =
      ctx.measureText(rec.winTag).width + 4 * k * Math.max(0, [...rec.winTag].length - 1);
    const pw = tw + 28 * k;
    const pg = ctx.createLinearGradient(0, y, 0, y + 22 * k);
    pg.addColorStop(0, '#f6e0ac');
    pg.addColorStop(1, '#d9ae62');
    ctx.save();
    ctx.shadowColor = 'rgba(232,195,122,.8)';
    ctx.shadowBlur = 18 * k;
    ctx.shadowOffsetY = 6 * k;
    roundRect(ctx, (W - pw) / 2, y, pw, 22 * k, 11 * k);
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.restore();
    spacedText(ctx, rec.winTag, W / 2, y + 11.5 * k, {
      font: `600 ${Math.round(11 * k)}px ${SANS}`,
      fill: '#3a2a0c',
      spacing: 4 * k,
      baseline: 'middle',
    });
    y += 22 * k + 16 * k;

    // 牌型标题（金色渐变字）
    const titleFont = `700 ${Math.round(26 * k)}px ${SANS}`;
    ctx.font = titleFont;
    const tg = ctx.createLinearGradient(0, y + 4 * k, 0, y + 28 * k);
    tg.addColorStop(0, '#fffaea');
    tg.addColorStop(0.6, '#eed3a0');
    tg.addColorStop(1, '#cda45c');
    spacedText(ctx, rec.title, W / 2, y + 24 * k, {
      font: titleFont,
      fill: tg,
      spacing: 4.2 * k,
    });
    y += 30 * k + 9 * k;

    // 副标题
    spacedText(ctx, rec.round, W / 2, y + 11 * k, {
      font: `${Math.round(10.5 * k)}px ${SANS}`,
      fill: 'rgba(255,255,255,.42)',
      spacing: 1.9 * k,
    });
  }

  // 牌背面（暗杠底下三张）
  drawTileBack(ctx, x, y, w, h) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#3d6b58');
    g.addColorStop(1, '#1d3f33');
    roundRect(ctx, x, y, w, h, w * 0.16);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.5)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, w * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(232,195,122,.55)';
    ctx.fill();
  }

  // 三家亮牌卡：胡牌者最上层（金边 + 「胡」标），其余按记录顺序；副露在前（杠第 4 张叠中间上方）
  drawPlayers(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    const rec = this.rec;
    let py = b.y;
    for (const row of b.rows) {
      const { p, tileW, tileH, stackH, cardH } = row;
      const isWinRow = !!p.winner;
      roundRect(ctx, L.contentX, py, L.contentW, cardH, 14 * k);
      if (isWinRow) {
        const hg = ctx.createLinearGradient(L.contentX, py, L.contentX + L.contentW, py + cardH);
        hg.addColorStop(0, 'rgba(232,195,122,.20)');
        hg.addColorStop(1, 'rgba(232,195,122,.05)');
        ctx.fillStyle = hg;
        ctx.fill();
        ctx.strokeStyle = 'rgba(232,195,122,.55)';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.05)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.09)';
      }
      ctx.lineWidth = 1;
      ctx.stroke();

      // 名字行：头像 + 名字 + 胡标 / 庄标
      const nameCy = py + 10 * k + b.nameRowH / 2;
      drawAvatar(ctx, L.contentX + 22 * k, nameCy, 9 * k, p.char, p.grad, { isMe: !!p.me });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `500 ${Math.round(11.5 * k)}px ${SANS}`;
      ctx.fillStyle = isWinRow ? '#f4e2bb' : '#c7dbd2';
      ctx.fillText(p.name, L.contentX + 38 * k, nameCy + 0.5 * k);
      let tagX = L.contentX + 38 * k + ctx.measureText(p.name).width + 7 * k;
      if (isWinRow) {
        ctx.beginPath();
        ctx.arc(tagX + 8 * k, nameCy, 8 * k, 0, Math.PI * 2);
        ctx.fillStyle = '#d9ae62';
        ctx.fill();
        ctx.fillStyle = '#3a2a0c';
        ctx.font = `700 ${Math.round(8.5 * k)}px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText('胡', tagX + 8 * k, nameCy + 0.5 * k);
        tagX += 19 * k;
        ctx.textAlign = 'left';
      }
      if (p.dealer) {
        ctx.beginPath();
        ctx.arc(tagX + 8 * k, nameCy, 8 * k, 0, Math.PI * 2);
        ctx.fillStyle = '#d9ae62';
        ctx.fill();
        ctx.fillStyle = '#3a2a0c';
        ctx.font = `700 ${Math.round(8.5 * k)}px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText('庄', tagX + 8 * k, nameCy + 0.5 * k);
      }

      // 牌面行：副露（碰/杠）在前，手牌在后
      const tilesTop = py + 10 * k + b.nameRowH + 5 * k + stackH;
      let tx = L.contentX + 12 * k;
      for (const m of p.melds || []) {
        const concealedGang = m.type === 'gang' && m.concealed;
        for (let i = 0; i < 3; i++) {
          const mx = tx + i * (tileW + b.gap);
          if (concealedGang) this.drawTileBack(ctx, mx, tilesTop, tileW, tileH);
          else {
            drawTileBody(ctx, mx + tileW / 2, tilesTop + tileH / 2, tileW, tileH, {});
            drawTileFace(ctx, mx + tileW / 2, tilesTop + tileH / 2, tileW, tileH, m.tile, {});
          }
        }
        if (m.type !== 'peng') {
          // 杠：第 4 张正面叠在中间那张上方
          const sx = tx + tileW + b.gap;
          const sy = tilesTop - tileH * 0.55 + tileH / 2;
          drawTileBody(ctx, sx + tileW / 2, sy, tileW, tileH, { glow: true });
          drawTileFace(ctx, sx + tileW / 2, sy, tileW, tileH, m.tile, {});
        }
        tx += 3 * (tileW + b.gap) + 4 * k;
      }
      const winIdx = isWinRow && rec.winTile ? p.hand.lastIndexOf(rec.winTile) : -1;
      p.hand.forEach((tile, i) => {
        const cx = tx + i * (tileW + b.gap) + tileW / 2;
        const cy = tilesTop + tileH / 2;
        const isWin = i === winIdx;
        drawTileBody(ctx, cx, cy, tileW, tileH, { glow: isWin });
        drawTileFace(ctx, cx, cy, tileW, tileH, tile, { picked: isWin });
        if (isWin) drawWinBadge(ctx, cx + tileW / 2, cy - tileH / 2, 5.5 * k);
      });
      py += cardH + 8 * k;
    }
  }

  // 胡牌牌面卡（无牌谱数据时的回退）
  drawHand(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    const rec = this.rec;

    const bg = ctx.createLinearGradient(
      L.contentX,
      b.y,
      L.contentX + L.contentW,
      b.y + b.h
    );
    bg.addColorStop(0, 'rgba(255,255,255,.09)');
    bg.addColorStop(1, 'rgba(255,255,255,.02)');
    roundRect(ctx, L.contentX, b.y, L.contentW, b.h, 18 * k);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const tilesTop = b.y + 14 * k;
    const perRow = 7;
    const gap = 3 * k;
    const winIdx = rec.hand.lastIndexOf(rec.winTile); // 胡的那张（末次出现）
    rec.hand.forEach((tile, i) => {
      const row = Math.floor(i / perRow);
      const inRow = i % perRow;
      const rowCount = Math.min(perRow, rec.hand.length - row * perRow);
      const rowW = rowCount * b.tileW + (rowCount - 1) * gap;
      const x0 = L.contentX + (L.contentW - rowW) / 2;
      const x = x0 + inRow * (b.tileW + gap);
      const ty = tilesTop + row * (b.tileH + 5 * k);
      const cx = x + b.tileW / 2;
      const isWin = i === winIdx;
      const cy = ty + b.tileH / 2 + (isWin ? -5 * k : 0); // 胡的牌抬高
      drawTileBody(ctx, cx, cy, b.tileW, b.tileH, { glow: isWin });
      drawTileFace(ctx, cx, cy, b.tileW, b.tileH, tile, { picked: isWin });
      if (isWin) drawWinBadge(ctx, cx + b.tileW / 2 + 1 * k, cy - b.tileH / 2 + 1 * k, 6.5 * k);
    });
  }

  // 计分明细卡
  drawFans(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    const rec = this.rec;

    roundRect(ctx, L.contentX, b.y, L.contentW, b.h, 16 * k);
    ctx.fillStyle = 'rgba(0,0,0,.24)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    let cy = b.y + 14 * k;
    ctx.textBaseline = 'alphabetic';
    for (const fan of rec.fans) {
      ctx.textAlign = 'left';
      ctx.font = `${Math.round(12 * k)}px ${SANS}`;
      ctx.fillStyle = '#cfe0d7';
      ctx.fillText(fan.label, L.innerX, cy + 14 * k);
      ctx.textAlign = 'right';
      ctx.font = `${Math.round(12 * k)}px ${SANS}`;
      ctx.fillStyle = GOLD;
      ctx.fillText(fan.value, L.innerX + L.innerW, cy + 14 * k);
      cy += 27 * k;
    }

    // 合计行（虚线分隔）
    ctx.save();
    ctx.setLineDash([4 * k, 4 * k]);
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath();
    ctx.moveTo(L.innerX, cy + 5 * k);
    ctx.lineTo(L.innerX + L.innerW, cy + 5 * k);
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.font = `${Math.round(11 * k)}px ${SANS}`;
    ctx.fillStyle = '#8fae9f';
    ctx.fillText('合 计', L.innerX, cy + 26 * k);
    ctx.textAlign = 'right';
    ctx.font = `600 ${Math.round(22 * k)}px ${SERIF}`;
    ctx.fillStyle = '#f4e2bb';
    ctx.fillText(rec.total, L.innerX + L.innerW, cy + 30 * k);
  }

  // 三家点数变动（含分数计算过程，与结算详情页口径一致）
  drawDeltas(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    const rec = this.rec;
    const rowH = b.rowH || 44 * k;
    const hasDetail = rowH > 44 * k;

    let cy = b.y;
    for (const d of rec.deltas) {
      const isWin = d.delta > 0;
      roundRect(ctx, L.contentX, cy, L.contentW, rowH, 12 * k);
      if (isWin) {
        const g = ctx.createLinearGradient(L.contentX, 0, L.contentX + L.contentW, 0);
        g.addColorStop(0, 'rgba(232,195,122,.16)');
        g.addColorStop(1, 'rgba(232,195,122,.04)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(232,195,122,.3)';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.04)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.06)';
      }
      ctx.lineWidth = 1;
      ctx.stroke();

      const avaCy = cy + (hasDetail ? rowH / 2 - 8 * k : rowH / 2);
      drawAvatar(ctx, L.contentX + 12 * k + 13 * k, avaCy, 13 * k, d.char, d.grad, {
        isMe: d.me,
      });

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `500 ${Math.round(11.5 * k)}px ${SANS}`;
      ctx.fillStyle = '#e6f0ea';
      ctx.fillText(d.name, L.contentX + 12 * k + 26 * k + 10 * k, avaCy);

      // 分数计算过程（小字，名字下方；过长自动截断）
      if (d.detail) {
        ctx.font = `${Math.round(9 * k)}px ${SANS}`;
        ctx.fillStyle = 'rgba(207,224,215,.62)';
        let text = d.detail;
        const maxW = L.contentW - (12 * k + 26 * k + 10 * k) - 12 * k - 46 * k;
        while (ctx.measureText(text).width > maxW && text.length > 1) {
          text = text.slice(0, -1);
        }
        if (text !== d.detail && text.length > 1) text = `${text}…`;
        ctx.fillText(text, L.contentX + 12 * k + 26 * k + 10 * k, avaCy + 15 * k);
      }

      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(13 * k)}px ${SANS}`;
      ctx.fillStyle = d.delta > 0 ? GOLD : '#8fb0a2';
      ctx.fillText(deltaText(d.delta), L.contentX + L.contentW - 12 * k, avaCy);

      cy += rowH + 6 * k;
    }
  }

  drawScrollbar(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const L = this.layoutCache;
    if (this.maxScroll <= 0) return;
    const trackTop = L.contentTop + 4 * k;
    const trackH = L.viewH - 8 * k;
    const thumbH = Math.max(30 * k, (L.viewH / L.totalH) * trackH);
    const thumbY = trackTop + (this.scrollY / this.maxScroll) * (trackH - thumbH);
    roundRect(ctx, W - 7 * k, thumbY, 3 * k, thumbH, 1.5 * k);
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fill();
  }

  drawNav(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const navH = NAV_H * k;
    const cy = STATUS_BAR_HEIGHT + navH / 2;

    // 返回按钮
    const bx = 16 * k;
    const r = 15 * k;
    ctx.save();
    if (this.pressed) ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(bx + r, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = '#cfe0d7';
    ctx.lineWidth = 2 * k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx + r + 3.5 * k, cy - 6.5 * k);
    ctx.lineTo(bx + r - 3.5 * k, cy);
    ctx.lineTo(bx + r + 3.5 * k, cy + 6.5 * k);
    ctx.stroke();
    ctx.restore();
    this.backBtn = { x: bx, y: cy - r, w: r * 2, h: r * 2 };

    // 标题
    spacedText(ctx, '对局详情', W / 2, cy + 5 * k, {
      font: `600 ${Math.round(14 * k)}px ${SANS}`,
      fill: '#f1f7f3',
      spacing: 2.8 * k,
    });
  }
}
