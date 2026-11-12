/**
 * 内存降级存储（PG / Redis 不可用时使用，仅限本地开发）
 */
export class MemoryStore {
  constructor() {
    this.seq = 0;
    this.users = [];
    this.rooms = [];
    this.records = [];
    this.loginLogs = [];
    this.gameLogs = [];
    this.sessions = new Map();
  }

  nextId() {
    return ++this.seq;
  }
}
