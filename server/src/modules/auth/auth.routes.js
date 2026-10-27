'use strict';
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { rateLimit } = require('../../middleware/rateLimit');
const { config } = require('../../config');
const controller = require('./auth.controller');

const router = express.Router();

const authLimiter = rateLimit({ windowMs: 5 * 60_000, max: config.authLoginRateMax, message: '尝试次数过多，请 5 分钟后再试' });

router.post('/login', authLimiter, controller.login);
router.post('/refresh', controller.refresh);
router.post('/logout', controller.logout);
router.get('/me', requireAuth(), controller.me);
router.post('/password', requireAuth(), controller.changePassword);

module.exports = router;
