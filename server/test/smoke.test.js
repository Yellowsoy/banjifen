'use strict';
/**
 * 冒烟 / 集成测试：临时数据库 + 独立端口，覆盖三种班级角色、超级管理员与全部业务链路。
 * 运行：npm test
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const XLSX = require('xlsx');

const PORT = 3998;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banjifen-test-'));
const DB_FILE = path.join(tmpDir, 'test.sqlite');

let server;
let passed = 0;
let failed = 0;

function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed += 1;
      console.error(`  ✗ ${name}\n    ${err.message}`);
    });
}

class Client {
  constructor() {
    this.cookies = new Map();
  }

  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  store(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      const key = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (value === '') this.cookies.delete(key);
      else this.cookies.set(key, value);
    }
  }

  async req(method, url, body, isForm = false) {
    const headers = { 'x-requested-with': 'fetch', cookie: this.header() };
    let payload;
    if (body && isForm) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + url, { method, headers, body: payload });
    this.store(res);
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }

  get(url) { return this.req('GET', url); }
  post(url, body) { return this.req('POST', url, body); }
  patch(url, body) { return this.req('PATCH', url, body); }
  put(url, body) { return this.req('PUT', url, body); }
  del(url) { return this.req('DELETE', url); }
  form(url, formData) { return this.req('POST', url, formData, true); }
}

function makeXlsx(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/public/health`);
      if (res.ok) return;
    } catch {
      /* 继续等待 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('服务启动超时');
}

async function login(client, username, password, entry = 'class') {
  return client.post('/api/auth/login', { username, password, entry });
}

async function main() {
  server = spawn(process.execPath, [path.join(__dirname, '../src/index.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE, NODE_ENV: 'test', JWT_SECRET: 'test-secret-should-be-long-enough-32' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await waitForServer();

  const owner = new Client();
  const teacher = new Client();
  const cadre = new Client();
  const superAdmin = new Client();

  console.log('\n[1] 登录与角色识别');
  await ok('班主任登录（班级成员入口）', async () => {
    const res = await login(owner, '123456', '123456');
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.account.role, 'owner');
    assert.ok(res.data.class && res.data.class.name);
    assert.ok(res.data.capabilities.includes('member:manage'));
  });
  await ok('老师登录，能力清单不含成员管理', async () => {
    const res = await login(teacher, 'teacher', '123456');
    assert.equal(res.status, 200);
    assert.equal(res.data.account.role, 'teacher');
    assert.ok(res.data.capabilities.includes('points:batch'));
    assert.ok(!res.data.capabilities.includes('member:manage'));
  });
  await ok('班干部登录，能力清单最精简', async () => {
    const res = await login(cadre, 'cadre', '123456');
    assert.equal(res.status, 200);
    assert.equal(res.data.account.role, 'cadre');
    assert.deepEqual(
      [...res.data.capabilities].sort(),
      ['class:read', 'gift:read', 'history:read', 'points:single', 'rules:read', 'seat:read', 'student:read']
    );
  });
  await ok('超级管理员登录（超管入口）', async () => {
    const res = await login(superAdmin, 'admin', 'admin123456', 'super');
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.account.role, 'super_admin');
    assert.equal(res.data.class, null);
  });
  await ok('角色与入口不匹配时给出明确提示', async () => {
    const c = new Client();
    const res = await login(c, 'admin', 'admin123456', 'class');
    assert.equal(res.status, 400);
    assert.match(res.data.error.message, /超级管理员/);
  });
  await ok('密码错误被拒绝', async () => {
    const c = new Client();
    const res = await login(c, '123456', 'wrong-pass');
    assert.equal(res.status, 400);
    assert.match(res.data.error.message, /密码/);
  });
  await ok('自助注册接口已移除（404）', async () => {
    const c = new Client();
    const res = await c.post('/api/auth/register', { username: '13900000000', password: 'abc123' });
    assert.equal(res.status, 404);
  });
  await ok('未登录访问受保护接口返回 401', async () => {
    const c = new Client();
    const res = await c.get('/api/class/overview');
    assert.equal(res.status, 401);
  });

  console.log('\n[2] 班级端权限边界');
  let studentId;
  await ok('班主任新增学生', async () => {
    const res = await owner.post('/api/class/students', { name: '测试同学', groupName: '第五组', sex: '男', position: '组长' });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    studentId = res.data.id;
  });
  await ok('老师可以新增学生', async () => {
    const res = await teacher.post('/api/class/students', { name: '老师添加', groupName: '第五组' });
    assert.equal(res.status, 201);
  });
  await ok('老师不能删除学生（403）', async () => {
    const res = await teacher.del(`/api/class/students/${studentId}`);
    assert.equal(res.status, 403);
  });
  await ok('班干部不能新增学生（403）', async () => {
    const res = await cadre.post('/api/class/students', { name: '班干部加的' });
    assert.equal(res.status, 403);
  });
  await ok('班干部单人加分成功（额度内）', async () => {
    const res = await cadre.post('/api/class/points', { studentIds: [studentId], delta: 3, reason: '课前朗读' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.logs[0].operatorRole, 'cadre');
    assert.equal(res.data.students[0].points, 3);
  });
  await ok('班干部超单次额度被拒绝', async () => {
    const res = await cadre.post('/api/class/points', { studentIds: [studentId], delta: 9 });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'CADRE_LIMIT_PER');
  });
  await ok('班干部批量加减分被拒绝', async () => {
    const list = await cadre.get('/api/class/students?pageSize=2');
    const ids = list.data.items.map((s) => s.id);
    const res = await cadre.post('/api/class/points', { studentIds: ids, delta: 1 });
    assert.equal(res.status, 403);
  });
  await ok('班干部不能修改规则 / 兑换礼品 / 清空', async () => {
    assert.equal((await cadre.post('/api/class/rules', { name: 'x', score: 1 })).status, 403);
    assert.equal((await cadre.post('/api/class/reset-points')).status, 403);
    assert.equal((await cadre.get('/api/members')).status, 403);
  });
  await ok('老师可批量加分', async () => {
    const list = await teacher.get('/api/class/students?pageSize=3');
    const ids = list.data.items.map((s) => s.id);
    const res = await teacher.post('/api/class/points', { studentIds: ids, delta: 2, reason: '小组合作' });
    assert.equal(res.status, 200);
    assert.equal(res.data.logs.length, ids.length);
    assert.equal(res.data.logs[0].kind, 'batch');
  });
  await ok('老师不能清空班级数据（403）', async () => {
    assert.equal((await teacher.post('/api/class/clear-all')).status, 403);
    assert.equal((await teacher.put('/api/class/profile', { className: 'x' })).status, 403);
  });
  await ok('积分记录带操作人信息', async () => {
    const res = await owner.get('/api/class/logs?pageSize=5');
    assert.equal(res.status, 200);
    const log = res.data.items[0];
    assert.ok(log.operatorName);
    assert.ok(['owner', 'teacher', 'cadre'].includes(log.operatorRole));
  });

  console.log('\n[3] 班级业务链路');
  await ok('Excel 导入花名册（去重）', async () => {
    const form = new FormData();
    const buf = makeXlsx([
      { 姓名: '导入甲', 小组: '第六组', 性别: '女' },
      { 姓名: '导入乙', 小组: '第六组', 性别: '男' },
      { 姓名: '张小明', 小组: '第一组' },
    ]);
    form.append('file', new Blob([buf]), 'students.xlsx');
    const res = await owner.form('/api/class/students/import', form);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.added, 2);
    assert.equal(res.data.duplicates, 1);
  });
  await ok('小组榜按总积分排序', async () => {
    const res = await owner.get('/api/class/groups?sort=desc');
    assert.equal(res.status, 200);
    assert.ok(res.data[0].total >= res.data[res.data.length - 1].total);
  });
  await ok('删除记录会反向修正积分', async () => {
    const logs = await owner.get('/api/class/logs?pageSize=1');
    const log = logs.data.items[0];
    const before = (await owner.get('/api/class/students?pageSize=200')).data.items.find((s) => s.id === log.studentId);
    assert.equal((await owner.del(`/api/class/logs/${log.id}`)).status, 200);
    const after = (await owner.get('/api/class/students?pageSize=200')).data.items.find((s) => s.id === log.studentId);
    assert.equal(after.points, before.points - log.delta);
  });
  let giftId;
  await ok('礼物创建与兑换（积分不足被拒）', async () => {
    const gift = await owner.post('/api/class/gifts', { name: '测试礼物', cost: 3 });
    assert.equal(gift.status, 201);
    giftId = gift.data.id;
    const poor = await owner.post('/api/class/students', { name: '零分同学' });
    const res = await owner.post(`/api/class/gifts/${giftId}/redeem`, { studentIds: [poor.data.id] });
    assert.equal(res.status, 400);
    assert.match(res.data.error.message, /积分不足/);
  });
  await ok('老师可以兑换，班干部不能兑换', async () => {
    const okRes = await teacher.post(`/api/class/gifts/${giftId}/redeem`, { studentIds: [studentId] });
    assert.equal(okRes.status, 200, JSON.stringify(okRes.data));
    const deny = await cadre.post(`/api/class/gifts/${giftId}/redeem`, { studentIds: [studentId] });
    assert.equal(deny.status, 403);
  });
  await ok('排座：自动排座 + 保存确认', async () => {
    const auto = await owner.post('/api/class/seat/auto', { cols: 4, rows: 2, scheme: 'points' });
    assert.equal(auto.status, 200);
    assert.equal(auto.data.seats.length, 8);
    const save = await owner.put('/api/class/seat', { cols: 4, rows: 2, seats: auto.data.seats, angle: 'student', confirm: true });
    assert.equal(save.status, 200, JSON.stringify(save.data));
    assert.ok(save.data.confirmedAt);
    assert.equal((await cadre.put('/api/class/seat', { cols: 4, rows: 2, seats: [] })).status, 403);
  });
  let examId;
  await ok('成绩导入与三种视图', async () => {
    const form = new FormData();
    const students = (await owner.get('/api/class/students?pageSize=100')).data.items;
    const buf = makeXlsx(students.slice(0, 3).map((s, i) => ({ 姓名: s.name, 成绩: 90 - i * 10 })));
    form.append('file', new Blob([buf]), 'scores.xlsx');
    form.append('examName', '第一次月考');
    form.append('fullScore', '100');
    const res = await owner.form('/api/class/exams/import', form);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    examId = res.data.examId;
    for (const v of ['student', 'group', 'class']) {
      const view = await owner.get(`/api/class/scores?examId=${examId}&view=${v}`);
      assert.equal(view.status, 200);
      assert.ok(view.data.items.length > 0, v);
    }
    assert.equal((await cadre.get('/api/class/scores')).status, 403);
  });
  await ok('学生成绩单含趋势与建议', async () => {
    const res = await owner.get(`/api/class/scores/student/${studentId}`);
    assert.equal(res.status, 200);
    assert.ok(res.data.advice.length > 5);
  });
  await ok('清空积分写入回收站快照', async () => {
    assert.equal((await owner.post('/api/class/reset-points')).status, 200);
    const list = await owner.get('/api/class/students?pageSize=10');
    assert.ok(list.data.items.every((s) => s.points === 0));
  });

  console.log('\n[4] 班主任管理成员');
  let newTeacherId;
  const newTeacher = new Client();
  await ok('创建老师账号并可登录', async () => {
    const res = await owner.post('/api/members', {
      role: 'teacher',
      name: '新老师',
      username: 'newteacher',
      password: 'abc123',
      phone: '13900009999',
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    newTeacherId = res.data.id;
    assert.equal(res.data.role, 'teacher');
    const login1 = await login(newTeacher, 'newteacher', 'abc123');
    assert.equal(login1.status, 200);
  });
  await ok('手机号对班主任脱敏展示', async () => {
    const res = await owner.get('/api/members');
    assert.equal(res.status, 200);
    const row = res.data.find((m) => m.id === newTeacherId);
    assert.match(row.phoneMasked, /^139\*\*\*\*9999$/);
  });
  await ok('重置成员密码后旧密码失效', async () => {
    assert.equal((await owner.patch(`/api/members/${newTeacherId}`, { password: 'newpwd1' })).status, 200);
    const c = new Client();
    assert.equal((await login(c, 'newteacher', 'abc123')).status, 400);
    assert.equal((await login(c, 'newteacher', 'newpwd1')).status, 200);
  });
  await ok('停用成员后无法登录', async () => {
    assert.equal((await owner.patch(`/api/members/${newTeacherId}`, { status: 'disabled' })).status, 200);
    const c = new Client();
    const res = await login(c, 'newteacher', 'newpwd1');
    assert.equal(res.status, 400);
    assert.match(res.data.error.message, /停用/);
    await owner.patch(`/api/members/${newTeacherId}`, { status: 'active' });
  });
  await ok('调整班干部额度后立即生效', async () => {
    const res = await owner.patch('/api/members/settings/limits', { cadreLimitPer: 8, cadreLimitDay: 40 });
    assert.equal(res.status, 200);
    assert.equal(res.data.cadreLimitPer, 8);
    const point = await cadre.post('/api/class/points', { studentIds: [studentId], delta: 7 });
    assert.equal(point.status, 200, JSON.stringify(point.data));
    await owner.patch('/api/members/settings/limits', { cadreLimitPer: 5, cadreLimitDay: 20 });
  });
  await ok('不能移除班主任', async () => {
    const me = await owner.get('/api/auth/me');
    const res = await owner.del(`/api/members/${me.data.account.id}`);
    assert.equal(res.status, 400);
  });
  await ok('班主任转移后角色互换', async () => {
    const res = await owner.post('/api/members/transfer-owner', { memberId: newTeacherId });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const meOld = await owner.get('/api/auth/me');
    assert.equal(meOld.data.account.role, 'teacher');
    const meNew = await newTeacher.get('/api/auth/me');
    assert.equal(meNew.data.account.role, 'owner');
    // 转回来，后续用例仍以原班主任身份执行
    assert.equal((await newTeacher.post('/api/members/transfer-owner', { memberId: meOld.data.account.id })).status, 200);
    const back = await owner.get('/api/auth/me');
    assert.equal(back.data.account.role, 'owner');
  });

  console.log('\n[5] 超级管理员');
  await ok('班级无权访问超管接口（403）', async () => {
    assert.equal((await owner.get('/api/super/overview')).status, 403);
  });
  await ok('平台统计', async () => {
    const res = await superAdmin.get('/api/super/overview');
    assert.equal(res.status, 200);
    assert.ok(res.data.classes >= 1);
    assert.ok(res.data.owners >= 1);
    assert.ok(res.data.cadres >= 1);
  });
  let newClassId;
  let newOwnerId;
  await ok('创建班级同时创建班主任账号', async () => {
    const res = await superAdmin.post('/api/super/classes', {
      name: '四年级一班',
      school: '实验小学',
      grade: '四年级',
      ownerName: '赵老师',
      phone: '13900001111',
      username: 'zhao001',
      password: 'abc123',
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    newClassId = res.data.id;
    newOwnerId = res.data.ownerId;
    const c = new Client();
    assert.equal((await login(c, 'zhao001', 'abc123')).status, 200);
  });
  await ok('账号列表可见完整手机号与班级归属', async () => {
    const res = await superAdmin.get('/api/super/accounts?search=zhao001');
    assert.equal(res.status, 200);
    assert.equal(res.data.total, 1);
    assert.equal(res.data.items[0].phone, '13900001111');
    assert.equal(res.data.items[0].className, '四年级一班');
  });
  await ok('超管可创建老师并指定归属班级', async () => {
    const res = await superAdmin.post('/api/super/accounts', {
      classId: newClassId,
      role: 'teacher',
      name: '孙老师',
      phone: '13900002222',
      username: 'sun001',
      password: 'abc123',
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.classId, newClassId);
  });
  await ok('超管可重置任意账号密码', async () => {
    const res = await superAdmin.post(`/api/super/accounts/${newOwnerId}/reset-password`, { password: 'reset123' });
    assert.equal(res.status, 200);
    const c = new Client();
    assert.equal((await login(c, 'zhao001', 'abc123')).status, 400);
    assert.equal((await login(c, 'zhao001', 'reset123')).status, 200);
  });
  await ok('超管可修改手机号与姓名', async () => {
    const res = await superAdmin.patch(`/api/super/accounts/${newOwnerId}`, { phone: '13700003333', name: '赵班主任' });
    assert.equal(res.status, 200);
    assert.equal(res.data.phone, '13700003333');
    assert.equal(res.data.name, '赵班主任');
  });
  await ok('超管可把账号转到另一个班级', async () => {
    const classes = await superAdmin.get('/api/super/classes');
    const target = classes.data.items.find((c) => c.id !== newClassId);
    const account = (await superAdmin.get('/api/super/accounts?search=sun001')).data.items[0];
    const res = await superAdmin.patch(`/api/super/accounts/${account.id}`, { classId: target.id });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.classId, target.id);
  });
  await ok('同班只能有一个班主任（角色升级自动降级原班主任）', async () => {
    const teacherAccount = (await superAdmin.get('/api/super/accounts?search=sun001')).data.items[0];
    const res = await superAdmin.patch(`/api/super/accounts/${teacherAccount.id}`, { role: 'owner' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const owners = await superAdmin.get('/api/super/accounts?role=owner');
    const inClass = owners.data.items.filter((a) => a.classId === res.data.classId);
    assert.equal(inClass.length, 1);
  });
  await ok('删除班级后其账号无法登录，可从回收站恢复', async () => {
    assert.equal((await superAdmin.del(`/api/super/classes/${newClassId}`)).status, 200);
    const c = new Client();
    const denied = await login(c, 'zhao001', 'reset123');
    assert.equal(denied.status, 400);
    const restore = await superAdmin.post(`/api/super/classes/${newClassId}/restore`);
    assert.equal(restore.status, 200);
    const ok2 = await login(new Client(), 'zhao001', 'reset123');
    assert.equal(ok2.status, 200);
  });
  await ok('超管不能删除自己', async () => {
    const me = await superAdmin.get('/api/auth/me');
    const res = await superAdmin.del(`/api/super/accounts/${me.data.account.id}`);
    assert.equal(res.status, 400);
  });
  await ok('回收站可恢复班级数据快照', async () => {
    const recycle = await superAdmin.get('/api/super/recycle');
    assert.equal(recycle.status, 200);
    const snapshot = recycle.data.items.find((r) => r.kind === 'clear_points');
    assert.ok(snapshot);
    assert.equal((await superAdmin.post(`/api/super/recycle/${snapshot.id}/restore`)).status, 200);
  });
  await ok('操作日志记录了超管动作', async () => {
    const res = await superAdmin.get('/api/super/audit');
    assert.equal(res.status, 200);
    assert.ok(res.data.items.some((r) => r.action === 'class.create'));
  });
  await ok('导出班级 CSV', async () => {
    const res = await fetch(`${BASE}/api/super/classes/export.csv`, { headers: { cookie: superAdmin.header() } });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /班级,学校,年级/);
  });

  console.log('\n[6] 安全与健壮性');
  await ok('非 GET 请求缺少 CSRF 头被拒', async () => {
    const res = await fetch(`${BASE}/api/class/points`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.header() },
      body: JSON.stringify({ studentIds: [studentId], delta: 1 }),
    });
    assert.equal(res.status, 403);
  });
  await ok('参数非法返回 422', async () => {
    const res = await owner.post('/api/class/points', { studentIds: [], delta: 0 });
    assert.equal(res.status, 422);
  });
  await ok('越权访问他班学生返回 404', async () => {
    const other = new Client();
    await login(other, 'teacher', '123456');
    const res = await other.patch('/api/class/students/not-exists-id', { name: 'x' });
    assert.equal(res.status, 404);
  });
  await ok('退出后访问受限；刷新令牌可续期', async () => {
    const c = new Client();
    await login(c, 'teacher', '123456');
    assert.equal((await c.post('/api/auth/refresh')).status, 200);
    assert.equal((await c.get('/api/auth/me')).status, 200);
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/class/overview')).status, 401);
  });

  console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
  return failed === 0;
}

main()
  .then((success) => {
    if (server) server.kill('SIGTERM');
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(success ? 0 : 1), 300);
  })
  .catch((err) => {
    console.error('测试执行失败：', err);
    if (server) server.kill('SIGTERM');
    process.exit(1);
  });
