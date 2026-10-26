/** 超级管理员：班级、账号、密码、手机号与归属关系 */
import { api } from './api.js';
import {
  $, $$, escapeHtml, toast, openModal, closeModal, confirmDialog, fmtDate, fmtDateTime, renderPager,
} from './ui.js';

const view = {
  tab: 'classes',
  classes: { items: [], total: 0, page: 1, pageSize: 10, search: '' },
  accounts: { items: [], total: 0, page: 1, pageSize: 15, search: '', role: '', classId: '' },
  classOptions: [],
};

const ROLE_LABEL = { super_admin: '超级管理员', owner: '班主任', teacher: '老师', cadre: '班干部' };

function roleBadge(role) {
  const cls = role === 'owner' ? '' : role === 'teacher' ? 'badge-green' : role === 'cadre' ? 'badge-amber' : 'badge-slate';
  return `<span class="badge ${cls}">${ROLE_LABEL[role] || role}</span>`;
}

/* ================= 统计 ================= */
async function loadStats() {
  const s = await api.get('/super/overview');
  $('#superStats').innerHTML = [
    ['班级', s.classes],
    ['账号', s.accounts],
    ['班主任', s.owners],
    ['老师', s.teachers],
    ['班干部', s.cadres],
    ['学生', s.students],
    ['积分记录', s.records],
    ['7 日活跃', s.activeWeek],
  ]
    .map(([label, value]) => `<div class="card" style="padding:12px 16px">
        <div class="tiny muted">${label}</div>
        <div class="num" style="font-size:22px;font-weight:800;line-height:1.3">${value}</div>
      </div>`)
    .join('');
}

/* ================= 班级 ================= */
async function loadClasses() {
  const c = view.classes;
  const data = await api.get('/super/classes', { search: c.search, page: c.page, pageSize: c.pageSize });
  c.items = data.items;
  c.total = data.total;
  view.classOptions = data.items.map((x) => ({ id: x.id, name: x.name }));
  const table = $('#classTable');
  table.innerHTML = `
    <thead><tr>
      <th>班级</th><th>班主任</th><th class="num">成员</th><th class="num">学生</th><th class="num">记录</th><th style="width:96px">操作</th>
    </tr></thead>
    <tbody>
      ${data.items
        .map(
          (row) => `<tr data-id="${row.id}">
            <td>
              <div class="cell-strong">${escapeHtml(row.name)}</div>
              <div class="tiny muted">${escapeHtml([row.school, row.grade].filter(Boolean).join(' · ') || '未填写学校/年级')}</div>
            </td>
            <td>
              <div>${escapeHtml(row.ownerName || '未设置')}</div>
              <div class="tiny muted">${escapeHtml(row.ownerUsername || '')} ${row.ownerPhone ? `· ${escapeHtml(row.ownerPhone)}` : ''}</div>
            </td>
            <td class="num">${row.memberCount}</td>
            <td class="num">${row.studentCount}</td>
            <td class="num">${row.recordCount}</td>
            <td>
              <div class="dropdown" data-dropdown>
                <button class="btn btn-sm btn-ghost" data-more>更多</button>
                <div class="dropdown-menu">
                  <button data-act="edit">编辑班级</button>
                  <button data-act="add-account">添加账号</button>
                  <button data-act="accounts">查看账号</button>
                  <button data-act="delete" style="color:#be123c">删除班级</button>
                </div>
              </div>
            </td>
          </tr>`
        )
        .join('')}
      ${data.items.length ? '' : '<tr><td colspan="6"><div class="empty">还没有班级，先在上方创建</div></td></tr>'}
    </tbody>`;
  renderPager($('#classPager'), {
    page: c.page,
    pageSize: c.pageSize,
    total: c.total,
    onChange: (p) => {
      c.page = p;
      loadClasses();
    },
  });
}

