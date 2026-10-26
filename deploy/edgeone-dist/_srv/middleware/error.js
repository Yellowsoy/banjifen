'use strict';
const { AppError } = require('../core/errors');
const { config } = require('../config');

function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' }, requestId: req.id });
  }
  return next();
}

/** 全局错误处理：客户端只看到规范化结构，堆栈只进日志 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isKnown = err instanceof AppError;
  const status = isKnown ? err.status : 500;
  if (!isKnown) {
    (req.log || console).error('unhandled error', { err: err.message, stack: err.stack });
  } else if (status >= 500) {
    (req.log || console).error('app error', { err: err.message, code: err.code });
  }
  const body = {
    error: {
      code: isKnown ? err.code : 'INTERNAL_ERROR',
      message: isKnown ? err.message : '服务器开小差了，请稍后再试',
      ...(isKnown && err.details ? { details: err.details } : {}),
    },
    requestId: req.id,
  };
  if (!config.isProd && !isKnown) body.error.debug = err.message;
  res.status(status).json(body);
}

/** 异步控制器包装，避免每个 handler 写 try/catch */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { notFound, errorHandler, asyncHandler };
