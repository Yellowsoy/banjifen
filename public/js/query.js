/**
 * 成绩对外查询页（完全免登录）
 *
 * 流程：口令 → 拉取该口令需要的输入项 → 填写姓名/学号/手机尾号 → 展示结果。
 * 这里刻意不使用 /js/api.js：那一层会自动携带 Cookie 并做 401 刷新重试，
 * 而公开页面压根不需要凭证，重复的重试逻辑只会拖慢首屏。
 */
const $ = (id) => document.getElementById(id);

const state = { token: '', info: null };

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, type = 'err') {
  const wrap = $('toastWrap');
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

function setError(id, text) {
  const box = $(id);
  if (!text) {
    box.classList.add('hidden');
    box.textContent = '';
    return;
  }
  box.textContent = text;
  box.classList.remove('hidden');
}

async function api(path, { method = 'GET', body } = {}) {
  const options = {
    method,
    credentials: 'omit',
    headers: { 'x-requested-with': 'fetch' },
  };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, options);
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    if ((res.headers.get('content-type') || '').includes('application/json')) {
      try {
        const data = await res.json();
        if (data && data.error) message = data.error.message || message;
      } catch { /* 忽略解析失败 */ }
    }
    throw new Error(message);
  }
  return res.json();
}

/* ================= 第一步：校验口令 ================= */
async function nextStep() {
  const token = $('qToken').value.trim().toUpperCase();
  setError('qErr', '');
  if (!token) return setError('qErr', '请输入查询口令');
  const btn = $('btnNext');
  btn.disabled = true;
  btn.textContent = '校验中…';
  try {
    const info = await api(`/public/query/${encodeURIComponent(token)}`);
    state.token = token;
    state.info = info;
    $('stepTokenCard').classList.add('hidden');
    $('stepFormCard').classList.remove('hidden');
    $('formClassName').textContent = info.className;
    $('headMeta').textContent = `${info.className}${info.school ? ` · ${info.school}` : ''}`;
    const fieldNames = {
      name_no: '学生姓名 + 学号',
      phone: '学生姓名 + 家长手机号后 4 位',
      none: '学生姓名',
    };
    $('formHint').textContent = `查询范围：${scopeLabel(info.scope)}｜校验方式：${fieldNames[info.mode] || info.modeLabel}`;
    $('fStudentNo').classList.toggle('hidden', info.mode !== 'name_no');
    $('fPhoneTail').classList.toggle('hidden', info.mode !== 'phone');
    $('resultCard').classList.add('hidden');
    $('qName').focus();
  } catch (err) {
    setError('qErr', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '下一步';
  }
  return undefined;
}

function backToToken() {
  state.info = null;
  $('stepFormCard').classList.add('hidden');
  $('resultCard').classList.add('hidden');
  $('stepTokenCard').classList.remove('hidden');
  $('headMeta').textContent = '请输入老师发送的查询口令';
}

const scopeLabel = (s) => ({ scores: '仅成绩', points: '仅积分', all: '成绩 + 积分' }[s] || s);

/* ================= 第二步：查询 ================= */
async function doQuery() {
  setError('qErr2', '');
  const info = state.info;
  if (!info) return setError('qErr2', '请先校验口令');
  const payload = { name: $('qName').value.trim() };
  if (info.mode === 'name_no') payload.studentNo = $('qStudentNo').value.trim();
  if (info.mode === 'phone') payload.phoneTail = $('qPhoneTail').value.trim();
  if (!payload.name) return setError('qErr2', '请输入学生姓名');
  const btn = $('btnQuery');
  btn.disabled = true;
  btn.textContent = '查询中…';
  try {
    const data = await api(`/public/query/${encodeURIComponent(state.token)}`, { method: 'POST', body: payload });
    renderResult(data);
  } catch (err) {
    setError('qErr2', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '查 询';
  }
  return undefined;
}

/* ================= 结果渲染 ================= */
function kv(list) {
  const items = list.filter((x) => x.v !== '' && x.v !== null && x.v !== undefined);
  if (!items.length) return '';
  return `<div class="query-kv">${items
    .map((x) => `<div class="query-kv-item"><div class="k">${escapeHtml(x.k)}</div><div class="v">${escapeHtml(x.v)}</div></div>`)
    .join('')}</div>`;
}

function renderResult(data) {
  const s = data.student || {};
  const card = $('resultCard');
  const parts = [];

  parts.push(`<div class="card query-card">
    <div class="query-result-head">
      <div class="query-avatar">${escapeHtml((s.name || '学').slice(0, 1))}</div>
      <div class="grow">
        <div class="query-title" style="font-size:17px">${escapeHtml(s.name)}</div>
        <div class="tiny muted">${escapeHtml(data.className)}${data.school ? ` · ${escapeHtml(data.school)}` : ''}</div>
      </div>
      ${s.groupName ? `<span class="badge">${escapeHtml(s.groupName)}</span>` : ''}
      ${s.position ? `<span class="badge badge-amber">${escapeHtml(s.position)}</span>` : ''}
    </div>
    ${kv([
      { k: '学号', v: s.studentNo },
      { k: '家长', v: s.guardianName ? `${s.guardianName}${s.guardianRelation ? `（${s.guardianRelation}）` : ''}` : '' },
      { k: '联系电话', v: s.guardianPhoneMasked },
    ])}
    <div class="tiny muted" style="margin-top:8px">如联系方式有误，请联系班主任在花名册中更新。</div>
  </div>`);

  if (data.points) {
    const p = data.points;
    parts.push(`<div class="card query-card">
      <div class="query-block-title">当前积分</div>
      <div class="row" style="gap:14px;align-items:flex-end">
        <div>
          <div class="query-exam" style="border:none;padding:0">
            <span class="score ${p.value >= 0 ? '' : ''}" style="color:${p.value >= 0 ? 'var(--c-green)' : 'var(--c-rose)'}">${p.value}</span>
            <span class="tiny muted"> 分</span>
          </div>
        </div>
        <div class="grow"></div>
        <div class="tiny muted">班级排名 <b class="num">${p.rank}</b> / ${p.total}</div>
      </div>
      ${
        p.recentLogs && p.recentLogs.length
          ? `<div class="query-block-title">最近积分变动</div>${p.recentLogs
              .map(
                (l) => `<div class="sheet-item">
                  <span class="delta-${l.delta > 0 ? 'pos' : 'neg'}">${l.delta > 0 ? '+' : ''}${l.delta}</span>
                  <span class="grow tiny">${escapeHtml(l.reason || '（无备注）')}</span>
                  <span class="tiny muted nowrap">${new Date(l.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>`
              )
              .join('')}`
          : ''
      }
    </div>`);
  }

  if (data.exams && data.exams.length) {
    const rows = data.exams
      .map((e) => {
        const has = e.score !== null && e.score !== undefined;
        const pct = e.fullScore ? Math.max(0, Math.min(100, Math.round(((has ? e.score : 0) / e.fullScore) * 100))) : 0;
        return `<div class="query-exam">
          <div class="between">
            <span class="name">${escapeHtml(e.examName)}</span>
            <span class="tiny muted nowrap">${new Date(e.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>
          <div class="between" style="align-items:flex-end;margin-top:4px">
            <span><span class="score num">${has ? e.score : '—'}</span>
              <span class="tiny muted"> / ${e.fullScore ?? '—'} 分</span></span>
            <span class="tiny muted nowrap">${has && e.rank ? `班排 ${e.rank} 名` : '未参加'}</span>
          </div>
          <div class="query-bar"><i style="width:${has ? pct : 0}%"></i></div>
          <div class="tiny muted" style="margin-top:4px">
            班均 ${e.classAvg ?? '—'} 分 · 最高 ${e.classMax ?? '—'} 分 · 参考 ${e.count} 人
          </div>
        </div>`;
      })
      .join('');
    const sum = data.summary;
    const summaryHtml = sum
      ? `<div class="card query-card">
          <div class="query-block-title">总体情况（${sum.examCount} 次考试）</div>
          ${kv([
            { k: '平均分', v: sum.average },
            { k: '最近一次', v: sum.latest ? `${sum.latest.name} ${sum.latest.score} 分` : '' },
            { k: '最近排名', v: sum.latest && sum.latest.rank ? `第 ${sum.latest.rank} 名` : '' },
          ])}
        </div>`
      : '';
    parts.push(`<div class="card query-card"><div class="query-block-title">考试成绩</div>${rows}</div>`);
    if (summaryHtml) parts.push(summaryHtml);
  }

  parts.push(`<div class="row"><button class="btn btn-ghost btn-block" id="btnAgain">再查一位</button></div>`);

  card.innerHTML = parts.join('');
  card.classList.remove('hidden');
  $('btnAgain').onclick = () => {
    card.classList.add('hidden');
    $('qName').value = '';
    $('qStudentNo').value = '';
    $('qPhoneTail').value = '';
    $('qName').focus();
  };
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================= 初始化 ================= */
function init() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = (params.get('token') || '').trim().toUpperCase();
  if (fromUrl) {
    $('qToken').value = fromUrl;
    nextStep();
  }
  $('btnNext').onclick = nextStep;
  $('btnBack').onclick = backToToken;
  $('btnQuery').onclick = doQuery;
  ['qToken', 'qName', 'qStudentNo', 'qPhoneTail'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (id === 'qToken' && !state.info) nextStep();
      else doQuery();
    });
  });
}

init();
