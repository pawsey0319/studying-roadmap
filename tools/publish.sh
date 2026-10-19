#!/usr/bin/env bash
# 把本地改动提交并推送到 GitHub，推送后 GitHub Actions 会自动重新部署网站。
# 用法：bash tools/publish.sh "提交说明"
# 如果仓库根目录有 .deploy-token（只对 studying-roadmap 有 Contents 读写权限的细粒度令牌），用它推送；
# 否则使用这台电脑已有的 git 凭据。推送前会先拉取远端改动，避免多台电脑之间冲突。
set -euo pipefail
cd "$(dirname "$0")/.."

auth_args=()
if [ -f .deploy-token ]; then
  auth=$(printf 'x-access-token:%s' "$(tr -d '[:space:]' < .deploy-token)" | base64 | tr -d '\n')
  auth_args=(-c "http.extraHeader=Authorization: Basic ${auth}")
fi

git add -A -- index.html app.js data tools .github .gitignore README.md UPDATE.md AGENTS.md CLAUDE.md
if ! git diff --cached --quiet; then
  name=$(git config user.name || true); email=$(git config user.email || true)
  git -c user.name="${name:-pawsey0319}" -c user.email="${email:-pawsey0319@users.noreply.github.com}" \
    commit -q -m "${1:-更新学习路线网站}"
fi

# 远端已有 main 时先拉取（第一次推送到空仓库时跳过）
if git ${auth_args[@]+"${auth_args[@]}"} ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
  git ${auth_args[@]+"${auth_args[@]}"} pull -q --rebase origin main
  if [ -z "$(git log origin/main..HEAD --oneline)" ]; then
    echo "没有需要发布的改动"
    exit 0
  fi
fi
git ${auth_args[@]+"${auth_args[@]}"} push -q origin HEAD:main
echo "已推送，网站会在一两分钟后更新"
