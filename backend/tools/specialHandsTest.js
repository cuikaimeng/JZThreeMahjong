/**
 * 特殊胡牌番型单测：七小对 / 豪七对 / 一条龙 / 清一色（含字一色）/ 十三幺
 * 覆盖：胡型判定（canHu）、听牌（listens）、计分（evaluate）、桌上询问（pendingActions）
 */
import { canHu, listens, isThirteenOrphans, listenCandidates } from '../src/game/engine.js';
import { evaluate } from '../src/game/scoring.js';
import { Table } from '../src/game/table.js';

let passed = 0;
let failed = 0;
function ok(name, cond, extra = '') {
  if (cond) passed += 1;
  else failed += 1;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' · ' + extra : ''}`);
}

/* ============ 一、七小对 ============ */
console.log('\n--- 七小对（7 个对子） ---');
{
  const H = ['1m', '1m', '3m', '3m', '5s', '5s', '7p', '7p', '9p', '9p', 'E', 'E', 'C', 'C'];
  ok('七小对（含字牌对）可胡', canHu(H) === true);
  const BAD = ['1m', '1m', '3m', '3m', '5s', '5s', '7p', '7p', '9p', '9p', 'E', 'E', 'C', 'C', 'F', 'F'];
  ok('8 个对子（16 张）不可胡', canHu(BAD) === false);
  const SIX = ['1m', '1m', '3m', '3m', '5s', '5s', '7p', '7p', '9p', '9p', 'E', 'E', 'E'];
  ok('6 对 + 1 刻不可判七小对（14 张才判）', canHu([...SIX, 'C']) === false);
  // 听牌：6 对 + 单张字 → 单钓字牌
  const T13 = ['1m', '1m', '3m', '3m', '5s', '5s', '7p', '7p', '9p', '9p', 'E', 'E', 'C'];
  ok('单钓中 → 听中', listens(T13).includes('C'));
  ok('单钓不含数牌', listens(T13).length === 1 && listens(T13)[0] === 'C', JSON.stringify(listens(T13)));
  const ev = evaluate({ hand14: [...T13, 'C'], melds: [], zimo: false });
  ok('计分含七小对 2 番', ev.fans.some((f) => f.label === '七小对' && f.value === '2 番'), JSON.stringify(ev.fans));
  ok('牌型名=七小对', ev.handName === '七小对');
}

/* ============ 二、一条龙 ============ */
console.log('\n--- 一条龙（1-9 同花色齐全，含胡的那张） ---');
{
  // 胡牌张 1m 恰好补齐 1-9 万
  const H13 = ['2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '1p', '1p', '5s', '5s'];
  const H14 = [...H13, '1m'];
  ok('一条龙（1m 补齐 1-9 万）可胡', canHu(H14) === true);
  const ev = evaluate({ hand14: H14, melds: [], zimo: false });
  ok('计分含一条龙 2 番', ev.fans.some((f) => f.label === '一条龙' && f.value === '2 番'), JSON.stringify(ev.fans));
  ok('牌型名=一条龙', ev.handName === '一条龙');
  // 顺子组合的一条龙（1-9 万 + 2-4/6-8 万混合）
  const DR = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2m', '3m', '4m', '6m', '6m'];
  ok('一条龙可胡（重复顺组合）', canHu(DR) === true);
  ok('一条龙计分（组合牌面）', evaluate({ hand14: DR, melds: [], zimo: false }).fans.some((f) => f.label === '一条龙'));
  // 反例：缺 5 万 → 非一条龙
  const NO = ['1m', '2m', '3m', '4m', '6m', '7m', '8m', '9m', '1p', '1p', '1p', '2s', '3s', '4s'];
  ok('缺 5m → 无一条龙番', !evaluate({ hand14: NO, melds: [], zimo: false }).fans.some((f) => f.label === '一条龙'));
}

/* ============ 三、清一色 ============ */
console.log('\n--- 清一色（单一花色 / 全字） ---');
{
  const QYS = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1m', '2m', '3m', '5m', '5m'];
  const ev = evaluate({ hand14: QYS, melds: [], zimo: false });
  ok('清一色 2 番', ev.fans.some((f) => f.label === '清一色' && f.value === '2 番'), JSON.stringify(ev.fans));
  ok('牌型名=清一色', ev.handName === '清一色');
  // 字一色：全字牌刻子 + 将
  const ZYS = ['E', 'E', 'E', 'S', 'S', 'S', 'W', 'W', 'W', 'N', 'N', 'N', 'C', 'C'];
  ok('字一色可胡', canHu(ZYS) === true);
  const ev2 = evaluate({ hand14: ZYS, melds: [], zimo: false });
  ok('字一色计清一色', ev2.fans.some((f) => f.label === '清一色'), JSON.stringify(ev2.fans));
  // 反例：两门花色
  const MIX = ['1m', '2m', '3m', '1p', '2p', '3p', '4m', '5m', '6m', '7m', '7m', '7m', '8p', '8p'];
  ok('两门花色非清一色', !evaluate({ hand14: MIX, melds: [], zimo: false }).fans.some((f) => f.label === '清一色'));
}

/* ============ 四、十三幺 ============ */
console.log('\n--- 十三幺（幺九字 13 种 + 任意一对） ---');
{
  const D13 = ['1m', '9m', '1p', '9p', '1s', '9s', 'E', 'S', 'W', 'N', 'C', 'F', 'P'];
  ok('十三幺（1m 成对）可胡', canHu([...D13, '1m']) === true);
  ok('十三幺（白成对）可胡', canHu([...D13, 'P']) === true);
  ok('isThirteenOrphans 判定正确', isThirteenOrphans([...D13, '1m']) === true);
  ok('缺 E 加 2m 不可胡', canHu([...D13.filter((t) => t !== 'E'), '2m']) === false);
  ok('字牌混入非幺九不可胡', canHu([...D13.filter((t) => t !== '1m'), '2m']) === false);
  // 听牌：13 张全单 → 听全部 13 张幺九字
  const waits = listens(D13);
  ok('幺九字 13 单张 → 13 面听', waits.length === 13, JSON.stringify(waits));
  // 听牌：12 单 + 1 对 → 只听缺的那张
  const T13 = D13.filter((t) => t !== 'P');
  T13.push('1m'); // 1m 成对
  const w2 = listens(T13);
  ok('12 单 + 1 对 → 单听缺张', w2.length === 1 && w2[0] === 'P', JSON.stringify(w2));
  // 计分：基础1 + 十三幺16 + 门清1 = 18
  const ev = evaluate({ hand14: [...D13, '1m'], melds: [], zimo: false });
  ok('计分含十三幺 4 番', ev.fans.some((f) => f.label === '十三幺' && f.value === '4 番'), JSON.stringify(ev.fans));
  ok('牌型名=十三幺', ev.handName === '十三幺');
  ok('十三幺倍数 4', ev.multiplier === 4, String(ev.multiplier));
}

/* ============ 五、桌面集成：打牌后询问胡牌 ============ */
console.log('\n--- 桌面集成：特殊牌型的点炮询问 ---');
{
  const D13 = ['1m', '9m', '1p', '9p', '1s', '9s', 'E', 'S', 'W', 'N', 'C', 'F', 'P'];
  const room = {
    code: 'sp', mode: 'x', laps: 1, ownerId: 1, status: 'playing',
    players: [
      { userId: 1, nickname: '甲', seat: 'me', ready: true, isAI: false },
      { userId: 2, nickname: '乙', seat: 'left', ready: true, isAI: false },
      { userId: 3, nickname: '丙', seat: 'right', ready: true, isAI: false },
    ],
  };
  const events = [];
  const t = new Table(room, (type, data, target) => events.push([type, data, target]));
  room.table = t;
  t.phase = 'play';
  t.turn = 'me';
  t.dealer = 'me';
  t.hands = { me: ['1m', '2s', '4s', '6s', '8s', '2p', '4p', '6p', '8p', '3m', '5m', '7m', '9m'], left: [], right: [...D13] };
  t.melds = { me: [], left: [], right: [] };
  t.discards = { me: [], left: [], right: [] };
  t.listening = { me: false, left: false, right: false };
  t.listenWaits = { me: [], left: [], right: [] };
  t.listenDiscard = { me: null, left: null, right: null };
  t.lastDraw = { me: null, left: null, right: null };
  t.wall = Array.from({ length: 40 }, (_, i) => ({ t: '9p', id: 9000 + i }));
  // 规则①：未报听一律不能胡 —— right 未报听，打 1m 无胡询问
  t.discard('me', '1m');
  ok('未报听者不收到点炮胡询问', !(t.pendingActions.right || []).includes('hu'));
  ok('canOtherHu：未报听=false', t.canOtherHu('right', '1m') === false);
  // 规则②：报听后十三幺十三面听实为 10 面 —— 1m（1 点）不能点炮胡，字牌（10 点）可以
  t.listening.right = true;
  t.listenWaits.right = [...D13];
  ok('canOtherHu：报听 + 1m（1 点 <6）=false', t.canOtherHu('right', '1m') === false);
  ok('canOtherHu：报听 + 中（10 点）=true', t.canOtherHu('right', 'C') === true);
  t.performAction('right', 'pass');
  // 规则①②（自摸）：未报听不能自摸；十三面听摸进 1m 不能自摸胡，摸进中可以
  t.hands.right = [...D13, '1m'];
  t.lastDraw.right = '1m';
  ok('canZimoNow：摸 1m（1 点）=false', t.canZimoNow('right') === false);
  t.hands.right = [...D13, 'C'];
  t.lastDraw.right = 'C';
  ok('canZimoNow：摸 中=true', t.canZimoNow('right') === true);
  t.listening.right = false;
  ok('canZimoNow：未报听=false', t.canZimoNow('right') === false);
  t.listening.right = true;
  t.hands.right = [...D13]; // 恢复 13 张听牌手牌
  t.lastDraw.right = null;
  // 完整点炮胡流程：me 打「中」→ 报听的 right 胡
  t.turn = 'me';
  t.phase = 'play';
  t.pendingActions = {};
  t.lastDiscard = null;
  t.hands.me = ['2s', '4s', '6s', '8s', '2p', '4p', '6p', '8p', '3m', '5m', '7m', '9m', '2m', 'C'];
  t.lastDraw.me = 'C';
  t.discard('me', 'C');
  ok('报听十三幺收到点炮询问', (t.pendingActions.right || []).includes('hu'));
  t.performAction('right', 'hu');
  const settle = events.filter((e) => e[0] === 'settle').pop();
  ok('结算牌型名=十三幺', !!settle && settle[1].handName === '十三幺', settle && settle[1].handName);
  ok('十三幺结算倍数 4', !!settle && settle[1].multiplier === 4, settle && String(settle[1].multiplier));
}

/* ============ 六、十三幺与报听门槛 ============ */
console.log('\n--- 十三幺报听：等待牌面必须同时持有 1万/1条/1饼（听口 ≥9 点） ---');
{
  const D13 = ['1m', '9m', '1p', '9p', '1s', '9s', 'E', 'S', 'W', 'N', 'C', 'F', 'P'];
  // 用户例：两个1饼 + 1万 9饼 9万 9条 + 东南西北中发白（13 张，缺 1条）
  const EX13 = ['1p', '1p', '1m', '9p', '9m', '9s', 'E', 'S', 'W', 'N', 'C', 'F', 'P'];
  ok('用户例手牌确为十三幺形态（+1条 可胡）', canHu([...EX13, '1s']) === true);
  // 摸进杂牌（5m）：扣 5m → 唯一听口 1条（1 点）→ 不能报听
  ok('用户例 + 摸5m → 无任何报听候选', listenCandidates([...EX13, '5m']).length === 0);
  // 摸进 1条：扣 1饼/1条 均 <3 点被拒；扣 9m → 单听 9m（手牌含 1万/1条/1饼 ✓）
  const c1s = listenCandidates([...EX13, '1s']);
  ok(
    '用户例 + 摸1条 → 不能扣 1饼/1条，可扣 9m 单听 9m',
    !c1s.some((c) => c.tile === '1p' || c.tile === '1s') &&
      c1s.some((c) => c.tile === '9m' && c.waits.length === 1 && c.waits[0] === '9m'),
    JSON.stringify(c1s),
  );

  // 对照：同样的形态但缺 9饼（持有 1万/1条/1饼）→ 可报听单听 9饼
  const OK14 = ['1p', '1p', '1m', '1s', '9m', '9s', 'E', 'S', 'W', 'N', 'C', 'F', 'P', '5m'];
  const cOk = listenCandidates(OK14);
  ok(
    '缺 9饼（含三门 1 数牌）→ 扣 5m 单听 9饼',
    cOk.some((c) => c.tile === '5m' && c.waits.length === 1 && c.waits[0] === '9p'),
    JSON.stringify(cOk),
  );

  // 13 单 + 1m 成对：扣 1m（1 点 <3）不能走十三面听；扣其他幺九字 → 单听（等待牌面含三门 1 数牌 ✓）
  const h1 = [...D13, '1m'];
  const c1 = listenCandidates(h1);
  ok('1m 成对 → 不能扣 1m 十三面听', !c1.some((c) => c.tile === '1m'));
  ok('1m 成对 → 可扣 9m 单听 9m', c1.some((c) => c.tile === '9m' && c.waits.length === 1 && c.waits[0] === '9m'));
  // 对照：9m 成对 → 扣 9m（9 点）十三面听
  ok('9m 成对 → 可扣 9m 十三面听', listenCandidates([...D13, '9m']).some((c) => c.tile === '9m' && c.waits.length === 13));

  // 桌面集成：declareListen 同样受限（缺 1条 的十三幺形态不能报听）
  const room = {
    code: 'sp2', mode: 'x', laps: 1, ownerId: 1, status: 'playing',
    players: [
      { userId: 1, nickname: '甲', seat: 'me', ready: true, isAI: false },
      { userId: 2, nickname: '乙', seat: 'left', ready: true, isAI: false },
      { userId: 3, nickname: '丙', seat: 'right', ready: true, isAI: false },
    ],
  };
  const t = new Table(room, () => {});
  room.table = t;
  t.phase = 'play';
  t.turn = 'me';
  t.dealer = 'me';
  t.hands = { me: EX13.slice(), left: [], right: [] };
  t.melds = { me: [], left: [], right: [] };
  t.discards = { me: [], left: [], right: [] };
  t.listening = { me: false, left: false, right: false };
  t.listenWaits = { me: [], left: [], right: [] };
  t.listenDiscard = { me: null, left: null, right: null };
  t.lastDraw = { me: null, left: null, right: null };
  t.wall = [{ t: '5m', id: 1 }];
  t.lastDraw.me = '5m';
  const r = t.declareListen('me');
  ok('桌面报听：用户例（缺 1条）报听被拒', r.ok === false, r.reason || '');
}

/* ============ 七、豪七对 ============ */
console.log('\n--- 豪七对：4 张相同（未起杠）充当两对 ---');
{
  // 情形1：听牌时已有 4 张相同（6 对 + 4 北）→ 14 张直接胡
  const H14 = ['1p', '1p', '2p', '2p', '3p', '3p', '7s', '7s', '3m', '3m', 'N', 'N', 'N', 'N'];
  ok('豪七对（已有四张北）可胡', canHu(H14) === true);
  const r1 = evaluate({ hand14: H14, melds: [], zimo: true });
  ok(
    '豪七对倍数 4（不计七小对 2）',
    r1.handName === '豪七对' && r1.multiplier === 4 && r1.fans.length === 1,
    JSON.stringify(r1),
  );
  // 对照：纯 7 对 → 七小对倍数 2
  const PURE = ['1p', '1p', '2p', '2p', '3p', '3p', '7s', '7s', '3m', '3m', '5m', '5m', 'N', 'N'];
  const r2 = evaluate({ hand14: PURE, melds: [], zimo: false });
  ok('纯七对倍数 2（豪七对不误判）', r2.handName === '七小对' && r2.multiplier === 2, JSON.stringify(r2));

  // 情形2（用户例）：2个1饼 2个2饼 2个3饼 2个7条 2个3万 + 3个北 → 只听北风
  const H13 = ['1p', '1p', '2p', '2p', '3p', '3p', '7s', '7s', '3m', '3m', 'N', 'N', 'N'];
  ok('用户例 13 张听口含北风', listens(H13).includes('N'), JSON.stringify(listens(H13)));
  ok('胡北风 → 豪七对可胡', canHu([...H13, 'N']) === true);
  ok('胡 3万 走标准牌型也可胡（非豪七对）', canHu([...H13, '3m']) === true);
  ok('胡其他牌不成胡', canHu([...H13, '5m']) === false);
  const r3 = evaluate({ hand14: [...H13, 'N'], melds: [], zimo: false });
  ok('胡口北风成豪七对 → 倍数 4', r3.handName === '豪七对' && r3.multiplier === 4, JSON.stringify(r3));
  const r4 = evaluate({ hand14: [...H13, '3m'], melds: [], zimo: false });
  ok('胡 3万 按标准牌型命名（平胡）', r4.handName === '平胡', JSON.stringify(r4));

  // 报听：听口含北风（10 点 ≥6）→ 可扣杂牌报听
  const c = listenCandidates([...H13, '5m']);
  ok('可扣 5m 报听（听口含北风）', c.some((x) => x.tile === '5m' && x.waits.includes('N')), JSON.stringify(c));

  // 桌面：报听豪七对摸进第 4 张北 → 不能杠（杠后无听口），只能自摸胡
  const room = {
    code: 'sp3', mode: 'x', laps: 1, ownerId: 1, status: 'playing',
    players: [
      { userId: 1, nickname: '甲', seat: 'me', ready: true, isAI: false },
      { userId: 2, nickname: '乙', seat: 'left', ready: true, isAI: false },
      { userId: 3, nickname: '丙', seat: 'right', ready: true, isAI: false },
    ],
  };
  const events = [];
  const t = new Table(room, (type, data) => events.push([type, data]));
  room.table = t;
  t.phase = 'play';
  t.turn = 'me';
  t.dealer = 'me';
  t.hands = { me: [...H13, 'N'], left: [], right: [] };
  t.melds = { me: [], left: [], right: [] };
  t.discards = { me: [], left: [], right: [] };
  t.listening = { me: true, left: false, right: false };
  t.listenWaits = { me: ['N'], left: [], right: [] };
  t.listenDiscard = { me: null, left: null, right: null };
  t.lastDraw = { me: 'N', left: null, right: null };
  t.wall = Array.from({ length: 40 }, (_, i) => ({ t: '9p', id: 9000 + i }));
  ok('报听豪七对摸进第4张北 → 暗杠被拒', t.gangSelf('me', 'N') === false && t.melds.me.length === 0);
  t.huSelf('me');
  const settle = events.filter((e) => e[0] === 'settle').pop();
  ok('自摸第4张北 → 胡豪七对', t.phase === 'settle' && !!settle && settle[1].handName === '豪七对', settle && settle[1].handName);
}

console.log(`\n合计 ${passed + failed} 项：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
