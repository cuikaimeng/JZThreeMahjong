/**
 * 战绩示例数据（仅作离线设计稿参考，生产页面已改为读取 /api/history 真实数据库数据）
 * 数据来源见 historyAdapter.js（后端 game_records / game_record_players / snapshot）。
 * 本文件当前无页面引用，保留用于布局调试与字段示例说明。
 *
 * 牌表示法：'3万' 数字牌（数字+花色）；'东'/'中' 等单字为字牌
 * result: 'win' 胡牌 | 'lose' 放炮/被自摸 | 'draw' 流局
 * hand: 胡的牌（胡牌时为自己的牌型，放炮/被自摸时为胡家的牌型）
 * winTile: 胡的那张牌（会高亮）
 * tags: 特殊牌局标签
 * --- 对局详情 ---
 * winTag: 详情页顶部胶囊（自摸/点炮/放炮/被自摸/流局）
 * title: 详情页主标题（牌型）
 * round: 局信息
 * handOwner: 牌型归属
 * fans: 计分明细 [{label, value}]
 * total: 明细合计文案
 * deltas: 三家点数变动 [{name, char, grad, delta, me}]
 * players: 三家牌谱 [{name, char, grad, me, dealer, winner, hand, melds}]
 *   melds: [{type:'peng'|'gang', tile, concealed}]（暗杠 concealed:true）
 */
const A1 = ['#3f7ec9', '#1c4a80']; // 青鸾
const A2 = ['#c96a3f', '#8a3d1f']; // 白鹭
const A3 = ['#4aa88a', '#1b5c47']; // 我

export const SUMMARY = {
  points: 23,
  total: 12,
  wins: 7,
  winRate: '58%',
};

