'use strict';
/**
 * EdgeOne Pages 云函数入口（由构建脚本复制到 deploy/edgeone-dist/_srv/，
 * 再由 cloud-functions/api/[[default]].js 静态引入并打包）。
 *
 * 运行模型：
 * - express 应用同步创建并导出（平台要求），异步引导放在第一个中间件（gate）里
 * - gate：等待数据库就绪 → 检查远端是否有更新快照（多实例同步）→ 响应结束后异步持久化
 * - 持久化：EO_PERSIST=blob，整库快照写入 Pages Blob（强一致），串行化防并发覆盖
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');
const { config } = require('./config');
const { logger } = require('./core/logger');
const { runSeed } = require('./seed');
const { createApp } = require('./app');

const log = logger.child({ scope: 'edge' });
const BLOB_META_KEY = 'bj/db/meta';

let indexHtmlCache = null;
function getIndexHtml() {
  if (indexHtmlCache === null) {
    try {
      indexHtmlCache = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    } catch {
      indexHtmlCache = '<!doctype html><meta charset="utf-8">前端资源缺失，请重新部署';
    }
  }
  return indexHtmlCache;
}

/** 从 Blob 恢复/生成 JWT 密钥，保证多实例与冷启动之间签名一致 */
async function ensureJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) return;
  try {
    const { getStore } = require('@edgeone/pages-blob');
    const store = getStore({ name: 'banjifen', consistency: 'strong' });
    let secret = await store.get('bj/config/jwt-secret', { consistency: 'strong' });
    if (!secret || secret.length < 32) {
      secret = crypto.randomBytes(36).toString('base64url');
      await store.set('bj/config/jwt-secret', secret);
    }
    config.jwtSecret = secret;
  } catch (err) {
    log.warn('JWT 密钥读取失败，回退到进程内随机密钥（重启后登录态会失效）', { err: err.message });
    config.jwtSecret = config.jwtSecret || crypto.randomBytes(36).toString('base64url');
  }
}

let bootstrapPromise = null;
function bootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await db.init();
      if (!db.hasStoredData()) {
        log.info('空库：写入种子数据');
        runSeed({ silent: true });
      }
      await ensureJwtSecret();
      await db.persistIfDirty();
      log.info('EdgeOne 引导完成');
    })().catch((err) => {
      bootstrapPromise = null;
      throw err;
    });
  }
  return bootstrapPromise;
}

const FRESH_TTL_MS = 2000;
let lastFreshCheck = 0;

async function gate(req, res, next) {
  try {
    await bootstrap();
    // 多实例同步：别的实例可能刚写过快照
    const now = Date.now();
    if (now - lastFreshCheck > FRESH_TTL_MS) {
      lastFreshCheck = now;
      await db.refreshIfRemoteNewer();
    }
    // 响应结束后把本请求产生的变更异步写入远端
    res.on('finish', () => {
      db.persistIfDirty().catch((err) => log.error('持久化失败', { err: err.message }));
    });
    next();
  } catch (err) {
    next(err);
  }
}

function createEdgeApp() {
  return createApp({
    pre: [
      // 平台把 /api/* 路由到 cloud-functions/api/[[default]].js 时会剥掉 /api 前缀，这里统一还原
      (req, res, next) => {
        if (req.path === '/health') return next();
        // 平台已剥掉 /api 前缀的普通请求补回；定时触发器(cron)直接带 /api 前缀，避免重复拼接
        if (!req.path.startsWith('/api')) req.url = `/api${req.url}`;
        next();
      },
      gate,
    ],
    spaFallback: (req, res) => res.type('html').send(getIndexHtml()),
  });
}

module.exports = { createEdgeApp, bootstrap, BLOB_META_KEY };
