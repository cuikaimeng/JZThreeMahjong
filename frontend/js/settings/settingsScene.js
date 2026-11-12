import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  STATUS_BAR_HEIGHT,
  SAFE_BOTTOM,
} from '../render.js';
import { roundRect, spacedText } from '../ui/draw.js';

const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const GOLD = '#e8c37a';
const NAV_H = 50;

const STORAGE_KEYS = { music: 'set_music', sound: 'set_sound', vib: 'set_vib' };

/**
 * 设置页面：音效开关 / 内容链接 / 账号操作 / 关于
 */
export default class SettingsScene {
  constructor() {
    this.k = SCREEN_WIDTH / 380;
    this.scrollY = 0;
    this.maxScroll = 0;
    this.layoutCache = null;
    this.backBtn = null;
    this.pressed = false;
    this.pressedRow = null; // 按下的行 id
    this.dragging = false;
    this.moved = false;
    this.onBack = null; // 返回回调
    this.onNavigate = null; // 页面跳转回调（玩法规则）

    // 开关状态（本地持久化，默认全开）
    this.toggles = {
      music: this.readToggle(STORAGE_KEYS.music),
      sound: this.readToggle(STORAGE_KEYS.sound),
      vib: this.readToggle(STORAGE_KEYS.vib),
    };

    // 版本号：优先取线上版本，开发/预览环境回退
    this.version = 'v1.0.0';
    try {
      const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
      const v = info && info.miniProgram && info.miniProgram.version;
      if (v) this.version = `v${v}`;
    } catch (e) { /* ignore */ }

    this.sections = [
      {
        label: '音效',
        rows: [
          { id: 'toggle:music', key: '音乐' },
          { id: 'toggle:sound', key: '音效' },
          { id: 'toggle:vib', key: '震动' },
        ],
      },
      {
        label: '内容',
        rows: [
          { id: 'rules', key: '玩法规则' },
          { id: 'agreement', key: '用户协议' },
          { id: 'privacy', key: '隐私政策' },
        ],
      },
      {
        label: '账号',
        rows: [
          { id: 'realname', key: '实名认证' },
          { id: 'cancel', key: '账号注销' },
          { id: 'cache', key: '清除缓存' },
        ],
      },
      {
        label: '关于',
        rows: [
          { id: 'version', key: '版本号', value: this.version },
          { id: 'feedback', key: '意见反馈' },
        ],
      },
    ];
  }

  readToggle(key) {
    try {
      const v = wx.getStorageSync(key);
      return v === '' || v === undefined ? true : !!v;
    } catch (e) {
      return true;
    }
  }

  saveToggle(key, value) {
    try {
      wx.setStorageSync(key, value);
    } catch (e) { /* ignore */ }
  }

  /* ---------- 触摸 ---------- */

  inRect(x, y, r) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // 命中某一行，返回行 id
  hitRow(x, y) {
    const L = this.layoutCache;
    if (!L) return null;
    for (const b of L.blocks) {
      if (b.type !== 'row' || !b.clickable) continue;
      const sy = L.contentTop - this.scrollY + b.rowY;
      if (x >= L.contentX && x <= L.contentX + L.contentW && y >= sy && y <= sy + b.rowH) {
        return b.id;
      }
    }
    return null;
  }

