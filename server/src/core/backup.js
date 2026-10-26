'use strict';
/**
 * 数据备份：把一个班级（或整个平台）的全部数据导出为一个 JSON 文件，并支持原样导入回来。
 *
 * 设计取舍：
 * 1. 选 JSON 而非二进制 SQLite —— 可读、可 diff、跨版本容错好，也方便人工核对；
 * 2. 绝不导出 pwd_hash（口令散列），导入后相关账号需由超管/班主任重新设置密码，
 *    避免把一个环境的口令原样搬运另一个环境造成越权风险；
 * 3. 导入用事务包裹，任何一步失败整体回滚，不会出现「导了一半」的脏数据；
 * 4. 支持两种模式：create（恢复为新班级）/ replace（覆盖指定班级）。
 */
const crypto = require('node:crypto');
const db = require('../db');
const { BusinessError: BadRequestError } = require('./errors');

const FORMAT = 'banjifen-backup';
const VERSION = 1;

const CLASS_TABLES = [
  'students',
  'point_logs',
  'quick_rules',
  'gifts',
  'redemptions',
  'exams',
  'scores',
];

const SECRET_FIELDS = ['pwd_hash', 'pwdHash'];

function stripSecrets(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  SECRET_FIELDS.forEach((k) => delete out[k]);
  return out;
}

function iso(ts) {
  return ts ? new Date(ts).toISOString() : null;
}

/* ---------------- 导出 ---------------- */

function classBackup(classId) {
  const cls = db.get('SELECT * FROM classes WHERE id = ? AND deleted_at IS NULL', [classId]);
  if (!cls) throw new BadRequestError('班级不存在或已删除');

  const members = db
    .all(
      `SELECT * FROM accounts WHERE class_id = ? AND deleted_at IS NULL`,
      [classId]
    )
    .map(stripSecrets);

  const data = {};
  CLASS_TABLES.forEach((table) => {
    data[table] = db.all(`SELECT * FROM ${table} WHERE class_id = ?`, [classId]);
  });
  const seatPlan = db.get('SELECT * FROM seat_plans WHERE class_id = ?', [classId]) || null;

  return {
    format: FORMAT,
    version: VERSION,
    scope: 'class',
    exportedAt: Date.now(),
    exportedAtText: iso(Date.now()),
    class: cls,
    members,
    seatPlan,
    ...data,
    stats: {
      students: data.students.length,
      pointLogs: data.point_logs.length,
      rules: data.quick_rules.length,
      gifts: data.gifts.length,
      redemptions: data.redemptions.length,
      exams: data.exams.length,
      scores: data.scores.length,
      members: members.length,
    },
  };
}

function fullBackup() {
  const classes = db.all('SELECT * FROM classes WHERE deleted_at IS NULL');
  return {
    format: FORMAT,
    version: VERSION,
    scope: 'platform',
    exportedAt: Date.now(),
    exportedAtText: iso(Date.now()),
    stats: {
      classes: classes.length,
      accounts: db.count('SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL'),
      operationLogs: db.count('SELECT COUNT(*) AS c FROM operation_logs'),
    },
    accounts: db.all('SELECT * FROM accounts').map(stripSecrets),
    // 逐班级导出（各自含 members / students / logs / exams 等完整数据）
    classes: classes.map((c) => classBackup(c.id)),
    recycle: db.all('SELECT * FROM recycle'),
    operationLogs: db.all('SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT 20000'),
  };
}

/* ---------------- 导入 ---------------- */

function insertRows(table, rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const keys = Object.keys(rows[0]);
  const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  rows.forEach((row) => {
    db.run(sql, keys.map((k) => (row[k] === undefined ? null : row[k])));
  });
}

