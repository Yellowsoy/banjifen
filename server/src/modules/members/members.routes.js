'use strict';
const express = require('express');
const { requireAuth, requireCap, requireClass } = require('../../middleware/auth');
const { trail, failureTrail } = require('../../middleware/audit-trail');
const controller = require('./members.controller');

const router = express.Router();

router.use(requireAuth('owner'), requireClass);
router.use(failureTrail('members'));

router.get('/', requireCap('member:read'), controller.list);
router.post(
  '/',
  requireCap('member:manage'),
  trail({
    module: 'members',
    action: 'member.create',
    targetType: 'account',
    targetName: ({ body }) => (body && body.name) || '',
    summary: ({ body }) => `新增班级成员「${(body && body.name) || ''}」（${(body && body.role) || ''}，账号 ${(body && body.username) || ''}${body && body.phone ? `，手机 ${body.phone}` : ''}）`,
  }),
  controller.create
);
router.patch(
  '/:id',
  requireCap('member:manage'),
  trail({
    module: 'members',
    action: 'member.update',
    targetType: 'account',
    entity: { param: 'id', table: 'accounts', nameField: 'name' },
    summary: ({ before, diff, body }) => {
      const parts = [];
      if (diff) {
        Object.entries(diff).forEach(([key, val]) => {
          if (String(key).toLowerCase().includes('pwdhash')) parts.push('重设了密码');
          else parts.push(`${key} ${JSON.stringify(val.from)}→${JSON.stringify(val.to)}`);
        });
      }
      if (body && body.password) parts.push('重设了密码');
      return `修改成员「${(before && before.name) || ''}」：${parts.slice(0, 6).join('；') || '（无字段变化）'}`;
    },
  }),
  controller.update
);
router.delete(
  '/:id',
  requireCap('member:manage'),
  trail({
    module: 'members',
    action: 'member.remove',
    targetType: 'account',
    entity: { param: 'id', table: 'accounts', nameField: 'name' },
    summary: ({ before }) => `移除班级成员「${(before && before.name) || ''}」（账号 ${(before && before.username) || ''}）`,
  }),
  controller.remove
);
router.post(
  '/transfer-owner',
  requireCap('member:manage'),
  trail({
    module: 'members',
    action: 'member.transferOwner',
    targetType: 'account',
    targetName: ({ body }) => (body && body.accountId) || '',
    summary: ({ body }) => `移交班主任权限给账号 ${(body && body.accountId) || '未知'}`,
  }),
  controller.transfer
);
router.patch(
  '/settings/limits',
  requireCap('member:manage'),
  trail({
    module: 'members',
    action: 'member.limits',
    targetType: 'class',
    summary: ({ body }) => `调整班干部额度：单次上限 ${(body && body.cadreLimitPer) ?? '?'}，每日上限 ${(body && body.cadreLimitDay) ?? '?'}`,
  }),
  controller.settings
);

module.exports = router;
