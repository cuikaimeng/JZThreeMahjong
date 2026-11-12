import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { updateUser } from '../db/index.js';

const router = Router();

router.get('/me', auth, (req, res) => {
  res.json({ user: req.user });
});

/** 更新资料：微信授权拿到头像昵称后自动写入（或玩家手动改昵称） */
router.put('/me', auth, async (req, res) => {
  const { nickname, avatarUrl } = req.body || {};
  const patch = {};
  if (typeof nickname === 'string') {
    const n = nickname.trim().slice(0, 32);
    if (!n) return res.status(400).json({ error: '昵称不能为空' });
    patch.nickname = n;
  }
  if (typeof avatarUrl === 'string') {
    const url = avatarUrl.trim().slice(0, 512);
    if (url && !/^https?:\/\//.test(url)) return res.status(400).json({ error: '头像地址不合法' });
    patch.avatarUrl = url || null;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: '没有需要更新的资料' });
  const user = await updateUser(req.user.id, patch);
  res.json({ user });
});

export default router;
