'use strict';
const express = require('express');
const multer = require('multer');
const { requireAuth, requireCap, requireClass } = require('../../middleware/auth');
const { ForbiddenError } = require('../../core/errors');
const { can } = require('../../core/policy');
const { trail, failureTrail } = require('../../middleware/audit-trail');
const controller = require('./class.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

// 班级成员（班主任 / 老师 / 班干部）才可访问，且必须绑定班级
router.use(requireAuth('owner', 'teacher', 'cadre'), requireClass);
// 越权与失败尝试统一留痕
router.use(failureTrail('class'));

/** 批量加减分需要更高级别的能力，单条接口在此处做二次判定 */
function guardBatch(req, res, next) {
  const ids = req.body && req.body.studentIds;
  if (Array.isArray(ids) && ids.length > 1 && !can(req.auth.role, 'points:batch')) {
    return next(new ForbiddenError('当前角色不支持批量加减分'));
  }
  return next();
}

/** 把受影响的学生 id 翻译成「张三、李四…」，日志里能直接看到人 */
function humanizeStudents(db, ids) {
  try {
    const list = db
      .all(`SELECT name FROM students WHERE id IN (${ids.map(() => '?').join(',') || "''"})`, ids)
      .map((r) => r.name);
    return list.join('、');
  } catch {
    return '';
  }
}

const db = require('../../db');

router.get('/overview', controller.overview);
router.put(
  '/profile',
  requireCap('class:profile'),
  trail({
    module: 'class',
    action: 'class.updateProfile',
    targetType: 'class',
    summary: ({ body }) => `修改了班级资料：${[body && body.className ? `名称→${body.className}` : '', body && body.school !== undefined ? `学校→${body.school}` : '', body && body.grade !== undefined ? `年级→${body.grade}` : ''].filter(Boolean).join('，') || '（含徽章更新）'}`,
  }),
  controller.updateProfile
);

router.get('/students', requireCap('student:read'), controller.listStudents);
router.post(
  '/students',
  requireCap('student:create'),
  trail({
    module: 'class',
    action: 'student.create',
    targetType: 'student',
    targetName: ({ body }) => (body && body.name) || '',
    summary: ({ body }) => `新增学生「${(body && body.name) || '未命名'}」` +
      `${body && body.groupName ? `，小组 ${body.groupName}` : ''}${body && body.guardianPhone ? `，家长电话 ${body.guardianPhone}` : ''}`,
  }),
  controller.createStudent
);
router.get('/students/template', requireCap('student:create'), controller.studentTemplate);
router.get(
  '/students/export.xlsx',
  requireCap('export:data'),
  trail({
    module: 'class',
    action: 'export.students',
    targetType: 'file',
    targetName: '学生档案 Excel',
    summary: '导出了本班学生档案 Excel（含家长联系方式）',
  }),
  controller.exportStudents
);
router.post(
  '/students/import',
  requireCap('student:create'),
  upload.single('file'),
  trail({
    module: 'class',
    action: 'student.import',
    targetType: 'student',
    summary: ({ body, req: r }) => `批量导入花名册（文件：${(r.file && r.file.originalname) || '未知文件'}）`,
    amount: ({ body }) => (body && body.added !== undefined ? `新增 ${body.added} 人` : ''),
  }),
  controller.importStudents
);

router.patch(
  '/students/:id',
  requireCap('student:update'),
  trail({
    module: 'class',
    action: 'student.update',
    targetType: 'student',
    entity: { param: 'id', table: 'students', nameField: 'name' },
    summary: ({ diff, before }) => {
      if (!diff) return `编辑学生「${(before && before.name) || ''}」（内容无变化）`;
      const keys = Object.keys(diff);
      return `编辑学生「${(before && before.name) || ''}」：${keys.map((k) => `${k} ${JSON.stringify(diff[k].from)}→${JSON.stringify(diff[k].to)}`).slice(0, 6).join('；')}`;
    },
  }),
  controller.updateStudent
);
router.delete(
  '/students/:id',
  requireCap('student:delete'),
  trail({
    module: 'class',
    action: 'student.delete',
    targetType: 'student',
    entity: { param: 'id', table: 'students', nameField: 'name' },
    summary: ({ before }) => `删除学生「${(before && before.name) || ''}」` +
      `${before && before.guardian_phone ? `（家长 ${before.guardian_name || ''} ${before.guardian_phone}）` : ''}`,
  }),
  controller.deleteStudent
);
router.delete(
  '/students/:id/logs',
  requireCap('history:delete'),
  trail({
    module: 'class',
    action: 'student.clearLogs',
    targetType: 'student',
    entity: { param: 'id', table: 'students', nameField: 'name' },
    summary: ({ before }) => `清空学生「${(before && before.name) || ''}」的积分记录`,
  }),
  controller.clearStudentLogs
);

router.get('/groups', requireCap('class:read'), controller.listGroups);

router.post(
  '/points',
  requireCap('points:single'),
  guardBatch,
  trail({
    module: 'class',
    action: 'points.apply',
    targetType: 'student',
    targetName: ({ body }) => {
      const ids = (body && body.studentIds) || [];
      return humanizeStudents(db, ids).slice(0, 120);
    },
    amount: ({ body }) => {
      const n = ((body && body.studentIds) || []).length || 1;
      const d = body ? Number(body.delta) : 0;
      return `${d > 0 ? '+' : ''}${d} 分 × ${n} 人`;
    },
    summary: ({ body }) => {
      const ids = (body && body.studentIds) || [];
      const names = humanizeStudents(db, ids).slice(0, 200);
      const d = body ? Number(body.delta) : 0;
      return `${d > 0 ? '加分' : '减分'} ${Math.abs(d)} 分给 ${ids.length} 人：${names || '（名单见明细）'}` +
        `${body && body.reason ? `；原因：${body.reason}` : ''}`;
    },
  }),
  controller.applyPoints
);
router.get('/logs', requireCap('history:read'), controller.listLogs);
router.get(
  '/logs/export.csv',
  requireCap('export:data'),
  trail({
    module: 'class',
    action: 'export.logs',
    targetType: 'file',
    targetName: '积分记录 CSV',
    summary: ({ req: r }) => `导出了积分记录 CSV（${JSON.stringify(r.query)}）`,
  }),
  controller.exportLogs
);
router.delete(
  '/logs',
  requireCap('history:clear'),
  trail({
    module: 'class',
    action: 'logs.clearAll',
    targetType: 'class',
    summary: '清空了本班全部积分记录',
  }),
  controller.clearLogs
);
router.delete(
  '/logs/:id',
  requireCap('history:delete'),
  trail({
    module: 'class',
    action: 'logs.delete',
    targetType: 'pointLog',
    summary: ({ req: r }) => `删除了一条积分记录（${r.params.id}）`,
  }),
  controller.deleteLog
);
router.get(
  '/ranking/export.csv',
  requireCap('export:data'),
  trail({
    module: 'class',
    action: 'export.ranking',
    targetType: 'file',
    targetName: '积分榜单 CSV',
    summary: ({ req: r }) => `导出了积分榜单 CSV（${JSON.stringify(r.query)}）`,
  }),
  controller.exportRanking
);

router.get('/rules', requireCap('rules:read'), controller.listRules);
router.post(
  '/rules',
  requireCap('rules:write'),
  trail({
    module: 'class',
    action: 'rule.create',
    targetType: 'rule',
    targetName: ({ body }) => (body && body.name) || '',
    summary: ({ body }) => `新增快捷规则「${(body && body.name) || ''}」${body && body.score ? ` ${body.score > 0 ? '+' : ''}${body.score} 分` : ''}`,
  }),
  controller.addRule
);
router.post(
  '/rules/reset',
  requireCap('rules:write'),
  trail({
    module: 'class',
    action: 'rule.reset',
    targetType: 'rule',
    summary: '恢复了默认快捷规则（原有自定义规则被替换）',
  }),
  controller.resetRules
);
router.get('/rules/template', requireCap('rules:read'), controller.ruleTemplate);
router.post(
  '/rules/import',
  requireCap('rules:write'),
  upload.single('file'),
  trail({
    module: 'class',
    action: 'rule.import',
    targetType: 'rule',
    summary: '批量导入快捷规则',
  }),
  controller.importRules
);
router.delete(
  '/rules/:id',
  requireCap('rules:write'),
  trail({
    module: 'class',
    action: 'rule.delete',
    targetType: 'rule',
    entity: { param: 'id', table: 'quick_rules', nameField: 'name' },
    summary: ({ before }) => `删除快捷规则「${(before && before.name) || ''}」${before ? ` ${before.score > 0 ? '+' : ''}${before.score} 分` : ''}`,
  }),
  controller.deleteRule
);

router.get('/gifts', requireCap('gift:read'), controller.listGifts);
router.post(
  '/gifts',
  requireCap('gift:write'),
  trail({
    module: 'class',
    action: 'gift.create',
    targetType: 'gift',
    targetName: ({ body }) => (body && body.name) || '',
    summary: ({ body }) => `新增礼物「${(body && body.name) || ''}」${body && body.cost ? `，${body.cost} 积分` : ''}`,
  }),
  controller.addGift
);
router.patch(
  '/gifts/:id',
  requireCap('gift:write'),
  trail({
    module: 'class',
    action: 'gift.update',
    targetType: 'gift',
    entity: { param: 'id', table: 'gifts', nameField: 'name' },
    summary: ({ before, diff }) => `修改礼物「${(before && before.name) || ''}」${diff ? `：${Object.keys(diff).join('、')}` : ''}`,
  }),
  controller.updateGift
);
router.delete(
  '/gifts/:id',
  requireCap('gift:write'),
  trail({
    module: 'class',
    action: 'gift.delete',
    targetType: 'gift',
    entity: { param: 'id', table: 'gifts', nameField: 'name' },
    summary: ({ before }) => `删除礼物「${(before && before.name) || ''}」`,
  }),
  controller.deleteGift
);
router.post(
  '/gifts/:id/redeem',
  requireCap('gift:redeem'),
  trail({
    module: 'class',
    action: 'gift.redeem',
    targetType: 'gift',
    entity: { param: 'id', table: 'gifts', nameField: 'name' },
    targetName: ({ before }) => (before && before.name) || '',
    summary: ({ before, body }) => {
      const ids = (body && body.studentIds) || [];
      const names = humanizeStudents(db, ids).slice(0, 200);
      return `兑换礼物「${(before && before.name) || ''}」（${before ? before.cost : '?'} 积分/份）给 ${ids.length} 人：${names || '（名单见明细）'}`;
    },
    amount: ({ before, body }) => {
      const n = ((body && body.studentIds) || []).length;
      return before ? `消耗 ${before.cost * n} 积分` : '';
    },
  }),
  controller.redeem
);
router.get('/redemptions', requireCap('gift:read'), controller.listRedemptions);
router.get(
  '/redemptions/export.csv',
  requireCap('gift:read'),
  trail({
    module: 'class',
    action: 'export.redemptions',
    targetType: 'file',
    targetName: '兑换记录 CSV',
    summary: '导出了兑换记录 CSV',
  }),
  controller.exportRedemptions
);

router.get('/seat', requireCap('seat:read'), controller.getSeat);
router.put(
  '/seat',
  requireCap('seat:write'),
  trail({
    module: 'class',
    action: 'seat.save',
    targetType: 'seat',
    summary: ({ body }) => `保存排座方案${body && body.confirm ? '（已确认）' : ''}${body ? `：${body.cols || '?'}×${body.rows || '?'}，${((body.seats) || []).length} 个座位` : ''}`,
  }),
  controller.putSeat
);
router.post(
  '/seat/auto',
  requireCap('seat:write'),
  trail({
    module: 'class',
    action: 'seat.auto',
    targetType: 'seat',
    summary: ({ body }) => `按积分自动排座（方案：${(body && body.scheme) || '默认'}，${body ? `${body.cols || '?'}×${body.rows || '?'}` : ''}）`,
  }),
  controller.autoSeat
);

router.get('/exams', requireCap('exam:read'), controller.listExams);
router.get('/exams/template', requireCap('exam:read'), controller.examTemplate);
router.post(
  '/exams/import',
  requireCap('exam:import'),
  upload.single('file'),
  trail({
    module: 'class',
    action: 'exam.import',
    targetType: 'exam',
    targetName: ({ body }) => (body && body.examName) || '',
    summary: ({ body }) => `导入考试成绩「${(body && body.examName) || ''}」（满分 ${(body && body.fullScore) || 100}）`,
  }),
  controller.importScores
);
router.delete(
  '/exams/:id',
  requireCap('exam:delete'),
  trail({
    module: 'class',
    action: 'exam.delete',
    targetType: 'exam',
    entity: { param: 'id', table: 'exams', nameField: 'name' },
    summary: ({ before }) => `删除考试「${(before && before.name) || ''}」及其全部成绩`,
  }),
  controller.deleteExam
);
router.get('/scores', requireCap('exam:read'), controller.scores);
router.get('/scores/student/:id', requireCap('exam:read'), controller.studentScore);

router.post(
  '/reset-points',
  requireCap('class:reset-points'),
  trail({
    module: 'class',
    action: 'class.resetPoints',
    targetType: 'class',
    summary: '清空了全班积分与积分记录（快照已进入回收站）',
  }),
  controller.resetPoints
);
router.post(
  '/clear-all',
  requireCap('class:clear-all'),
  trail({
    module: 'class',
    action: 'class.clearAll',
    targetType: 'class',
    summary: '清空了本班全部数据（快照已进入回收站）',
  }),
  controller.clearAll
);

module.exports = router;
