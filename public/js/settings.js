/** 设置页（独立 URL /settings.html）：账号、班级资料、规则、成员、额度、导出与危险操作 */
import { api, ApiError } from './api.js';
import { $, escapeHtml, toast, openModal, closeModal, confirmDialog, startOfWeek, startOfMonth, startOfTerm, todayInput } from './ui.js';
import { state, myClass, can, roleLabel } from './store.js';

const SECTION_META = {
  account: { label: '我的账号', always: true },
  profile: { label: '班级资料', cap: 'class:profile' },
  rules: { label: '快捷规则', cap: 'rules:write' },
  members: { label: '成员管理', cap: 'member:read' },
  limits: { label: '班干部额度', cap: 'member:manage' },
  export: { label: '数据导出', cap: 'export:data' },
  danger: { label: '危险操作', anyCap: ['class:reset-points', 'class:clear-all'] },
};

let currentSection = 'account';

/* ================= 通用 ================= */

async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* 忽略退出失败，仍要跳回登录页 */
  }
  window.location.replace('/login.html');
}

function buildNav() {
  const nav = $('#setNav');
  nav.innerHTML = Object.entries(SECTION_META)
    .filter(([, meta]) => meta.always || (meta.cap && can(meta.cap)) || (meta.anyCap && meta.anyCap.some((c) => can(c))))
    .map(([key, meta]) => `<button data-section="${key}">${escapeHtml(meta.label)}</button>`)
    .join('');
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-section]');
    if (btn) showSection(btn.dataset.section);
  });
}

function showSection(key) {
  currentSection = key;
  document.querySelectorAll('#setBody [data-section]').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.section !== key);
  });
  $('#setNav').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.section === key));
  if (key === 'rules') loadRules();
  if (key === 'members') loadMembers();
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ================= 账号 ================= */

function fillSummary() {
  const acc = (state.me && state.me.account) || {};
  const cls = myClass();
  $('#setRole').textContent = roleLabel();
  $('#setName').textContent = acc.name || acc.username || '—';
  const badge = $('#setBadge');
  if (cls.badge) badge.innerHTML = `<img src="${escapeHtml(cls.badge)}" alt="班级徽章" />`;
  else badge.textContent = '积';

  if (acc.role === 'super_admin') {
    $('#accountSummary').textContent = `${acc.name || '超级管理员'} · 账号 ${acc.username || '—'} · 可管理全部班级与账号，` +
      '班级相关设置请进入对应班级操作。';
  } else {
    $('#accountSummary').textContent = `${acc.name || '—'} · 账号 ${acc.username || '—'} · ${myClass().name || '未加入班级'}`;
  }
}

