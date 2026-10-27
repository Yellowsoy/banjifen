# 班级积分管理 · Class Points

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Yellowsoy/banjifen?style=flat-square&logo=apache&logoColor=white" alt="License"></a>
  <img src="https://img.shields.io/github/actions/workflow/status/Yellowsoy/banjifen/warmup.yml?label=warmup&style=flat-square&logo=githubactions&logoColor=white" alt="Warmup">
  <img src="https://img.shields.io/badge/tests-74%20passed-brightgreen?style=flat-square&logo=jest&logoColor=white" alt="Tests">
  <img src="https://img.shields.io/badge/version-2.1-0098FF?style=flat-square" alt="Version">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18.17-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/database-SQLite%20sql.js-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="Database">
  <img src="https://img.shields.io/badge/frontend-Vanilla%20JS-1572B6?style=flat-square&logo=javascript&logoColor=white" alt="Frontend">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/deploy-EdgeOne%20Pages-00b4ff?style=flat-square" alt="Deploy">
  <img src="https://img.shields.io/badge/cost-%240%2Fmonth-success?style=flat-square" alt="Cost">
</p>

<p align="center">
  <img src="https://img.shields.io/github/stars/Yellowsoy/banjifen?style=flat-square&logo=github" alt="Stars">
  <img src="https://img.shields.io/github/forks/Yellowsoy/banjifen?style=flat-square&logo=github" alt="Forks">
  <img src="https://img.shields.io/github/issues/Yellowsoy/banjifen?style=flat-square&logo=github" alt="Issues">
  <img src="https://img.shields.io/github/last-commit/Yellowsoy/banjifen?style=flat-square&logo=github" alt="Last commit">
  <img src="https://img.shields.io/github/languages/top/Yellowsoy/banjifen?style=flat-square&logo=github" alt="Top language">
</p>

一个面向小学班主任的班级积分管理系统：**花名册导入 / 实时加减分 / 积分排行 / 积分排座 / 积分商城 / 成绩分析与学习建议**，配套 **超级管理员 · 班主任 · 老师 · 班干部** 四级角色权限。

v2.1 新增三大能力：

- **学生档案**：学号、出生日期、家庭住址、家长姓名 / 手机号 / 关系 / 备用电话、备注，随花名册 Excel 自动识别导入，一键导出完整档案 Excel；
- **数据备份与恢复**：班级级 / 平台级 JSON 全量备份一键导出、上传即恢复（备份不含密码，密码一律重置后下发）；
- **全量操作日志 + 成绩对外查询**：谁在哪个班对谁做了什么、改了哪几个字段、失败了几次，全部可查可导出；家长凭「口令 + 学号」在公开页面免登录查成绩。

