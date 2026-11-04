'use strict';
const { parse, schemas } = require('../../core/validation');
const { asyncHandler } = require('../../middleware/error');
const { config } = require('../../config');
const { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions } = require('../../core/security');
const service = require('./auth.service');
const sso = require('./auth.sso');

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

/**
 * GET /api/auth/sso —— 统一身份认证回调
 * 浏览器从登录中心跳回来，带着 sso_token Cookie；校验通过后直接下发本站会话并跳首页。
 * 失败一律 302 回登录页并带 sso_error，避免用户停在空白 JSON 上。
 */
const ssoLogin = asyncHandler(async (req, res) => {
  const backToLogin = (msg) => res.redirect(302, `/login.html?sso_error=${encodeURIComponent(msg)}`);

  const r = await sso.verify(req);
  if (!r.ok) {
    const msg =
      r.code === 'no_session'
        ? '尚未通过统一身份认证'
        : r.code === 'sso_unreachable'
          ? '无法连接登录中心，请稍后重试'
          : '统一身份认证会话已失效，请重新登录';
    return backToLogin(msg);
  }

  // 站点管理员身份由 SSO 统一授予：内置全局 admin，或本站专属 admin-bj
  const roles = Array.isArray(r.roles) ? r.roles : [];
  if (!roles.includes('admin') && !roles.includes('admin-bj')) {
    return backToLogin('该账号没有本站管理员权限，请联系管理员在统一管理后台授予 admin 或 admin-bj 角色');
  }

  let result;
  try {
    result = service.loginBySsoEmail({
      email: r.user && r.user.email,
      userAgent: req.get('user-agent') || '',
    });
  } catch (err) {
    return backToLogin((err && err.message) || '登录失败，请稍后重试');
  }

  setAuthCookies(res, result);
  req.log.info('统一身份认证登录成功', { accountId: result.account.id, matchedBy: result.matchedBy });
  const { accessToken, refreshToken, matchedBy, ...rest } = result;
  return res.redirect(302, '/');
});

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

module.exports = { login, ssoLogin, refresh, logout, me, changePassword };
