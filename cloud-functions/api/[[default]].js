/**
 * EdgeOne 云函数入口：/api/* 的所有请求都进入这个 Express 应用。
 * （GitHub 流水线构建要求 cloud-functions/ 位于仓库根目录；CLI 直传使用 deploy/edgeone-dist 内的副本）
 */
import '../../server/src/edge-env.js';
import { createEdgeApp } from '../../server/src/edge-entry.js';

const app = createEdgeApp();

export default app;
