/** 班级端：学生榜、小组榜、积分记录、个人中心与各类弹层（按角色能力显隐） */
import { api } from './api.js';
import {
  $, $$, escapeHtml, toast, openModal, closeModal, confirmDialog, fmtDateTime, debounce, renderPager,
} from './ui.js';
import { rangeBounds, state, myClass, can, roleLabel } from './store.js';

let onLogout = null;

/* ================= 概览与权限 ================= */
export async function refreshOverview() {
  const data = await api.get('/class/overview');
  state.overview = data;
  $('#statStudents').textContent = data.stats.students;
  $('#statRecords').textContent = data.stats.records;
  if ($('#statToday')) $('#statToday').textContent = data.stats.todayRecords ?? 0;
  if ($('#statGroups')) $('#statGroups').textContent = data.stats.groups ?? 0;
  const cls = data.class || {};
  $('#appTitle').textContent = cls.name || '班级积分管理';
  $('#appRole').textContent = roleLabel();
  $('#appAccount').textContent = data.account ? data.account.username : '';
  const badge = $('#appBadge');
  if (cls.badge) badge.innerHTML = `<img src="${escapeHtml(cls.badge)}" alt="班级徽章" />`;
  else badge.textContent = '积';
  return data;
}

/** 按能力隐藏入口，前端只做体验层裁剪 */
export function applyPermissions() {
  $('#addCollapse').classList.toggle('hidden', !can('student:create'));
  $('#importCollapse').classList.toggle('hidden', !can('student:create'));
  $('#btnBatch').classList.toggle('hidden', !can('points:batch'));
  $('#btnExport').classList.toggle('hidden', !can('export:data'));
  $('#viewTabs [data-view="mall"]').classList.toggle('hidden', !can('gift:read'));
  $('#viewTabs [data-view="seat"]').classList.toggle('hidden', !can('seat:read'));
  $('#viewTabs [data-view="scores"]').classList.toggle('hidden', !can('exam:read'));
  $('#viewTabs [data-view="members"]').classList.toggle('hidden', !can('member:read'));
}

/* ================= 学生榜 ================= */
export async function loadStudents() {
  const s = state.students;
  const bounds = s.sort === 'time' ? rangeBounds(s.range) : { from: 0, to: 0 };
  const data = await api.get('/class/students', {
    search: s.search,
    sort: s.sort,
    page: s.page,
    pageSize: s.pageSize,
    from: bounds.from,
    to: bounds.to,
  });
  s.items = data.items;
  s.total = data.total;
  renderStudents();
  renderPager($('#studentPager'), {
    page: s.page,
    pageSize: s.pageSize,
    total: s.total,
    onChange: (p) => {
      s.page = p;
      loadStudents();
    },
  });
}

function renderStudents() {
  const s = state.students;
  const container = $('#studentList');
  if (!s.items.length) {
    container.innerHTML = `<div class="empty">${s.search ? '没有匹配的学生' : '还没有学生，先添加或导入名单吧'}</div>`;
    return;
  }
  const offset = (s.page - 1) * s.pageSize;
  const canEdit = can('student:update');
  const canDelete = can('student:delete');
  const canPoint = can('points:single');
  container.innerHTML = s.items
    .map((stu, i) => {
      const rank = offset + i + 1;
      const rankCls = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : '';
      const points = s.sort === 'time' ? stu.rangePoints ?? 0 : stu.points;
      const ops = [
        canPoint ? `<button class="op-btn add" data-act="add">加分</button>` : '',
        canPoint ? `<button class="op-btn sub" data-act="sub">减分</button>` : '',
        can('history:read') ? `<button class="op-btn" data-act="history">历史</button>` : '',
        canEdit ? `<button class="op-btn" data-act="edit">编辑</button>` : '',
        canDelete ? `<button class="op-btn" data-act="delete">删除</button>` : '',
      ].join('');
      return `<div class="table-row" data-id="${stu.id}" role="row">
        <div role="cell"><div class="rank-badge ${rankCls}">${rank}</div></div>
        <div role="cell">
          <div class="stu-name">${escapeHtml(stu.name)}</div>
          <div class="stu-sub">${escapeHtml(stu.sex || '—')}${stu.position ? ` · ${escapeHtml(stu.position)}` : ''}</div>
        </div>
        <div class="center" role="cell">${stu.groupName ? `<span class="badge">${escapeHtml(stu.groupName)}</span>` : '<span class="tiny muted">—</span>'}</div>
        <div class="center tiny muted col-position" role="cell">${escapeHtml(stu.position || '—')}</div>
        <div class="right col-points" role="cell"><span class="points-pill ${points < 0 ? 'neg' : ''}">${points}</span></div>
        ${ops ? `<div class="ops" role="cell">${ops}</div>` : '<div role="cell"></div>'}
      </div>`;
    })
    .join('');
}

