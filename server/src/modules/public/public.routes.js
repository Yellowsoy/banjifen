'use strict';
const express = require('express');
const { asyncHandler } = require('../../middleware/error');
const { BadRequestError } = require('../../core/errors');
const { config } = require('../../config');
const query = require('../../core/query');
const { rateLimit } = require('../../middleware/rateLimit');

const router = express.Router();

// 公开查询接口：限制频率，防止被脚本反复试探
const queryLimiter = rateLimit({ windowMs: 60_000, max: 60, message: '查询过于频繁，请稍后再试' });

/** 公开配置：仅暴露版本号等无敏感信息 */
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json({ version: config.version });
  })
);

/** 健康检查 */
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()), time: Date.now() });
  })
);

/* ==================== 成绩对外查询（免登录） ==================== */

/** 先探测口令是否有效、需要输入哪些字段 */
router.get(
  '/query/:token',
  queryLimiter,
  asyncHandler(async (req, res) => {
    res.json(query.info(req.params.token));
  })
);

/** 提交查询：返回「仅该学生自己」的数据 */
router.post(
  '/query/:token',
  queryLimiter,
  asyncHandler(async (req, res) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {});
    const payload = {
      name: String(body.name || '').trim(),
      studentNo: String(body.studentNo || '').trim(),
      phoneTail: String(body.phoneTail || '').trim(),
    };
    if (!payload.name) throw new BadRequestError('请输入学生姓名');
    res.json(query.query(req.params.token, payload, req));
  })
);

module.exports = router;
