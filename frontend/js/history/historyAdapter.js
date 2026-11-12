/**
 * 战绩数据适配层：把后端 /api/history 的数据库字段
 * 转成战绩列表页 / 详情页 Scene 使用的展示结构。
 *
 * 牌面统一使用内部牌 ID（'1m' / 'E'），drawTileFace 会自动渲染。
 */
const SEATS = ['me', 'left', 'right'];
const GRADS = {
  me: ['#4aa88a', '#1b5c47'],
  left: ['#3f7ec9', '#1c4a80'],
  right: ['#c96a3f', '#8a3d1f'],
};

/** JSONB 字段可能是数组，也可能是 JSON 字符串（内存降级 / 老数据） */
function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

function asObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      return p && typeof p === 'object' ? p : {};
    } catch (e) {
      return {};
    }
  }
  return {};
}

const pad = (n) => String(n).padStart(2, '0');

/** 时间戳 → 今天 / 昨天 / M月D日 HH:mm */
export function formatWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (dayStart(now) - dayStart(d)) / 86400000;
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function winTagOf(r, isMine) {
  if (r.win_type === 'draw') return '流局';
  if (r.win_type === 'zimo') return isMine ? '自摸' : '被自摸';
  if (isMine) return '点炮胡';
  return r.is_bao || r.isBao ? '放炮' : '被点炮';
}

function fanLabels(fans) {
  return asArray(fans)
    .map((f) => (typeof f === 'string' ? f : f && f.label))
    .filter(Boolean);
}

/** 汇总卡 */
export function adaptSummary(s = {}) {
  const total = Number(s.total || 0);
  const wins = Number(s.wins || 0);
  const rate = s.winRate != null ? Number(s.winRate) : total ? Math.round((wins / total) * 100) : 0;
  return {
    points: Number(s.points || 0),
    total,
    wins,
    winRate: `${rate}%`,
  };
}

/** 列表记录 */
export function adaptRecord(r) {
  const isWin = !!r.is_win || !!r.isWin;
  const isDraw = r.win_type === 'draw';
  const winTag = winTagOf(r, isWin);
  const fans = fanLabels(r.fans);
  const myHand = asArray(r.my_hand_tiles);
  const hand = myHand.length ? myHand : asArray(r.hand_tiles);
  const tags = [winTag, ...fans].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 6);

  return {
    id: r.id,
    time: formatWhen(r.finished_at),
    room: r.room_code ? `好友房 ${r.room_code}` : r.room_mode || '好友房',
    delta: Number(r.delta || 0),
    result: isDraw ? 'draw' : isWin ? 'win' : 'lose',
    detail: [winTag, fans.slice(0, 2).join(' · ')].filter(Boolean).join(' · '),
    hand,
    winTile: r.win_tile || '',
    tags,
  };
}

/**
 * 单局详情（/api/history/:id 返回 game_records.* + players[]）
 * 优先用 snapshot（三家牌面/副露/番型/点数明细）；老记录无快照时回退到 players[]。
 */
export function adaptDetail(d = {}, meId) {
  const snap = asObject(d.snapshot);
  const dbPlayers = asArray(d.players);
  const isDraw = d.win_type === 'draw';

  // 我在服务端座位：真人明细里的 seat 是 0/1/2
  // PG 返回 user_id / delta / hand_tiles；内存降级返回 userId / delta / handTiles
  const mineDb = dbPlayers.find((p) => Number(p.user_id != null ? p.user_id : p.userId) === Number(meId));
  const mySeat = mineDb ? SEATS[Number(mineDb.seat)] : null;

  const roster = (asArray(snap.players).length
    ? asArray(snap.players)
    : dbPlayers.map((p) => ({
        seat: SEATS[Number(p.seat)],
        nickname: p.nickname,
        d: p.delta,
        user_id: p.user_id,
        hand_tiles: p.hand_tiles || p.handTiles,
        detail: p.detail,
      }))
  ).map((p) => ({
    seat: typeof p.seat === 'number' ? SEATS[p.seat] : p.seat,
    nickname: p.nickname || '玩家',
    avatar: p.avatar || '',
    d: Number(p.d != null ? p.d : p.delta || 0),
    me: (typeof p.seat === 'number' ? SEATS[p.seat] : p.seat) === mySeat,
    detail: p.detail || '',
    hand_tiles: asArray(p.hand_tiles),
  }));

  const hands = asObject(snap.hands || d.hands);
  const melds = asObject(snap.melds || d.melds);
  const seatDelta = asObject(snap.delta || d.delta);
  const seatDetail = asObject(snap.detail || d.detail);
  const dealerSeat = typeof snap.dealerSeat === 'number' ? SEATS[snap.dealerSeat] : snap.dealerSeat;
  const winnerSeat = typeof snap.winnerSeat === 'number' ? SEATS[snap.winnerSeat] : snap.winnerSeat;

  const players = roster.map((p) => ({
    name: p.me ? '你' : p.nickname,
    char: p.me ? '我' : String(p.nickname || '麻').slice(0, 1),
    grad: GRADS[p.seat] || GRADS.me,
    me: p.me,
    dealer: p.seat === dealerSeat,
    winner: !isDraw && p.seat === winnerSeat,
    hand: asArray(hands[p.seat]).length ? asArray(hands[p.seat]) : p.hand_tiles,
    melds: asArray(melds[p.seat]),
  }));

  const deltas = roster.map((p) => ({
    name: p.me ? '你' : p.nickname,
    char: p.me ? '我' : String(p.nickname || '麻').slice(0, 1),
    grad: GRADS[p.seat] || GRADS.me,
    delta: Number(p.d != null ? p.d : seatDelta[p.seat] || 0),
    me: p.me,
    detail: seatDetail[p.seat] || p.detail || '',
  }));

  const fans = asArray(snap.fans || d.fans).filter((f) => f && typeof f === 'object');
  const myDelta = deltas.find((x) => x.me);
  const myIsBao = !!(mineDb && (mineDb.is_bao || mineDb.isBao));
  const winTag = winTagOf({ ...d, is_bao: myIsBao }, !!(myDelta && myDelta.delta > 0));
  const handName = snap.handName || (isDraw ? '流局' : fanLabels(fans).join(' · ') || '平胡');
  const wallCount = Number(d.wall_count != null ? d.wall_count : snap.wallCount || 0);

  return {
    id: d.id,
    time: formatWhen(d.finished_at),
    room: snap.roomCode ? `好友房 ${snap.roomCode}` : '好友房',
    delta: myDelta ? myDelta.delta : 0,
    result: isDraw ? 'draw' : myDelta && myDelta.delta > 0 ? 'win' : 'lose',
    detail: [winTag, handName].filter(Boolean).join(' · '),
    hand: asArray(snap.handTiles || d.hand_tiles),
    winTile: snap.winTile || d.win_tile || '',
    tags: [winTag, ...fanLabels(fans)].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 6),
    winTag,
    title: handName,
    round: `${d.round_name || '对局'} · 壁牌 ${wallCount} 张`,
    handOwner: (players.find((p) => p.winner) || {}).name || '',
    fans,
    total: `合计 ${Number(snap.totalPoints != null ? snap.totalPoints : d.total_points || 0)} 点`,
    deltas,
    players,
  };
}
