'use strict';
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { config } = require('./config');
const { requestContext } = require('./middleware/context');
const { notFound, errorHandler } = require('./middleware/error');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

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

  app.use(notFound);

  // 前端为单页应用：非 /api 的 GET 请求回退到 index.html
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
