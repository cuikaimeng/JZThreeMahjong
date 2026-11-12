import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  STATUS_BAR_HEIGHT,
  SAFE_BOTTOM,
} from '../render.js';
import { roundRect, spacedText, drawTileBody } from '../ui/draw.js';
import { drawTileFace } from '../ui/tileFace.js';

const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const SERIF = '"Songti SC","STSong","Noto Serif SC",serif';
const GOLD = '#e8c37a';

const NAV_H = 50;
const TAB_H = 42; // 顶部标签栏高度

/** 顶部标签：规则 / 番型 */
const TABS = ['规则', '番型'];

/**
 * 规则内容（已润色排版）
 * icon: 条目前的小图标字
 */
const SECTIONS = [
  {
    no: '壹',
    title: '基础配置',
    items: [
      { icon: '牌', text: '牌张 136 张：万、筒、条 1~9 各 4 张（108 张），东南西北风 16 张、中发白 12 张，无花牌' },
      { icon: '局', text: '开局每人 13 张，庄家 14 张，先出牌' },
      { icon: '行', text: '不可吃牌，只能碰、杠、胡' },
      { icon: '胡', text: '胡牌牌型：4 组面子（顺子 / 刻子）＋ 1 对将；或七对；或十三幺（1饼、9饼、1万、9万、1条、9条、东南西北中发白各一张，再加其中任意一张作将）' },
    ],
  },
  {
    no: '贰',
    title: '报听（扣牌）',
    items: [
      { icon: '听', text: '报听条件：必须已有 6 点及以上可胡的牌，方可报听' },
      { icon: '扣', text: '听牌必须报听：将所听的最后一张牌扣在桌上，他人不可翻看' },
      { icon: '禁', text: '报听后：不能再换牌、不能碰牌；可以杠，但杠后仍须保持听牌；他人明杠可抢胡' },
      { icon: '限', text: '未报听状态：不能胡他人打出的低点数牌' },
    ],
  },
  {
    no: '叁',
    title: '点数限制',
    badge: '重点',
    items: [
      { icon: '算', text: '点数计算：数字牌按牌面计（3 万 = 3，6 筒 = 6）；风牌、中发白统一计 10 点' },
      { icon: '禁', text: '1、2 点：不能胡（点炮、自摸均不可）' },
      { icon: '摸', text: '3、4、5 点：只能自摸胡，不能点炮胡' },
      { icon: '炮', text: '6、7、8、9 点及风箭牌（10 点）：点炮、自摸均可胡' },
      { icon: '倍', text: '报听后自摸：点数翻倍结算' },
    ],
  },
  {
    no: '肆',
    title: '杠牌规则',
    items: [
      { icon: '明', text: '明杠：先碰过，再摸到第四张即明杠；他人打出第四张也可开杠' },
      { icon: '暗', text: '暗杠：手中四张相同，轮到自己出牌时暗杠，暗杠后补牌，他人暂不可见' },
      { icon: '墙', text: '补墙：每杠一次，牌墙尾部多留 2 张（1 垛），防止提前摸完流局' },
      { icon: '抢', text: '抢杠胡：他人明杠补的牌正是你所听之牌，可抢杠胡' },
    ],
  },
  {
    no: '伍',
    title: '结算 · 扣点',
    items: [
      { icon: '摸', text: '自摸：三家均需给分；报听自摸点数翻倍' },
      { icon: '包', text: '包胡（一包三）：未报听者打出 ≥6 点的牌被胡，放炮者一人承担三家分数' },
      { icon: '分', text: '已报听者放炮：不算包胡，胡家向三家分别收对应点数' },
      { icon: '限', text: '未报听者打出 1~5 点的牌，报听者不能胡' },
      { icon: '计', text: '计分：胡牌所得 = 所胡那张牌的牌面点数；自摸翻倍，杠分另计；清一色、对对胡、七对等番型额外叠加点数' },
    ],
  },
  {
    no: '陆',
    title: '流局（黄庄）',
    items: [
      { icon: '选', text: '流局规则可选：创建房间时配置' },
      { icon: '摸', text: '全部摸完：摸完整副牌墙仍无人胡，本局流局，不结算' },
      { icon: '留', text: '留垛不摸：预留 7 垛或 4 垛牌不摸，摸至预留线仍无人胡即流局，不结算' },
      { icon: '杠', text: '杠越多，留下的牌垛越多' },
    ],
  },
];