/* ================= 加减分 ================= */
async function getRules() {
  return api.get('/class/rules').catch(() => []);
}

export async function openPointsModal(student, mode = 'add') {
  const rules = await getRules();
  const positive = rules.filter((r) => r.score > 0);
  const negative = rules.filter((r) => r.score < 0);
  const cls = myClass();
  let currentMode = mode;
  const limit = cls.cadreLimitPer || 5;
  const isCadre = state.me && state.me.account.role === 'cadre';
  openModal({
    title: mode === 'add' ? `给 ${student.name} 加分` : `给 ${student.name} 减分`,
    body: `
      <div class="between" style="margin-bottom:12px">
        <div class="tiny muted">当前积分 <b class="num">${student.points}</b></div>
        <div class="pill-group" id="pmMode">
          <button class="pill ${mode === 'add' ? 'active' : ''}" data-mode="add">加分</button>
          <button class="pill" data-mode="sub">减分</button>
        </div>
      </div>
      ${isCadre ? `<div class="tiny muted" style="margin-bottom:8px">班干部单次最多 ${limit} 分，每日累计上限 ${cls.cadreLimitDay || 20} 分。</div>` : ''}
      <div class="chip-list" id="pmRules" style="margin-bottom:12px"></div>
      <div class="row" style="margin-bottom:12px">
        <input class="input num" id="pmScore" type="number" value="${mode === 'add' ? 1 : -1}" min="${isCadre ? -limit : -1000}" max="${isCadre ? limit : 1000}" />
        ${can('rules:write') ? '<button class="btn btn-sm btn-ghost" id="pmRulesEdit">设置</button>' : ''}
      </div>
      <div class="field">
        <label>原因（选填）</label>
        <input class="input" id="pmReason" placeholder="如：主动打扫卫生、作业未完成…" maxlength="60" />
      </div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="pmSubmit">确认提交</button>',
    onMount(m) {
      const renderChips = () => {
        const list = currentMode === 'add' ? positive : negative;
        m.querySelector('#pmRules').innerHTML = list.length
          ? list.map((r) => `<button class="chip ${r.score > 0 ? 'pos' : 'neg'}" data-score="${r.score}">${escapeHtml(r.name)} ${r.score > 0 ? '+' : ''}${r.score}</button>`).join('')
          : `<span class="tiny muted">暂无${currentMode === 'add' ? '加分' : '减分'}规则</span>`;
      };
      renderChips();
      m.querySelector('#pmMode').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mode]');
        if (!btn) return;
        currentMode = btn.dataset.mode;
        $$('#pmMode .pill', m).forEach((b) => b.classList.toggle('active', b === btn));
        m.querySelector('#pmScore').value = currentMode === 'add' ? 1 : -1;
        renderChips();
      });
      m.querySelector('#pmRules').addEventListener('click', (e) => {
        const chip = e.target.closest('[data-score]');
        if (chip) m.querySelector('#pmScore').value = chip.dataset.score;
      });
      const editBtn = m.querySelector('#pmRulesEdit');
      if (editBtn) editBtn.onclick = () => openRulesModal();
      m.querySelector('#pmSubmit').onclick = async () => {
        const raw = Number(m.querySelector('#pmScore').value);
        if (!Number.isFinite(raw) || raw === 0) return toast('请输入有效分值', 'err');
        const delta = currentMode === 'add' ? Math.abs(raw) : -Math.abs(raw);
        const btn = m.querySelector('#pmSubmit');
        btn.disabled = true;
        try {
          await api.post('/class/points', { studentIds: [student.id], delta, reason: m.querySelector('#pmReason').value.trim() });
          closeModal();
          toast(`${student.name} ${delta > 0 ? '+' : ''}${delta} 分`, 'ok');
          await Promise.all([loadStudents(), refreshOverview()]);
        } catch (err) {
          toast(err.message, 'err');
          btn.disabled = false;
        }
        return undefined;
      };
    },
  });
}

/* ================= 快捷规则 ================= */
export async function openRulesModal() {
  let rules = await getRules();
  const render = (m) => {
    m.querySelector('#ruleList').innerHTML = rules.length
      ? rules
          .map(
            (r) => `<div class="sheet-item">
              <span class="chip ${r.score > 0 ? 'pos' : 'neg'} num">${r.score > 0 ? '+' : ''}${r.score}</span>
              <span class="grow">${escapeHtml(r.name)}</span>
              <button class="btn btn-sm btn-ghost" data-del="${r.id}">删除</button>
            </div>`
          )
          .join('')
      : '<div class="empty">还没有规则</div>';
  };
  openModal({
    title: '快捷加减分规则',
    body: `
      <div id="ruleList"></div>
      <div class="divider"></div>
      <div class="row">
        <input class="input grow" id="ruleName" placeholder="规则名，如：作业优秀" maxlength="20" />
        <input class="input num" id="ruleScore" type="number" placeholder="分值" style="width:80px" />
        <button class="btn btn-sm btn-primary" id="ruleAdd">添加</button>
      </div>
      <div class="row wrap" style="margin-top:12px">
        <button class="btn btn-sm btn-ghost" id="ruleImport">导入 Excel</button>
        <button class="btn btn-sm btn-ghost" id="ruleTpl">模板</button>
        <button class="btn btn-sm btn-ghost" id="ruleReset">恢复默认</button>
        <input type="file" id="ruleFile" accept=".xlsx,.xls,.csv" class="hidden" />
      </div>`,
    footer: '<button class="btn btn-primary" data-close>完成</button>',
    onMount(m) {
      render(m);
      m.querySelector('#ruleAdd').onclick = async () => {
        const name = m.querySelector('#ruleName').value.trim();
        const score = Number(m.querySelector('#ruleScore').value);
        if (!name) return toast('请输入规则名', 'err');
        if (!score) return toast('请输入非 0 分值', 'err');
        try {
          rules = await api.post('/class/rules', { name, score });
          m.querySelector('#ruleName').value = '';
          m.querySelector('#ruleScore').value = '';
          render(m);
        } catch (err) {
          toast(err.message, 'err');
        }
        return undefined;
      };
      m.querySelector('#ruleList').addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-del]');
        if (!btn) return;
        rules = await api.del(`/class/rules/${btn.dataset.del}`);
        render(m);
      });
      m.querySelector('#ruleReset').onclick = async () => {
        rules = await api.post('/class/rules/reset');
        render(m);
        toast('已恢复默认规则', 'ok');
      };
      m.querySelector('#ruleTpl').onclick = () => api.download('/class/rules/template');
      m.querySelector('#ruleImport').onclick = () => m.querySelector('#ruleFile').click();
      m.querySelector('#ruleFile').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const form = new FormData();
        form.append('file', file);
        try {
          const res = await api.upload('/class/rules/import', form);
          rules = res.rules;
          render(m);
          toast(`成功导入 ${res.added} 条规则`, 'ok');
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    },
  });
}

/* ================= 批量加减 ================= */
export async function openBatchModal() {
  const students = (await api.get('/class/students', { pageSize: 200 })).items;
  if (!students.length) return toast('还没有学生', 'err');
  const groups = [...new Set(students.map((s) => s.groupName || '未分组'))];
  const selected = new Set();
  let mode = 'student';
  openModal({
    title: '批量加减分',
    body: `
      <div class="between" style="margin-bottom:12px">
        <div class="pill-group" id="batchMode">
          <button class="pill active" data-mode="student">按学生</button>
          <button class="pill" data-mode="group">按小组</button>
        </div>
        <div class="tiny muted" id="batchCount">已选 0 人</div>
      </div>
      <div id="batchPick" style="max-height:220px;overflow:auto"></div>
      <div class="row wrap" style="margin:12px 0">
        <button class="btn btn-sm btn-ghost" id="batchAll">全选</button>
        <button class="btn btn-sm btn-ghost" id="batchNone">全不选</button>
      </div>
      <div class="row">
        <input class="input num" id="batchScore" type="number" placeholder="分值" value="1" />
        <input class="input" id="batchReason" placeholder="统一原因（选填）" maxlength="60" />
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn btn-success grow" id="batchAdd">批量加分</button>
        <button class="btn btn-danger grow" id="batchSub">批量减分</button>
      </div>`,
    onMount(m) {
      const renderPick = () => {
        const box = m.querySelector('#batchPick');
        if (mode === 'student') {
          box.innerHTML = students
            .map(
              (s) => `<label class="sheet-item" style="cursor:pointer">
                <input type="checkbox" data-id="${s.id}" ${selected.has(s.id) ? 'checked' : ''} />
                <span class="grow stu-name">${escapeHtml(s.name)}</span>
                <span class="tiny muted num">${s.points} 分</span>
              </label>`
            )
            .join('');
        } else {
          box.innerHTML = groups
            .map((g) => {
              const members = students.filter((s) => (s.groupName || '未分组') === g);
              return `<label class="sheet-item" style="cursor:pointer">
                <input type="checkbox" data-group="${escapeHtml(g)}" ${selected.has(`g:${g}`) ? 'checked' : ''} />
                <span class="grow stu-name">${escapeHtml(g)}</span>
                <span class="tiny muted num">${members.length} 人</span>
              </label>`;
            })
            .join('');
        }
        updateCount();
      };
      const pickedIds = () => {
        if (mode === 'student') return [...selected];
        const picked = new Set([...selected].map((k) => k.slice(2)));
        return students.filter((s) => picked.has(s.groupName || '未分组')).map((s) => s.id);
      };
      const updateCount = () => {
        m.querySelector('#batchCount').textContent = `已选 ${pickedIds().length} 人`;
      };
      renderPick();
      m.querySelector('#batchMode').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mode]');
        if (!btn) return;
        mode = btn.dataset.mode;
        $$('#batchMode .pill', m).forEach((b) => b.classList.toggle('active', b === btn));
        selected.clear();
        renderPick();
      });
      m.querySelector('#batchPick').addEventListener('change', (e) => {
        const box = e.target;
        if (box.dataset.id) {
          if (box.checked) selected.add(box.dataset.id);
          else selected.delete(box.dataset.id);
        } else if (box.dataset.group) {
          const key = `g:${box.dataset.group}`;
          if (box.checked) selected.add(key);
          else selected.delete(key);
        }
        updateCount();
      });
      m.querySelector('#batchAll').onclick = () => {
        if (mode === 'student') students.forEach((s) => selected.add(s.id));
        else groups.forEach((g) => selected.add(`g:${g}`));
        renderPick();
        $$('#batchPick input', m).forEach((el) => {
          el.checked = true;
        });
      };
      m.querySelector('#batchNone').onclick = () => {
        selected.clear();
        renderPick();
      };
      const submit = async (sign) => {
        const score = Math.abs(Number(m.querySelector('#batchScore').value));
        if (!score) return toast('请输入分值', 'err');
        const ids = pickedIds();
        if (!ids.length) return toast('请先选择学生或小组', 'err');
        try {
          await api.post('/class/points', { studentIds: ids, delta: sign * score, reason: m.querySelector('#batchReason').value.trim() });
          closeModal();
          toast(`已为 ${ids.length} 人${sign > 0 ? '加' : '减'} ${score} 分`, 'ok');
          await Promise.all([loadStudents(), refreshOverview()]);
        } catch (err) {
          toast(err.message, 'err');
        }
        return undefined;
      };
      m.querySelector('#batchAdd').onclick = () => submit(1);
      m.querySelector('#batchSub').onclick = () => submit(-1);
    },
  });
}

/* ================= 学生编辑 / 历史 ================= */
/** 学生档案字段集合：新增、编辑、列表详情三处共用，保证口径一致 */
const PROFILE_FIELDS = [
  ['editStudentNo', 'inputStudentNo', 'studentNo'],
  ['editBirthday', 'inputBirthday', 'birthday'],
  ['editAddress', 'inputAddress', 'address'],
  ['editGuardianName', 'inputGuardianName', 'guardianName'],
  ['editGuardianPhone', 'inputGuardianPhone', 'guardianPhone'],
  ['editGuardianRelation', 'inputGuardianRelation', 'guardianRelation'],
  ['editGuardianAltPhone', 'inputGuardianAltPhone', 'guardianAltPhone'],
  ['editNote', 'inputNote', 'note'],
];

export function openEditModal(student) {
  const val = (key) => escapeHtml(student[key] || '');
  openModal({
    title: `编辑学生 · ${student.name}`,
    body: `
      <div class="col">
        <div class="row">
          <div class="field grow"><label>姓名</label><input class="input" id="editName" value="${escapeHtml(student.name)}" maxlength="20" /></div>
          <div class="field grow"><label>学号</label><input class="input" id="editStudentNo" value="${val('studentNo')}" maxlength="24" /></div>
        </div>
        <div class="row">
          <div class="field grow"><label>小组</label><input class="input" id="editGroup" value="${escapeHtml(student.groupName || '')}" maxlength="20" /></div>
          <div class="field grow"><label>职务</label><input class="input" id="editPosition" value="${escapeHtml(student.position || '')}" maxlength="20" /></div>
        </div>
        <div class="row">
          <div class="field grow"><label>性别</label>
            <select class="select" id="editSex">
              <option value="" ${!student.sex ? 'selected' : ''}>未填写</option>
              <option value="男" ${student.sex === '男' ? 'selected' : ''}>男</option>
              <option value="女" ${student.sex === '女' ? 'selected' : ''}>女</option>
            </select>
          </div>
          <div class="field grow"><label>出生日期</label><input class="input" id="editBirthday" value="${val('birthday')}" maxlength="20" placeholder="2015-09-01" /></div>
        </div>

        <div class="divider-label">家长联系方式</div>
        <div class="row">
          <div class="field grow"><label>家长姓名</label><input class="input" id="editGuardianName" value="${val('guardianName')}" maxlength="20" /></div>
          <div class="field" style="width:120px"><label>关系</label>
            <select class="select" id="editGuardianRelation">
              ${['', '父亲', '母亲', '祖父', '祖母', '外祖父', '外祖母', '其他']
                .map((r) => `<option value="${r}" ${student.guardianRelation === r ? 'selected' : ''}>${r || '未填写'}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field grow"><label>家长手机号</label><input class="input" id="editGuardianPhone" value="${val('guardianPhone')}" inputmode="tel" maxlength="24" /></div>
          <div class="field grow"><label>备用电话</label><input class="input" id="editGuardianAltPhone" value="${val('guardianAltPhone')}" inputmode="tel" maxlength="24" /></div>
        </div>
        <div class="field"><label>家庭住址</label><input class="input" id="editAddress" value="${val('address')}" maxlength="120" /></div>
        <div class="field"><label>备注</label><input class="input" id="editNote" value="${val('note')}" maxlength="200" /></div>
      </div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="editSave">保存修改</button>',
    onMount(m) {
      m.querySelector('#editSave').onclick = async () => {
        const payload = {
          name: m.querySelector('#editName').value.trim(),
          groupName: m.querySelector('#editGroup').value.trim(),
          sex: m.querySelector('#editSex').value,
          position: m.querySelector('#editPosition').value.trim(),
        };
        PROFILE_FIELDS.forEach(([editId, , key]) => {
          payload[key] = m.querySelector(`#${editId}`).value.trim();
        });
        if (!payload.name) return toast('姓名不能为空', 'err');
        try {
          await api.patch(`/class/students/${student.id}`, payload);
          closeModal();
          toast('已保存', 'ok');
          await Promise.all([loadStudents(), refreshOverview()]);
        } catch (err) {
          toast(err.message, 'err');
        }
        return undefined;
      };
    },
  });
}

