#!/usr/bin/env bash
# 三人扣点门板屋 · 只部署后端（Node / PostgreSQL / Redis / nginx 已自行安装时使用）
#
# 与 server-setup.sh 的区别：本脚本不安装、不升级任何软件包，不改 Redis 配置。
# 只做：建库建表 → 生成 .env → npm 依赖 → systemd 守护 → nginx 反代 → 健康检查。
# 可重复执行（幂等）；重跑会复用已有 backend/.env 中的数据库密码。
#
# 用法（服务器上 root 执行）：
#   sudo bash /opt/jz-mahjong/deploy/deploy-app.sh --domain game.example.com
#   sudo bash /opt/jz-mahjong/deploy/deploy-app.sh --domain game.example.com --db-password '已有密码'
#
# 常用参数：
#   --src DIR            代码目录，默认 /opt/jz-mahjong
#   --domain DOMAIN      配置 nginx 反代；不给则只监听 :3000
#   --db-password PWD    已有数据库密码；不给则读取旧 .env 或自动生成
#   --db-user / --db-name / --db-host / --db-port
#   --redis-host / --redis-port / --port
#   --cors-origins LIST  跨域白名单，默认 *
#   --wx-appid / --wx-secret
#   --skip-db            库已建好且不想脚本碰 PG 时跳过
#   --skip-nginx         已有自己的 nginx 配置时跳过
set -euo pipefail

SRC="/opt/jz-mahjong"
DOMAIN=""
DB_HOST="127.0.0.1"
DB_PORT="5432"
DB_USER="mahjong"
DB_NAME="mahjong"
DB_PASSWORD=""
REDIS_HOST="127.0.0.1"
REDIS_PORT="6379"
PORT="3000"
CORS_ORIGINS="*"
WX_APPID=""
WX_SECRET=""
SKIP_DB=0
SKIP_NGINX=0
NPM_REGISTRY="https://mirrors.cloud.tencent.com/npm/"
NGINX_CONF=""
ACME_WEBROOT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --src)           SRC="$2"; shift 2 ;;
    --domain)        DOMAIN="$2"; shift 2 ;;
    --db-password)   DB_PASSWORD="$2"; shift 2 ;;
    --db-user)       DB_USER="$2"; shift 2 ;;
    --db-name)       DB_NAME="$2"; shift 2 ;;
    --db-host)       DB_HOST="$2"; shift 2 ;;
    --db-port)       DB_PORT="$2"; shift 2 ;;
    --redis-host)    REDIS_HOST="$2"; shift 2 ;;
    --redis-port)    REDIS_PORT="$2"; shift 2 ;;
    --port)          PORT="$2"; shift 2 ;;
    --cors-origins)  CORS_ORIGINS="$2"; shift 2 ;;
    --wx-appid)      WX_APPID="$2"; shift 2 ;;
    --wx-secret)     WX_SECRET="$2"; shift 2 ;;
    --nginx-conf)    NGINX_CONF="$2"; shift 2 ;;
    --webroot)       ACME_WEBROOT="$2"; shift 2 ;;
    --skip-db)       SKIP_DB=1; shift ;;
    --skip-nginx)    SKIP_NGINX=1; shift ;;
    -h|--help)       sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "未知参数: $1（用 --help 查看用法）"; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "请用 root / sudo 执行"; exit 1; }
