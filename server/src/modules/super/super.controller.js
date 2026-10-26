'use strict';
const { z, parse, id, password } = require('../../core/validation');
const { asyncHandler } = require('../../middleware/error');
const service = require('./super.service');

const classQuery = z.object({
  search: z.string().trim().max(40).optional().default(''),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});

const accountQuery = z.object({
  search: z.string().trim().max(40).optional().default(''),
  role: z.enum(['', 'super_admin', 'owner', 'teacher', 'cadre']).optional().default(''),
  classId: z.string().max(64).optional().default(''),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const overview = asyncHandler(async (req, res) => {
  res.json(service.overview());
});

const listClasses = asyncHandler(async (req, res) => {
  res.json(service.listClasses(parse(classQuery, req.query)));
});

const createClass = asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1, '请输入班级名称').max(30),
      school: z.string().trim().max(40).optional().default(''),
      grade: z.string().trim().max(20).optional().default(''),
      ownerName: z.string().trim().min(1, '请输入班主任姓名').max(20),
      phone: z.string().trim().regex(/^\d{6,20}$/, '手机号格式不正确').optional().default(''),
      username: z.string().trim().min(3, '登录账号至少 3 位').max(32),
      password,
    }),
    req.body
  );
  res.status(201).json(service.createClass(req.auth, body));
});

const updateClass = asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(30).optional(),
      school: z.string().trim().max(40).optional(),
      grade: z.string().trim().max(20).optional(),
      cadreLimitPer: z.coerce.number().int().min(1).max(100).optional(),
      cadreLimitDay: z.coerce.number().int().min(1).max(1000).optional(),
    }),
    req.body
  );
  res.json(service.updateClass(req.auth, req.params.id, body));
});

const deleteClass = asyncHandler(async (req, res) => {
  res.json(service.deleteClass(req.auth, req.params.id, (req.body && req.body.reason) || ''));
});

const restoreClass = asyncHandler(async (req, res) => {
  res.json(service.restoreClass(req.auth, req.params.id));
});

const listAccounts = asyncHandler(async (req, res) => {
  res.json(service.listAccounts(parse(accountQuery, req.query)));
});

const createAccount = asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      classId: id,
      role: z.enum(['owner', 'teacher', 'cadre']),
      name: z.string().trim().min(1, '请输入姓名').max(20),
      phone: z.string().trim().regex(/^\d{6,20}$/, '手机号格式不正确').optional().default(''),
      username: z.string().trim().min(3, '登录账号至少 3 位').max(32),
      password,
      note: z.string().trim().max(60).optional().default(''),
    }),
    req.body
  );
  res.status(201).json(service.createAccount(req.auth, body));
});

const updateAccount = asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(20).optional(),
      phone: z.string().trim().regex(/^\d{6,20}$/, '手机号格式不正确').optional(),
      username: z.string().trim().min(3).max(32).optional(),
      password: password.optional(),
      status: z.enum(['active', 'disabled']).optional(),
      note: z.string().trim().max(60).optional(),
      role: z.enum(['owner', 'teacher', 'cadre']).optional(),
      classId: z.string().max(64).optional(),
    }),
    req.body
  );
  res.json(service.updateAccount(req.auth, req.params.id, body));
});

const deleteAccount = asyncHandler(async (req, res) => {
  res.json(service.deleteAccount(req.auth, req.params.id));
});

const resetPassword = asyncHandler(async (req, res) => {
  const body = parse(z.object({ password }), req.body);
  res.json(service.resetPassword(req.auth, req.params.id, body.password));
});

const transferOwner = asyncHandler(async (req, res) => {
  const body = parse(z.object({ memberId: id }), req.body);
  res.json(service.transferOwner(req.auth, req.params.id, body.memberId));
});

const recycleList = asyncHandler(async (req, res) => {
  const query = parse(
    z.object({
      page: z.coerce.number().int().min(1).optional().default(1),
      pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
    }),
    req.query
  );
  res.json(service.listRecycle(query));
});

const restoreSnapshot = asyncHandler(async (req, res) => {
  res.json(service.restoreSnapshot(req.auth, req.params.id));
});

const auditList = asyncHandler(async (req, res) => {
  const query = parse(
    z.object({
      page: z.coerce.number().int().min(1).optional().default(1),
      pageSize: z.coerce.number().int().min(1).max(100).optional().default(30),
    }),
    req.query
  );
  res.json(service.listAudit(query));
});

