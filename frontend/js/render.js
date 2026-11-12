GameGlobal.canvas = wx.createCanvas();

function readWindowInfo() {
  return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
}

const DPR = readWindowInfo().pixelRatio || 1;

/**
 * 屏幕适配方案（竖屏 / 横屏，由设置项控制，不随重力感应）
 *
 * game.json 锁定 deviceOrientation: portrait；横屏为"软件横屏"：
 * 画布内容旋转 90° 绘制，玩家横持手机即为横向画面。
 *
 * - 竖屏模式：SCREEN_* / GAME_* = 物理尺寸，各页面按 380 宽设计稿等比绘制
 * - 横屏模式：
 *   · 对局页（game）：虚拟视口 812×375，使用对局横向重排布局（gameScene.buildLayout）
 *   · 其他页面：虚拟视口内"居中竖幅"（等比缩小的 375×812 区域），场景代码零改动
 *
 * SCREEN_WIDTH / SCREEN_HEIGHT / GAME_WIDTH / GAME_HEIGHT 为可变量（ESM live binding）。
 */
export let PHYS_WIDTH = 0; // 物理宽（竖屏锁定，恒为竖屏尺寸）
export let PHYS_HEIGHT = 0; // 物理高
export let SCREEN_WIDTH = 0; // 竖幅场景绘制视口宽
export let SCREEN_HEIGHT = 0; // 竖幅场景绘制视口高
export let GAME_WIDTH = 0; // 对局页绘制视口宽
export let GAME_HEIGHT = 0; // 对局页绘制视口高
export let STATUS_BAR_HEIGHT = 24;
export let SAFE_BOTTOM = 0;
export let isLandscape = false;
export let orientationMode = 'portrait'; // 'portrait' | 'landscape'（设置项）

let frameOffsetX = 0; // 横屏竖幅横向偏移（竖幅坐标系内居中）

const canvas = GameGlobal.canvas;
export const ctx = canvas.getContext('2d');

function applyViewport() {
  const info = readWindowInfo();
  PHYS_WIDTH = info.screenWidth;
  PHYS_HEIGHT = info.screenHeight;
  isLandscape = orientationMode === 'landscape';

  canvas.width = PHYS_WIDTH * DPR;
  canvas.height = PHYS_HEIGHT * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  if (isLandscape) {
    // 软件横屏：物理 375×812 → 对局虚拟视口 812×375（旋转 90°）
    GAME_WIDTH = PHYS_HEIGHT;
    GAME_HEIGHT = PHYS_WIDTH;
    // 非对局页面竖幅：375 设计稿宽按对局视口高等比缩放后横向居中
    SCREEN_WIDTH = Math.round((375 * GAME_HEIGHT) / 812);
    SCREEN_HEIGHT = GAME_HEIGHT;
    frameOffsetX = (GAME_WIDTH - SCREEN_WIDTH) / 2;
    STATUS_BAR_HEIGHT = 0; // 横屏顶部无状态栏
    SAFE_BOTTOM = 0;
  } else {
    SCREEN_WIDTH = PHYS_WIDTH;
    SCREEN_HEIGHT = PHYS_HEIGHT;
    GAME_WIDTH = PHYS_WIDTH;
    GAME_HEIGHT = PHYS_HEIGHT;
    frameOffsetX = 0;
    STATUS_BAR_HEIGHT = info.statusBarHeight || 24;
    SAFE_BOTTOM = info.safeArea
      ? Math.max(0, PHYS_HEIGHT - info.safeArea.bottom)
      : 0;
  }
}

applyViewport();

/** 启动时按设置初始化方向（'portrait' | 'landscape'），重启游戏生效 */
export function initOrientation(mode) {
  orientationMode = mode === 'landscape' ? 'landscape' : 'portrait';
  applyViewport();
}

/** UI 缩放系数：竖屏与横屏竖幅场景通用（对局页横屏自行覆盖） */
export function uiScale() {
  return SCREEN_WIDTH / 380;
}

/** 每帧绘制前：横屏模式先旋转画布（对局页到此为止） */
export function applyRotationTransform(c) {
  if (!isLandscape) return false;
  c.translate(PHYS_WIDTH, 0);
  c.rotate(Math.PI / 2);
  return true;
}

/** 非对局场景在横屏下的居中竖幅变换（须在旋转变换之后应用） */
export function applyFrameTransform(c) {
  if (!isLandscape) return false;
  c.translate(frameOffsetX, 0);
  return true;
}

/** 恢复物理坐标变换 */
export function resetFrameTransform(c) {
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
}

/**
 * 物理坐标 → 虚拟视口坐标（触摸命中用）
 * @param inGame 当前场景是否为对局页（对局页只需逆旋转，无竖幅）
 */
export function toVirtualPoint(x, y, inGame) {
  if (!isLandscape) return { x, y };
  // 逆旋转：虚拟 (vx,vy) → 物理 (375-vy, vx)
  let vx = y;
  let vy = PHYS_WIDTH - x;
  if (!inGame) {
    vx -= frameOffsetX;
  }
  return { x: vx, y: vy };
}

/* ---------- 物理屏幕变化（真机旋转被锁定，一般不触发） ---------- */

const viewportHandlers = [];

export function onViewportChange(cb) {
  viewportHandlers.push(cb);
}

if (wx.onWindowResize) {
  wx.onWindowResize(() => {
    applyViewport();
    viewportHandlers.forEach((cb) => cb(isLandscape));
  });
}