[ -f "$SRC/backend/src/server.js" ] || { echo "未找到代码：$SRC/backend/src/server.js"; exit 1; }
[[ "$DB_USER" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "非法数据库用户名: $DB_USER"; exit 1; }
[[ "$DB_NAME" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "非法数据库名: $DB_NAME"; exit 1; }

# 面板 / 源码安装的 PostgreSQL 常把 psql 放在非 PATH 目录（如 /www/server/pgsql/bin）
PSQL_BIN="$(command -v psql || true)"
if [ -z "$PSQL_BIN" ]; then
  for d in /www/server/pgsql/bin /usr/local/pgsql/bin /usr/pgsql-*/bin /usr/lib/postgresql/*/bin; do
    if [ -x "$d/psql" ]; then PSQL_BIN="$d/psql"; break; fi
  done
fi
[ -n "$PSQL_BIN" ] || { echo "找不到 psql，请把 PostgreSQL 的 bin 目录加入 PATH"; exit 1; }
export PATH="$(dirname "$PSQL_BIN"):$PATH"

# ---------- 1. 环境自检（只读，不安装任何东西） ----------
echo "[1/7] 环境自检"
for cmd in node npm redis-cli systemctl openssl curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "缺少命令 $cmd，请先在服务器上安装"; exit 1; }
done
NODE_BIN="$(readlink -f "$(command -v node)")"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node 需 >= 18，当前 $(node -v)"; exit 1; }
echo "  Node     : $(node -v)  ($NODE_BIN)"
echo "  $("$PSQL_BIN" --version | head -1)"
echo "  $(redis-cli --version)"
for s in postgresql postgresql-16 pgsql redis-server redis nginx; do
  state="$(systemctl is-active "$s" 2>/dev/null || true)"
  printf '  %-16s %s\n' "$s" "${state:--}"
done

# ---------- 2. 数据库 ----------
echo "[2/7] 数据库"
# 重跑时复用服务器已有的密码，避免生成新密码后连不上已有角色
if [ -z "$DB_PASSWORD" ] && [ -f "$SRC/backend/.env" ]; then
  DB_PASSWORD="$(grep -E '^PG_PASSWORD=' "$SRC/backend/.env" | head -1 | cut -d= -f2- || true)"
fi
[ -n "$DB_PASSWORD" ] || DB_PASSWORD="$(openssl rand -hex 16)"

db_ok() {
  PGPASSWORD="$DB_PASSWORD" psql -w -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -tAc 'SELECT 1' >/dev/null 2>&1
}
psql_pg() { runuser -u postgres -- "$PSQL_BIN" "$@"; }

if [ "$SKIP_DB" -eq 0 ]; then
  if ! db_ok && id postgres >/dev/null 2>&1; then
    echo "  目标账号尚不可用，尝试用 postgres 超级用户创建角色/库"
    ESC_PWD="${DB_PASSWORD//\'/\'\'}"
    if ! psql_pg -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
      psql_pg -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${ESC_PWD}'" >/dev/null
    fi
    if ! psql_pg -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
      psql_pg -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}" >/dev/null
    fi
    # 仅在 TCP 密码认证仍不通时补本机 hba 规则（不改已配好的环境）
    HBA="$(psql_pg -tAc 'SHOW hba_file' | tr -d ' \n')"
    if ! db_ok && [ -n "$HBA" ]; then
      echo "  [warn] 补一条仅 127.0.0.1 的 pg_hba 规则"
      grep -q "host  ${DB_NAME}  ${DB_USER}  127.0.0.1/32  scram" "$HBA" \
        || sed -i "1ihost  ${DB_NAME}  ${DB_USER}  127.0.0.1/32  scram-sha-256" "$HBA"
      psql_pg -c "SELECT pg_reload_conf()" >/dev/null
    fi
    if ! db_ok && [ -n "$HBA" ]; then
      grep -q "host  ${DB_NAME}  ${DB_USER}  127.0.0.1/32  trust" "$HBA" \
        || sed -i "1ihost  ${DB_NAME}  ${DB_USER}  127.0.0.1/32  trust" "$HBA"
      psql_pg -c "SELECT pg_reload_conf()" >/dev/null
    fi
  fi
  if ! db_ok; then
    echo "无法连接 PostgreSQL：请确认服务已启动、pg_hba.conf 允许本机密码登录，"
    echo "或角色已存在时用 --db-password '已有密码' 传入。当前 ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
    exit 1
  fi
  PGPASSWORD="$DB_PASSWORD" psql -w -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -f "$SRC/database/schema.sql" >/dev/null
  echo "  表数: $(PGPASSWORD="$DB_PASSWORD" psql -w -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
else
  echo "  已跳过（--skip-db）"
fi

# ---------- 3. Redis ----------
echo "[3/7] Redis"
if ! redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
  echo "Redis 未就绪：${REDIS_HOST}:${REDIS_PORT}，请先启动 redis-server"; exit 1
fi
echo "  $(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping)"

# ---------- 4. 生产配置 ----------
echo "[4/7] 生成 backend/.env"
cat > "$SRC/backend/.env" <<EOF
PORT=${PORT}
PG_HOST=${DB_HOST}
PG_PORT=${DB_PORT}
PG_USER=${DB_USER}
PG_PASSWORD=${DB_PASSWORD}
PG_DATABASE=${DB_NAME}
REDIS_HOST=${REDIS_HOST}
REDIS_PORT=${REDIS_PORT}
WX_APPID=${WX_APPID}
WX_SECRET=${WX_SECRET}
CORS_ORIGINS=${CORS_ORIGINS}
TOKEN_TTL_DAYS=7
EOF
chmod 600 "$SRC/backend/.env"

# ---------- 5. 依赖与运行用户 ----------
echo "[5/7] 安装后端依赖"
if ! id -u mahjong >/dev/null 2>&1; then
  NOLOGIN="$(command -v nologin || echo /sbin/nologin)"
  useradd -r -m -s "$NOLOGIN" mahjong
fi
chown -R mahjong:mahjong "$SRC"
cd "$SRC/backend"
# 面板版 Node 常把 npm 全局 cache 指向 root 所有目录，改用项目内可写缓存
rm -rf node_modules
NPM_CACHE="$SRC/.npm-cache"
mkdir -p "$NPM_CACHE"
chown mahjong:mahjong "$NPM_CACHE"
NPM_PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
if [ -f package-lock.json ]; then
  runuser -u mahjong -- env PATH="$NPM_PATH" \
    npm ci --omit=dev --no-audit --no-fund --cache "$NPM_CACHE" --registry="$NPM_REGISTRY"
else
  runuser -u mahjong -- env PATH="$NPM_PATH" \
    npm install --omit=dev --no-audit --no-fund --cache "$NPM_CACHE" --registry="$NPM_REGISTRY"
fi

# ---------- 6. 进程守护 + nginx ----------
echo "[6/7] 配置 systemd 服务"
cat > /etc/systemd/system/jz-mahjong.service <<EOF
[Unit]
Description=JZ Three Mahjong Backend (HTTP + WebSocket)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mahjong
Group=mahjong
WorkingDirectory=${SRC}/backend
EnvironmentFile=${SRC}/backend/.env
ExecStart=${NODE_BIN} ${SRC}/backend/src/server.js
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

if [ -n "$DOMAIN" ] && [ "$SKIP_NGINX" -eq 0 ]; then
  command -v nginx >/dev/null 2>&1 || { echo "未找到 nginx，请安装或改用 --skip-nginx"; exit 1; }
  echo "  配置 nginx 反代: ${DOMAIN}"
  # 面板版 nginx 的 vhost 目录与标准安装不同，自动探测实际被 include 的目录
  if [ -z "$NGINX_CONF" ]; then
    if [ -d /www/server/panel/vhost/nginx ]; then
      NGINX_CONF=/www/server/panel/vhost/nginx/jz-mahjong.conf
    else
      mkdir -p /etc/nginx/conf.d
      NGINX_CONF=/etc/nginx/conf.d/jz-mahjong.conf
    fi
  fi
  if [ -z "$ACME_WEBROOT" ]; then
    if [ -d /www/wwwroot ]; then ACME_WEBROOT=/www/wwwroot;
    elif [ -d /var/www/html ]; then ACME_WEBROOT=/var/www/html;
    else ACME_WEBROOT=/www/server/nginx/html; fi
  fi
  mkdir -p "$ACME_WEBROOT/.well-known/acme-challenge"
  echo "  配置文件: $NGINX_CONF"
  echo "  证书验证目录: $ACME_WEBROOT"
  if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    sed -e "s/YOUR_DOMAIN/${DOMAIN}/g" \
        -e "s#127.0.0.1:3000#127.0.0.1:${PORT}#g" \
        -e "s#/var/www/html#${ACME_WEBROOT}#g" \
      "$SRC/deploy/nginx-wss.conf.example" > "$NGINX_CONF"
    # nginx >= 1.25 弃用 listen ... http2 参数，改用独立 http2 指令
    NGINX_MINOR="$(nginx -v 2>&1 | sed -nE 's#.*nginx/1\.([0-9]+).*#\1#p')"
    if [ -n "$NGINX_MINOR" ] && [ "$NGINX_MINOR" -ge 25 ]; then
      sed -i 's/listen 443 ssl http2;/listen 443 ssl;\n    http2 on;/' "$NGINX_CONF"
    fi
    echo "  证书已就绪 → HTTPS/WSS"
  else
    cat > "$NGINX_CONF" <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root ${ACME_WEBROOT}; }
    location / {
        proxy_pass http://127.0.0.1:${PORT};
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
    echo "  证书未就绪 → 当前仅 HTTP 反代，申请证书后重跑本脚本切 HTTPS/WSS"
  fi
  nginx -t
  systemctl enable --now nginx >/dev/null
  systemctl reload nginx
fi

# ---------- 7. 验证 ----------
echo "[7/7] 健康检查"
HEALTH=""
for _ in $(seq 1 20); do
  if HEALTH="$(curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/health" 2>/dev/null)"; then break; fi
  sleep 1
done
[ -n "$HEALTH" ] || { echo "健康检查失败，日志："; journalctl -u jz-mahjong -n 40 --no-pager; exit 1; }
echo "  /health : $HEALTH"
echo "  服务日志（应显示 pg=connected redis=connected）："
journalctl -u jz-mahjong -n 5 --no-pager
if [ -n "$DOMAIN" ] && [ "$SKIP_NGINX" -eq 0 ]; then
  echo "  nginx http  : $(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 -H "Host: $DOMAIN" http://127.0.0.1/health)"
  if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    echo "  nginx https : $(curl -sk -o /dev/null -w '%{http_code}' --max-time 3 -H "Host: $DOMAIN" https://127.0.0.1/health)"
  fi
fi

echo "部署完成"
echo "  数据库密码 : ${DB_PASSWORD}"
echo "  服务管理   : systemctl status jz-mahjong / journalctl -u jz-mahjong -f"
if [ -n "$DOMAIN" ] && [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  echo "  下一步     : certbot --nginx -d ${DOMAIN} && sudo bash ${SRC}/deploy/deploy-app.sh --domain ${DOMAIN}"
fi
echo "  前端       : frontend/js/net/env.js 的 PROD_DOMAIN 改为 ${DOMAIN:-你的域名}，并在微信公众平台配合法域名"
echo "  端到端验证 : node ${SRC}/backend/tools/smoke.js"
