'use strict';
const { z, parse, id, password } = require('../../core/validation');
const { asyncHandler } = require('../../middleware/error');
const service = require('./members.service');

const memberCreate = z.object({
  role: z.enum(['teacher', 'cadre']),
  name: z.string().trim().min(1, '请输入姓名').max(20),
  username: z.string().trim().min(3, '登录账号至少 3 位').max(32),
  password: password,
  phone: z.string().trim().regex(/^\d{6,20}$/, '手机号格式不正确').optional().default(''),
  note: z.string().trim().max(60).optional().default(''),
});

const memberUpdate = z.object({
  name: z.string().trim().min(1).max(20).optional(),
  phone: z.string().trim().regex(/^\d{6,20}$/, '手机号格式不正确').optional(),
  note: z.string().trim().max(60).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: password.optional(),
});

const list = asyncHandler(async (req, res) => {
  res.json(service.listMembers(req.auth.classId));
});

const create = asyncHandler(async (req, res) => {
  const body = parse(memberCreate, req.body);
  res.status(201).json(service.createMember(req.auth.classId, body));
});

const update = asyncHandler(async (req, res) => {
  const body = parse(memberUpdate, req.body);
  res.json(service.updateMember(req.auth.classId, req.params.id, body));
});

const remove = asyncHandler(async (req, res) => {
  res.json(service.removeMember(req.auth.classId, req.params.id));
});

const transfer = asyncHandler(async (req, res) => {
  const body = parse(z.object({ memberId: id }), req.body);
  res.json(service.transferOwner(req.auth.classId, req.auth.accountId, body.memberId));
});

const settings = asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      cadreLimitPer: z.coerce.number().int().min(1).max(100).optional(),
      cadreLimitDay: z.coerce.number().int().min(1).max(1000).optional(),
    }),
    req.body
  );
  res.json(service.updateSettings(req.auth.classId, body));
});

module.exports = { list, create, update, remove, transfer, settings };
