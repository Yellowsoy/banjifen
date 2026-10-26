'use strict';
const db = require('../../db');
const { genId } = require('../../config');
const { BusinessError, NotFoundError, ForbiddenError } = require('../../core/errors');
const { readSheet, buildBuffer, pick, toNumber, toCsv } = require('../../core/excel');
const repo = require('./class.repository');


const MAX_STUDENTS = 500;
const MAX_SEATS = 200;
const DEFAULT_RULES = [
  { name: '作业优秀', score: 2 },
  { name: '课堂发言', score: 1 },
  { name: '主动帮助他人', score: 2 },
  { name: '值日认真', score: 1 },
  { name: '作业未完成', score: -2 },
  { name: '课堂讲话', score: -1 },
  { name: '迟到', score: -1 },
  { name: '未戴红领巾', score: -1 },
];

function ensureClass(classId) {
  const cls = db.get(
    `SELECT id, name, badge, school, grade, owner_id AS ownerId,
            cadre_limit_per AS cadreLimitPer, cadre_limit_day AS cadreLimitDay
     FROM classes WHERE id = ? AND deleted_at IS NULL`,
    [classId]
  );
  if (!cls) throw new NotFoundError('班级不存在或已被删除');
  return cls;
}

/* ============ 概览 ============ */
function overview(classId, auth = {}) {
  const cls = ensureClass(classId);
  const account = auth.accountId
    ? db.get('SELECT id, username, name, role, phone FROM accounts WHERE id = ?', [auth.accountId])
    : null;
  const students = repo.countStudents(classId);
  const records = repo.countLogs(classId);
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const todayRecords = repo.countLogs(classId, todayStart, Date.now());
  const groups = repo.studentGroups(classId);
  return {
    account: account ? { id: account.id, username: account.username, name: account.name, role: account.role } : null,
    class: {
      id: cls.id,
      name: cls.name,
      badge: cls.badge || '',
      school: cls.school || '',
      grade: cls.grade || '',
      cadreLimitPer: cls.cadreLimitPer,
      cadreLimitDay: cls.cadreLimitDay,
    },
    stats: {
      students,
      records,
      todayRecords,
      groups: groups.length,
      gifts: repo.listGifts(classId).length,
      exams: repo.countExams(classId),
    },
  };
}

function updateProfile(classId, { className, badge, school, grade }) {
  const patch = {};
  if (className !== undefined) patch.className = String(className).slice(0, 30);
  if (badge !== undefined) patch.badge = String(badge);
  if (school !== undefined) patch.school = String(school).slice(0, 40);
  if (grade !== undefined) patch.grade = String(grade).slice(0, 20);
  return repo.updateProfile(classId, patch);
}

/* ============ 学生 ============ */
function addStudent(classId, data) {
  ensureClass(classId);
  if (repo.countStudents(classId) >= MAX_STUDENTS) {
    throw new BusinessError(`单个班级最多 ${MAX_STUDENTS} 名学生`);
  }
  const duplicate = repo
    .findStudentsByNames(classId)
    .find((s) => s.name === data.name && (s.groupName || '') === (data.groupName || ''));
  if (duplicate) {
    throw new BusinessError(`「${data.name}」已存在${data.groupName ? `（${data.groupName}）` : ''}，请勿重复添加`);
  }
  return repo.insertStudent(classId, {
    id: genId('stu'),
    name: data.name,
    groupName: data.groupName || '',
    sex: data.sex || '',
    position: data.position || '',
    points: 0,
    createdAt: Date.now(),
    studentNo: data.studentNo || '',
    birthday: data.birthday || '',
    address: data.address || '',
    guardianName: data.guardianName || '',
    guardianPhone: data.guardianPhone || '',
    guardianRelation: data.guardianRelation || '',
    guardianAltPhone: data.guardianAltPhone || '',
    note: data.note || '',
  });
}

function updateStudent(classId, id, patch) {
  ensureClass(classId);
  const student = repo.findStudent(classId, id);
  if (!student) throw new NotFoundError('学生不存在');
  return repo.updateStudent(classId, id, patch);
}

