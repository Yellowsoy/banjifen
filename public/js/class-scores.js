/** 成绩模块：导入考试、学生/小组/班级三种视图、个人趋势与学习建议 */
import { api } from './api.js';
import { $, $$, escapeHtml, toast, openModal, closeModal, confirmDialog } from './ui.js';
import { state, can } from './store.js';

function summaryHtml(summary, exam) {
  if (!summary) return '';
  return `<div class="score-summary">
    <div class="score-metric"><b>${summary.avg}</b><span>平均分</span></div>
    <div class="score-metric"><b>${summary.max}</b><span>最高分</span></div>
    <div class="score-metric"><b>${summary.passRate}%</b><span>及格率</span></div>
    <div class="score-metric"><b>${summary.excellentRate}%</b><span>优秀率</span></div>
  </div>
  <div class="card" style="margin-top:12px">
    <div class="tiny muted">分数段分布${exam ? `（满分 ${exam.fullScore}）` : ''}</div>
    ${summary.buckets
      .map((b) => {
        const max = Math.max(...summary.buckets.map((x) => x.count), 1);
        return `<div class="bar-row">
          <span class="tiny muted">${b.label}</span>
          <span class="bar"><i style="width:${Math.round((b.count / max) * 100)}%"></i></span>
          <span class="tiny muted num" style="text-align:right">${b.count}</span>
        </div>`;
      })
      .join('')}
  </div>`;
}

export async function renderScores() {
  const s = state.scores;
  const exams = await api.get('/class/exams');
  s.exams = exams;
  const select = $('#examSelect');
  select.innerHTML = exams.length
    ? exams.map((e) => `<option value="${e.id}" ${e.id === s.examId ? 'selected' : ''}>${escapeHtml(e.name)}（${e.studentCount || 0} 人）</option>`).join('')
    : '<option value="">（暂无考试）</option>';
  if (!s.examId && exams.length) s.examId = exams[0].id;
  if (s.examId && !exams.find((e) => e.id === s.examId)) s.examId = exams.length ? exams[0].id : '';
  $('#btnOpenScoresImport').classList.toggle('hidden', !can('exam:import'));
  $('#btnDeleteExam').classList.toggle('hidden', !can('exam:delete'));
  if (!exams.length) {
    $('#scoreSummary').innerHTML = '';
    $('#scoreBody').innerHTML = '';
    $('#scoreEmpty').classList.remove('hidden');
    return;
  }
  $('#scoreEmpty').classList.add('hidden');
  const data = await api.get('/class/scores', { examId: s.examId, view: s.view });
  s.data = data;
  $('#scoreSummary').innerHTML = summaryHtml(data.summary, data.exam);
  renderBody(data);
}

function renderBody(data) {
  const box = $('#scoreBody');
  if (data.view === 'group') {
    box.innerHTML = `<div class="table-card">
      <div class="table-head group">
        <div class="center">排名</div><div>小组</div><div>人数</div><div>平均分</div><div>最高</div>
      </div>
      ${data.items
        .map(
          (g, i) => `<div class="group-row">
            <div><div class="rank-badge ${i < 3 ? `rank-${i + 1}` : ''}">${i + 1}</div></div>
            <div class="stu-name">${escapeHtml(g.name)}</div>
            <div class="center tiny muted num">${g.count}</div>
            <div class="right"><span class="points-pill">${g.avg}</span></div>
            <div class="center tiny muted num">${g.max}</div>
          </div>`
        )
        .join('')}
    </div>`;
    return;
  }
  box.innerHTML = `<div class="table-card">
    <div class="table-head score">
      <div class="center">排名</div><div>姓名</div><div>小组</div><div>成绩</div>
    </div>
    ${data.items
      .map((r, i) => {
        const rank = data.view === 'class' ? r.rank : i + 1;
        const cls = rank <= 3 ? `rank-${rank}` : '';
        return `<div class="table-row score" data-student="${r.studentId}">
          <div><div class="rank-badge ${cls}">${rank}</div></div>
          <div>
            <div class="stu-name">${escapeHtml(r.name)}</div>
            ${r.diff !== undefined ? `<div class="stu-sub ${r.diff >= 0 ? 'delta-pos' : 'delta-neg'}">较班均 ${r.diff >= 0 ? '+' : ''}${r.diff}</div>` : ''}
          </div>
          <div class="center tiny muted">${escapeHtml(r.groupName || '—')}</div>
          <div class="right"><span class="points-pill ${r.score >= 60 ? '' : 'neg'}">${r.score}</span></div>
        </div>`;
      })
      .join('')}
  </div>`;
  box.onclick = (e) => {
    const row = e.target.closest('[data-student]');
    if (row) openStudentScore(row.dataset.student);
  };
}

