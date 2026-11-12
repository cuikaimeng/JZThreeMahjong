/**
 * 麻将牌面 / 牌背绘制
 * 牌 ID：数字牌 '1m'~'9m'（万）、'1p'~'9p'（筒/饼）、'1s'~'9s'（条）
 *        字牌 'E' 'S' 'W' 'N'（东南西北）、'C'（中）'F'（發）'P'（白）
 *
 * 牌面使用 assets/images 下的 PNG 素材（wan1~wan9 / bing1~bing9 / tiao1~tiao9 /
 * dong nan xi bei zhong fa bai / beimian），启动时 preloadTiles 预加载；
 * 素材未就绪时回退到矢量文字牌面，保证任何时刻可渲染。
 */
const SERIF = '"Songti SC","STSong","Noto Serif SC",serif';
const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';

const NUM_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

const SUITS = {
  m: { ch: '萬', color: '#a8382c', file: 'wan' },
  p: { ch: '筒', color: '#1F5F9E', file: 'bing' },
  s: { ch: '条', color: '#2f7a4f', file: 'tiao' },
};

const HONORS = {
  E: { ch: '東', color: '#1F5F9E', file: 'dong' },
  S: { ch: '南', color: '#1F5F9E', file: 'nan' },
  W: { ch: '西', color: '#1F5F9E', file: 'xi' },
  N: { ch: '北', color: '#1F5F9E', file: 'bei' },
  C: { ch: '中', color: '#B3352C', file: 'zhong' },
  F: { ch: '發', color: '#2f7a4f', file: 'fa' },
  P: { ch: '白', color: '#1F5F9E', file: 'bai' },
};

/** 资源目录：小游戏为包内相对路径；浏览器预览由入口页配置 GameGlobal.__ASSET_BASE */
const ASSET_BASE =
  (typeof GameGlobal !== 'undefined' && GameGlobal.__ASSET_BASE) || 'assets/images/';

/** 牌 ID → 素材文件名（不含扩展名） */
function tileFile(tile) {
  if (HONORS[tile]) return HONORS[tile].file;
  const m = /^([1-9])([mps])$/.exec(tile);
  if (!m) return null;
  const suit = SUITS[m[2]];
  return suit ? suit.file + m[1] : null;
}

/** 中文牌名 → 内部牌 ID（战绩数据为 '2万'/'7条'/'东' 等中文命名） */
const CN_TILE_MAP = {
  东: 'E',
  南: 'S',
  西: 'W',
  北: 'N',
  中: 'C',
  發: 'F',
  白: 'P',
};

function normalizeTile(tile) {
  if (typeof tile !== 'string') return tile;
  if (CN_TILE_MAP[tile]) return CN_TILE_MAP[tile];
  const m = /^([1-9])(万|筒|条)$/.exec(tile);
  if (m) return m[1] + { 万: 'm', 筒: 'p', 条: 's' }[m[2]];
  return tile;
}

const images = {}; // tile id → Image；'back' → 背面
let preloadStarted = false;

function createImg() {
  if (typeof wx !== 'undefined' && wx.createImage) return wx.createImage();
  return new Image();
}

/**
 * 预加载全部牌面素材（34 张牌 + 背面），完成后回调（失败项自动回退矢量绘制）
 */
export function preloadTiles(onDone) {
  if (preloadStarted) {
    if (onDone) onDone();
    return;
  }
  preloadStarted = true;

  const ids = [];
  for (let n = 1; n <= 9; n++) {
    ids.push(`${n}m`, `${n}p`, `${n}s`);
  }
  Object.keys(HONORS).forEach((id) => ids.push(id));
  ids.push('back');

  let remaining = ids.length;
  const settle = () => {
    remaining -= 1;
    if (remaining <= 0 && onDone) onDone();
  };

  ids.forEach((id) => {
    const file = id === 'back' ? 'beimian' : tileFile(id);
    const img = createImg();
    img.onload = () => {
      images[id] = img;
      settle();
    };
    img.onerror = () => settle();
    img.src = `${ASSET_BASE}${file}.png`;
  });
}

/** 牌的文字标签，如 '5p' → '五筒' */
export function tileLabel(tile) {
  if (HONORS[tile]) return HONORS[tile].ch;
  const suit = SUITS[tile[1]];
  return `${NUM_CN[+tile[0]]}${suit ? suit.ch : ''}`;
}

/** 素材就绪时给牌叠加金边 / 高亮描边 */
function drawTileEdge(ctx, cx, cy, w, h, kind) {
  const r = Math.min(w * 0.2, 7);
  ctx.save();
  if (kind === 'picked') {
    ctx.shadowColor = 'rgba(232,195,122,.55)';
    ctx.shadowBlur = w * 0.3;
  }
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, r);
  } else {
    ctx.rect(cx - w / 2, cy - h / 2, w, h);
  }
  ctx.strokeStyle = kind === 'picked' ? 'rgba(232,195,122,.95)' : 'rgba(232,195,122,.85)';
  ctx.lineWidth = kind === 'picked' ? 1.6 : 1.2;
  ctx.stroke();
  ctx.restore();
}

