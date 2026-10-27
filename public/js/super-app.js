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
  syncClassSelects();
}

/** 把班级选项同步到「日志筛选 / 备份 / 查询口令」三处的下拉框 */
function syncClassSelects() {
  const options = view.classOptions.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
  const pairs = [
    ['#logClass', '<option value="">全部班级</option>'],
    ['#backupClass', '<option value="">选择一个班级</option>'],
    ['#backupTargetClass', '<option value="">选择被覆盖的班级</option>'],
    ['#qtClass', '<option value="">选择班级</option>'],
  ];
  pairs.forEach(([sel, head]) => {
    const el = $(sel);
    if (!el) return;
    const current = el.value;
    el.innerHTML = head + options;
    el.value = current;
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

/* ================= 全量操作日志 ================= */
const logView = { page: 1, pageSize: 20, range: 1, classId: '', actorRole: '', module: '', result: '', keyword: '' };

const MODULE_LABEL = {
  class: '班级业务', members: '成员管理', super: '超管后台',
  auth: '登录鉴权', backup: '备份恢复', query: '对外查询', system: '系统',
};

/** 后端返回下划线列名，转成前端习惯的驼峰，并拆出 before / after / diff */
function mapLog(r) {
  const raw = String(r.detail || '');
  const beforeIdx = raw.indexOf('BEFORE:');
  const afterIdx = raw.indexOf('AFTER:');
  let detail = raw;
  let before = null;
  let after = null;
  if (beforeIdx >= 0 || afterIdx >= 0) {
    detail = raw.slice(0, beforeIdx >= 0 ? beforeIdx : afterIdx).trim();
    const cut = (tag, nextTag) => {
      const start = raw.indexOf(tag);
      if (start < 0) return null;
      const body = nextTag && raw.indexOf(nextTag) > start ? raw.slice(start + tag.length, raw.indexOf(nextTag)) : raw.slice(start + tag.length);
      try {
        return JSON.parse(body.trim());
      } catch {
        return null;
      }
    };
    before = cut('BEFORE:', 'AFTER:');
    after = cut('AFTER:');
  }
  return {
    id: r.id,
    createdAt: r.created_at,
    actorId: r.actor_id,
    actorName: r.actor_name || '系统',
    actorRole: r.actor_role || '',
    classId: r.class_id,
    className: r.class_name || '',
    module: r.module,
    action: r.action,
    targetType: r.target_type || '',
    targetId: r.target_id || '',
    targetName: r.target_name || '',
    summary: r.summary || '',
    amount: r.amount || '',
    result: r.result || 'success',
    statusCode: r.status_code || 0,
    ip: r.ip || '',
    userAgent: r.user_agent || '',
    detailRaw: detail,
    before,
    after,
  };
}

async function loadLogs() {
  const q = { page: logView.page, pageSize: logView.pageSize };
  if (logView.range > 0) q.from = Date.now() - logView.range * 86400000;
  if (logView.classId) q.classId = logView.classId;
  if (logView.actorRole) q.actorRole = logView.actorRole;
  if (logView.module) q.module = logView.module;
  if (logView.result) q.result = logView.result;
  if (logView.keyword) q.keyword = logView.keyword;

  const data = await api.get('/super/logs', q);
  const items = data.items.map(mapLog);
  $('#logTotal').textContent = data.total;
  const table = $('#logTable');
  table.innerHTML = `
    <thead><tr>
      <th style="width:96px">时间</th><th>操作者</th><th>班级</th><th>动作</th>
      <th>摘要</th><th style="width:70px">结果</th>
    </tr></thead>
    <tbody>
      ${items
        .map(
          (row) => `<tr data-id="${row.id}" class="log-row">
            <td class="tiny muted nowrap">${fmtDateTime(row.createdAt)}</td>
            <td>
              <div class="cell-strong">${escapeHtml(row.actorName || '系统')}</div>
              <div class="tiny muted">${escapeHtml(ROLE_LABEL[row.actorRole] || row.actorRole || '系统')}</div>
            </td>
            <td class="tiny">${escapeHtml(row.className || '—')}</td>
            <td class="tiny nowrap">
              <span class="badge badge-slate">${escapeHtml(MODULE_LABEL[row.module] || row.module)}</span>
              <div class="tiny muted">${escapeHtml(row.action)}</div>
            </td>
            <td>
              <div class="tiny">${escapeHtml(row.summary || '（无摘要）')}</div>
              ${row.amount ? `<div class="tiny muted">数量：${escapeHtml(row.amount)}</div>` : ''}
            </td>
            <td>${row.result === 'success'
              ? '<span class="badge badge-green">成功</span>'
              : `<span class="badge badge-rose">${escapeHtml(String(row.statusCode || '失败'))}</span>`}</td>
          </tr>`
        )
        .join('')}
      ${items.length ? '' : '<tr><td colspan="6"><div class="empty">这段时间没有匹配的操作记录</div></td></tr>'}
    </tbody>`;
  renderPager($('#logPager'), {
    page: logView.page,
    pageSize: logView.pageSize,
    total: data.total,
    onChange: (p) => {
      logView.page = p;
      loadLogs();
    },
  });
  table.onclick = (e) => {
    const tr = e.target.closest('tr.log-row');
    if (!tr) return;
    const row = items.find((x) => x.id === tr.dataset.id);
    if (row) openLogDetail(row);
  };
}

function kvBlock(obj) {
  if (!obj || typeof obj !== 'object') return '<div class="empty">无</div>';
  const rows = Object.entries(obj).map(
    ([k, v]) => `<div class="sheet-item"><span class="tiny muted nowrap">${escapeHtml(k)}</span>
      <span class="grow tiny" style="text-align:right;word-break:break-all">${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''))}</span></div>`
  );
  return rows.join('') || '<div class="empty">无</div>';
}

function openLogDetail(row) {
  const diff = [];
  if (row.before && row.after) {
    Object.keys(row.after).forEach((k) => {
      const b = row.before[k];
      const a = row.after[k];
      if (JSON.stringify(b) !== JSON.stringify(a)) diff.push({ key: k, from: b, to: a });
    });
  }
  openModal({
    title: '操作详情',
    wide: true,
    body: `<div class="col">
      <div class="tiny muted">${escapeHtml(fmtDateTime(row.createdAt))} · IP ${escapeHtml(row.ip || '—')}</div>
      <div class="row wrap">
        <span class="badge">${escapeHtml(row.actorName)}</span>
        <span class="badge badge-slate">${escapeHtml(ROLE_LABEL[row.actorRole] || row.actorRole || '系统')}</span>
        ${row.className ? `<span class="badge badge-green">${escapeHtml(row.className)}</span>` : ''}
        <span class="badge ${row.result === 'success' ? 'badge-green' : 'badge-rose'}">${row.result === 'success' ? '成功' : `失败 ${escapeHtml(String(row.statusCode || ''))}`}</span>
      </div>
      <div class="field"><label>动作</label><div class="tiny">${escapeHtml(`${row.module}.${row.action}`)}${row.targetType ? ` → ${escapeHtml(row.targetType)}${row.targetName ? ` / ${escapeHtml(row.targetName)}` : ''}` : ''}</div></div>
      <div class="field"><label>摘要</label><div class="tiny">${escapeHtml(row.summary || '（无）')}</div></div>
      ${row.amount ? `<div class="field"><label>数量</label><div class="tiny">${escapeHtml(row.amount)}</div></div>` : ''}
      ${diff.length
        ? `<div class="field"><label>变更字段（前 → 后）</label>
            ${diff.map((d) => `<div class="sheet-item"><span class="tiny muted nowrap">${escapeHtml(d.key)}</span>
              <span class="grow tiny" style="text-align:right">
                <s style="color:var(--c-ink-4)">${escapeHtml(typeof d.from === 'object' ? JSON.stringify(d.from) : String(d.from ?? ''))}</s>
                → <b>${escapeHtml(typeof d.to === 'object' ? JSON.stringify(d.to) : String(d.to ?? ''))}</b></span></div>`).join('')}
          </div>`
        : ''}
      ${row.before ? `<div class="field"><label>变更前快照</label>${kvBlock(row.before)}</div>` : ''}
      ${row.after ? `<div class="field"><label>变更后快照</label>${kvBlock(row.after)}</div>` : ''}
      ${row.detailRaw ? `<div class="field"><label>请求明细</label><div class="tiny" style="word-break:break-all;white-space:pre-wrap">${escapeHtml(row.detailRaw)}</div></div>` : ''}
      ${row.userAgent ? `<div class="field"><label>客户端 UA</label><div class="tiny muted" style="word-break:break-all">${escapeHtml(row.userAgent)}</div></div>` : ''}
    </div>`,
    footer: '<button class="btn btn-ghost" data-close>关闭</button>',
  });
}

function logExportQuery() {
  const q = {};
  if (logView.range > 0) q.from = Date.now() - logView.range * 86400000;
  if (logView.classId) q.classId = logView.classId;
  if (logView.actorRole) q.actorRole = logView.actorRole;
  if (logView.module) q.module = logView.module;
  if (logView.result) q.result = logView.result;
  if (logView.keyword) q.keyword = logView.keyword;
  return q;
}

function showTokenShare(token) {
  const url = `${window.location.origin}/query.html?token=${encodeURIComponent(token)}`;
  openModal({
    title: '把这段发给家长',
    body: `<div class="col">
      <div class="field"><label>查询入口</label>
        <div class="row">
          <input class="input grow" id="shareUrl" value="${escapeHtml(url)}" readonly />
          <button class="btn btn-sm btn-primary" id="shareCopy">复制</button>
        </div>
      </div>
      <div class="field"><label>班级查询口令</label>
        <div class="num" style="font-size:24px;font-weight:800;letter-spacing:.12em">${escapeHtml(token)}</div>
      </div>
      <div class="tiny muted">复制链接后发给家长即可，家长打开页面填写姓名与学号就能自助查成绩，不需要注册账号。</div>
    </div>`,
    footer: '<button class="btn btn-ghost" data-close>关闭</button><a class="btn btn-primary" id="shareOpen" target="_blank" rel="noopener">预览页面</a>',
    onMount(m) {
      const input = m.querySelector('#shareUrl');
      m.querySelector('#shareOpen').href = url;
      m.querySelector('#shareCopy').onclick = async () => {
        input.select();
        try {
          await navigator.clipboard.writeText(input.value);
          toast('已复制到剪贴板', 'ok');
        } catch {
          document.execCommand('copy');
          toast('已复制', 'ok');
        }
      };
    },
  });
}

/* ================= 数据备份 ================= */
async function runImportBackup() {
  const mode = $('#backupMode').value;
  const targetClassId = $('#backupTargetClass').value;
  const className = $('#backupClassName').value.trim();
  if (mode === 'replace' && !targetClassId) return toast('覆盖模式请先选择被覆盖的班级', 'err');
  const form = new FormData();
  form.append('mode', mode);
  form.append('targetClassId', targetClassId);
  form.append('className', className);
  const file = $('#backupFile').files[0];
  const text = $('#backupText').value.trim();
  if (!file && !text) return toast('请上传备份文件或粘贴备份内容', 'err');
  if (file) form.append('file', file);
  else form.append('text', text);
  if (mode === 'replace') {
    const ok = await confirmDialog({
      title: '覆盖导入',
      message: '覆盖模式会用备份内容完全替换目标班级现有数据，确定继续？',
      okText: '覆盖导入',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    const res = await api.upload('/super/backup/import', form);
    $('#backupResult').innerHTML = `<span style="color:var(--c-green)">导入成功</span>：班级「${escapeHtml(res.name || '')}」，
      学生 ${res.counts ? res.counts.students : 0} 人 / 积分 ${res.counts ? res.counts.pointLogs : 0} 条 /
      成绩 ${res.counts ? res.counts.scores : 0} 条 / 账号档案 ${res.counts ? res.counts.members : 0} 个`;
    $('#backupFile').value = '';
    $('#backupText').value = '';
    toast('备份已导入', 'ok');
    await Promise.all([loadClasses(), loadAccounts(), loadStats(), loadLogs()]);
  } catch (err) {
    toast(err.message, 'err');
  }
  return undefined;
}

/* ================= 成绩对外查询口令 ================= */
const SCOPE_LABEL = { scores: '仅成绩', points: '仅积分', all: '成绩 + 积分' };
const MODE_LABEL = { name_no: '姓名 + 学号', phone: '姓名 + 家长手机后 4 位', none: '仅姓名' };

/** 成绩自助查询总开关：读取并反映到 UI，避免与单次「开/关某个口令」混淆 */
async function loadPublicQuerySetting() {
  try {
    const data = await api.get('/super/settings/public-query');
    const t = $('#publicQueryToggle');
    if (t) t.checked = !!data.enabled;
  } catch {
    /* 忽略，开关默认不勾选即可 */
  }
}

async function loadQueryTokens() {
  const data = await api.get('/super/query-tokens');
  const items = data.items || [];
  $('#qtCount').textContent = items.length;
  $('#qtTable').innerHTML = `
    <thead><tr>
      <th>班级</th><th>口令</th><th>查询范围</th><th>校验方式</th><th>状态</th>
      <th class="nowrap">最近使用</th><th style="width:190px">操作</th>
    </tr></thead>
    <tbody>
      ${items
        .map(
          (t) => `<tr data-id="${t.id}">
            <td>
              <div class="cell-strong">${escapeHtml(t.className)}</div>
              <div class="tiny muted">${escapeHtml(t.name || '未命名')}</div>
            </td>
            <td class="num"><code style="letter-spacing:.06em">${escapeHtml(t.token)}</code></td>
            <td class="tiny">${escapeHtml(SCOPE_LABEL[t.scope] || t.scope)}</td>
            <td class="tiny">${escapeHtml(MODE_LABEL[t.mode] || t.mode)}</td>
            <td>
              ${t.enabled ? '<span class="badge badge-green">启用中</span>' : '<span class="badge badge-rose">已停用</span>'}
              ${t.expiresAt ? `<div class="tiny muted nowrap">至 ${fmtDate(t.expiresAt)}</div>` : '<div class="tiny muted">长期有效</div>'}
            </td>
            <td class="tiny muted nowrap">${t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : '未使用'}</td>
            <td>
              <div class="row" style="gap:6px">
                <button class="btn btn-sm btn-ghost" data-qt="copy" data-token="${escapeHtml(t.token)}">复制入口</button>
                <button class="btn btn-sm btn-ghost" data-qt="toggle">${t.enabled ? '停用' : '启用'}</button>
                <button class="btn btn-sm btn-danger" data-qt="delete">删除</button>
              </div>
            </td>
          </tr>`
        )
        .join('')}
      ${items.length ? '' : '<tr><td colspan="7"><div class="empty">还没有查询口令，先在上方生成</div></td></tr>'}
    </tbody>`;
}

/* ================= 绑定 ================= */
export async function mountSuperApp({ logout }) {
  await Promise.all([loadStats(), loadClasses(), loadAccounts(), loadRecycle(), loadLogs()]);

  $('#btnSuperLogout').onclick = logout;

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
      await Promise.all([loadStats(), loadClasses(), loadAccounts(), loadLogs()]);
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
    $('#superLogsPanel').classList.toggle('hidden', view.tab !== 'logs');
    $('#superBackupPanel').classList.toggle('hidden', view.tab !== 'backup');
    $('#superQueryPanel').classList.toggle('hidden', view.tab !== 'query');
    $('#recycleCard').classList.toggle('hidden', view.tab !== 'classes');
    if (view.tab === 'logs') loadLogs();
    if (view.tab === 'query') {
      loadQueryTokens();
      loadPublicQuerySetting();
    }
    if (view.tab === 'backup') syncClassSelects();
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

  /* ---------- 操作日志 ---------- */
  $('#logRangeTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    $$('#logRangeTabs .pill').forEach((b) => b.classList.toggle('active', b === btn));
    logView.range = Number(btn.dataset.range);
    logView.page = 1;
    loadLogs();
  });
  const bindLogFilter = (sel, key) => {
    $(sel).addEventListener('change', (e) => {
      logView[key] = e.target.value;
      logView.page = 1;
      loadLogs();
    });
  };
  bindLogFilter('#logClass', 'classId');
  bindLogFilter('#logRole', 'actorRole');
  bindLogFilter('#logModule', 'module');
  bindLogFilter('#logResult', 'result');
  $('#logKeyword').addEventListener('input', (e) => {
    clearTimeout(view._t3);
    view._t3 = setTimeout(() => {
      logView.keyword = e.target.value.trim();
      logView.page = 1;
      loadLogs();
    }, 300);
  });
  $('#btnLogRefresh').onclick = loadLogs;
  $('#btnLogExport').onclick = () => api.download('/super/logs/export.csv', logExportQuery());
  $('#btnLogClear').onclick = async () => {
    const days = await new Promise((resolve) => {
      openModal({
        title: '清理旧日志',
        body: `<div class="field"><label>保留最近多少天的操作日志</label>
            <input class="input num" id="clrDays" type="number" value="180" min="1" max="3650" /></div>
            <div class="tiny muted" style="margin-top:8px">更早的记录会被永久删除，且无法恢复；建议先导出 CSV 留档。</div>`,
        footer: '<button class="btn btn-ghost" data-cancel>取消</button><button class="btn btn-danger" id="clrOk">确认清理</button>',
        onClose: () => resolve(null),
        onMount(m) {
          m.querySelector('[data-cancel]').onclick = () => {
            closeModal();
            resolve(null);
          };
          m.querySelector('#clrOk').onclick = () => {
            const v = Number(m.querySelector('#clrDays').value);
            closeModal();
            resolve(v > 0 ? v : null);
          };
        },
      });
    });
    if (!days) return;
    try {
      const res = await api.post('/super/logs/clear', { days });
      toast(`已清理 ${res.removed} 条旧日志`, 'ok');
      await loadLogs();
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  /* ---------- 数据备份 ---------- */
  $('#btnBackupClass').onclick = () => {
    const id = $('#backupClass').value;
    if (!id) return toast('请先选择要备份的班级', 'err');
    api.download(`/super/backup/class/${id}`);
    return undefined;
  };
  $('#btnBackupPlatform').onclick = () => api.download('/super/backup/platform');
  $('#btnBackupImport').onclick = runImportBackup;
  $('#backupMode').addEventListener('change', (e) => {
    $('#backupTargetClass').style.display = e.target.value === 'replace' ? '' : 'none';
  });

  /* ---------- 成绩对外查询口令 ---------- */
  $('#btnQtRefresh').onclick = loadQueryTokens;
  $('#publicQueryToggle').onchange = async (e) => {
    const enabled = e.target.checked;
    const ok = await confirmDialog({
      title: enabled ? '开启成绩自助查询' : '关闭成绩自助查询',
      message: enabled
        ? '开启后，登录页会重新显示查询入口，家长可凭口令自助查成绩。'
        : '关闭后，登录页将不再显示查询入口，家长公开查询页也无法访问；教师端与班级工作台完全不受影响。各口令仍保留，重新开启即可恢复。',
      okText: enabled ? '开启' : '确认关闭',
      danger: !enabled,
    });
    if (!ok) {
      e.target.checked = !enabled; // 用户取消，恢复开关原状态
      return;
    }
    try {
      await api.post('/super/settings/public-query', { enabled });
      toast(enabled ? '已开启成绩自助查询' : '已关闭成绩自助查询', 'ok');
      await loadLogs();
    } catch (err) {
      e.target.checked = !enabled;
      toast(err.message, 'err');
    }
  };
  $('#btnQtCreate').onclick = async () => {
    const classId = $('#qtClass').value;
    if (!classId) return toast('请先选择班级', 'err');
    try {
      const res = await api.post('/super/query-tokens', {
        classId,
        name: $('#qtName').value.trim(),
        scope: $('#qtScope').value,
        mode: $('#qtMode').value,
        days: Number($('#qtDays').value),
      });
      $('#qtName').value = '';
      toast(`口令已生成：${res.token}`, 'ok');
      await loadQueryTokens();
      showTokenShare(res.token);
    } catch (err) {
      toast(err.message, 'err');
    }
    return undefined;
  };
  $('#qtTable').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-qt]');
    if (!btn) return;
    const id = btn.closest('tr[data-id]').dataset.id;
    const act = btn.dataset.qt;
    if (act === 'copy') return showTokenShare(btn.dataset.token);
    try {
      if (act === 'toggle') {
        const enabled = btn.textContent.trim() === '启用';
        await api.patch(`/super/query-tokens/${id}`, { enabled });
        toast(enabled ? '口令已启用' : '口令已停用', 'ok');
        await loadQueryTokens();
      }
      if (act === 'delete') {
        const ok = await confirmDialog({ title: '删除口令', message: '删除后持有该口令的家长将无法再查询，确定继续？', okText: '删除', danger: true });
        if (!ok) return undefined;
        await api.del(`/super/query-tokens/${id}`);
        toast('口令已删除', 'ok');
        await loadQueryTokens();
      }
    } catch (err) {
      toast(err.message, 'err');
    }
    return undefined;
  });

  // 下拉菜单定位：改用 fixed 定位，避开祖先 overflow:hidden 裁剪；贴近视口底部时向上翻转
  function positionDropdown(dropdown) {
    const btn = dropdown.querySelector('[data-more]');
    const menu = dropdown.querySelector('.dropdown-menu');
    if (!btn || !menu) return;
    const r = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.right = 'auto';
    menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
    let top = r.bottom + 6;
    const placeAbove = top + menu.offsetHeight > window.innerHeight - 8;
    if (placeAbove) top = Math.max(8, r.top - menu.offsetHeight - 6);
    menu.style.top = `${top}px`;
    menu.classList.toggle('drop-up', placeAbove);
  }
  function resetDropdownMenu(dropdown) {
    const menu = dropdown.querySelector('.dropdown-menu');
    if (!menu) return;
    menu.style.position = menu.style.top = menu.style.left = menu.style.right = '';
    menu.classList.remove('drop-up');
  }

  const handleDropdown = (tableSel, onAction) => {
    $(tableSel).addEventListener('click', async (e) => {
      const more = e.target.closest('[data-more]');
      if (more) {
        const dropdown = more.closest('[data-dropdown]');
        const wasOpen = dropdown.classList.contains('open');
        $$('[data-dropdown]').forEach((d) => {
          d.classList.remove('open');
          resetDropdownMenu(d);
        });
        if (!wasOpen) {
          dropdown.classList.add('open');
          positionDropdown(dropdown);
        }
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      $$('[data-dropdown]').forEach((d) => {
        d.classList.remove('open');
        resetDropdownMenu(d);
      });
      const id = act.closest('tr[data-id]').dataset.id;
      await onAction(act.dataset.act, id);
    });
  };

  // 滚动/缩放时收起已展开的下拉，避免 fixed 菜单脱离触发按钮
  window.addEventListener('scroll', () => {
    $$('[data-dropdown].open').forEach((d) => {
      d.classList.remove('open');
      resetDropdownMenu(d);
    });
  }, true);

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
        await Promise.all([loadClasses(), loadAccounts(), loadStats(), loadRecycle(), loadLogs()]);
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
        await Promise.all([loadAccounts(), loadStats(), loadLogs()]);
      } catch (err) {
        toast(err.message, 'err');
      }
    }
    return undefined;
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-dropdown]')) $$('[data-dropdown]').forEach((d) => {
      d.classList.remove('open');
      resetDropdownMenu(d);
    });
  });
}
