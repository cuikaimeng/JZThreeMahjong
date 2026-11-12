import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// 极简 .env 加载（无 dotenv 依赖）：存在则合并到 process.env
try {
  const fs = await import('node:fs');
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
} catch { /* ignore */ }

export const PORT = Number(process.env.PORT || 3000);
export const TOKEN_TTL_MS = (Number(process.env.TOKEN_TTL_DAYS) || 7) * 86400_000;

export const PG = {
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'mahjong',
};

export const REDIS = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
};

export const WX = {
  appid: process.env.WX_APPID || '',
  secret: process.env.WX_SECRET || '',
};

// 允许的跨域来源（逗号分隔）；开发默认 '*'，生产可收紧为具体域名
export const CORS_ORIGINS = process.env.CORS_ORIGINS || '*';
