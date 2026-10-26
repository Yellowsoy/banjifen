'use strict';
/** 超级管理员业务：班级、账号、密码、手机号与归属关系 */
const db = require('../../db');
const { genId } = require('../../config');
const { BusinessError, NotFoundError, ConflictError } = require('../../core/errors');
const { hashPassword } = require('../../core/security');
const { ROLE, ROLE_LABEL } = require('../../core/policy');
const { toCsv } = require('../../core/excel');
const repo = require('./super.repository');
const authRepo = require('../auth/auth.repository');

function audit(actor, action, targetType, targetId, detail = '') {
  repo.writeAudit({
    id: genId('aud'),
    actorId: actor.accountId,
    actorName: actor.name || '超级管理员',
    action,
    targetType,
    targetId,
    detail,
  });
}

function overview() {
  return repo.overview();
}

function listClasses(query) {
  const result = repo.listClasses(query);
  return {
    ...result,
    items: result.items.map((c) => ({ ...c, ownerPhoneMasked: c.ownerPhone || '' })),
  };
}

/** 新建班级：同时创建班主任账号，保证班级一定有负责人 */
function createClass(actor, { name, school = '', grade = '', ownerName, phone = '', username, password }) {
  if (authRepo.findByUsername(username)) throw new ConflictError('该登录账号已存在，请更换');
  const classId = genId('cls');
  const ownerId = genId('own');
  db.transaction(() => {
    repo.insertClass({ id: classId, name, school, grade });
    authRepo.insert({
      id: ownerId,
      type: 'class',
      role: ROLE.OWNER,
      classId,
      username,
      phone,
      name: ownerName || name,
      pwdHash: hashPassword(password),
    });
    repo.updateClass(classId, { ownerId });
  });
  audit(actor, 'class.create', 'class', classId, `新建班级「${name}」，班主任账号 ${username}`);
  return repo.findClass(classId);
}

function updateClass(actor, id, patch) {
  const cls = repo.findClass(id);
  if (!cls) throw new NotFoundError('班级不存在');
  const updated = repo.updateClass(id, patch);
  audit(actor, 'class.update', 'class', id, JSON.stringify(patch));
  return updated;
}

function deleteClass(actor, id, reason = '') {
  const cls = repo.findClass(id);
  if (!cls) throw new NotFoundError('班级不存在');
  repo.softDeleteClass(id, reason);
  audit(actor, 'class.delete', 'class', id, `删除班级「${cls.name}」`);
  return { id };
}

function restoreClass(actor, id) {
  const cls = repo.findClass(id);
  if (!cls) throw new NotFoundError('班级不存在');
  repo.restoreClass(id);
  db.run('UPDATE accounts SET deleted_at = NULL WHERE class_id = ?', [id]);
  audit(actor, 'class.restore', 'class', id, `恢复班级「${cls.name}」`);
  return repo.findClass(id);
}

function createAccount(actor, { classId, role, name, phone = '', username, password, note = '' }) {
  if (![ROLE.OWNER, ROLE.TEACHER, ROLE.CADRE].includes(role)) throw new BusinessError('角色不合法');
  const cls = repo.findClass(classId);
  if (!cls || cls.deletedAt) throw new NotFoundError('班级不存在');
  if (authRepo.findByUsername(username)) throw new ConflictError('该登录账号已存在，请更换');
  if (role === ROLE.OWNER && repo.findOwnerOf(classId)) {
    throw new BusinessError('该班级已有班主任，请使用「转移班主任」或先移除原班主任');
  }
  const accountId = genId(role === ROLE.OWNER ? 'own' : role === ROLE.TEACHER ? 'tea' : 'cad');
  db.transaction(() => {
    authRepo.insert({
      id: accountId,
      type: 'class',
      role,
      classId,
      username,
      phone,
      name,
      pwdHash: hashPassword(password),
      note,
    });
    if (role === ROLE.OWNER) repo.updateClass(classId, { ownerId: accountId });
  });
  audit(actor, 'account.create', 'account', accountId, `在「${cls.name}」创建${ROLE_LABEL[role]} ${name}（${username}）`);
  return authRepo.findById(accountId);
}