function deleteStudent(classId, id) {
  ensureClass(classId);
  const student = repo.findStudent(classId, id);
  if (!student) throw new NotFoundError('学生不存在');
  repo.softDeleteStudent(classId, id);
  return { id };
}

function listStudents(classId, { search, sort, page, pageSize, from, to }) {
  ensureClass(classId);
  if (sort !== 'time') {
    return repo.listStudentsPaged(classId, { search, sort, page, pageSize });
  }
  const rows = repo.listStudents(classId, { search, sort: 'points_desc' });
  const sums = new Map(repo.listLogsForRange(classId, from || 0, to || Date.now()).map((r) => [r.studentId, Number(r.points || 0)]));
  const withRange = rows.map((s) => ({ ...s, rangePoints: sums.get(s.id) || 0 }));
  withRange.sort((a, b) => b.rangePoints - a.rangePoints || a.name.localeCompare(b.name, 'zh'));
  const total = withRange.length;
  const start = (page - 1) * pageSize;
  return { items: withRange.slice(start, start + pageSize), total, page, pageSize };
}

function groups(classId, { sort = 'desc', search = '', from, to } = {}) {
  ensureClass(classId);
  const students = repo.listStudents(classId, { search });
  const sums =
    from || to
      ? new Map(repo.listLogsForRange(classId, from || 0, to || Date.now()).map((r) => [r.studentId, Number(r.points || 0)]))
      : null;
  const map = new Map();
  for (const s of students) {
    const key = s.groupName || '未分组';
    if (search && !key.includes(search)) continue;
    const item = map.get(key) || { name: key, count: 0, total: 0 };
    item.count += 1;
    item.total += sums ? sums.get(s.id) || 0 : s.points;
    map.set(key, item);
  }
  const list = [...map.values()].map((g) => ({ ...g, avg: g.count ? Number((g.total / g.count).toFixed(1)) : 0 }));
  list.sort((a, b) => (sort === 'asc' ? a.total - b.total : b.total - a.total) || a.name.localeCompare(b.name, 'zh'));
  return list;
}

function importStudents(classId, buffer) {
  ensureClass(classId);
  const rows = readSheet(buffer);
  if (!rows.length) throw new BusinessError('表格里没有数据，请检查第一行是否为表头');
  const existing = repo.findStudentsByNames(classId);
  const key = (name, group) => `${name}@@${group || ''}`;
  const seen = new Set(existing.map((s) => key(s.name, s.groupName)));
  const added = [];
  const duplicates = [];
  const invalid = [];
  const now = Date.now();
  db.transaction(() => {
    for (const row of rows) {
      const name = String(pick(row, ['姓名', '学生姓名', '名字', 'name'], '')).trim();
      if (!name) {
        invalid.push(row);
        continue;
      }
      const groupName = String(pick(row, ['小组', '班级小组', '组别', 'group'], '')).trim().slice(0, 30);
      const sexRaw = String(pick(row, ['性别', 'sex'], '')).trim();
      const sex = /男/.test(sexRaw) ? '男' : /女/.test(sexRaw) ? '女' : '';
      const position = String(pick(row, ['职务', '班级职务', '职位', 'position'], '')).trim().slice(0, 20);
      // 档案扩展字段：多种常见表头自动识别，家长联系方式是学校的刚需
      const studentNo = String(pick(row, ['学号', '学籍号', '编号', 'studentNo', 'student_no'], '')).trim().slice(0, 24);
      const birthday = String(pick(row, ['出生日期', '生日', '出生年月', 'birthday'], '')).trim().slice(0, 20);
      const address = String(pick(row, ['家庭住址', '住址', '地址', 'address'], '')).trim().slice(0, 120);
      const guardianName = String(
        pick(row, ['家长姓名', '监护人姓名', '监护人', '家长', '联系人', 'guardianName'], '')
      )
        .trim()
        .slice(0, 20);
      const guardianPhone = String(
        pick(row, ['家长电话', '家长联系方式', '家长手机', '监护人电话', '联系电话', '手机', 'guardianPhone'], '')
      )
        .trim()
        .slice(0, 24);
      const guardianRelation = String(pick(row, ['与学生关系', '关系', '家长关系', 'relation'], '')).trim().slice(0, 10);
      const guardianAltPhone = String(pick(row, ['备用电话', '备用联系电话', '第二联系人电话'], '')).trim().slice(0, 24);
      const note = String(pick(row, ['备注', '说明', 'note', 'remark'], '')).trim().slice(0, 200);
      const k = key(name, groupName);
      if (seen.has(k)) {
        duplicates.push({ name, groupName });
        continue;
      }
      if (existing.length + added.length >= MAX_STUDENTS) break;
      seen.add(k);
      added.push(
        repo.insertStudent(classId, {
          id: genId('stu'),
          name,
          groupName,
          sex,
          position,
          points: 0,
          createdAt: now,
          studentNo,
          birthday,
          address,
          guardianName,
          guardianPhone,
          guardianRelation,
          guardianAltPhone,
          note,
        })
      );
    }
  });
  return { total: rows.length, added: added.length, duplicates: duplicates.length, invalid: invalid.length, items: added };
}

