/**
 * 网络配置（兼容入口，业务代码继续从这里取 API_BASE / WS_URL）
 *
 * 实际地址由 ./env.js 按运行环境选择：
 *   DEV  ：http://localhost:3000 + ws://localhost:3000/ws
 *   PROD ：https://<PROD_DOMAIN> + wss://<PROD_DOMAIN>/ws
 *
 * 部署时只需修改 env.js 顶部的 PROD_DOMAIN，并在微信公众平台配置
 * request / socket / downloadFile 合法域名。开发者工具本地联调仍需
 * 勾选「不校验合法域名」。
 */
import { ENDPOINTS } from './env.js';

export const API_BASE = ENDPOINTS.API_BASE;
export const WS_URL = ENDPOINTS.WS_URL;

export { PROD_DOMAIN, DEV_ENDPOINTS, PROD_ENDPOINTS, CURRENT_ENV, ENV_OVERRIDE } from './env.js';

