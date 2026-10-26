'use strict';
/** 边界输入校验：进入业务层之前把所有外部数据收敛成可信结构 */
const { z } = require('zod');
const { ValidationError } = require('./errors');

function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  throw new ValidationError(details[0] ? `${details[0].message}` : '请求参数不合法', details);
}

const id = z.string().min(1).max(64);
const username = z
  .string()
  .trim()
  .min(3, '账号至少 3 个字符')
  .max(32, '账号最多 32 个字符')
  .regex(/^[A-Za-z0-9_.@-]+$/, '账号只能包含字母、数字、下划线、点、@ 和短横线');
const password = z.string().min(6, '密码至少 6 位').max(64, '密码最多 64 位');
const page = z.coerce.number().int().min(1).max(100000).default(1);
const pageSize = z.coerce.number().int().min(1).max(200).default(20);
const name = z.string().trim().min(1, '名称不能为空').max(40, '名称最多 40 个字符');
/** 联系电话：允许数字、空格、短横线与 + 号，方便填写座机或带区号的号码 */
const phoneLike = z
  .string()
  .trim()
  .max(24, '联系电话过长')
  .regex(/^[0-9+\-() ]*$/, '联系电话只能包含数字、空格与 + - ( )');

const schemas = {
  login: z.object({
    username: z.string().trim().min(1, '请输入账号').max(32),
    password: z.string().min(1, '请输入密码').max(64),
    entry: z.enum(['class', 'super']).optional().default('class'),
  }),
  phone: z.string().trim().regex(/^\d{6,20}$/, '手机号格式不正确').optional().default(''),
  changePassword: z.object({
    oldPassword: z.string().min(1, '请输入当前密码').max(64),
    newPassword: password,
  }),
  pagination: z.object({ page, pageSize }),
  student: z.object({
    name: name,
    groupName: z.string().trim().max(30).optional().default(''),
    sex: z.enum(['男', '女', '']).optional().default(''),
    position: z.string().trim().max(20).optional().default(''),
    // 学生档案扩展：学号、生日、住址、家长联系方式、备注
    studentNo: z.string().trim().max(24).optional().default(''),
    birthday: z.string().trim().max(20).optional().default(''),
    address: z.string().trim().max(120).optional().default(''),
    guardianName: z.string().trim().max(20).optional().default(''),
    guardianPhone: phoneLike.optional().default(''),
    guardianRelation: z.string().trim().max(10).optional().default(''),
    guardianAltPhone: phoneLike.optional().default(''),
    note: z.string().trim().max(200).optional().default(''),
  }),
  studentUpdate: z.object({
    name: name.optional(),
    groupName: z.string().trim().max(30).optional(),
    sex: z.enum(['男', '女', '']).optional(),
    position: z.string().trim().max(20).optional(),
    studentNo: z.string().trim().max(24).optional(),
    birthday: z.string().trim().max(20).optional(),
    address: z.string().trim().max(120).optional(),
    guardianName: z.string().trim().max(20).optional(),
    guardianPhone: phoneLike.optional(),
    guardianRelation: z.string().trim().max(10).optional(),
    guardianAltPhone: phoneLike.optional(),
    note: z.string().trim().max(200).optional(),
  }),
  points: z.object({
    studentIds: z.array(id).min(1, '请至少选择一名学生').max(200),
    delta: z.coerce.number().int().refine((v) => v !== 0, '分值不能为 0').refine((v) => Math.abs(v) <= 1000, '单次分值不能超过 1000'),
    reason: z.string().trim().max(60).optional().default(''),
  }),
  gift: z.object({
    name: name,
    cost: z.coerce.number().int().min(1, '所需积分至少为 1').max(100000),
    icon: z.string().trim().max(8).optional().default('🎁'),
    stock: z.union([z.coerce.number().int().min(0), z.null()]).optional().default(null),
  }),
  rule: z.object({
    name: name,
    score: z.coerce.number().int().refine((v) => v !== 0, '分值不能为 0').refine((v) => Math.abs(v) <= 100, '分值不能超过 100'),
  }),
  seat: z.object({
    cols: z.coerce.number().int().min(1).max(20),
    rows: z.coerce.number().int().min(1).max(20),
    scheme: z.enum(['points', 'snake', 'random', 'manual']).optional().default('points'),
    seats: z.array(z.union([z.string(), z.null()])).max(400),
    angle: z.enum(['teacher', 'student']).optional().default('teacher'),
  }),
};

module.exports = { z, parse, schemas, id, username, password, name };