export const GAME_RECORDS = [
  {
    time: '今天 21:46',
    room: '好友房',
    delta: 18,
    result: 'win',
    detail: '自摸 · 报听后点数翻倍',
    hand: ['1万', '2万', '3万', '4万', '5万', '6万', '7万', '8万', '9万', '1万', '1万', '1万', '2万', '2万'],
    winTile: '2万',
    tags: ['自摸', '清一色', '一条龙', '门清'],
    winTag: '自摸',
    title: '清一色 · 一条龙',
    round: '东一局 · 第 9 巡 · 壁牌 18 张',
    handOwner: '我',
    fans: [
      { label: '基础点数 · 2 万', value: '2 点' },
      { label: '报听自摸 ×2', value: '4 点' },
      { label: '清一色 · 一条龙 加成', value: '+2 点' },
      { label: '暗杠 ×1', value: '+2 点' },
    ],
    total: '合计 6 点 × 3 家',
    deltas: [
      { name: '你', char: '我', grad: A3, delta: 18, me: true, detail: '自摸 · 合计 6 点 × 3 家' },
      { name: '青鸾', char: '青', grad: A1, delta: -9, detail: '承担自摸 6 点' },
      { name: '白鹭', char: '白', grad: A2, delta: -9, detail: '承担自摸 6 点' },
    ],
    players: [
      {
        name: '你', char: '我', grad: A3, me: true, dealer: false, winner: true,
        hand: ['1万', '2万', '3万', '4万', '5万', '6万', '7万', '8万', '9万', '2万'],
        melds: [{ type: 'gang', tile: '1万', concealed: true }],
      },
      {
        name: '青鸾', char: '青', grad: A1, dealer: true,
        hand: ['2筒', '3筒', '4筒', '6筒', '7筒', '8筒', '9筒', '9筒', '东', '东', '南', '南', '发'],
        melds: [],
      },
      {
        name: '白鹭', char: '白', grad: A2,
        hand: ['2条', '3条', '4条', '5条', '6条', '7条', '北', '北', '中', '中', '白', '白', '发'],
        melds: [],
      },
    ],
  },
  {
    time: '今天 20:12',
    room: '匹配房',
    delta: 7,
    result: 'win',
    detail: '点炮胡 · 接「白鹭」放炮',
    hand: ['3筒', '3筒', '5筒', '5筒', '7条', '7条', '东', '东', '南', '南', '中', '中', '白', '白'],
    winTile: '7条',
    tags: ['七小对', '报听'],
    winTag: '点炮',
    title: '七小对',
    round: '东一局 · 第 12 巡 · 壁牌 10 张',
    handOwner: '我',
    fans: [{ label: '基础点数 · 7 条', value: '7 点' }],
    total: '合计 7 点',
    deltas: [
      { name: '你', char: '我', grad: A3, delta: 7, me: true, detail: '放炮者已听 · 付胡牌点数 7 点' },
      { name: '白鹭', char: '白', grad: A2, delta: -7, detail: '放炮 · 已听付 7 点' },
      { name: '青鸾', char: '青', grad: A1, delta: 0, detail: '' },
    ],
    players: [
      {
        name: '你', char: '我', grad: A3, me: true, dealer: false, winner: true,
        hand: ['3筒', '3筒', '5筒', '5筒', '7条', '7条', '东', '东', '南', '南', '中', '中', '白', '白'],
        melds: [],
      },
      {
        name: '白鹭', char: '白', grad: A2, dealer: true,
        hand: ['1万', '2万', '3万', '5万', '6万', '7万', '8万', '9万', '1条', '2条', '4条', '6条', '9条'],
        melds: [],
      },
      {
        name: '青鸾', char: '青', grad: A1,
        hand: ['2筒', '4筒', '6筒', '8筒', '1万', '5万', '9万', '2条', '5条', '8条', '北', '西', '南'],
        melds: [],
      },
    ],
  },
  {
    time: '今天 19:05',
    room: '好友房',
    delta: -21,
    result: 'lose',
    detail: '放炮 · 胡家「青鸾」· 一包三',
    hand: ['2筒', '2筒', '5筒', '5筒', '7筒', '7筒', '白', '白', '东', '东', '中', '中', '发', '发'],
    winTile: '7筒',
    tags: ['对对胡', '混一色', '包胡'],
    winTag: '放炮',
    title: '对对胡 · 混一色',
    round: '南二局 · 第 5 巡 · 壁牌 30 张',
    handOwner: '青鸾',
    fans: [
      { label: '基础点数 · 7 筒', value: '7 点' },
      { label: '一包三', value: '× 3 家' },
    ],
    total: '合计 21 点（包胡）',
    deltas: [
      { name: '青鸾', char: '青', grad: A1, delta: 21, detail: '点炮 7 点 × 3 家（包胡）' },
      { name: '你', char: '我', grad: A3, delta: -21, me: true, detail: '放炮未听 · 包赔三家 7 点' },
      { name: '白鹭', char: '白', grad: A2, delta: 0, detail: '由包胡者代赔' },
    ],
    players: [
      {
        name: '青鸾', char: '青', grad: A1, dealer: true, winner: true,
        hand: ['2筒', '2筒', '5筒', '5筒', '7筒', '7筒', '白', '白', '东', '东', '中', '中', '发', '发'],
        melds: [],
      },
      {
        name: '你', char: '我', grad: A3, me: true,
        hand: ['3万', '4万', '5万', '6万', '7万', '8万', '1条', '2条', '3条', '北'],
        melds: [{ type: 'peng', tile: '发' }],
      },
      {
        name: '白鹭', char: '白', grad: A2,
        hand: ['1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7条', '8条', '9条', '南', '南', '西', '西'],
        melds: [],
      },
    ],
  },
  {
    time: '昨天 22:30',
    room: '匹配房',
    delta: 5,
    result: 'win',
    detail: '点炮胡 · 接「青鸾」放炮',
    hand: ['2万', '3万', '4万', '5筒', '5筒', '6筒', '6筒', '7筒', '8筒', '9筒', '9筒', '9筒', '东', '东'],
    winTile: '4筒',
    tags: ['平胡', '明杠 ×1'],
    winTag: '点炮',
    title: '平胡',
    round: '东三局 · 第 8 巡 · 壁牌 22 张',
    handOwner: '我',
    fans: [
      { label: '基础点数 · 4 筒', value: '4 点' },
      { label: '明杠 ×1', value: '+1 点' },
    ],
    total: '合计 5 点',
    deltas: [
      { name: '你', char: '我', grad: A3, delta: 5, me: true, detail: '（胡牌点数4 + 明杠1）· 已听付 5 点' },
      { name: '青鸾', char: '青', grad: A1, delta: -5, detail: '放炮 · 已听付 5 点' },
      { name: '白鹭', char: '白', grad: A2, delta: 0, detail: '' },
    ],
    players: [
      {
        name: '你', char: '我', grad: A3, me: true, dealer: false, winner: true,
        hand: ['2万', '3万', '4万', '5筒', '6筒', '7筒', '8筒', '9筒', '东', '东', '白'],
        melds: [{ type: 'gang', tile: '9筒' }],
      },
      {
        name: '青鸾', char: '青', grad: A1, dealer: true,
        hand: ['2条', '3条', '4条', '6条', '7条', '8条', '1万', '1万', '9万', '南', '南', '西', '发'],
        melds: [],
      },
      {
        name: '白鹭', char: '白', grad: A2,
        hand: ['1筒', '2筒', '3筒', '5筒', '6筒', '7筒', '4条', '5条', '6条', '北', '北', '中', '中'],
        melds: [],
      },
    ],
  },
  {
    time: '昨天 21:02',
    room: '好友房',
    delta: -3,
    result: 'lose',
    detail: '被自摸 · 胡家「白鹭」',
    hand: ['1万', '1万', '4万', '4万', '3条', '3条', '9条', '9条', '东', '东', '西', '西', '发', '发'],
    winTile: '3条',
    tags: ['七小对', '暗杠 ×1'],
    winTag: '被自摸',
    title: '七小对',
    round: '东二局 · 第 14 巡 · 壁牌 6 张',
    handOwner: '白鹭',
    fans: [{ label: '基础点数 · 3 条', value: '3 点' }],
    total: '合计 3 点 × 2 家',
    deltas: [
      { name: '白鹭', char: '白', grad: A2, delta: 9, detail: '自摸 · 3 点 × 2 家' },
      { name: '你', char: '我', grad: A3, delta: -3, me: true, detail: '承担自摸 3 点' },
      { name: '青鸾', char: '青', grad: A1, delta: -3, detail: '承担自摸 3 点' },
    ],
    players: [
      {
        name: '白鹭', char: '白', grad: A2, dealer: false, winner: true,
        hand: ['1万', '1万', '4万', '4万', '3条', '3条', '9条', '9条', '东', '东', '西', '西', '发', '发'],
        melds: [],
      },
      {
        name: '你', char: '我', grad: A3, me: true, dealer: true,
        hand: ['2万', '5万', '8万', '3筒', '6筒', '2条', '5条', '8条', '北', '北', '南'],
        melds: [{ type: 'gang', tile: '中', concealed: true }],
      },
      {
        name: '青鸾', char: '青', grad: A1,
        hand: ['3万', '6万', '9万', '1筒', '4筒', '7筒', '2条', '4条', '6条', '8条', '白', '白', '发'],
        melds: [],
      },
    ],
  },
  {
    time: '昨天 15:20',
    room: '匹配房',
    delta: 0,
    result: 'draw',
    detail: '流局 · 黄庄（留 7 垛）',
    hand: ['1万', '4万', '7万', '2筒', '5筒', '8筒', '3条', '6条', '9条', '东', '南', '西', '北', '中'],
    winTile: '',
    tags: ['流局', '暗杠 ×2'],
    winTag: '流局',
    title: '黄庄',
    round: '东风局 · 牌墙耗尽（留 7 垛）',
    handOwner: '',
    fans: [],
    total: '',
    deltas: [
      { name: '你', char: '我', grad: A3, delta: 0, me: true, detail: '流局 · 黄庄 0 点' },
      { name: '青鸾', char: '青', grad: A1, delta: 0, detail: '流局 · 黄庄 0 点' },
      { name: '白鹭', char: '白', grad: A2, delta: 0, detail: '流局 · 黄庄 0 点' },
    ],
    players: [
      {
        name: '你', char: '我', grad: A3, me: true, dealer: true, winner: false,
        hand: ['1万', '4万', '7万', '2筒', '5筒', '8筒', '3条', '6条', '9条', '南', '西'],
        melds: [
          { type: 'gang', tile: '东', concealed: true },
          { type: 'gang', tile: '北', concealed: true },
        ],
      },
      {
        name: '青鸾', char: '青', grad: A1,
        hand: ['2万', '5万', '8万', '3筒', '6筒', '9筒', '1条', '4条', '7条', '中', '中', '白', '发'],
        melds: [],
      },
      {
        name: '白鹭', char: '白', grad: A2,
        hand: ['3万', '6万', '9万', '1筒', '4筒', '7筒', '2条', '5条', '8条', '东', '东', '南', '发'],
        melds: [],
      },
    ],
  },
];