/**
 * 番型清单（倍数口径与后端 scoring.js SPECIAL_HANDS 一致）
 * mult: 牌型倍数；desc: 判定说明；groups: 示例牌面（每个子数组是一组面子/对子，绘制时组间留空）
 */
const HAND_TYPES = [
  {
    no: '壹',
    name: '普通牌形',
    mult: 1,
    desc: '最基础的胡牌形态：4 组面子（顺子或刻子）＋ 1 对将牌。',
    groups: [
      ['1m', '2m', '3m'],
      ['4p', '5p', '6p'],
      ['7s', '8s', '9s'],
      ['E', 'E', 'E'],
      ['C', 'C'],
    ],
  },
  {
    no: '贰',
    name: '清一色',
    mult: 2,
    desc: '全部牌为同一花色（万 / 筒 / 条）；全部为字牌时同样成立（字一色）。碰、杠等副露计入，不要求门清。',
    groups: [
      ['2m', '3m', '4m'],
      ['4m', '5m', '6m'],
      ['5m', '6m', '7m'],
      ['7m', '7m', '7m'],
      ['9m', '9m'],
    ],
  },
  {
    no: '叁',
    name: '一条龙',
    mult: 2,
    desc: '同一花色 1~9 全部齐全，可分散在顺子或刻子中，副露同样计入。',
    groups: [
      ['1m', '2m', '3m'],
      ['4m', '5m', '6m'],
      ['7m', '8m', '9m'],
      ['3p', '3p', '3p'],
      ['5p', '5p'],
    ],
  },
  {
    no: '肆',
    name: '七小对',
    mult: 2,
    desc: '门清 14 张组成 7 个对子，不能有碰、杠；对子可由任意牌组成。',
    groups: [
      ['1m', '1m'],
      ['3m', '3m'],
      ['5m', '5m'],
      ['7m', '7m'],
      ['9m', '9m'],
      ['E', 'E'],
      ['C', 'C'],
    ],
  },
  {
    no: '伍',
    name: '豪七对',
    mult: 4,
    desc: '七小对中含 4 张相同牌（未开杠）充当两对，仍须门清；倍数高于普通七小对。',
    groups: [
      ['1m', '1m', '1m', '1m'],
      ['3p', '3p'],
      ['5p', '5p'],
      ['7p', '7p'],
      ['9p', '9p'],
      ['E', 'E'],
    ],
  },
  {
    no: '陆',
    name: '十三幺',
    mult: 4,
    desc: '门清，十三种幺九字牌各一张（1/9 万筒条 + 东南西北中发白），再加其中任意一张作将。',
    groups: [
      ['1m', '9m'],
      ['1p', '9p'],
      ['1s', '9s'],
      ['E', 'S', 'W', 'N', 'C', 'F', 'P'],
      ['1m'],
    ],
  },
];

/**
 * 文本自动换行
 */
