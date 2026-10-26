'use strict';
const { z, parse, schemas, id } = require('../../core/validation');
const { asyncHandler } = require('../../middleware/error');
const { BusinessError } = require('../../core/errors');
const service = require('./class.service');

function requireFile(req) {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    throw new BusinessError('请选择要上传的 Excel 文件');
  }
  return req.file.buffer;
}

function csvResponse(res, filename, content) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(content);
}

function xlsxResponse(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}

const listQuery = z.object({
  search: z.string().trim().max(40).optional().default(''),
  sort: z.enum(['points_desc', 'points_asc', 'created_desc', 'time', 'name']).optional().default('points_desc'),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(20),
  from: z.coerce.number().int().min(0).optional().default(0),
  to: z.coerce.number().int().min(0).optional().default(0),
});

const logQuery = z.object({
  search: z.string().trim().max(40).optional().default(''),
  from: z.coerce.number().int().min(0).optional().default(0),
  to: z.coerce.number().int().min(0).optional().default(0),
  studentId: z.string().max(64).optional().default(''),
  kind: z.string().max(20).optional().default(''),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(20),
});

function operatorOf(req) {
  return { accountId: req.auth.accountId, name: req.auth.name, role: req.auth.role };
}

const overview = asyncHandler(async (req, res) => {
  res.json(service.overview(req.auth.classId, req.auth));
});

const updateProfile = asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      className: z.string().trim().max(20, '班级名称最多 20 个字').optional(),
      badge: z.string().max(400000).optional(),
      school: z.string().trim().max(40).optional(),
      grade: z.string().trim().max(20).optional(),
    }),
    req.body
  );
  res.json(service.updateProfile(req.auth.classId, body));
});

const listStudents = asyncHandler(async (req, res) => {
  const query = parse(listQuery, req.query);
  res.json(service.listStudents(req.auth.classId, query));
});

const createStudent = asyncHandler(async (req, res) => {
  const body = parse(schemas.student, req.body);
  const student = service.addStudent(req.auth.classId, body);
  res.status(201).json(student);
});

const updateStudent = asyncHandler(async (req, res) => {
  const body = parse(schemas.studentUpdate, req.body);
  res.json(service.updateStudent(req.auth.classId, req.params.id, body));
});

const deleteStudent = asyncHandler(async (req, res) => {
  res.json(service.deleteStudent(req.auth.classId, req.params.id));
});

const importStudents = asyncHandler(async (req, res) => {
  const result = service.importStudents(req.auth.classId, requireFile(req));
  req.log.info('导入花名册', { added: result.added, duplicates: result.duplicates });
  res.json(result);
});

const studentTemplate = asyncHandler(async (req, res) => {
  xlsxResponse(res, '花名册导入模板.xlsx', service.studentTemplate());
});

const listGroups = asyncHandler(async (req, res) => {
  const query = parse(
    z.object({
      sort: z.enum(['desc', 'asc']).optional().default('desc'),
      search: z.string().trim().max(30).optional().default(''),
      from: z.coerce.number().int().min(0).optional().default(0),
      to: z.coerce.number().int().min(0).optional().default(0),
    }),
    req.query
  );
  res.json(service.groups(req.auth.classId, query));
});

const applyPoints = asyncHandler(async (req, res) => {
  const body = parse(schemas.points, req.body);
  const result = service.applyPoints(req.auth.classId, { ...body, operator: operatorOf(req) });
  res.json(result);
});

const listLogs = asyncHandler(async (req, res) => {
  const query = parse(logQuery, req.query);
  res.json(service.logs(req.auth.classId, query));
});

const deleteLog = asyncHandler(async (req, res) => {
  res.json(service.removeLog(req.auth.classId, req.params.id));
});

const clearLogs = asyncHandler(async (req, res) => {
  res.json(service.clearAllLogs(req.auth.classId));
});

const clearStudentLogs = asyncHandler(async (req, res) => {
  res.json(service.clearStudentLogs(req.auth.classId, req.params.id));
});

const exportLogs = asyncHandler(async (req, res) => {
  const query = parse(logQuery, req.query);
  csvResponse(res, '积分明细.csv', service.logsCsv(req.auth.classId, query));
});

const exportRanking = asyncHandler(async (req, res) => {
  const query = parse(listQuery, req.query);
  csvResponse(res, '积分排行榜.csv', service.rankingCsv(req.auth.classId, query));
});

const listRules = asyncHandler(async (req, res) => {
  res.json(service.listRules(req.auth.classId));
});

const addRule = asyncHandler(async (req, res) => {
  const body = parse(schemas.rule, req.body);
  res.status(201).json(service.addRule(req.auth.classId, body));
});

