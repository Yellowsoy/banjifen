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
const opAudit = require('../../core/audit');
const settings = require('../../core/settings');

/**
 * 超级管理员操作留痕：
 * 同时写入 admin_audit（简版，兼容既有视图）与 operation_logs（详版，含 Before/After 与完整上下文）
 */
/**
 * 超管动作审计：只写旧表 admin_audit（供 /api/super/audit 兼容接口使用）。
 *
 * operation_logs 不再在这里写 —— super.routes.js 已给每个超管写接口挂了 trail() 中间件，
 * 那条记录包含 HTTP 状态码、IP、UA 与 before/after 快照，信息更完整；
 * 若此处再写一次，同一个动作会在日志里出现两条，反而误导。
 */
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

/* ==================== 全量操作日志 ==================== */

function listOperationLogs(query = {}) {
  return opAudit.list(query);
}

function operationLogsCsv(query = {}) {
  const { items } = opAudit.list({ ...query, page: 1, pageSize: 10000 });
  return toCsv(
    ['时间', '操作者', '角色', '班级', '模块', '动作', '目标类型', '目标', '摘要', '数量', '结果', '状态码', 'IP'],
    items.map((r) => [
      new Date(r.created_at).toLocaleString('zh-CN'),
      r.actor_name,
      ROLE_LABEL[r.actor_role] || r.actor_role || '系统',
      r.class_name || '',
      r.module,
      r.action,
      r.target_type,
      r.target_name,
      r.summary,
      r.amount,
      r.result === 'success' ? '成功' : '失败',
      r.status_code || '',
      r.ip || '',
    ])
  );
}

function clearOperationLogs(actor, days) {
  const ts = Date.now() - Math.max(1, Number(days || 1)) * 86400000;
  const changes = opAudit.clearBefore(ts);
  audit(actor, 'logs.clear', 'system', '', `清理 ${Number(days)} 天前操作日志，共 ${changes} 条`);
  return { removed: changes };
}

/* ==================== 数据备份与恢复 ==================== */

const backup = require('../../core/backup');

function exportClassBackup(actor, classId) {
  const pack = backup.classBackup(classId);
  audit(actor, 'backup.export', 'class', classId, `导出班级「${pack.class.name}」数据备份（${pack.stats.students} 名学生 / ${pack.stats.pointLogs} 条积分记录）`);
  return pack;
}

function exportPlatformBackup(actor) {
  const pack = backup.fullBackup();
  audit(actor, 'backup.export', 'platform', '', `导出平台级全量备份（${pack.stats.classes} 个班级）`);
  return pack;
}

function importBackup(actor, { text, mode = 'create', targetClassId = '', className = '', includeAccounts = false }) {
  const pack = backup.parseBackup(text);
  let result;
  if (pack.scope === 'class') {
    result = backup.importClassPack(pack, { mode, targetClassId, className });
    audit(
      actor,
      'backup.import',
      'class',
      result.classId,
      `导入班级备份「${result.name}」（${mode === 'replace' ? '覆盖原班级' : '新建班级'}）：` +
        `${result.counts.students} 名学生 / ${result.counts.pointLogs} 条积分 / ${result.counts.scores} 条成绩 / ${result.counts.members} 个账号档案`
    );
  } else {
    result = backup.importFullPack(pack, { includeAccounts });
    audit(actor, 'backup.import', 'platform', '', `导入平台级备份，共恢复 ${result.imported} 个班级`);
  }
  return result;
}

/* ==================== 成绩对外查询口令 ==================== */

function listQueryTokens() {
  return db
    .all(
      `SELECT t.*, c.name AS class_name
         FROM query_tokens t LEFT JOIN classes c ON c.id = t.class_id
        ORDER BY t.created_at DESC`
    )
    .map((t) => ({
      id: t.id,
      classId: t.class_id,
      className: t.class_name || '（班级已删除）',
      token: t.token,
      name: t.name,
      scope: t.scope,
      mode: t.mode,
      enabled: !!t.enabled,
      expiresAt: t.expires_at,
      createdAt: t.created_at,
      lastUsedAt: t.last_used_at,
    }));
}

function createQueryToken(actor, { classId, name = '', scope = 'scores', mode = 'name_no', days = 0 }) {
  const cls = db.get('SELECT id, name FROM classes WHERE id = ? AND deleted_at IS NULL', [classId]);
  if (!cls) throw new NotFoundError('班级不存在');
  let token = genId('q').slice(-10).toUpperCase();
  for (let i = 0; i < 5; i += 1) {
    if (!db.get('SELECT id FROM query_tokens WHERE token = ?', [token])) break;
    token = genId('q').slice(-10).toUpperCase();
  }
  const id = genId('qtk');
  const expiresAt = Number(days) > 0 ? Date.now() + Number(days) * 86400000 : null;
  db.run(
    `INSERT INTO query_tokens (id, class_id, token, name, scope, mode, enabled, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [id, classId, token, name, scope, mode, expiresAt, actor.accountId, Date.now()]
  );
  audit(actor, 'query.token.create', 'class', classId, `为「${cls.name}」生成对外查询口令 ${token}（范围：${scope}，校验：${mode}）`);
  return { id, token, classId, expiresAt };
}

function toggleQueryToken(actor, id, enabled) {
  const row = db.get('SELECT * FROM query_tokens WHERE id = ?', [id]);
  if (!row) throw new NotFoundError('口令不存在');
  db.run('UPDATE query_tokens SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  audit(actor, 'query.token.toggle', 'class', row.class_id, `${enabled ? '启用' : '停用'}查询口令 ${row.token}`);
  return { ok: true, enabled: !!enabled };
}

function deleteQueryToken(actor, id) {
  const row = db.get('SELECT * FROM query_tokens WHERE id = ?', [id]);
  if (!row) throw new NotFoundError('口令不存在');
  db.run('DELETE FROM query_tokens WHERE id = ?', [id]);
  audit(actor, 'query.token.delete', 'class', row.class_id, `删除查询口令 ${row.token}`);
  return { ok: true };
}

/* ==================== 成绩自助查询总开关 ==================== */

function getPublicQueryEnabled() {
  return settings.getBool('public_query_enabled', true);
}

function setPublicQueryEnabled(actor, enabled) {
  settings.set('public_query_enabled', enabled ? '1' : '0', actor.accountId);
  audit(actor, 'settings.publicQuery', 'platform', '', `将「成绩自助查询」总开关置为${enabled ? '开启' : '关闭'}`);
  return getPublicQueryEnabled();
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
  // 新增：全量操作日志 / 备份恢复 / 对外查询口令
  listOperationLogs,
  operationLogsCsv,
  clearOperationLogs,
  exportClassBackup,
  exportPlatformBackup,
  importBackup,
  listQueryTokens,
  createQueryToken,
  toggleQueryToken,
  deleteQueryToken,
  getPublicQueryEnabled,
  setPublicQueryEnabled,
};
