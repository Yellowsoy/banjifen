# 班级积分管理 · Class Points

一个面向小学班主任的班级积分管理系统：**花名册导入 / 实时加减分 / 积分排行 / 积分排座 / 积分商城 / 成绩分析与学习建议**，配套 **超级管理员 · 班主任 · 老师 · 班干部** 四级角色权限。

整套系统可完全私有部署：一个 Node.js 进程 + 一个 SQLite 文件，无需任何第三方云服务。

<p>
<img src="docs/screenshots/02-ranking.png" width="240" alt="学生榜" />
<img src="docs/screenshots/07-scores.png" width="240" alt="成绩分析" />
<img src="docs/screenshots/09-members.png" width="240" alt="成员管理" />
</p>
<p>
<img src="docs/screenshots/05-seating.png" width="240" alt="积分排座" />
<img src="docs/screenshots/06-mall.png" width="240" alt="积分商城" />
<img src="docs/screenshots/11-cadre-view.png" width="240" alt="班干部视图" />
</p>
<p>
<img src="docs/screenshots/12-super-classes.png" width="640" alt="超级管理员 · 班级" />
</p>

> 以上截图使用 **虚构演示数据**（示例学校、化名学生、138xxxx 测试手机号），由仓库内 `scripts/seed-demo.js` 生成，可复现。

---

## 特性

### 四级角色，边界清晰

| 能力 | 超级管理员 | 班主任 | 老师 | 班干部 |
| --- | :-: | :-: | :-: | :-: |
| 定位 | 平台运维：管人、管号、管归属 | 班级第一责任人 | 任课老师 | 学生干部 |
| 学生 | — | 增 / 改 / 删 | 增 / 改 | 只读 |
| 加减分 | — | 单人 + 批量 | 单人 + 批量 | 单人（单次 ≤5、每日 ≤20，可调） |
| 积分记录 | — | 查看 / 删除 / 清空 | 查看 / 导出 | 查看 |
| 排座 | — | 全权 | 全权 | 只读 |
| 积分商城 | — | 礼物增删 + 兑换 | 仅兑换 | 只读 |
| 成绩 | — | 导入 + 删除考试 | 导入 | — |
| 班级资料 / 清空数据 | — | ✓ | ✗ | ✗ |
| 成员账号 | 任意班级任意角色 | 本班老师 / 班干部 | ✗ | ✗ |
| 手机号 | 全量可见可改 | 仅脱敏 | 仅自己 | 仅自己 |

设计要点：

1. **超管不碰业务数据**——只负责建班、建号、改归属、重置密码、看手机号，避免平台方误改教学数据；超管动作全部落 `admin_audit`。
2. **删除权只给班主任**——老师能日常操作但删不了学生、清不了数据；所有"清空"先写回收站快照，超管可一键还原。
3. **班干部限额是硬约束**——防止学生互刷分，每次操作在流水里记 `operator_name / operator_role`，谁加的一目了然。

权限不是前端藏按钮：能力表在 `server/src/core/policy.js`，路由用 `requireCap('student:delete')` 声明，服务层再用登录态里的 `class_id` 校验归属。

### 班级端

- **学生榜**：排名（前三名金/银/铜）、小组、职务、积分；高→低 / 低→高 / 按时间（本期、本周、本月）；搜索、分页
- **加减分**：单人加分/减分、快捷规则一键填入、原因备注；班干部受额度限制
- **批量加减**：按学生 / 按小组、全选、统一原因
- **学生管理**：新增、Excel/CSV 批量导入（表头容错、重复自动跳过）、模板下载、编辑、删除、单人历史
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

