import { API_BASE } from './config.js';

const TOKEN_KEY = 'mj_token';
const USER_KEY = 'mj_user';

/* ---------- 会话（token / 用户） ---------- */

export function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function setToken(token) {
  try {
    wx.setStorageSync(TOKEN_KEY, token || '');
  } catch (e) {
    /* ignore */
  }
}

export function getUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null;
  } catch (e) {
    return null;
  }
}

export function setUser(user) {
  try {
    wx.setStorageSync(USER_KEY, user || null);
  } catch (e) {
    /* ignore */
  }
}

export function clearSession() {
  setToken('');
  setUser(null);
}

/* ---------- 请求封装 ---------- */

export function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) header.Authorization = `Bearer ${token}`;
    wx.request({
      url: API_BASE + path,
      method,
      data,
      header,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data);
        if (res.statusCode === 401) clearSession();
        reject(new Error((res.data && res.data.error) || `请求失败(${res.statusCode})`));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '网络异常，请检查后端是否启动')),
    });
  });
}

export const get = (path) => request('GET', path);
export const post = (path, data) => request('POST', path, data || {});

/* ---------- 业务接口 ---------- */

/** wx.login 临时凭证：真机由后端 code2session 换 openid，未配置 appid 时走游客 */
function wxLoginCode() {
  return new Promise((resolve) => {
    if (typeof wx.login !== 'function') return resolve('');
    try {
      wx.login({ success: (r) => resolve((r && r.code) || ''), fail: () => resolve('') });
    } catch (e) {
      resolve('');
    }
  });
}

/** 登录（微信 code + 头像昵称；无微信资料时为游客） */
export async function login(nickname, extra = {}) {
  const code = extra.code || (await wxLoginCode());
  const r = await post('/api/auth/login', {
    nickname,
    code: code || undefined,
    avatarUrl: extra.avatarUrl || undefined,
  });
  setToken(r.token);
  setUser(r.user);
  return r.user;
}

/** 静默登录：已有 token 则校验，失效则重新登录 */
export async function ensureLogin(nickname, extra = {}) {
  if (getToken()) {
    try {
      const r = await get('/api/users/me');
      setUser(r.user);
      return r.user;
    } catch (e) {
      // token 失效 → 重新登录
    }
  }
  return login(nickname, extra);
}

/** 更新玩家资料（微信授权后） */
export const updateProfile = (body) => request('PUT', '/api/users/me', body);

export const createRoom = (body) => post('/api/rooms', body);
export const joinRoom = (code, password) => post('/api/rooms/join', { code, password });
export const getRoom = (code) => get(`/api/rooms/${code}`);
/** 战绩汇总 + 列表（分页） */
export const getHistory = ({ limit = 20, offset = 0 } = {}) =>
  get(`/api/history?limit=${limit}&offset=${offset}`);

/** 单局详情（三家牌谱 + 点数明细） */
export const getHistoryDetail = (id) => get(`/api/history/${encodeURIComponent(id)}`);

/** 审计日志（本人登录日志 / 参与房间的对局流水） */
export const getLoginLogs = (limit = 20) => get(`/api/logs/login?limit=${limit}`);
export const getGameLogs = (roomCode, limit = 100) =>
  get(`/api/logs/game?${roomCode ? `roomCode=${encodeURIComponent(roomCode)}&` : ''}limit=${limit}`);

/** 当前用户资料（后台累计点数 / 场次 / 胜局） */
export const getProfile = () => get('/api/users/me');
