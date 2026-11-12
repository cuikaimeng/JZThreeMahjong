/** 引擎单测：1 真人（模拟快速出牌）+ 2 AI，带时间戳 */
import { Table } from '../src/game/table.js';

const room = {
  code: 'test02', mode: '三人经典', laps: 1, password: null, ownerId: 1, status: 'playing',
  players: [
    { userId: 1, nickname: '真人', avatar: 'me', seat: 'me', ready: true, isAI: false },
    { userId: 2, nickname: 'AI乙', avatar: 'qingluan', seat: 'left', ready: true, isAI: true },
    { userId: 3, nickname: 'AI丙', avatar: 'bailu', seat: 'right', ready: true, isAI: true },
  ],
};

let myHand = [];
let mySeat = 'me';
let settled = 0;
const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

const table = new Table(room, (t, d) => {
  if (t === 'settle') {
    settled++;
    console.log(`${ts()} >> settle`, JSON.stringify(d.delta), d.handName);
  } else if (t === 'roundEnd') {
    setTimeout(() => { table.phase = 'settle'; table.startRound(); }, 100);
  } else if (t === 'deal') {
    myHand = d.hands[mySeat];
  } else if (t === 'draw' && d.seat === mySeat && d.tile) {
    myHand.push(d.tile);
  } else if (t === 'discard' && d.seat === mySeat) {
    const i = myHand.indexOf(d.tile);
    if (i >= 0) myHand.splice(i, 1);
  } else if (t === 'offer') {
    console.log(`${ts()} offer -> me: ${d.actions}`);
    setTimeout(() => table.performAction(mySeat, d.actions.includes('hu') ? 'hu' : 'pass'), 100);
  } else if (t === 'action') {
    console.log(`${ts()} action ${d.seat} ${d.type} ${d.tile}`);
    // 同步镜像：自己碰/杠/补杠时从手牌移除
    if (d.seat === mySeat) {
      const n = d.type === 'peng' ? 2 : d.type === 'bugang' ? 1 : d.type === 'gang' ? (d.concealed ? 4 : 3) : 0;
      for (let k = 0; k < n; k++) {
        const i = myHand.indexOf(d.tile);
        if (i >= 0) myHand.splice(i, 1);
      }
    }
  } else if (t === 'listen') {
    console.log(`${ts()} listen ${d.seat}`);
  } else if (t === 'turn') {
    if (d.seat === mySeat) {
      setTimeout(() => {
        if (table.phase === 'play' && table.turn === mySeat && myHand.length) {
          table.discard(mySeat, myHand[0]);
        } else {
          console.log(`${ts()} !! turn skipped phase=${table.phase} turn=${table.turn}`);
        }
      }, 50);
    }
  }
});
room.table = table;
table.startMatch();

setInterval(() => {
  console.log(`${ts()} [beat] phase=${table.phase} turn=${table.turn} wall=${table.wall.length} hand=${myHand.length}`);
}, 15000);

setTimeout(() => {
  console.log(`${ts()} settled: ${settled} phase: ${table.phase}`);
  process.exit(settled >= 1 ? 0 : 1);
}, 100000);