export async function openStudentHistory(student) {
  let range = 'all';
  const renderList = async (m) => {
    const bounds = rangeBounds(range);
    const data = await api.get('/class/logs', { studentId: student.id, from: bounds.from, to: bounds.to, pageSize: 100 });
    const box = m.querySelector('#stuHisList');
    if (!data.items.length) {
      box.innerHTML = '<div class="empty">该时段还没有积分记录</div>';
      return;
    }
    box.innerHTML = data.items
      .map(
        (l) => `<div class="sheet-item">
          <span class="delta-${l.delta > 0 ? 'pos' : 'neg'}">${l.delta > 0 ? '+' : ''}${l.delta}</span>
          <span class="grow">${escapeHtml(l.reason || '（无备注）')}
            <span class="tiny muted">${escapeHtml(l.operatorName || '')}</span>
          </span>
          <span class="tiny muted nowrap">${fmtDateTime(l.createdAt)}</span>
          ${can('history:delete') ? `<button class="btn btn-sm btn-ghost" data-del="${l.id}">删除</button>` : ''}
        </div>`
      )
      .join('');
  };
  openModal({
    title: `${student.name} 的积分记录`,
    body: `
      <div class="pill-group" id="stuHisRange">
        <button class="pill active" data-range="all">全部</button>
        <button class="pill" data-range="week">本周</button>
        <button class="pill" data-range="month">本月</button>
      </div>
      <div id="stuHisList" style="margin-top:12px;max-height:50vh;overflow:auto"></div>`,
    footer: `${can('history:delete') ? '<button class="btn btn-danger" id="stuHisClear">清空该生历史</button>' : ''}<button class="btn btn-ghost" data-close>关闭</button>`,
    onMount(m) {
      renderList(m);
      m.querySelector('#stuHisRange').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-range]');
        if (!btn) return;
        range = btn.dataset.range;
        $$('#stuHisRange .pill', m).forEach((b) => b.classList.toggle('active', b === btn));
        renderList(m);
      });
      m.querySelector('#stuHisList').addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-del]');
        if (!btn) return;
        const ok = await confirmDialog({ title: '删除积分记录', message: '删除后自动反向修正该生当前积分。', okText: '删除', danger: true });
        if (!ok) return;
        try {
          await api.del(`/class/logs/${btn.dataset.del}`);
          toast('已删除', 'ok');
          renderList(m);
          loadStudents();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
      const clearBtn = m.querySelector('#stuHisClear');
      if (clearBtn) {
        clearBtn.onclick = async () => {
          const ok = await confirmDialog({ title: '清空该生历史', message: `确定清空 ${student.name} 的全部积分记录吗？当前积分不受影响。`, okText: '清空', danger: true });
          if (!ok) return;
          try {
            await api.del(`/class/students/${student.id}/logs`);
            toast('已清空', 'ok');
            renderList(m);
          } catch (err) {
            toast(err.message, 'err');
          }
        };
      }
    },
  });
}

