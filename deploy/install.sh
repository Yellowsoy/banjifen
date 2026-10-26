#!/usr/bin/env bash
# 服务器一键部署（Ubuntu 22.04 / Debian 12 验证；CentOS 需把 apt 换成 dnf）
# 用法：sudo bash deploy/install.sh bj.5166966.xyz https://github.com/Yellowsoy/banjifen.git
set -euo pipefail

DOMAIN="${1:?请传入域名，例如 bj.5166966.xyz}"
REPO="${2:?请传入仓库地址}"
APP_DIR=/opt/banjifen
APP_USER=banjifen

echo "==> 1/7 安装基础依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ufw

echo "==> 2/7 安装 Node.js 20"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
node -v && npm -v

echo "==> 3/7 创建运行用户与目录"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"

echo "==> 4/7 拉取代码"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> 5/7 安装依赖与配置环境变量"
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev
if [ ! -f .env ]; then
  JWT=$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-48)
  SUPERPWD=$(head -c 18 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-16)
  chmod 640 /dev/null 2>/dev/null || true
  cat > .env <<ENV
NODE_ENV=production
PORT=3000
JWT_SECRET=${JWT}
ACCESS_TOKEN_TTL=1800
REFRESH_TOKEN_TTL=1209600
DB_FILE=data/banjifen.sqlite
UPLOAD_DIR=data/uploads
SUPER_USERNAME=admin
SUPER_PASSWORD=${SUPERPWD}
DEMO_OWNER_USERNAME=123456
DEMO_OWNER_PASSWORD=123456
ENV
  chown "$APP_USER:$APP_USER" .env
  chmod 600 .env
  echo "!! 超级管理员初始密码：${SUPERPWD}（请登录后立即修改）"
fi

echo "==> 6/7 启动服务（PM2）"
npm i -g pm2 >/dev/null
sudo -u "$APP_USER" pm2 start server/src/index.js --name banjifen --update-env
sudo -u "$APP_USER" pm2 save
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null
systemctl enable --now "pm2-$APP_USER" || true

echo "==> 7/7 配置 Nginx 与证书"
sed "s/bj\.5166966\.xyz/$DOMAIN/g" deploy/nginx.conf > "/etc/nginx/conf.d/banjifen.conf"
mkdir -p /var/www/html
nginx -t
systemctl reload nginx

# 先申请证书（HTTP-01 需要域名已解析到本机）
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || {
  echo "!! 证书申请失败：请确认 $DOMAIN 的 A 记录已指向本机公网 IP，且 80 端口放通后重试："
  echo "   certbot --nginx -d $DOMAIN --redirect"
}

ufw allow 'Nginx Full' >/dev/null 2>&1 || true
ufw allow OpenSSH >/dev/null 2>&1 || true

echo "==> 完成，自检："
curl -sS -o /dev/null -w "  local  http://127.0.0.1:3000/health  -> %{http_code}\n" http://127.0.0.1:3000/health || true
curl -sS -o /dev/null -w "  https  https://$DOMAIN/            -> %{http_code}\n" "https://$DOMAIN/" || true
