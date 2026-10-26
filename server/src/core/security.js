'use strict';
/** 密码哈希、令牌签发与校验 */
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { config } = require('../config');

const ACCESS_COOKIE = 'bj_at';
const REFRESH_COOKIE = 'bj_rt';
const CSRF_HEADER = 'x-requested-with';

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

function signAccessToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.accessTokenTtl, algorithm: 'HS256' });
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function cookieOptions(maxAgeSeconds, path = '/') {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path,
    maxAge: maxAgeSeconds * 1000,
  };
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_HEADER,
  hashPassword,
  verifyPassword,
  signAccessToken,
  verifyAccessToken,
  randomToken,
  sha256,
  cookieOptions,
};
