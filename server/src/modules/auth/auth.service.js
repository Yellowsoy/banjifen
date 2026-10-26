'use strict';
const { BusinessError, UnauthorizedError, NotFoundError } = require('../../core/errors');
const { hashPassword, verifyPassword, signAccessToken, randomToken, sha256 } = require('../../core/security');
const { config } = require('../../config');
const { ROLE, ROLE_LABEL, capabilitiesOf } = require('../../core/policy');
const repo = require('./auth.repository');
const db = require('../../db');

function publicAccount(account) {
  if (!account) return null;
  const { pwdHash, ...rest } = account;
  return { ...rest, roleLabel: ROLE_LABEL[rest.role] || rest.role };
}

function classInfo(classId) {
  if (!classId) return null;
  const row = db.get(
    `SELECT id, name, school, grade, badge, owner_id AS ownerId,
            cadre_limit_per AS cadreLimitPer, cadre_limit_day AS cadreLimitDay, created_at AS createdAt
     FROM classes WHERE id = ?`,
    [classId]
  );
  if (!row) return null;
  return {
    ...row,
    studentCount: db.count('SELECT COUNT(*) FROM students WHERE class_id = ? AND deleted_at IS NULL', [classId]),
    memberCount: db.count('SELECT COUNT(*) FROM accounts WHERE class_id = ? AND deleted_at IS NULL', [classId]),
  };
}

function issueSession(account, { userAgent = '' } = {}) {
  const sessionId = repo.newId('sess');
  const refreshToken = randomToken();
  const now = Date.now();
  repo.createSession({
    id: sessionId,
    accountId: account.id,
    tokenHash: sha256(refreshToken),
    role: account.role,
    classId: account.classId,
    createdAt: now,
    expiresAt: now + config.refreshTokenTtl * 1000,
    userAgent,
  });
  const accessToken = signAccessToken({
    sub: account.id,
    role: account.role,
    classId: account.classId || null,
    sid: sessionId,
  });
  return { accessToken, refreshToken, sessionId };
}

function buildProfile(account) {
  return {
    account: publicAccount(account),
    class: classInfo(account.classId),
    capabilities: capabilitiesOf(account.role),
  };
}

function assertUsable(account) {
  if (!account) throw new BusinessError('账号不存在，请联系管理员', 'ACCOUNT_NOT_FOUND');
  if (account.deletedAt) throw new BusinessError('该账号已被删除，请联系超级管理员', 'ACCOUNT_DELETED');
  if (account.status === 'disabled') throw new BusinessError('该账号已被停用，请联系超级管理员', 'ACCOUNT_DISABLED');
}

/**
 * 登录
 * @param {{username:string,password:string,entry?:string}} input
 *   entry 已废弃：登录入口统一为一个，角色以后端账号数据为准，前端按返回角色自动分流
 */
function login({ username, password, entry = 'class', userAgent = '' }) {
  const account = repo.findByUsername(username);
  if (!account) {
    throw new BusinessError(entry === 'super' ? '超级管理员账号不存在' : '账号不存在，请联系班主任或超级管理员', 'ACCOUNT_NOT_FOUND');
  }
  assertUsable(account);
  if (!verifyPassword(password, account.pwdHash)) {
    throw new BusinessError('密码错误', 'BAD_PASSWORD');
  }
  if (account.classId) {
    const cls = db.get('SELECT id, deleted_at AS deletedAt FROM classes WHERE id = ?', [account.classId]);
    if (!cls || cls.deletedAt) throw new BusinessError('所属班级已被删除，请联系超级管理员', 'CLASS_DELETED');
  }
  repo.touchLogin(account.id);
  const tokens = issueSession(account, { userAgent });
  return { ...buildProfile(account), ...tokens };
}

function refresh(refreshToken, userAgent = '') {
  if (!refreshToken) throw new UnauthorizedError('登录已失效，请重新登录');
  const session = repo.findSessionByHash(sha256(refreshToken));
  if (!session || session.revokedAt || session.expiresAt < Date.now()) {
    throw new UnauthorizedError('登录已失效，请重新登录');
  }
  const account = repo.findById(session.accountId);
  assertUsable(account);
  repo.revokeSession(session.id);
  const tokens = issueSession(account, { userAgent });
  return { ...buildProfile(account), ...tokens };
}

function logout(sessionId) {
  if (sessionId) repo.revokeSession(sessionId);
}

function profileOf(accountId) {
  const account = repo.findById(accountId);
  if (!account) throw new NotFoundError('账号不存在');
  return buildProfile(account);
}

function changePassword(accountId, { oldPassword, newPassword }) {
  const account = repo.findById(accountId);
  if (!account) throw new NotFoundError('账号不存在');
  if (!verifyPassword(oldPassword, account.pwdHash)) throw new BusinessError('当前密码不正确', 'BAD_PASSWORD');
  if (verifyPassword(newPassword, account.pwdHash)) throw new BusinessError('新密码不能与当前密码相同', 'SAME_PASSWORD');
  repo.updatePassword(accountId, hashPassword(newPassword));
  repo.revokeAllForAccount(accountId);
}

module.exports = {
  login,
  refresh,
  logout,
  profileOf,
  changePassword,
  buildProfile,
  classInfo,
  publicAccount,
};
