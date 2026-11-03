#!/usr/bin/env bash
# 一次性配置“公司内网模型”方案（macOS）。在公司电脑的终端里运行：
#   bash ~/Desktop/学习/learning-hub/tools/setup_local.sh
# 它会：
#   1. 建好配置文件 ~/.config/learning-hub/llm.env（权限 600，在仓库之外，不会被提交），里面留好要你填的三行；
#   2. 装一个每天 10:30 自动运行 weekly_local.sh 的定时任务（launchd，电脑睡眠错过时会在唤醒后补跑）；
#   3. 填好 Key 之后再运行一次本脚本，会测试模型接口能不能用。
# 重复运行没有副作用。卸载：bash tools/setup_local.sh --uninstall
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CFG_DIR="$HOME/.config/learning-hub"
ENV_FILE="$CFG_DIR/llm.env"
LABEL="com.learning-hub.weekly"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "已删除定时任务。配置文件 $ENV_FILE 保留（里面有 Key，不需要了可以手动删除）。"
  exit 0
fi

mkdir -p "$CFG_DIR" "$HOME/Library/LaunchAgents"

# 1. 配置文件
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<'EOF'
# 学习网站：公司内网模型的配置。只保存在这台电脑上，不会进仓库。
# 把下面三行等号后面的内容换成你的（不要加引号）：
LLM_BASE=在这里填内网接口地址，到 /v1 为止，例如 https://llm.xxx.com/v1
LLM_KEY=在这里填你的 Key
LLM_MODEL=在这里填模型名，可以写多个、用逗号分隔，第一个失败自动换下一个

# 可选：内网接口用的是公司自签证书、报 SSL 证书错误时，填证书文件路径
# LLM_CA_FILE=/path/to/company-ca.pem
EOF
  echo "✓ 已创建配置文件：$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

# 2. 定时任务：每天 10:30
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$REPO/tools/weekly_local.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$CFG_DIR/launchd.log</string>
  <key>StandardErrorPath</key><string>$CFG_DIR/launchd.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓ 已安装定时任务：每天 10:30 运行（电脑睡眠时错过的会在唤醒后补跑）"

# 3. 检查
command -v python3 >/dev/null 2>&1 && echo "✓ Python：$(python3 --version 2>&1)" || echo "✗ 没有 python3：在终端运行 xcode-select --install 安装"
command -v node >/dev/null 2>&1 && echo "✓ Node.js：$(node --version)" || echo "· 没有 Node.js（可选，只用来在推送前跑测试；GitHub 部署前还会再测）"
git -C "$REPO" ls-remote --exit-code origin main >/dev/null 2>&1 && echo "✓ 能连上 GitHub 仓库" || echo "✗ 连不上 GitHub 仓库，或这台电脑没登录 GitHub：先手动 git push 一次让它记住登录"

if grep -q "在这里填" "$ENV_FILE"; then
  echo
  echo "还差一步：打开 $ENV_FILE ，把三处“在这里填…”换成你的地址、Key、模型名。"
  echo "  可以运行：open -e \"$ENV_FILE\""
  echo "填好后再运行一次本脚本，会测试模型接口。"
  exit 0
fi

echo
echo "正在测试模型接口……"
export LH_ENV_FILE="$ENV_FILE"   # 由 weekly.py 自己读取，容忍空格和引号
if python3 "$REPO/tools/weekly.py" --stage ping; then
  echo
  echo "全部配置好了。每周一云端采集候选后，这台电脑会在当天（或之后第一次开机连内网时）自动整理并发布。"
  echo "想现在就跑一次：bash \"$REPO/tools/weekly_local.sh\""
  echo "运行记录：$CFG_DIR/weekly.log"
else
  echo "模型接口测试没通过。检查 llm.env 里的地址、Key、模型名，以及这台电脑是否连着公司内网，改好后再运行本脚本。"
  exit 1
fi