function openChangePassword() {
  openModal({
    title: '修改密码',
    body: `<div class="col">
      <div class="field"><label>当前密码</label><input class="input" type="password" id="pwdOld" /></div>
      <div class="field"><label>新密码</label><input class="input" type="password" id="pwdNew" placeholder="至少 6 位" /></div>
      <div class="field"><label>确认新密码</label><input class="input" type="password" id="pwdNew2" /></div>
    </div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="pwdSave">保存</button>',
    onMount(m) {
      m.querySelector('#pwdSave').onclick = async () => {
        const oldPassword = m.querySelector('#pwdOld').value;
        const newPassword = m.querySelector('#pwdNew').value;
        if (newPassword.length < 6) return toast('新密码至少 6 位', 'err');
        if (newPassword !== m.querySelector('#pwdNew2').value) return toast('两次输入不一致', 'err');
        try {
          await api.post('/auth/password', { oldPassword, newPassword });
          closeModal();
          toast('密码已修改，请重新登录', 'ok');
          setTimeout(() => window.location.replace('/login.html'), 800);
        } catch (err) {
          toast(err.message, 'err');
        }
        return undefined;
      };
    },
  });
}

/* ================= 班级资料 ================= */

let badgeData = '';

function fillProfile() {
  const cls = myClass();
  badgeData = cls.badge || '';
  $('#cpName').value = cls.name || '';
  $('#cpSchool').value = cls.school || '';
  $('#cpGrade').value = cls.grade || '';
  renderBadgePreview();
}

function renderBadgePreview() {
  const box = $('#cpBadgePreview');
  if (badgeData) box.innerHTML = `<img src="${escapeHtml(badgeData)}" alt="班级徽章" />`;
  else box.textContent = '积';
}

async function saveProfile() {
  const name = $('#cpName').value.trim();
  if (!name) return toast('请输入班级名称', 'err');
  try {
    await api.put('/class/profile', {
      className: name,
      school: $('#cpSchool').value.trim(),
      grade: $('#cpGrade').value.trim(),
      badge: badgeData,
    });
    if (state.me && state.me.class) {
      state.me.class.name = name;
      state.me.class.badge = badgeData;
    }
    toast('班级资料已保存', 'ok');
    fillSummary();
  } catch (err) {
    toast(err.message, 'err');
  }
  return undefined;
}

/* ================= 快捷规则 ================= */

let rules = [];

async function loadRules() {
  try {
    rules = await api.get('/class/rules');
  } catch (err) {
    rules = [];
    toast(err.message, 'err');
  }
  renderRules();
}

function renderRules() {
  const box = $('#ruleList');
  box.innerHTML = rules.length
    ? rules
        .map(
          (r) => `<div class="sheet-item">
            <span class="chip ${r.score > 0 ? 'pos' : 'neg'} num">${r.score > 0 ? '+' : ''}${r.score}</span>
            <span class="grow">${escapeHtml(r.name)}</span>
            <button class="btn btn-sm btn-ghost" data-del="${r.id}">删除</button>
          </div>`
        )
        .join('')
    : '<div class="empty">还没有规则，先在下方添加吧</div>';
}

async function addRule() {
  const name = $('#ruleName').value.trim();
  const score = Number($('#ruleScore').value);
  if (!name) return toast('请输入规则名', 'err');
  if (!score) return toast('请输入非 0 分值', 'err');
  try {
    rules = await api.post('/class/rules', { name, score });
    $('#ruleName').value = '';
    $('#ruleScore').value = '';
    renderRules();
    toast('规则已添加', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
  return undefined;
}

async function deleteRule(id) {
  try {
    rules = await api.del(`/class/rules/${id}`);
    renderRules();
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ================= 成员管理 ================= */

async function loadMembers() {
  const box = $('#memberList');
  try {
    const members = await api.get('/members');
    state.members = members;
    box.innerHTML = members.length
      ? members
          .map(
            (m) => `<div class="member-item">
              <div class="member-line">
                <span class="name">${escapeHtml(m.name || '—')}</span>
                <span class="badge ${m.role === 'owner' ? '' : 'badge-slate'}">${escapeHtml(m.roleLabel || '')}</span>
              </div>
              <div class="member-meta">账号 ${escapeHtml(m.username || '—')}${m.phoneMasked ? ` · ${escapeHtml(m.phoneMasked)}` : ''} · ${m.status && m.status !== 'active' ? '已停用' : '正常'}</div>
            </div>`
          )
          .join('')
      : '<div class="empty">还没有班级成员</div>';
  } catch (err) {
    box.innerHTML = `<div class="empty">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

function openMemberModal(member) {
  const editing = !!member;
  openModal({
    title: editing ? '编辑成员' : '添加成员',
    body: `
      <div class="col">
        <div class="field"><label>姓名</label><input class="input" id="mmName" value="${escapeHtml(member ? member.name : '')}" maxlength="20" /></div>
        <div class="field"><label>登录账号</label><input class="input" id="mmUser" value="${escapeHtml(member ? member.username : '')}" autocomplete="off" /></div>
        <div class="field">
          <label>角色</label>
          <select class="select" id="mmRole">
            <option value="teacher" ${member && member.role === 'teacher' ? 'selected' : ''}>老师</option>
            <option value="cadre" ${member && member.role === 'cadre' ? 'selected' : ''}>班干部</option>
          </select>
        </div>
        <div class="field">
          <label>${editing ? '重设密码（留空则不修改）' : '初始密码'}</label>
          <input class="input" id="mmPwd" type="password" placeholder="至少 6 位" autocomplete="new-password" />
        </div>
      </div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="mmSave">保存</button>',
    onMount(m) {
      m.querySelector('#mmSave').onclick = async () => {
        const payload = {
          name: m.querySelector('#mmName').value.trim(),
          username: m.querySelector('#mmUser').value.trim(),
          role: m.querySelector('#mmRole').value,
        };
        const pwd = m.querySelector('#mmPwd').value;
        if (pwd) payload.password = pwd;
        if (!payload.name) return toast('请输入姓名', 'err');
        if (!payload.username) return toast('请输入登录账号', 'err');
        if (!editing && pwd.length < 6) return toast('初始密码至少 6 位', 'err');
        if (editing && pwd && pwd.length < 6) return toast('密码至少 6 位', 'err');
        try {
          if (editing) await api.patch(`/members/${member.id}`, payload);
          else await api.post('/members', payload);
          closeModal();
          toast('已保存', 'ok');
          loadMembers();
        } catch (err) {
          toast(err.message, 'err');
        }
        return undefined;
      };
    },
  });
}

function openLimitsModal() {
  const cls = myClass();
  openModal({
    title: '班干部加减分额度',
    body: `<div class="row wrap">
      <div class="field grow" style="min-width:120px"><label>单次上限</label><input class="input num" id="lmPer" type="number" min="1" max="100" value="${cls.cadreLimitPer || 5}" /></div>
      <div class="field grow" style="min-width:120px"><label>每日上限</label><input class="input num" id="lmDay" type="number" min="1" max="1000" value="${cls.cadreLimitDay || 20}" /></div>
    </div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="lmSave">保存</button>',
    onMount(m) {
      m.querySelector('#lmSave').onclick = async () => {
        try {
          const res = await api.patch('/members/settings/limits', {
            cadreLimitPer: Number(m.querySelector('#lmPer').value),
            cadreLimitDay: Number(m.querySelector('#lmDay').value),
          });
          if (state.me && state.me.class) {
            state.me.class.cadreLimitPer = res.cadreLimitPer;
            state.me.class.cadreLimitDay = res.cadreLimitDay;
          }
          closeModal();
          toast('额度已保存', 'ok');
          fillLimits();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    },
  });
}

/* ================= 额度 ================= */

function fillLimits() {
  const cls = myClass();
  $('#limitPer').value = cls.cadreLimitPer || 5;
  $('#limitDay').value = cls.cadreLimitDay || 20;
}

async function saveLimits() {
  try {
    const res = await api.patch('/members/settings/limits', {
      cadreLimitPer: Number($('#limitPer').value),
      cadreLimitDay: Number($('#limitDay').value),
    });
    if (state.me && state.me.class) {
      state.me.class.cadreLimitPer = res.cadreLimitPer;
      state.me.class.cadreLimitDay = res.cadreLimitDay;
    }
    toast('额度已保存', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ================= 导出 ================= */

function rangeBounds(range, from, to) {
  const now = Date.now();
  if (range === 'week') return { from: startOfWeek(), to: now };
  if (range === 'month') return { from: startOfMonth(), to: now };
  if (range === 'custom') return { from: from || 0, to: to || now };
  return { from: startOfTerm(), to: now };
}

let exportRange = 'term';

async function exportCsv() {
  let from = 0;
  let to = 0;
  if (exportRange === 'custom') {
    const f = $('#exportFrom').value;
    const t = $('#exportTo').value;
    if (!f || !t) return toast('请选择起止日期', 'err');
    from = new Date(`${f}T00:00:00`).getTime();
    to = new Date(`${t}T23:59:59`).getTime();
  } else {
    const bounds = rangeBounds(exportRange);
    from = bounds.from;
    to = bounds.to;
  }
  try {
    await api.download('/class/ranking/export.csv', { from, to });
    toast('已开始下载', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
  return undefined;
}

/* ================= 危险操作 ================= */

async function resetPoints() {
  const ok = await confirmDialog({
    title: '清空积分',
    message: '将把所有学生积分清零并清空积分记录（快照保留在回收站，可由超级管理员恢复）。继续吗？',
    okText: '确认清空',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.post('/class/reset-points');
    toast('已清空积分', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function clearAll() {
  const ok = await confirmDialog({
    title: '清空全部数据',
    message: '将清空本班学生、积分、礼物、兑换记录与排座（快照保留在回收站）。确定继续吗？',
    okText: '全部清空',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.post('/class/clear-all');
    toast('已清空本班数据', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ================= 绑定 ================= */

function bind() {
  $('#btnChangePwd').onclick = openChangePassword;
  $('#btnLogout').onclick = logout;

  if (can('class:profile')) {
    $('#cpSave').onclick = saveProfile;
    $('#cpBadgeClear').onclick = () => {
      badgeData = '';
      renderBadgePreview();
    };
    $('#cpBadgeFile').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 1.5 * 1024 * 1024) return toast('图片不要超过 1.5MB', 'err');
      const { compressImage } = await import('./ui.js');
      badgeData = await compressImage(file, 256, 0.85);
      renderBadgePreview();
      return undefined;
    };
  }

  if (can('rules:write')) {
    $('#ruleAdd').onclick = addRule;
    $('#ruleList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-del]');
      if (btn) deleteRule(btn.dataset.del);
    });
    $('#ruleImportBtn').onclick = () => $('#ruleFile').click();
    $('#ruleFile').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await api.upload('/class/rules/import', form);
        rules = res.rules;
        renderRules();
        toast(`成功导入 ${res.added} 条规则`, 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    $('#ruleTplBtn').onclick = () => api.download('/class/rules/template');
    $('#ruleResetBtn').onclick = async () => {
      try {
        rules = await api.post('/class/rules/reset');
        renderRules();
        toast('已恢复默认规则', 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  }

  if (can('member:read')) {
    $('#btnAddMember').onclick = () => openMemberModal(null);
  }
  if (can('member:manage')) {
    $('#btnMemberLimits').onclick = openLimitsModal;
    $('#limitSave').onclick = saveLimits;
  }

  if (can('export:data')) {
    $('#exportRange').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      exportRange = btn.dataset.range;
      $('#exportRange').querySelectorAll('.pill').forEach((b) => b.classList.toggle('active', b === btn));
      $('#exportCustom').classList.toggle('hidden', exportRange !== 'custom');
    });
    $('#exportConfirm').onclick = exportCsv;
    $('#exportFrom').value = todayInput();
    $('#exportTo').value = todayInput();
  }

  if (can('class:reset-points')) $('#btnResetPoints').onclick = resetPoints;
  if (can('class:clear-all')) $('#btnClearAll').onclick = clearAll;
}

/* ================= 启动 ================= */

async function bootstrap() {
  try {
    const settings = await api.get('/public/settings');
    state.version = settings.version || '';
  } catch {
    /* 忽略版本信息失败 */
  }

  try {
    const me = await api.get('/auth/me');
    state.me = me;
    state.caps = new Set(me.capabilities || []);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      window.location.replace('/login.html');
      return;
    }
    toast('服务暂时不可用，请稍后重试', 'err');
    return;
  }

  fillSummary();
  buildNav();
  bind();
  if (can('class:profile')) fillProfile();
  if (can('member:manage')) fillLimits();
  showSection('account');
}

bootstrap();
