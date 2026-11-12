import Main from './js/main.js';
import { preloadTiles } from './js/ui/tileFace.js';
import { initOrientation } from './js/render.js';

// 游戏方向：当前版本锁定竖屏（横屏能力已就绪，待开启时改此处读取存储即可）
initOrientation('portrait');

// 预加载麻将牌面素材，就绪后启动（失败项自动回退矢量牌面）
preloadTiles(() => {
  new Main();
});
