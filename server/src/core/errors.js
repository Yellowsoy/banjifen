'use strict';
/** 业务错误体系：所有可预期的失败都用 AppError 子类表达，控制器无需拼装错误响应 */

class AppError extends Error {
  constructor(message, { status = 400, code = 'BAD_REQUEST', details = null, expose = true } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }
}

class ValidationError extends AppError {
  constructor(message = '请求参数不合法', details = null) {
    super(message, { status: 422, code: 'VALIDATION_ERROR', details });
  }
}

class UnauthorizedError extends AppError {
  constructor(message = '登录已失效，请重新登录') {
    super(message, { status: 401, code: 'UNAUTHORIZED' });
  }
}

class ForbiddenError extends AppError {
  constructor(message = '没有权限执行该操作') {
    super(message, { status: 403, code: 'FORBIDDEN' });
  }
}

class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super(message, { status: 404, code: 'NOT_FOUND' });
  }
}

class ConflictError extends AppError {
  constructor(message = '数据冲突') {
    super(message, { status: 409, code: 'CONFLICT' });
  }
}

class BusinessError extends AppError {
  constructor(message, code = 'BUSINESS_ERROR') {
    super(message, { status: 400, code });
  }
}

class RateLimitError extends AppError {
  constructor(message = '操作过于频繁，请稍后再试') {
    super(message, { status: 429, code: 'RATE_LIMITED' });
  }
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  BusinessError,
  RateLimitError,
};