function ensureClassRow(cls, classId, mode) {
  const exists = db.get('SELECT id FROM classes WHERE id = ?', [classId]);
  if (mode === 'replace') {
    if (!exists) throw new BadRequestError('目标班级不存在，无法覆盖（请改用「恢复为新班级」）');
    db.run(
      `UPDATE classes SET name = ?, school = ?, grade = ?, badge = ?, owner_id = COALESCE(?, owner_id),
        cadre_limit_per = ?, cadre_limit_day = ?, created_at = ?, deleted_at = NULL
       WHERE id = ?`,
      [
        cls.name || '未命名班级',
        cls.school || '',
        cls.grade || '',
        cls.badge || '',
        cls.owner_id || null,
        Number(cls.cadre_limit_per || 5),
        Number(cls.cadre_limit_day || 20),
        Number(cls.created_at || Date.now()),
        classId,
      ]
    );
    return classId;
  }
  const newId = crypto.randomUUID();
  db.run(
    `INSERT INTO classes (id, name, school, grade, badge, owner_id, cadre_limit_per, cadre_limit_day, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      newId,
      cls.name || '未命名班级',
      cls.school || '',
      cls.grade || '',
      cls.badge || '',
      Number(cls.cadre_limit_per || 5),
      Number(cls.cadre_limit_day || 20),
      Number(cls.created_at || Date.now()),
    ]
  );
  return newId;
}

function importClassPack(pack, { mode = 'create', targetClassId = '', className = '' } = {}) {
  const payload = pack && pack.class ? pack : (pack && pack.body ? pack.body : pack);
  const cls = payload.class;
  if (!cls || !cls.name) throw new BadRequestError('备份文件缺少班级信息，无法导入');

  return db.transaction(() => {
    const classId = ensureClassRow(cls, String(targetClassId || ''), mode);

    // 覆盖模式：先清掉该班全部旧数据
    const wipe = [...CLASS_TABLES];
    wipe.forEach((table) => db.run(`DELETE FROM ${table} WHERE class_id = ?`, [classId]));
    db.run('DELETE FROM seat_plans WHERE class_id = ?', [classId]);

    CLASS_TABLES.forEach((table) => {
      const rows = (payload[table] || []).map((row) => ({ ...row, class_id: classId }));
      insertRows(table, rows);
    });

    if (payload.seatPlan) {
      insertRows('seat_plans', [{ ...payload.seatPlan, class_id: classId }]);
    }

    // 成员账号：导入的是档案（不含密码），按 username 去重恢复
    const members = payload.members || [];
    let importedMembers = 0;
    members.forEach((m) => {
      const exist = db.get('SELECT id FROM accounts WHERE username = ?', [m.username]);
      if (exist) return;
      const accId = crypto.randomUUID();
      db.run(
        `INSERT INTO accounts (id, type, role, class_id, username, phone, name, pwd_hash, status, created_at, note)
         VALUES (?, 'class', ?, ?, ?, ?, ?, '', 'disabled', ?, ?)`,
        [
          accId,
          m.role === 'super_admin' ? 'teacher' : m.role || 'teacher',
          classId,
          m.username || `imported_${accId.slice(0, 8)}`,
          m.phone || '',
          m.name || '待完善',
          Number(m.created_at || Date.now()),
          '由备份导入，需重新设置密码后方可登录',
        ]
      );
      if (!cls.owner_id && m.role === 'owner') db.run('UPDATE classes SET owner_id = ? WHERE id = ?', [accId, classId]);
      importedMembers += 1;
    });

    if (className) db.run('UPDATE classes SET name = ? WHERE id = ?', [className, classId]);

    return {
      classId,
      name: className || cls.name,
      counts: {
        students: (payload.students || []).length,
        pointLogs: (payload.point_logs || []).length,
        rules: (payload.quick_rules || []).length,
        gifts: (payload.gifts || []).length,
        redemptions: (payload.redemptions || []).length,
        exams: (payload.exams || []).length,
        scores: (payload.scores || []).length,
        members: importedMembers,
      },
    };
  });
}

function importFullPack(pack, { includeAccounts = false } = {}) {
  const packs = Array.isArray(pack.classes) ? pack.classes : [];
  if (!packs.length) throw new BadRequestError('备份文件里没有可导入的班级');
  const results = [];
  db.transaction(() => {
    packs.forEach((p) => {
      const payload = { ...p, class: p.class || (p.class === undefined ? null : p.class) };
      const base = p.class || (p.class === undefined ? {} : {});
      results.push(importClassPack({ ...payload, class: base }, { mode: 'create' }));
    });
    if (includeAccounts && Array.isArray(pack.accounts)) {
      // 平台账号（超管等）只恢复档案，密码需重设
      pack.accounts
        .filter((a) => a.role === 'super_admin')
        .forEach((a) => {
          const exist = db.get('SELECT id FROM accounts WHERE username = ?', [a.username]);
          if (exist) return;
          db.run(
            `INSERT INTO accounts (id, type, role, class_id, username, phone, name, pwd_hash, status, created_at, note)
             VALUES (?, 'super_admin', 'super_admin', NULL, ?, ?, ?, '', 'disabled', ?, '由备份导入，需重设密码')`,
            [crypto.randomUUID(), a.username, a.phone || '', a.name || '超级管理员', Number(a.created_at || Date.now())]
          );
        });
    }
  });
  return { imported: results.length, classes: results };
}

function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BadRequestError('备份文件不是合法的 JSON');
  }
  if (data.format !== FORMAT) throw new BadRequestError('不是本站备份文件（缺少 banjifen-backup 标识）');
  return data;
}

module.exports = { classBackup, fullBackup, importClassPack, importFullPack, parseBackup, FORMAT, VERSION };
