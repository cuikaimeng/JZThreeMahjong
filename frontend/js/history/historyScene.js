import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  STATUS_BAR_HEIGHT,
  SAFE_BOTTOM,
} from '../render.js';
import { roundRect, spacedText, drawTileBody } from '../ui/draw.js';
import { drawTileFace, drawWinBadge } from '../ui/tileFace.js';


const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const SERIF = '"Songti SC","STSong","Noto Serif SC",serif';
const GOLD = '#e8c37a';
const NAV_H = 50;

const RESULT_COLOR = {
  win: { dot: '#55c79a', delta: GOLD },
  lose: { dot: '#e0685a', delta: '#e0685a' },
  draw: { dot: '#9cb8ad', delta: '#9cb8ad' },
};

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
 * 战绩页面：汇总卡 + 牌局记录列表（可滚动）
 */
export default class HistoryScene {
  constructor() {
    this.k = SCREEN_WIDTH / 380;
    this.scrollY = 0;
    this.maxScroll = 0;
    this.layoutCache = null;
    this.backBtn = null;
    this.pressed = false;
    this.dragging = false;
    this.moved = false;
    this.onBack = null; // 返回回调，由 main 注入
    this.onOpenDetail = null; // 打开对局详情回调（传记录 id），由 main 注入
    this.onLoadMore = null; // 滚动到底加载下一页，由 main 注入
    this.onRetry = null; // 加载失败后点击重试，由 main 注入
    this.pressedIdx = -1; // 当前按下的记录索引

    // 真实战绩数据（由 main 通过 setData 注入）
    this.summary = { points: 0, total: 0, wins: 0, winRate: '0%' };
    this.records = [];
    this.status = 'loading'; // loading / idle / error / empty
    this.statusText = '正在加载战绩…';
    this.hasMore = false;
    this.loadMorePending = false;
  }

  /** 注入后端数据；append=true 为分页追加 */
  setData({ summary, records, append = false }) {
    if (summary) this.summary = summary;
    this.records = append ? this.records.concat(records || []) : records || [];
    if (!append) this.scrollY = 0;
    this.layoutCache = null;
  }

  setStatus(status, text) {
    this.status = status;
    this.statusText = text || {
      loading: '正在加载战绩…',
      empty: '暂无对局记录，先去打一局吧',
      error: '战绩加载失败',
    }[status] || '';
    this.loadMorePending = false; // 本轮加载结束，允许继续触底加载
    this.layoutCache = null;
  }

  /* ---------- 触摸 ---------- */

  inRect(x, y, r) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // 命中加载状态卡（失败时可点击重试）
  hitStatus(x, y) {
    const L = this.layoutCache;
    if (!L || this.status === 'idle') return false;
    const b = L.blocks.find((q) => q.type === 'status');
    if (!b) return false;
    const sy = L.contentTop - this.scrollY + b.y;
    return (
      x >= L.contentX &&
      x <= L.contentX + L.contentW &&
      y >= sy &&
      y <= sy + b.h
    );
  }

  // 命中某条记录（内容坐标转屏幕坐标判断），返回记录索引
  hitRecord(x, y) {
    const L = this.layoutCache;
    if (!L) return -1;
    for (const b of L.blocks) {
      if (b.type !== 'record') continue;
      const sy = L.contentTop - this.scrollY + b.y;
      if (
        x >= L.contentX &&
        x <= L.contentX + L.contentW &&
        y >= sy &&
        y <= sy + b.h
      ) {
        return b.recIdx;
      }
    }
    return -1;
  }

