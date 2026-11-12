import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  STATUS_BAR_HEIGHT,
  SAFE_BOTTOM,
} from '../render.js';
import { roundRect, spacedText, drawAvatar } from '../ui/draw.js';

const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const SERIF = '"Songti SC","STSong","Noto Serif SC",serif';
const GOLD = '#e8c37a';
const NAV_H = 50;

/**
 * 创建房间页：按设计稿 02 布局
 * 玩法双卡 + 规则（局数/底分/流局方式/去风牌）+ 选项（房间密码）+ 席位 + 底部创建按钮
 */
export default class CreateScene {
  constructor() {
    this.k = SCREEN_WIDTH / 380;
    this.startTime = Date.now();
    this.scrollY = 0;
    this.maxScroll = 0;
    this.layoutCache = null;
    this.backBtn = null;
    this.helpBtn = null;
    this.createBtn = null;
    this.pressed = null; // 当前按下的可点击元素 id
    this.dragging = false;
    this.moved = false;
    this.onBack = null; // 返回回调
    this.onNavigate = null; // 跳转回调（玩法说明）
    this.onEnterRoom = null; // 创建成功后进入等待房间

    // 房间配置
    this.state = { mode: 'classic', round: 0, base: 1, draw: 0, wind: false };
    this.roundOpts = ['2 圈', '4 圈', '8 圈'];
    this.baseOpts = ['1 分', '2 分', '5 分'];
    this.drawOpts = ['留7垛', '留4垛', '摸完'];
    this.pwd = '8241'; // 房间密码（4 位数字）
    // 密码编辑弹层
    this.editing = false;
    this.pwdBuf = ['', '', '', '']; // 4 位密码缓存
    this.pwdCursor = 0; // 当前光标格索引
    this.pressedPad = null;
    this.pressedDigit = -1;
    this.pwdItems = []; // 键盘按键矩形
    this.pwdDigitItems = []; // 密码格矩形
    this.pwdPanel = null; // 弹层面板矩形
  }

  /* ---------- 触摸 ---------- */

  inRect(x, y, r) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // 命中可点击元素（内容坐标 → 屏幕坐标）
  hitItem(x, y) {
    const L = this.layoutCache;
    if (!L) return null;
    for (const it of L.items) {
      const sy = L.contentTop - this.scrollY + it.y;
      if (x >= it.x && x <= it.x + it.w && y >= sy && y <= sy + it.h) return it.id;
    }
    return null;
  }

  onTouchStart(x, y) {
    if (this.editing) {
      this.pressedDigit = this.hitDigitBox(x, y);
      this.pressedPad = this.pressedDigit < 0 ? this.hitPad(x, y) : null;
      return;
    }
    this.pressed = null;
    if (this.inRect(x, y, this.backBtn)) this.pressed = 'back';
    else if (this.inRect(x, y, this.helpBtn)) this.pressed = 'help';
    else if (this.inRect(x, y, this.createBtn)) this.pressed = 'create';
    else this.pressed = this.hitItem(x, y);
    this.dragging = true;
    this.moved = false;
    this.startY = y;
    this.startScroll = this.scrollY;
  }

