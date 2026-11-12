import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { queryHistory, queryRecordDetail } from '../db/index.js';

const router = Router();

/** 战绩汇总 + 列表（前端战绩页数据源） */
router.get('/', auth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const offset = Number(req.query.offset) || 0;
  const { summary, records } = await queryHistory(req.user.id, limit, offset);
  const total = Number(summary.total);
  const wins = Number(summary.wins);
  res.json({
    summary: {
      points: Number(summary.points),
      total,
      wins,
      winRate: total ? Math.round((wins / total) * 100) : 0,
    },
    records,
  });
});

/** 单局详情（前端牌谱详情页数据源） */
router.get('/:id', auth, async (req, res) => {
  const detail = await queryRecordDetail(Number(req.params.id), req.user.id);
  if (!detail) return res.status(404).json({ error: '记录不存在' });
  res.json(detail);
});

export default router;
