/**
 * 微信账号资料（微信小游戏）
 * - 静默：已授权 scope.userInfo 时直接取缓存资料
 * - 交互：wx.getUserProfile（用户手势）或 wx.createUserInfoButton
 * - 同步：PUT /api/users/me 写后端，大厅 / 房间内可见真实昵称头像
 *
 * 说明：微信平台自 2021 年起对 getUserProfile 也可能返回匿名资料
 *      （'微信用户' + 空头像），此时仍会以游客身份正常游戏。
 */
import { request, setUser } from '../net/api.js';

const KEY = 'mj_wx_profile';

function normalize(u) {
  if (!u) return null;
  const nickName = String(u.nickName || u.nickname || '').trim().slice(0, 32);
  const avatarUrl = String(u.avatarUrl || '').trim().slice(0, 512);
  if (!nickName && !avatarUrl) return null;
  return {
    nickName,
    avatarUrl,
    gender: u.gender || 0,
    country: u.country || '',
    province: u.province || '',
    city: u.city || '',
    anonymous: (!avatarUrl || nickName === '微信用户'),
  };
}

/** 本地缓存的微信资料 */
export function cachedWxProfile() {
  try {
    return wx.getStorageSync(KEY) || null;
  } catch (e) {
    return null;
  }
}

function cache(p) {
  if (!p) return;
  try { wx.setStorageSync(KEY, p); } catch (e) { /* ignore */ }
  if (typeof GameGlobal !== 'undefined') GameGlobal.__wxProfile = p;
}

/** 静默获取：仅在用户已授权 scope.userInfo 时可用 */
export function getWxProfileSilently() {
  return new Promise((resolve) => {
    if (typeof wx.getSetting !== 'function' || typeof wx.getUserInfo !== 'function') return resolve(null);
    wx.getSetting({
      success: (r) => {
        if (!r || !r.authSetting || !r.authSetting['scope.userInfo']) return resolve(null);
        wx.getUserInfo({
          withCredentials: false,
          lang: 'zh_CN',
          success: (res) => resolve(normalize(res && res.userInfo)),
          fail: () => resolve(null),
        });
      },
      fail: () => resolve(null),
    });
  });
}

/** 启动时取可用资料（优先缓存，其次已授权静默取），不弹授权 */
export async function ensureWxProfile() {
  const c = cachedWxProfile();
  if (c) return c;
  const p = await getWxProfileSilently();
  if (p) cache(p);
  return p;
}

/** 创建小游戏原生「授权头像昵称」按钮（getUserProfile 不可用时的降级路径） */
function createProfileButton(cb) {
  if (typeof wx.createUserInfoButton !== 'function') return cb(null);
  const info = typeof wx.getWindowInfo === 'function'
    ? wx.getWindowInfo()
    : { screenWidth: 375, screenHeight: 812 };
  const w = 220;
  const h = 44;
  let btn;
  try {
    btn = wx.createUserInfoButton({
      type: 'text',
      text: '授权微信头像昵称',
      withCredentials: false,
      lang: 'zh_CN',
      style: {
        left: Math.max(0, (info.screenWidth - w) / 2),
        top: Math.round(info.screenHeight * 0.56),
        width: w,
        height: h,
        backgroundColor: '#e8c37a',
        color: '#3a2a0c',
        fontSize: 14,
        textAlign: 'center',
        borderRadius: 22,
      },
    });
  } catch (e) {
    return cb(null);
  }
  let done = false;
  const finish = (p) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (btn.hide) btn.hide();
    if (btn.destroy) btn.destroy();
    cb(p);
  };
  const timer = setTimeout(() => finish(null), 15000); // 未点击则自动收起
  btn.onTap((res) => finish(normalize(res && res.userInfo)));
}

/** 交互式授权（必须在用户点击回调中调用），返回资料或 null */
export function requestWxProfile() {
  return new Promise((resolve) => {
    const done = (p) => {
      if (p) cache(p);
      resolve(p || null);
    };
    if (typeof wx.getUserProfile === 'function') {
      let settled = false;
      wx.getUserProfile({
        desc: '用于生成玩家头像与昵称',
        success: (res) => {
          if (settled) return;
          settled = true;
          const p = normalize(res && res.userInfo);
          if (p) done(p);
          else createProfileButton(done); // 匿名结果 → 再试原生按钮
        },
        fail: () => {
          if (settled) return;
          settled = true;
          createProfileButton(done);
        },
      });
      return;
    }
    createProfileButton(done);
  });
}

/** 把微信资料写入后端账号并刷新本地用户缓存 */
export async function syncWxProfile(profile) {
  if (!profile) return null;
  const body = {};
  if (profile.nickName) body.nickname = profile.nickName;
  if (profile.avatarUrl) body.avatarUrl = profile.avatarUrl;
  if (!Object.keys(body).length) return null;
  const r = await request('PUT', '/api/users/me', body);
  setUser(r.user);
  return r.user;
}
