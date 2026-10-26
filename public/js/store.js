/** 前端共享状态：登录身份、能力清单与各视图分页条件 */
import { startOfMonth, startOfTerm, startOfWeek } from './ui.js';

export const state = {
  me: null, // { account, class, capabilities }
  caps: new Set(),
  overview: null,
  view: 'students',
  students: { items: [], total: 0, page: 1, pageSize: 10, search: '', sort: 'points_desc', range: 'term', from: 0, to: 0 },
  groups: { items: [], sort: 'desc', range: 'term' },
  history: { items: [], total: 0, page: 1, pageSize: 15, range: 'all', search: '', from: 0, to: 0 },
  seat: null,
  gifts: [],
  scores: { exams: [], examId: '', view: 'student', data: null },
  members: [],
  version: '',
};

/** 是否具备某项能力（前端只做显隐，真正的边界在后端） */
export function can(capability) {
  return state.caps.has(capability);
}

export function role() {
  return (state.me && state.me.account && state.me.account.role) || '';
}

export function roleLabel() {
  return (state.me && state.me.account && state.me.account.roleLabel) || '';
}

export function rangeBounds(range, from, to) {
  const now = Date.now();
  switch (range) {
    case 'week':
      return { from: startOfWeek(), to: now };
    case 'month':
      return { from: startOfMonth(), to: now };
    case 'custom':
      return { from: from || 0, to: to || now };
    case 'all':
      return { from: 0, to: 0 };
    case 'term':
    default:
      return { from: startOfTerm(), to: now };
  }
}

export function myClass() {
  return (state.me && state.me.class) || { name: '', badge: '', id: '' };
}

export function displayClassName() {
  const cls = myClass();
  return cls.name || '我的班级';
}
