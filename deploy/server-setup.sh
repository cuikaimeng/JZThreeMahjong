#!/usr/bin/env bash
# 三人扣点门板屋 · 腾讯云轻量服务器后端一键部署
#
# 在服务器上以 root 执行（代码需先放到 /opt/jz-mahjong）：
#   sudo bash /opt/jz-mahjong/deploy/server-setup.sh \
#       --db-password '强密码' --domain game.example.com \
#       --wx-appid '' --wx-secret ''
#
# 幂等：建库 / 建表 / hba 规则 / .env / systemd / nginx 均可重复执行。
# 只部署后端 + PostgreSQL + Redis + nginx；前端是微信小游戏，由开发者工具上传。
# 传 --domain 后：证书未就绪时先配 HTTP 反代（便于 certbot 申请证书），
# 证书就绪后重跑本脚本会自动切换为 HTTPS/WSS 完整配置。
#
# 本地开发版本（对齐参考）：Node 22.22.0 / PostgreSQL 16.14 / Redis 8.10.3
# 服务器 PostgreSQL 用系统包（Ubuntu 24.04 自带 16；22.04 自带 14 也可跑），
# Redis 用系统包即可（项目只用到 SET/GET/DEL/KEYS + TTL，6.x 以上均兼容）。
set -euo pipefail

SRC="/opt/jz-mahjong"
DB_PASSWORD=""
WX_APPID=""
WX_SECRET=""
DOMAIN=""
CORS_ORIGINS="*"
NODE_VER="v22.22.0"
NPM_REGISTRY="https://mirrors.cloud.tencent.com/npm/"

while [ $# -gt 0 ]; do
  case "$1" in
    --src)           SRC="$2"; shift 2 ;;
    --db-password)   DB_PASSWORD="$2"; shift 2 ;;
    --wx-appid)      WX_APPID="$2"; shift 2 ;;
    --wx-secret)     WX_SECRET="$2"; shift 2 ;;
    --domain)        DOMAIN="$2"; shift 2 ;;
    --cors-origins)  CORS_ORIGINS="$2"; shift 2 ;;
    --node-version)  NODE_VER="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "请用 root / sudo 执行"; exit 1; }
[ -f "$SRC/backend/src/server.js" ] || { echo "未找到代码：$SRC/backend/src/server.js，请先上传项目"; exit 1; }
[ -n "$DB_PASSWORD" ] || DB_PASSWORD="$(openssl rand -hex 16)"

. /etc/os-release
OS_ID="${ID:-}"
OS_LIKE="${ID_LIKE:-}"
echo "[1/8] 系统: ${PRETTY_NAME:-unknown}"

if echo "$OS_ID $OS_LIKE" | grep -qiE 'debian|ubuntu'; then
  PKG=apt
elif command -v dnf >/dev/null 2>&1; then
  PKG=dnf
else
  PKG=yum
fi

# ---------- 2. 运行时与中间件 ----------
echo "[2/8] 安装 Node.js 18+ / PostgreSQL / Redis"
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then
  echo "  Node 已满足: $(node -v)"
else
  TARBALL="node-${NODE_VER}-linux-x64.tar.xz"
  ok=0
  for base in "https://mirrors.cloud.tencent.com/nodejs-release/${NODE_VER}" "https://nodejs.org/dist/${NODE_VER}"; do
    if curl -fL --retry 2 --connect-timeout 10 --max-time 180 "$base/$TARBALL" -o /tmp/node.tar.xz; then ok=1; break; fi
  done
  [ "$ok" -eq 1 ] || { echo "Node 下载失败，请手动安装 Node 18+ 后重跑"; exit 1; }
  rm -rf /opt/nodejs && mkdir -p /opt/nodejs
  tar -xJf /tmp/node.tar.xz -C /opt/nodejs --strip-components=1
  ln -sf /opt/nodejs/bin/node /usr/local/bin/node
  ln -sf /opt/nodejs/bin/npm  /usr/local/bin/npm
  ln -sf /opt/nodejs/bin/npx  /usr/local/bin/npx
  echo "  Node 已安装: $(node -v)"
fi

