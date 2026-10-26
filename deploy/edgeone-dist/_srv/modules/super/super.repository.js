'use strict';
/** 超级管理员的跨班级查询 */
const db = require('../../db');

function overview() {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  return {
    classes: db.count('SELECT COUNT(*) FROM classes WHERE deleted_at IS NULL'),
    accounts: db.count('SELECT COUNT(*) FROM accounts WHERE deleted_at IS NULL'),
    owners: db.count("SELECT COUNT(*) FROM accounts WHERE role = 'owner' AND deleted_at IS NULL"),
    teachers: db.count("SELECT COUNT(*) FROM accounts WHERE role = 'teacher' AND deleted_at IS NULL"),
    cadres: db.count("SELECT COUNT(*) FROM accounts WHERE role = 'cadre' AND deleted_at IS NULL"),
    students: db.count('SELECT COUNT(*) FROM students WHERE deleted_at IS NULL'),
    records: db.count('SELECT COUNT(*) FROM point_logs'),
    activeWeek: db.count('SELECT COUNT(*) FROM accounts WHERE last_login_at >= ? AND deleted_at IS NULL', [now - 7 * day]),
    newClassesWeek: db.count('SELECT COUNT(*) FROM classes WHERE created_at >= ? AND deleted_at IS NULL', [now - 7 * day]),
  };
}

function listClasses({ search = '', page = 1, pageSize = 10 } = {}) {
  const where = ['c.deleted_at IS NULL'];
  const params = [];
  if (search) {
    where.push('(c.name LIKE ? OR c.school LIKE ? OR c.grade LIKE ? OR EXISTS (SELECT 1 FROM accounts o WHERE o.class_id = c.id AND o.role = \'owner\' AND (o.name LIKE ? OR o.username LIKE ? OR o.phone LIKE ?)))');
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like);
  }
  const clause = where.join(' AND ');
  const total = db.count(`SELECT COUNT(*) FROM classes c WHERE ${clause}`, params);
  const items = db.all(
    `SELECT c.id, c.name, c.school, c.grade, c.badge, c.owner_id AS ownerId, c.created_at AS createdAt,
            c.cadre_limit_per AS cadreLimitPer, c.cadre_limit_day AS cadreLimitDay,
            (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.deleted_at IS NULL) AS studentCount,
            (SELECT COUNT(*) FROM accounts a WHERE a.class_id = c.id AND a.deleted_at IS NULL) AS memberCount,
            (SELECT COUNT(*) FROM point_logs l WHERE l.class_id = c.id) AS recordCount,
            o.name AS ownerName, o.username AS ownerUsername, o.phone AS ownerPhone
     FROM classes c LEFT JOIN accounts o ON o.id = c.owner_id
     WHERE ${clause} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { items, total, page, pageSize };
}

function findClass(id) {
  return db.get(
    `SELECT id, name, school, grade, badge, owner_id AS ownerId, created_at AS createdAt,
            cadre_limit_per AS cadreLimitPer, cadre_limit_day AS cadreLimitDay, deleted_at AS deletedAt
     FROM classes WHERE id = ?`,
    [id]
  );
}

function insertClass(row) {
  db.run(
    `INSERT INTO classes (id, name, school, grade, badge, owner_id, created_at)
     VALUES (?, ?, ?, ?, '', ?, ?)`,
    [row.id, row.name, row.school || '', row.grade || '', row.ownerId || null, Date.now()]
  );
}

function updateClass(id, patch) {
  const fields = [];
  const params = [];
  for (const [key, column] of [
    ['name', 'name'],
    ['school', 'school'],
    ['grade', 'grade'],
    ['badge', 'badge'],
    ['ownerId', 'owner_id'],
    ['cadreLimitPer', 'cadre_limit_per'],
    ['cadreLimitDay', 'cadre_limit_day'],
  ]) {
    if (patch[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(patch[key]);
    }
  }
  if (fields.length) db.run(`UPDATE classes SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
  return findClass(id);
}

