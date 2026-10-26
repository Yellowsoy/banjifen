'use strict';
const { UnauthorizedError, ForbiddenError } = require('../core/errors');
const { can } = require('../core/policy');
const { ACCESS_COOKIE, CSRF_HEADER, verifyAccessToken } = require('../core/security');

function readAuth(req) {
  const token = req.cookies[ACCESS_COOKIE];
  if (!token) return null;
  const payload = verifyAccessToken(token);
  if (!payload) return null;
  const account = require('../db').get('SELECT name, role, class_id AS classId FROM accounts WHERE id = ?', [payload.sub]);
  if (!account) return null;
  return {
    accountId: payload.sub,
    name: account.name,
    role: account.role,
    classId: account.classId || null,
    sessionId: payload.sid,
  };
}

/** 依次校验：CSRF 头 → 登录态 → 角色白名单 */
function requireAuth(...roles) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.get(CSRF_HEADER)) {
      return next(new ForbiddenError('缺少必要的请求头，请求被拒绝'));
    }
    const auth = readAuth(req);
    if (!auth) return next(new UnauthorizedError());
    req.auth = auth;
    if (roles.length && !roles.includes(auth.role)) return next(new ForbiddenError());
    return next();
  };
}

/** 按能力校验（策略集中在 core/policy.js，路由只声明需要什么能力） */
function requireCap(capability) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.get(CSRF_HEADER)) {
      return next(new ForbiddenError('缺少必要的请求头，请求被拒绝'));
    }
    const auth = req.auth || readAuth(req);
    if (!auth) return next(new UnauthorizedError());
    req.auth = auth;
    if (!can(auth.role, capability)) {
      return next(new ForbiddenError('当前角色没有该操作权限'));
    }
    return next();
  };
}

/** 班级成员必须具备 classId（超管没有） */
function requireClass(req, res, next) {
  if (!req.auth || !req.auth.classId) return next(new ForbiddenError('当前账号未绑定班级'));
  return next();
}

function optionalAuth(req, res, next) {
  const auth = readAuth(req);
  if (auth) req.auth = auth;
  next();
}

module.exports = { requireAuth, requireCap, requireClass, optionalAuth };
