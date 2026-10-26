/** 积分商城：礼物管理、批量兑换、兑换记录 */
import { api } from './api.js';
import { $, $$, escapeHtml, toast, openModal, closeModal, confirmDialog, fmtDateTime, renderPager } from './ui.js';
import { state, can } from './store.js';

export async function renderMall() {
  state.gifts = await api.get('/class/gifts');
  $('#giftCount').textContent = state.gifts.length;
  $('#giftEmpty').classList.toggle('hidden', state.gifts.length > 0);
  $('#giftAddCollapse').classList.toggle('hidden', !can('gift:write'));
  const grid = $('#giftGrid');
  grid.innerHTML = state.gifts
    .map(
      (g) => `<div class="gift-card">
        <div class="gift-icon">${escapeHtml((g.name || '礼').slice(0, 1))}</div>
        <div class="gift-name">${escapeHtml(g.name)}</div>
        <div class="gift-cost">${g.cost} 积分${g.stock === null || g.stock === undefined ? '' : ` · 剩 ${g.stock}`}</div>
        <div class="row" style="margin-top:4px">
          ${can('gift:redeem') ? `<button class="btn btn-sm btn-primary grow" data-redeem="${g.id}">兑换</button>` : ''}
          ${can('gift:write') ? `<button class="btn btn-sm btn-ghost" data-del="${g.id}">删除</button>` : ''}
        </div>
      </div>`
    )
    .join('');
}

async function addGift() {
  const name = $('#giftName').value.trim();
  const cost = Number($('#giftCost').value);
  if (!name) return toast('请输入礼物名称', 'err');
  if (!cost || cost < 1) return toast('请输入所需积分', 'err');
  try {
    await api.post('/class/gifts', { name, cost });
    $('#giftName').value = '';
    $('#giftCost').value = '';
    toast('礼物已添加', 'ok');
    await renderMall();
  } catch (err) {
    toast(err.message, 'err');
  }
  return undefined;
}

async function openRedeem(gift) {
  let students = [];
  try {
    students = (await api.get('/class/students', { pageSize: 200 })).items;
  } catch (err) {
    return toast(err.message, 'err');
  }
  if (!students.length) return toast('还没有学生，无法兑换', 'err');
  const groups = [...new Set(students.map((s) => s.groupName || '未分组'))];
  const selected = new Set();
  let mode = 'student';
  return openModal({
    title: `兑换：${gift.name}`,
    body: `
      <div class="between" style="margin-bottom:12px">
        <div class="tiny muted">每份消耗 <b class="num">${gift.cost}</b> 积分</div>
        <div class="pill-group" id="redeemMode">
          <button class="pill active" data-mode="student">指定学生</button>
          <button class="pill" data-mode="group">指定小组</button>
        </div>
      </div>
      <div id="redeemPick" style="max-height:230px;overflow:auto"></div>
      <div class="row wrap" style="margin-top:8px">
        <button class="btn btn-sm btn-ghost" id="redeemAll">全选</button>
        <button class="btn btn-sm btn-ghost" id="redeemNone">全不选</button>
        <div class="tiny muted grow" id="redeemCount" style="text-align:right">已选 0 人</div>
      </div>
      <div class="tiny muted" id="redeemPreview" style="margin-top:8px"></div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="redeemConfirm">确认兑换</button>',
    onMount(m) {
      const pickedStudents = () => {
        if (mode === 'student') return students.filter((s) => selected.has(s.id));
        const picked = new Set([...selected].map((k) => k.slice(2)));
        return students.filter((s) => picked.has(s.groupName || '未分组'));
      };
      const updatePreview = () => {
        const list = pickedStudents();
        const notEnough = list.filter((s) => s.points < gift.cost);
        m.querySelector('#redeemCount').textContent = `已选 ${list.length} 人`;
        m.querySelector('#redeemPreview').innerHTML = list.length
          ? `共消耗 <b class="num">${list.length * gift.cost}</b> 积分${notEnough.length ? `<span class="delta-neg"> · ${notEnough.map((s) => escapeHtml(s.name)).join('、')} 积分不足</span>` : ''}`
          : '请选择要兑换的学生';
      };
      const renderPick = () => {
        const box = m.querySelector('#redeemPick');
        if (mode === 'student') {
          box.innerHTML = students
            .map(
              (s) => `<label class="sheet-item" style="cursor:pointer">
                <input type="checkbox" data-id="${s.id}" ${selected.has(s.id) ? 'checked' : ''} />
                <span class="grow stu-name">${escapeHtml(s.name)}</span>
                <span class="tiny ${s.points < gift.cost ? 'delta-neg' : 'muted'} num">${s.points} 分</span>
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
        updatePreview();
      };
      renderPick();
      m.querySelector('#redeemMode').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mode]');
        if (!btn) return;
        mode = btn.dataset.mode;
        $$('#redeemMode .pill', m).forEach((b) => b.classList.toggle('active', b === btn));
        selected.clear();
        renderPick();
      });
      m.querySelector('#redeemPick').addEventListener('change', (e) => {
        const box = e.target;
        if (box.dataset.id) {
          if (box.checked) selected.add(box.dataset.id);
          else selected.delete(box.dataset.id);
        } else if (box.dataset.group) {
          const key = `g:${box.dataset.group}`;
          if (box.checked) selected.add(key);
          else selected.delete(key);
        }
        updatePreview();
      });
      m.querySelector('#redeemAll').onclick = () => {
        if (mode === 'student') students.forEach((s) => selected.add(s.id));
        else groups.forEach((g) => selected.add(`g:${g}`));
        renderPick();
        $$('#redeemPick input', m).forEach((el) => {
          el.checked = true;
        });
      };
      m.querySelector('#redeemNone').onclick = () => {
        selected.clear();
        renderPick();
      };
      m.querySelector('#redeemConfirm').onclick = async () => {
        const list = pickedStudents();
        if (!list.length) return toast('请选择兑换的学生', 'err');
        const notEnough = list.filter((s) => s.points < gift.cost);
        if (notEnough.length) return toast(`积分不足：${notEnough.map((s) => s.name).join('、')}`, 'err');
        try {
          await api.post(`/class/gifts/${gift.id}/redeem`, { studentIds: list.map((s) => s.id) });
          closeModal();
          toast(`已兑换 ${list.length} 份`, 'ok');
          await renderMall();
        } catch (err) {
          toast(err.message, 'err');
        }
        return undefined;
      };
    },
  });
}

