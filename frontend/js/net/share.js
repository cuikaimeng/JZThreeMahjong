/**
 * 微信小游戏分享：好友房邀请
 * - 右上角菜单转发：wx.onShareAppMessage 动态带当前房号
 * - 房间内「邀请好友」：wx.shareAppMessage 直接拉起分享
 * - query 携带 roomCode（有密码时带 pwd），好友点卡片后由 Main 自动进房
 */
const TITLE = '三人扣点门板屋 · 就等你了';

export function roomShareQuery(room) {
  if (!room || !room.code) return '';
  const parts = [`roomCode=${encodeURIComponent(room.code)}`];
  if (room.hasPassword && room.pwd) parts.push(`pwd=${encodeURIComponent(room.pwd)}`);
  return parts.join('&');
}

function build(room) {
  return {
    title: room && room.code ? `房号 ${room.code} · ${TITLE}` : TITLE,
    query: roomShareQuery(room),
  };
}

/** 启动时开启系统转发菜单；getRoom 返回当前房间（不在房间时返回 null） */
export function enableShareMenu(getRoom) {
  try {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
    }
    if (typeof wx.onShareAppMessage === 'function') {
      wx.onShareAppMessage(() => build(getRoom()));
    }
  } catch (e) { /* 忽略不支持的环境 */ }
}

/** 房间内主动分享；返回是否成功调起微信分享 */
export function shareRoom(room) {
  if (typeof wx.shareAppMessage !== 'function') return false;
  try {
    wx.shareAppMessage(build(room));
    return true;
  } catch (e) {
    return false;
  }
}

/** 解析分享/启动参数（支持对象或 query 字符串） */
export function parseLaunchQuery(query) {
  if (!query) return {};
  if (typeof query === 'object') return query;
  const out = {};
  String(query)
    .replace(/^\?/, '')
    .split('&')
    .filter(Boolean)
    .forEach((kv) => {
      const [k, v = ''] = kv.split('=');
      try { out[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { out[k] = v; }
    });
  return out;
}
