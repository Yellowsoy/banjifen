/** 通用 UI 工具：提示、弹层、确认框、格式化、分页 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(message, type = '') {
  const wrap = $('#toastWrap');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, 2200);
}

let currentModal = null;

export function closeModal() {
  const root = $('#modalRoot');
  if (root) root.innerHTML = '';
  currentModal = null;
}

/**
 * 打开弹层
 * @param {{title:string, body:string, footer?:string, onMount?:Function, onClose?:Function}} options
 */
export function openModal({ title, body, footer = '', onMount, onClose, wide = false }) {
  closeModal();
  const root = $('#modalRoot');
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal" style="${wide ? 'max-width:760px' : ''}">
      <div class="modal-head">
        <div class="modal-title">${escapeHtml(title)}</div>
        <button class="modal-close" data-close>✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-actions">${footer}</div>` : ''}
    </div>`;
  root.appendChild(mask);
  currentModal = mask;
  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.closest('[data-close]')) {
      closeModal();
      if (onClose) onClose();
    }
  });
  if (!window.__escBound) {
    window.__escBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }
  if (onMount) onMount(mask);
  return mask;
}

export function confirmDialog({ title = '确认操作', message = '', okText = '确认', danger = false }) {
  return new Promise((resolve) => {
    const mask = openModal({
      title,
      body: `<div style="font-size:14px;color:#334155;white-space:pre-wrap;line-height:1.7">${escapeHtml(message)}</div>`,
      footer: `<button class="btn btn-ghost" data-cancel>取消</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${escapeHtml(okText)}</button>`,
      onClose: () => resolve(false),
      onMount(m) {
        m.querySelector('[data-cancel]').onclick = () => {
          closeModal();
          resolve(false);
        };
        m.querySelector('[data-ok]').onclick = () => {
          closeModal();
          resolve(true);
        };
      },
      mask,
    });
    return mask;
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', okText = '保存' }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<div class="field"><label>${escapeHtml(label)}</label>
        <input class="input" id="promptInput" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" /></div>`,
      footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="promptOk">' + escapeHtml(okText) + '</button>',
      onClose: () => resolve(null),
      onMount(m) {
        const input = m.querySelector('#promptInput');
        input.focus();
        input.select();
        const submit = () => {
          const v = input.value.trim();
          closeModal();
          resolve(v);
        };
        m.querySelector('#promptOk').onclick = submit;
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submit();
        });
      },
    });
  });
}

/* ---------- 格式化 ---------- */
export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function startOfWeek() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function startOfTerm() {
  // 简化处理：本学期以 60 天前为起点
  return Date.now() - 60 * 86400000;
}

export function debounce(fn, wait = 260) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** 分页组件渲染 */
export function renderPager(container, { page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) {
    container.innerHTML = total ? `<div class="tiny muted">共 ${total} 条</div>` : '';
    return;
  }
  const btn = (label, target, disabled, active = false) =>
    `<button ${disabled ? 'disabled' : ''} class="${active ? 'active' : ''}" data-page="${target}">${label}</button>`;
  const nums = [];
  const from = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = from; i <= Math.min(pages, from + 4); i += 1) nums.push(btn(i, i, false, i === page));
  container.innerHTML = `
    ${btn('«', 1, page <= 1)}
    ${btn('‹', page - 1, page <= 1)}
    ${nums.join('')}
    ${btn('›', page + 1, page >= pages)}
    ${btn('»', pages, page >= pages)}
    <span class="tiny muted" style="margin-left:6px">共 ${total} 条</span>`;
  container.querySelectorAll('button[data-page]').forEach((el) => {
    el.onclick = () => {
      const target = Number(el.dataset.page);
      if (target >= 1 && target <= pages && target !== page) onChange(target);
    };
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** 压缩图片，避免班级徽章过大 */
export async function compressImage(file, maxSize = 320, quality = 0.85) {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function todayInput() {
  return new Date().toISOString().slice(0, 10);
}