/** 学生花名册模板：含完整档案字段，填好直接导入即可 */
function studentTemplate() {
  return buildBuffer([
    {
      name: '花名册',
      rows: [
        {
          姓名: '张小明',
          小组: '第一组',
          性别: '男',
          职务: '班长',
          学号: '20250101',
          出生日期: '2013-05-12',
          家庭住址: '示例市示例区示例路 1 号',
          家长姓名: '张伟',
          家长电话: '13800000001',
          与学生关系: '父亲',
          备用电话: '',
          备注: '',
        },
        {
          姓名: '李小红',
          小组: '第一组',
          性别: '女',
          职务: '学习委员',
          学号: '20250102',
          出生日期: '2013-08-20',
          家庭住址: '示例市示例区示例路 2 号',
          家长姓名: '李娜',
          家长电话: '13800000002',
          与学生关系: '母亲',
          备用电话: '',
          备注: '',
        },
      ],
      cols: [10, 10, 6, 10, 12, 12, 28, 10, 14, 10, 12, 16],
    },
  ]);
}

/** 导出本班学生花名册（Excel）：包含全部档案字段，可直接编辑后再导入 */
function studentsWorkbook(classId) {
  ensureClass(classId);
  const cls = repo.getProfile(classId);
  const students = repo.listStudents(classId, { sort: 'points_desc' });
  const rows = students.map((s) => ({
    姓名: s.name,
    小组: s.groupName || '',
    性别: s.sex || '',
    职务: s.position || '',
    学号: s.studentNo || '',
    出生日期: s.birthday || '',
    家庭住址: s.address || '',
    家长姓名: s.guardianName || '',
    家长电话: s.guardianPhone || '',
    与学生关系: s.guardianRelation || '',
    备用电话: s.guardianAltPhone || '',
    备注: s.note || '',
    当前积分: s.points,
  }));
  return buildBuffer([
    { name: '花名册', rows, cols: [10, 10, 6, 10, 12, 12, 28, 10, 14, 10, 12, 16, 10] },
    {
      name: '积分快照',
      rows: students.map((s) => ({ 姓名: s.name, 学号: s.studentNo || '', 小组: s.groupName || '', 积分: s.points })),
      cols: [12, 14, 12, 10],
    },
    { name: '班级信息', rows: [{ 班级名称: cls.className, 学校: cls.school || '', 年级: cls.grade || '', 学生人数: students.length }], cols: [16, 20, 12, 10] },
  ]);
}

