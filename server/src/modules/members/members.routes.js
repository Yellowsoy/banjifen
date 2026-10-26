'use strict';
const express = require('express');
const { requireAuth, requireCap, requireClass } = require('../../middleware/auth');
const controller = require('./members.controller');

const router = express.Router();

router.use(requireAuth('owner'), requireClass);

router.get('/', requireCap('member:read'), controller.list);
router.post('/', requireCap('member:manage'), controller.create);
router.patch('/:id', requireCap('member:manage'), controller.update);
router.delete('/:id', requireCap('member:manage'), controller.remove);
router.post('/transfer-owner', requireCap('member:manage'), controller.transfer);
router.patch('/settings/limits', requireCap('member:manage'), controller.settings);

module.exports = router;
