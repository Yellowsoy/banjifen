'use strict';
const db = require('../../db');

const STUDENT_FIELDS = 'id, name, group_name AS groupName, sex, position, points, created_at AS createdAt';

/* ---------------- 班级资料 ---------------- */
function getProfile(classId) {
  return (
    db.get('SELECT name AS className, badge, school, grade FROM classes WHERE id = ?', [classId]) || {
      className: '',
      badge: '',
      school: '',
      grade: '',
    }
  );
}

function updateProfile(classId, { className, badge, school, grade }) {
  const fields = [];
  const params = [];
  if (className !== undefined) {
    fields.push('name = ?');
    params.push(className);
  }
  if (badge !== undefined) {
    fields.push('badge = ?');
    params.push(badge);
  }
  if (school !== undefined) {
    fields.push('school = ?');
    params.push(school);
  }
  if (grade !== undefined) {
    fields.push('grade = ?');
    params.push(grade);
  }
  if (fields.length) db.run(`UPDATE classes SET ${fields.join(', ')} WHERE id = ?`, [...params, classId]);
  return getProfile(classId);
}

/* ---------------- 学生 ---------------- */
function listStudents(classId, { search = '', sort = 'points_desc' } = {}) {
  const params = [classId];
  let sql = `SELECT ${STUDENT_FIELDS} FROM students WHERE class_id = ? AND deleted_at IS NULL`;
  if (search) {
    sql += ' AND (name LIKE ? OR group_name LIKE ? OR position LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const order =
    sort === 'points_asc'
      ? 'points ASC, name COLLATE NOCASE ASC'
      : sort === 'created_desc'
        ? 'created_at DESC'
        : sort === 'name'
          ? 'name COLLATE NOCASE ASC'
          : 'points DESC, name COLLATE NOCASE ASC';
  sql += ` ORDER BY ${order}`;
  return db.all(sql, params);
}

function listStudentsPaged(classId, { search = '', sort = 'points_desc', page = 1, pageSize = 20 }) {
  const rows = listStudents(classId, { search, sort });
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), total, page, pageSize };
}

function findStudent(classId, id) {
  return db.get(`SELECT ${STUDENT_FIELDS} FROM students WHERE class_id = ? AND id = ? AND deleted_at IS NULL`, [classId, id]);
}

function findStudentsByIds(classId, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.all(`SELECT ${STUDENT_FIELDS} FROM students WHERE class_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`, [
    classId,
    ...ids,
  ]);
}

function findStudentsByNames(classId) {
  return db.all(`SELECT ${STUDENT_FIELDS} FROM students WHERE class_id = ? AND deleted_at IS NULL`, [classId]);
}

function insertStudent(classId, student) {
  db.run(
    `INSERT INTO students (id, class_id, name, group_name, sex, position, points, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [student.id, classId, student.name, student.groupName || '', student.sex || '', student.position || '', student.points || 0, student.createdAt || Date.now()]
  );
  return findStudent(classId, student.id);
}

function updateStudent(classId, id, patch) {
  const fields = [];
  const params = [];
  for (const [key, column] of [
    ['name', 'name'],
    ['groupName', 'group_name'],
    ['sex', 'sex'],
    ['position', 'position'],
  ]) {
    if (patch[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(patch[key]);
    }
  }
  if (!fields.length) return findStudent(classId, id);
  db.run(`UPDATE students SET ${fields.join(', ')} WHERE class_id = ? AND id = ?`, [...params, classId, id]);
  return findStudent(classId, id);
}

function softDeleteStudent(classId, id) {
  db.run('UPDATE students SET deleted_at = ? WHERE class_id = ? AND id = ?', [Date.now(), classId, id]);
}

function addPoints(classId, studentId, delta) {
  db.run('UPDATE students SET points = points + ? WHERE class_id = ? AND id = ?', [delta, classId, studentId]);
}

function setPoints(classId, studentId, points) {
  db.run('UPDATE students SET points = ? WHERE class_id = ? AND id = ?', [points, classId, studentId]);
}

function resetPoints(classId) {
  db.run('UPDATE students SET points = 0 WHERE class_id = ? AND deleted_at IS NULL', [classId]);
}

function countStudents(classId) {
  return db.count('SELECT COUNT(*) FROM students WHERE class_id = ? AND deleted_at IS NULL', [classId]);
}

function studentGroups(classId) {
  return db.all(
    `SELECT COALESCE(NULLIF(group_name, ''), '未分组') AS name, COUNT(*) AS count, SUM(points) AS total
     FROM students WHERE class_id = ? AND deleted_at IS NULL
     GROUP BY name ORDER BY total DESC`,
    [classId]
  );
}

/* ---------------- 积分流水 ---------------- */
function insertLog(log) {
  db.run(
    `INSERT INTO point_logs (id, class_id, student_id, student_name, delta, reason, kind, operator_id, operator_name, operator_role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.classId,
      log.studentId,
      log.studentName,
      log.delta,
      log.reason || '',
      log.kind || 'manual',
      log.operatorId || '',
      log.operatorName || '',
      log.operatorRole || '',
      log.createdAt,
    ]
  );
}

