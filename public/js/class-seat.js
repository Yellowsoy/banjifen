/** 积分排座：按积分自动排座、手动调整、整组对调、打印与导出 */
import { api } from './api.js';
import { $, escapeHtml, toast, openModal, closeModal, confirmDialog } from './ui.js';
import { state, can } from './store.js';

function seatLabel(index, cols, angle) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  if (angle === 'student') return `${row + 1}排${cols - col}座`;
  return `${row + 1}排${col + 1}座`;
}

function studentsById() {
  const map = new Map();
  (state.seat && state.seat.students ? state.seat.students : []).forEach((s) => map.set(s.id, s));
  return map;
}

export async function renderSeat() {
  state.seat = await api.get('/class/seat');
  const plan = state.seat;
  $('#seatLayoutLabel').textContent = `${plan.cols}×${plan.rows}`;
  $('#seatAngleLabel').textContent = plan.angle === 'student' ? '学生视角' : '老师视角';
  const editable = can('seat:write');
  ['#seatLayoutBtn', '#seatSchemeBtn', '#seatSwapBtn', '#seatConfirmBtn', '#seatClearBtn'].forEach((sel) => {
    const el = $(sel);
    if (el) el.classList.toggle('hidden', !editable);
  });
  const grid = $('#seatGrid');
  grid.style.gridTemplateColumns = `repeat(${plan.cols}, minmax(0, 1fr))`;
  const byId = studentsById();
  const order = [...plan.seats.keys()];
  if (plan.angle === 'student') order.reverse();
  grid.innerHTML = order
    .map((index) => {
      const id = plan.seats[index];
      const student = id ? byId.get(id) : null;
      return `<div class="seat ${student ? 'filled' : 'empty'}" data-index="${index}" title="${seatLabel(index, plan.cols, plan.angle)}">
        ${student ? `<div class="seat-name">${escapeHtml(student.name)}</div><div class="seat-points">${student.points} 分</div>` : ''}
      </div>`;
    })
    .join('');
  $('#seatUnseatCount').textContent = plan.unseated.length;
  $('#seatUnseated').innerHTML = plan.unseated.length
    ? plan.unseated.map((s) => `<span class="seat-chip">${escapeHtml(s.name)}</span>`).join('')
    : '<span class="tiny muted">全部学生都已入座</span>';
  grid.onclick = editable
    ? (e) => {
        const seat = e.target.closest('[data-index]');
        if (seat) openSeatPicker(Number(seat.dataset.index));
      }
    : null;
}

async function savePlan(patch, { confirm = false, silent = false } = {}) {
  const plan = state.seat;
  await api.put('/class/seat', {
    cols: plan.cols,
    rows: plan.rows,
    scheme: patch.scheme || plan.scheme || 'points',
    seats: plan.seats,
    angle: plan.angle,
    confirm,
    ...patch,
  });
  await renderSeat();
  if (!silent) toast(confirm ? '排座已确认' : '已保存', 'ok');
}

function openSeatPicker(index) {
  const plan = state.seat;
  const byId = studentsById();
  const current = plan.seats[index] ? byId.get(plan.seats[index]) : null;
  const options = plan.students
    .map((s) => `<option value="${s.id}" ${current && current.id === s.id ? 'selected' : ''}>${escapeHtml(s.name)}（${s.points} 分）</option>`)
    .join('');
  openModal({
    title: `调整座位 · ${seatLabel(index, plan.cols, plan.angle)}`,
    body: `
      <div class="field"><label>选择学生</label>
        <select class="select" id="seatPick"><option value="">（空位）</option>${options}</select>
      </div>
      <div class="tiny muted" style="margin-top:8px">若该学生已坐在别处，会自动与当前座位交换。</div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="seatPickSave">保存</button>',
    onMount(m) {
      m.querySelector('#seatPickSave').onclick = async () => {
        const value = m.querySelector('#seatPick').value;
        const seats = [...plan.seats];
        const existing = value ? seats.indexOf(value) : -1;
        if (existing >= 0) seats[existing] = seats[index] || null;
        seats[index] = value || null;
        closeModal();
        state.seat.seats = seats;
        await savePlan({ seats });
      };
    },
  });
}

function openLayoutModal() {
  const plan = state.seat;
  openModal({
    title: '排座布局',
    body: `<div class="row">
      <div class="field grow"><label>列数</label><input class="input num" type="number" id="seatCols" value="${plan.cols}" min="1" max="20" /></div>
      <div class="field grow"><label>行数</label><input class="input num" type="number" id="seatRows" value="${plan.rows}" min="1" max="20" /></div>
    </div>
    <div class="tiny muted" style="margin-top:8px">修改布局后座位按序号重排，超出的学生回到「未入座」。</div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="seatLayoutSave">确认</button>',
    onMount(m) {
      m.querySelector('#seatLayoutSave').onclick = async () => {
        const cols = Math.max(1, Math.min(20, Number(m.querySelector('#seatCols').value) || plan.cols));
        const rows = Math.max(1, Math.min(20, Number(m.querySelector('#seatRows').value) || plan.rows));
        const seats = new Array(cols * rows).fill(null);
        plan.seats.forEach((id, i) => {
          if (id && i < seats.length) seats[i] = id;
        });
        closeModal();
        state.seat.seats = seats;
        await savePlan({ cols, rows, seats });
      };
    },
  });
}

