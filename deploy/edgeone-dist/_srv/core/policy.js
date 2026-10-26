'use strict';
/**
 * 权限策略（单一定义源）
 *
 * 角色：
 *  - super_admin 超级管理员：平台级，管理全部班级、账号、密码、手机号与归属关系
 *  - owner       班主任：班级最高权限，含成员管理与危险操作
 *  - teacher     老师：日常教学操作（加减分、批量、排座、成绩、兑换），不含删除与清空
 *  - cadre       班干部：仅单人加减分（有额度限制）与查看，用于帮老师记录
 *
 * 能力（capability）在后端路由与服务层双重校验，前端只做显隐，不作为安全边界。
 */

const ROLE = {
  SUPER: 'super_admin',
  OWNER: 'owner',
  TEACHER: 'teacher',
  CADRE: 'cadre',
};

const ROLE_LABEL = {
  super_admin: '超级管理员',
  owner: '班主任',
  teacher: '老师',
  cadre: '班干部',
};

const CAPS = {
  'class:read': [ROLE.OWNER, ROLE.TEACHER, ROLE.CADRE],
  'class:profile': [ROLE.OWNER],
  'class:reset-points': [ROLE.OWNER],
  'class:clear-all': [ROLE.OWNER],

  'student:read': [ROLE.OWNER, ROLE.TEACHER, ROLE.CADRE],
  'student:create': [ROLE.OWNER, ROLE.TEACHER],
  'student:update': [ROLE.OWNER, ROLE.TEACHER],
  'student:delete': [ROLE.OWNER],

  'points:single': [ROLE.OWNER, ROLE.TEACHER, ROLE.CADRE],
  'points:batch': [ROLE.OWNER, ROLE.TEACHER],

  'history:read': [ROLE.OWNER, ROLE.TEACHER, ROLE.CADRE],
  'history:delete': [ROLE.OWNER],
  'history:clear': [ROLE.OWNER],

  'rules:read': [ROLE.OWNER, ROLE.TEACHER, ROLE.CADRE],
  'rules:write': [ROLE.OWNER, ROLE.TEACHER],

  'gift:read': [ROLE.OWNER, ROLE.TEACHER, ROLE.CADRE],
  'gift:write': [ROLE.OWNER],
  'gift:redeem': [ROLE.OWNER, ROLE.TEACHER],

  'seat:read': [ROLE.OWNER, ROLE.TEACHER, ROLE.CADRE],
  'seat:write': [ROLE.OWNER, ROLE.TEACHER],

  'exam:read': [ROLE.OWNER, ROLE.TEACHER],
  'exam:import': [ROLE.OWNER, ROLE.TEACHER],
  'exam:delete': [ROLE.OWNER],

  'member:read': [ROLE.OWNER],
  'member:manage': [ROLE.OWNER],

  'recycle:read': [ROLE.OWNER],
  'export:data': [ROLE.OWNER, ROLE.TEACHER],
};

function can(role, capability) {
  const allowed = CAPS[capability];
  if (!allowed) return false;
  return allowed.includes(role);
}

/** 给前端下发当前角色的能力清单 */
function capabilitiesOf(role) {
  return Object.keys(CAPS).filter((cap) => can(role, cap));
}

/** 班干部加分额度校验所需配置（超管与班主任可在代码层面调整默认值） */
const CADRE_DEFAULTS = { perAction: 5, perDay: 20 };

module.exports = { ROLE, ROLE_LABEL, CAPS, can, capabilitiesOf, CADRE_DEFAULTS };
