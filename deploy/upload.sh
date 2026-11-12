#!/usr/bin/env bash
# 从本机（Mac）上传代码到腾讯云轻量服务器并执行部署
#
# 前置：已把 ~/.ssh/jz_mahjong_deploy.pub 加入服务器 ~/.ssh/authorized_keys
# 用法：
#   ./deploy/upload.sh root@1.2.3.4 --domain game.example.com
#   ./deploy/upload.sh ubuntu@1.2.3.4 --app-only --domain game.example.com
#   ./deploy/upload.sh root@1.2.3.4 --domain game.example.com --db-password '强密码'
#
# --app-only：服务器已自行装好 Node/PG/Redis/nginx 时，改用 deploy/deploy-app.sh
#             （只做建库/配置/守护/反代，不安装任何软件包）
#
# 说明：本地 backend/.env、node_modules、.git、私有配置不会上传；
#       服务器上的 backend/.env 由部署脚本生成并保持不被覆盖。
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "用法: $0 <用户@公网IP> [--app-only] [--domain 域名] [--db-password 密码] [--wx-appid ID] [--wx-secret SECRET]"
  exit 1
fi

TARGET="$1"; shift
SCRIPT="deploy/server-setup.sh"
if [ "${1:-}" = "--app-only" ]; then
  SCRIPT="deploy/deploy-app.sh"
  shift
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="${JZ_SSH_KEY:-$HOME/.ssh/jz_mahjong_deploy}"
REMOTE_DIR="${JZ_REMOTE_DIR:-/opt/jz-mahjong}"

[ -f "$KEY" ] || { echo "找不到私钥：$KEY"; exit 1; }

SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes)
ssh_run() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }

echo "[1/4] 连通性检查"
ssh_run 'echo "  登录用户: $(id -un)"; . /etc/os-release; echo "  系统: $PRETTY_NAME"' || {
  echo "SSH 连接失败：请确认公钥已加入服务器 authorized_keys，且 IP / 用户名正确"; exit 1;
}

echo "[2/4] 准备远端目录"
ssh_run "if [ \$(id -u) -eq 0 ] || ! command -v sudo >/dev/null 2>&1; then mkdir -p $REMOTE_DIR; chown -R \$(id -un) $REMOTE_DIR; else sudo mkdir -p $REMOTE_DIR; sudo chown -R \$(id -un) $REMOTE_DIR; fi"

echo "[3/4] 上传代码（排除本地敏感文件）"
rsync -az --delete \
  -e "ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes" \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.npm-cache/' \
  --exclude='.env' \
  --exclude='frontend/project.private.config.json' \
  --exclude='*.log' \
  --exclude='*.tar.gz' \
  --exclude='.DS_Store' \
  "$ROOT/" "$TARGET:$REMOTE_DIR/"

echo "[4/4] 执行服务器部署脚本：$SCRIPT"
ARGS=""
if [ $# -gt 0 ]; then ARGS="$(printf '%q ' "$@")"; fi
ssh_run "cd $REMOTE_DIR && if command -v sudo >/dev/null 2>&1; then sudo bash $SCRIPT $ARGS; else bash $SCRIPT $ARGS; fi"

echo "完成。证书就绪后可用浏览器访问 https://<你的域名>/health 验证。"
