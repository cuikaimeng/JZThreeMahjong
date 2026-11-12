import { SCREEN_WIDTH, SCREEN_HEIGHT, STATUS_BAR_HEIGHT } from '../render.js';
import { roundRect, spacedText } from '../ui/draw.js';

const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const SERIF = '"Songti SC","STSong","Noto Serif SC",serif';
const GOLD = '#e8c37a';

/**
 * 加入房间页：居中弹窗（与创建页"房间密码"弹层同风格）
 * 输入 6 位房间号 + 4 位房间密码，Canvas 数字键盘输入
 */
export default class JoinScene {
  constructor() {
    this.k = SCREEN_WIDTH / 380;
    this.onBack = null;
    this.onJoin = null;

    this.code = ['', '', '', '', '', '']; // 6 位房号
    this.pwd = ['', '', '', '']; // 4 位密码
    this.row = 0; // 当前输入行：0 房号 / 1 密码
    this.cursor = 0; // 行内光标格
    this.pressedPad = null;
    this.pressedDigit = -1; // 按下的格索引（高亮）
    this.padItems = [];
    this.digitItems = []; // { row, idx, x, y, w, h }
    this.backRect = null;
    this.pressed = null;
    this.errRow = -1; // 校验错误行：0 房号 / 1 密码（标红提示）
  }

  /* ---------- 触摸 ---------- */

  hitDigit(x, y) {
    return this.digitItems.findIndex(
      (it) => x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h
    );
  }

  hitPad(x, y) {
    const item = this.padItems.find(
      (it) => x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h
    );
    return item ? item.label : null;
  }

  onTouchStart(x, y) {
    this.pressed = null;
    this.pressedDigit = -1;
    this.pressedPad = null;
    if (this.backRect && this.inRect(x, y, this.backRect)) {
      this.pressed = 'back';
      return;
    }
    const d = this.hitDigit(x, y);
    if (d >= 0) {
      this.pressedDigit = d;
      return;
    }
    this.pressedPad = this.hitPad(x, y);
  }

  onTouchMove() {}

  onTouchEnd(x, y) {
    const pressedPad = this.pressedPad;
    const pressedDigit = this.pressedDigit;
    const pressed = this.pressed;
    this.pressed = null;
    this.pressedPad = null;
    this.pressedDigit = -1;

    if (pressed === 'back') {
      if (this.backRect && this.inRect(x, y, this.backRect) && this.onBack) this.onBack();
      return;
    }
    if (pressedDigit >= 0 && this.hitDigit(x, y) === pressedDigit) {
      const it = this.digitItems[pressedDigit];
      this.row = it.row;
      this.cursor = it.idx; // 点击输入格定位光标
      return;
    }
    if (pressedPad && this.hitPad(x, y) === pressedPad) this.padPress(pressedPad);
  }

  inRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /* ---------- 键盘输入 ---------- */

  get buffer() {
    return this.row === 0 ? this.code : this.pwd;
  }

  padPress(label) {
    if (label === 'ok') {
      this.confirm();
      return;
    }
    if (label === '清空') {
      this.buffer.fill('');
      this.cursor = 0;
      return;
    }
    // 数字：写入当前光标格并右移；房号填满自动切到密码行
    this.errRow = -1; // 输入即清除错误提示
    const buf = this.buffer;
    if (this.cursor >= buf.length) {
      if (this.row === 0) {
        this.row = 1;
        this.cursor = 0;
      }
      return;
    }
    buf[this.cursor] = label;
    this.cursor += 1;
    if (this.cursor >= buf.length && this.row === 0) {
      this.row = 1;
      this.cursor = 0;
    }
  }

  confirm() {
    const code = this.code.join('');
    const pwd = this.pwd.join('');
    if (code.length < 6) {
      // 房间号必输：标红提示并定位光标到首个空格
      this.errRow = 0;
      this.row = 0;
      this.cursor = Math.min(code.length, 5);
      wx.showToast({ title: '请输入 6 位房间号', icon: 'none' });
      return;
    }
    if (pwd.length < 4) {
      this.errRow = 1;
      this.row = 1;
      this.cursor = Math.min(pwd.length, 3);
      wx.showToast({ title: '请输入 4 位房间密码', icon: 'none' });
      return;
    }
    this.errRow = -1;
    if (this.onJoin) this.onJoin({ code, pwd });
  }

  /* ---------- 绘制 ---------- */

  render(ctx) {
    this.drawBackground(ctx);
    this.drawTopBar(ctx);
    this.drawPanel(ctx);
  }

  // 页面背景：与创建页一致的径向渐变
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

  drawTopBar(ctx) {
    const { k } = this;
    const cy = STATUS_BAR_HEIGHT + 22 * k;
    this.backRect = { x: 14 * k, y: cy - 16 * k, w: 32 * k, h: 32 * k };
    roundRect(ctx, this.backRect.x, this.backRect.y, 32 * k, 32 * k, 16 * k);
    ctx.fillStyle = this.pressed === 'back' ? 'rgba(232,195,122,.18)' : 'rgba(255,255,255,.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,195,122,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `600 ${Math.round(16 * k)}px ${SANS}`;
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('‹', 30 * k, cy + 1 * k);

    spacedText(ctx, '加入房间', SCREEN_WIDTH / 2, cy + 2 * k, {
      font: `600 ${Math.round(15 * k)}px ${SANS}`,
      fill: '#f1f7f3',
      spacing: 2.5 * k,
      baseline: 'middle',
    });
  }

