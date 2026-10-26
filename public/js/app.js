/** 入口：校验登录态，按角色挂载班级端或超管端；未登录统一跳转 /login.html */
import { api, ApiError } from './api.js';
import { $, toast } from './ui.js';
import { state } from './store.js';

function show(screen) {
  ['#classScreen', '#superScreen'].forEach((sel) => {
    $(sel).classList.toggle('hidden', sel !== screen);
  });
}

async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* 忽略退出失败 */
  }
  window.location.replace('/login.html');
}

function goLogin() {
  window.location.replace('/login.html');
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
    goLogin();
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

async function bootstrap() {
  try {
    const settings = await api.get('/public/settings');
    state.version = settings.version || '';
  } catch {
    /* 忽略版本信息失败 */
  }

  try {
    const me = await api.get('/auth/me');
    await route(me);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      goLogin();
      return;
    }
    toast('服务暂时不可用，请稍后重试', 'err');
  }
}

bootstrap();