/** 更新账号：可改姓名、手机号、登录名、状态、密码，也可调整角色与所属班级 */
function updateAccount(actor, id, patch) {
  const account = repo.findAccount(id);
  if (!account) throw new NotFoundError('账号不存在');
  if (account.role === ROLE.SUPER && patch.role && patch.role !== ROLE.SUPER) {
    throw new BusinessError('不能把超级管理员降级');
  }

  const updates = [];
  const params = [];
  for (const [key, column] of [
    ['name', 'name'],
    ['phone', 'phone'],
    ['note', 'note'],
    ['status', 'status'],
  ]) {
    if (patch[key] !== undefined) {
      updates.push(`${column} = ?`);
      params.push(patch[key]);
    }
  }
  if (patch.username && patch.username !== account.username) {
    if (authRepo.findByUsername(patch.username)) throw new ConflictError('该登录账号已被占用');
    updates.push('username = ?');
    params.push(patch.username);
  }
  if (patch.password) {
    updates.push('pwd_hash = ?');
    params.push(hashPassword(patch.password));
  }

  const nextClassId = patch.classId !== undefined ? patch.classId : account.classId;
  const nextRole = patch.role !== undefined ? patch.role : account.role;

  db.transaction(() => {
    if (updates.length) db.run(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);

    // 归属变更
    if (nextClassId !== account.classId) {
      if (!nextClassId) throw new BusinessError('班级成员必须归属某个班级');
      const cls = repo.findClass(nextClassId);
      if (!cls || cls.deletedAt) throw new NotFoundError('目标班级不存在');
      db.run('UPDATE accounts SET class_id = ? WHERE id = ?', [nextClassId, id]);
      if (account.role === ROLE.OWNER) db.run('UPDATE classes SET owner_id = NULL WHERE id = ?', [account.classId]);
    }

    // 角色变更（班主任唯一性）
    if (nextRole !== account.role) {
      if (nextRole === ROLE.OWNER) {
        const currentOwner = repo.findOwnerOf(nextClassId);
        if (currentOwner && currentOwner.id !== id) {
          db.run("UPDATE accounts SET role = 'teacher' WHERE id = ?", [currentOwner.id]);
        }
        repo.updateClass(nextClassId, { ownerId: id });
      } else if (account.role === ROLE.OWNER) {
        db.run('UPDATE classes SET owner_id = NULL WHERE id = ?', [account.classId]);
      }
      db.run('UPDATE accounts SET role = ? WHERE id = ?', [nextRole, id]);
    }

    if (patch.password || patch.status === 'disabled') authRepo.revokeAllForAccount(id);
  });

  audit(actor, 'account.update', 'account', id, JSON.stringify({ ...patch, password: patch.password ? '已重置' : undefined }));
  return repo.findAccount(id);
}

function deleteAccount(actor, id) {
  const account = repo.findAccount(id);
  if (!account) throw new NotFoundError('账号不存在');
  if (account.role === ROLE.SUPER) throw new BusinessError('超级管理员账号不可删除');
  if (account.role === ROLE.OWNER) throw new BusinessError('请先转移班主任身份，再移除该账号');
  db.transaction(() => {
    db.run('UPDATE accounts SET deleted_at = ? WHERE id = ?', [Date.now(), id]);
    authRepo.revokeAllForAccount(id);
  });
  audit(actor, 'account.delete', 'account', id, `删除账号 ${account.name}（${account.username}）`);
  return { id };
}

function resetPassword(actor, id, password) {
  const account = repo.findAccount(id);
  if (!account) throw new NotFoundError('账号不存在');
  authRepo.updatePassword(id, hashPassword(password));
  authRepo.revokeAllForAccount(id);
  audit(actor, 'account.reset-password', 'account', id, `重置 ${account.name} 的密码`);
  return { ok: true };
}

