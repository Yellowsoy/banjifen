# v2.4.1（2026-11-05）· 依赖安全与 CSP 加固

## xlsx CVE 修复
- `xlsx@0.18.5` 含 CVE-2023-30533（原型污染）与 CVE-2024-22363（ReDoS），且 `server/src/core/excel.js` 用 `sheet_to_json` 解析用户上传的不可信 Excel。
- 升级到官方修复版 **xlsx 0.20.3**。为避免平台构建依赖外网 CDN，把 tarball 放进仓库 `vendor/xlsx-0.20.3.tgz`（2.3MB），`package.json` 改为 `file:./vendor/xlsx-0.20.3.tgz`，并重新生成 `package-lock.json`（`npm install --package-lock-only --ignore-scripts`，0 vulnerabilities）。
- tgz 已校验：`gzip -t` 通过、tar 完整、包内 version 0.20.3、Range 抽样字节一致。

## CSP 加固
- `server/src/app.js` 的 CSP 补 `form-action 'self'`，保留 51.LA 统计白名单。
- `cloud-functions/api/[[default]].js` 只是 `export default createEdgeApp()`，所有响应已走全局中间件，无需重复设置。
- 抽查 5 处前端 `innerHTML` 用户可控插入点，均使用 `escapeHtml` / `textContent`，未发现确证未转义高危点。

## 验证与已知限制
- `node --check` 通过；本机无 `node_modules`，`npm test` 报 `Cannot find module 'xlsx'`（环境问题，非本次改动引入）。
- 其余 90+ 依赖的 lock 仍指向腾讯 npm 镜像，整体平台构建仍需访问该镜像；本次只消除了 SheetJS CDN 依赖。

