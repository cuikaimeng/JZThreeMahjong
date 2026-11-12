/**
 * 通用 Canvas 绘制工具
 */

/**
 * 圆角矩形路径
 */
export function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * 测量带字间距文本宽度（需先设置 ctx.font）
 */
export function measureSpaced(ctx, text, spacing) {
  const chars = [...text];
  let w = 0;
  for (const c of chars) w += ctx.measureText(c).width;
  return w + spacing * Math.max(0, chars.length - 1);
}

/**
 * 绘制带字间距文本（canvas 原生 letterSpacing 兼容性差，逐字绘制）
 * opts: { font, fill, spacing, align: 'left'|'center'|'right', baseline }
 */
export function spacedText(ctx, text, x, y, opts = {}) {
  const { fill, spacing = 0, align = 'center', baseline = 'alphabetic' } = opts;
  if (opts.font) ctx.font = opts.font;
  const total = measureSpaced(ctx, text, spacing);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prevAlign = ctx.textAlign;
  ctx.fillStyle = fill;
  ctx.textAlign = 'left';
  ctx.textBaseline = baseline;
  for (const c of [...text]) {
    ctx.fillText(c, cx, y);
    cx += ctx.measureText(c).width + spacing;
  }
  ctx.textAlign = prevAlign;
  return total;
}

/**
 * 绘制麻将牌牌身（不含牌面文字）
 * opts: { rotate, glow, dy }
 */
export function drawTileBody(ctx, cx, cy, w, h, opts = {}) {
  const { rotate = 0, glow = false, dy = 0 } = opts;
  ctx.save();
  ctx.translate(cx, cy + dy);
  if (rotate) ctx.rotate(rotate);

  const x = -w / 2;
  const y = -h / 2;
  const r = w * 0.17;

  ctx.shadowColor = glow ? 'rgba(232,195,122,.55)' : 'rgba(0,0,0,.45)';
  ctx.shadowBlur = glow ? w * 0.4 : w * 0.25;
  ctx.shadowOffsetY = w * 0.12;

  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#fffdf6');
  g.addColorStop(0.46, '#faf4e4');
  g.addColorStop(0.78, '#efe6cf');
  g.addColorStop(1, '#e2d7b8');
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 内侧高光
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, r * 0.8);
  ctx.strokeStyle = 'rgba(255,255,255,.55)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (glow) {
    roundRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = '#e8c37a';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else {
    roundRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = 'rgba(95,80,45,.35)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 绘制一张麻将牌（cx/cy 为牌中心，单字牌面）
 * opts: { rotate, glow, dy }
 */
export function drawTile(ctx, cx, cy, w, h, char, opts = {}) {
  drawTileBody(ctx, cx, cy, w, h, opts);

  ctx.save();
  ctx.translate(cx, cy + (opts.dy || 0));
  if (opts.rotate) ctx.rotate(opts.rotate);
  ctx.font = `700 ${Math.round(h * 0.42)}px "Songti SC","STSong","Noto Serif SC",serif`;
  ctx.fillStyle = '#1F5F9E';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, 0, h * 0.02);
  ctx.restore();
}

/**
 * 绘制玩家头像（cx/cy 圆心）
 * opts: { isMe, level }
 */
export function drawAvatar(ctx, cx, cy, r, char, grad, opts = {}) {
  const { isMe = false, level = '' } = opts;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = r * 0.3;
  ctx.shadowOffsetY = r * 0.13;

  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, grad[0]);
  g.addColorStop(1, grad[1]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke();

  if (isMe) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + Math.max(1, r * 0.05), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232,195,122,.75)';
    ctx.lineWidth = Math.max(1.5, r * 0.09);
    ctx.stroke();
  }

  ctx.font = `700 ${Math.round(r * 0.82)}px "Songti SC","STSong",serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, cx, cy - r * 0.06);
  ctx.restore();

  if (level) {
    const fs = Math.max(8, r * 0.32);
    ctx.font = `${fs}px "PingFang SC","Microsoft YaHei",sans-serif`;
    const tw = ctx.measureText(level).width;
    const bw = tw + r * 0.42;
    const bh = fs + r * 0.2;
    const bx = cx - bw / 2;
    const by = cy + r - r * 0.32;
    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fillStyle = '#0d1f19';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e8c37a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(level, cx, by + bh / 2 + 0.5);
  }
}

/**
 * 绘制底部栏线性图标（24x24 视窗，线性描边）
 * name: 'rules' | 'record' | 'settings'
 */
export function drawIcon(ctx, name, cx, cy, size, color) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  if (name === 'rules') {
    roundRect(ctx, 4, 4, 7, 16, 1.5);
    ctx.stroke();
    roundRect(ctx, 13, 4, 7, 16, 1.5);
    ctx.stroke();
  } else if (name === 'record') {
    // 奖杯杯身
    ctx.moveTo(7, 4);
    ctx.lineTo(17, 4);
    ctx.lineTo(17, 9);
    ctx.arc(12, 9, 5, 0, Math.PI, false);
    ctx.closePath();
    ctx.stroke();
    // 左耳
    ctx.beginPath();
    ctx.moveTo(7, 5);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(4.5, 7);
    ctx.arc(8, 7, 3.5, Math.PI, Math.PI / 2, true);
    ctx.stroke();
    // 右耳
    ctx.beginPath();
    ctx.moveTo(17, 5);
    ctx.lineTo(19.5, 5);
    ctx.lineTo(19.5, 7);
    ctx.arc(16, 7, 3.5, 0, Math.PI / 2, false);
    ctx.stroke();
    // 杯柄与底座
    ctx.beginPath();
    ctx.moveTo(12, 14);
    ctx.lineTo(12, 18);
    ctx.moveTo(8.5, 20.5);
    ctx.lineTo(15.5, 20.5);
    ctx.stroke();
  } else if (name === 'settings') {
    ctx.arc(12, 12, 3.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.moveTo(12 + Math.cos(a) * 6.4, 12 + Math.sin(a) * 6.4);
      ctx.lineTo(12 + Math.cos(a) * 9, 12 + Math.sin(a) * 9);
    }
    ctx.stroke();
  }
  ctx.restore();
}
