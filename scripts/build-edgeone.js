'use strict';
/**
 * 构建 EdgeOne Pages 部署产物：deploy/edgeone-dist/
 *   ├─ index.html / css/ / js/      静态前端（平台直接托管）
 *   ├─ package.json                 平台据此安装依赖后打包云函数
 *   ├─ cloud-functions/api/[[default]].js   /api/* 全部路由到 Express 云函数
 *   └─ _srv/                        服务端源码（被打包进云函数）
 * 用法：node scripts/build-edgeone.mjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'deploy/edgeone-dist');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

rmrf(DIST);

// 1. 静态前端
copyDir(path.join(ROOT, 'public'), DIST);

// 2. 服务端源码（供云函数打包引用）
copyDir(path.join(ROOT, 'server/src'), path.join(DIST, '_srv'));

// 2.1 许可证文件随产物一起分发（Apache-2.0 §4 要求分发时携带许可与声明）
for (const licFile of ['LICENSE', 'NOTICE']) {
  const src = path.join(ROOT, licFile);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, licFile));
}

// 3. 云函数入口：/api/* → Express 应用
const FN_DIR = path.join(DIST, 'cloud-functions/api');
fs.mkdirSync(FN_DIR, { recursive: true });
fs.writeFileSync(
  path.join(FN_DIR, '[[default]].js'),
  `/**
 * EdgeOne 云函数入口：/api/* 的所有请求都进入这个 Express 应用。
 * 由 scripts/build-edgeone.mjs 生成，请勿手工编辑。
 */
import '../../_srv/edge-env.js';
import { createEdgeApp } from '../../_srv/edge-entry.js';

const app = createEdgeApp();

export default app;
`
);

// 4. 依赖清单（平台安装后打包）
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const distPkg = {
  name: 'banjifen-edgeone',
  private: true,
  dependencies: {
    ...pkg.dependencies,
    '@edgeone/pages-blob': '^0.0.18',
  },
};
fs.writeFileSync(path.join(DIST, 'package.json'), `${JSON.stringify(distPkg, null, 2)}\n`);

const files = [];
(function walk(p) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name);
    if (e.isDirectory()) walk(full);
    else files.push(path.relative(DIST, full));
  }
})(DIST);
console.log(`构建完成：${DIST}（${files.length} 个文件）`);