  onTouchStart(x, y) {
    this.pressed = this.inRect(x, y, this.backBtn);
    this.pressedRow = this.hitRow(x, y);
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
      this.pressedRow = null;
    }
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.startScroll - dy));
  }

  onTouchEnd(x, y) {
    const pressed = this.pressed;
    const pressedRow = this.pressedRow;
    this.pressed = false;
    this.pressedRow = null;
    this.dragging = false;
    if (!this.moved && pressed && this.inRect(x, y, this.backBtn)) {
      if (this.onBack) this.onBack();
      return;
    }
    if (!this.moved && pressedRow && this.hitRow(x, y) === pressedRow) {
      this.handleRow(pressedRow);
    }
  }

  /* ---------- 行为 ---------- */

  vibrate() {
    if (this.toggles.vib && typeof wx.vibrateShort === 'function') {
      wx.vibrateShort({ type: 'light' });
    }
  }

  handleRow(id) {
    if (id.startsWith('toggle:')) {
      const key = id.slice(7);
      this.toggles[key] = !this.toggles[key];
      this.saveToggle(STORAGE_KEYS[key], this.toggles[key]);
      this.vibrate();
      return;
    }
    switch (id) {
      case 'rules':
        if (this.onNavigate) this.onNavigate('rules');
        break;
      case 'cache': {
        try {
          const saved = { ...this.toggles };
          wx.clearStorageSync();
          wx.setStorageSync(STORAGE_KEYS.music, saved.music);
          wx.setStorageSync(STORAGE_KEYS.sound, saved.sound);
          wx.setStorageSync(STORAGE_KEYS.vib, saved.vib);
          wx.showToast({ title: '缓存已清除', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: '清除失败', icon: 'none' });
        }
        break;
      }
      case 'version':
        break;
      default:
        wx.showToast({ title: '敬请期待', icon: 'none' });
    }
  }

  /* ---------- 布局 ---------- */

  buildLayout(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const navH = NAV_H * k;
    const contentTop = STATUS_BAR_HEIGHT + navH + 16 * k;
    const contentBottom = SCREEN_HEIGHT - SAFE_BOTTOM - 16 * k;
    const viewH = contentBottom - contentTop;
    const contentX = 22 * k;
    const contentW = W - contentX * 2;

    const blocks = [];
    let y = 0;

    for (const sec of this.sections) {
      // 分组标签
      blocks.push({ type: 'label', y, h: 16 * k, text: sec.label });
      y += 16 * k + 8 * k;

      // 分组卡片与行
      const cardY = y;
      const rowH = 46 * k;
      let ry = cardY;
      sec.rows.forEach((row, idx) => {
        blocks.push({
          type: 'row',
          y: ry,
          h: rowH,
          rowY: ry,
          rowH,
          id: row.id,
          key: row.key,
          value: row.value,
          isToggle: row.id.startsWith('toggle:'),
          clickable: row.id !== 'version',
          last: idx === sec.rows.length - 1,
        });
        ry += rowH;
      });
      const cardH = ry - cardY;
      blocks.push({ type: 'card', y: cardY, h: cardH });
      y = cardY + cardH + 18 * k;
    }

    // 底部说明
    blocks.push({ type: 'foot', y, h: 14 * k });
    y += 14 * k;

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
      if (b.type === 'label') this.drawLabel(ctx, b);
      else if (b.type === 'card') this.drawCard(ctx, b);
      else if (b.type === 'row') this.drawRow(ctx, b);
      else if (b.type === 'foot') this.drawFoot(ctx, b);
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
  }

  drawLabel(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    ctx.font = `500 ${Math.round(10 * k)}px ${SANS}`;
    ctx.fillStyle = '#8fae9f';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(b.text, L.contentX + 4 * k, b.y + 12 * k);
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

  drawRow(ctx, b) {
    const { k } = this;
    const L = this.layoutCache;
    const cy = b.rowY + b.rowH / 2;

    // 按下高亮
    if (this.pressedRow === b.id && b.clickable) {
      roundRect(ctx, L.contentX + 4 * k, b.rowY + 2 * k, L.contentW - 8 * k, b.rowH - 4 * k, 10 * k);
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      ctx.fill();
    }

    // 行分隔线
    if (!b.last) {
      ctx.strokeStyle = 'rgba(255,255,255,.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L.contentX + 14 * k, b.rowY + b.rowH);
      ctx.lineTo(L.contentX + L.contentW - 14 * k, b.rowY + b.rowH);
      ctx.stroke();
    }

    // 键名
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(12.5 * k)}px ${SANS}`;
    ctx.fillStyle = '#cfe0d9';
    ctx.fillText(b.key, L.contentX + 14 * k, cy);

    const rightX = L.contentX + L.contentW - 14 * k;

    if (b.isToggle) {
      this.drawSwitch(ctx, rightX - 40 * k, cy - 11 * k, 40 * k, 22 * k, this.toggles[b.id.slice(7)]);
    } else if (b.value) {
      ctx.textAlign = 'right';
      ctx.font = `${Math.round(11.5 * k)}px ${SANS}`;
      ctx.fillStyle = '#8fae9f';
      ctx.fillText(b.value, rightX, cy);
    } else if (b.id === 'cache' || b.id === 'feedback' || b.id === 'realname' || b.id === 'cancel') {
      ctx.textAlign = 'right';
      ctx.font = `${Math.round(11.5 * k)}px ${SANS}`;
      ctx.fillStyle = 'rgba(143,174,159,.6)';
      ctx.fillText('›', rightX, cy + 1 * k);
    } else {
      ctx.textAlign = 'right';
      ctx.font = `${Math.round(11.5 * k)}px ${SANS}`;
      ctx.fillStyle = 'rgba(143,174,159,.6)';
      ctx.fillText('›', rightX, cy + 1 * k);
    }
  }

  /**
   * 开关：金绿渐变开启态 / 深色关闭态
   */
  drawSwitch(ctx, x, y, w, h, on) {
    const { k } = this;
    roundRect(ctx, x, y, w, h, h / 2);
    if (on) {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#55c79a');
      g.addColorStop(1, '#2f8a6b');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
    }
    ctx.fill();
    ctx.strokeStyle = on ? 'rgba(85,199,154,.5)' : 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 圆钮
    const knobR = h / 2 - 2.5 * k;
    const knobX = on ? x + w - h / 2 : x + h / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.4)';
    ctx.shadowBlur = 4 * k;
    ctx.shadowOffsetY = 1.5 * k;
    ctx.beginPath();
    ctx.arc(knobX, y + h / 2, knobR, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f8f5';
    ctx.fill();
    ctx.restore();
  }

  drawFoot(ctx, b) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    ctx.font = `${Math.round(9 * k)}px ${SANS}`;
    ctx.fillStyle = 'rgba(232,195,122,.4)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('三人扣点麻将 · 仅供娱乐', W / 2, b.y + 10 * k);
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
    spacedText(ctx, '设置', W / 2, cy + 5 * k, {
      font: `600 ${Math.round(14 * k)}px ${SANS}`,
      fill: '#f1f7f3',
      spacing: 2.8 * k,
    });
  }
}