if [ "$PKG" = apt ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-contrib redis-server curl ca-certificates xz-utils openssl
  systemctl enable --now postgresql
  systemctl enable --now redis-server
  REDIS_UNIT=redis-server
else
  $PKG install -y postgresql-server postgresql-contrib redis curl ca-certificates xz openssl || {
    echo "包安装失败：CentOS 8+/TencentOS 3 可能需要先执行 'dnf module enable postgresql:<版本>'"; exit 1;
  }
  [ -f /var/lib/pgsql/data/PG_VERSION ] || postgresql-setup --initdb || true
  systemctl enable --now postgresql
  systemctl enable --now redis
  REDIS_UNIT=redis
fi

# 后端无 Redis 密码配置项，因此只用「仅本机监听」保证安全，不要设 requirepass
REDIS_CONF=""
for f in /etc/redis/redis.conf /etc/redis.conf; do
  [ -f "$f" ] && REDIS_CONF="$f" && break
done
if [ -n "$REDIS_CONF" ]; then
  if grep -qE '^[# ]*bind ' "$REDIS_CONF"; then
    sed -i -E 's/^[# ]*bind .*/bind 127.0.0.1 -::1/' "$REDIS_CONF"
  else
    echo 'bind 127.0.0.1 -::1' >> "$REDIS_CONF"
  fi
  systemctl restart "$REDIS_UNIT"
fi

# ---------- 3. 数据库 ----------
echo "[3/8] 初始化 PostgreSQL 角色 / 库 / 表"
psql_pg() { runuser -u postgres -- psql "$@"; }

if ! psql_pg -tAc "SELECT 1 FROM pg_roles WHERE rolname='mahjong'" | grep -q 1; then
  psql_pg -c "ALTER SYSTEM SET password_encryption = 'scram-sha-256'" >/dev/null 2>&1 || true
  psql_pg -c "SELECT pg_reload_conf()" >/dev/null 2>&1 || true
  ESC_PWD="${DB_PASSWORD//\'/\'\'}"
  psql_pg -c "CREATE ROLE mahjong LOGIN PASSWORD '${ESC_PWD}'"
fi
if ! psql_pg -tAc "SELECT 1 FROM pg_database WHERE datname='mahjong'" | grep -q 1; then
  psql_pg -c "CREATE DATABASE mahjong OWNER mahjong"
fi

HBA="$(psql_pg -tAc 'SHOW hba_file' | tr -d ' \n')"
if [ -n "$HBA" ] && ! grep -q 'mahjong  mahjong  127.0.0.1/32  scram' "$HBA"; then
  sed -i '1ihost  mahjong  mahjong  127.0.0.1/32  scram-sha-256' "$HBA"
  psql_pg -c "SELECT pg_reload_conf()" >/dev/null
fi
# 老版本 PG 或 ident 默认规则可能导致密码连接失败，回退到仅本机 trust
if ! PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U mahjong -d mahjong -tAc 'SELECT 1' >/dev/null 2>&1; then
  echo "  [warn] 密码认证不可用，回退为 127.0.0.1 本机 trust（不对外暴露）"
  sed -i '1ihost  mahjong  mahjong  127.0.0.1/32  trust' "$HBA"
  psql_pg -c "SELECT pg_reload_conf()" >/dev/null
fi
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U mahjong -d mahjong -tAc 'SELECT 1' >/dev/null
# 用 mahjong 角色建表，保证表属主正确（后端可写）
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U mahjong -d mahjong -v ON_ERROR_STOP=1 \
  -f "$SRC/database/schema.sql" >/dev/null

# ---------- 4. 生产配置 ----------
echo "[4/8] 生成 backend/.env"
cat > "$SRC/backend/.env" <<EOF
PORT=3000
PG_HOST=127.0.0.1
PG_PORT=5432
PG_USER=mahjong
PG_PASSWORD=${DB_PASSWORD}
PG_DATABASE=mahjong
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
WX_APPID=${WX_APPID}
WX_SECRET=${WX_SECRET}
CORS_ORIGINS=${CORS_ORIGINS}
TOKEN_TTL_DAYS=7
EOF
chmod 600 "$SRC/backend/.env"

# ---------- 5. 依赖 ----------
echo "[5/8] 安装后端依赖"
if ! id -u mahjong >/dev/null 2>&1; then
  NOLOGIN="$(command -v nologin || echo /sbin/nologin)"
  useradd -r -m -s "$NOLOGIN" mahjong
fi
chown -R mahjong:mahjong "$SRC"
cd "$SRC/backend"
runuser -u mahjong -- env PATH="/usr/local/bin:/usr/bin:/bin" \
  npm install --omit=dev --no-audit --no-fund --registry="$NPM_REGISTRY"

# ---------- 6. 进程守护 ----------
echo "[6/8] 配置 systemd 服务与 nginx 反向代理"
cat > /etc/systemd/system/jz-mahjong.service <<EOF
[Unit]
Description=JZ Three Mahjong Backend (HTTP + WebSocket)
After=network-online.target postgresql.service ${REDIS_UNIT}.service
Wants=network-online.target

[Service]
Type=simple
User=mahjong
Group=mahjong
WorkingDirectory=${SRC}/backend
EnvironmentFile=${SRC}/backend/.env
ExecStart=/usr/local/bin/node ${SRC}/backend/src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable jz-mahjong >/dev/null
systemctl restart jz-mahjong

# nginx：有域名才配置。证书未就绪时先上 HTTP 反代（便于 certbot 申请证书）；
# 证书就绪后重跑本脚本，自动切换为 deploy/nginx-wss.conf.example 的 HTTPS/WSS 配置。
if [ -n "$DOMAIN" ]; then
  echo "  配置 nginx 反代: ${DOMAIN}"
  if [ "$PKG" = apt ]; then
    apt-get install -y -qq nginx certbot python3-certbot-nginx 2>/dev/null \
      || apt-get install -y -qq nginx
  else
    $PKG install -y nginx
  fi
  NGINX_CONF=/etc/nginx/conf.d/jz-mahjong.conf
  if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    sed "s/YOUR_DOMAIN/${DOMAIN}/g" "$SRC/deploy/nginx-wss.conf.example" > "$NGINX_CONF"
    echo "  证书已就绪 → 启用 HTTPS/WSS"
  else
    cat > "$NGINX_CONF" <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        \$connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
    echo "  [提示] 证书未就绪 → 当前仅 HTTP 反代；执行 certbot --nginx -d ${DOMAIN} 后重跑本脚本"
  fi
  nginx -t
  systemctl enable --now nginx >/dev/null
  systemctl reload nginx
fi

# ---------- 7. 验证 ----------
echo "[7/8] 健康检查"
HEALTH=""
for _ in $(seq 1 20); do
  if HEALTH="$(curl -fsS --max-time 3 http://127.0.0.1:3000/health 2>/dev/null)"; then break; fi
  sleep 1
done
[ -n "$HEALTH" ] || { echo "健康检查失败，日志："; journalctl -u jz-mahjong -n 40 --no-pager; exit 1; }
echo "  /health -> $HEALTH"
echo "  redis   -> $(redis-cli ping)"
echo "  pg 表数 -> $(PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U mahjong -d mahjong -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
echo "  服务日志（应显示 pg=connected redis=connected）："
journalctl -u jz-mahjong -n 6 --no-pager
if [ -n "$DOMAIN" ]; then
  echo "  nginx /health -> $(curl -fsS --max-time 3 http://127.0.0.1/health || echo '失败')"
fi

# ---------- 8. 收尾提示 ----------
echo "[8/8] 部署完成"
echo "  数据库密码: ${DB_PASSWORD}"
echo "  后续："
if [ -n "$DOMAIN" ]; then
  echo "   1) 腾讯云控制台「防火墙」放行 80/443；3000 不必对公网开放"
  echo "   2) 证书未就绪：certbot --nginx -d ${DOMAIN}，然后重跑本脚本切换到 HTTPS/WSS"
  echo "   3) 前端 frontend/js/net/env.js 的 PROD_DOMAIN 改为 ${DOMAIN}，用开发者工具上传"
  echo "   4) 微信公众平台配置 request / socket(wss) / downloadFile 合法域名"
else
  echo "   1) 腾讯云控制台「防火墙」放行 3000（临时 http/ws 直连联调）"
  echo "   2) 真机需要 https + wss：加 --domain 你的域名 重跑本脚本"
  echo "   3) 前端 frontend/js/net/env.js 的 PROD_DOMAIN 改为你的域名"
fi
echo "   5) 端到端验证：node backend/tools/smoke.js（在服务器上执行）"