function wrapText(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    if (line && ctx.measureText(line + ch).width > maxW) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * 规则页面：顶部导航 + 可滚动内容区
 */
export default class RulesScene {
  constructor() {
    this.k = SCREEN_WIDTH / 380;
    this.tab = 0; // 0 = 规则，1 = 番型
    this.scrollCache = [0, 0]; // 各标签独立的滚动位置
    this.scrollY = 0;
    this.maxScroll = 0;
    this.layoutCache = null; // { blocks, totalH, viewH, contentTop, contentX, contentW, tabRects }
    this.backBtn = null;
    this.tabRects = [];
    this.pressed = false;
    this.pressedTab = -1;
    this.dragging = false;
    this.moved = false;
    this.onBack = null; // 返回回调，由 main 注入
  }

  /* ---------- 触摸 ---------- */

  inRect(x, y, r) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /** 命中的标签序号，未命中返回 -1 */
  tabHit(x, y) {
    for (let i = 0; i < this.tabRects.length; i++) {
      if (this.inRect(x, y, this.tabRects[i])) return i;
    }
    return -1;
  }

  switchTab(i) {
    if (i === this.tab || i < 0 || i >= TABS.length) return;
    this.scrollCache[this.tab] = this.scrollY;
    this.tab = i;
    this.scrollY = this.scrollCache[i] || 0;
    this.layoutCache = null; // 重建布局
  }

  onTouchStart(x, y) {
    this.pressed = this.inRect(x, y, this.backBtn);
    this.pressedTab = this.tabHit(x, y);
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
      this.pressedTab = -1;
    }
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.startScroll - dy));
  }

  onTouchEnd(x, y) {
    const pressed = this.pressed;
    const pressedTab = this.pressedTab;
    this.pressed = false;
    this.pressedTab = -1;
    this.dragging = false;
    if (this.moved) return;
    // 顶部标签切换
    const hit = this.tabHit(x, y);
    if (hit >= 0) {
      if (hit === pressedTab) this.switchTab(hit);
      return;
    }
    if (pressed && this.inRect(x, y, this.backBtn)) {
      if (this.onBack) this.onBack();
    }
  }

  /* ---------- 布局 ---------- */

  buildLayout(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const navH = NAV_H * k;
    const tabH = TAB_H * k;
    const contentTop = STATUS_BAR_HEIGHT + navH + tabH + 10 * k;
    const contentBottom = SCREEN_HEIGHT - SAFE_BOTTOM - 16 * k;
    const viewH = contentBottom - contentTop;
    const contentX = 22 * k;
    const contentW = W - contentX * 2;
    const textW = contentW - 24 * k - 18 * k - 9 * k;

    let blocks;
    let y;
    if (this.tab === 1) {
      ({ blocks, y } = this.buildHandsLayout(ctx, textW, contentW));
    } else {
      ({ blocks, y } = this.buildRulesLayout(ctx, textW));
    }

    // 结尾祝语
    y += 18 * k;
    blocks.push({ type: 'end', y, h: 12 * k });
    y += 12 * k;

    const totalH = y + 24 * k;
    this.maxScroll = Math.max(0, totalH - viewH);
    this.layoutCache = { blocks, totalH, viewH, contentTop, contentX, contentW };
  }

  /** 规则标签：章节 + 条目卡片 */
  buildRulesLayout(ctx, textW) {
    const { k } = this;
    const blocks = [];
    let y = 0;

    for (const sec of SECTIONS) {
      y += 18 * k;
      blocks.push({ type: 'section', y, h: 24 * k, sec });
      y += 24 * k + 8 * k;

      // 卡片内的条目
      const cardY = y;
      let iy = cardY + 12 * k;
      const itemBlocks = [];
      sec.items.forEach((item, idx) => {
        ctx.font = `400 ${Math.round(11.5 * k)}px ${SANS}`;
        const lines = wrapText(ctx, item.text, textW);
        const h = lines.length * 17.5 * k + (idx === sec.items.length - 1 ? 0 : 9 * k);
        itemBlocks.push({ type: 'item', y: iy, h, lines, icon: item.icon });
        iy += h + 9 * k;
      });
      const cardH = iy - 9 * k - cardY + 12 * k;
      blocks.push({ type: 'card', y: cardY, h: cardH });
      for (const b of itemBlocks) blocks.push(b);
      y = cardY + cardH;
    }

    return { blocks, y };
  }

  /** 番型标签：每个番型一张卡片（整数倍数 + 判定说明 + 示例牌面） */
  buildHandsLayout(ctx, textW, contentW) {
    const { k } = this;
    const blocks = [];
    let y = 6 * k;
    const padX = 16 * k;
    const lineW = textW - padX;

    for (const h of HAND_TYPES) {
      y += 14 * k;
      const cardY = y;
      ctx.font = `400 ${Math.round(11.5 * k)}px ${SANS}`;
      const lines = wrapText(ctx, h.desc, lineW);

      // 示例牌面：按牌张数量自适应牌宽（组间留空）
      const total = h.groups.reduce((n, g) => n + g.length, 0);
      const groupGap = 5 * k;
      const groupsGap = (h.groups.length - 1) * groupGap;
      const tileW = Math.min(19 * k, (lineW - groupsGap - total * 1.5 * k) / total);
      const tileH = tileW * 1.4;
      const cardH = 14 * k + 22 * k + 6 * k + lines.length * 17.5 * k + 10 * k + 11 * k + 5 * k + tileH + 14 * k;
      blocks.push({ type: 'hand', y: cardY, h: cardH, hand: h, lines, tileW, tileH, groupGap });
      y = cardY + cardH;
    }

    // 倍数说明
    y += 16 * k;
    ctx.font = `400 ${Math.round(10.5 * k)}px ${SANS}`;
    const tipLines = wrapText(
      ctx,
      '多个特殊牌型同时成立时取最高倍数：本局点数 = 胡牌张点数 × 倍数（再乘房间底分）。',
      contentW - 40 * k,
    );
    const tipH = tipLines.length * 16 * k + 20 * k;
    blocks.push({ type: 'tip', y, h: tipH, lines: tipLines });
    y += tipH;

    return { blocks, y };
  }

  /* ---------- 渲染 ---------- */

  render(ctx) {
    if (!this.layoutCache) this.buildLayout(ctx);
    const { k } = this;
    const W = SCREEN_WIDTH;

    this.drawBackground(ctx);

    // 内容区（裁剪 + 滚动）
    const L = this.layoutCache;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, L.contentTop, W, L.viewH);
    ctx.clip();
    ctx.translate(0, L.contentTop - this.scrollY);
    for (const b of L.blocks) this.drawBlock(ctx, b);
    ctx.restore();

    this.drawScrollbar(ctx);
    this.drawNav(ctx);
    this.drawTabs(ctx);
  }

  drawBlock(ctx, b) {
    if (b.type === 'section') this.drawSection(ctx, b);
    else if (b.type === 'card') this.drawCard(ctx, b);
    else if (b.type === 'item') this.drawItem(ctx, b);
    else if (b.type === 'hand') this.drawHand(ctx, b);
    else if (b.type === 'tip') this.drawTip(ctx, b);
    else if (b.type === 'end') this.drawEnd(ctx, b);
  }

  /** 顶部标签栏：规则 / 番型 */
  drawTabs(ctx) {
    const { k } = this;
    const L = this.layoutCache;
    const tabH = 34 * k;
    const tabX = L.contentX;
    const tabY = STATUS_BAR_HEIGHT + NAV_H * k + 4 * k;
    const tabW = L.contentW;

    // 容器
    roundRect(ctx, tabX, tabY, tabW, tabH, tabH / 2);
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const pad = 4 * k;
    const segW = (tabW - pad * 2) / TABS.length;
    this.tabRects = [];
    TABS.forEach((name, i) => {
      const x = tabX + pad + i * segW;
      const rect = { x, y: tabY + pad, w: segW, h: tabH - pad * 2 };
      this.tabRects.push(rect);
      const active = this.tab === i;
      const pressed = this.pressedTab === i;
      if (active) {
        const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
        g.addColorStop(0, '#f6e0ac');
        g.addColorStop(0.55, '#e8c37a');
        g.addColorStop(1, '#c99f52');
        ctx.save();
        ctx.shadowColor = 'rgba(232,195,122,.45)';
        ctx.shadowBlur = 10 * k;
        ctx.shadowOffsetY = 2 * k;
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      if (pressed && !active) ctx.globalAlpha = 0.6;
      spacedText(ctx, name, rect.x + rect.w / 2, rect.y + rect.h / 2 + 4.5 * k, {
        font: `${active ? 700 : 500} ${Math.round(12.5 * k)}px ${SANS}`,
        fill: active ? '#3a2a0c' : '#9db8ab',
        spacing: 2.4 * k,
      });
      ctx.restore();
    });
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

  drawSection(ctx, b) {
    const { k } = this;
    const { sec } = b;
    const x = this.layoutCache.contentX;

    // 章节徽章
    roundRect(ctx, x, b.y, 24 * k, 24 * k, 7 * k);
    ctx.fillStyle = 'rgba(232,195,122,.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.24)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `700 ${Math.round(12 * k)}px ${SERIF}`;
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sec.no, x + 12 * k, b.y + 12.5 * k);

    // 标题
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${Math.round(15 * k)}px ${SANS}`;
    ctx.fillStyle = '#f2f7f4';
    ctx.fillText(sec.title, x + 34 * k, b.y + 19 * k);
    const titleW = ctx.measureText(sec.title).width;

    // “重点”徽章
    if (sec.badge) {
      const bw = ctx.measureText(sec.badge).width + 12 * k;
      roundRect(ctx, x + 34 * k + titleW + 8 * k, b.y + 5 * k, bw, 14 * k, 7 * k);
      ctx.fillStyle = 'rgba(232,195,122,.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,195,122,.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.font = `500 ${Math.round(9 * k)}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sec.badge, x + 34 * k + titleW + 8 * k + bw / 2, b.y + 12.5 * k);
    }
  }

  drawCard(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    const bg = ctx.createLinearGradient(L.contentX, b.y, L.contentX + L.contentW, b.y + b.h);
    bg.addColorStop(0, 'rgba(255,255,255,.06)');
    bg.addColorStop(1, 'rgba(255,255,255,.02)');
    roundRect(ctx, L.contentX, b.y, L.contentW, b.h, 14 * k);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawItem(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    const ix = L.contentX + 12 * k;

    // 条目图标
    roundRect(ctx, ix, b.y + 1 * k, 18 * k, 18 * k, 5 * k);
    ctx.fillStyle = 'rgba(232,195,122,.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.24)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `700 ${Math.round(9 * k)}px ${SERIF}`;
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.icon, ix + 9 * k, b.y + 10.5 * k);

    // 正文（多行）
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `400 ${Math.round(11.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#cfe0d9';
    const tx = ix + 18 * k + 9 * k;
    b.lines.forEach((line, i) => {
      ctx.fillText(line, tx, b.y + 13 * k + i * 17.5 * k);
    });
  }

  /** 番型卡：序号 + 名称 + 倍数徽章 + 判定说明 + 示例牌面 */
  drawHand(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    const h = b.hand;
    const padX = 16 * k;
    const x = L.contentX + padX;
    const titleCy = b.y + 14 * k + 11 * k;

    // 卡片底
    this.drawCard(ctx, b);
    // 特殊倍数卡：金色描边点亮
    if (h.mult >= 4) {
      roundRect(ctx, L.contentX, b.y, L.contentW, b.h, 14 * k);
      ctx.strokeStyle = 'rgba(232,195,122,.30)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 序号徽章
    roundRect(ctx, x, titleCy - 11 * k, 22 * k, 22 * k, 6 * k);
    ctx.fillStyle = 'rgba(232,195,122,.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.24)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `700 ${Math.round(11 * k)}px ${SERIF}`;
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(h.no, x + 11 * k, titleCy + 0.5 * k);

    // 名称
    ctx.textAlign = 'left';
    ctx.font = `700 ${Math.round(14.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#f2f7f4';
    ctx.fillText(h.name, x + 30 * k, titleCy + 0.5 * k);

    // 倍数徽章（右上）
    const multText = `×${h.mult}`;
    ctx.font = `700 ${Math.round(11 * k)}px ${SANS}`;
    const pw = ctx.measureText(multText).width + 16 * k;
    const ph = 19 * k;
    const px = L.contentX + L.contentW - padX - pw;
    const py = titleCy - ph / 2;
    roundRect(ctx, px, py, pw, ph, ph / 2);
    if (h.mult >= 2) {
      ctx.fillStyle = 'rgba(232,195,122,.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,195,122,.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = GOLD;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#a9c2b7';
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(multText, px + pw / 2, py + ph / 2 + 0.5 * k);

    // 判定说明（多行）
    const descTop = b.y + 14 * k + 22 * k + 6 * k;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `400 ${Math.round(11.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#cfe0d9';
    b.lines.forEach((line, i) => {
      ctx.fillText(line, x, descTop + 13 * k + i * 17.5 * k);
    });

    // 示例牌面（与战绩页同一套牌面绘制）
    const labelBase = descTop + b.lines.length * 17.5 * k + 10 * k + 11 * k;
    ctx.textAlign = 'left';
    ctx.font = `600 ${Math.round(9 * k)}px ${SANS}`;
    ctx.fillStyle = 'rgba(232,195,122,.85)';
    ctx.fillText('示例', x, labelBase);

    const tilesTop = labelBase + 5 * k;
    const gap = 1.5 * k;
    let tx = x;
    for (const g of h.groups) {
      for (const tile of g) {
        const cx = tx + b.tileW / 2;
        const cy = tilesTop + b.tileH / 2;
        drawTileBody(ctx, cx, cy, b.tileW, b.tileH, {});
        drawTileFace(ctx, cx, cy, b.tileW, b.tileH, tile, {});
        tx += b.tileW + gap;
      }
      tx += b.groupGap - gap;
    }
  }

  /** 尾部提示卡 */
  drawTip(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    ctx.save();
    ctx.setLineDash([4 * k, 4 * k]);
    roundRect(ctx, L.contentX, b.y, L.contentW, b.h, 12 * k);
    ctx.strokeStyle = 'rgba(232,195,122,.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    ctx.font = `400 ${Math.round(10.5 * k)}px ${SANS}`;
    ctx.fillStyle = 'rgba(207,224,217,.72)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    b.lines.forEach((line, i) => {
      ctx.fillText(line, L.contentX + L.contentW / 2, b.y + 16 * k + i * 16 * k);
    });
  }

  drawEnd(ctx, b) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    ctx.font = `${Math.round(9 * k)}px ${SANS}`;
    ctx.fillStyle = 'rgba(232,195,122,.55)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('— 祝 牌 运 亨 通 —', W / 2, b.y + 10 * k);
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
    spacedText(ctx, '游戏规则', W / 2, cy + 5 * k, {
      font: `600 ${Math.round(14 * k)}px ${SANS}`,
      fill: '#f1f7f3',
      spacing: 2.8 * k,
    });
  }
}
