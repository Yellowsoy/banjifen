'use strict';
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../../middleware/auth');
const { trail, failureTrail } = require('../../middleware/audit-trail');
const controller = require('./super.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

router.use(requireAuth('super_admin'));
router.use(failureTrail('super'));

router.get('/overview', controller.overview);
router.get('/classes', controller.listClasses);
router.get('/classes/export.csv', controller.exportClasses);
router.get('/classes/deleted/list', controller.deletedClasses);
router.post(
  '/classes',
  trail({
    module: 'super',
    action: 'class.create',
    targetType: 'class',
    targetName: ({ body }) => (body && body.name) || '',
    summary: ({ body }) => `新建班级「${(body && body.name) || ''}」，班主任「${(body && body.ownerName) || ''}」（账号 ${(body && body.username) || ''}）`,
  }),
  controller.createClass
);
router.patch(
  '/classes/:id',
  trail({
    module: 'super',
    action: 'class.update',
    targetType: 'class',
    entity: { param: 'id', table: 'classes', nameField: 'name' },
    summary: ({ before, diff }) => `修改班级「${(before && before.name) || ''}」${diff ? `：${Object.keys(diff).map((k) => `${k}→${JSON.stringify(diff[k].to)}`).join('，')}` : ''}`,
  }),
  controller.updateClass
);
router.delete(
  '/classes/:id',
  trail({
    module: 'super',
    action: 'class.delete',
    targetType: 'class',
    entity: { param: 'id', table: 'classes', nameField: 'name' },
    summary: ({ before, body }) => `删除班级「${(before && before.name) || ''}」${body && body.reason ? `，原因：${body.reason}` : ''}`,
  }),
  controller.deleteClass
);
router.post(
  '/classes/:id/restore',
  trail({
    module: 'super',
    action: 'class.restore',
    targetType: 'class',
    entity: { param: 'id', table: 'classes', nameField: 'name' },
    summary: ({ before }) => `恢复已删除班级「${(before && before.name) || ''}」`,
  }),
  controller.restoreClass
);
router.post(
  '/classes/:id/transfer-owner',
  trail({
    module: 'super',
    action: 'class.transferOwner',
    targetType: 'class',
    entity: { param: 'id', table: 'classes', nameField: 'name' },
    summary: ({ before, body }) => `转移班级「${(before && before.name) || ''}」的班主任给成员 ${(body && body.memberId) || ''}`,
  }),
  controller.transferOwner
);

router.get('/accounts', controller.listAccounts);
router.post(
  '/accounts',
  trail({
    module: 'super',
    action: 'account.create',
    targetType: 'account',
    targetName: ({ body }) => (body && body.name) || '',
    summary: ({ body }) => `新建账号「${(body && body.name) || ''}」（${(body && body.role) || ''}，登录账号 ${(body && body.username) || ''}${body && body.classId ? `，所属班级 ${body.classId}` : ''}）`,
  }),
  controller.createAccount
);
router.patch(
  '/accounts/:id',
  trail({
    module: 'super',
    action: 'account.update',
    targetType: 'account',
    entity: { param: 'id', table: 'accounts', nameField: 'name' },
    summary: ({ before, diff, body }) => {
      const parts = [];
      if (diff) {
        Object.entries(diff).forEach(([key, val]) => {
          if (String(key).toLowerCase().includes('pwdhash')) parts.push('重设密码');
          else parts.push(`${key} ${JSON.stringify(val.from)}→${JSON.stringify(val.to)}`);
        });
      }
      if (body && body.password) parts.push('重设密码');
      return `修改账号「${(before && before.name) || ''}」：${parts.slice(0, 8).join('；') || '（无变化）'}`;
    },
  }),
  controller.updateAccount
);
router.delete(
  '/accounts/:id',
  trail({
    module: 'super',
    action: 'account.delete',
    targetType: 'account',
    entity: { param: 'id', table: 'accounts', nameField: 'name' },
    summary: ({ before }) => `删除账号「${(before && before.name) || ''}」（${(before && before.username) || ''}）`,
  }),
  controller.deleteAccount
);
router.post(
  '/accounts/:id/reset-password',
  trail({
    module: 'super',
    action: 'account.resetPassword',
    targetType: 'account',
    entity: { param: 'id', table: 'accounts', nameField: 'name' },
    summary: ({ before }) => `重置账号「${(before && before.name) || ''}」的登录密码`,
  }),
  controller.resetPassword
);

router.get('/recycle', controller.recycleList);
router.post(
  '/recycle/:id/restore',
  trail({
    module: 'super',
    action: 'recycle.restore',
    targetType: 'snapshot',
    summary: ({ req: r }) => `从回收站恢复快照 ${r.params.id}`,
  }),
  controller.restoreSnapshot
);

/* ==================== 全量操作日志 ==================== */
router.get('/logs', controller.listLogs);
router.get('/logs/export.csv', controller.exportLogs);
router.post(
  '/logs/clear',
  trail({
    module: 'super',
    action: 'logs.clear',
    targetType: 'system',
    summary: ({ body }) => `清理 ${(body && body.days) || 180} 天前的操作日志`,
  }),
  controller.clearLogs
);
router.get('/audit', controller.auditList); // 兼容旧版视图

/* ==================== 数据备份与恢复 ==================== */
router.get(
  '/backup/platform',
  trail({
    module: 'backup',
    action: 'backup.export.platform',
    targetType: 'platform',
    summary: '导出平台级全量数据备份',
  }),
  controller.exportPlatformBackup
);
router.get(
  '/backup/class/:id',
  trail({
    module: 'backup',
    action: 'backup.export.class',
    targetType: 'class',
    summary: ({ req: r }) => `导出班级 ${r.params.id} 的数据备份`,
  }),
  controller.exportClassBackup
);
router.post(
  '/backup/import',
  upload.single('file'),
  trail({
    module: 'backup',
    action: 'backup.import',
    targetType: 'class',
    targetName: ({ body }) => (body && body.className) || '',
    summary: ({ body, req: r }) =>
      `导入数据备份（方式：${(body && body.mode) === 'replace' ? '覆盖现有班级' : '恢复为新班级'}` +
      `${body && body.targetClassId ? `，目标班级 ${body.targetClassId}` : ''}${(r.file && r.file.originalname) ? `，文件 ${r.file.originalname}` : ''}）`,
  }),
  controller.importBackup
);

/* ==================== 成绩对外查询口令 ==================== */
router.get('/query-tokens', controller.queryTokenList);
router.post(
  '/query-tokens',
  trail({
    module: 'super',
    action: 'query.token.create',
    targetType: 'class',
    targetName: ({ body }) => (body && body.classId) || '',
    summary: ({ body }) => `生成成绩对外查询口令（班级 ${(body && body.classId) || ''}，范围 ${(body && body.scope) || 'scores'}，校验 ${(body && body.mode) || 'name_no'}）`,
  }),
  controller.queryTokenCreate
);
router.patch(
  '/query-tokens/:id',
  trail({
    module: 'super',
    action: 'query.token.toggle',
    targetType: 'token',
    entity: { param: 'id', table: 'query_tokens', nameField: 'token' },
    summary: ({ before, body }) => `${body && body.enabled ? '启用' : '停用'}查询口令 ${(before && before.token) || ''}`,
  }),
  controller.queryTokenToggle
);
router.delete(
  '/query-tokens/:id',
  trail({
    module: 'super',
    action: 'query.token.delete',
    targetType: 'token',
    entity: { param: 'id', table: 'query_tokens', nameField: 'token' },
    summary: ({ before }) => `删除查询口令 ${(before && before.token) || ''}`,
  }),
  controller.queryTokenDelete
);

module.exports = router;
