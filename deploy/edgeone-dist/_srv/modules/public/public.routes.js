'use strict';
const express = require('express');
const { asyncHandler } = require('../../middleware/error');
const { config } = require('../../config');

const router = express.Router();

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

module.exports = router;
