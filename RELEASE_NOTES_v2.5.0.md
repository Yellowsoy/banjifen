# v2.5.0（2026-11-06）· 单点退出

## 退出登录改为单点退出（Single Logout）
- `POST /api/auth/logout` 除清本站 `bj_at` / `bj_rt` 与吊销会话记录外，还会判断浏览器是否持有父域 `sso_token`：
  - 有：返回 `{ hasSso: true, ssoLogout }`，前端跳 `https://sso.5166966.xyz/logout?redirect=<本站首页>`，由登录中心清父域票并吊销该账号全部会话；
  - 没有（纯账号密码登录）：只清本站并回 `/login.html`，不额外跳转。
- 覆盖两处前端退出入口：`public/js/app.js`（班级/超管应用）与 `public/js/settings.js`（设置页）。

## 会话来源标记
- 新增迁移 `005_sso_session.sql`：`auth_sessions` 增加 `via` 列（`sso` / `local`），并建索引。
- `issueSession()` 把 `via` 写进会话记录与访问令牌；`loginBySsoEmail()` 传 `sso`，账号密码登录默认 `local`，`refresh()` 沿用原会话的来源。
- `readAuth()` 对 `via=sso` 的令牌额外要求请求里存在 `sso_token`：用户在任何站点退出后，本站下一次请求即判未登录，不用等 access token 自然过期。
- 升级前签发、没有 `via` 的旧令牌按 `local` 处理，不会被误踢。

## 验证与已知限制
- `node scripts/gen-inline.js` 已重新生成 `migrations.generated.js`（含 005）。
- `node --check` 通过（服务端 4 个文件、前端 2 个 ESM 文件）。
- 本机无 `node_modules`，`npm test` 未能执行（与 v2.4.1 相同环境限制）；迁移为纯加法，可直接在既有库上执行。
