import Redis from 'ioredis';
import { REDIS } from '../config.js';

/** 连接 Redis；失败返回 null（调用方降级内存存储） */
export default async function connect() {
  let client = null;
  try {
    client = new Redis({ ...REDIS, maxRetriesPerRequest: 1, connectTimeout: 1500 });
    await client.ping();
    return client;
  } catch (e) {
    console.warn(`[db] Redis unavailable (${e.code || e.message}) — using memory fallback`);
    if (client) client.disconnect();
    return null;
  }
}