/* ============ 加减分 ============ */
function applyPoints(classId, { studentIds, delta, reason = '', kind = 'manual', operator = {} }) {
  const cls = ensureClass(classId);
  const students = repo.findStudentsByIds(classId, studentIds);
  if (!students.length) throw new NotFoundError('学生不存在或已被删除');
  if (students.length !== studentIds.length) {
    throw new BusinessError('部分学生不存在，请刷新后重试');
  }

  // 班干部额度：单次不超过班级设置值，当日累计不超过每日上限
  if (operator.role === 'cadre') {
    const perLimit = Number(cls.cadreLimitPer) || 5;
    if (Math.abs(delta) > perLimit) {
      throw new BusinessError(`班干部单次加减分不能超过 ${perLimit} 分`, 'CADRE_LIMIT_PER');
    }
    const dayLimit = Number(cls.cadreLimitDay) || 20;
    const used = repo.sumCadreToday(classId, operator.accountId, new Date().setHours(0, 0, 0, 0));
    if (used + Math.abs(delta) * students.length > dayLimit) {
      throw new BusinessError(`今日加减分已达上限（${dayLimit} 分），请联系老师`, 'CADRE_LIMIT_DAY');
    }
    if (students.length > 1) {
      throw new ForbiddenError('班干部不支持批量加减分');
    }
  }

  const now = Date.now();
  const logs = [];
  db.transaction(() => {
    for (const student of students) {
      repo.addPoints(classId, student.id, delta);
      const log = {
        id: genId('log'),
        classId,
        studentId: student.id,
        studentName: student.name,
        delta,
        reason,
        kind: kind === 'manual' && studentIds.length > 1 ? 'batch' : kind,
        operatorId: operator.accountId || '',
        operatorName: operator.name || '',
        operatorRole: operator.role || '',
        createdAt: now,
      };
      repo.insertLog(log);
      logs.push(log);
    }
  });
  const updated = repo.findStudentsByIds(classId, studentIds);
  return { logs, students: updated };
}

function logs(classId, opts) {
  ensureClass(classId);
  return repo.listLogs(classId, opts);
}

function removeLog(classId, id) {
  ensureClass(classId);
  const log = repo.findLog(classId, id);
  if (!log) throw new NotFoundError('该条积分记录不存在');
  db.transaction(() => {
    // 删除记录时同步反向修正学生当前积分，保持历史与总分一致
    repo.addPoints(classId, log.studentId, -log.delta);
    repo.deleteLog(classId, id);
  });
  return { id };
}

function clearStudentLogs(classId, studentId) {
  ensureClass(classId);
  const removed = repo.deleteLogsOfStudent(classId, studentId);
  return { removed };
}

function clearAllLogs(classId) {
  ensureClass(classId);
  const removed = repo.clearLogs(classId);
  return { removed };
}

/* ============ 快捷规则 ============ */
function listRules(classId) {
  ensureClass(classId);
  const rules = repo.listRules(classId);
  return rules;
}

function addRule(classId, { name, score }) {
  ensureClass(classId);
  const rules = repo.insertRule(classId, { id: genId('rule'), name, score });
  return rules;
}

function deleteRule(classId, id) {
  ensureClass(classId);
  repo.deleteRule(classId, id);
  return repo.listRules(classId);
}

function resetRules(classId) {
  ensureClass(classId);
  repo.clearRules(classId);
  db.transaction(() => {
    for (const rule of DEFAULT_RULES) repo.insertRule(classId, { id: genId('rule'), ...rule });
  });
  return repo.listRules(classId);
}

function importRules(classId, buffer) {
  ensureClass(classId);
  const rows = readSheet(buffer);
  const added = [];
  db.transaction(() => {
    for (const row of rows) {
      const name = String(pick(row, ['规则名', '名称', 'name'], '')).trim();
      const score = toNumber(pick(row, ['分值', '分数', 'score'], ''), NaN);
      if (!name || !Number.isFinite(score) || score === 0) continue;
      added.push({ name: name.slice(0, 20), score: Math.trunc(score) });
      repo.insertRule(classId, { id: genId('rule'), name: name.slice(0, 20), score: Math.trunc(score) });
    }
  });
  return { added: added.length, rules: repo.listRules(classId) };
}

function ruleTemplate() {
  return buildBuffer([{ name: '快捷规则', rows: [{ 规则名: '作业优秀', 分值: 2 }, { 规则名: '迟到', 分值: -1 }], cols: [16, 10] }]);
}

