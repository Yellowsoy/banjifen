'use strict';
const express = require('express');
const multer = require('multer');
const { requireAuth, requireCap, requireClass } = require('../../middleware/auth');
const { ForbiddenError } = require('../../core/errors');
const { can } = require('../../core/policy');
const controller = require('./class.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

// 班级成员（班主任 / 老师 / 班干部）才可访问，且必须绑定班级
router.use(requireAuth('owner', 'teacher', 'cadre'), requireClass);

/** 批量加减分需要更高级别的能力，单条接口在此处做二次判定 */
function guardBatch(req, res, next) {
  const ids = req.body && req.body.studentIds;
  if (Array.isArray(ids) && ids.length > 1 && !can(req.auth.role, 'points:batch')) {
    return next(new ForbiddenError('当前角色不支持批量加减分'));
  }
  return next();
}

router.get('/overview', controller.overview);
router.put('/profile', requireCap('class:profile'), controller.updateProfile);

router.get('/students', requireCap('student:read'), controller.listStudents);
router.post('/students', requireCap('student:create'), controller.createStudent);
router.get('/students/template', requireCap('student:create'), controller.studentTemplate);
router.post('/students/import', requireCap('student:create'), upload.single('file'), controller.importStudents);
router.patch('/students/:id', requireCap('student:update'), controller.updateStudent);
router.delete('/students/:id', requireCap('student:delete'), controller.deleteStudent);
router.delete('/students/:id/logs', requireCap('history:delete'), controller.clearStudentLogs);

router.get('/groups', requireCap('class:read'), controller.listGroups);

router.post('/points', requireCap('points:single'), guardBatch, controller.applyPoints);
router.get('/logs', requireCap('history:read'), controller.listLogs);
router.get('/logs/export.csv', requireCap('export:data'), controller.exportLogs);
router.delete('/logs', requireCap('history:clear'), controller.clearLogs);
router.delete('/logs/:id', requireCap('history:delete'), controller.deleteLog);
router.get('/ranking/export.csv', requireCap('export:data'), controller.exportRanking);

router.get('/rules', requireCap('rules:read'), controller.listRules);
router.post('/rules', requireCap('rules:write'), controller.addRule);
router.post('/rules/reset', requireCap('rules:write'), controller.resetRules);
router.get('/rules/template', requireCap('rules:read'), controller.ruleTemplate);
router.post('/rules/import', requireCap('rules:write'), upload.single('file'), controller.importRules);
router.delete('/rules/:id', requireCap('rules:write'), controller.deleteRule);

router.get('/gifts', requireCap('gift:read'), controller.listGifts);
router.post('/gifts', requireCap('gift:write'), controller.addGift);
router.patch('/gifts/:id', requireCap('gift:write'), controller.updateGift);
router.delete('/gifts/:id', requireCap('gift:write'), controller.deleteGift);
router.post('/gifts/:id/redeem', requireCap('gift:redeem'), controller.redeem);
router.get('/redemptions', requireCap('gift:read'), controller.listRedemptions);
router.get('/redemptions/export.csv', requireCap('gift:read'), controller.exportRedemptions);

router.get('/seat', requireCap('seat:read'), controller.getSeat);
router.put('/seat', requireCap('seat:write'), controller.putSeat);
router.post('/seat/auto', requireCap('seat:write'), controller.autoSeat);

router.get('/exams', requireCap('exam:read'), controller.listExams);
router.get('/exams/template', requireCap('exam:read'), controller.examTemplate);
router.post('/exams/import', requireCap('exam:import'), upload.single('file'), controller.importScores);
router.delete('/exams/:id', requireCap('exam:delete'), controller.deleteExam);
router.get('/scores', requireCap('exam:read'), controller.scores);
router.get('/scores/student/:id', requireCap('exam:read'), controller.studentScore);

router.post('/reset-points', requireCap('class:reset-points'), controller.resetPoints);
router.post('/clear-all', requireCap('class:clear-all'), controller.clearAll);

module.exports = router;