整套系统可完全私有部署：一个 Node.js 进程 + 一个 SQLite 文件，无需任何第三方云服务；也可一键部署到 EdgeOne Pages（静态前端 + Node 云函数 + Blob 数据存储），详见[部署](#部署)。

> 📄 开源协议：[Apache License 2.0](LICENSE) —— 允许商用与闭源二次分发，仅需保留版权声明。

> 以上截图使用 **虚构演示数据**（示例学校、化名学生、138xxxx 测试手机号），由仓库内 `scripts/seed-demo.js` 生成，可复现。

---

## 目录

- [项目架构总览](#项目架构总览)
- [核心特性](#核心特性)
- [界面预览](#界面预览)
- [快速开始](#快速开始)
- [重要操作方法（速查）](#重要操作方法速查)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [后端服务与数据库说明](#后端服务与数据库说明)
- [API](#api)
- [存储位置与访问方式](#存储位置与访问方式)
- [数据结构说明](#数据结构说明)
- [界面规范（视觉对齐）](#界面规范视觉对齐)
- [成绩「学习建议」是怎么算的](#成绩学习建议是怎么算的)
- [测试](#测试)
- [部署](#部署)
- [免费架构与成本（永久 $0）](#免费架构与成本永久-0)
- [注意事项与常见问题](#注意事项与常见问题)
- [安全设计](#安全设计)
- [开源协议](#开源协议)
- [说明](#说明)

---

## 项目架构总览

### 整体分层

系统由「**静态前端** + **Node 后端 API** + **SQLite 数据库**」三层组成，前后端完全分离，所有交互走 `/api/*` 接口，鉴权基于 httpOnly Cookie（前端拿不到令牌）。

```
┌──────────────────────── 浏览器（public/） ────────────────────────┐
│  index.html / login.html / settings.html / query.html            │
│  css/design-system.css（设计系统 v2）                              │
│  js/api.js（fetch 封装 + CSRF 头 + 401 自动刷新重试 + 文件下载）    │
│  js/{ui,store,app}.js + 各业务模块 app.js                          │
└──────────────────────────────┬───────────────────────────────────┘
                               │  /api/*（httpOnly Cookie + x-requested-with: fetch）
┌──────────────────────────────▼───────────────────────────────────┐
│ Express 5（server/src）                                            │
│  中间件：context(requestId/日志) → 安全头 → auth(requireCap)        │
│        → audit-trail(trail) → 错误处理                            │
│  模块 modules/：                                                   │
│    auth     登录/刷新/登出/改密                                    │
│    class    学生/积分/规则/商城/排座/成绩（班主任+老师+班干部）     │
│    members  班主任管理本班成员                                      │
│    super    超管：班级/账号/归属/回收站/审计/日志/备份/查询         │
│    public   版本号/健康检查                                        │
│  分层：routes（路由+参数）→ controller（解析/响应）                 │
│       → service（业务+事务）→ repository（SQL）                    │
└──────────────────────────────┬───────────────────────────────────┘
                               │
              SQLite（sql.js 内存库 + 原子落盘 / EdgeOne Blob 快照）
```

### 后端分层约定

每个业务模块内部遵循严格的四层职责分离，避免「在路由里写 SQL、在控制器里写业务」：

| 层              | 文件                | 职责                                                                 |
| -------------- | ----------------- | ------------------------------------------------------------------ |
| **routes**     | `*.routes.js`     | 只声明路径、HTTP 方法、挂载 `requireAuth/requireCap` 能力校验、挂 `trail()` 审计；不做业务 |
| **controller** | `*.controller.js` | 解析请求体/参数、调用 service、组织响应；做入参结构校验（zod）                              |
| **service**    | `*.service.js`    | 业务逻辑、事务边界、归属校验（`class_id` 来自登录态，不接受前端传入）、调用 repository             |
| **repository** | `*.repository.js` | 纯 SQL 读写，全部使用参数化查询                                                 |

> `members` 模块未单独拆 repository（业务较薄，service 直接调 db）；`public` 模块只含 routes，无业务逻辑。

### 中间件链与请求生命周期

一个写请求的完整链路（以「班主任给某学生加 2 分」为例）：

1. **安全头中间件**：注入 `X-Content-Type-Options / X-Frame-Options / CSP / HSTS(prod)`；
2. **context**：生成 `requestId`，挂到 `req.ctx`，结构化日志全链路可追踪；
3. **静态资源 / 路由分发**：`/api/*` 进入 Express 路由；
4. **auth 中间件**：`requireAuth('owner')` → 校验 CSRF 头（`x-requested-with: fetch`）→ 读 Cookie 里的访问令牌 → 还原登录态（`accountId/role/classId`）→ 非 GET 一律校验 CSRF；
5. **service + repository**：在事务内完成「插入 point_logs + 更新 students.points」；
6. **audit-trail**：`trail()` 把本次写操作的摘要、操作人、班级、成功/失败、IP、UA、上下文写入 `operation_logs`（失败请求也记）；
7. **error**：统一错误响应 `{ error: { code, message }, requestId }`，不泄露堆栈；
8. **落盘**：写操作触发 `db` 标记 dirty，本地模式 60ms 防抖后原子落盘，EdgeOne 模式在响应结束后异步序列化写入 Blob。

### 模块与能力边界

- **权限单一来源**：角色 × 能力矩阵集中在 `server/src/core/policy.js`（`ROLE` 枚举 + `can(role, capability)`）。路由只声明「需要什么能力」，如 `requireCap('student:delete')`；服务层再用登录态里的 `class_id` 校验数据归属。权限**不是前端藏按钮**，后端强制。
- **超管独立命名空间**：超管接口统一在 `/api/super/*`，与班级业务隔离，且超管自身不带 `class_id`，不能越界改教学数据。
- **公开查询免登录**：家长页面 `/query.html` 走 `/api/public/query/:token`，不受 auth 中间件约束，但受限流与「仅暴露命中学生本人数据」约束。

---

## 核心特性

### 四级角色，边界清晰

| 能力          |      超级管理员     |      班主任     |    老师   |         班干部         |
| ----------- | :------------: | :----------: | :-----: | :-----------------: |
| 定位          | 平台运维：管人、管号、管归属 |    班级第一责任人   |   任课老师  |         学生干部        |
| 学生          |        —       |   增 / 改 / 删  |  增 / 改  |          只读         |
| 加减分         |        —       |    单人 + 批量   | 单人 + 批量 | 单人（单次 ≤5、每日 ≤20，可调） |
| 积分记录        |        —       | 查看 / 删除 / 清空 | 查看 / 导出 |          查看         |
| 排座          |        —       |      全权      |    全权   |          只读         |
| 积分商城        |        —       |   礼物增删 + 兑换  |   仅兑换   |          只读         |
| 成绩          |        —       |   导入 + 删除考试  |    导入   |          —          |
| 班级资料 / 清空数据 |        —       |       ✓      |    ✗    |          ✗          |
| 成员账号        |    任意班级任意角色    |  本班老师 / 班干部  |    ✗    |          ✗          |
| 手机号         |     全量可见可改     |      仅脱敏     |   仅自己   |         仅自己         |

设计要点：

1. **超管不碰业务数据**——只负责建班、建号、改归属、重置密码、看手机号，避免平台方误改教学数据；超管动作全部落 `admin_audit` / `operation_logs`。
2. **删除权只给班主任**——老师能日常操作但删不了学生、清不了数据；所有"清空"先写回收站快照，超管可一键还原。
3. **班干部限额是硬约束**——防止学生互刷分，每次操作在流水里记 `operator_name / operator_role`，谁加的一目了然。

### 班级端

- **学生榜**：排名（前三名金/银/铜）、小组、职务、积分；高→低 / 低→高 / 按时间（本期、本周、本月）；搜索、分页
- **加减分**：单人加分/减分、快捷规则一键填入、原因备注；班干部受额度限制
- **批量加减**：按学生 / 按小组、全选、统一原因
- **学生管理**：新增（含完整档案）、Excel/CSV 批量导入（自动识别「学号/学籍号/编号、出生日期/生日、家庭住址/住址、家长姓名/监护人、家长电话/家长联系方式/家长手机、与学生关系/关系、备用电话、备注」等同义表头，重复自动跳过）、完整档案模板下载、**档案 Excel 导出**（花名册 + 积分快照 + 班级信息三个 Sheet）、编辑（含家长联系方式）、删除、单人历史
- **快捷规则**：规则增删、Excel 导入、模板、恢复默认
- **小组榜**：总积分 / 人均 / 人数，支持按时间
- **积分排座**：可调布局、老师/学生视角、按积分/蛇形/随机、点座换人、整组对调、打印、导出
- **积分商城**：礼物增删、按学生/小组批量兑换、积分校验、库存、兑换记录导出
- **积分记录**：时段筛选、按学生搜索、分页、导出、单条删除（自动反向修正积分）、清空
- **成绩**：Excel 导入、考试切换与删除、学生个人（趋势图 + 学习建议）、小组成绩、班级成绩（均分/及格率/优秀率/分数段）
- **成员管理**：班主任创建账号、重置密码、停用、移除、转移班主任、设置班干部额度

### 超级管理员

- 平台看板：班级数、账号数（按角色拆分）、学生数、积分记录、7 日活跃
- 班级管理：新建班级（同时建班主任）、改名/学校/年级、班干部额度、删除（回收站）、恢复
- 账号管理：全量列表（姓名/角色/账号/手机号/班级/最后登录）、搜索筛选、新建、改姓名/手机号/登录名/状态、**改归属班级**、重置密码、删除
- 角色调整：把某人设为班主任时自动把原班主任降为老师，保证"一班一主"
- 回收站：已删除班级恢复、班级数据快照恢复
- 操作日志：建班/建号/改密/转移/删除/恢复全部可追溯
- **全量操作日志**：全部角色、全部模块（班级业务 / 成员 / 超管 / 登录 / 备份 / 对外查询）的每一步写操作，含操作者、角色、班级、目标、摘要、数量、成功或失败、状态码、IP、UA；编辑类操作记录**变更前后快照与字段级 diff**（点任意一行查看详情）；支持按时间 / 班级 / 角色 / 模块 / 结果 / 关键词筛选，导出 CSV，一键清理 N 天前旧日志
- **数据备份**：班级备份（班级资料 + 成员 + 学生档案 + 积分 + 规则 + 礼物 + 兑换 + 考试成绩 + 座位表）、平台全量备份（全部班级 + 全部账号 + 回收站 + 最近 2 万条日志）；上传 JSON 一键恢复为新班级或覆盖现有班级，失败整体回滚；**备份不含任何密码散列**
- **成绩对外查询**：为班级生成查询口令（可设有效期、可随时停用），家长打开 `/query.html` 输入口令 + 姓名学号即可免登录查看本人成绩、班均、最高分、班排与积分排名；一个口令只能查到命中的一名学生，家长手机号脱敏展示，失败尝试全部记入操作日志；另设**全局总开关**，超管可一键关闭（登录页入口隐藏、公开查询页不可访问），教师端完全不受影响

---

## 界面预览

> 以下截图均使用 `scripts/seed-demo.js` 生成的**虚构数据**（示例学校、化名学生、测试号段手机号），不含任何真实业务信息。同一套响应式 UI，桌面端（1440px）与移动端（390px）分别截图。

### 电脑端

**登录页**

![登录页 · 电脑端](docs/screenshots/desktop/01-login.png)

**积分排行榜**

![积分排行榜 · 电脑端](docs/screenshots/desktop/02-ranking.png)

**加减分操作**

![加减分操作 · 电脑端](docs/screenshots/desktop/03-points.png)

**小组管理**

![小组管理 · 电脑端](docs/screenshots/desktop/04-groups.png)

**积分排座**

![积分排座 · 电脑端](docs/screenshots/desktop/05-seat.png)

**积分商城**

![积分商城 · 电脑端](docs/screenshots/desktop/06-mall.png)

**成绩分析**

![成绩分析 · 电脑端](docs/screenshots/desktop/07-scores.png)

**学生档案**

![学生档案 · 电脑端](docs/screenshots/desktop/08-student-report.png)

**成员管理**

![成员管理 · 电脑端](docs/screenshots/desktop/09-members.png)

**班干部视图**

![班干部视图 · 电脑端](docs/screenshots/desktop/10-cadre-view.png)

**超管 · 班级管理**

![超管-班级管理 · 电脑端](docs/screenshots/desktop/11-super-classes.png)

**超管 · 账号管理**

![超管-账号管理 · 电脑端](docs/screenshots/desktop/12-super-accounts.png)

**超管 · 操作日志**

![超管-操作日志 · 电脑端](docs/screenshots/desktop/13-super-logs.png)

### 手机端

**登录页 ｜ 积分排行榜 ｜ 加减分操作**

| 登录页 | 积分排行榜 | 加减分操作 |
| --- | --- | --- |
| ![登录页 · 手机端](docs/screenshots/mobile/01-login.png) | ![积分排行榜 · 手机端](docs/screenshots/mobile/02-ranking.png) | ![加减分操作 · 手机端](docs/screenshots/mobile/03-points.png) |

**小组管理 ｜ 积分排座 ｜ 积分商城**

| 小组管理 | 积分排座 | 积分商城 |
| --- | --- | --- |
| ![小组管理 · 手机端](docs/screenshots/mobile/04-groups.png) | ![积分排座 · 手机端](docs/screenshots/mobile/05-seat.png) | ![积分商城 · 手机端](docs/screenshots/mobile/06-mall.png) |

**成绩分析 ｜ 学生档案 ｜ 成员管理**

| 成绩分析 | 学生档案 | 成员管理 |
| --- | --- | --- |
| ![成绩分析 · 手机端](docs/screenshots/mobile/07-scores.png) | ![学生档案 · 手机端](docs/screenshots/mobile/08-student-report.png) | ![成员管理 · 手机端](docs/screenshots/mobile/09-members.png) |

**班干部视图 ｜ 超管班级 ｜ 超管账号 ｜ 操作日志**

| 班干部视图 | 超管 · 班级管理 | 超管 · 账号管理 |
| --- | --- | --- |
| ![班干部视图 · 手机端](docs/screenshots/mobile/10-cadre-view.png) | ![超管-班级管理 · 手机端](docs/screenshots/mobile/11-super-classes.png) | ![超管-账号管理 · 手机端](docs/screenshots/mobile/12-super-accounts.png) |

![超管-操作日志 · 手机端](docs/screenshots/mobile/13-super-logs.png)

---

## 快速开始

### 本地运行（自有服务器）

```bash
# 1. 安装依赖（Node.js ≥ 18.17）
npm install

# 2.（可选）从样例复制环境变量
cp .env.example .env

# 3. 启动，默认开发模式，数据落本地 data/banjifen.sqlite
npm start
# 浏览器打开 http://localhost:3000
```

### 一键部署到 EdgeOne Pages（零成本）

1. 在 EdgeOne Pages 控制台「导入 GitHub 仓库」选择 `Yellowsoy/banjifen`；
2. 构建配置：安装 `npm install`、构建 `node scripts/gen-inline.js && node scripts/build-edgeone.js`、输出目录 `deploy/edgeone-dist`、Node 22；
3. 此后每次 `git push` 自动构建上线。完整说明见[部署](#部署)。

### 运行测试

```bash
npm test   # 拉起独立实例，覆盖 74 项集成测试
# 结果：通过 74，失败 0
```

---

## 重要操作方法（速查）

### 学生档案与 Excel 导入导出（班主任）

1. **逐个录入**：首页右侧「新增学生（含档案）」→ 填姓名、学号、出生日期、家长姓名 / 手机号 / 关系、备用电话、住址、备注 → 添加。
2. **批量导入**：「批量导入」→ 选择 Excel/CSV → 导入。表头只要含「姓名」即可，其余列按同义表头自动识别（如「家长联系方式」会自动映射到家长手机号）。
3. **模板**：点「模板」下载 12 列完整档案模板，按列填好后导入。
4. **导出**：点「导出学生档案 Excel」，得到「花名册 + 积分快照 + 班级信息」三个 Sheet 的完整档案。
5. **编辑**：学生榜 → 「编辑」→ 弹窗内可修改全部档案字段（含家长联系方式）。

### 数据备份与恢复（超级管理员 → 数据备份页签）

1. **导出班级备份**：选择班级 → 「导出班级备份」，得到 JSON 文件（含该班全部数据）。
2. **导出平台全量备份**：一键下载所有班级 + 全部账号 + 回收站 + 操作日志。
3. **恢复**：上传备份 JSON（或直接粘贴内容）→ 选「恢复为新班级」或「覆盖现有班级」→ 开始导入。覆盖模式会先二次确认，导入失败整体回滚，不会留下半份数据。
4. ⚠️ **备份文件不包含登录密码**。恢复出的账号需要超管在「全部账号」里重置密码后才能登录。

### 成绩对外查询（超级管理员 → 成绩查询页签）

1. **总开关**：页签顶部「成绩自助查询 · 总开关」，默认**开启**。关闭后：登录页不再显示查询入口、家长公开查询页也无法访问（接口返回「功能已关闭」）；教师端与班级工作台完全不受影响，已生成的口令原样保留，重新开启即恢复。
2. 选择班级、填写用途备注、选查询范围（仅成绩 / 仅积分 / 成绩+积分）与校验方式（姓名+学号 / 姓名+家长手机后 4 位 / 仅姓名）、有效期 → 「生成口令」。
3. 弹窗里复制**查询入口链接**（`https://你的域名/query.html?token=口令`）发给家长。
4. 家长打开链接，输入学生姓名 + 学号（或手机尾号）即可看到本人成绩、班排、班均、积分与排名，全程免登录。
5. 口令可随时「停用 / 启用 / 删除」，停用后家长的链接立即失效；前提是学生档案里已填学号（或家长手机号）。
6. 建议校验方式选「姓名 + 学号」，防同班同名误查；每次查询（含失败尝试）都会记入操作日志。

### 全量操作日志（超级管理员 → 操作日志页签）

- 按时间（今天 / 近 7 天 / 近 30 天 / 全部）+ 班级 + 角色 + 模块 + 成败 + 关键词任意组合筛选；
- 点击任意一行查看详情：操作者、IP、UA、请求明细，编辑类操作还有**变更前后快照与字段级对比**（旧值划线 → 新值加粗）；
- 「导出 CSV」导出当前筛选结果（最多 1 万条）；「清理旧日志」按天数删除并需确认，清理动作本身也会被记录。

---

## 技术栈

| 层      | 选型                                         | 说明                                                                |
| ------ | ------------------------------------------ | ----------------------------------------------------------------- |
| 运行时    | Node.js 18.17+                             | 无构建步骤（前端），后端单进程即可跑                                                |
| Web 框架 | Express 5                                  | 分层：routes → controller → service → repository                     |
| 数据库    | SQLite（[sql.js](https://sql.js.org/) WASM） | 纯 JS WebAssembly 实现，无需编译原生模块，Windows/macOS/Linux 一致；整库载入内存、写后原子落盘 |
| 持久化驱动  | 本地文件 / EdgeOne Pages Blob                  | `EO_PERSIST=blob` 时切换为云端对象存储快照                                    |
| 鉴权     | JWT + 服务端刷新令牌                              | httpOnly Cookie，刷新即轮换，前端拿不到令牌                                     |
| 校验     | Zod                                        | 所有入参在边界处收敛                                                        |
| 前端     | 原生 ES Module + 手写 CSS                      | 无框架、无打包器，`public/` 直接托管                                           |
| 导出     | SheetJS（xlsx）                              | 花名册/成绩导入，CSV 导出带 BOM                                              |
| 云函数    | EdgeOne Pages Functions                    | `/api/*` 路由到 `cloud-functions/api/[[default]].js`                 |

---

## 目录结构

```
.
├─ server/
│  ├─ src/
│  │  ├─ index.js              # 启动：初始化 DB → 种子 → 监听 → 优雅停机
│  │  ├─ app.js                # 安全头、请求上下文、路由、错误处理、健康/预热端点
│  │  ├─ config.js             # 环境变量集中校验（缺失/非法即启动失败）
│  │  ├─ seed.js               # 种子：超管 + 演示班级 + 三种角色账号
│  │  ├─ edge-env.js           # 云函数环境标记（强制 EO_PERSIST=blob）
│  │  ├─ edge-entry.js         # 云函数入口：gate 引导 + 多实例同步 + 异步持久化
│  │  ├─ core/
│  │  │  ├─ policy.js          # ★ 权限单一来源：角色 × 能力矩阵
│  │  │  ├─ errors.js          # 类型化错误体系
│  │  │  ├─ logger.js          # 结构化 JSON 日志（敏感字段脱敏）
│  │  │  ├─ security.js        # bcrypt / JWT / Cookie / 随机令牌
│  │  │  ├─ validation.js      # zod schema 集合
│  │  │  ├─ excel.js           # xlsx 读写、CSV(BOM)、表头容错
│  │  │  ├─ audit.js           # 审计写入（operation_logs，含 before/after 快照）
│  │  │  ├─ backup.js          # 班级/平台备份导出与导入恢复
│  │  │  ├─ query.js           # 成绩对外查询（口令校验、手机号脱敏、总开关门禁）
│  │  │  └─ settings.js        # 平台设置键值读写（如 public_query_enabled）
│  │  ├─ db/
│  │  │  ├─ index.js           # sql.js 连接、事务、原子落盘、迁移、Blob 快照
│  │  │  ├─ migrations/001_init.sql      # 核心表（班级/账号/学生/积分/成绩…）
│  │  │  ├─ migrations/002_features.sql  # 学生档案 / 全量日志 / 查询口令
│  │  │  ├─ migrations/003_settings.sql  # 平台设置键值表
│  │  │  ├─ migrations.generated.js      # ← gen-inline.js 生成（内联迁移）
│  │  │  ├─ sql-wasm.b64.js              # ← gen-inline.js 生成（内联 wasm，0.87MB base64）
│  │  │  └─ sql-wasm-loader.js          # ← gen-inline.js 生成（内联 sql.js loader，46KB）
│  │  ├─ middleware/           # context · auth · error · rateLimit · audit-trail
│  │  └─ modules/
│  │     ├─ auth/              # 双入口登录、刷新、登出、改密
│  │     ├─ class/             # 学生、积分、规则、商城、排座、成绩
│  │     ├─ members/           # 班主任管理本班成员
│  │     ├─ super/             # 超管：班级、账号、归属、回收站、日志、备份、查询
│  │     └─ public/            # 公开配置、健康检查、免登录成绩查询
│  └─ test/smoke.test.js       # 74 项集成测试
├─ public/
│  ├─ index.html               # 班级工作台 + 超级管理员（同页双屏，按角色切换）
│  ├─ login.html               # 独立登录页
│  ├─ settings.html            # 独立设置页
│  ├─ query.html               # 家长免登录成绩查询页
│  ├─ favicon.svg              # ★ 站点图标（四页共用，避免浏览器默认图标缺失）
│  ├─ css/design-system.css    # 设计系统 v2（4pt 间距 + 统一列模板 + 响应式）
│  └─ js/                      # api · ui · store · app · class-* · members · super-app · query · settings
├─ cloud-functions/api/[[default]].js   # EdgeOne 云函数入口：/api/* → Express
├─ .github/workflows/warmup.yml  # ★ 定时预热（每小时 ping /api/cron/warmup，规避 EdgeOne cron 最小间隔 1 天的限制）
├─ scripts/
│  ├─ gen-inline.js            # 内联迁移 SQL、sql.js wasm 与 loader（云函数必需）
│  ├─ build-edgeone.js         # 生成 deploy/edgeone-dist 部署产物
│  └─ seed-demo.js             # 虚构演示数据（README 截图来源）
├─ deploy/                     # 安装脚本、DNS 配置
├─ docs/screenshots/           # 界面截图（虚构数据）：desktop/ 电脑端 13 张 + mobile/ 手机端 13 张
├─ data/                       # 运行后生成（SQLite + uploads），已 gitignore
├─ .env.example                # 环境变量样例
├─ LICENSE                     # ★ Apache License 2.0 全文
├─ NOTICE                      # ★ 第三方组件声明（sql.js MIT 等）
└─ package.json
```

---

## 后端服务与数据库说明

### 启动流程

```
server/src/index.js → main()
  1. 读取并校验配置（config.js 失败即退出，fail fast）
  2. db.init()：加载/创建 SQLite 内存库 → 执行迁移 → 结构自检
  3. runSeed()：首次启动写入种子账号与演示班级（已存在则跳过）
  4. createApp()：装配中间件与路由
  5. app.listen(port)：启动 HTTP，注册 SIGINT/SIGTERM 优雅停机（先 flush 再关库）
```

- 本地/自有服务器：`npm start` 直接启动 `server/src/index.js`，数据落本地文件。
- EdgeOne 云函数：平台先加载 `cloud-functions/api/[[default]].js`，其第一个 import 是 `server/src/edge-env.js`（强制把 `EO_PERSIST` 设为 `blob`、`NODE_ENV` 设为 `production`），随后 `edge-entry.js` 的 `createEdgeApp()` 在首个请求（`gate` 中间件）里异步完成数据库引导，并把响应结束后的持久化挂在 `res.on('finish')` 上，避免阻塞响应。

### 数据访问层（DAL）

`server/src/db/index.js` 是所有 SQL 的唯一出入口：

- **参数化查询**：对外只暴露 `all / get / run / exec / count`，全部使用 `stmt.bind(params)`，杜绝 SQL 注入。
- **事务**：`transaction(fn)` 支持嵌套（内层复用外层事务），`BEGIN IMMEDIATE` 开头、成功 `COMMIT`、异常 `ROLLBACK`，保证多步写入要么全成要么全回滚（如「加积分」= 插入流水 + 更新学生积分）。
- **内存库 + 原子落盘**：sql.js 是「内存数据库」，所有读写在内存完成。`run/exec` 会标记 `dirty`，本地模式 **60ms 防抖**后把整库字节 `export()`，先写 `.tmp` 再 `rename` 原子替换 `data/banjifen.sqlite`，避免半份文件。
- **自检与迁移**：`applyMigrations()` 读取 `schema_migrations` 表，按文件名排序补齐未执行的迁移；`assertSchema()` 拦截 v1（无 `class_id/role`）旧数据文件，避免以错误结构运行。

### 迁移机制

- 迁移源文件位于 `server/src/db/migrations/*.sql`，编号递增：`001_init.sql`（核心表）、`002_features.sql`（学生档案 / 操作日志 / 查询口令）、`003_settings.sql`（平台设置）。
- 迁移**只做加法**（新增列 / 新表，带 `IF NOT EXISTS` / `ADD COLUMN`），可安全重复执行，不会破坏已有数据。
- 构建 EdgeOne 产物时，`scripts/gen-inline.js` 会把全部 `.sql` **内联**成 `server/src/db/migrations.generated.js`，
  再把 sql.js 的 wasm 二进制 base64 内联成 `server/src/db/sql-wasm.b64.js`、把 loader 内联成 `server/src/db/sql-wasm-loader.js`
  ——因为云函数环境读不到 `node_modules` 里的物理文件。**内联 loader 后生产依赖中不再需要 `sql.js` 整个包（省约 30MB）**。
  因此**改完迁移 SQL 后必须重跑 `npm run build:edgeone`** 才能让线上生效。

---

## API

统一前缀 `/api`；写操作需带 `x-requested-with: fetch`（CSRF 防护）；错误统一返回 `{ error: { code, message }, requestId }`。

| 分组 | 端点 |
| --- | --- |
| 认证 `/api/auth` | `POST /login`（`entry: class\|super`）、`POST /refresh`、`POST /logout`、`GET /me`、`POST /password` |
| 班级资料 `/api/class` | `GET /overview`、`PUT /profile`、`GET /groups` |
| 学生与档案 | `GET\|POST /students`、`PATCH\|DELETE /students/:id`、`GET /students/template`、`GET /students/export.xlsx`、`POST /students/import`、`DELETE /students/:id/logs` |
| 积分 | `POST /points`、`GET\|DELETE /logs`、`DELETE /logs/:id`、`GET /logs/export.csv`、`GET /ranking/export.csv`、`POST /reset-points`、`POST /clear-all` |
| 快捷规则 | `GET\|POST /rules`、`DELETE /rules/:id`、`POST /rules/reset`、`POST /rules/import`、`GET /rules/template` |
| 积分商城 | `GET\|POST /gifts`、`PATCH\|DELETE /gifts/:id`、`POST /gifts/:id/redeem`、`GET /redemptions`、`GET /redemptions/export.csv` |
| 排座 | `GET\|PUT /seat`、`POST /seat/auto` |
| 成绩 | `GET /exams`、`POST /exams/import`、`DELETE /exams/:id`、`GET /exams/template`、`GET /scores`、`GET /scores/student/:id` |
| 成员 `/api/members` | `GET\|POST /`、`PATCH\|DELETE /:id`、`POST /transfer-owner`、`PATCH /settings/limits` |
| 超管 `/api/super` | `GET /overview`、`GET\|POST /classes`、`PATCH\|DELETE /classes/:id`、`POST /classes/:id/restore`、`POST /classes/:id/transfer-owner`、`GET /classes/export.csv`、`GET /classes/deleted/list`、`GET\|POST /accounts`、`PATCH\|DELETE /accounts/:id`、`POST /accounts/:id/reset-password`、`GET /recycle`、`POST /recycle/:id/restore`、`GET /audit` |
| 全量操作日志 | `GET /super/logs`（时间/班级/角色/模块/结果/关键词筛选）、`GET /super/logs/export.csv`、`POST /super/logs/clear` |
| 数据备份 | `GET /super/backup/class/:id`、`GET /super/backup/platform`、`POST /super/backup/import`（multipart `file` 或 `text`，`mode=create\|replace`） |
| 对外查询口令 | `GET\|POST /super/query-tokens`、`PATCH\|DELETE /super/query-tokens/:id`（启停 / 删除） |
| 平台设置 | `GET\|POST /super/settings/public-query`（成绩自助查询总开关，默认开启） |
| 公开接口 | `GET /public/settings`、`GET /public/health`、`GET\|POST /public/query/:token`（免登录，限流 60 次/分） |
| 运维与健康 | `GET /health`（存活）、`GET /ready`、`GET /api/ready`（就绪）、`GET /api/cron/warmup`（**预热端点**，由定时触发器周期调用） |

---

## 存储位置与访问方式

### 本地 / 自有服务器（fs 模式）

| 内容              | 路径 / 位置                                                   | 访问方式                                                            |
| --------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| 主数据库（SQLite 文件） | `data/banjifen.sqlite`（相对仓库根，受 `DB_FILE` 控制）              | 由后端 sql.js 载入内存，写后原子落盘；可用 `sqlite3 data/banjifen.sqlite` 直接打开查看 |
| 临时落盘文件          | `data/banjifen.sqlite.tmp`（写入瞬间存在，随即 rename）              | 自动生成/删除，无需关注                                                    |
| 上传临时目录          | `data/uploads/`（受 `UPLOAD_DIR` 控制，备份导入文件暂存）               | 由 `multer` 写入，经 `/uploads` 静态路由按 7 天缓存对外提供                      |
| 备份导出文件          | 用户浏览器下载（内存生成 JSON，不落服务器）                                  | 教师/超管在前端点「导出」直接下载                                               |
| 配置文件            | `.env`（从 `.env.example` 复制）                               | 服务端读取，`gitignore` 忽略，绝不入仓                                       |
| 内联构建产物          | `server/src/db/migrations.generated.js`、`sql-wasm.b64.js`、`sql-wasm-loader.js` | 由 `gen-inline.js` 生成，提交进仓库供云函数打包                                |


> `data/` 下所有内容（`.sqlite`、`.sqlite.tmp`、`uploads/`）均已被 `.gitignore` 忽略，**不会进入 GitHub 仓库**，避免泄露真实业务数据。

### EdgeOne Pages（blob 模式，线上）

`EO_PERSIST=blob` 时，本地文件系统只读，**整库作为快照写入 EdgeOne Pages Blob 对象存储**（强一致读 `consistency: 'strong'`）：

| 内容 | Blob Key | 说明 |
| --- | --- | --- |
| 数据库快照 | `bj/db/snapshot` | 整库 SQLite 字节流，每次写后更新 |
| 快照版本号 / 时间 | `bj/db/meta`（`{ v, at }`） | 多实例据此判断谁更新，避免读到陈旧数据 |
| JWT 签名密钥 | `bj/config/jwt-secret` | 冷启动/多实例间共享同一把密钥，保证令牌可跨实例验证（首次随机生成并落盘） |

访问方式：

- 数据库本身**不对外暴露**，只能通过 `/api/*` 接口经鉴权后读写；
- 多实例同步：每个请求进入时（`gate` 中间件）最多每 2 秒检查一次远端 `meta.v`，若比本地新则拉取最新快照（`refreshIfRemoteNewer`）；写操作在响应结束后经 `persistIfDirty()` **串行化**写入，避免并发覆盖。
- 极端并发下为「**最后写入胜出（last-write-wins）**」，低并发（单个班级日常使用）完全足够；见[注意事项](#注意事项与常见问题)。

---

## 数据结构说明

> 主键均为 `TEXT`（业务自生成 `前缀_随机hex`）；时间统一存毫秒时间戳 `INTEGER`；软删除用 `deleted_at` 标记（非物理删除）。下划线字段为后加迁移列，可安全兼容旧库。

### 核心表

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `classes` | `id, name, school, grade, badge, owner_id, cadre_limit_per, cadre_limit_day, created_at, deleted_at, deleted_reason` | 班级 = 独立数据空间（学生/积分/商城/成绩/排座都按 `class_id` 隔离）。`owner_id` 指向班主任账号 |
| `accounts` | `id, type(super_admin\|class), role(super_admin\|owner\|teacher\|cadre), class_id, username(UNIQUE), phone, name, pwd_hash, status(active\|disabled), created_at, last_login_at, note, deleted_at, deleted_reason` | 账号表。超管 `class_id` 为空；`username` 唯一用于登录 |
| `auth_sessions` | `id, account_id, token_hash(UNIQUE), role, class_id, created_at, expires_at, revoked_at, user_agent` | 刷新令牌服务端存储（只存 SHA-256 哈希），支持轮换与吊销 |
| `students` | `id, class_id, name, group_name, sex, position, points, created_at, deleted_at` + `student_no, birthday, address, guardian_name, guardian_phone, guardian_relation, guardian_alt_phone, note` | 学生主表 + 档案扩展（家长联系方式等）。`points` 为当前累计积分 |
| `point_logs` | `id, class_id, student_id, student_name, delta, reason, kind(manual\|batch\|redeem\|reset\|import), operator_id, operator_name, operator_role, created_at` | 积分流水。`operator_*` 记录「谁加的」，班干部操作可追溯 |
| `quick_rules` | `id, class_id, name, score, sort_no, created_at` | 快捷加减分规则 |
| `gifts` | `id, class_id, name, cost, icon, stock, created_at, deleted_at` | 积分商城礼物，`stock` 可空（不限库存） |
| `redemptions` | `id, class_id, gift_id, gift_name, cost, student_id, student_name, created_at` | 兑换记录 |
| `exams` | `id, class_id, name, full_score, created_at, deleted_at` | 考试 |
| `scores` | `id, class_id, exam_id, student_id, score, created_at`（`UNIQUE(exam_id, student_id)`） | 成绩明细 |
| `seat_plans` | `class_id(PK), cols, rows, scheme, seats(JSON), angle, confirmed_at, updated_at` | 排座方案，`seats` 为座位布局 JSON |
| `recycle` | `id, class_id, kind, title, payload(JSON), operator_id, created_at, restored_at` | 清空/删除前的数据快照，超管可恢复 |

### 审计 / 配置 / 查询表

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `admin_audit` | `id, actor_id, actor_name, action, target_type, target_id, detail, created_at` | 超管操作审计（旧表，与 `operation_logs` 双写） |
| `operation_logs` | `id, created_at, actor_id, actor_name, actor_role, class_id, class_name, module, action, target_type, target_id, target_name, summary, amount, result(success\|failed), status_code, detail(JSON), ip, user_agent` | **全量操作日志**：覆盖全部角色/模块。`detail` 含请求参数与编辑类 before/after 快照；`module` ∈ auth/class/members/super/backup/query |
| `query_tokens` | `id, class_id, token(UNIQUE), name, scope(scores\|points\|all), mode(name_no\|phone\|none), enabled, expires_at, created_by, created_at, last_used_at` | 对外查询口令。`expires_at` 为空表示长期有效；`enabled=0` 即停用 |
| `platform_settings` | `key(PK), value, updated_at, updated_by` | 全局键值配置，如 `public_query_enabled`（成绩自助查询总开关，缺省开启） |
| `schema_migrations` | `name(PK), applied_at` | 内部迁移记录表，记录已执行的迁移文件名 |

**访问约束**：所有业务查询以 `class_id` 为边界（来自登录态，不接受前端传入）；越权访问统一 403/404。超管接口独立命名空间 `/api/super`，不经过班级的 `class_id` 校验。

---

## 界面规范（视觉对齐）

设计系统写在 `public/css/design-system.css`，四条硬规则：

1. **间距只用 4pt 刻度**（4/8/12/16/24/32/48），不出现一次性数值；卡片内边距统一 `--pad-card`，页面左右统一 `--gutter`。
2. **表格共用一套列模板**：`--cols-student / --cols-group / --cols-score` 同时作用于表头与数据行，保证纵向严格同列；只在断点处重定义，不在行内微调。
3. **数字右对齐 + `tabular-nums`**：积分、人数、均分、日期一律等宽数字并右对齐；文本左对齐。
4. **层级靠有限刻度**：圆角 8/12/16/20，阴影 3 档，z-index 语义化（sticky → dropdown → backdrop → modal → toast）。

配套的克制原则：操作按钮描边不实心（只有加减分出色）、空状态一句话、卡片不嵌套、图标统一线性 SVG（不依赖 emoji 字体）。

---

## 成绩「学习建议」是怎么算的

不是调用大模型，而是可复现的规则算法（`server/src/modules/class/class.service.js` → `studentScoreDetail()`）：

```js
const avg   = 历次平均分;             // 水平判断
const delta = 最近一次 - 最早一次;     // 趋势判断
```

1. **水平**：`≥85` 班级前列 / `70–85` 中等偏上 / `<70` 基础需加强
2. **趋势**：`Δ ≥ +5` 上升 / `Δ ≤ -5` 下滑 / 其余平稳
3. **建议模板**按水平三选一（保持节奏挑战拓展 / 专项练习 + 错题归类 / 基础题 + 每日一练 + 家长配合）
4. 拼接：`平均分 X 分，{水平}；最近一次 Y 分，{趋势}（较首次 ±Z 分）。{建议}`

结果稳定、可解释、离线零成本；想换成 AI 评语只需替换这一处，接口结构 `{ trend, advice }` 不变。

---

## 测试

```bash
npm test
```

拉起独立实例（临时数据库 + 独立端口），覆盖 74 项集成测试：

- 三角色 + 超管登录与能力清单
- 权限边界：班干部额度/批量/删除/清空 403，老师不能删除与清空
- 学生与花名册导入、加减分与流水回滚、CSV 导出
- 商城兑换（积分不足校验）、排座、成绩三视图与学习建议
- 成员管理：建号、改密、停用、转移班主任、额度调整
- 超管：建班、建号、改密、改手机号、改归属、"一班一主"、删除恢复、快照恢复、审计、导出
- **学生档案**：档案写入/编辑、电话校验、档案 Excel 导出
- **审计 / 备份 / 对外查询**：操作日志落库与筛选、CSV 导出、失败记录、日志清理；班级与平台备份导出（不含密码）、导入恢复、非法备份拒绝；查询口令生成、免登录查询与号码脱敏、学号不匹配拒绝、停用即失效；查询总开关读写闭环
- 安全：CSRF、422、越权 404、登出失效、刷新令牌

```
结果：通过 74，失败 0
```

---

## 部署

### 方式一：EdgeOne Pages（零成本，推荐）

无需服务器、无需证书运维，静态前端 + Node 云函数 + Blob 数据存储全部由 EdgeOne 免费套餐承载：

1. **GitHub 直连**（推荐）：在 EdgeOne Pages 控制台导入 `Yellowsoy/banjifen` 仓库，构建配置：
   - 安装命令 `npm install`
   - 构建命令 `node scripts/gen-inline.js && node scripts/build-edgeone.js`
   - 输出目录 `deploy/edgeone-dist`，Node 22
   - 之后每次 `git push` 自动构建上线。
2. **CLI 直传**：`EDGEONE_TOKEN=<Pages API Token> npm run deploy:edgeone`
3. **自定义域名**：控制台绑定域名后，在域名 DNS 处加 CNAME 到 EdgeOne 分配的目标（形如 `<域名>.pages.dnsoe6.com`），按提示加 `_dnsauth` 验证记录，免费证书自动签发（约几分钟到半小时）。
4. **首次部署后立即改密**（重要）：种子账号的默认密码写在 `.env.example` 里（`admin/admin123456`、`123456/123456`），
   本仓库为公开仓库、这些默认值人人可见。首次部署成功后**立刻**在「账号管理」中修改超级管理员密码，
   并停用不需要的演示账号（线上环境亦可在 `SUPER_USERNAME` / `SUPER_PASSWORD` 环境变量中指定自定义初始密码）。

架构说明：云函数把 `/api/*` 交给 `cloud-functions/api/[[default]].js`（打包后的 Express 应用），数据整库快照持久化在 Pages Blob（强一致读 + 每次写后落盘 + 多实例版本同步），wasm 与迁移 SQL 已内联进构建产物，无需本地文件系统。

**冷启动与性能（自动生效，无需控制台操作）**：

本仓库**不包含 `edgeone.json`**。原因：该文件一旦存在于仓库根目录，平台会以文件内容**覆盖**控制台里的项目配置，
曾导致 `/api/*` 的函数路由被接管而全部回退成静态首页（接口 200 但返回 HTML）。为了避免这一类"配置文件覆盖控制台"的坑，
所有需要的功能一律用**代码 + GitHub Actions**实现，不依赖平台配置文件：

| 目标 | 实现方式 | 生效方式 |
| --- | --- | --- |
| 冷启动预热（防 500/502） | `.github/workflows/warmup.yml` 每小时 ping 一次 `/api/cron/warmup` | 推送到 `main` 后 GitHub 自动调度 |
| 单次执行时限 | 默认 30s 足够（引导耗时 < 1s），无需调高 | — |
| 前端首屏提速 | `/public/settings` 与 `/auth/me` 并行请求；各业务模块按需 `import()` | 随代码发布 |
| 云函数包体积 | `sql.js`（30MB）改为内联 loader（46KB）+ 内联 wasm（0.87MB base64） | 随代码发布 |

> **为什么预热用 GitHub Actions 而不是平台定时器**：EdgeOne Pages 的 `schedules`（即 `edgeone.json` 里的 cron）
> 官方限制为「**最小精度 1 分钟、最小间隔 1 天**」，无法做 5 分钟级保活；且引入该文件会连带覆盖控制台路由。
> GitHub Actions 的定时任务可做到分钟级，且与平台配置完全隔离，因此是更安全的选择。
>
> **预热是免费的吗？** 是。详见[免费架构与成本](#免费架构与成本永久-0)。

### 方式二：自有服务器

```bash
# 1. 常驻
npm i -g pm2
pm2 start server/src/index.js --name banjifen
pm2 save

# 2. Nginx 反代（示例）
server {
  listen 443 ssl http2;
  server_name your.domain.com;
  client_max_body_size 8m;

  ssl_certificate     /etc/letsencrypt/live/your.domain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/your.domain.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

生产清单：`NODE_ENV=production`、强随机 `JWT_SECRET`（≥32 字符）、HTTPS（Cookie 自动加 `secure` 并启用 HSTS）、定期备份 `data/banjifen.sqlite`；`AUTH_LOGIN_RATE_MAX` 可按需调整登录限流阈值。

> SQLite 以 sql.js 载入内存、写入后原子落盘，单校规模（万级学生、十万级流水）足够。若要多实例横向扩展，把 `server/src/db/index.js` 换成 PostgreSQL 驱动即可，上层仓储调用方式不变。

---

## 免费架构与成本（永久 $0）

### 结论先说

本项目**整套架构零成本**：静态前端 + Node 云函数 + Blob 存储全部跑在 EdgeOne Pages **免费版**，平台官方明确「免费版本将永久提供」，$0/月，无需绑卡、无需自购服务器。

### EdgeOne Pages 免费版额度对照

| 项目 | 免费额度 | 本项目实际用量 |
| --- | --- | --- |
| 安全加速流量 | 不限 | 极低 |
| 安全加速请求数 | 不限 | 极低 |
| Cloud Functions 请求数 | 1,000,000 / 月 | 单校日常 < 1 万 / 月（含预热 720 次） |
| Cloud Functions GBs | 500,000 / 月 | 远低于额度 |
| Edge Functions 请求数 | 3,000,000 / 月 | 本项目未使用 Edge Functions |
| Edge Functions CPU 时间 | 3,000,000 / 月 | 同上 |
| KV / Blob 存储 | 1 GB | 整库快照 < 1 MB |
| 构建次数 | 500 / 月 | 仅每次 `git push` 触发 1 次 |
| GitHub Actions | **公开仓库：完全免费、不限量**（标准 runner） | 预热约 720 次 / 月（约 720 分钟）；Public 下不计入任何限额 |

> 官方定价 FAQ 明确：免费版**长期提供**；在推出收费版之前，即使超出免费额度也不会中断服务（仍会监控异常流量与滥用行为）。因此正常业务使用不存在"突然被收费"的风险。

### 预热（解决冷启动 500/502）——是免费的吗？

**免费。** 预热本质只是周期性调用你自己的函数接口，消耗的是上面免费额度里的「Cloud Functions 请求数」，
**不需要购买任何额外资源包，也没有单独计费项或单独限额**。

本项目用 `.github/workflows/warmup.yml`（GitHub Actions 定时任务）实现，每小时 `GET /api/cron/warmup` 一次：

```yaml
on:
  schedule:
    - cron: '7 * * * *'      # 每小时第 7 分
  workflow_dispatch:          # 可手动触发
```

- **为什么不用平台自带的 `schedules`**：EdgeOne Pages 的 `edgeone.json` → `schedules` 官方限制为
  「cron **最小精度 1 分钟、最小间隔 1 天**」，做不了 5 分钟级保活；更关键的是，
  `edgeone.json` 存在于仓库根目录会**覆盖控制台的项目配置**，实测导致 `/api/*` 的函数路由被接管、
  全部回退成静态首页。因此本项目刻意**不放**这个文件，改用与平台配置完全隔离的 GitHub Actions。
- **成本核算（两处都远在免费额度内）**：
  - **EdgeOne**：每小时一次 = 720 次 / 月，占 1,000,000 免费请求的 **0.072%**；叠加真实业务（单校 < 1 万次 / 月）
    合计仍 **< 1.1%**，可忽略。
  - **GitHub Actions**：本仓库为 **Public**，标准 runner 对公开仓库**完全免费、不限量**，不存在分钟数额度。
    即便将来转回 Private：每次运行约 10~20 秒，按「分钟」向上取整计 ≈ 1 分钟，
    720 次 / 月 = **720 分钟**，在 Free 计划的 2,000 分钟 / 月内仅占 **36%**，余量充足。
- **为什么是每小时而不是更频繁**：
  1. 平台实例回收窗口远小于 1 小时，实测冷启动预热后 **978ms**、热实例 **712ms**，
     60 分钟一次的保活频率对用户体验**无任何差别**；
  2. 留足额度余量，仓库即便因故回到 Private 状态，预热也不会因超限被静默停掉（见下方「超额行为」）。
- **无副作用**：该端点只返回 `{ ok: true, warmed: true, time }`，不写业务数据、不产生操作日志噪音、不占用 Blob 存储。

> 客观说明：预热只能降低冷启动**发生频率**，无法阻止平台回收闲置实例。但配合下面「冷启动耗时本身已被压到 < 1s」，
> "冷启动期间超时被判定失败"这一具体故障模式已基本消除。

### 超额会发生什么（两套机制完全不同）

| | EdgeOne Pages 免费版 | GitHub Actions |
| --- | --- | --- |
| 额度性质 | **软限制**：超量仍服务，仅监控异常流量与滥用 | **硬墙**：私有仓库配额耗尽后作业**根本不启动** |
| 超额表现 | 站点功能完整，不中断；滥用可能被限流 | run 状态为 `blocked`（非 `error`），提示 *"your spending limit needs to be increased"* |
| 无付款方式 | 照常服务，**不产生任何费用** | 停止运行，**不产生任何费用**，等下个计费周期重置 |
| 有付款方式 | 仍服务（当前阶段不收费） | ⚠️ **自动按费率扣费**（Linux runner 约 $0.008 / 分钟） |
| 公开仓库 | 同上 | ✅ **完全免费、不限量**，此风险不存在 |

官方口径（EdgeOne 定价 FAQ）：

> 在推出收费版之前，即使超出免费版的用量限制也不会中断服务。我们会监控异常流量和滥用行为，
> 正常业务使用不受影响，收费版推出后将提供更高配额选择。

官方口径（GitHub Actions 计费文档）：

> 如果你的帐户未添加有效的付款方式，则配额用尽后将无法继续使用服务。

> ⚠️ **最需要防范的组合**：账户已绑定付款方式 + 未设置 spending limit → 超限会**静默扣费**。
> 若仓库内还有其它 workflow（CI/CD、测试），叠加后金额不可控。

### 零成本保障（三道防线，缺一不可）

本项目采用「**架构层消除 + 频率层留余量 + 账单层硬保险**」三层策略，确保**永久 $0**：

| 层 | 措施 | 作用 |
| --- | --- | --- |
| 架构层 | 仓库设为 **Public** | Actions 对公开仓库标准 runner 完全免费、不限量，2,000 分钟瓶颈直接消失 |
| 频率层 | cron 降为 **每小时一次**（720 分钟 / 月） | 即使转回 Private 也仅占 36%，不会触顶 |
| 账单层 | **Budget = $0 + 开启 "Stop usage when budget limit is reached"** | 即使误绑付款方式，账单金额也永远为 $0，只会停跑 |

**账单层需手动配置一次**（GitHub 未开放对应 API），路径：

```
仓库 → Settings → Billing and licensing → Usage limits → Budgets and alerts
  1. New budget → Budget name 填 "banjifen-zero-cost"
  2. Budget amount 填 0
  3. 勾选 "Stop usage when budget limit is reached"   ← 关键项，缺它则只是告警不拦截
  4. Notification thresholds 保持 75% / 90% / 100%
```

配置后，无论仓库可见性如何变化、workflow 如何增加，**都不可能产生任何费用**。

### 冷启动与加载速度：做了什么优化

| 优化项 | 做法 | 效果 |
| --- | --- | --- |
| 云函数包体积 | `sql.js`（30MB）改为把 loader（46KB）与 wasm（0.87MB base64）内联进仓库，生产依赖中移除 `sql.js` | 代码包 53MB → 23MB，冷启动解压与模块加载显著加快 |
| wasm 初始化 | 复用内联二进制，实测 `initSqlJs` 编译耗时约 5ms | 引导阶段无额外等待 |
| Blob 读取 | `meta` 与 `snapshot` 两个读**并行**发起（原为串行） | 少一个网络往返 |
| 多实例版本同步 | 增加 2 秒 TTL 缓存，避免每个请求都打一次 Blob | 低频接口显著变快 |
| 引导流程 | 数据库初始化与 JWT 密钥准备**并行**执行 | 少一个串行等待 |
| Excel 解析 | `xlsx`（7MB）改为首次使用时才 `require` | 冷启动少加载约 60ms 与 7MB 内存 |
| 前端首屏 | `/public/settings` 与 `/auth/me` **并行**请求 | 少一个 RTT（含云函数冷启动） |
| 前端异常兜底 | 接口返回非 JSON（如 SPA 回退）时直接判失败，不再误判"已登录" | 消除登录页 ↔ 首页的**无限跳转循环**（曾导致 8 秒内 24 次无效请求） |

> 最后一条尤其重要：线上曾因 `/api/*` 回退成静态 HTML 而触发登录页与首页互相跳转的死循环，
> 既让用户觉得"资源加载很久"，又在持续消耗 Cloud Functions 免费额度。现已在前后端两侧都加了防护。

### 成本为零的其它关键点

- **无第三方云服务**：不依赖对象存储、数据库、中间件、CDN、短信/邮件服务；
- **无外部字体/图标 CDN**：图标全部为内联 SVG，favicon 为自托管 SVG，第三方流量为 0；
- **前端零构建**：原生 ES Module，无打包器、无框架运行时；
- **后端无原生模块**：`sql.js` 是 WebAssembly 版 SQLite，`npm install` 无需编译工具链，Windows / macOS / Linux 一致；
- **单文件数据库**：整库一个 SQLite 文件，本地 `data/banjifen.sqlite`，线上为 Blob 快照，备份 = 复制文件；
- **域名免费证书**：EdgeOne 自定义域名自动签发免费证书，无证书续费成本；
- **不引入 `edgeone.json`**：避免平台配置文件覆盖控制台配置导致路由被接管。

### 将来若要扩容（仍可保持低成本）

- **数据变多**：Blob 快照随使用增长，超过 1 GB 免费额度前，用超管后台「清理旧日志」定期清理 `operation_logs` 即可；
- **请求变多**：单校 1M 次 / 月绰绰有余；确有需要再考虑商业版，或把 `server/src/db/index.js` 换成 PostgreSQL 驱动 + 自有服务器（上层仓储调用方式不变）；
- **多实例并发**：EdgeOne Blob 为「读己之写 + 版本同步」，极端并发是最后写入胜出；高并发场景建议迁移到自有服务器单进程独占。

---

## 注意事项与常见问题

### 数据安全与备份

- ⚠️ **备份文件不含密码**：无论班级备份还是平台全量备份，JSON 里都不含 `pwd_hash`。恢复后的账号处于「密码未设置」状态，必须由超管在「全部账号」里**重置密码**才能登录。这是刻意为之，避免密码随备份文件扩散。
- ⚠️ **本地部署务必定期备份 `data/banjifen.sqlite`**：这是唯一数据源。SQLite 以「整库文件」形式落盘，做整库拷贝即可（建议在低峰期、或停服后拷贝）。
- ⚠️ **不要直接手改数据库**：所有写操作都应通过界面/接口，绕过后端直接改库会绕过权限、审计与事务，且可能与内存态不一致。

### 部署与运行

- ⚠️ **改完迁移 SQL 必须重跑构建**：线上（EdgeOne）用的迁移是 `migrations.generated.js` 的内联副本。改了 `migrations/*.sql` 后，本地要 `npm run build:edgeone` 重新生成，否则线上结构不会变。
- ⚠️ **旧版数据文件不兼容**：v2 引入角色与班级归属，与早期「一个账号即一个班级」的 v1 结构不兼容。若启动检测到 `accounts` 缺 `class_id/role`，会明确报错提示，需删除旧 `data/banjifen.sqlite` 重建（真实数据请先通过旧版导出 CSV）。
- ⚠️ **EdgeOne 多实例一致性**：Blob 为「读己之写 + 每 2 秒版本同步」，同一班级低并发使用完全够用；**极端并发下写入为最后写入胜出（last-write-wins）**，多班级高并发场景建议在自有服务器（fs 模式，单进程独占）下运行。
- ⚠️ **JWT 密钥**：本地/自有服务器用 `JWT_SECRET` 环境变量（≥32 字符，**生产环境务必更换**）；EdgeOne 模式下若无环境变量，首次随机生成并存入 Blob `bj/config/jwt-secret`，保证多实例与冷启动之间签名一致。若彻底清空 Blob，会重新生成密钥，导致旧登录态全部失效（用户需重新登录）。
- ⚠️ **冷启动 500/502 与预热**：实例被平台回收后的首个请求需要初始化 wasm（0.87MB base64）并拉取 Blob 整库快照。
  已用 GitHub Actions 每小时预热 `/api/cron/warmup` 兜底，**完全免费**（仓库为 Public，Actions 不限量）；同时已把引导耗时压到 1 秒以内
  （wasm 与 loader 内联、Blob 读取并行、去掉 30MB 的 `sql.js` 依赖）。
  若线上仍偶发超时，先确认 Actions 的 `warmup` workflow 是否在正常运行（仓库 → Actions → warmup）。

### 操作与权限

- ⚠️ **「清空数据」不可逆，但可恢复**：班主任的清空/删除会先写 `recycle` 快照，超管可在回收站一键还原；但主动删除的班级/账号若未走回收站或已清空回收站，则无法找回。
- ⚠️ **班干部限额是硬约束**：单次 ≤`cadre_limit_per`（默认 5）、每日绝对值 ≤`cadre_limit_day`（默认 20），超管可在班级管理里调整，用于防止学生互刷分。
- ⚠️ **对外查询总开关关闭 = 真正关停**：关闭后不仅登录页入口隐藏，公开查询接口（`/api/public/query/:token`）也会直接拒绝。若你只想要「隐藏入口、链接仍可直访」，需去掉 `server/src/core/query.js` 里对 `public_query_enabled` 的门禁（默认实现为完全关停，更安全）。
- ⚠️ **家长查询依赖档案字段**：查询校验方式选「姓名 + 学号」时，必须保证学生档案已填学号；选「手机号后 4 位」时须填家长手机号，否则无法命中。

### 安全与合规

- 🔒 **`.env` 与 `data/` 已 gitignore**：真实配置与业务数据不会进 GitHub。仓库内只有虚构的种子/演示数据生成脚本（`scripts/seed-demo.js`）。
- 🔒 **登录限流**：默认每 IP 5 分钟 30 次（`AUTH_LOGIN_RATE_MAX` 可配），内存窗口；多实例下建议换 Redis（当前为单进程内存计数）。
- 🔒 **公开查询限流**：免登录查询接口 60 次/分，防口令被爆破；失败尝试全部记入操作日志。
- 🔒 **手机号隐私**：仅超管可见全量手机号，班主任见脱敏值，公开查询页家长手机号一律脱敏。

---

## 安全设计

- **密码**：bcrypt（cost 10）；超管重置密码后强制该账号所有会话失效
- **令牌**：访问令牌 30 分钟 + 刷新令牌 14 天（服务端存哈希、刷新即轮换），全部 httpOnly Cookie，不落 localStorage
- **CSRF**：`SameSite=Lax` + 非 GET 强制自定义头 `x-requested-with: fetch`
- **越权**：`requireAuth(role)` → `requireCap(capability)` → 服务层 `class_id` 归属校验；超管接口独立命名空间 `/api/super`
- **隐私**：手机号仅超管见全量，班主任见脱敏值；日志脱敏敏感字段
- **限流**：登录 5 分钟 30 次（内存窗口，多实例建议换 Redis）；公开查询 60 次/分
- **审计**：全站写操作统一经 `trail()` 中间件落 `operation_logs`（含失败请求），敏感字段（密码/令牌）自动脱敏，编辑操作留前后快照
- **对外查询**：公开接口仅暴露命中学生的本人数据，家长手机号一律脱敏，口令可随时吊销，限流 60 次/分；另有全局总开关，关闭后公开查询接口直接拒绝（默认开启）
- **数据**：多步写入事务；SQLite 以临时文件 + rename 原子落盘，退出前 flush

---

## 开源协议

本项目采用 **[Apache License 2.0](LICENSE)** 授权。

```
Copyright 2026 Yellowsoy (banjifen contributors)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### 你可以做什么

| 权限 | 说明 |
| --- | --- |
| ✅ 商用 | 可用于商业场景，无需额外授权 |
| ✅ 修改 | 可自由修改、定制为自己的版本 |
| ✅ 分发 | 可重新发布、再分发（含闭源集成） |
| ✅ 私有化部署 | 可自行部署运营，**数据完全归你自己**，不依赖本项目方|
| ✅ 提交贡献 | 欢迎 PR 与 Issue |

### 你需要做什么

| 义务 | 说明 |
| --- | --- |
| ⚠️ 保留版权与许可声明 | 分发时必须**保留** `LICENSE` 中的版权声明与许可声明 |
| ⚠️ 标注修改 | 若修改了代码，需在文件中注明「已修改」（Apache-2.0 §4(b)） |
| ⚠️ 声明专利授权 | 贡献者默认授予专利许可，且不得以本项目名义主张专利 |
| ❌ 不得使用原作者商标 | 不得用本项目名称/logo 为衍生作品做背书（§6） |
| ❌ 不得主张担保 | 软件「按原样提供」，作者不承担担保责任（§7） |

> 简言之：**Apache-2.0 是对企业最友好的宽松协议**——允许闭源商用，只要求保留声明。
> 对比 MIT 多了一项「明确的专利授权」，对 GPL 多了一项「可以闭源分发」。

### 第三方组件

本项目依赖的第三方库均采用宽松协议，与 Apache-2.0 兼容：

| 组件 | 协议 | 用途 |
| --- | --- | --- |
| Express | MIT | HTTP 框架 |
| zod | MIT | 参数校验 |
| bcryptjs | MIT | 密码散列 |
| jsonwebtoken | MIT | JWT 签发/校验 |
| cookie-parser | MIT | Cookie 解析 |
| multer | MIT | 文件上传 |
| dotenv | MIT | 环境变量 |
| @edgeone/pages-blob | MIT | EdgeOne Blob 存储 |
| xlsx (SheetJS) | Apache-2.0 | Excel 导入导出 |
| sql.js（构建期内联） | MIT | SQLite WebAssembly |

完整的第三方声明见 [`NOTICE`](NOTICE)。其中 `sql.js` 的 WASM loader 与 SQLite 二进制被内联到
`server/src/db/` 下（目的是把云函数包从 53MB 压到 23MB），其原始 MIT 版权声明已保留在文件头与 NOTICE 中。

### 商标

"班级积分管理 / Class Points" 的名称与界面标识不包含在 Apache-2.0 授权范围内。
二次分发时可自行更换名称与图标，但请勿暗示与原作者存在官方关联。

---

## 说明

- 界面与业务流程参考了公开的班级积分类产品形态后**重写实现**，代码为本项目自有实现；不含任何第三方站点的私有代码或用户数据。
- README 截图均使用 `scripts/seed-demo.js` 生成的**虚构数据**（示例学校、化名、测试号段手机号）。
- 本项目以 [Apache License 2.0](LICENSE) 开源，完整条款见仓库根目录的 `LICENSE` 与 `NOTICE` 文件。
