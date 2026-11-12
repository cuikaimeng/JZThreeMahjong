import express from 'express';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import historyRoutes from './routes/history.js';
import logsRoutes from './routes/logs.js';
import roomRoutes from './routes/rooms.js';

const app = express();
app.use(express.json());

// 简易跨域（本地前端调试）
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
