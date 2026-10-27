/*
 * Copyright 2026 Yellowsoy (banjifen contributors)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { config } = require('./config');
const { requestContext } = require('./middleware/context');
const { notFound, errorHandler } = require('./middleware/error');

function createApp({ pre = [], spaFallback } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // EdgeOne 云函数等环境：先完成异步引导（数据库加载/多实例同步），再进入后续中间件
  for (const mw of pre) app.use(mw);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        'img-src \'self\' data: blob:',
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
      ].join('; ')
    );
    if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  if (config.corsOrigin.length) {
    app.use((req, res, next) => {
      const origin = req.get('origin');
      if (origin && config.corsOrigin.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'content-type,x-requested-with');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      return next();
    });
  }

  app.use(requestContext);
  app.use(express.json({ limit: '6mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', index: false }));
  app.use(express.static(config.publicDir, { maxAge: config.isProd ? '1h' : 0, index: 'index.html' }));

  app.use('/api/auth', require('./modules/auth/auth.routes'));
  app.use('/api/class', require('./modules/class/class.routes'));
  app.use('/api/members', require('./modules/members/members.routes'));
  app.use('/api/super', require('./modules/super/super.routes'));
  app.use('/api/public', require('./modules/public/public.routes'));

  app.get('/health', (req, res) => res.json({ ok: true, version: config.version }));
  app.get('/ready', (req, res) => {
    try {
      require('./db').get('SELECT 1 AS ok');
      res.json({ ready: true });
    } catch {
      res.status(503).json({ ready: false });
    }
  });

  // 云函数环境：平台会对 /api/* 剥前缀再回调本函数，故这里同时注册带 /api 前缀的路由
  app.get('/api/ready', (req, res) => {
    try {
      require('./db').get('SELECT 1 AS ok');
      res.json({ ready: true });
    } catch {
      res.status(503).json({ ready: false });
    }
  });

  // 预热端点：被 edgeone.json 的 schedules 定时触发，经由 edge-entry 的 gate 完成数据库引导，
  // 使云函数实例保持 warm，规避冷启动首请求超时（500/502）。免费额度内（每分钟级调用远小于 1M/月）。
  app.get('/api/cron/warmup', (req, res) => {
    res.json({ ok: true, warmed: true, time: Date.now() });
  });

  app.use(notFound);

  // 前端为单页应用：非 /api 的 GET 请求回退到 index.html
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    if (spaFallback) return spaFallback(req, res);
    return res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
