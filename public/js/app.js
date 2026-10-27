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
  // 性能：版本信息与登录态是两个独立请求，串行会白白多等一个 RTT（含云函数冷启动），
  // 这里并行发起，取登录态的结果为主。
  const [settingsResult, meResult] = await Promise.allSettled([
    api.get('/public/settings').catch(() => null),
    api.get('/auth/me'),
  ]);

  if (settingsResult.status === 'fulfilled' && settingsResult.value) {
    state.version = settingsResult.value.version || '';
  }

  const me = meResult.status === 'fulfilled' ? meResult.value : null;
  if (!me) {
    const err = meResult.reason;
    // 只有明确的 401（未登录）才跳转登录页；
    // 其余情况（网络异常 / 服务返回非 JSON）留在原地提示，避免与登录页互相踢形成跳转循环。
    if (err instanceof ApiError && err.status === 401) {
      goLogin();
      return;
    }
    toast('服务暂时不可用，请稍后重试', 'err');
    return;
  }
  // 拿到了响应但没有账号信息：属于异常响应，同样不跳登录（否则与登录页互踢形成死循环）
  if (!me.account || !me.account.username) {
    toast('服务暂时不可用，请稍后重试', 'err');
    return;
  }
  await route(me);
}

bootstrap();
