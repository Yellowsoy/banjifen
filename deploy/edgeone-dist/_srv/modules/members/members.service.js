'use strict';
/** 班级成员（老师 / 班干部）管理：仅班主任可用 */
const db = require('../../db');
const { genId } = require('../../config');
const { BusinessError, NotFoundError, ConflictError } = require('../../core/errors');
const { hashPassword } = require('../../core/security');
const { ROLE, ROLE_LABEL } = require('../../core/policy');
const authRepo = require('../auth/auth.repository');

/** 手机号脱敏：班主任只能看到 138****1234，完整号码只有超级管理员可见 */
function maskPhone(phone) {
  if (!phone) return '';
  if (phone.length <= 4) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function listMembers(classId) {
  const rows = db.all(
    `SELECT id, role, username, phone, name, status, created_at AS createdAt, last_login_at AS lastLoginAt, note
     FROM accounts WHERE class_id = ? AND deleted_at IS NULL
     ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END, created_at ASC`,
    [classId]
  );
  return rows.map((row) => ({
    ...row,
    phoneMasked: maskPhone(row.phone),
    roleLabel: ROLE_LABEL[row.role] || row.role,
  }));
}

function createMember(classId, { role, name, phone = '', username, password, note = '' }) {
  if (![ROLE.TEACHER, ROLE.CADRE].includes(role)) {
    throw new BusinessError('只能添加老师或班干部账号');
  }
  if (authRepo.findByUsername(username)) throw new ConflictError('该登录账号已存在，请更换');
  const cls = db.get('SELECT id FROM classes WHERE id = ? AND deleted_at IS NULL', [classId]);
  if (!cls) throw new NotFoundError('班级不存在');
  const account = authRepo.insert({
    id: genId(role === ROLE.CADRE ? 'cad' : 'tea'),
    type: 'class',
    role,
    classId,
    username,
    phone,
    name,
    pwdHash: hashPassword(password),
    note,
  });
  return { ...account, pwdHash: undefined, phoneMasked: maskPhone(account.phone), roleLabel: ROLE_LABEL[role] };
}

function updateMember(classId, memberId, patch) {
  const member = db.get('SELECT id, role, class_id AS classId FROM accounts WHERE id = ? AND deleted_at IS NULL', [memberId]);
  if (!member || member.classId !== classId) throw new NotFoundError('成员不存在');
  if (member.role === ROLE.OWNER) throw new BusinessError('班主任资料请在「班级资料」中修改');
  const fields = [];
  const params = [];
  if (patch.name !== undefined) {
    fields.push('name = ?');
    params.push(patch.name);
  }
  if (patch.phone !== undefined) {
    fields.push('phone = ?');
    params.push(patch.phone);
  }
  if (patch.note !== undefined) {
    fields.push('note = ?');
    params.push(patch.note);
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    params.push(patch.status);
  }
  if (patch.password) {
    fields.push('pwd_hash = ?');
    params.push(hashPassword(patch.password));
    authRepo.revokeAllForAccount(memberId);
  }
  if (fields.length) {
    db.run(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`, [...params, memberId]);
  }
  const row = db.get(
    `SELECT id, role, username, phone, name, status, note FROM accounts WHERE id = ?`,
    [memberId]
  );
  return { ...row, phoneMasked: maskPhone(row.phone), roleLabel: ROLE_LABEL[row.role] };
}

function removeMember(classId, memberId) {
  const member = db.get('SELECT id, role, class_id AS classId, name FROM accounts WHERE id = ? AND deleted_at IS NULL', [memberId]);
  if (!member || member.classId !== classId) throw new NotFoundError('成员不存在');
  if (member.role === ROLE.OWNER) throw new BusinessError('不能移除班主任，请先转移班主任身份');
  db.transaction(() => {
    db.run('UPDATE accounts SET deleted_at = ? WHERE id = ?', [Date.now(), memberId]);
    authRepo.revokeAllForAccount(memberId);
  });
  return { id: memberId };
}

/** 转移班主任：原班主任降为老师，目标成员升为班主任 */
function transferOwner(classId, currentOwnerId, targetId) {
  const target = db.get('SELECT id, role, class_id AS classId FROM accounts WHERE id = ? AND deleted_at IS NULL', [targetId]);
  if (!target || target.classId !== classId) throw new NotFoundError('目标成员不存在');
  if (target.role === ROLE.OWNER) throw new BusinessError('该成员已经是班主任');
  db.transaction(() => {
    db.run("UPDATE accounts SET role = 'teacher' WHERE id = ?", [currentOwnerId]);
    db.run("UPDATE accounts SET role = 'owner' WHERE id = ?", [targetId]);
    db.run('UPDATE classes SET owner_id = ? WHERE id = ?', [targetId, classId]);
  });
  return { ok: true, ownerId: targetId };
}

function updateSettings(classId, { cadreLimitPer, cadreLimitDay }) {
  const fields = [];
  const params = [];
  if (cadreLimitPer !== undefined) {
    fields.push('cadre_limit_per = ?');
    params.push(cadreLimitPer);
  }
  if (cadreLimitDay !== undefined) {
    fields.push('cadre_limit_day = ?');
    params.push(cadreLimitDay);
  }
  if (!fields.length) return { ok: true };
  db.run(`UPDATE classes SET ${fields.join(', ')} WHERE id = ?`, [...params, classId]);
  return db.get('SELECT cadre_limit_per AS cadreLimitPer, cadre_limit_day AS cadreLimitDay FROM classes WHERE id = ?', [classId]);
}

module.exports = { listMembers, createMember, updateMember, removeMember, transferOwner, updateSettings, maskPhone, ROLE };
