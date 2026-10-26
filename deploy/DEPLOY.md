# 上线部署说明（bj.5166966.xyz）

本文记录 **2026-10 实际核查结果** 与后续上线步骤，避免重复踩坑。

## 一、当前资源核查

| 项目 | 核查结果 | 命令/依据 |
| --- | --- | --- |
| 腾讯云 CVM | **0 台实例** | `teo/cvm DescribeInstances` → `TotalCount: 0` |
| 腾讯云 Lighthouse | **0 台实例** | `lighthouse DescribeInstances` → `TotalCount: 0` |
| 阿里云 ECS | **0 台实例**（北京/杭州均查） | `ecs DescribeInstances` → `TotalCount: 0` |
| 阿里云轻量 | **0 台实例** | `swas ListInstances` → `TotalCount: 0` |
| EdgeOne | 1 个站点，类型 `pages`，套餐 `plan-free`，区域 `overseas` | `teo DescribeZones` |
| EdgeOne Pages API | 该 SecretId **无权限/接口未开放**（`UnauthorizedOperation` / `InvalidAction`） | `teo DescribeAccelerationDomains` / `pages DescribePagesProjects` |
| 域名 DNS | `5166966.xyz` 在**阿里云 DNS**（dns7/dns8.hichina.com），10 条记录，`bj` 子域**无记录** | `alidns DescribeDomainRecords` |

### 结论

本项目是 **Node.js 服务端应用**（Express + SQLite 文件库），**必须有可运行进程的主机**。

- **EdgeOne Pages 只能托管静态文件**，无法运行 `server/src/index.js`，也无法持久化 SQLite 文件。把仓库关联到 Pages 后，构建产物里没有后端，`/api/*` 会 404。
- 账号内目前没有任何服务器/容器资源，因此 **`https://bj.5166966.xyz/` 现阶段无法真实上线**（不是配置问题，是缺运行环境）。
- 域名与证书本身不是阻碍：DNS 在阿里云、可编程添加记录；证书可用 Let's Encrypt（certbot）自动签发，或用 EdgeOne 免费证书。

## 二、路线 A：买一台最小服务器（推荐，功能完整）

配置建议：**2 核 2G / 40G 系统盘 / 带宽 3–5M**，Ubuntu 22.04。

- 阿里云轻量应用服务器：约 ¥24/月起（新用户常有 ¥68/年 活动），与域名同账号，DNS 操作最顺
- 腾讯云轻量：约 ¥24/月起，与 EdgeOne 同账号，后续可叠加 EdgeOne 加速

买好后只需要把 **公网 IP** 给我，以下步骤全自动：

```bash
# 1. DNS：阿里云加 A 记录（本仓库脚本，读写后自动回读校验）
export ALIYUN_ACCESS_KEY_ID=***  ALIYUN_ACCESS_KEY_SECRET=***
node deploy/setup-dns.js upsert 5166966.xyz bj A <公网IP>

# 2. 服务器：一键安装 Node/Nginx/PM2 + 生成随机密钥 + 申请证书
ssh root@<公网IP>
curl -fsSL https://raw.githubusercontent.com/Yellowsoy/banjifen/main/deploy/install.sh -o install.sh
# 私有仓库需带 token 或先上传；也可 git clone 后用仓库内的 deploy/install.sh
bash install.sh bj.5166966.xyz https://github.com/Yellowsoy/banjifen.git

# 3. 校验
curl -I https://bj.5166966.xyz/            # 期望 200，且 certificate 有效
curl -s https://bj.5166966.xyz/api/public/health
```

`deploy/install.sh` 做的事：

1. 安装 `curl git nginx certbot python3-certbot-nginx ufw`
2. 安装 Node.js 20
3. 建系统用户 `banjifen`、目录 `/opt/banjifen`
4. `git clone` 并 `npm ci --omit=dev`
5. 生成 `.env`（**随机 `JWT_SECRET` 与超管初始密码**，权限 600），首次启动自动建表
6. PM2 常驻 + 开机自启（`pm2 startup`）
7. 写 Nginx 配置（80 跳 443、TLS1.2/1.3、HSTS、反代 3000），`certbot --nginx` 签证书并自动续期
8. 自检 `/health` 与 HTTPS

证书细节：

- **Let's Encrypt**（推荐）：`certbot` 通过 HTTP-01 校验，要求解析已指向本机且 80 端口可达；90 天自动续期，`certbot renew --dry-run` 可预演。
- **阿里云免费证书 / EdgeOne 免费证书**：如果希望证书由云厂商托管，可在控制台申请 DV 证书（需按提示加 DNS TXT 校验），下载后放到 `deploy/certs/` 并把 `nginx.conf` 的 `ssl_certificate` 改成对应路径。

## 三、路线 B：改造成纯静态版（不推荐）

若坚持只用 EdgeOne Pages（免费、免服务器）：

1. 前端保留，把 `public/js/api.js` 换成 IndexedDB/localStorage 适配层；
2. 后端能力全部下沉到浏览器 → **失去多账号、角色权限、跨设备同步与审计**，与当前"班主任/老师/班干部"的设计目标冲突；
3. 多出来的 12 个接口文件、权限策略全部作废。

只适合做"演示站"，不适合作为真实班级使用。

## 四、EdgeOne 关联 GitHub 怎么做（限静态产物）

控制台路径：**EdgeOne 控制台 → Pages → 选择站点 → 设置 → Git 集成 → 关联 GitHub 仓库**（选择 `Yellowsoy/banjifen`，构建命令留空、输出目录填 `public`）。

- 关联后每次 push 会触发静态构建，产出的是 `public/` 里的 HTML/CSS/JS；
- 因为没有 Node 进程，页面能打开，但登录、加减分等会因 `/api` 不可用而失败；
- 因此**建议只把它当作"前端预览环境"**，正式环境仍走路线 A。

## 五、常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `certbot` 报 `Timeout during connect` | 解析未生效或 80 端口被占用/未放通 | `dig bj.5166966.xyz` 确认 A 记录；安全组放通 80/443 |
| 访问 502 | Node 未启动 | `pm2 logs banjifen --lines 50` |
| 登录后立刻 401 | 反代没带 `X-Forwarded-Proto`，生产环境 Cookie 被判定为不安全 | 确认 `nginx.conf` 的 `proxy_set_header X-Forwarded-Proto $scheme` |
| 上传 Excel 失败 | 反代默认 body 太小 | `client_max_body_size 10m`（已配） |
| 忘记超管密码 | — | 删 `data/banjifen.sqlite` 重启会重新播种；或在服务器上直接改库 |

## 六、备份

```bash
# 每天 3 点备份数据库（crontab -e）
0 3 * * * cp /opt/banjifen/data/banjifen.sqlite /opt/backup/banjifen-$(date +\%F).sqlite
```

SQLite 以「临时文件 + rename」原子落盘，直接 `cp` 即可得到一致快照。
