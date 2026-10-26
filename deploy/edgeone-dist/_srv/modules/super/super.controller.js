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
};
