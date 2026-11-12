/**
 * 运行环境与后端地址
 *
 * 两套配置：
 *   DEV  —— 本地开发：http://localhost:3000 + ws://localhost:3000/ws
 *   PROD —— 生产：https://<PROD_DOMAIN> + wss://<PROD_DOMAIN>/ws
 *
 * 自动判定（ENV_OVERRIDE='auto' 时）：
 *   1. 启动参数 ?env=dev|prod（浏览器预览 / 分享链接带 env 时优先）
 *   2. 微信小游戏 envVersion：develop → DEV，trial / release → PROD
 *   3. 都没有（浏览器预览 shim、未知环境）→ DEV
 *
 * 手动覆盖：把 ENV_OVERRIDE 改成 'dev' 或 'prod'，
 *   常用于「开发者工具里连生产服务器联调」。
 */

// 生产域名（不带协议、不带路径）；换域名时只改这一行
export const PROD_DOMAIN = 'menger.store';

export const DEV_ENDPOINTS = Object.freeze({
  API_BASE: 'http://localhost:3000',
  WS_URL: 'ws://localhost:3000/ws',
});

export const PROD_ENDPOINTS = Object.freeze({
  API_BASE: `https://${PROD_DOMAIN}`,
  WS_URL: `wss://${PROD_DOMAIN}/ws`,
});

// 'auto' | 'dev' | 'prod'
export const ENV_OVERRIDE = 'auto';

function launchEnv() {
  try {
    const opts = wx.getLaunchOptionsSync && wx.getLaunchOptionsSync();
    const v = opts && opts.query && opts.query.env;
    return v === 'dev' || v === 'prod' ? v : null;
  } catch (e) {
    return null;
  }
}

function wxEnv() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
    const v = info && info.miniProgram && info.miniProgram.envVersion;
    if (v === 'trial' || v === 'release') return 'prod';
    if (v === 'develop') return 'dev';
  } catch (e) { /* ignore */ }
  return null;
}

export function resolveEnv() {
  if (ENV_OVERRIDE === 'dev' || ENV_OVERRIDE === 'prod') return ENV_OVERRIDE;
  return launchEnv() || wxEnv() || 'dev';
}

export const CURRENT_ENV = resolveEnv();
export const ENDPOINTS = CURRENT_ENV === 'prod' ? PROD_ENDPOINTS : DEV_ENDPOINTS;
