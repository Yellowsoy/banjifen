'use strict';
/**
 * 演示数据脚本（用于生成 README 截图）
 * 全部为虚构数据：示例学校、示例班级、化名学生、虚构手机号。
 * 用法：先 npm start，再 node scripts/seed-demo.js [baseUrl]
 */
const XLSX = require('xlsx');

const BASE = process.argv[2] || 'http://localhost:3000';

class Client {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i); const v = pair.slice(i + 1);
      if (v === '') this.cookies.delete(k); else this.cookies.set(k, v);
    }
  }
  async req(method, url, body, form) {
    const headers = { 'x-requested-with': 'fetch', cookie: this.header() };
    let payload;
    if (form) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers, body: payload });
    this.store(res);
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b); }
  patch(u, b) { return this.req('PATCH', u, b); }
  del(u) { return this.req('DELETE', u); }
  form(u, f) { return this.req('POST', u, f, true); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const superc = new Client();
  let r = await superc.post('/api/auth/login', { username: 'admin', password: 'admin123456', entry: 'super' });
  if (r.status !== 200) throw new Error('超管登录失败：' + JSON.stringify(r.data));

  // 第二个班级，让超管页面有对比
  await superc.post('/api/super/classes', {
    name: '四年级三班', school: '示例第二小学', grade: '四年级',
    ownerName: '周老师', phone: '13800138002', username: 'demo_owner2', password: 'demo123456',
  });
  const classes = await superc.get('/api/super/classes');
  const cls2 = classes.data.items.find((c) => c.name === '四年级三班');
  if (cls2) {
    await superc.post('/api/super/accounts', { classId: cls2.id, role: 'teacher', name: '吴老师', phone: '13800138003', username: 'demo_teacher2', password: 'demo123456' });
    await superc.post('/api/super/accounts', { classId: cls2.id, role: 'cadre', name: '郑小雨', phone: '13800138004', username: 'demo_cadre2', password: 'demo123456' });
  }

  const owner = new Client();
  r = await owner.post('/api/auth/login', { username: '123456', password: '123456', entry: 'class' });
  if (r.status !== 200) throw new Error('班主任登录失败');

  // 班级资料
  await owner.req('PUT', '/api/class/profile', { className: '三年级二班', school: '示例小学', grade: '三年级' });

  // 补充学生（化名，虚构）
  const extra = [
    ['孙小满', '第五组', '男', '纪律委员'],
    ['钱多多', '第五组', '女', ''],
    ['吴小舟', '第六组', '男', ''],
    ['郑小禾', '第六组', '女', '图书管理员'],
  ];
  for (const [name, groupName, sex, position] of extra) {
    await owner.post('/api/class/students', { name, groupName, sex, position });
  }

  const students = (await owner.get('/api/class/students?pageSize=100')).data.items;
  const reasons = [
    ['作业优秀', 2], ['课堂发言', 1], ['主动帮助他人', 2], ['值日认真', 1], ['小组合作', 2],
    ['作业未完成', -2], ['课堂讲话', -1], ['迟到', -1],
  ];
  // 为每位学生生成 3~6 条流水，凑出自然的排行榜
  for (let i = 0; i < students.length; i += 1) {
    const s = students[i];
    const count = 3 + (i % 4);
    for (let j = 0; j < count; j += 1) {
      const [reason, delta] = reasons[(i + j) % reasons.length];
      await owner.post('/api/class/points', { studentIds: [s.id], delta, reason });
    }
    await sleep(5);
  }

  // 班干部用它自己的账号加两条，留下可追溯的操作人
  const cadre = new Client();
  await cadre.post('/api/auth/login', { username: 'cadre', password: '123456', entry: 'class' });
  if (students[0]) {
    await cadre.post('/api/class/points', { studentIds: [students[0].id], delta: 2, reason: '早读领读' });
  }
  if (students[1]) {
    await cadre.post('/api/class/points', { studentIds: [students[1].id], delta: 1, reason: '擦黑板' });
  }

  // 两份成绩
  const exams = [
    ['第一次月考', [92, 88, 75, 81, 64, 95, 58, 70, 86, 79, 68, 90]],
    ['期中考试', [96, 79, 88, 66, 72, 90, 64, 85, 91, 83, 74, 87]],
  ];
  for (const [name, scores] of exams) {
    const rows = students.slice(0, scores.length).map((s, i) => ({ 姓名: s.name, 成绩: scores[i] }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'scores.xlsx');
    form.append('examName', name);
    form.append('fullScore', '100');
    const res = await owner.form('/api/class/exams/import', form);
    if (res.status !== 200) console.warn('导入成绩失败', name, JSON.stringify(res.data));
  }

  // 排座：按积分自动排 + 确认
  const auto = await owner.post('/api/class/seat/auto', { cols: 6, rows: 2, scheme: 'points' });
  if (auto.status === 200) {
    await owner.req('PUT', '/api/class/seat', { cols: 6, rows: 2, seats: auto.data.seats, angle: 'teacher', confirm: true });
  }

  // 一条兑换记录（用老师账号，积分足够的同学）
  const gifts = (await owner.get('/api/class/gifts')).data;
  const rich = students[0];
  const cheap = gifts.filter((g) => g.cost <= rich.points).sort((a, b) => a.cost - b.cost)[0];
  if (cheap) {
    const teacher = new Client();
    await teacher.post('/api/auth/login', { username: 'teacher', password: '123456', entry: 'class' });
    await teacher.post(`/api/class/gifts/${cheap.id}/redeem`, { studentIds: [rich.id] });
  }

  console.log('演示数据生成完成：学生', students.length, '名');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
