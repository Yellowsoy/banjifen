/** 成员管理：班主任维护本班老师与班干部账号 */
import { api } from './api.js';
import { $, escapeHtml, toast, openModal, closeModal, confirmDialog, fmtDateTime } from './ui.js';
import { state, myClass } from './store.js';

const ROLE_TIP = {
  owner: '班主任：本班最高权限，可管理成员与危险操作',
  teacher: '老师：日常加减分、批量、排座、成绩、兑换',
  cadre: '班干部：仅单人加减分（受额度限制）与查看',
};

export async function renderMembers() {
  const members = await api.get('/members');
  state.members = members;
  const box = $('#memberList');
  if (!members.length) {
    box.innerHTML = '<div class="empty">还没有成员</div>';
    return;
  }
  box.innerHTML = members
    .map(
      (m) => `<div class="member-item" data-id="${m.id}">
        <div class="member-line">
          <span class="badge ${m.role === 'owner' ? '' : m.role === 'teacher' ? 'badge-green' : 'badge-amber'}">${escapeHtml(m.roleLabel)}</span>
          <span class="name">${escapeHtml(m.name)}</span>
          ${m.status === 'disabled' ? '<span class="badge badge-rose">已停用</span>' : ''}
        </div>
        <div class="member-meta">${escapeHtml(m.username)} · ${escapeHtml(m.phoneMasked || '未填手机号')} · ${m.lastLoginAt ? fmtDateTime(m.lastLoginAt) : '未登录'}</div>
        <div class="member-ops">
          <button class="btn btn-sm btn-ghost" data-act="edit">编辑</button>
          ${m.role !== 'owner' ? '<button class="btn btn-sm btn-ghost" data-act="transfer">设为班主任</button><button class="btn btn-sm btn-ghost" data-act="remove">移除</button>' : ''}
        </div>
      </div>`
    )
    .join('');

  box.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id;
    const member = members.find((m) => m.id === id);
    if (!member) return;
    if (btn.dataset.act === 'edit') return openMemberModal(member);
    if (btn.dataset.act === 'transfer') {
      const ok = await confirmDialog({
        title: '转移班主任',
        message: `将班主任身份转移给「${member.name}」？你将被降为老师，此操作不可撤销。`,
        okText: '确认转移',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.post('/members/transfer-owner', { memberId: id });
        toast('班主任已转移，请重新登录', 'ok');
        setTimeout(() => window.location.reload(), 900);
      } catch (err) {
        toast(err.message, 'err');
      }
      return undefined;
    }
    if (btn.dataset.act === 'remove') {
      const ok = await confirmDialog({
        title: '移除成员',
        message: `移除后「${member.name}」将无法登录，确定继续？`,
        okText: '移除',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/members/${id}`);
        toast('已移除', 'ok');
        renderMembers();
      } catch (err) {
        toast(err.message, 'err');
      }
    }
    return undefined;
  };
}

function openMemberModal(member) {
  const editing = !!member;
  openModal({
    title: editing ? `编辑成员 · ${member.name}` : '添加成员',
    body: `
      <div class="col">
        ${
          editing
            ? ''
            : `<div class="field"><label>角色</label>
                <select class="select" id="mRole">
                  <option value="teacher">老师</option>
                  <option value="cadre">班干部</option>
                </select>
                <div class="tiny muted" id="mRoleTip">${ROLE_TIP.teacher}</div>
              </div>`
        }
        <div class="field"><label>姓名</label><input class="input" id="mName" value="${editing ? escapeHtml(member.name) : ''}" maxlength="20" /></div>
        <div class="field"><label>手机号（选填）</label><input class="input num" id="mPhone" value="${editing ? escapeHtml(member.phone || '') : ''}" maxlength="20" placeholder="用于联系，超管可见完整号码" /></div>
        ${editing ? '' : '<div class="field"><label>登录账号</label><input class="input" id="mUser" maxlength="32" placeholder="至少 3 位，全局唯一" /></div>'}
        <div class="field"><label>${editing ? '重置密码（留空不改）' : '初始密码'}</label><input class="input" type="password" id="mPwd" placeholder="至少 6 位" /></div>
        ${
          editing
            ? `<div class="field"><label>状态</label>
                <select class="select" id="mStatus">
                  <option value="active" ${member.status === 'active' ? 'selected' : ''}>正常</option>
                  <option value="disabled" ${member.status === 'disabled' ? 'selected' : ''}>停用</option>
                </select>
              </div>`
            : ''
        }
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="mSave">${editing ? '保存' : '创建账号'}</button>`,
    onMount(m) {
      const roleSelect = m.querySelector('#mRole');
      if (roleSelect) {
        roleSelect.onchange = () => {
          m.querySelector('#mRoleTip').textContent = ROLE_TIP[roleSelect.value];
        };
      }
      m.querySelector('#mSave').onclick = async () => {
        const name = m.querySelector('#mName').value.trim();
        const phone = m.querySelector('#mPhone').value.trim();
        const pwd = m.querySelector('#mPwd').value;
        if (!name) return toast('请输入姓名', 'err');
        try {
          if (editing) {
            const payload = { name, phone, status: m.querySelector('#mStatus').value };
            if (pwd) payload.password = pwd;
            await api.patch(`/members/${member.id}`, payload);
            toast('已保存', 'ok');
          } else {
            const username = m.querySelector('#mUser').value.trim();
            if (username.length < 3) return toast('登录账号至少 3 位', 'err');
            if (pwd.length < 6) return toast('初始密码至少 6 位', 'err');
            await api.post('/members', { role: roleSelect.value, name, phone, username, password: pwd });
            toast('成员已创建', 'ok');
          }
          closeModal();
          renderMembers();
        } catch (err) {
          toast(err.message, 'err');
        }
        return undefined;
      };
    },
  });
}

function openLimits() {
  const cls = myClass();
  openModal({
    title: '班干部加减分额度',
    body: `<div class="row">
      <div class="field grow"><label>单次上限</label><input class="input num" id="limitPer" type="number" min="1" max="100" value="${cls.cadreLimitPer || 5}" /></div>
      <div class="field grow"><label>每日上限</label><input class="input num" id="limitDay" type="number" min="1" max="1000" value="${cls.cadreLimitDay || 20}" /></div>
    </div>
    <div class="tiny muted" style="margin-top:8px">额度同时作用于加分与减分，按绝对值累计。</div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="limitSave">保存</button>',
    onMount(m) {
      m.querySelector('#limitSave').onclick = async () => {
        try {
          const res = await api.patch('/members/settings/limits', {
            cadreLimitPer: Number(m.querySelector('#limitPer').value),
            cadreLimitDay: Number(m.querySelector('#limitDay').value),
          });
          if (state.me && state.me.class) {
            state.me.class.cadreLimitPer = res.cadreLimitPer;
            state.me.class.cadreLimitDay = res.cadreLimitDay;
          }
          closeModal();
          toast('额度已保存', 'ok');
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    },
  });
}

export function mountMembers() {
  $('#btnAddMember').onclick = () => openMemberModal(null);
  $('#btnMemberLimits').onclick = openLimits;
}