const deleteRule = asyncHandler(async (req, res) => {
  res.json(service.deleteRule(req.auth.classId, req.params.id));
});

const resetRules = asyncHandler(async (req, res) => {
  res.json(service.resetRules(req.auth.classId));
});

const importRules = asyncHandler(async (req, res) => {
  res.json(service.importRules(req.auth.classId, requireFile(req)));
});

const ruleTemplate = asyncHandler(async (req, res) => {
  xlsxResponse(res, '快捷规则模板.xlsx', service.ruleTemplate());
});

const listGifts = asyncHandler(async (req, res) => {
  res.json(service.listGifts(req.auth.classId));
});

const addGift = asyncHandler(async (req, res) => {
  const body = parse(schemas.gift, req.body);
  res.status(201).json(service.addGift(req.auth.classId, body));
});

const updateGift = asyncHandler(async (req, res) => {
  const body = parse(schemas.gift.partial(), req.body);
  res.json(service.updateGift(req.auth.classId, req.params.id, body));
});

const deleteGift = asyncHandler(async (req, res) => {
  res.json(service.deleteGift(req.auth.classId, req.params.id));
});

const redeem = asyncHandler(async (req, res) => {
  const body = parse(z.object({ studentIds: z.array(id).min(1, '请选择兑换的学生').max(200) }), req.body);
  res.json(service.redeem(req.auth.classId, req.params.id, body.studentIds, operatorOf(req)));
});

const listRedemptions = asyncHandler(async (req, res) => {
  const query = parse(
    z.object({
      page: z.coerce.number().int().min(1).optional().default(1),
      pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
    }),
    req.query
  );
  res.json(service.redemptions(req.auth.classId, query));
});

const exportRedemptions = asyncHandler(async (req, res) => {
  csvResponse(res, '兑换记录.csv', service.redemptionsCsv(req.auth.classId));
});

const getSeat = asyncHandler(async (req, res) => {
  res.json(service.getSeatPlan(req.auth.classId));
});

const putSeat = asyncHandler(async (req, res) => {
  const body = parse(schemas.seat, req.body);
  res.json(service.saveSeatPlan(req.auth.classId, body, { confirm: !!req.body.confirm }));
});

const autoSeat = asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      cols: z.coerce.number().int().min(1).max(20),
      rows: z.coerce.number().int().min(1).max(20),
      scheme: z.enum(['points', 'snake', 'random', 'manual']).optional().default('points'),
    }),
    req.body
  );
  res.json(service.autoSeat(req.auth.classId, body));
});

const listExams = asyncHandler(async (req, res) => {
  res.json(service.listExams(req.auth.classId));
});

const importScores = asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      examName: z.string().trim().min(1, '请输入考试名称').max(30, '考试名称最多 30 个字'),
      fullScore: z.coerce.number().min(1).max(1000).optional().default(100),
    }),
    req.body
  );
  res.json(service.importScores(req.auth.classId, requireFile(req), body.examName, body.fullScore));
});

const examTemplate = asyncHandler(async (req, res) => {
  xlsxResponse(res, '成绩导入模板.xlsx', service.examTemplate());
});

const deleteExam = asyncHandler(async (req, res) => {
  res.json(service.deleteExam(req.auth.classId, req.params.id));
});

const scores = asyncHandler(async (req, res) => {
  const query = parse(
    z.object({
      examId: z.string().max(64).optional().default(''),
      view: z.enum(['student', 'group', 'class']).optional().default('student'),
    }),
    req.query
  );
  res.json(service.scoreStats(req.auth.classId, query.examId, query.view));
});

const studentScore = asyncHandler(async (req, res) => {
  res.json(service.studentScoreDetail(req.auth.classId, req.params.id));
});

const resetPoints = asyncHandler(async (req, res) => {
  res.json(service.resetPoints(req.auth.classId, operatorOf(req)));
});

const clearAll = asyncHandler(async (req, res) => {
  res.json(service.clearAllData(req.auth.classId, operatorOf(req)));
});

module.exports = {
  overview,
  updateProfile,
  listStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  importStudents,
  studentTemplate,
  listGroups,
  applyPoints,
  listLogs,
  deleteLog,
  clearLogs,
  clearStudentLogs,
  exportLogs,
  exportRanking,
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
  listRedemptions,
  exportRedemptions,
  getSeat,
  putSeat,
  autoSeat,
  listExams,
  importScores,
  examTemplate,
  deleteExam,
  scores,
  studentScore,
  resetPoints,
  clearAll,
};
