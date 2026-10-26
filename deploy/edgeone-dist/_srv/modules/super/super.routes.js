'use strict';
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./super.controller');

const router = express.Router();

router.use(requireAuth('super_admin'));

router.get('/overview', controller.overview);
router.get('/classes', controller.listClasses);
router.get('/classes/export.csv', controller.exportClasses);
router.get('/classes/deleted/list', controller.deletedClasses);
router.post('/classes', controller.createClass);
router.patch('/classes/:id', controller.updateClass);
router.delete('/classes/:id', controller.deleteClass);
router.post('/classes/:id/restore', controller.restoreClass);
router.post('/classes/:id/transfer-owner', controller.transferOwner);

router.get('/accounts', controller.listAccounts);
router.post('/accounts', controller.createAccount);
router.patch('/accounts/:id', controller.updateAccount);
router.delete('/accounts/:id', controller.deleteAccount);
router.post('/accounts/:id/reset-password', controller.resetPassword);

router.get('/recycle', controller.recycleList);
router.post('/recycle/:id/restore', controller.restoreSnapshot);
router.get('/audit', controller.auditList);

module.exports = router;
