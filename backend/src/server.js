import { PORT } from './config.js';
import app from './app.js';
import { createServer } from 'node:http';
import { attachWebSocket } from './ws/index.js';
import { pg, redis } from './db/index.js';
import { restoreRooms } from './services/hotStore.js';

const httpServer = createServer(app);
attachWebSocket(httpServer);
restoreRooms();

httpServer.listen(PORT, () => {
  console.log(`[mahjong] HTTP+WS listening on :${PORT}`);
  console.log(`[mahjong] pg=${pg ? 'connected' : 'memory-fallback'} redis=${redis ? 'connected' : 'memory-fallback'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('\n[mahjong] shutting down...');
    if (pg) await pg.end().catch(() => {});
    if (redis) redis.disconnect();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}
