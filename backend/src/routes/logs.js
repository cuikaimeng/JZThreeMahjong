import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { queryLoginLogs, queryGameLogs } from '../db/index.js';

const router = Router();

/** 登录日志：仅返回当前用户自己的记录 */
router.get('/login', auth, async (req, res) => {
  const logs = await queryLoginLogs(req.user.id, Number(req.query.limit) || 20);
  res.json({ logs });
});

/**
 * 对局日志：
 *   不传 roomCode → 本人产生的动作日志
 *   传 roomCode → 校验本人参与过该房间后返回整局事件流水
 */
router.get('/game', auth, async (req, res) => {
  const logs = await queryGameLogs(req.user.id, {
    roomCode: req.query.roomCode ? String(req.query.roomCode) : undefined,
    limit: Number(req.query.limit) || 100,
  });
  res.json({ logs });
});

export default router;