function trendChart(records) {
  if (records.length < 2) return '';
  const width = 300;
  const height = 120;
  const pad = 18;
  const max = Math.max(...records.map((r) => r.score), 100);
  const min = Math.min(...records.map((r) => r.score), 0);
  const stepX = (width - pad * 2) / (records.length - 1);
  const points = records.map((r, i) => {
    const x = pad + i * stepX;
    const y = height - pad - ((r.score - min) / Math.max(max - min, 1)) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:132px;display:block">
    <polyline fill="none" stroke="var(--c-primary)" stroke-width="2.5" stroke-linejoin="round" points="${points.join(' ')}" />
    ${records
      .map((r, i) => {
        const [x, y] = points[i].split(',');
        return `<circle cx="${x}" cy="${y}" r="3.5" fill="var(--c-primary)" />
          <text x="${x}" y="${Number(y) - 8}" font-size="12" fill="var(--c-ink-2)" text-anchor="middle">${r.score}</text>
          <text x="${x}" y="${height - 4}" font-size="12" fill="var(--c-ink-3)" text-anchor="middle">${escapeHtml(r.name.slice(0, 5))}</text>`;
      })
      .join('')}
  </svg>`;
}

async function openStudentScore(studentId) {
  const data = await api.get(`/class/scores/student/${studentId}`);
  openModal({
    title: `${data.student.name} 的成绩单`,
    body: `
      <div class="tiny muted" style="margin-bottom:8px">${escapeHtml(data.student.groupName || '未分组')} · ${escapeHtml(data.student.position || '')}</div>
      ${trendChart(data.trend)}
      <div class="advice-card">
        <div class="tiny muted mb-1">学习建议（按分数区间与趋势自动生成）</div>
        <div class="modal-text">${escapeHtml(data.advice)}</div>
      </div>
      <div style="margin-top:12px">
        ${data.records
          .map(
            (r) => `<div class="sheet-item">
              <span class="grow">${escapeHtml(r.name)}</span>
              <span class="tiny muted num">满分 ${r.fullScore}</span>
              <span class="points-pill num">${r.score}</span>
            </div>`
          )
          .join('')}
      </div>`,
    footer: '<button class="btn btn-primary btn-block" data-close>关闭</button>',
  });
}

function openImport() {
  openModal({
    title: '导入考试成绩',
    body: `
      <div class="col">
        <div class="field"><label>考试名称</label><input class="input" id="importExamName" placeholder="如：第一次月考" maxlength="30" /></div>
        <div class="field"><label>满分</label><input class="input num" id="importFullScore" type="number" value="100" min="1" max="1000" /></div>
        <div class="field"><label>成绩表（表头含「姓名」「成绩」）</label>
          <input type="file" id="scoreFileInput" accept=".xlsx,.xls,.csv" class="input" style="padding-top:9px" />
        </div>
        <button class="btn btn-sm btn-ghost" id="btnDownloadScoreTpl">下载模板</button>
      </div>`,
    footer: '<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="btnConfirmScoreImport">确认导入</button>',
    onMount(m) {
      m.querySelector('#btnDownloadScoreTpl').onclick = () => api.download('/class/exams/template');
      m.querySelector('#btnConfirmScoreImport').onclick = async () => {
        const name = m.querySelector('#importExamName').value.trim();
        const fullScore = Number(m.querySelector('#importFullScore').value) || 100;
        const file = m.querySelector('#scoreFileInput').files[0];
        if (!name) return toast('请输入考试名称', 'err');
        if (!file) return toast('请选择成绩表文件', 'err');
        const form = new FormData();
        form.append('file', file);
        form.append('examName', name);
        form.append('fullScore', String(fullScore));
        try {
          const res = await api.upload('/class/exams/import', form);
          closeModal();
          toast(`导入成功：匹配 ${res.matched} 人${res.unmatched.length ? `，${res.unmatched.length} 人未匹配` : ''}`, 'ok');
          state.scores.examId = res.examId;
          await renderScores();
        } catch (err) {
          toast(err.message, 'err');
        }
        return undefined;
      };
    },
  });
}

export function mountScores() {
  $('#btnOpenScoresImport').onclick = openImport;
  $('#examSelect').onchange = (e) => {
    state.scores.examId = e.target.value;
    renderScores();
  };
  $('#scoreViewTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    state.scores.view = btn.dataset.view;
    $$('#scoreViewTabs .pill').forEach((b) => b.classList.toggle('active', b === btn));
    renderScores();
  });
  $('#btnDeleteExam').onclick = async () => {
    if (!state.scores.examId) return;
    const ok = await confirmDialog({ title: '删除考试', message: '删除后该次考试成绩将不再显示。', okText: '删除', danger: true });
    if (!ok) return;
    try {
      await api.del(`/class/exams/${state.scores.examId}`);
      state.scores.examId = '';
      toast('已删除', 'ok');
      await renderScores();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}