---

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js 18+ | 无构建步骤，开箱即跑 |
| Web | Express 5 | 分层：routes → controller → service → repository |
| 数据 | SQLite（[sql.js](https://sql.js.org/) WASM） | 纯 JS，无需编译原生模块，Windows/macOS/Linux 一致 |
| 鉴权 | JWT + 服务端刷新令牌 | httpOnly Cookie，刷新即轮换，前端拿不到令牌 |
| 校验 | Zod | 所有入参在边界处收敛 |
| 前端 | 原生 ES Module + 手写 CSS | 无框架、无打包器，`public/` 直接托管 |
| 导出 | SheetJS（xlsx） | 花名册/成绩导入，CSV 导出带 BOM |

```
┌────────────────────────── 浏览器（public/） ──────────────────────────┐
│  index.html  ·  app.css（设计系统）  ·  js/{api,ui,store,...}.js       │
│  api.js：fetch 封装 + CSRF 头 + 401 自动刷新重试 + 文件下载             │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  /api/*（httpOnly Cookie）
┌──────────────────────────────▼───────────────────────────────────────┐
│ Express 5                                                            │
│  middleware: requestContext(requestId/日志) → auth(requireCap) → 错误  │
│  modules: auth · class · members · super · public                    │
│    controller（解析/响应） → service（业务+事务） → repository（SQL）    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                    SQLite（data/banjifen.sqlite，原子落盘）
```

---

## 快速开始

```bash
npm install
cp .env.example .env      # 默认值即可本地跑通
npm start                 # → http://localhost:3000
```

Windows 可直接双击 `start.bat`，macOS/Linux 用 `./start.sh`。

首次启动自动建表并写入演示数据：

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 超级管理员 | `admin` | `admin123456` |
| 班主任 | `123456` | `123456` |
| 老师 | `teacher` | `123456` |
| 班干部 | `cadre` | `123456` |

生成更完整的演示数据（12 名学生、58 条流水、两场考试、排座、兑换记录，用于复现 README 截图）：

```bash
npm start                    # 另开一个终端
node scripts/seed-demo.js
```

> 生产环境请修改 `.env` 中的 `JWT_SECRET`、`SUPER_PASSWORD`，并在首次登录后立即改密码。
> 本版数据结构（v2，含角色与班级归属）与早期"一个账号即一个班级"的结构不兼容，旧 `data/banjifen.sqlite` 需删除重建，启动时会明确提示。

---

## 目录结构

```
.
├─ server/
│  ├─ src/
│  │  ├─ index.js              # 启动：初始化 DB → 种子 → 监听 → 优雅停机
│  │  ├─ app.js                # 安全头、请求上下文、路由、错误处理
│  │  ├─ config.js             # 环境变量集中校验（缺失/非法即启动失败）
│  │  ├─ seed.js               # 种子：超管 + 演示班级 + 三种角色账号
│  │  ├─ core/
│  │  │  ├─ policy.js          # ★ 权限单一来源：角色 × 能力矩阵
│  │  │  ├─ errors.js          # 类型化错误体系
│  │  │  ├─ logger.js          # 结构化 JSON 日志（敏感字段脱敏）
│  │  │  ├─ security.js        # bcrypt / JWT / Cookie / 随机令牌
│  │  │  ├─ validation.js      # zod schema 集合
│  │  │  └─ excel.js           # xlsx 读写、CSV(BOM)、表头容错
│  │  ├─ db/
│  │  │  ├─ index.js           # sql.js 连接、事务、原子落盘、迁移、旧库自检
│  │  │  └─ migrations/001_init.sql
│  │  ├─ middleware/           # requestContext · auth · error · rateLimit
│  │  └─ modules/
│  │     ├─ auth/              # 双入口登录、刷新、改密
│  │     ├─ class/             # 学生、积分、规则、商城、排座、成绩
│  │     ├─ members/           # 班主任管理本班成员
│  │     ├─ super/             # 超管：班级、账号、归属、回收站、审计
│  │     └─ public/            # 版本号、健康检查
│  └─ test/smoke.test.js       # 53 项集成测试
├─ public/
│  ├─ index.html
│  ├─ css/app.css              # 设计系统（4pt 间距 + 统一列模板 + tabular-nums）
│  └─ js/
│     ├─ api.js ui.js store.js app.js
│     ├─ class-app.js class-mall.js class-seat.js class-scores.js
│     ├─ members.js            # 成员管理
│     └─ super-app.js          # 超级管理员
├─ scripts/seed-demo.js        # 虚构演示数据（README 截图来源）
├─ docs/screenshots/           # 界面截图（虚构数据）
├─ data/                       # 运行后生成，已 gitignore
└─ .env.example
```

---

## API

统一前缀 `/api`；写操作需带 `x-requested-with: fetch`（CSRF）；错误统一 `{ error: { code, message }, requestId }`。

| 分组 | 端点 |
| --- | --- |
| 认证 | `POST /auth/login`（`entry: class\|super`）、`POST /auth/refresh`、`POST /auth/logout`、`GET /auth/me`、`POST /auth/password` |
| 班级 | `GET /class/overview`、`PUT /class/profile`、`GET\|POST /class/students`、`PATCH\|DELETE /class/students/:id`、`POST /class/students/import`、`GET /class/students/template`、`DELETE /class/students/:id/logs`、`GET /class/groups` |
| 积分 | `POST /class/points`、`GET\|DELETE /class/logs`、`DELETE /class/logs/:id`、`GET /class/logs/export.csv`、`GET /class/ranking/export.csv`、`POST /class/reset-points`、`POST /class/clear-all` |
| 规则 / 商城 | `GET\|POST /class/rules`、`DELETE /class/rules/:id`、`POST /class/rules/reset\|import`、`GET\|POST /class/gifts`、`PATCH\|DELETE /class/gifts/:id`、`POST /class/gifts/:id/redeem`、`GET /class/redemptions(+/export.csv)` |
| 排座 / 成绩 | `GET\|PUT /class/seat`、`POST /class/seat/auto`、`GET /class/exams`、`POST /class/exams/import`、`DELETE /class/exams/:id`、`GET /class/scores`、`GET /class/scores/student/:id` |
| 成员 | `GET\|POST /members`、`PATCH\|DELETE /members/:id`、`POST /members/transfer-owner`、`PATCH /members/settings/limits` |
| 超管 | `GET /super/overview`、`GET\|POST /super/classes`、`PATCH\|DELETE /super/classes/:id`、`POST /super/classes/:id/restore\|transfer-owner`、`GET /super/classes/export.csv`、`GET\|POST /super/accounts`、`PATCH\|DELETE /super/accounts/:id`、`POST /super/accounts/:id/reset-password`、`GET /super/recycle`、`POST /super/recycle/:id/restore`、`GET /super/audit` |
| 公开 | `GET /public/settings`、`GET /health`、`GET /ready` |

---

## 数据模型

| 表 | 说明 |
| --- | --- |
| `classes` | 班级（= 数据空间）：名称、学校、年级、徽章、`owner_id`、班干部额度 |
| `accounts` | 账号：`role` = super_admin / owner / teacher / cadre，`class_id` 归属，`phone`，软删除 |
| `auth_sessions` | 刷新令牌（只存 SHA-256），支持轮换与吊销 |
| `students` | 学生：姓名、小组、性别、职务、当前积分，软删除 |
| `point_logs` | 积分流水：分值、原因、类型、`operator_id / operator_name / operator_role` |
| `quick_rules` / `gifts` / `redemptions` | 快捷规则、礼物、兑换记录 |
| `exams` / `scores` | 考试与成绩（`exam_id + student_id` 唯一） |
| `seat_plans` | 排座布局与座位 JSON |
| `recycle` | 清空/删除前快照，超管可恢复 |
| `admin_audit` | 超管操作审计 |

所有业务查询以 `class_id` 为边界（来自登录态，不接受前端传入）；越权访问统一 403/404。

---

## 界面规范（视觉对齐）

设计系统写在 `public/css/app.css` 顶部，四条硬规则：

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

拉起独立实例（临时数据库 + 独立端口），覆盖：

- 三角色 + 超管登录与能力清单
- 权限边界：班干部额度/批量/删除/清空 403，老师不能删除与清空
- 学生与花名册导入、加减分与流水回滚、CSV 导出
- 商城兑换（积分不足校验）、排座、成绩三视图与学习建议
- 成员管理：建号、改密、停用、转移班主任、额度调整
- 超管：建班、建号、改密、改手机号、改归属、"一班一主"、删除恢复、快照恢复、审计、导出
- 安全：CSRF、422、越权 404、登出失效、刷新令牌

```
结果：通过 53，失败 0
```

---

## 部署

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

生产清单：`NODE_ENV=production`、强随机 `JWT_SECRET`、HTTPS（Cookie 自动加 `secure` 并启用 HSTS）、定期备份 `data/banjifen.sqlite`。

> SQLite 以 sql.js 载入内存、写入后原子落盘，单校规模（万级学生、十万级流水）足够。若要多实例横向扩展，把 `server/src/db/index.js` 换成 PostgreSQL 驱动即可，上层仓储调用方式不变。

---

## 安全设计

- **密码**：bcrypt（cost 10）；超管重置密码后强制该账号所有会话失效
- **令牌**：访问令牌 30 分钟 + 刷新令牌 14 天（服务端存哈希、刷新即轮换），全部 httpOnly Cookie，不落 localStorage
- **CSRF**：`SameSite=Lax` + 非 GET 强制自定义头
- **越权**：`requireAuth(role)` → `requireCap(capability)` → 服务层 `class_id` 归属校验；超管接口独立命名空间 `/api/super`
- **隐私**：手机号仅超管见全量，班主任见脱敏值；日志脱敏敏感字段
- **限流**：登录 5 分钟 30 次（内存窗口，多实例建议换 Redis）
- **审计**：超管的建班/建号/改密/转移/删除/恢复全部落 `admin_audit`
- **数据**：多步写入事务；SQLite 以临时文件 + rename 原子落盘，退出前 flush

---

## 说明

- 界面与业务流程参考了公开的班级积分类产品形态后**重写实现**，代码为本项目自有实现；不含任何第三方站点的私有代码或用户数据。
- README 截图均使用 `scripts/seed-demo.js` 生成的**虚构数据**（示例学校、化名、测试号段手机号）。
- 如需商用或二次分发，请自行确认所用第三方库（Express / SheetJS 等）的许可条款。
