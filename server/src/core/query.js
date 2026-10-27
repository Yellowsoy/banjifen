'use strict';
/**
 * 成绩对外查询（免登录）：老师把「班级口令 + 学生学号/家长手机号后 4 位」发给家长，
 * 家长在公开页面自助查询，不需要任何账号。
 *
 * 安全边界：
 * 1. 每次查询必须命中一次有效口令（口令可随时停用、可设有效期），停用后链接立即失效；
 * 2. 只返回「命中的那一个学生」的数据，绝不返回班级名单或他人信息；
 * 3. 家长联系方式一律脱敏输出；
 * 4. 失败查询计入 operation_logs，超管可以看到是否有人在暴力试探。
 */
const db = require('../db');
const { NotFoundError, BusinessError, BusinessError: BadRequestError } = require('./errors');
const { record } = require('./audit');
const settings = require('./settings');

/** 全局总开关：关闭后公开查询页与接口一律不可用（教师端工作台不受影响） */
function assertFeatureEnabled() {
  if (!settings.getBool('public_query_enabled', true)) {
    throw new BusinessError('成绩自助查询功能已暂时关闭，如有疑问请联系学校管理员');
  }
}

const MODE_LABEL = {
  name_no: '学号 + 姓名',
  phone: '姓名 + 家长手机号后 4 位',
  none: '仅姓名',
};

function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 7) return s ? `${s.slice(0, 3)}***` : '';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

function findToken(token) {
  const row = db.get('SELECT * FROM query_tokens WHERE token = ?', [String(token || '').trim().toUpperCase()]);
  if (!row) throw new NotFoundError('查询口令不存在');
  if (!row.enabled) throw new BusinessError('该查询口令已被停用，请联系老师');
  if (row.expires_at && Date.now() > Number(row.expires_at)) throw new BusinessError('该查询口令已过期，请联系老师重新生成');
  const cls = db.get('SELECT id, name, school, grade, badge FROM classes WHERE id = ? AND deleted_at IS NULL', [row.class_id]);
  if (!cls) throw new NotFoundError('关联班级不存在');
  return { row, cls };
}

function locateStudent(classId, mode, { studentNo = '', name = '', phoneTail = '' }) {
  const target = String(name || '').trim();
  if (!target) throw new BusinessError('请输入学生姓名');
  const rows = db.all(
    'SELECT * FROM students WHERE class_id = ? AND deleted_at IS NULL AND name = ?',
    [classId, target]
  );
  if (!rows.length) throw new NotFoundError('没有找到该学生，请核对姓名与学号');

  if (mode === 'none') return rows[0];
  if (mode === 'name_no') {
    const no = String(studentNo || '').trim();
    if (!no) throw new BusinessError('请输入学号');
    const hit = rows.find((r) => String(r.student_no || '').trim() === no);
    if (!hit) throw new NotFoundError('学号与姓名不匹配，请核对后重试');
    return hit;
  }
  // phone 模式：姓名 + 家长手机号后 4 位
  const tail = String(phoneTail || '').trim();
  if (!/^\d{4}$/.test(tail)) throw new BusinessError('请输入家长手机号后 4 位');
  const hit = rows.find(
    (r) => String(r.guardian_phone || '').slice(-4) === tail || String(r.guardian_alt_phone || '').slice(-4) === tail
  );
  if (!hit) throw new NotFoundError('手机号与姓名不匹配，请核对后重试');
  return hit;
}

function buildResult({ row, cls }, student, req) {
  const scope = row.scope || 'scores';
  const out = {
    className: cls.name,
    school: cls.school || '',
    mode: row.mode,
    modeLabel: MODE_LABEL[row.mode] || row.mode,
    student: {
      name: student.name,
      studentNo: student.student_no || '',
      groupName: student.group_name || '',
      position: student.position || '',
      guardianName: student.guardian_name || '',
      guardianPhoneMasked: maskPhone(student.guardian_phone),
      guardianRelation: student.guardian_relation || '',
    },
    points: null,
    exams: [],
    summary: null,
  };

  if (scope === 'points' || scope === 'all') {
    const rankRows = db.all(
      `SELECT id, points FROM students WHERE class_id = ? AND deleted_at IS NULL ORDER BY points DESC, created_at ASC`,
      [cls.id]
    );
    const rank = rankRows.findIndex((r) => r.id === student.id) + 1;
    out.points = {
      value: student.points,
      rank,
      total: rankRows.length,
      recentLogs: db
        .all(
          'SELECT delta, reason, kind, created_at FROM point_logs WHERE class_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT 10',
          [cls.id, student.id]
        )
        .map((l) => ({ delta: l.delta, reason: l.reason, kind: l.kind, createdAt: l.created_at })),
    };
  }

  if (scope === 'scores' || scope === 'all') {
    const exams = db.all('SELECT * FROM exams WHERE class_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 30', [cls.id]);
    out.exams = exams.map((exam) => {
      const mine = db.get('SELECT score FROM scores WHERE exam_id = ? AND student_id = ?', [exam.id, student.id]);
      const agg = db.get(
        `SELECT AVG(score) AS avg_score, MAX(score) AS max_score, COUNT(*) AS cnt
           FROM scores WHERE exam_id = ?`,
        [exam.id]
      );
      const all = db.all('SELECT score FROM scores WHERE exam_id = ?', [exam.id]).map((r) => r.score);
      const rankRows = db
        .all('SELECT student_id, score FROM scores WHERE exam_id = ? ORDER BY score DESC', [exam.id])
        .map((r) => r.student_id);
      return {
        examId: exam.id,
        examName: exam.name,
        fullScore: exam.full_score,
        createdAt: exam.created_at,
        score: mine ? mine.score : null,
        classAvg: agg && agg.avg_score != null ? Number(agg.avg_score.toFixed(1)) : null,
        classMax: agg && agg.max_score != null ? agg.max_score : null,
        count: all.length,
        rank: mine ? rankRows.indexOf(student.id) + 1 : null,
      };
    });
    const valid = out.exams.filter((e) => e.score != null);
    if (valid.length) {
      const avg = valid.reduce((s, e) => s + e.score, 0) / valid.length;
      out.summary = {
        examCount: valid.length,
        average: Number(avg.toFixed(1)),
        latest: valid[0] ? { name: valid[0].examName, score: valid[0].score, rank: valid[0].rank, fullScore: valid[0].fullScore } : null,
      };
    }
  }

  db.run('UPDATE query_tokens SET last_used_at = ? WHERE id = ?', [Date.now(), row.id]);
  record({
    req,
    module: 'query',
    action: 'query.public',
    targetType: 'student',
    targetId: student.id,
    targetName: student.name,
    summary: `家长自助查询：${cls.name} / ${student.name}（口令 ${row.token}）`,
    detail: { scope, mode: row.mode, classId: cls.id },
  });
  return out;
}

function query(token, payload, req) {
  assertFeatureEnabled();
  const ctx = findToken(token);
  const student = locateStudent(ctx.cls.id, ctx.row.mode, payload);
  return buildResult(ctx, student, req);
}

/** 公开元信息：先告诉前端这个口令需要哪些输入项，无需先提交 */
function info(token) {
  assertFeatureEnabled();
  const { row, cls } = findToken(token);
  return {
    className: cls.name,
    school: cls.school || '',
    badge: cls.badge || '',
    scope: row.scope,
    mode: row.mode,
    modeLabel: MODE_LABEL[row.mode] || row.mode,
    fields: row.mode === 'name_no' ? ['name', 'studentNo'] : row.mode === 'phone' ? ['name', 'phoneTail'] : ['name'],
  };
}

module.exports = { query, info, MODE_LABEL };