  drawPanel(ctx) {
    const { k } = this;
    const W = SCREEN_WIDTH;
    const H = SCREEN_HEIGHT;

    // 弹窗面板（与密码弹层同风格，纵向加长容纳两行输入）
    const pw = 264 * k;
    const keyH = 42 * k;
    const keyGap = 8 * k;
    const keysTopOff = 202 * k; // 密码格底(py+190k)之下，留 12k 间距
    const ph = keysTopOff + 4 * keyH + 3 * keyGap + 16 * k;
    const px = (W - pw) / 2;
    const py = Math.max(STATUS_BAR_HEIGHT + 56 * k, (H - ph) / 2 - 10 * k);

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
    spacedText(ctx, '加入房间', px + pw / 2, py + 26 * k, {
      font: `600 ${Math.round(14 * k)}px ${SANS}`,
      fill: '#f1f7f3',
      spacing: 2.8 * k,
    });
    ctx.font = `${Math.round(9 * k)}px ${SANS}`;
    ctx.fillStyle = '#8fb0a3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('输入房号与密码 · 加入好友对局', px + pw / 2, py + 44 * k);

    this.digitItems = [];

    // 房号：标签 + 6 格
    this.drawRowLabel(
      ctx,
      this.errRow === 0 ? '请输入 6 位房间号' : '房间号',
      px + 18 * k,
      py + 62 * k,
      this.errRow === 0
    );
    this.drawDigits(ctx, {
      row: 0,
      buf: this.code,
      x: px + 14 * k,
      y: py + 70 * k,
      w: (pw - 28 * k - 5 * 8 * k) / 6,
      h: 44 * k,
      gap: 8 * k,
      err: this.errRow === 0,
    });

    // 密码：标签 + 4 格
    this.drawRowLabel(
      ctx,
      this.errRow === 1 ? '请输入 4 位房间密码' : '房间密码',
      px + 18 * k,
      py + 132 * k,
      this.errRow === 1
    );
    const digitW2 = 44 * k;
    this.drawDigits(ctx, {
      row: 1,
      buf: this.pwd,
      x: px + (pw - (digitW2 * 4 + 10 * k * 3)) / 2,
      y: py + 140 * k,
      w: digitW2,
      h: 50 * k,
      gap: 10 * k,
      err: this.errRow === 1,
    });

    // 数字键盘：1-9 / 清空 0 确定（与密码弹层一致）
    const pad = 14 * k;
    const keyW = (pw - pad * 2 - keyGap * 2) / 3;
    const keysTop = py + keysTopOff;
    const labels = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['清空', '0', 'ok'],
    ];
    this.padItems = [];
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

        this.padItems.push({ label, x: kx, y: ky, w: keyW, h: keyH });
      });
    });
  }

  drawRowLabel(ctx, text, x, y, err = false) {
    const { k } = this;
    ctx.font = `500 ${Math.round(9.5 * k)}px ${SANS}`;
    ctx.fillStyle = err ? '#ff9d9d' : '#7fa89a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y);
  }

  /** 绘制一行输入格（房号 / 密码），光标格金色高亮 + 闪烁下划线；err 时红色描边 */
  drawDigits(ctx, opt) {
    const { k } = this;
    const { row, buf, x, y, w, h, gap, err = false } = opt;
    for (let i = 0; i < buf.length; i++) {
      const dx = x + i * (w + gap);
      const idx = this.digitItems.length;
      this.digitItems.push({ row, idx: i, x: dx, y, w, h });
      const isActive = this.row === row && this.cursor === i;
      const isPressed = this.pressedDigit === idx;

      roundRect(ctx, dx, y, w, h, 10 * k);
      ctx.fillStyle = isPressed ? 'rgba(232,195,122,.12)' : 'rgba(0,0,0,.3)';
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = err ? 'rgba(255,157,157,.9)' : 'rgba(232,195,122,.85)';
        ctx.lineWidth = 1.5 * k;
      } else {
        ctx.strokeStyle = err ? 'rgba(255,120,120,.45)' : 'rgba(255,255,255,.12)';
        ctx.lineWidth = 1;
      }
      ctx.stroke();

      const ch = buf[i];
      if (ch) {
        ctx.font = `700 ${Math.round(h * 0.44)}px ${SERIF}`;
        ctx.fillStyle = GOLD;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch, dx + w / 2, y + h / 2 + 1 * k);
      } else if (isActive) {
        const blink = Math.sin(Date.now() / 300) > 0;
        if (blink) {
          ctx.fillStyle = 'rgba(232,195,122,.8)';
          ctx.fillRect(dx + w / 2 - 8 * k, y + h - 10 * k, 16 * k, 2 * k);
        }
      }
    }
  }
}
