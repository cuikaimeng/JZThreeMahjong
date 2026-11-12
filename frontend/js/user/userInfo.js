/**
 * 当前用户信息
 * 优先使用后台真实用户（登录成功后由 setBackendUser 注入，或缓存的 /api/users/me 结果）；
 * 联机不可用时才回退到微信匿名化的「微信用户」占位。
 */
import { getUser } from '../net/api.js';

const DEFAULT_USER = { nickName: '微信用户', avatarUrl: '' };

let cached = null;
let backendUser = null;

function fromServer(u) {
  if (!u || !u.nickname) return null;
  return {
    nickName: u.nickname,
    avatarUrl: u.avatarUrl || u.avatar_url || '',
    userId: u.id,
    points: Number(u.points || 0),
    totalGames: Number(u.total_games || 0),
    totalWins: Number(u.total_wins || 0),
    fromServer: true,
  };
}

/** 联机初始化成功后注入真实用户资料 */
export function setBackendUser(user) {
  backendUser = user || null;
  cached = null;
  return currentUser();
}

/** 同步取当前用户（无真实数据时返回 null） */
export function currentUser() {
  return fromServer(backendUser) || fromServer(getUser()) || null;
}

/**
 * 获取当前用户信息（异步，带缓存）
 * @param {(user: {nickName:string, avatarUrl:string}) => void} callback
 */
export function fetchUserInfo(callback) {
  const real = currentUser();
  if (real) {
    cached = real;
    callback(cached);
    return;
  }
  if (cached) {
    callback(cached);
    return;
  }
  if (typeof wx.getUserInfo !== 'function') {
    cached = { ...DEFAULT_USER };
    callback(cached);
    return;
  }
  wx.getUserInfo({
    withCredentials: false,
    lang: 'zh_CN',
    success: (res) => {
      const u = res && res.userInfo;
      cached = {
        nickName: (u && u.nickName) || DEFAULT_USER.nickName,
        avatarUrl: (u && u.avatarUrl) || '',
      };
      callback(cached);
    },
    fail: () => {
      cached = { ...DEFAULT_USER };
      callback(cached);
    },
  });
}
