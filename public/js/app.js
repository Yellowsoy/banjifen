/** 入口：登录、按角色挂载界面 */
import { api, ApiError } from './api.js';
import { $, $$, toast } from './ui.js';
import { state } from './store.js';


function show(screen) {
  ['#loginScreen', '#classScreen', '#superScreen'].forEach((sel) => {
    $(sel).classList.toggle('hidden', sel !== screen);
  });
}

async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* 忽略退出失败 */
  }
  window.location.reload();
}

async function route(me) {
  state.me = me;
  state.caps = new Set(me.capabilities || []);
  const role = me.account ? me.account.role : '';
  if (role === 'super_admin') {
    show('#superScreen');
    const { mountSuperApp } = await import('./super-app.js');
    await mountSuperApp({ logout });
    return;
  }
  if (!role) {
    toast('账号角色异常，请联系超级管理员', 'err');
    show('#loginScreen');
    return;
  }
  show('#classScreen');
  const [app, mall, seat, scores, members] = await Promise.all([
    import('./class-app.js'),
    import('./class-mall.js'),
    import('./class-seat.js'),
    import('./class-scores.js'),
    import('./members.js'),
  ]);
  await app.mountClassApp({ logout });
  mall.mountMall();
  seat.mountSeat();
  scores.mountScores();
  members.mountMembers();
}

async function doLogin() {
  const username = $('#loginUser').value.trim();
  const password = $('#loginPwd').value;
  const errBox = $('#loginErr');
  errBox.classList.add('hidden');
  if (!username || !password) {
    errBox.textContent = '请输入账号和密码';
    errBox.classList.remove('hidden');
    return;
  }
  const btn = $('#btnLogin');
  btn.disabled = true;
  btn.textContent = '登录中…';
  try {
    const result = await api.post('/auth/login', { username, password });
    await route(result);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '登 录';
  }
}

async function bootstrap() {
  $('#btnLogin').onclick = doLogin;
  ['#loginUser', '#loginPwd'].forEach((sel) => {
    $(sel).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin();
    });
  });

  try {
    const settings = await api.get('/public/settings');
    state.version = settings.version || '';
  } catch {
    /* 忽略 */
  }

  try {
    const me = await api.get('/auth/me');
    await route(me);
  } catch (err) {
    show('#loginScreen');
    if (!(err instanceof ApiError && err.status === 401)) {
      toast('服务暂时不可用，请稍后重试', 'err');
    }
  }
}

bootstrap();