  onTouchMove(x, y) {
    if (this.editing) return;
    if (!this.dragging) return;
    const dy = y - this.startY;
    if (Math.abs(dy) > 4) {
      this.moved = true;
      this.pressed = null;
    }
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.startScroll - dy));
  }

  onTouchEnd(x, y) {
    if (this.editing) {
      const pad = this.pressedPad;
      const digit = this.pressedDigit;
      this.pressedPad = null;
      this.pressedDigit = -1;
      if (digit >= 0 && this.hitDigitBox(x, y) === digit) {
        this.pwdCursor = digit; // 点击密码格定位光标
        return;
      }
      if (pad && this.hitPad(x, y) === pad) this.padPress(pad);
      return;
    }
    const pressed = this.pressed;
    this.pressed = null;
    this.dragging = false;
    if (this.moved) return;
    if (pressed === 'back' && this.inRect(x, y, this.backBtn)) {
      if (this.onBack) this.onBack();
      return;
    }
    if (pressed && (this.hitItem(x, y) === pressed || pressed === 'help' || pressed === 'create')) {
      this.handle(pressed);
    }
  }

  /* ---------- 密码编辑 ---------- */

  hitPad(x, y) {
    const item = this.pwdItems.find(
      (it) => x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h
    );
    return item ? item.label : null;
  }

  // 命中某个密码格，返回格索引（0-3），未命中返回 -1
  hitDigitBox(x, y) {
    const item = this.pwdDigitItems.findIndex(
      (it) => x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h
    );
    return item;
  }

  padPress(label) {
    if (label === 'ok') {
      if (this.pwdBuf.every((d) => d !== '')) {
        this.pwd = this.pwdBuf.join('');
        wx.showToast({ title: '密码已设置', icon: 'success' });
      } else {
        wx.showToast({ title: '请输入完整密码', icon: 'none' });
        return;
      }
      this.editing = false;
      this.layoutCache = null; // 更新行显示
      return;
    }
    if (label === '清空') {
      this.pwdBuf = ['', '', '', ''];
      this.pwdCursor = 0;
      return;
    }
    // 数字：写入当前光标格，光标顺移到下一格
    this.pwdBuf[this.pwdCursor] = label;
    if (this.pwdCursor < 3) this.pwdCursor += 1;
  }

  /* ---------- 行为 ---------- */

  handle(id) {
    if (id.startsWith('seg:')) {
      const [, group, idx] = id.split(':');
      if (group === 'round') this.state.round = +idx;
      else if (group === 'base') this.state.base = +idx;
      else if (group === 'draw') this.state.draw = +idx;
      this.layoutCache = null; // 重建布局以更新选中态
      return;
    }
    if (id.startsWith('sw:')) {
      const key = id.slice(3);
      this.state[key] = !this.state[key];
      this.layoutCache = null; // 重建布局以更新开关态
      return;
    }
    switch (id) {
      case 'help':
        if (this.onNavigate) this.onNavigate('rules');
        break;
      case 'mode:blood':
        wx.showToast({ title: '三人血战 · 敬请期待', icon: 'none' });
        break;
      case 'pwd':
        this.editing = true;
        this.pwdBuf = this.pwd.split('').slice(0, 4);
        while (this.pwdBuf.length < 4) this.pwdBuf.push('');
        this.pwdCursor = 0;
        break;
      case 'seat:1':
      case 'seat:2':
        wx.showToast({ title: '邀请好友 · 敬请期待', icon: 'none' });
        break;
      case 'create': {
        const s = this.state;
        const chips = [this.roundOpts[s.round], this.baseOpts[s.base], this.drawOpts[s.draw]];
        if (s.wind) chips.push('去风牌');
        chips.push(`密码 ${this.pwd}`);
        if (this.onEnterRoom) {
          // 房号由后端 /api/rooms 生成并返回，不再本地随机；密码一并提交给后端
          this.onEnterRoom({
            mode: '三人经典',
            chips,
            laps: [2, 4, 8][s.round] || 2,
            base: [1, 2, 5][s.base] || 1,
            pwd: this.pwd,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  /* ---------- 布局 ---------- */

  // 分段选择器：右对齐排布，返回各段矩形
  layoutSeg(ctx, opts, selIdx, rightX, cy, idPrefix) {
    const { k } = this;
    ctx.font = `500 ${Math.round(10.5 * k)}px ${SANS}`;
    const parts = [];
    let wSum = 4 * k; // padding 2k * 2 + gap 2k * 3
    const widths = opts.map((t) => ctx.measureText(t).width + 18 * k);
    widths.forEach((w) => (wSum += w));
    let x = rightX - wSum;
    opts.forEach((t, i) => {
      parts.push({ id: `${idPrefix}:${i}`, text: t, x, y: cy - 13 * k, w: widths[i], h: 26 * k, on: i === selIdx });
      x += widths[i] + 2 * k;
    });
    return { parts, bgX: rightX - wSum - 2 * k, bgW: wSum + 2 * k };
  }

  buildLayout(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const navH = NAV_H * k;
    const contentTop = STATUS_BAR_HEIGHT + navH + 6 * k;
    const footH = 52 * k + 10 * k + 13 * k + 18 * k;
    const footTop = SCREEN_HEIGHT - SAFE_BOTTOM - footH;
    const contentBottom = footTop - 10 * k;
    const viewH = contentBottom - contentTop;
    const contentX = 16 * k;
    const contentW = W - contentX * 2;
    const cardPad = 13 * k;
    const rowH = 44 * k;

    const items = [];
    const blocks = [];
    let y = 0;

    // ===== 玩法 =====
    blocks.push({ type: 'label', y, text: '玩法' });
    y += 19 * k;
    const modeW = (contentW - 10 * k) / 2;
    const modeH = 90 * k;
    blocks.push({ type: 'modes', y, h: modeH, modeW });
    items.push({ id: 'mode:blood', x: contentX + modeW + 10 * k, y, w: modeW, h: modeH });
    y += modeH + 15 * k;

    // ===== 规则 =====
    blocks.push({ type: 'label', y, text: '规则' });
    y += 19 * k;
    const ruleRows = [];
    const ruleDefs = [
      { type: 'seg', key: 'round', label: '圈数', opts: this.roundOpts, sel: this.state.round },
      { type: 'seg', key: 'base', label: '底分', opts: this.baseOpts, sel: this.state.base },
      { type: 'seg', key: 'draw', label: '流局方式', opts: this.drawOpts, sel: this.state.draw },
      { type: 'switch', id: 'sw:wind', label: '去风牌', sub: '去除东南西北中发白 · 136→108 张', on: this.state.wind },
    ];
    const cardX = contentX;
    const cardW = contentW;
    let ry = y;
    ruleDefs.forEach((def, i) => {
      const cy = ry + rowH / 2;
      if (def.type === 'seg') {
        const seg = this.layoutSeg(ctx, def.opts, def.sel, cardX + cardW - cardPad, cy, `seg:${def.key}`);
        seg.parts.forEach((p) => items.push(p));
        ruleRows.push({ type: 'seg', label: def.label, seg, last: i === ruleDefs.length - 1, y: ry });
      } else {
        items.push({ id: def.id, x: cardX + cardW - cardPad - 36 * k, y: cy - 10 * k, w: 36 * k, h: 20 * k });
        ruleRows.push({ type: 'switch', id: def.id, label: def.label, sub: def.sub, on: def.on, last: i === ruleDefs.length - 1, y: ry });
      }
      ry += rowH;
    });
    blocks.push({ type: 'card', y, h: ry - y });
    blocks.push({ type: 'segRows', y, rows: ruleRows, cardX, cardW, cardPad, rowH });
    y = ry + 15 * k;

    // ===== 选项 =====
    blocks.push({ type: 'label', y, text: '选项' });
    y += 19 * k;
    const optRows = [];
    const optDefs = [{ id: 'pwd', label: '房间密码', type: 'pwd' }];
    ry = y;
    optDefs.forEach((def, i) => {
      const cy = ry + rowH / 2;
      if (def.type === 'switch') {
        items.push({ id: def.id, x: cardX + cardW - cardPad - 36 * k, y: cy - 10 * k, w: 36 * k, h: 20 * k });
      } else {
        items.push({ id: def.id, x: cardX, y: ry, w: cardW, h: rowH });
      }
      optRows.push({ ...def, y: ry, last: i === optDefs.length - 1 });
      ry += rowH;
    });
    blocks.push({ type: 'card', y, h: ry - y });
    blocks.push({ type: 'optRows', y, rows: optRows, cardX, cardW, cardPad, rowH });
    y = ry + 15 * k;

    // ===== 席位 =====
    blocks.push({ type: 'label', y, text: '席位', span: '1 / 3' });
    y += 19 * k;
    const seatW = (contentW - 20 * k) / 3;
    const seatH = 70 * k;
    blocks.push({ type: 'seats', y, h: seatH, seatW });
    items.push({ id: 'seat:1', x: contentX + seatW + 10 * k, y, w: seatW, h: seatH });
    items.push({ id: 'seat:2', x: contentX + (seatW + 10 * k) * 2, y, w: seatW, h: seatH });
    y += seatH;

    const totalH = y + 10 * k;
    this.maxScroll = Math.max(0, totalH - viewH);
    this.layoutCache = {
      blocks,
      items,
      totalH,
      viewH,
      contentTop,
      contentX,
      contentW,
      footTop,
      footH,
    };
  }

  /* ---------- 渲染 ---------- */

  render(ctx) {
    if (!this.layoutCache) this.buildLayout(ctx);
    const { k } = this;
    const W = SCREEN_WIDTH;
    const L = this.layoutCache;

    this.drawBackground(ctx);

    // 内容区（裁剪 + 滚动）
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, L.contentTop, W, L.viewH);
    ctx.clip();
    ctx.translate(0, L.contentTop - this.scrollY);
    for (const b of L.blocks) {
      if (b.type === 'label') this.drawLabel(ctx, b);
      else if (b.type === 'modes') this.drawModes(ctx, b);
      else if (b.type === 'card') this.drawCard(ctx, b);
      else if (b.type === 'segRows') this.drawSegRows(ctx, b);
      else if (b.type === 'optRows') this.drawOptRows(ctx, b);
      else if (b.type === 'seats') this.drawSeats(ctx, b);
    }
    ctx.restore();

    this.drawFoot(ctx);
    this.drawScrollbar(ctx);
    this.drawNav(ctx);

    // 密码编辑弹层（最后绘制，覆盖全部内容）
    if (this.editing) this.drawPwdEditor(ctx);
  }

  /**
   * 房间密码编辑弹层：4 位密码 + Canvas 数字键盘
   */
  drawPwdEditor(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const H = SCREEN_HEIGHT;

    // 遮罩
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, W, H);

    // 面板
    const pw = 250 * k;
    const digitH = 50 * k;
    const keyH = 42 * k;
    const keyGap = 8 * k;
    const keysTopOff = 46 * k + digitH + 16 * k;
    const ph = keysTopOff + 4 * keyH + 3 * keyGap + 16 * k;
    const px = (W - pw) / 2;
    const py = Math.max(STATUS_BAR_HEIGHT + 10 * k, (H - ph) / 2 - 20 * k);
    this.pwdPanel = { x: px, y: py, w: pw, h: ph };

    const bg = ctx.createLinearGradient(px, py, px + pw, py + ph);
    bg.addColorStop(0, 'rgba(20,58,45,.98)');
    bg.addColorStop(1, 'rgba(7,28,21,.98)');
    roundRect(ctx, px, py, pw, ph, 18 * k);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 标题
    spacedText(ctx, '房间密码', px + pw / 2, py + 26 * k, {
      font: `600 ${Math.round(14 * k)}px ${SANS}`,
      fill: '#f1f7f3',
      spacing: 2.8 * k,
    });

    // 4 位密码格（可点击定位，光标格金色高亮）
    const digitW = 44 * k;
    const digitGap = 10 * k;
    const digitsX = px + (pw - (digitW * 4 + digitGap * 3)) / 2;
    const digitsY = py + 46 * k;
    this.pwdDigitItems = [];
    for (let i = 0; i < 4; i++) {
      const dx = digitsX + i * (digitW + digitGap);
      this.pwdDigitItems.push({ x: dx, y: digitsY, w: digitW, h: digitH });
      roundRect(ctx, dx, digitsY, digitW, digitH, 10 * k);
      ctx.fillStyle = this.pressedDigit === i ? 'rgba(232,195,122,.12)' : 'rgba(0,0,0,.3)';
      ctx.fill();
      if (i === this.pwdCursor) {
        ctx.strokeStyle = 'rgba(232,195,122,.85)';
        ctx.lineWidth = 1.5 * k;
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
        ctx.lineWidth = 1;
      }
      ctx.stroke();
      const ch = this.pwdBuf[i];
      if (ch) {
        ctx.font = `700 ${Math.round(22 * k)}px ${SERIF}`;
        ctx.fillStyle = GOLD;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch, dx + digitW / 2, digitsY + digitH / 2 + 1 * k);
      } else if (i === this.pwdCursor) {
        // 空格光标：底部金色短横线闪烁
        const blink = Math.sin(Date.now() / 300) > 0;
        if (blink) {
          ctx.fillStyle = 'rgba(232,195,122,.8)';
          ctx.fillRect(dx + digitW / 2 - 8 * k, digitsY + digitH - 10 * k, 16 * k, 2 * k);
        }
      }
    }

    // 数字键盘：1-9 / 清空 0 确定
    const pad = 14 * k;
    const keyW = (pw - pad * 2 - keyGap * 2) / 3;
    const keysTop = py + keysTopOff;
    const labels = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['清空', '0', 'ok'],
    ];
    this.pwdItems = [];
    labels.forEach((row, r) => {
      row.forEach((label, c) => {
        const kx = px + pad + c * (keyW + keyGap);
        const ky = keysTop + r * (keyH + keyGap);
        const isOk = label === 'ok';
        const isClear = label === '清空';
        const text = isOk ? '确定' : label;

        roundRect(ctx, kx, ky, keyW, keyH, 10 * k);
        if (isOk) {
          const g = ctx.createLinearGradient(0, ky, 0, ky + keyH);
          g.addColorStop(0, '#f2d79b');
          g.addColorStop(1, '#d3a859');
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle =
            this.pressedPad === label ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.07)';
        }
        ctx.fill();
        if (!isOk) {
          ctx.strokeStyle = isClear ? 'rgba(232,195,122,.35)' : 'rgba(255,255,255,.1)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (isOk) {
          ctx.font = `600 ${Math.round(13 * k)}px ${SANS}`;
          ctx.fillStyle = '#3a2a0c';
        } else if (isClear) {
          ctx.font = `500 ${Math.round(12 * k)}px ${SANS}`;
          ctx.fillStyle = '#e0b877';
        } else {
          ctx.font = `500 ${Math.round(17 * k)}px ${SANS}`;
          ctx.fillStyle = '#e6f0ea';
        }
        ctx.fillText(text, kx + keyW / 2, ky + keyH / 2 + 1 * k);

        this.pwdItems.push({ label, x: kx, y: ky, w: keyW, h: keyH });
      });
    });
  }

  // 创建页背景：顶部更亮的径向渐变
  drawBackground(ctx) {
    const W = SCREEN_WIDTH;
    const H = SCREEN_HEIGHT;
    const g = ctx.createRadialGradient(W / 2, -H * 0.08, 0, W / 2, -H * 0.08, H * 0.95);
    g.addColorStop(0, '#1b6a4f');
    g.addColorStop(0.4, '#0d3f31');
    g.addColorStop(0.8, '#061c15');
    g.addColorStop(1, '#04110d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  drawLabel(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    spacedText(ctx, b.text, L.contentX + 2 * k, b.y + 10 * k, {
      font: `500 ${Math.round(9.5 * k)}px ${SANS}`,
      fill: '#7fa89a',
      spacing: 2.3 * k,
      align: 'left',
    });
    if (b.span) {
      ctx.font = `500 ${Math.round(9.5 * k)}px ${SANS}`;
      ctx.fillStyle = GOLD;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(b.span, L.contentX + L.contentW - 2 * k, b.y + 10 * k);
    }
  }

  drawModes(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    const modes = [
      { id: 'classic', ico: '经', title: '三人经典', sub: '136 张 · 扣点结算', on: this.state.mode === 'classic' },
      { id: 'blood', ico: '血', title: '三人血战', sub: '血战到底 · 连胡不停', on: false },
    ];
    modes.forEach((m, i) => {
      const x = L.contentX + i * (b.modeW + 10 * k);
      const y = b.y;
      const pressed = this.pressed === m.id;

      if (m.on) {
        const g = ctx.createLinearGradient(x, y, x + b.modeW, y + b.h);
        g.addColorStop(0, 'rgba(232,195,122,.17)');
        g.addColorStop(1, 'rgba(232,195,122,.035)');
        roundRect(ctx, x, y, b.modeW, b.h, 14 * k);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(232,195,122,.55)';
        ctx.save();
        ctx.shadowColor = 'rgba(232,195,122,.9)';
        ctx.shadowBlur = 22 * k;
        ctx.shadowOffsetY = 10 * k;
        ctx.stroke();
        ctx.restore();
      } else {
        roundRect(ctx, x, y, b.modeW, b.h, 14 * k);
        ctx.fillStyle = 'rgba(255,255,255,.045)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.09)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (pressed) {
        roundRect(ctx, x, y, b.modeW, b.h, 14 * k);
        ctx.fillStyle = 'rgba(255,255,255,.06)';
        ctx.fill();
      }

      // 图标
      const ix = x + 11 * k;
      const iy = y + 11 * k;
      roundRect(ctx, ix, iy, 26 * k, 26 * k, 8 * k);
      if (m.on) {
        const ig = ctx.createLinearGradient(ix, iy, ix + 26 * k, iy + 26 * k);
        ig.addColorStop(0, '#f2d79b');
        ig.addColorStop(1, '#c99a4f');
        ctx.fillStyle = ig;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.08)';
      }
      ctx.fill();
      ctx.font = `700 ${Math.round(13 * k)}px ${SERIF}`;
      ctx.fillStyle = m.on ? '#3a2a0c' : '#cfe6dc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.ico, ix + 13 * k, iy + 14 * k);

      // 文案
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `600 ${Math.round(12.5 * k)}px ${SANS}`;
      ctx.fillStyle = '#f0f6f3';
      ctx.fillText(m.title, ix, iy + 26 * k + 19 * k);
      ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
      ctx.fillStyle = '#8fb0a3';
      ctx.fillText(m.sub, ix, iy + 26 * k + 33 * k);

      // 选中勾
      if (m.on) {
        const cx = x + b.modeW - 10 * k - 7.5 * k;
        const cy = y + 10 * k + 7.5 * k;
        ctx.beginPath();
        ctx.arc(cx, cy, 7.5 * k, 0, Math.PI * 2);
        const cg = ctx.createLinearGradient(cx - 7.5 * k, cy - 7.5 * k, cx + 7.5 * k, cy + 7.5 * k);
        cg.addColorStop(0, '#f6e0ac');
        cg.addColorStop(1, '#d3a859');
        ctx.fillStyle = cg;
        ctx.fill();
        ctx.strokeStyle = '#3a2a0c';
        ctx.lineWidth = 1.6 * k;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - 3 * k, cy + 0.5 * k);
        ctx.lineTo(cx - 1 * k, cy + 2.5 * k);
        ctx.lineTo(cx + 3 * k, cy - 2 * k);
        ctx.stroke();
      }
    });
  }

  drawCard(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    roundRect(ctx, L.contentX, b.y, L.contentW, b.h, 16 * k);
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.09)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawSegRows(ctx, b) {
    const { k } = this;
    b.rows.forEach((row) => {
      const cy = row.y + b.rowH / 2;

      if (!row.last) {
        ctx.strokeStyle = 'rgba(255,255,255,.055)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(b.cardX + b.cardPad, row.y + b.rowH);
        ctx.lineTo(b.cardX + b.cardW - b.cardPad, row.y + b.rowH);
        ctx.stroke();
      }

      // 键名
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(12 * k)}px ${SANS}`;
      ctx.fillStyle = '#d5e5dd';
      ctx.fillText(row.label, b.cardX + b.cardPad, cy);

      // 开关行（如去风牌）
      if (row.type === 'switch') {
        if (row.sub) {
          ctx.font = `500 ${Math.round(12 * k)}px ${SANS}`;
          const kw = ctx.measureText(row.label).width;
          ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
          ctx.fillStyle = '#7fa094';
          ctx.fillText(row.sub, b.cardX + b.cardPad + kw + 6 * k, cy + 1 * k);
        }
        this.drawSwitch(
          ctx,
          b.cardX + b.cardW - b.cardPad - 36 * k,
          cy - 10 * k,
          36 * k,
          20 * k,
          row.on
        );
        return;
      }

      // 分段选择器
      const seg = row.seg;
      roundRect(ctx, seg.bgX, cy - 15 * k, seg.bgW, 30 * k, 9 * k);
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.fill();
      seg.parts.forEach((p) => {
        if (p.on) {
          roundRect(ctx, p.x, p.y, p.w, p.h, 7 * k);
          const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
          g.addColorStop(0, '#f2d79b');
          g.addColorStop(1, '#d3a859');
          ctx.fillStyle = g;
          ctx.fill();
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,.6)';
          ctx.shadowBlur = 6 * k;
          ctx.shadowOffsetY = 2 * k;
          ctx.stroke();
          ctx.restore();
        }
        ctx.font = `${p.on ? '600' : '500'} ${Math.round(10.5 * k)}px ${SANS}`;
        ctx.fillStyle = p.on ? '#3a2a0c' : '#9db8ac';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, p.x + p.w / 2, p.y + p.h / 2 + 0.5);
      });
    });
  }

  drawOptRows(ctx, b) {
    const { k } = this;
    b.rows.forEach((row) => {
      const cy = row.y + b.rowH / 2;

      if (!row.last) {
        ctx.strokeStyle = 'rgba(255,255,255,.055)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(b.cardX + b.cardPad, row.y + b.rowH);
        ctx.lineTo(b.cardX + b.cardW - b.cardPad, row.y + b.rowH);
        ctx.stroke();
      }

      // 键名（+说明）
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(12 * k)}px ${SANS}`;
      ctx.fillStyle = '#d5e5dd';
      ctx.fillText(row.label, b.cardX + b.cardPad, cy);
      if (row.sub) {
        ctx.font = `500 ${Math.round(12 * k)}px ${SANS}`;
        const kw = ctx.measureText(row.label).width;
        ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
        ctx.fillStyle = '#7fa094';
        ctx.fillText(row.sub, b.cardX + b.cardPad + kw + 6 * k, cy + 1 * k);
      }

      const rightX = b.cardX + b.cardW - b.cardPad;
      if (row.type === 'switch') {
        this.drawSwitch(ctx, rightX - 36 * k, cy - 10 * k, 36 * k, 20 * k, row.on);
      } else if (row.type === 'pwd') {
        ctx.textAlign = 'right';
        ctx.font = `${Math.round(13 * k)}px ${SANS}`;
        ctx.fillStyle = '#8fb0a3';
        ctx.fillText('›', rightX, cy + 1 * k);
        spacedText(ctx, this.pwd, rightX - 14 * k, cy + 0.5 * k, {
          font: `${Math.round(11.5 * k)}px ${SANS}`,
          fill: '#edd9ac',
          spacing: 3.9 * k,
          align: 'right',
          baseline: 'middle',
        });
      }
    });
  }

  drawSwitch(ctx, x, y, w, h, on) {
    const { k } = this;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = on ? 'rgba(194,149,63,.9)' : 'rgba(255,255,255,.14)';
    if (on) {
      const g = ctx.createLinearGradient(x, y, x + w, y);
      g.addColorStop(0, '#c2953f');
      g.addColorStop(1, '#f0d49b');
      ctx.fillStyle = g;
    }
    ctx.fill();

    const knobR = h / 2 - 2 * k;
    const knobX = on ? x + w - h / 2 : x + h / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 3 * k;
    ctx.shadowOffsetY = 1 * k;
    ctx.beginPath();
    ctx.arc(knobX, y + h / 2, knobR, 0, Math.PI * 2);
    ctx.fillStyle = on ? '#ffffff' : '#dbe6e0';
    ctx.fill();
    ctx.restore();
  }

  drawSeats(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;

    // 房主席位
    const hx = L.contentX;
    roundRect(ctx, hx, b.y, b.seatW, b.h, 14 * k);
    const hg = ctx.createLinearGradient(hx, b.y, hx + b.seatW, b.y + b.h);
    hg.addColorStop(0, 'rgba(232,195,122,.14)');
    hg.addColorStop(1, 'rgba(232,195,122,.02)');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    drawAvatar(ctx, hx + b.seatW / 2, b.y + 24 * k, 16 * k, '我', ['#4aa88a', '#1b5c47'], {
      isMe: true,
    });
    ctx.font = `500 ${Math.round(10 * k)}px ${SANS}`;
    ctx.fillStyle = '#a9c4b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('房主', hx + b.seatW / 2, b.y + 56 * k);

    // 空席位
    for (let i = 1; i <= 2; i++) {
      const x = L.contentX + i * (b.seatW + 10 * k);
      const pressed = this.pressed === `seat:${i}`;
      roundRect(ctx, x, b.y, b.seatW, b.h, 14 * k);
      ctx.fillStyle = pressed ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.045)';
      ctx.fill();
      ctx.save();
      ctx.setLineDash([5 * k, 4 * k]);
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      ctx.font = `500 ${Math.round(15 * k)}px ${SANS}`;
      ctx.fillStyle = '#5f8578';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('＋', x + b.seatW / 2, b.y + 36 * k);
      ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
      ctx.fillStyle = '#7fa094';
      ctx.fillText('邀请好友', x + b.seatW / 2, b.y + 54 * k);
    }
  }

  // 底部固定：创建按钮 + 说明
  drawFoot(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const L = this.layoutCache;
    const btnX = 16 * k;
    const btnW = W - 32 * k;
    const btnY = L.footTop;
    const btnH = 52 * k;

    // 主按钮（含流光）
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
    if (this.pressed === 'create') {
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
    ctx.fillText('创建房间', W / 2, btnY + btnH / 2 + 1 * k);
    this.createBtn = { x: btnX, y: btnY, w: btnW, h: btnH };

    // 说明
    ctx.font = `${Math.round(9.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#71958a';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('创建后生成 6 位房号，好友凭房号加入', W / 2, btnY + btnH + 19 * k);
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
    if (this.pressed === 'back') ctx.globalAlpha = 0.6;
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

    // 帮助按钮（跳转玩法规则）
    const hx = W - 16 * k - 30 * k;
    ctx.save();
    if (this.pressed === 'help') ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(hx + 15 * k, cy, 15 * k, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `600 ${Math.round(12 * k)}px ${SERIF}`;
    ctx.fillStyle = '#cfe0d7';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', hx + 15 * k, cy + 1 * k);
    ctx.restore();
    this.helpBtn = { x: hx, y: cy - 15 * k, w: 30 * k, h: 30 * k };

    // 标题
    spacedText(ctx, '创建房间', W / 2, cy + 5 * k, {
      font: `600 ${Math.round(14 * k)}px ${SANS}`,
      fill: '#f1f7f3',
      spacing: 2.8 * k,
    });
  }
}