  onTouchStart(x, y) {
    this.pressed = this.inRect(x, y, this.backBtn);
    this.pressedIdx = this.hitRecord(x, y);
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
      this.pressedIdx = -1;
    }
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.startScroll - dy));
    // 滚动到底：拉取下一页（由 main 注入加载逻辑，防止重复触发）
    if (
      this.hasMore &&
      !this.loadMorePending &&
      this.onLoadMore &&
      this.maxScroll > 0 &&
      this.scrollY >= this.maxScroll - 12 * this.k
    ) {
      this.loadMorePending = true;
      this.onLoadMore();
    }
  }

  onTouchEnd(x, y) {
    const pressed = this.pressed;
    const pressedIdx = this.pressedIdx;
    this.pressed = false;
    this.pressedIdx = -1;
    this.dragging = false;
    if (!this.moved && pressed && this.inRect(x, y, this.backBtn)) {
      if (this.onBack) this.onBack();
      return;
    }
    if (!this.moved && this.status === 'error' && this.hitStatus(x, y) && this.onRetry) {
      this.onRetry();
      return;
    }
    if (!this.moved && pressedIdx >= 0 && this.hitRecord(x, y) === pressedIdx) {
      const rec = this.records[pressedIdx];
      if (rec && this.onOpenDetail) this.onOpenDetail(rec.id);
    }
  }

  /* ---------- 布局 ---------- */

  // 计算一排牌的尺寸（等比缩小塞进可用宽度）
  measureTileRow(hand, innerW, k) {
    const gap = 3 * k;
    const n = hand.length;
    const w = Math.min(19 * k, (innerW - (n - 1) * gap) / n);
    return { w, h: w * 1.42, gap };
  }

  buildLayout(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const navH = NAV_H * k;
    const contentTop = STATUS_BAR_HEIGHT + navH + 12 * k;
    const contentBottom = SCREEN_HEIGHT - SAFE_BOTTOM - 16 * k;
    const viewH = contentBottom - contentTop;
    const contentX = 22 * k;
    const contentW = W - contentX * 2;
    const innerX = contentX + 12 * k;
    const innerW = contentW - 24 * k;

    const blocks = [];
    let y = 0;

    // 汇总卡
    blocks.push({ type: 'summary', y, h: 78 * k });
    y += 78 * k + 16 * k;

    // 加载中 / 空数据 / 错误提示
    if (this.status !== 'idle') {
      blocks.push({ type: 'status', y, h: 64 * k, text: this.statusText });
      y += 64 * k + 10 * k;
    }

    this.records.forEach((rec, recIdx) => {
      // 列表只显示自己的牌面
      const myHand = rec.hand || [];
      const tiles = this.measureTileRow(myHand, innerW, k);

      // tag 行数（模拟排版）
      ctx.font = `500 ${Math.round(9.5 * k)}px ${SANS}`;
      let tx = innerX;
      let tagRows = 1;
      for (const t of rec.tags || []) {
        const pw = ctx.measureText(t).width + 12 * k;
        if (tx + pw > innerX + innerW) {
          tagRows++;
          tx = innerX;
        }
        tx += pw + 6 * k;
      }
      const tagH = tagRows * 16 * k + (tagRows - 1) * 6 * k;

      const cardH =
        12 * k + 16 * k + 6 * k + 14 * k + 8 * k + tiles.h + 10 * k + tagH + 12 * k;
      blocks.push({ type: 'record', y, h: cardH, rec, recIdx, tiles, innerX, innerW, myHand });
      y += cardH + 10 * k;
    });

    const totalH = y + 6 * k;
    this.maxScroll = Math.max(0, totalH - viewH);
    this.layoutCache = { blocks, totalH, viewH, contentTop, contentX, contentW };
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
      if (b.type === 'summary') this.drawSummary(ctx, b);
      else if (b.type === 'status') this.drawStatus(ctx, b);
      else if (b.type === 'record') this.drawRecord(ctx, b);
    }
    ctx.restore();

    this.drawScrollbar(ctx);
    this.drawNav(ctx);
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

    ctx.save();
    ctx.globalAlpha = 0.3;
    const g2 = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.5);
    g2.addColorStop(0, 'rgba(255,255,255,.14)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  drawCardBase(ctx, x, y, w, h) {
    const { k } = this;
    const bg = ctx.createLinearGradient(x, y, x + w, y + h);
    bg.addColorStop(0, 'rgba(255,255,255,.07)');
    bg.addColorStop(1, 'rgba(255,255,255,.02)');
    roundRect(ctx, x, y, w, h, 14 * k);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawStatus(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    this.drawCardBase(ctx, L.contentX, b.y, L.contentW, b.h);
    ctx.font = `500 ${Math.round(11.5 * k)}px ${SANS}`;
    ctx.fillStyle = this.status === 'error' ? '#e8a098' : '#9cb8ad';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.text || '', L.contentX + L.contentW / 2, b.y + b.h / 2);
  }

  drawSummary(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    this.drawCardBase(ctx, L.contentX, b.y, L.contentW, b.h);

    // 左侧：累计点数
    const cx = L.contentX + 16 * k;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${Math.round(24 * k)}px ${SANS}`;
    ctx.fillStyle = this.summary.points >= 0 ? GOLD : '#e0685a';
    ctx.fillText(deltaText(this.summary.points), cx, b.y + 42 * k);
    ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#9cb8ad';
    ctx.fillText('累计点数', cx, b.y + 60 * k);

    // 分隔线
    const divX = cx + 56 * k;
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath();
    ctx.moveTo(divX, b.y + 16 * k);
    ctx.lineTo(divX, b.y + b.h - 16 * k);
    ctx.stroke();

    // 右侧：三项统计
    const stats = [
      { label: '对局', value: `${this.summary.total}` },
      { label: '胜局', value: `${this.summary.wins}` },
      { label: '胜率', value: this.summary.winRate },
    ];
    const areaX = divX + 12 * k;
    const areaW = L.contentX + L.contentW - 16 * k - areaX;
    stats.forEach((s, i) => {
      const sx = areaX + (areaW / 3) * (i + 0.5);
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.round(15 * k)}px ${SANS}`;
      ctx.fillStyle = '#f2f7f4';
      ctx.fillText(s.value, sx, b.y + 38 * k);
      ctx.font = `${Math.round(9 * k)}px ${SANS}`;
      ctx.fillStyle = '#9cb8ad';
      ctx.fillText(s.label, sx, b.y + 56 * k);
    });
  }

  drawRecord(ctx, b) {
    const { k } = this;
    const rec = b.rec;
    const color = RESULT_COLOR[rec.result];

    ctx.save();
    if (this.pressedIdx === b.recIdx) ctx.globalAlpha = 0.6;
    this.drawCardBase(ctx, this.layoutCache.contentX, b.y, this.layoutCache.contentW, b.h);

    let cy = b.y + 12 * k; // 内容顶部游标

    // 第 1 行：房间/时间 + 点数
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${Math.round(10.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#9cb8ad';
    ctx.fillText(`${rec.room} · ${rec.time}`, b.innerX, cy + 11 * k);
    ctx.textAlign = 'right';
    ctx.font = `700 ${Math.round(16 * k)}px ${SANS}`;
    ctx.fillStyle = color.delta;
    ctx.fillText(deltaText(rec.delta), b.innerX + b.innerW, cy + 13 * k);
    cy += 16 * k + 6 * k;

    // 第 2 行：结果说明（带色点）
    ctx.beginPath();
    ctx.arc(b.innerX + 2 * k, cy + 8 * k, 3 * k, 0, Math.PI * 2);
    ctx.fillStyle = color.dot;
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = `500 ${Math.round(12 * k)}px ${SANS}`;
    ctx.fillStyle = '#cfe0d9';
    ctx.fillText(rec.detail, b.innerX + 10 * k, cy + 12 * k);
    cy += 14 * k + 8 * k;

    // 第 3 行：自己的牌面（胡牌时胡的那张抬高 + 金边 + 角标）
    const myHand = b.myHand;
    const tilesTop = cy;
    const winIdx = rec.result === 'win' ? myHand.lastIndexOf(rec.winTile) : -1;
    myHand.forEach((tile, i) => {
      const x = b.innerX + i * (b.tiles.w + b.tiles.gap);
      const isWin = i === winIdx;
      const cyTile = tilesTop + b.tiles.h / 2 + (isWin ? -4 * k : 0);
      drawTileBody(
        ctx,
        x + b.tiles.w / 2,
        cyTile,
        b.tiles.w,
        b.tiles.h,
        { glow: isWin }
      );
      drawTileFace(
        ctx,
        x + b.tiles.w / 2,
        cyTile,
        b.tiles.w,
        b.tiles.h,
        tile,
        { picked: isWin }
      );
      if (isWin) drawWinBadge(ctx, x + b.tiles.w + 1 * k, cyTile - b.tiles.h / 2 + 1 * k, 5.5 * k);
    });
    cy = tilesTop + b.tiles.h + 10 * k;

    // 第 4 行：特殊牌局 tag
    ctx.font = `500 ${Math.round(9.5 * k)}px ${SANS}`;
    let tx = b.innerX;
    let ty = cy;
    for (const t of rec.tags || []) {
      const pw = ctx.measureText(t).width + 12 * k;
      if (tx + pw > b.innerX + b.innerW) {
        tx = b.innerX;
        ty += 16 * k + 6 * k;
      }
      roundRect(ctx, tx, ty, pw, 16 * k, 8 * k);
      const isResult = t === '自摸' || t === '包胡' || t === '流局';
      if (isResult) {
        ctx.fillStyle = 'rgba(85,199,154,.12)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(85,199,154,.4)';
      } else {
        ctx.fillStyle = 'rgba(232,195,122,.12)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(232,195,122,.3)';
      }
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = isResult ? '#55c79a' : GOLD;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t, tx + pw / 2, ty + 8.5 * k);
      tx += pw + 6 * k;
    }
    ctx.restore();
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
    spacedText(ctx, '战绩', W / 2, cy + 5 * k, {
      font: `600 ${Math.round(14 * k)}px ${SANS}`,
      fill: '#f1f7f3',
      spacing: 2.8 * k,
    });
  }
}