/* ============ 积分商城 ============ */
function listGifts(classId) {
  ensureClass(classId);
  return repo.listGifts(classId);
}

function addGift(classId, data) {
  ensureClass(classId);
  return repo.insertGift(classId, { id: genId('gift'), ...data });
}

function updateGift(classId, id, patch) {
  ensureClass(classId);
  const gift = repo.findGift(classId, id);
  if (!gift) throw new NotFoundError('礼物不存在');
  return repo.updateGift(classId, id, patch);
}

function deleteGift(classId, id) {
  ensureClass(classId);
  repo.softDeleteGift(classId, id);
  return { id };
}

function redeem(classId, giftId, studentIds, operator = {}) {
  ensureClass(classId);
  const gift = repo.findGift(classId, giftId);
  if (!gift) throw new NotFoundError('礼物不存在或已下架');
  if (gift.stock !== null && gift.stock !== undefined && gift.stock <= 0) throw new BusinessError('该礼物已兑完');
  const students = repo.findStudentsByIds(classId, studentIds);
  if (!students.length) throw new NotFoundError('请选择要兑换的学生');
  const notEnough = students.filter((s) => s.points < gift.cost);
  if (notEnough.length) {
    throw new BusinessError(`积分不足：${notEnough.map((s) => s.name).join('、')}（需 ${gift.cost} 分）`, 'NOT_ENOUGH_POINTS');
  }
  const now = Date.now();
  db.transaction(() => {
    for (const student of students) {
      repo.addPoints(classId, student.id, -gift.cost);
      repo.insertLog({
        id: genId('log'),
        classId,
        studentId: student.id,
        studentName: student.name,
        delta: -gift.cost,
        reason: `兑换：${gift.name}`,
        kind: 'redeem',
        operatorId: operator.accountId || '',
        operatorName: operator.name || '',
        operatorRole: operator.role || '',
        createdAt: now,
      });
      repo.insertRedemption({
        id: genId('rd'),
        classId,
        giftId: gift.id,
        giftName: gift.name,
        cost: gift.cost,
        studentId: student.id,
        studentName: student.name,
        createdAt: now,
      });
      if (gift.stock !== null && gift.stock !== undefined) repo.decrementStock(classId, gift.id);
    }
  });
  return { redeemed: students.length, gift: repo.findGift(classId, giftId) };
}

function redemptions(classId, opts) {
  ensureClass(classId);
  return repo.listRedemptions(classId, opts);
}

/* ============ 排座 ============ */
function defaultSeats(cols, rows) {
  return new Array(cols * rows).fill(null);
}

function buildSeatPlan(classId, { cols, rows, scheme }) {
  const students = repo.listStudents(classId, { sort: 'points_desc' });
  const capacity = Math.min(cols * rows, MAX_SEATS);
  let ordered;
  if (scheme === 'random') {
    ordered = [...students].sort(() => Math.random() - 0.5);
  } else if (scheme === 'snake') {
    ordered = [...students];
  } else {
    ordered = [...students];
  }
  const seats = defaultSeats(cols, rows);
  if (scheme === 'snake') {
    // 蛇形：高分学生沿 S 形分布，避免好座位集中在第一排
    let idx = 0;
    for (let r = 0; r < rows; r += 1) {
      const rowSeats = [];
      for (let c = 0; c < cols; c += 1) rowSeats.push(r * cols + c);
      const target = r % 2 === 0 ? rowSeats : rowSeats.reverse();
      for (const seatIndex of target) {
        if (idx >= ordered.length || idx >= capacity) break;
        seats[seatIndex] = ordered[idx].id;
        idx += 1;
      }
    }
  } else {
    for (let i = 0; i < ordered.length && i < capacity; i += 1) seats[i] = ordered[i].id;
  }
  const unseated = students.slice(ordered.length > capacity ? capacity : ordered.length).map((s) => ({ id: s.id, name: s.name }));
  return { cols, rows, scheme, seats, unseated };
}

