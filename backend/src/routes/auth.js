import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { WX, TOKEN_TTL_MS } from '../config.js';
import { upsertUser, saveSession, logLogin } from '../db/index.js';

const router = Router();

const AVATARS = ['me', 'qingluan', 'bailu'];
const NICKS = ['麻友', '雀圣', '小胡', '扣点王'];

/**
 * 登录：微信 code2session（真机）或游客登录（开发）
 * body: { code?, nickname? }
 */
router.post('/login', async (req, res) => {
  const ip = String(req.ip || '').slice(0, 64);
  const userAgent = req.get('user-agent') || '';
  let loginType = 'guest';
  let openid = null;
  let name = null;

  try {
    const { code, nickname, avatarUrl } = req.body || {};
    name = nickname || null;

    if (WX.appid && WX.secret && code) {
      loginType = 'wechat';
      // 真机：code 换 openid
      const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${WX.appid}&secret=${WX.secret}&js_code=${code}&grant_type=authorization_code`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (!data.openid) {
        logLogin({
          kind: 'http_login', loginType, success: false, ip, userAgent,
          detail: { reason: 'code2session', errcode: data.errcode ?? null },
        });
        return res.status(401).json({ error: '微信登录失败', detail: data });
      }
      openid = data.openid;
      name = name || NICKS[Math.floor(Math.random() * NICKS.length)];
    } else {
      // 开发：游客登录（前端未接微信登录前使用）
      openid = `guest:${code || randomBytes(8).toString('hex')}`;
      name = name || `游客${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const user = await upsertUser({
      openid,
      nickname: name,
      avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      avatarUrl: typeof avatarUrl === 'string' ? avatarUrl.slice(0, 512) : null,
    });
    const token = randomBytes(24).toString('hex');
    await saveSession(token, user.id, TOKEN_TTL_MS);

    // 登录日志（异步，不阻塞响应；token 只留前 8 位便于对账）
    logLogin({
      userId: user.id,
      openid,
      nickname: name,
      kind: 'http_login',
      loginType,
      success: true,
      ip,
      userAgent,
      detail: { tokenHint: token.slice(0, 8), ttlMs: TOKEN_TTL_MS },
    });
    res.json({ token, user });
  } catch (e) {
    logLogin({
      kind: 'http_login', loginType, success: false, ip, userAgent,
      detail: { error: e.message, openid },
    });
    res.status(500).json({ error: '登录失败', detail: e.message });
  }
});

export default router;