function openClassModal(cls) {
  openModal({
    title: `编辑班级 · ${cls.name}`,
    body: `<div class="col">
      <div class="field"><label>班级名称</label><input class="input" id="ecName" value="${escapeHtml(cls.name)}" maxlength="30" /></div>
      <div class="row">
        <div class="field grow"><label>学校</label><input class="input" id="ecSchool" value="${escapeHtml(cls.school || '')}" maxlength="40" /></div>
        <div class="field" style="width:110px"><label>年级</label><input class="input" id="ecGrade" value="${escapeHtml(cls.grade || '')}" maxlength="20" /></div>
      </div>
      <div class="row">
        <div class="field grow"><label>班干部单次额度</label><input class="input num" id="ecPer" type="number" min="1" max="100" value="${cls.cadreLimitPer}" /></div>
        <div class="field grow"><label>班干部每日额度</label><input class="input num" id="ecDay" type="number" min="1" max="1000" value="${cls.cadreLimitDay}" /></div>
      </div>
    </div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="ecSave">保存</button>',
    onMount(m) {
      m.querySelector('#ecSave').onclick = async () => {
        try {
          await api.patch(`/super/classes/${cls.id}`, {
            name: m.querySelector('#ecName').value.trim(),
            school: m.querySelector('#ecSchool').value.trim(),
            grade: m.querySelector('#ecGrade').value.trim(),
            cadreLimitPer: Number(m.querySelector('#ecPer').value),
            cadreLimitDay: Number(m.querySelector('#ecDay').value),
          });
          closeModal();
          toast('已保存', 'ok');
          await Promise.all([loadClasses(), loadStats()]);
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    },
  });
}

function openAccountModal({ classId, account }) {
  const editing = !!account;
  const options = view.classOptions
    .map((c) => `<option value="${c.id}" ${classId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
  openModal({
    title: editing ? `编辑账号 · ${account.name}` : '添加账号',
    body: `<div class="col">
      <div class="field"><label>所属班级</label><select class="select" id="eaClass">${options}</select></div>
      <div class="row">
        <div class="field grow"><label>角色</label>
          <select class="select" id="eaRole">
            <option value="owner" ${editing && account.role === 'owner' ? 'selected' : ''}>班主任</option>
            <option value="teacher" ${editing && account.role === 'teacher' ? 'selected' : ''}>老师</option>
            <option value="cadre" ${editing && account.role === 'cadre' ? 'selected' : ''}>班干部</option>
          </select>
        </div>
        <div class="field grow"><label>状态</label>
          <select class="select" id="eaStatus">
            <option value="active" ${!editing || account.status === 'active' ? 'selected' : ''}>正常</option>
            <option value="disabled" ${editing && account.status === 'disabled' ? 'selected' : ''}>停用</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field grow"><label>姓名</label><input class="input" id="eaName" value="${editing ? escapeHtml(account.name) : ''}" maxlength="20" /></div>
        <div class="field grow"><label>手机号</label><input class="input num" id="eaPhone" value="${editing ? escapeHtml(account.phone || '') : ''}" maxlength="20" /></div>
      </div>
      <div class="field"><label>登录账号</label><input class="input" id="eaUser" value="${editing ? escapeHtml(account.username) : ''}" maxlength="32" /></div>
      <div class="field"><label>${editing ? '重置密码（留空不改）' : '初始密码'}</label><input class="input" type="password" id="eaPwd" placeholder="至少 6 位" /></div>
      <div class="tiny muted">把角色设为「班主任」会自动把原班主任降为老师。</div>
    </div>`,
    footer: `<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="eaSave">${editing ? '保存' : '创建账号'}</button>`,
    onMount(m) {
      m.querySelector('#eaSave').onclick = async () => {
        const payload = {
          classId: m.querySelector('#eaClass').value,
          role: m.querySelector('#eaRole').value,
          status: m.querySelector('#eaStatus').value,
          name: m.querySelector('#eaName').value.trim(),
          phone: m.querySelector('#eaPhone').value.trim(),
          username: m.querySelector('#eaUser').value.trim(),
        };
        const pwd = m.querySelector('#eaPwd').value;
        if (!payload.name) return toast('请输入姓名', 'err');
        if (!payload.username) return toast('请输入登录账号', 'err');
        if (pwd) payload.password = pwd;
        try {
          if (editing) await api.patch(`/super/accounts/${account.id}`, payload);
          else {
            if (pwd.length < 6) return toast('初始密码至少 6 位', 'err');
            await api.post('/super/accounts', payload);
          }
          closeModal();
          toast(editing ? '已保存' : '账号已创建', 'ok');
          await Promise.all([loadAccounts(), loadClasses(), loadStats()]);
        } catch (err) {
          toast(err.message, 'err');
        }
        return undefined;
      };
    },
  });
}

function openResetPassword(account) {
  openModal({
    title: `重置密码 · ${account.name}`,
    body: `<div class="field"><label>新密码</label><input class="input" type="password" id="rpPwd" placeholder="至少 6 位" /></div>
      <div class="tiny muted" style="margin-top:8px">重置后该账号所有设备的登录状态会立即失效。</div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="rpSave">确认重置</button>',
    onMount(m) {
      m.querySelector('#rpSave').onclick = async () => {
        const password = m.querySelector('#rpPwd').value;
        if (password.length < 6) return toast('密码至少 6 位', 'err');
        try {
          await api.post(`/super/accounts/${account.id}/reset-password`, { password });
          closeModal();
          toast('密码已重置', 'ok');
        } catch (err) {
          toast(err.message, 'err');
        }
        return undefined;
      };
    },
  });
}

/* ================= 账号 ================= */
async function loadAccounts() {
  const a = view.accounts;
  const data = await api.get('/super/accounts', {
    search: a.search,
    role: a.role,
    classId: a.classId,
    page: a.page,
    pageSize: a.pageSize,
  });
  a.items = data.items;
  a.total = data.total;
  const table = $('#accTable');
  table.innerHTML = `
    <thead><tr>
      <th>姓名</th><th>角色</th><th>登录账号</th><th>手机号</th><th>所属班级</th><th>最后登录</th><th style="width:96px">操作</th>
    </tr></thead>
    <tbody>
      ${data.items
        .map(
          (row) => `<tr data-id="${row.id}">
            <td>
              <div class="cell-strong">${escapeHtml(row.name)}</div>
              ${row.status === 'disabled' ? '<span class="badge badge-rose">已停用</span>' : ''}
            </td>
            <td>${roleBadge(row.role)}</td>
            <td class="tiny">${escapeHtml(row.username)}</td>
            <td class="tiny num">${escapeHtml(row.phone || '—')}</td>
            <td class="tiny">${escapeHtml(row.className || '—')}</td>
            <td class="tiny muted nowrap">${row.lastLoginAt ? fmtDateTime(row.lastLoginAt) : '未登录'}</td>
            <td>
              <div class="dropdown" data-dropdown>
                <button class="btn btn-sm btn-ghost" data-more>更多</button>
                <div class="dropdown-menu">
                  <button data-act="edit">编辑 / 改归属</button>
                  <button data-act="reset">重置密码</button>
                  <button data-act="toggle">${row.status === 'disabled' ? '启用账号' : '停用账号'}</button>
                  <button data-act="delete" style="color:#be123c">删除账号</button>
                </div>
              </div>
            </td>
          </tr>`
        )
        .join('')}
      ${data.items.length ? '' : '<tr><td colspan="7"><div class="empty">没有符合条件的账号</div></td></tr>'}
    </tbody>`;
  renderPager($('#accPager'), {
    page: a.page,
    pageSize: a.pageSize,
    total: a.total,
    onChange: (p) => {
      a.page = p;
      loadAccounts();
    },
  });
  const select = $('#accClass');
  const current = select.value;
  select.innerHTML = `<option value="">全部班级</option>${view.classOptions.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}`;
  select.value = current;
}

/* ================= 回收站 / 审计 ================= */
async function loadRecycle() {
  const [snapshots, deleted] = await Promise.all([api.get('/super/recycle', { page: 1, pageSize: 20 }), api.get('/super/classes/deleted/list')]);
  const rows = [];
  deleted.forEach((c) => {
    rows.push(`<div class="sheet-item">
      <span class="badge badge-rose">已删除班级</span>
      <span class="grow"><b>${escapeHtml(c.name)}</b> <span class="tiny muted">${fmtDateTime(c.deletedAt)}</span></span>
      <button class="btn btn-sm btn-ghost" data-restore-class="${c.id}">恢复班级</button>
    </div>`);
  });
  snapshots.items.forEach((r) => {
    rows.push(`<div class="sheet-item">
      <span class="badge badge-amber">${r.kind === 'clear_all' ? '清空数据' : '清空积分'}</span>
      <span class="grow">${escapeHtml(r.className || '')} · ${escapeHtml(r.operatorName || '')}
        <span class="tiny muted">${fmtDateTime(r.createdAt)}</span></span>
      ${r.restoredAt ? '<span class="tiny muted">已恢复</span>' : `<button class="btn btn-sm btn-ghost" data-restore-snapshot="${r.id}">恢复数据</button>`}
    </div>`);
  });
  $('#recycleBody').innerHTML = rows.length ? rows.join('') : '<div class="empty">回收站是空的</div>';

  $('#recycleBody').onclick = async (e) => {
    const restoreClassBtn = e.target.closest('[data-restore-class]');
    if (restoreClassBtn) {
      try {
        await api.post(`/super/classes/${restoreClassBtn.dataset.restoreClass}/restore`);
        toast('班级已恢复', 'ok');
        await Promise.all([loadRecycle(), loadClasses(), loadAccounts(), loadStats()]);
      } catch (err) {
        toast(err.message, 'err');
      }
      return;
    }
    const restoreSnapBtn = e.target.closest('[data-restore-snapshot]');
    if (restoreSnapBtn) {
      const ok = await confirmDialog({ title: '恢复数据', message: '将用快照覆盖该班级当前数据，确定继续？', okText: '恢复' });
      if (!ok) return;
      try {
        await api.post(`/super/recycle/${restoreSnapBtn.dataset.restoreSnapshot}/restore`);
        toast('已恢复', 'ok');
        await loadRecycle();
      } catch (err) {
        toast(err.message, 'err');
      }
    }
  };
}

async function loadAudit() {
  const data = await api.get('/super/audit', { page: 1, pageSize: 20 });
  $('#auditBody').innerHTML = data.items.length
    ? data.items
        .map(
          (r) => `<div class="sheet-item">
            <span class="grow">${escapeHtml(r.actorName)} <span class="tiny muted">${escapeHtml(r.action)}</span>
              <div class="tiny muted">${escapeHtml(r.detail || '')}</div></span>
            <span class="tiny muted nowrap">${fmtDateTime(r.createdAt)}</span>
          </div>`
        )
        .join('')
    : '<div class="empty">暂无操作记录</div>';
}

/* ================= 绑定 ================= */
export async function mountSuperApp({ logout }) {
  await Promise.all([loadStats(), loadClasses(), loadAccounts(), loadRecycle(), loadAudit()]);

  $('#btnSuperLogout').onclick = logout;
  $('#btnSuperPwd').onclick = () => {
    openModal({
      title: '修改密码',
      body: `<div class="col">
        <div class="field"><label>当前密码</label><input class="input" type="password" id="spOld" /></div>
        <div class="field"><label>新密码</label><input class="input" type="password" id="spNew" placeholder="至少 6 位" /></div>
        <div class="field"><label>确认新密码</label><input class="input" type="password" id="spNew2" /></div>
      </div>`,
      footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="spSave">保存</button>',
      onMount(m) {
        m.querySelector('#spSave').onclick = async () => {
          const oldPassword = m.querySelector('#spOld').value;
          const newPassword = m.querySelector('#spNew').value;
          if (newPassword.length < 6) return toast('新密码至少 6 位', 'err');
          if (newPassword !== m.querySelector('#spNew2').value) return toast('两次输入不一致', 'err');
          try {
            await api.post('/auth/password', { oldPassword, newPassword });
            closeModal();
            toast('密码已修改，请重新登录', 'ok');
            setTimeout(() => window.location.reload(), 800);
          } catch (err) {
            toast(err.message, 'err');
          }
          return undefined;
        };
      },
    });
  };

  $('#btnToggleClassForm').onclick = () => {
    const body = $('#classFormBody');
    body.classList.toggle('hidden');
    $('#btnToggleClassForm').textContent = body.classList.contains('hidden') ? '展开' : '收起';
  };

  $('#btnCreateClass').onclick = async () => {
    const payload = {
      name: $('#clsName').value.trim(),
      school: $('#clsSchool').value.trim(),
      grade: $('#clsGrade').value.trim(),
      ownerName: $('#clsOwnerName').value.trim(),
      phone: $('#clsOwnerPhone').value.trim(),
      username: $('#clsOwnerUser').value.trim(),
      password: $('#clsOwnerPwd').value,
    };
    if (!payload.name) return toast('请输入班级名称', 'err');
    if (!payload.ownerName) return toast('请输入班主任姓名', 'err');
    if (!payload.username) return toast('请输入登录账号', 'err');
    if (payload.password.length < 6) return toast('初始密码至少 6 位', 'err');
    try {
      await api.post('/super/classes', payload);
      ['#clsName', '#clsSchool', '#clsGrade', '#clsOwnerName', '#clsOwnerPhone', '#clsOwnerUser', '#clsOwnerPwd'].forEach((sel) => {
        $(sel).value = '';
      });
      toast('班级与班主任已创建', 'ok');
      await Promise.all([loadStats(), loadClasses(), loadAccounts(), loadAudit()]);
    } catch (err) {
      toast(err.message, 'err');
    }
    return undefined;
  };

  $('#superTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    view.tab = btn.dataset.tab;
    $$('#superTabs .pill').forEach((b) => b.classList.toggle('active', b === btn));
    $('#superClassesPanel').classList.toggle('hidden', view.tab !== 'classes');
    $('#superAccountsPanel').classList.toggle('hidden', view.tab !== 'accounts');
  });

  $('#clsSearch').addEventListener('input', (e) => {
    clearTimeout(view._t1);
    view._t1 = setTimeout(() => {
      view.classes.search = e.target.value.trim();
      view.classes.page = 1;
      loadClasses();
    }, 260);
  });
  $('#accSearch').addEventListener('input', (e) => {
    clearTimeout(view._t2);
    view._t2 = setTimeout(() => {
      view.accounts.search = e.target.value.trim();
      view.accounts.page = 1;
      loadAccounts();
    }, 260);
  });
  $('#accRole').onchange = (e) => {
    view.accounts.role = e.target.value;
    view.accounts.page = 1;
    loadAccounts();
  };
  $('#accClass').onchange = (e) => {
    view.accounts.classId = e.target.value;
    view.accounts.page = 1;
    loadAccounts();
  };
  $('#btnExportClasses').onclick = () => api.download('/super/classes/export.csv', { search: view.classes.search });
  $('#btnAuditRefresh').onclick = loadAudit;

  const handleDropdown = (tableSel, onAction) => {
    $(tableSel).addEventListener('click', async (e) => {
      const more = e.target.closest('[data-more]');
      if (more) {
        const dropdown = more.closest('[data-dropdown]');
        const wasOpen = dropdown.classList.contains('open');
        $$('[data-dropdown]').forEach((d) => d.classList.remove('open'));
        dropdown.classList.toggle('open', !wasOpen);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      $$('[data-dropdown]').forEach((d) => d.classList.remove('open'));
      const id = act.closest('tr[data-id]').dataset.id;
      await onAction(act.dataset.act, id);
    });
  };

  handleDropdown('#classTable', async (action, id) => {
    const cls = view.classes.items.find((c) => c.id === id);
    if (!cls) return;
    if (action === 'edit') return openClassModal(cls);
    if (action === 'add-account') return openAccountModal({ classId: id });
    if (action === 'accounts') {
      view.tab = 'accounts';
      $('#superTabs').querySelector('[data-tab="accounts"]').click();
      view.accounts.classId = id;
      view.accounts.page = 1;
      $('#accClass').value = id;
      loadAccounts();
      return undefined;
    }
    if (action === 'delete') {
      const ok = await confirmDialog({
        title: '删除班级',
        message: `删除「${cls.name}」后，该班所有账号将无法登录，数据可在回收站恢复。确定继续？`,
        okText: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/super/classes/${id}`);
        toast('班级已删除', 'ok');
        await Promise.all([loadClasses(), loadAccounts(), loadStats(), loadRecycle(), loadAudit()]);
      } catch (err) {
        toast(err.message, 'err');
      }
    }
    return undefined;
  });

  handleDropdown('#accTable', async (action, id) => {
    const account = view.accounts.items.find((a) => a.id === id);
    if (!account) return;
    if (action === 'edit') return openAccountModal({ classId: account.classId, account });
    if (action === 'reset') return openResetPassword(account);
    if (action === 'toggle') {
      try {
        await api.patch(`/super/accounts/${id}`, { status: account.status === 'disabled' ? 'active' : 'disabled' });
        toast('已更新状态', 'ok');
        await loadAccounts();
      } catch (err) {
        toast(err.message, 'err');
      }
      return undefined;
    }
    if (action === 'delete') {
      const ok = await confirmDialog({
        title: '删除账号',
        message: `确定删除「${account.name}（${account.username}）」？班主任账号需先转移班主任身份。`,
        okText: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/super/accounts/${id}`);
        toast('已删除', 'ok');
        await Promise.all([loadAccounts(), loadStats(), loadAudit()]);
      } catch (err) {
        toast(err.message, 'err');
      }
    }
    return undefined;
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-dropdown]')) $$('[data-dropdown]').forEach((d) => d.classList.remove('open'));
  });
}