function getSeatPlan(classId) {
  ensureClass(classId);
  const plan = repo.getSeatPlan(classId);
  const students = repo.listStudents(classId, { sort: 'points_desc' });
  const byId = new Map(students.map((s) => [s.id, s]));
  if (!plan) {
    const generated = buildSeatPlan(classId, { cols: 8, rows: 7, scheme: 'points' });
    return { ...generated, angle: 'teacher', confirmedAt: null, students: students.map((s) => ({ id: s.id, name: s.name, points: s.points, groupName: s.groupName })), unseated: students.slice(generated.seats.filter(Boolean).length).map((s) => ({ id: s.id, name: s.name })) };
  }
  const seats = plan.seats.map((id) => (id && byId.has(id) ? id : null));
  const seated = new Set(seats.filter(Boolean));
  return {
    ...plan,
    seats,
    unseated: students.filter((s) => !seated.has(s.id)).map((s) => ({ id: s.id, name: s.name })),
    students: students.map((s) => ({ id: s.id, name: s.name, points: s.points, groupName: s.groupName })),
  };
}

function saveSeatPlan(classId, data, { confirm = false } = {}) {
  ensureClass(classId);
  const ids = new Set(repo.listStudents(classId, {}).map((s) => s.id));
  const seats = data.seats.slice(0, data.cols * data.rows).map((id) => (id && ids.has(id) ? id : null));
  while (seats.length < data.cols * data.rows) seats.push(null);
  const plan = repo.saveSeatPlan(classId, { ...data, seats, confirmedAt: confirm ? Date.now() : undefined });
  return plan;
}

function autoSeat(classId, { cols, rows, scheme }) {
  ensureClass(classId);
  return buildSeatPlan(classId, { cols, rows, scheme });
}

/* ============ 成绩 ============ */
function listExams(classId) {
  ensureClass(classId);
  return repo.listExams(classId);
}

function examTemplate() {
  return buildBuffer([{ name: '成绩导入', rows: [{ 姓名: '张小明', 成绩: 95 }, { 姓名: '李小红', 成绩: 88 }], cols: [12, 10] }]);
}

function importScores(classId, buffer, examName, fullScore = 100) {
  ensureClass(classId);
  const rows = readSheet(buffer);
  if (!rows.length) throw new BusinessError('表格里没有数据');
  const students = repo.findStudentsByNames(classId);
  const byName = new Map(students.map((s) => [s.name, s]));
  const matched = [];
  const unmatched = [];
  for (const row of rows) {
    const name = String(pick(row, ['姓名', '学生姓名', 'name'], '')).trim();
    const score = toNumber(pick(row, ['成绩', '分数', '得分', 'score'], ''), NaN);
    if (!name) continue;
    if (!Number.isFinite(score)) {
      unmatched.push({ name, reason: '成绩为空或不是数字' });
      continue;
    }
    const student = byName.get(name);
    if (!student) {
      unmatched.push({ name, reason: '班级中没有该学生' });
      continue;
    }
    matched.push({ studentId: student.id, name, score });
  }
  if (!matched.length) throw new BusinessError('没有匹配到任何学生成绩，请确认表头包含「姓名」「成绩」');
  const examId = genId('exam');
  db.transaction(() => {
    repo.insertExam(classId, { id: examId, name: examName, fullScore });
    for (const item of matched) {
      repo.upsertScore(classId, { id: genId('sc'), examId, studentId: item.studentId, score: item.score });
    }
  });
  return { examId, matched: matched.length, unmatched };
}

function deleteExam(classId, id) {
  ensureClass(classId);
  repo.deleteExam(classId, id);
  return { id };
}

