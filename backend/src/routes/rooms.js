import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { createRoom, joinRoom, pubRoom } from '../services/roomService.js';
import { getRoom } from '../services/hotStore.js';

const router = Router();

/** 创建房间（好友房）：返回 6 位房号；实际进入房间走 WebSocket join */
router.post('/', auth, (req, res) => {
  const { mode, rounds, base, password } = req.body || {};
  const room = createRoom(req.user, { mode, rounds, base, password });
  res.json({ room: pubRoom(room) });
});

/** 加入房间校验（房号 + 密码）：与 WS join 相同逻辑，REST 供前置校验 */
router.post('/join', auth, (req, res) => {
  const { code, password } = req.body || {};
  if (!code || !/^\d{6}$/.test(String(code))) {
    return res.status(400).json({ error: '请输入 6 位房间号' });
  }
  const { error, room, seat } = joinRoom(req.user, String(code), password);
  if (error) return res.status(400).json({ error });
  res.json({ room: pubRoom(room), seat });
});

/** 查询房间状态 */
router.get('/:code', auth, (req, res) => {
  const room = getRoom(String(req.params.code));
  if (!room) return res.status(404).json({ error: '房间不存在' });
  res.json({ room: pubRoom(room) });
});

export default router;
