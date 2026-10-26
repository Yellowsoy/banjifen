'use strict';
const { parse, schemas } = require('../../core/validation');
const { asyncHandler } = require('../../middleware/error');
const { config } = require('../../config');
const { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions } = require('../../core/security');
const service = require('./auth.service');

function setAuthCookies(res, result) {
  res.cookie(ACCESS_COOKIE, result.accessToken, cookieOptions(config.accessTokenTtl));
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(config.refreshTokenTtl, '/api/auth'));
}

function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

function present(res, result) {
  setAuthCookies(res, result);
  const { accessToken, refreshToken, ...rest } = result;
  return res.json(rest);
}

const login = asyncHandler(async (req, res) => {
  const body = parse(schemas.login, req.body);
  const result = service.login({ ...body, userAgent: req.get('user-agent') || '' });
  req.log.info('登录成功', { accountId: result.account.id, role: result.account.role });
  return present(res, result);
});

const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies[REFRESH_COOKIE];
  const result = service.refresh(token, req.get('user-agent') || '');
  return present(res, result);
});

const logout = asyncHandler(async (req, res) => {
  if (req.auth) service.logout(req.auth.sessionId);
  clearAuthCookies(res);
  res.json({ ok: true });
});

const me = asyncHandler(async (req, res) => {
  res.json(service.profileOf(req.auth.accountId));
});

const changePassword = asyncHandler(async (req, res) => {
  const body = parse(schemas.changePassword, req.body);
  service.changePassword(req.auth.accountId, body);
  clearAuthCookies(res);
  res.json({ ok: true, message: '密码已修改，请重新登录' });
});

module.exports = { login, refresh, logout, me, changePassword };