/* ================= 小组榜 ================= */
export async function loadGroups() {
  const g = state.groups;
  const timeMode = g.sort === 'time';
  const bounds = timeMode ? rangeBounds(g.range || 'week') : { from: 0, to: 0 };
  const items = await api.get('/class/groups', { sort: timeMode ? 'desc' : g.sort, from: bounds.from, to: bounds.to });
  g.items = items;
  const box = $('#groupList');
  if (!items.length) {
    box.innerHTML = '<div class="empty">还没有小组数据，先给学生设置小组吧</div>';
    return;
  }
  const max = Math.max(...items.map((i) => i.total), 1);
  box.innerHTML = items
    .map((item, i) => {
      const rank = i + 1;
      const cls = rank <= 3 ? `rank-${rank}` : '';
      return `<div class="group-row">
        <div><div class="rank-badge ${cls}">${rank}</div></div>
        <div>
          <div class="stu-name">${escapeHtml(item.name)}</div>
          <div class="progress"><i style="width:${Math.round((item.total / max) * 100)}%"></i></div>
        </div>
        <div class="center tiny muted num">${item.count}</div>
        <div class="right"><span class="points-pill">${item.total}</span></div>
        <div class="center tiny muted num">${item.avg}</div>
      </div>`;
    })
    .join('');
}

