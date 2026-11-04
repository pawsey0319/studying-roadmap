#!/usr/bin/env bash
# 公司电脑上的每周整理：模型接口在公司内网，GitHub Actions 连不上，所以“整理”这一步放在这里跑。
#
# 流程：每周一 GitHub Actions 采集候选并提交 data/weekly-candidates.json → 这台电脑拉取 → 用内网模型整理 → 测试 → 推送 → 网站自动重新部署。
# 同一周的候选只整理一次，所以这个脚本可以每天跑，没有新候选时几秒钟就退出。
#
# 模型 Key 放在仓库之外的文件里（默认 ~/.config/learning-hub/llm.env，权限 600），不会被提交：
#   LLM_BASE=https://内网接口地址/v1
#   LLM_KEY=你的 Key
#   LLM_MODEL=模型名1,模型名2
# 用法：bash tools/weekly_local.sh          （加 --force 可以重新整理这一周）
set -euo pipefail
# 定时任务（launchd）里 PATH 很短，补上 Homebrew 等常见位置
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")/.."

ENV_FILE="${LH_ENV_FILE:-$HOME/.config/learning-hub/llm.env}"
LOG_DIR="$HOME/.config/learning-hub"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_DIR/weekly.log") 2>&1
echo "==== $(date '+%F %T') 每周整理（本机） ===="

if [ ! -f "$ENV_FILE" ]; then
  echo "没有找到 $ENV_FILE，先运行 bash tools/setup_local.sh"; exit 1
fi
if [ "$(uname)" = "Darwin" ] || [ "$(uname)" = "Linux" ]; then
  perm=$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")
  [ "$perm" = "600" ] || { chmod 600 "$ENV_FILE"; echo "已把 $ENV_FILE 的权限改成只有自己能读"; }
fi
if grep -q "在这里填" "$ENV_FILE"; then
  echo "$ENV_FILE 里还有没填的项（“在这里填…”），填好后再跑"; exit 1
fi
export LH_ENV_FILE="$ENV_FILE"   # 由 weekly.py 自己读取，容忍空格和引号

PY=python3; command -v python3 >/dev/null 2>&1 || PY=python

# 本地有没提交的改动时不动它，免得和你手上的修改混在一起
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "仓库里有没提交的改动，这次跳过。提交或撤销后再跑。"; exit 0
fi
git pull -q --rebase origin main

"$PY" tools/weekly.py --stage ai "$@"
"$PY" tools/translate.py || echo "翻译失败，英文界面这周显示中文原文"
if command -v node >/dev/null 2>&1; then
  node --test tests/*.test.js >/dev/null || { echo "测试没通过，这次不推送"; git checkout -- content; exit 1; }
else
  echo "这台电脑没装 Node.js，跳过本机测试（网站部署前 GitHub 还会再测一次）"
fi

git add content/feed.json content/routes.json content/suggestions.json src/i18n-en.json
if git diff --cached --quiet; then echo "没有需要发布的变化"; exit 0; fi
name=$(git config user.name || true); email=$(git config user.email || true)
git -c user.name="${name:-pawsey0319}" -c user.email="${email:-pawsey0319@users.noreply.github.com}" \
  commit -q -m "每周整理 $(date +%F)（本机内网模型）"
git push -q origin HEAD:main
echo "已推送，网站一两分钟后更新"