function softDeleteClass(id, reason = '') {
  db.run('UPDATE classes SET deleted_at = ?, deleted_reason = ? WHERE id = ?', [Date.now(), reason, id]);
  db.run('UPDATE accounts SET deleted_at = ? WHERE class_id = ? AND deleted_at IS NULL', [Date.now(), id]);
  db.run('UPDATE auth_sessions SET revoked_at = ? WHERE class_id = ? AND revoked_at IS NULL', [Date.now(), id]);
}

function restoreClass(id) {
  db.run('UPDATE classes SET deleted_at = NULL, deleted_reason = NULL WHERE id = ?', [id]);
}

function listAccounts({ search = '', role = '', classId = '', page = 1, pageSize = 20 } = {}) {
  const where = ['a.deleted_at IS NULL'];
  const params = [];
  if (search) {
    where.push("(a.name LIKE ? OR a.username LIKE ? OR a.phone LIKE ? OR COALESCE(c.name, '') LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (role) {
    where.push('a.role = ?');
    params.push(role);
  }
  if (classId) {
    where.push('a.class_id = ?');
    params.push(classId);
  }
  const clause = where.join(' AND ');
  const total = db.count(`SELECT COUNT(*) FROM accounts a LEFT JOIN classes c ON c.id = a.class_id WHERE ${clause}`, params);
  const items = db.all(
    `SELECT a.id, a.role, a.class_id AS classId, c.name AS className, a.username, a.phone, a.name, a.status,
            a.created_at AS createdAt, a.last_login_at AS lastLoginAt, a.note
     FROM accounts a LEFT JOIN classes c ON c.id = a.class_id
     WHERE ${clause}
     ORDER BY CASE a.role WHEN 'super_admin' THEN 0 WHEN 'owner' THEN 1 WHEN 'teacher' THEN 2 ELSE 3 END, a.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { items, total, page, pageSize };
}

function findAccount(id) {
  return db.get('SELECT id, role, class_id AS classId, username, phone, name, status FROM accounts WHERE id = ? AND deleted_at IS NULL', [id]);
}

function findOwnerOf(classId) {
  return db.get("SELECT id FROM accounts WHERE class_id = ? AND role = 'owner' AND deleted_at IS NULL", [classId]);
}

function writeAudit(row) {
  db.run(
    `INSERT INTO admin_audit (id, actor_id, actor_name, action, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.actorId, row.actorName, row.action, row.targetType, row.targetId || '', row.detail || '', Date.now()]
  );
}

function listAudit({ page = 1, pageSize = 30 } = {}) {
  const total = db.count('SELECT COUNT(*) FROM admin_audit');
  const items = db.all(
    `SELECT id, actor_name AS actorName, action, target_type AS targetType, target_id AS targetId,
            detail, created_at AS createdAt
     FROM admin_audit ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [pageSize, (page - 1) * pageSize]
  );
  return { items, total, page, pageSize };
}

function listRecycle({ page = 1, pageSize = 20 } = {}) {
  const total = db.count('SELECT COUNT(*) FROM recycle');
  const items = db.all(
    `SELECT r.id, r.class_id AS classId, r.kind, r.title, r.created_at AS createdAt, r.restored_at AS restoredAt,
            c.name AS className, a.name AS operatorName
     FROM recycle r LEFT JOIN classes c ON c.id = r.class_id LEFT JOIN accounts a ON a.id = r.operator_id
     ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    [pageSize, (page - 1) * pageSize]
  );
  return { items, total, page, pageSize };
}

function findRecycle(id) {
  return db.get('SELECT id, class_id AS classId, kind, title, payload, created_at AS createdAt, restored_at AS restoredAt FROM recycle WHERE id = ?', [id]);
}

function markRestored(id) {
  db.run('UPDATE recycle SET restored_at = ? WHERE id = ?', [Date.now(), id]);
}

function deletedClasses() {
  return db.all(
    `SELECT id, name, school, grade, created_at AS createdAt, deleted_at AS deletedAt, deleted_reason AS deletedReason
     FROM classes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
  );
}

module.exports = {
  overview,
  listClasses,
  findClass,
  insertClass,
  updateClass,
  softDeleteClass,
  restoreClass,
  listAccounts,
  findAccount,
  findOwnerOf,
  writeAudit,
  listAudit,
  listRecycle,
  findRecycle,
  markRestored,
  deletedClasses,
};
