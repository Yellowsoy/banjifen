'use strict';
/**
 * 黄豆侠 SSO（sso.5166966.xyz）会话校验
 *
 * 本站与登录中心同属 5166966.xyz 主域，中心下发的 sso_token 是
 * Domain=.5166966.xyz 的 HttpOnly Cookie，浏览器访问 bj.5166966.xyz 会自动带上，
 * 因此服务端拿它去 /api/verify-token 换一次身份即可，无需跨域读取。
 */

const DEFAULT_ORIGIN = 'https://sso.5166966.xyz';

function ssoOrigin() {
  const v = process.env.SSO_ORIGIN || '';
  return String(v || DEFAULT_ORIGIN).replace(/\/+$/, '');
}

/**
 * @param {import('express').Request} req
 * @returns {Promise<{ok: boolean, code?: string, user?: {id?: string, email?: string, nickname?: string}}>}
 */
async function verify(req) {
  const token = (req.cookies && req.cookies.sso_token) || '';
  if (!token) return { ok: false, code: 'no_session' };

  try {
    const res = await fetch(`${ssoOrigin()}/api/verify-token`, {
      headers: { cookie: `sso_token=${token}`, accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.valid) {
      return { ok: false, code: (data && data.error) || 'invalid_session' };
    }
    return { ok: true, user: data.user || {}, roles: Array.isArray(data.roles) ? data.roles : [] };
  } catch (err) {
    return { ok: false, code: 'sso_unreachable' };
  }
}

module.exports = { verify, ssoOrigin };
