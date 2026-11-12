import { WS_URL } from './config.js';
import { getToken, setUser } from './api.js';

/**
 * 联机客户端：连接 → 鉴权 → 收发事件
 *
 * 事件（S→C）与后端 ws/index.js 协议一致：
 *   authOk / error / roomState / gameStart / dice / dealer / dealStep / deal /
 *   turn / draw / discard / offer / action / settle / roundEnd / matchOver / gameResume
 */
class Net {
  constructor() {
    this.task = null;
    this.ready = false; // 已鉴权
    this.connecting = null;
    this.handlers = new Map(); // t → [fn]
    this.queue = []; // 未连接时的待发消息
    this.roomCode = null;
    this.manualClose = false;
    this.retry = 0;
  }

  /** 注册事件监听 */
  on(t, fn) {
    if (!this.handlers.has(t)) this.handlers.set(t, []);
    this.handlers.get(t).push(fn);
    return this;
  }

  dispatch(t, data) {
    const list = this.handlers.get(t);
    if (!list) return;
    for (const fn of list) {
      try {
        fn(data || {});
      } catch (e) {
        console.error('[net] handler error', t, e);
      }
    }
  }

  /** 建立连接并完成鉴权 */
  connect() {
    if (this.ready) return Promise.resolve();
    if (this.connecting) return this.connecting;

    this.connecting = new Promise((resolve, reject) => {
      const task = wx.connectSocket({ url: WS_URL });
      this.task = task;
      let settled = false;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        this.connecting = null;
        fn(arg);
      };

      task.onOpen(() => {
        task.send({
          data: JSON.stringify({ t: 'auth', data: { token: getToken() } }),
        });
      });

      task.onMessage((res) => {
        let msg;
        try {
          msg = JSON.parse(res.data);
        } catch (e) {
          return;
        }
        const { t, data } = msg;
        if (t === 'authOk') {
          this.ready = true;
          this.retry = 0;
          if (data && data.user) setUser(data.user);
          done(resolve);
          this.dispatch('open', data);
          this.flush();
          return;
        }
        if (t === 'kicked') {
          this.ready = false;
          wx.showToast({ title: (data && data.reason) || '已在其他设备登录', icon: 'none' });
        }
        if (t === 'error' && data && data.message) {
          wx.showToast({ title: data.message, icon: 'none' });
        }
        this.dispatch(t, data);
      });

      task.onClose(() => {
        const wasReady = this.ready;
        this.ready = false;
        this.task = null;
        this.dispatch('close', {});
        if (wasReady && !this.manualClose) this.scheduleReconnect();
      });

      task.onError(() => {
        this.ready = false;
        this.task = null;
        done(reject, new Error('无法连接服务器，请确认后端已启动'));
      });

      setTimeout(() => {
        if (!this.ready) done(reject, new Error('连接服务器超时'));
      }, 8000);
    });
    return this.connecting;
  }

  scheduleReconnect() {
    if (this.manualClose) return;
    this.retry = Math.min(this.retry + 1, 5);
    const delay = 1000 * this.retry;
    setTimeout(() => {
      this.connect()
        .then(() => {
          if (this.roomCode) this.send('rejoin', { code: this.roomCode });
        })
        .catch(() => this.scheduleReconnect());
    }, delay);
  }

  flush() {
    const q = this.queue;
    this.queue = [];
    for (const [t, d] of q) this.send(t, d);
  }

  /** 发送消息（未连接时排队） */
  send(t, data) {
    if (!this.ready || !this.task) {
      this.queue.push([t, data || {}]);
      return this.connect().catch(() => {});
    }
    this.task.send({ data: JSON.stringify({ t, data: data || {} }) });
    return Promise.resolve();
  }

  /** 进入房间（REST 之后调用，完成 WS 座位绑定） */
  join(code) {
    this.roomCode = String(code);
    return this.send('join', { code: this.roomCode });
  }

  leave() {
    this.send('leave', {});
    this.roomCode = null;
  }

  close() {
    this.manualClose = true;
    if (this.task) {
      try {
        this.task.close({});
      } catch (e) {
        /* ignore */
      }
    }
    this.ready = false;
    this.task = null;
  }
}

export const net = new Net();
