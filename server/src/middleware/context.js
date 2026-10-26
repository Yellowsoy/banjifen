'use strict';
const crypto = require('node:crypto');
const { logger } = require('../core/logger');

/** 为每个请求分配 requestId，并记录访问日志（含耗时、状态码） */
function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && incoming.length <= 64 ? incoming : crypto.randomUUID();
  req.log = logger.child({ requestId: req.id, method: req.method, path: req.path });
  res.setHeader('x-request-id', req.id);
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : 'info';
    req.log[level]('http', {
      status: res.statusCode,
      ms: Number(ms.toFixed(1)),
      ip: req.ip,
      accountId: req.auth && req.auth.accountId,
    });
  });
  next();
}

module.exports = { requestContext };