function transferOwner(actor, classId, memberId) {
  const target = repo.findAccount(memberId);
  if (!target || target.classId !== classId) throw new NotFoundError('目标账号不属于该班级');
  if (target.role === ROLE.OWNER) throw new BusinessError('该账号已经是班主任');
  const currentOwner = repo.findOwnerOf(classId);
  db.transaction(() => {
    if (currentOwner) db.run("UPDATE accounts SET role = 'teacher' WHERE id = ?", [currentOwner.id]);
    db.run("UPDATE accounts SET role = 'owner' WHERE id = ?", [memberId]);
    repo.updateClass(classId, { ownerId: memberId });
  });
  audit(actor, 'class.transfer-owner', 'class', classId, `班主任转移给 ${target.name}`);
  return { ok: true };
}

/* ---- 回收站 ---- */
const TABLES = [
  { key: 'students', table: 'students', columns: ['id', 'class_id', 'name', 'group_name', 'sex', 'position', 'points', 'created_at', 'deleted_at'] },
  { key: 'logs', table: 'point_logs', columns: ['id', 'class_id', 'student_id', 'student_name', 'delta', 'reason', 'kind', 'operator_id', 'operator_name', 'operator_role', 'created_at'] },
  { key: 'gifts', table: 'gifts', columns: ['id', 'class_id', 'name', 'cost', 'icon', 'stock', 'created_at', 'deleted_at'] },
  { key: 'redemptions', table: 'redemptions', columns: ['id', 'class_id', 'gift_id', 'gift_name', 'cost', 'student_id', 'student_name', 'created_at'] },
  { key: 'rules', table: 'quick_rules', columns: ['id', 'class_id', 'name', 'score', 'sort_no', 'created_at'] },
];

function restoreSnapshot(actor, id) {
  const row = repo.findRecycle(id);
  if (!row) throw new NotFoundError('回收站记录不存在');
  if (row.restoredAt) throw new BusinessError('该快照已恢复过');
  const payload = JSON.parse(row.payload || '{}');
  db.transaction(() => {
    for (const { key, table, columns } of TABLES) {
      const rows = payload[key] || [];
      if (!rows.length) continue;
      db.run(`DELETE FROM ${table} WHERE class_id = ?`, [row.classId]);
      for (const item of rows) {
        const placeholders = columns.map(() => '?').join(',');
        db.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`, columns.map((c) => item[c] ?? null));
      }
    }
    if (payload.seat) {
      db.run('DELETE FROM seat_plans WHERE class_id = ?', [row.classId]);
      const seat = payload.seat;
      db.run(
        `INSERT INTO seat_plans (class_id, cols, rows, scheme, seats, angle, confirmed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.classId, seat.cols, seat.rows, seat.scheme, seat.seats, seat.angle, seat.confirmed_at, seat.updated_at]
      );
    }
    repo.markRestored(id);
  });
  audit(actor, 'recycle.restore', 'class', row.classId, `恢复快照 ${row.title || row.kind}`);
  return { ok: true };
}

function classesCsv(query) {
  const { items } = repo.listClasses({ ...query, page: 1, pageSize: 10000 });
  const rows = items.map((c) => [c.name, c.school || '', c.grade || '', c.ownerName || '', c.ownerUsername || '', c.ownerPhone || '', c.memberCount, c.studentCount, c.recordCount]);
  return toCsv(['班级', '学校', '年级', '班主任', '班主任账号', '手机号', '成员数', '学生数', '积分记录'], rows);
}

module.exports = {
  overview,
  listClasses,
  createClass,
  updateClass,
  deleteClass,
  restoreClass,
  createAccount,
  updateAccount,
  deleteAccount,
  resetPassword,
  transferOwner,
  restoreSnapshot,
  classesCsv,
  listAudit: repo.listAudit,
  listRecycle: repo.listRecycle,
  deletedClasses: repo.deletedClasses,
  listAccounts: repo.listAccounts,
};