function percent(part, total) {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

function scoreStats(classId, examId, view = 'student') {
  ensureClass(classId);
  const exams = repo.listExams(classId);
  const exam = examId ? exams.find((e) => e.id === examId) : exams[0];
  if (!exam) return { exams, exam: null, view, items: [], summary: null };
  const rows = repo.scoresOfExam(classId, exam.id);
  const fullScore = exam.fullScore || 100;
  const values = rows.map((r) => r.score);
  const avg = values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) : 0;
  const summary = {
    count: rows.length,
    avg,
    max: values.length ? Math.max(...values) : 0,
    min: values.length ? Math.min(...values) : 0,
    passRate: percent(values.filter((v) => v >= fullScore * 0.6).length, values.length),
    excellentRate: percent(values.filter((v) => v >= fullScore * 0.85).length, values.length),
    buckets: [
      { label: '不及格', count: values.filter((v) => v < fullScore * 0.6).length },
      { label: '及格', count: values.filter((v) => v >= fullScore * 0.6 && v < fullScore * 0.7).length },
      { label: '中等', count: values.filter((v) => v >= fullScore * 0.7 && v < fullScore * 0.8).length },
      { label: '良好', count: values.filter((v) => v >= fullScore * 0.8 && v < fullScore * 0.9).length },
      { label: '优秀', count: values.filter((v) => v >= fullScore * 0.9).length },
    ],
  };

  const ranked = [...rows].sort((a, b) => b.score - a.score);
  const rankMap = new Map(ranked.map((r, i) => [r.studentId, i + 1]));

  if (view === 'group') {
    const map = new Map();
    for (const r of rows) {
      const key = r.groupName || '未分组';
      const item = map.get(key) || { name: key, count: 0, total: 0, max: 0, min: Infinity };
      item.count += 1;
      item.total += r.score;
      item.max = Math.max(item.max, r.score);
      item.min = Math.min(item.min, r.score);
      map.set(key, item);
    }
    const items = [...map.values()]
      .map((g) => ({ name: g.name, count: g.count, avg: Number((g.total / g.count).toFixed(1)), max: g.max, min: g.min }))
      .sort((a, b) => b.avg - a.avg);
    return { exams, exam, view, items, summary };
  }

  if (view === 'class') {
    return { exams, exam, view, items: ranked.map((r) => ({ ...r, rank: rankMap.get(r.studentId) })), summary };
  }

  const items = rows
    .map((r) => ({
      studentId: r.studentId,
      name: r.name,
      groupName: r.groupName,
      score: r.score,
      rank: rankMap.get(r.studentId),
      diff: Number((r.score - avg).toFixed(1)),
    }))
    .sort((a, b) => a.rank - b.rank);
  return { exams, exam, view, items, summary };
}

function studentScoreDetail(classId, studentId) {
  ensureClass(classId);
  const student = repo.findStudent(classId, studentId);
  if (!student) throw new NotFoundError('学生不存在');
  const records = repo.scoresOfStudent(classId, studentId);
  const trend = records.map((r) => ({ examId: r.examId, name: r.name, score: r.score, fullScore: r.fullScore }));
  let advice;
  if (!records.length) {
    advice = '该生还没有成绩数据，先在「成绩」里导入一次考试吧。';
  } else {
    const scores = records.map((r) => r.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const first = scores[0];
    const last = scores[scores.length - 1];
    const delta = last - first;
    const trendText = delta >= 5 ? '整体呈上升趋势' : delta <= -5 ? '近期有所下滑' : '成绩比较平稳';
    const levelText = avg >= 85 ? '属于班级前列' : avg >= 70 ? '处于中等偏上水平' : '基础还需加强';
    const suggestion =
      avg >= 85
        ? '建议保持节奏，适当挑战拓展题，避免因粗心丢分。'
        : avg >= 70
          ? '建议每天安排 20 分钟专项练习，把错题按知识点归类复盘。'
          : '建议先从课本基础题入手，配合每日一练，并及时与家长沟通配合。';
    advice = `平均分 ${avg.toFixed(1)} 分，${levelText}；最近一次 ${last} 分，${trendText}（较首次 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} 分）。${suggestion}`;
  }
  return { student, records, trend, advice };
}

/* ============ 清空 / 回收站 ============ */
function snapshot(classId, kind, title, operator = {}) {
  const payload = {
    students: db.all('SELECT * FROM students WHERE class_id = ? AND deleted_at IS NULL', [classId]),
    logs: db.all('SELECT * FROM point_logs WHERE class_id = ?', [classId]),
    gifts: db.all('SELECT * FROM gifts WHERE class_id = ? AND deleted_at IS NULL', [classId]),
    redemptions: db.all('SELECT * FROM redemptions WHERE class_id = ?', [classId]),
    rules: db.all('SELECT * FROM quick_rules WHERE class_id = ?', [classId]),
    seat: db.get('SELECT * FROM seat_plans WHERE class_id = ?', [classId]) || null,
  };
  db.run('INSERT INTO recycle (id, class_id, kind, title, payload, operator_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    genId('rc'),
    classId,
    kind,
    title,
    JSON.stringify(payload),
    operator.accountId || '',
    Date.now(),
  ]);
  return payload;
}