function findLog(classId, id) {
  return db.get(
    `SELECT id, student_id AS studentId, student_name AS studentName, delta, reason, kind,
            operator_id AS operatorId, operator_name AS operatorName, operator_role AS operatorRole, created_at AS createdAt
     FROM point_logs WHERE class_id = ? AND id = ?`,
    [classId, id]
  );
}

function listLogs(classId, { from = 0, to = 0, search = '', studentId = '', kind = '', page = 1, pageSize = 20 } = {}) {
  const where = ['class_id = ?'];
  const params = [classId];
  if (from) {
    where.push('created_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(to);
  }
  if (search) {
    where.push('student_name LIKE ?');
    params.push(`%${search}%`);
  }
  if (studentId) {
    where.push('student_id = ?');
    params.push(studentId);
  }
  if (kind) {
    where.push('kind = ?');
    params.push(kind);
  }
  const clause = where.join(' AND ');
  const total = db.count(`SELECT COUNT(*) FROM point_logs WHERE ${clause}`, params);
  const rows = db.all(
    `SELECT id, student_id AS studentId, student_name AS studentName, delta, reason, kind,
            operator_id AS operatorId, operator_name AS operatorName, operator_role AS operatorRole, created_at AS createdAt
     FROM point_logs WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { items: rows, total, page, pageSize };
}

function listLogsForRange(classId, from, to, excludeKinds = ['redeem']) {
  const placeholders = excludeKinds.map(() => '?').join(',');
  return db.all(
    `SELECT student_id AS studentId, SUM(delta) AS points FROM point_logs
     WHERE class_id = ? AND created_at >= ? AND created_at <= ? AND kind NOT IN (${placeholders})
     GROUP BY student_id`,
    [classId, from, to, ...excludeKinds]
  );
}

function deleteLog(classId, id) {
  db.run('DELETE FROM point_logs WHERE class_id = ? AND id = ?', [classId, id]);
}

function deleteLogsOfStudent(classId, studentId) {
  const row = db.get('SELECT COUNT(*) AS c FROM point_logs WHERE class_id = ? AND student_id = ?', [classId, studentId]);
  db.run('DELETE FROM point_logs WHERE class_id = ? AND student_id = ?', [classId, studentId]);
  return Number(row.c || 0);
}

function clearLogs(classId) {
  const row = db.get('SELECT COUNT(*) AS c FROM point_logs WHERE class_id = ?', [classId]);
  db.run('DELETE FROM point_logs WHERE class_id = ?', [classId]);
  return Number(row.c || 0);
}

function sumCadreToday(classId, operatorId, dayStart) {
  const row = db.get(
    `SELECT COALESCE(SUM(ABS(delta)), 0) AS total FROM point_logs
     WHERE class_id = ? AND operator_id = ? AND created_at >= ? AND kind IN ('manual','batch')`,
    [classId, operatorId, dayStart]
  );
  return Number(row.total || 0);
}

function countLogs(classId, from = 0, to = 0) {
  if (from || to) {
    return db.count('SELECT COUNT(*) FROM point_logs WHERE class_id = ? AND created_at >= ? AND created_at <= ?', [
      classId,
      from || 0,
      to || Number.MAX_SAFE_INTEGER,
    ]);
  }
  return db.count('SELECT COUNT(*) FROM point_logs WHERE class_id = ?', [classId]);
}

/* ---------------- 快捷规则 ---------------- */
function listRules(classId) {
  return db.all('SELECT id, name, score, sort_no AS sortNo FROM quick_rules WHERE class_id = ? ORDER BY sort_no ASC, created_at ASC', [
    classId,
  ]);
}

function insertRule(classId, rule) {
  const maxSort = db.get('SELECT COALESCE(MAX(sort_no), 0) AS m FROM quick_rules WHERE class_id = ?', [classId]);
  db.run('INSERT INTO quick_rules (id, class_id, name, score, sort_no, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    rule.id,
    classId,
    rule.name,
    rule.score,
    Number(maxSort.m || 0) + 1,
    Date.now(),
  ]);
  return listRules(classId);
}

function deleteRule(classId, id) {
  db.run('DELETE FROM quick_rules WHERE class_id = ? AND id = ?', [classId, id]);
}

function clearRules(classId) {
  db.run('DELETE FROM quick_rules WHERE class_id = ?', [classId]);
}

/* ---------------- 商城 ---------------- */
const GIFT_FIELDS = 'id, name, cost, icon, stock, created_at AS createdAt';

function listGifts(classId) {
  return db.all(`SELECT ${GIFT_FIELDS} FROM gifts WHERE class_id = ? AND deleted_at IS NULL ORDER BY cost ASC, created_at ASC`, [classId]);
}

function findGift(classId, id) {
  return db.get(`SELECT ${GIFT_FIELDS} FROM gifts WHERE class_id = ? AND id = ? AND deleted_at IS NULL`, [classId, id]);
}

function insertGift(classId, gift) {
  db.run('INSERT INTO gifts (id, class_id, name, cost, icon, stock, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    gift.id,
    classId,
    gift.name,
    gift.cost,
    gift.icon || '🎁',
    gift.stock === null || gift.stock === undefined ? null : gift.stock,
    Date.now(),
  ]);
  return findGift(classId, gift.id);
}

function updateGift(classId, id, patch) {
  const fields = [];
  const params = [];
  for (const key of ['name', 'cost', 'icon', 'stock']) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }
  if (!fields.length) return findGift(classId, id);
  db.run(`UPDATE gifts SET ${fields.join(', ')} WHERE class_id = ? AND id = ?`, [...params, classId, id]);
  return findGift(classId, id);
}

function softDeleteGift(classId, id) {
  db.run('UPDATE gifts SET deleted_at = ? WHERE class_id = ? AND id = ?', [Date.now(), classId, id]);
}

function decrementStock(classId, id) {
  db.run('UPDATE gifts SET stock = stock - 1 WHERE class_id = ? AND id = ? AND stock IS NOT NULL AND stock > 0', [classId, id]);
}

function insertRedemption(row) {
  db.run(
    `INSERT INTO redemptions (id, class_id, gift_id, gift_name, cost, student_id, student_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.classId, row.giftId, row.giftName, row.cost, row.studentId, row.studentName, row.createdAt]
  );
}

function listRedemptions(classId, { page = 1, pageSize = 50, from = 0, to = 0 } = {}) {
  const where = ['class_id = ?'];
  const params = [classId];
  if (from) {
    where.push('created_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(to);
  }
  const clause = where.join(' AND ');
  const total = db.count(`SELECT COUNT(*) FROM redemptions WHERE ${clause}`, params);
  const items = db.all(
    `SELECT id, gift_id AS giftId, gift_name AS giftName, cost, student_id AS studentId, student_name AS studentName, created_at AS createdAt
     FROM redemptions WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { items, total, page, pageSize };
}

function allRedemptions(classId) {
  return db.all(
    `SELECT gift_name AS giftName, cost, student_name AS studentName, created_at AS createdAt
     FROM redemptions WHERE class_id = ? ORDER BY created_at DESC`,
    [classId]
  );
}

/* ---------------- 排座 ---------------- */
function getSeatPlan(classId) {
  const row = db.get(
    'SELECT cols, rows, scheme, seats, angle, confirmed_at AS confirmedAt, updated_at AS updatedAt FROM seat_plans WHERE class_id = ?',
    [classId]
  );
  if (!row) return null;
  return { ...row, seats: JSON.parse(row.seats || '[]') };
}

function saveSeatPlan(classId, plan) {
  const now = Date.now();
  db.run(
    `INSERT INTO seat_plans (class_id, cols, rows, scheme, seats, angle, confirmed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (class_id) DO UPDATE SET cols = excluded.cols, rows = excluded.rows, scheme = excluded.scheme,
       seats = excluded.seats, angle = excluded.angle, confirmed_at = excluded.confirmed_at, updated_at = excluded.updated_at`,
    [classId, plan.cols, plan.rows, plan.scheme, JSON.stringify(plan.seats || []), plan.angle, plan.confirmedAt || null, now]
  );
  return getSeatPlan(classId);
}

/* ---------------- 考试与成绩 ---------------- */
function listExams(classId) {
  return db.all(
    `SELECT e.id, e.name, e.full_score AS fullScore, e.created_at AS createdAt, COUNT(s.id) AS studentCount
     FROM exams e LEFT JOIN scores s ON s.exam_id = e.id
     WHERE e.class_id = ? AND e.deleted_at IS NULL GROUP BY e.id ORDER BY e.created_at DESC`,
    [classId]
  );
}

function findExam(classId, id) {
  return db.get('SELECT id, name, full_score AS fullScore, created_at AS createdAt FROM exams WHERE class_id = ? AND id = ? AND deleted_at IS NULL', [
    classId,
    id,
  ]);
}

function insertExam(classId, exam) {
  db.run('INSERT INTO exams (id, class_id, name, full_score, created_at) VALUES (?, ?, ?, ?, ?)', [
    exam.id,
    classId,
    exam.name,
    exam.fullScore || 100,
    Date.now(),
  ]);
}

function upsertScore(classId, row) {
  db.run(
    `INSERT INTO scores (id, class_id, exam_id, student_id, score, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (exam_id, student_id) DO UPDATE SET score = excluded.score, created_at = excluded.created_at`,
    [row.id, classId, row.examId, row.studentId, row.score, Date.now()]
  );
}

function scoresOfExam(classId, examId) {
  return db.all(
    `SELECT s.student_id AS studentId, s.score, st.name, st.group_name AS groupName
     FROM scores s JOIN students st ON st.id = s.student_id AND st.deleted_at IS NULL
     WHERE s.class_id = ? AND s.exam_id = ?`,
    [classId, examId]
  );
}

function scoresOfStudent(classId, studentId) {
  return db.all(
    `SELECT e.id AS examId, e.name, e.full_score AS fullScore, s.score, e.created_at AS createdAt
     FROM scores s JOIN exams e ON e.id = s.exam_id AND e.deleted_at IS NULL
     WHERE s.class_id = ? AND s.student_id = ? ORDER BY e.created_at ASC`,
    [classId, studentId]
  );
}

function deleteExam(classId, id) {
  db.run('UPDATE exams SET deleted_at = ? WHERE class_id = ? AND id = ?', [Date.now(), classId, id]);
}

function countExams(classId) {
  return db.count('SELECT COUNT(*) FROM exams WHERE class_id = ? AND deleted_at IS NULL', [classId]);
}

module.exports = {
  getProfile,
  updateProfile,
  listStudents,
  listStudentsPaged,
  findStudent,
  findStudentsByIds,
  findStudentsByNames,
  insertStudent,
  updateStudent,
  softDeleteStudent,
  addPoints,
  setPoints,
  resetPoints,
  countStudents,
  studentGroups,
  insertLog,
  findLog,
  listLogs,
  listLogsForRange,
  deleteLog,
  deleteLogsOfStudent,
  clearLogs,
  countLogs,
  sumCadreToday,
  listRules,
  insertRule,
  deleteRule,
  clearRules,
  listGifts,
  findGift,
  insertGift,
  updateGift,
  softDeleteGift,
  decrementStock,
  insertRedemption,
  listRedemptions,
  allRedemptions,
  getSeatPlan,
  saveSeatPlan,
  listExams,
  findExam,
  insertExam,
  upsertScore,
  scoresOfExam,
  scoresOfStudent,
  deleteExam,
  countExams,
};
