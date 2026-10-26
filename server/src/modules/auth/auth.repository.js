'use strict';
const db = require('../../db');
const { genId } = require('../../config');

const ACCOUNT_FIELDS = `id, type, role, class_id AS classId, username, phone, name,
  pwd_hash AS pwdHash, status, created_at AS createdAt, last_login_at AS lastLoginAt,
  note, deleted_at AS deletedAt`;

function findByUsername(username) {
  return db.get(`SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE username = ?`, [username]);
}

function findById(id) {
  return db.get(`SELECT ${ACCOUNT_FIELDS} FROM accounts WHERE id = ?`, [id]);
}

function insert(account) {
  db.run(
    `INSERT INTO accounts (id, type, role, class_id, username, phone, name, pwd_hash, status, created_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      account.id,
      account.type,
      account.role,
      account.classId || null,
      account.username,
      account.phone || '',
      account.name,
      account.pwdHash,
      account.createdAt || Date.now(),
      account.note || null,
    ]
  );
  return findById(account.id);
}

function updatePassword(id, pwdHash) {
  db.run('UPDATE accounts SET pwd_hash = ? WHERE id = ?', [pwdHash, id]);
}

function touchLogin(id) {
  db.run('UPDATE accounts SET last_login_at = ? WHERE id = ?', [Date.now(), id]);
}

function createSession(session) {
  db.run(
    `INSERT INTO auth_sessions (id, account_id, token_hash, role, class_id, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [session.id, session.accountId, session.tokenHash, session.role, session.classId || null, session.createdAt, session.expiresAt, session.userAgent || '']
  );
}

function findSessionByHash(tokenHash) {
  return db.get(
    `SELECT id, account_id AS accountId, role, class_id AS classId, expires_at AS expiresAt, revoked_at AS revokedAt
     FROM auth_sessions WHERE token_hash = ?`,
    [tokenHash]
  );
}

function revokeSession(id) {
  db.run('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [Date.now(), id]);
}

function revokeAllForAccount(accountId) {
  db.run('UPDATE auth_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL', [Date.now(), accountId]);
}

function revokeAllForClass(classId) {
  db.run('UPDATE auth_sessions SET revoked_at = ? WHERE class_id = ? AND revoked_at IS NULL', [Date.now(), classId]);
}

function newId(prefix) {
  return genId(prefix);
}

module.exports = {
  ACCOUNT_FIELDS,
  findByUsername,
  findById,
  insert,
  updatePassword,
  touchLogin,
  createSession,
  findSessionByHash,
  revokeSession,
  revokeAllForAccount,
  revokeAllForClass,
  newId,
};
