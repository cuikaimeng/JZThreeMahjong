import express from 'express';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import historyRoutes from './routes/history.js';
import logsRoutes from './routes/logs.js';
import roomRoutes from './routes/rooms.js';
import { CORS_ORIGINS } from './config.js';

const app = express();
// nginx 反代后取 X-Forwarded-For 中的真实客户端 IP（登录日志用）
app.set('trust proxy', 1);
app.use(express.json());

// 跨域：开发默认 '*'；生产用 CORS_ORIGINS 指定白名单。
// 微信小游戏 wx.request 不受 CORS 限制，这里主要影响浏览器预览页面。
const corsAllowed = CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (corsAllowed.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && corsAllowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/rooms', roomRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: '接口不存在' }));

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[http]', err);
  res.status(500).json({ error: '服务器内部错误' });
});

export default app;