async function openGiftHistory() {
  let page = 1;
  const pageSize = 20;
  openModal({
    title: '积分兑换记录',
    body: '<div id="ghList"></div><div class="pagination" id="ghPager"></div>',
    footer: '<button class="btn btn-ghost" id="ghExport">导出 CSV</button><button class="btn btn-primary" data-close>关闭</button>',
    onMount(m) {
      const load = async () => {
        const data = await api.get('/class/redemptions', { page, pageSize });
        const box = m.querySelector('#ghList');
        box.innerHTML = data.items.length
          ? data.items
              .map(
                (r) => `<div class="sheet-item">
                  <span class="badge badge-amber num">-${r.cost}</span>
                  <span class="grow"><b>${escapeHtml(r.studentName)}</b> 兑换 ${escapeHtml(r.giftName)}</span>
                  <span class="tiny muted nowrap">${fmtDateTime(r.createdAt)}</span>
                </div>`
              )
              .join('')
          : '<div class="empty">还没有兑换记录</div>';
        renderPager(m.querySelector('#ghPager'), { page, pageSize, total: data.total, onChange: (p) => { page = p; load(); } });
      };
      load();
      m.querySelector('#ghExport').onclick = () => api.download('/class/redemptions/export.csv');
    },
  });
}

export function mountMall() {
  $('#btnAddGift').onclick = addGift;
  $('#giftName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addGift();
  });
  $('#btnGiftHistory').onclick = openGiftHistory;
  $('#giftGrid').addEventListener('click', async (e) => {
    const redeemBtn = e.target.closest('[data-redeem]');
    if (redeemBtn) {
      const gift = state.gifts.find((g) => g.id === redeemBtn.dataset.redeem);
      if (gift) openRedeem(gift);
      return;
    }
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      const gift = state.gifts.find((g) => g.id === delBtn.dataset.del);
      const ok = await confirmDialog({ title: '删除礼物', message: `确定下架「${gift ? gift.name : ''}」吗？`, okText: '删除', danger: true });
      if (!ok) return;
      try {
        await api.del(`/class/gifts/${delBtn.dataset.del}`);
        toast('已删除', 'ok');
        await renderMall();
      } catch (err) {
        toast(err.message, 'err');
      }
    }
  });
}
