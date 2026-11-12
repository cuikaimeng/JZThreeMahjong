/**
 * 微信资料 / 分享进房 回归测试（独立起临时 HTTP 服务，PG 降级内存，不污染真实库）
 * 覆盖：登录带头像昵称、PUT 更新资料、CORS 预检放行 PUT、分享 query 解析
 */
process.env.PG_HOST = '127.0.0.1';
process.env.PG_PORT = '1';

const app = (await import('../src/app.js')).default;
const { parseLaunchQuery, roomShareQuery } = await import('../../frontend/js/net/share.js');

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`✓ ${name}`); }
  else { failed++; console.log(`✗ ${name}${extra ? ` → ${extra}` : ''}`); }
};

const call = async (method, path, body, token) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, data, headers: res.headers };
};

console.log('— 微信资料自动生成玩家 —');
const avatar = 'https://thirdwx.qlogo.cn/mmopen/vi_32/TEST';
const login = await call('POST', '/api/auth/login', { code: 'wx_code_test', nickname: '微信牌友甲', avatarUrl: avatar });
ok('登录成功', login.status === 200 && !!login.data.token, JSON.stringify(login.data));
ok('自动生成玩家昵称', login.data.user.nickname === '微信牌友甲');
ok('微信头像落库', login.data.user.avatar_url === avatar, String(login.data.user.avatar_url));
ok('openid 绑定 wx.login code', String(login.data.user.openid).includes('wx_code_test'));
const token = login.data.token;

const me = await call('GET', '/api/users/me', null, token);
ok('GET /users/me 返回头像', me.data.user.avatar_url === avatar);

console.log('\n— 资料更新与校验 —');
const upd = await call('PUT', '/api/users/me', { nickname: '门板屋牌友乙', avatarUrl: 'https://wx.qlogo.cn/new.png' }, token);
ok('PUT 更新资料', upd.status === 200 && upd.data.user.nickname === '门板屋牌友乙', JSON.stringify(upd.data));
ok('PUT 更新头像', upd.data.user.avatar_url === 'https://wx.qlogo.cn/new.png');
const badUrl = await call('PUT', '/api/users/me', { avatarUrl: 'javascript:alert(1)' }, token);
ok('非法头像地址被拒绝', badUrl.status === 400, JSON.stringify(badUrl.data));
const emptyName = await call('PUT', '/api/users/me', { nickname: '  ' }, token);
ok('空昵称被拒绝', emptyName.status === 400);
const noAuth = await call('PUT', '/api/users/me', { nickname: '未登录' });
ok('未登录不能改资料', noAuth.status === 401);
const noBody = await call('PUT', '/api/users/me', {}, token);
ok('空更新体被拒绝', noBody.status === 400);

console.log('\n— CORS 预检（实测发现的缺陷） —');
const pre = await fetch(`${base}/api/users/me`, {
  method: 'OPTIONS',
  headers: { Origin: 'http://localhost:8790', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,authorization' },
});
ok('OPTIONS 预检 204', pre.status === 204, String(pre.status));
ok('放行 PUT', /PUT/.test(pre.headers.get('access-control-allow-methods') || ''), pre.headers.get('access-control-allow-methods'));
ok('放行 Authorization', /Authorization/i.test(pre.headers.get('access-control-allow-headers') || ''));

console.log('\n— 分享进房参数 —');
const q1 = parseLaunchQuery('roomCode=257369&pwd=8241');
ok('解析房号与密码', q1.roomCode === '257369' && q1.pwd === '8241', JSON.stringify(q1));
const q2 = parseLaunchQuery({ roomCode: '123456' });
ok('解析对象参数', q2.roomCode === '123456');
ok('无参数返回空对象', Object.keys(parseLaunchQuery('')).length === 0);
const s1 = roomShareQuery({ code: '257369', hasPassword: true, pwd: '8241' });
ok('带密码分享含房号与密码', s1 === 'roomCode=257369&pwd=8241', s1);
const s2 = roomShareQuery({ code: '123456' });
ok('无密码分享不带 pwd', s2 === 'roomCode=123456', s2);
ok('非房间不生成分享参数', roomShareQuery(null) === '');

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
