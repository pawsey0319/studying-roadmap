#!/usr/bin/env bash
# 把本地改动提交并推送到 GitHub，推送后 GitHub Actions 会自动重新部署网站。
# 用法：bash tools/publish.sh "提交说明"
# 如果存在 .deploy-token（只对 studying-roadmap 仓库有 Contents 读写权限的细粒度令牌），用它推送；
# 否则使用本机已有的 git 凭据。
set -euo pipefail
cd "$(dirname "$0")/.."

git add -A -- index.html app.js data tools .github .gitignore README.md
if git diff --cached --quiet; then
  echo "没有需要发布的改动"
  exit 0
fi

git -c user.name="pawsey0319" -c user.email="pawsey0319@users.noreply.github.com" \
  commit -q -m "${1:-更新学习路线网站}"

if [ -f .deploy-token ]; then
  auth=$(printf 'x-access-token:%s' "$(tr -d '[:space:]' < .deploy-token)" | base64 | tr -d '\n')
  git -c http.extraHeader="Authorization: Basic ${auth}" push -q origin HEAD:main
else
  git push -q origin HEAD:main
fi
echo "已推送，网站会在一两分钟后更新"