/* ==================== 全量操作日志 ==================== */

const logQuery = z.object({
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
  classId: z.string().max(64).optional().default(''),
  actorId: z.string().max(64).optional().default(''),
  module: z.string().max(32).optional().default(''),
  action: z.string().max(64).optional().default(''),
  actorRole: z.string().max(20).optional().default(''),
  result: z.enum(['', 'success', 'failed']).optional().default(''),
  keyword: z.string().trim().max(40).optional().default(''),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(30),
});

const listLogs = asyncHandler(async (req, res) => {
  res.json(service.listOperationLogs(parse(logQuery, req.query)));
});

const exportLogs = asyncHandler(async (req, res) => {
  const query = parse(logQuery, req.query);
  const csv = service.operationLogsCsv({ ...query, page: 1, pageSize: 10000 });
  service.__auditLogExport && service.__auditLogExport(req.auth);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('操作日志.csv')}`);
  res.send(csv);
});

const clearLogs = asyncHandler(async (req, res) => {
  const body = parse(z.object({ days: z.coerce.number().int().min(1).max(3650).default(180) }), req.body);
  res.json(service.clearOperationLogs(req.auth, body.days));
});

/* ==================== 数据备份与恢复 ==================== */

const exportClassBackup = asyncHandler(async (req, res) => {
  const pack = service.exportClassBackup(req.auth, req.params.id);
  const name = `${pack.class.name || '班级'}-备份-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(JSON.stringify(pack, null, 2));
});

const exportPlatformBackup = asyncHandler(async (req, res) => {
  const pack = service.exportPlatformBackup(req.auth);
  const name = `班级积分管理-全量备份-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(JSON.stringify(pack, null, 2));
});

const importBackupHandler = asyncHandler(async (req, res) => {
  const opts = {
    mode: String((req.body && req.body.mode) || 'create') === 'replace' ? 'replace' : 'create',
    targetClassId: (req.body && req.body.targetClassId) || '',
    className: (req.body && req.body.className) || '',
    includeAccounts: req.body && req.body.includeAccounts !== false,
  };
  let text = '';
  if (req.file && req.file.buffer) {
    text = req.file.buffer.toString('utf8');
  } else if (req.body && typeof req.body.text === 'string') {
    text = req.body.text;
  }
  if (!text) throw new Error('请上传备份文件或粘贴备份内容');
  res.json(service.importBackup(req.auth, { text, ...opts }));
});

/* ==================== 成绩对外查询口令 ==================== */

const queryTokenList = asyncHandler(async (req, res) => {
  res.json({ items: service.listQueryTokens() });
});

const queryTokenCreate = asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      classId: id,
      name: z.string().trim().max(40).optional().default(''),
      scope: z.enum(['scores', 'points', 'all']).optional().default('scores'),
      mode: z.enum(['name_no', 'phone', 'none']).optional().default('name_no'),
      days: z.coerce.number().int().min(0).max(3650).optional().default(0),
    }),
    req.body
  );
  res.status(201).json(service.createQueryToken(req.auth, body));
});

const queryTokenToggle = asyncHandler(async (req, res) => {
  const body = parse(z.object({ enabled: z.coerce.boolean() }), req.body);
  res.json(service.toggleQueryToken(req.auth, req.params.id, body.enabled));
});

const queryTokenDelete = asyncHandler(async (req, res) => {
  res.json(service.deleteQueryToken(req.auth, req.params.id));
});

const deletedClasses = asyncHandler(async (req, res) => {
  res.json(service.deletedClasses());
});

const exportClasses = asyncHandler(async (req, res) => {
  const query = parse(classQuery, req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('班级与账号.csv')}`);
  res.send(service.classesCsv(query));
});

module.exports = {
  overview,
  listClasses,
  createClass,
  updateClass,
  deleteClass,
  restoreClass,
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  resetPassword,
  transferOwner,
  recycleList,
  restoreSnapshot,
  auditList,
  deletedClasses,
  exportClasses,
  // 全量操作日志
  listLogs,
  exportLogs,
  clearLogs,
  // 数据备份与恢复
  exportClassBackup,
  exportPlatformBackup,
  importBackup: importBackupHandler,
  // 对外查询口令
  queryTokenList,
  queryTokenCreate,
  queryTokenToggle,
  queryTokenDelete,
};