function openSchemeModal() {
  openModal({
    title: '自动排座方案',
    body: `<div class="col">
      <button class="btn btn-ghost btn-block" data-scheme="points">按积分高低（高分坐前排）</button>
      <button class="btn btn-ghost btn-block" data-scheme="snake">蛇形分布（均衡搭配）</button>
      <button class="btn btn-ghost btn-block" data-scheme="random">随机排座</button>
    </div>
    <div class="tiny muted" style="margin-top:8px">将覆盖当前座位，未安排的学生会出现在「未入座」里。</div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button>',
    onMount(m) {
      m.querySelectorAll('[data-scheme]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            const plan = await api.post('/class/seat/auto', { cols: state.seat.cols, rows: state.seat.rows, scheme: btn.dataset.scheme });
            state.seat.seats = plan.seats;
            closeModal();
            await savePlan({ seats: plan.seats, scheme: btn.dataset.scheme });
          } catch (err) {
            toast(err.message, 'err');
          }
        };
      });
    },
  });
}

function openSwapModal() {
  const groups = [...new Set((state.seat.students || []).map((s) => s.groupName || '未分组'))];
  const options = groups.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  openModal({
    title: '整组对调',
    body: `<div class="col">
      <div class="field"><label>小组 A</label><select class="select" id="swapA">${options}</select></div>
      <div class="field"><label>小组 B</label><select class="select" id="swapB">${options}</select></div>
    </div>
    <div class="tiny muted" style="margin-top:8px">两个小组的学生在各自已有座位之间互换。</div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="swapApply">确认对调</button>',
    onMount(m) {
      if (options.length < 2) m.querySelector('#swapApply').disabled = true;
      m.querySelector('#swapApply').onclick = async () => {
        const a = m.querySelector('#swapA').value;
        const b = m.querySelector('#swapB').value;
        if (a === b) return toast('请选择两个不同的小组', 'err');
        const byId = studentsById();
        const groupOf = (id) => (byId.get(id) ? byId.get(id).groupName || '未分组' : '');
        const seats = [...state.seat.seats];
        const indexA = [];
        const indexB = [];
        seats.forEach((id, i) => {
          if (!id) return;
          if (groupOf(id) === a) indexA.push(i);
          if (groupOf(id) === b) indexB.push(i);
        });
        const count = Math.min(indexA.length, indexB.length);
        for (let i = 0; i < count; i += 1) {
          const tmp = seats[indexA[i]];
          seats[indexA[i]] = seats[indexB[i]];
          seats[indexB[i]] = tmp;
        }
        closeModal();
        state.seat.seats = seats;
        await savePlan({ seats });
        return undefined;
      };
    },
  });
}

async function exportSeatCsv() {
  const plan = state.seat;
  const byId = studentsById();
  const rows = [];
  for (let r = 0; r < plan.rows; r += 1) {
    const line = [];
    for (let c = 0; c < plan.cols; c += 1) {
      const id = plan.seats[r * plan.cols + c];
      const student = id ? byId.get(id) : null;
      line.push(student ? student.name : '');
    }
    rows.push(line);
  }
  const csv = '\uFEFF' + rows.map((r) => r.join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '座位表.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('已导出座位表', 'ok');
}

export function mountSeat() {
  $('#seatLayoutBtn').onclick = openLayoutModal;
  $('#seatAngleBtn').onclick = async () => {
    const next = state.seat.angle === 'student' ? 'teacher' : 'student';
    state.seat.angle = next;
    await savePlan({ angle: next }, { silent: true });
  };
  $('#seatSchemeBtn').onclick = openSchemeModal;
  $('#seatSwapBtn').onclick = openSwapModal;
  $('#seatPrintBtn').onclick = () => window.print();
  $('#seatExportBtn').onclick = exportSeatCsv;
  $('#seatConfirmBtn').onclick = () => savePlan({ seats: state.seat.seats }, { confirm: true });
  $('#seatClearBtn').onclick = async () => {
    const ok = await confirmDialog({ title: '清空座位', message: '将清空所有已排座位，学生回到「未入座」。', okText: '清空', danger: true });
    if (!ok) return;
    const seats = new Array(state.seat.cols * state.seat.rows).fill(null);
    state.seat.seats = seats;
    await savePlan({ seats });
  };
}