/* ================= 积分记录 ================= */
export async function loadHistory() {
  const h = state.history;
  const bounds = rangeBounds(h.range, h.from, h.to);
  const data = await api.get('/class/logs', { search: h.search, from: bounds.from, to: bounds.to, page: h.page, pageSize: h.pageSize });
  h.items = data.items;
  h.total = data.total;
  const box = $('#historyList');
  if (!data.items.length) {
    box.innerHTML = '<div class="empty">该时段还没有积分记录</div>';
  } else {
    box.innerHTML = data.items
      .map(
        (l) => `<div class="sheet-item">
          <span class="delta-${l.delta > 0 ? 'pos' : 'neg'}">${l.delta > 0 ? '+' : ''}${l.delta}</span>
          <span class="grow">
            <b>${escapeHtml(l.studentName)}</b>
            <span class="tiny muted">${escapeHtml(l.reason || '')}</span>
            <span class="tiny muted">· ${escapeHtml(l.operatorName || '')}</span>
            ${l.kind === 'redeem' ? '<span class="badge badge-amber">兑换</span>' : ''}
          </span>
          <span class="tiny muted nowrap">${fmtDateTime(l.createdAt)}</span>
          ${can('history:delete') ? `<button class="btn btn-sm btn-ghost" data-del="${l.id}">删除</button>` : ''}
        </div>`
      )
      .join('');
  }
  renderPager($('#historyPager'), {
    page: h.page,
    pageSize: h.pageSize,
    total: h.total,
    onChange: (p) => {
      h.page = p;
      loadHistory();
    },
  });
}

