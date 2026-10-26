/**
 * EdgeOne 云函数入口：/api/* 的所有请求都进入这个 Express 应用。
 * 由 scripts/build-edgeone.mjs 生成，请勿手工编辑。
 */
import '../../_srv/edge-env.js';
import { createEdgeApp } from '../../_srv/edge-entry.js';

const app = createEdgeApp();

export default app;