/**
 * 「胡」角标：标记胡的那张牌，画在牌右上角
 * cx/cy 为角标圆心，r 为半径
 */
export function drawWinBadge(ctx, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, '#f7e3b0');
  g.addColorStop(1, '#d3a859');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(58,42,12,.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = `700 ${Math.round(r * 1.1)}px ${SERIF}`;
  ctx.fillStyle = '#3a2a0c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('胡', cx, cy + r * 0.08);
  ctx.restore();
}

/**
 * 绘制牌面（素材模式为整张牌，含牌底；未加载时回退文字绘制）
 * opts: { picked 选中高亮, glow 发光 }
 */
export function drawTileFace(ctx, cx, cy, w, h, tile, opts = {}) {
  tile = normalizeTile(tile); // 兼容中文牌名（'2万'/'7条'/'东'…）
  const img = images[tile];

  // 素材未就绪 → 原矢量文字牌面（调用处通常已先画牌身）
  if (!img) {
    drawFallbackFace(ctx, cx, cy, w, h, tile);
    return;
  }

  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);

  const kind = opts.picked ? 'picked' : opts.glow ? 'glow' : null;
  if (kind) drawTileEdge(ctx, cx, cy, w, h, kind);
}

/** 矢量文字牌面（兜底） */
function drawFallbackFace(ctx, cx, cy, w, h, tile) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (HONORS[tile]) {
    const { ch, color } = HONORS[tile];
    ctx.font = `700 ${Math.round(h * 0.46)}px ${SERIF}`;
    ctx.fillStyle = color;
    ctx.fillText(ch, cx, cy + h * 0.02);
  } else {
    const suit = SUITS[tile[1]];
    const num = NUM_CN[+tile[0]] || '';
    ctx.font = `700 ${Math.round(h * 0.34)}px ${SANS}`;
    ctx.fillStyle = '#182b25';
    ctx.fillText(num, cx, cy - h * 0.17);
    if (suit) {
      ctx.font = `700 ${Math.round(h * 0.26)}px ${SERIF}`;
      ctx.fillStyle = suit.color;
      ctx.fillText(suit.ch, cx, cy + h * 0.24);
    }
  }
  ctx.restore();
}

/**
 * 绘制牌背（素材 beimian.png；未加载时回退矢量牌背）
 * opts: { picked 选中高亮, glow 发光 }
 */
export function drawTileBack(ctx, cx, cy, w, h, opts = {}) {
  const { picked = false, glow = false } = opts;
  const img = images.back;

  if (img) {
    ctx.save();
    if (glow || picked) {
      ctx.shadowColor = 'rgba(232,195,122,.55)';
      ctx.shadowBlur = w * 0.35;
    } else {
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = w * 0.18;
      ctx.shadowOffsetY = w * 0.06;
    }
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();

    if (picked || glow) {
      drawTileEdge(ctx, cx, cy, w, h, picked ? 'picked' : 'glow');
    }
    return;
  }

  drawFallbackBack(ctx, cx, cy, w, h, opts);
}

/** 矢量牌背（兜底）：青玉渐变 + 金边 + 中心菱点 */
function drawFallbackBack(ctx, cx, cy, w, h, opts = {}) {
  const { picked = false, glow = false } = opts;
  const x = cx - w / 2;
  const y = cy - h / 2;

  ctx.save();
  if (glow || picked) {
    ctx.shadowColor = 'rgba(232,195,122,.55)';
    ctx.shadowBlur = w * 0.35;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = w * 0.18;
    ctx.shadowOffsetY = w * 0.06;
  }
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#2a7f63');
  g.addColorStop(0.55, '#17614a');
  g.addColorStop(1, '#0b3a2c');
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.rect(x + 1, y + 1, w - 2, h - 2);
  ctx.strokeStyle = picked ? 'rgba(232,195,122,.85)' : 'rgba(232,195,122,.38)';
  ctx.lineWidth = picked ? 1.4 : 0.8;
  ctx.stroke();

  const dy = Math.min(w, h) * 0.16;
  ctx.beginPath();
  ctx.moveTo(cx, cy - dy);
  ctx.lineTo(cx + dy * 0.72, cy);
  ctx.lineTo(cx, cy + dy);
  ctx.lineTo(cx - dy * 0.72, cy);
  ctx.closePath();
  ctx.fillStyle = picked ? 'rgba(232,195,122,.85)' : 'rgba(232,195,122,.22)';
  ctx.fill();
}