/* ================= 导出 ================= */
export function openExportModal() {
  let range = 'term';
  openModal({
    title: '导出积分榜单',
    body: `
      <div class="pill-group" id="exportRange">
        <button class="pill active" data-range="term">本期</button>
        <button class="pill" data-range="week">本周</button>
        <button class="pill" data-range="month">本月</button>
        <button class="pill" data-range="custom">自定义</button>
      </div>
      <div class="row hidden" id="exportCustom" style="margin-top:12px">
        <input type="date" class="input" id="exportFrom" />
        <input type="date" class="input" id="exportTo" />
      </div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="exportConfirm">确认导出</button>',
    onMount(m) {
      m.querySelector('#exportRange').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-range]');
        if (!btn) return;
        range = btn.dataset.range;
        $$('#exportRange .pill', m).forEach((b) => b.classList.toggle('active', b === btn));
        m.querySelector('#exportCustom').classList.toggle('hidden', range !== 'custom');
      });
      m.querySelector('#exportConfirm').onclick = async () => {
        let from = 0;
        let to = 0;
        if (range === 'custom') {
          const f = m.querySelector('#exportFrom').value;
          const t = m.querySelector('#exportTo').value;
          if (!f || !t) return toast('请选择起止日期', 'err');
          from = new Date(`${f}T00:00:00`).getTime();
          to = new Date(`${t}T23:59:59`).getTime();
        } else {
          const bounds = rangeBounds(range);
          from = bounds.from;
          to = bounds.to;
        }
        await api.download('/class/ranking/export.csv', { from, to });
        closeModal();
        toast('已开始下载', 'ok');
        return undefined;
      };
    },
  });
}

/* ================= 绑定 ================= */
export async function mountClassApp({ logout }) {
  onLogout = logout;
  await refreshOverview();
  applyPermissions();
  await Promise.all([loadStudents(), loadGroups()]);

  $$('[data-toggle]').forEach((head) => {
    const toggle = () => {
      const el = document.getElementById(head.dataset.toggle);
      if (el) {
        const open = el.classList.toggle('open');
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    };
    head.onclick = toggle;
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });

  $('#viewTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.view-tab');
    if (btn) switchView(btn.dataset.view);
  });

  $('#statStudentsCard').onclick = () => switchView('students');
  $('#statRecordsCard').onclick = () => switchView('history');
  const statTodayCard = $('#statTodayCard');
  if (statTodayCard) statTodayCard.onclick = () => switchView('history');
  const statGroupsCard = $('#statGroupsCard');
  if (statGroupsCard) statGroupsCard.onclick = () => switchView('groups');
  $('#btnRefresh').onclick = async () => {
    toast('正在刷新…');
    await Promise.all([refreshOverview(), loadStudents(), loadGroups()]);
    toast('数据已刷新', 'ok');
  };
  $('#btnExport').onclick = openExportModal;

  const addStudent = async () => {
    const name = $('#inputName').value.trim();
    if (!name) return toast('请输入学生姓名', 'err');
    const payload = { name };
    ['Group#groupName', 'Sex#sex', 'Position#position'].forEach((rule) => {
      const [suffix, key] = rule.split('#');
      payload[key] = $(`#input${suffix}`).value.trim();
    });
    PROFILE_FIELDS.forEach(([, inputId, key]) => {
      payload[key] = $(`#${inputId}`).value.trim();
    });
    try {
      await api.post('/class/students', payload);
      ['#inputName', '#inputPosition', '#inputStudentNo', '#inputBirthday', '#inputGuardianName', '#inputGuardianPhone', '#inputGuardianAltPhone', '#inputAddress', '#inputNote'].forEach(
        (sel) => {
          $(sel).value = '';
        }
      );
      toast(`已添加 ${name}`, 'ok');
      await Promise.all([loadStudents(), refreshOverview(), loadGroups()]);
    } catch (err) {
      toast(err.message, 'err');
    }
    return undefined;
  };
  $('#btnAdd').onclick = addStudent;
  $('#inputName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addStudent();
  });

  $('#btnImportExcel').onclick = async () => {
    const file = $('#excelFile').files[0];
    if (!file) return toast('请先选择 Excel 文件', 'err');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.upload('/class/students/import', form);
      $('#importResult').textContent = `共 ${res.total} 行，导入 ${res.added} 人，重复 ${res.duplicates} 人，无效 ${res.invalid} 行`;
      toast(`成功导入 ${res.added} 名学生`, 'ok');
      await Promise.all([loadStudents(), refreshOverview(), loadGroups()]);
    } catch (err) {
      toast(err.message, 'err');
    }
    return undefined;
  };
  $('#btnDownloadTpl').onclick = () => api.download('/class/students/template');
  $('#btnExportStudents').onclick = () => {
    api.download('/class/students/export.xlsx');
    toast('正在导出学生档案…', 'ok');
  };

  $('#studentList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('[data-id]');
    const student = state.students.items.find((s) => s.id === row.dataset.id);
    if (!student) return;
    const act = btn.dataset.act;
    if (act === 'add') openPointsModal(student, 'add');
    else if (act === 'sub') openPointsModal(student, 'sub');
    else if (act === 'history') openStudentHistory(student);
    else if (act === 'edit') openEditModal(student);
    else if (act === 'delete') {
      const ok = await confirmDialog({
        title: '删除学生',
        message: `确定删除「${student.name}」吗？其积分记录会保留在积分记录里。`,
        okText: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/class/students/${student.id}`);
        toast('已删除', 'ok');
        await Promise.all([loadStudents(), refreshOverview(), loadGroups()]);
      } catch (err) {
        toast(err.message, 'err');
      }
    }
  });

  $('#sortTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    state.students.sort = btn.dataset.sort;
    state.students.page = 1;
    $$('#sortTabs .pill').forEach((b) => b.classList.toggle('active', b === btn));
    $('#rangeBar').classList.toggle('hidden', state.students.sort !== 'time');
    loadStudents();
  });
  $('#rangeTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    state.students.range = btn.dataset.range;
    state.students.page = 1;
    $$('#rangeTabs .pill').forEach((b) => b.classList.toggle('active', b === btn));
    loadStudents();
  });
  $('#searchBox').addEventListener(
    'input',
    debounce((e) => {
      state.students.search = e.target.value.trim();
      state.students.page = 1;
      loadStudents();
    })
  );
  $('#btnBatch').onclick = openBatchModal;

  $('#groupSortTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    state.groups.sort = btn.dataset.sort;
    $$('#groupSortTabs .pill').forEach((b) => b.classList.toggle('active', b === btn));
    $('#groupSortHint').textContent = state.groups.sort === 'time' ? '近 7 天积分' : '按总积分排序';
    loadGroups();
  });

  $('#historyRangeTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    state.history.range = btn.dataset.range;
    state.history.page = 1;
    $$('#historyRangeTabs .pill').forEach((b) => b.classList.toggle('active', b === btn));
    $('#historyCustom').classList.toggle('hidden', state.history.range !== 'custom');
    if (state.history.range === 'custom') {
      $('#rangeFrom').value = $('#rangeFrom').value || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      $('#rangeTo').value = $('#rangeTo').value || new Date().toISOString().slice(0, 10);
      state.history.from = new Date(`${$('#rangeFrom').value}T00:00:00`).getTime();
      state.history.to = new Date(`${$('#rangeTo').value}T23:59:59`).getTime();
    }
    loadHistory();
  });
  ['#rangeFrom', '#rangeTo'].forEach((sel) => {
    $(sel).addEventListener('change', () => {
      state.history.from = $('#rangeFrom').value ? new Date(`${$('#rangeFrom').value}T00:00:00`).getTime() : 0;
      state.history.to = $('#rangeTo').value ? new Date(`${$('#rangeTo').value}T23:59:59`).getTime() : 0;
      state.history.page = 1;
      loadHistory();
    });
  });
  $('#historySearchInput').addEventListener(
    'input',
    debounce((e) => {
      state.history.search = e.target.value.trim();
      state.history.page = 1;
      loadHistory();
    })
  );
  $('#historyExportBtn').onclick = () => {
    const bounds = rangeBounds(state.history.range, state.history.from, state.history.to);
    api.download('/class/logs/export.csv', { from: bounds.from, to: bounds.to, search: state.history.search });
  };
  $('#historyList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const ok = await confirmDialog({ title: '删除记录', message: '删除该条积分记录并反向修正学生积分？', okText: '删除', danger: true });
    if (!ok) return;
    try {
      await api.del(`/class/logs/${btn.dataset.del}`);
      toast('已删除', 'ok');
      await Promise.all([loadHistory(), loadStudents()]);
    } catch (err) {
      toast(err.message, 'err');
    }
  });
  $('#btnClearHistory').onclick = async () => {
    if (!can('history:clear')) return toast('当前角色无权限', 'err');
    const ok = await confirmDialog({ title: '清空积分记录', message: '将删除全部积分记录（学生当前积分不受影响）。确定继续？', okText: '清空', danger: true });
    if (!ok) return;
    try {
      await api.del('/class/logs');
      toast('已清空积分记录', 'ok');
      await Promise.all([loadHistory(), refreshOverview()]);
    } catch (err) {
      toast(err.message, 'err');
    }
  };
  $('#btnClearHistory').classList.toggle('hidden', !can('history:clear'));
}

export function switchView(view) {
  state.view = view;
  const map = {
    students: '#viewStudents',
    groups: '#viewGroups',
    seat: '#viewSeat',
    mall: '#viewMall',
    history: '#viewHistory',
    scores: '#viewScores',
    members: '#viewMembers',
  };
  Object.entries(map).forEach(([key, sel]) => {
    const el = $(sel);
    if (el) el.classList.toggle('hidden', key !== view);
  });
  // 保证任一视图都有 active 页签（members 无独立页签时回退到「成绩」）
  const TAB_OF = {
    students: 'students', groups: 'groups', seat: 'seat',
    mall: 'mall', history: 'history', scores: 'scores', members: 'members',
  };
  const activeTab = TAB_OF[view] || 'students';
  $$('.view-tab').forEach((b) => {
    const isActive = b.dataset.view === activeTab;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (view === 'history') loadHistory();
  if (view === 'groups') loadGroups();
  if (view === 'seat') import('./class-seat.js').then((m) => m.renderSeat());
  if (view === 'mall') import('./class-mall.js').then((m) => m.renderMall());
  if (view === 'scores') import('./class-scores.js').then((m) => m.renderScores());
  if (view === 'members') import('./members.js').then((m) => m.renderMembers());
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
