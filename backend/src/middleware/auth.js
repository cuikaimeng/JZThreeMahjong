import { getSession, getUser } from '../db/index.js';

/** Bearer token 鉴权：req.user 挂载用户信息 */
export async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  const session = await getSession(token);
  if (!session) return res.status(401).json({ error: '登录已过期' });
  const user = await getUser(session.userId);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  req.user = user;
  req.token = token;
  next();
}