function resetPoints(classId, operator = {}) {
  ensureClass(classId);
  db.transaction(() => {
    snapshot(classId, 'clear_points', '清空积分', operator);
    repo.resetPoints(classId);
    repo.clearLogs(classId);
  });
  return { ok: true };
}

function clearAllData(classId, operator = {}) {
  ensureClass(classId);
  db.transaction(() => {
    snapshot(classId, 'clear_all', '清空班级数据', operator);
    db.run('DELETE FROM point_logs WHERE class_id = ?', [classId]);
    db.run('UPDATE students SET deleted_at = ? WHERE class_id = ?', [Date.now(), classId]);
    db.run('UPDATE gifts SET deleted_at = ? WHERE class_id = ?', [Date.now(), classId]);
    db.run('DELETE FROM redemptions WHERE class_id = ?', [classId]);
    db.run('DELETE FROM seat_plans WHERE class_id = ?', [classId]);
  });
  return { ok: true };
}

/* ============ 导出 ============ */
function rankingCsv(classId, { from, to } = {}) {
  ensureClass(classId);
  const students = repo.listStudents(classId, { sort: 'points_desc' });
  const sums =
    from || to
      ? new Map(repo.listLogsForRange(classId, from || 0, to || Date.now()).map((r) => [r.studentId, Number(r.points || 0)]))
      : null;
  const rows = students.map((s, i) => [
    i + 1,
    s.name,
    s.groupName || '',
    s.position || '',
    sums ? sums.get(s.id) || 0 : s.points,
  ]);
  return toCsv(['排名', '姓名', '小组', '职务', sums ? '时段积分' : '总积分'], rows);
}

function logsCsv(classId, { from, to, search } = {}) {
  ensureClass(classId);
  const { items } = repo.listLogs(classId, { from, to, search, page: 1, pageSize: 100000 });
  const rows = items.map((l) => [
    new Date(l.createdAt).toLocaleString('zh-CN'),
    l.studentName,
    l.delta > 0 ? `+${l.delta}` : l.delta,
    l.reason || '',
    l.operatorName || '',
    l.operatorRole || '',
  ]);
  return toCsv(['时间', '学生', '分值', '原因', '操作人', '操作角色'], rows);
}

function redemptionsCsv(classId) {
  ensureClass(classId);
  const rows = repo.allRedemptions(classId).map((r) => [new Date(r.createdAt).toLocaleString('zh-CN'), r.studentName, r.giftName, r.cost]);
  return toCsv(['时间', '学生', '礼物', '消耗积分'], rows);
}

module.exports = {
  overview,
  updateProfile,
  addStudent,
  updateStudent,
  deleteStudent,
  listStudents,
  groups,
  importStudents,
  studentTemplate,
  studentsWorkbook,
  applyPoints,
  logs,
  removeLog,
  clearStudentLogs,
  clearAllLogs,
  listRules,
  addRule,
  deleteRule,
  resetRules,
  importRules,
  ruleTemplate,
  listGifts,
  addGift,
  updateGift,
  deleteGift,
  redeem,
  redemptions,
  getSeatPlan,
  saveSeatPlan,
  autoSeat,
  listExams,
  examTemplate,
  importScores,
  deleteExam,
  scoreStats,
  studentScoreDetail,
  resetPoints,
  clearAllData,
  rankingCsv,
  logsCsv,
  redemptionsCsv,
  DEFAULT_RULES,
};
