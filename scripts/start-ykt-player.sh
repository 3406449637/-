#!/usr/bin/env bash
set -u

LOG_DIR="$HOME/.ykt-player-logs"
PROFILE="$HOME/.ykt-edge-profile"
mkdir -p "$LOG_DIR"

if [ -z "${DISPLAY:-}" ]; then
  echo "错误：当前终端没有 DISPLAY。请在图形桌面的终端里运行此脚本。"
  exit 1
fi

if ! command -v Xephyr >/dev/null 2>&1; then
  echo "错误：找不到 Xephyr。请先运行：sudo apt install xephyr"
  exit 1
fi

if ! command -v openbox >/dev/null 2>&1; then
  echo "错误：找不到 openbox。请先运行：sudo apt install openbox"
  exit 1
fi

EDGE_BIN="$(command -v microsoft-edge-stable || command -v microsoft-edge || true)"
if [ -z "$EDGE_BIN" ]; then
  echo "错误：找不到 Microsoft Edge。请确认已安装 Linux 版 Edge。"
  exit 1
fi

DISP=""
for n in 2 3 4 5 6 7 8 9; do
  if [ ! -e "/tmp/.X${n}-lock" ] && [ ! -e "/tmp/.X11-unix/X${n}" ]; then
    DISP=":${n}"
    NUM="$n"
    break
  fi
done

if [ -z "$DISP" ]; then
  echo "错误：:2 到 :9 都已被占用，请先清理不再使用的 Xephyr。"
  exit 1
fi

echo "使用显示 $DISP（宿主 DISPLAY=$DISPLAY）"
echo "日志目录：$LOG_DIR"

nohup Xephyr -br -ac -noreset -screen 1600x900 "$DISP" \
  >"$LOG_DIR/xephyr${NUM}.log" 2>&1 &
sleep 1

if ! pgrep -f "Xephyr.*${DISP}" >/dev/null 2>&1; then
  echo "Xephyr 启动失败，日志末尾："
  tail -30 "$LOG_DIR/xephyr${NUM}.log" 2>/dev/null || true
  exit 1
fi

nohup env DISPLAY="$DISP" openbox \
  >"$LOG_DIR/openbox${NUM}.log" 2>&1 &
sleep 1

if ! pgrep -x openbox >/dev/null 2>&1; then
  echo "警告：没有检测到 openbox 进程，窗口焦点可能不正常。日志末尾："
  tail -30 "$LOG_DIR/openbox${NUM}.log" 2>/dev/null || true
fi

# Force X11 and remove the host Wayland socket, so Edge opens inside Xephyr
# instead of leaking onto the host Wayland display.
nohup env -u WAYLAND_DISPLAY DISPLAY="$DISP" XDG_SESSION_TYPE=x11 "$EDGE_BIN" \
  --ozone-platform=x11 \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  >"$LOG_DIR/edge${NUM}.log" 2>&1 &
sleep 1

if ! pgrep -f "user-data-dir=$PROFILE" >/dev/null 2>&1; then
  echo "警告：没有检测到 Edge 进程。日志末尾："
  tail -30 "$LOG_DIR/edge${NUM}.log" 2>/dev/null || true
fi

echo
echo "已启动 Xephyr $DISP。"
echo "请在弹出的 Xephyr 窗口中完成："
echo "  1. 登录雨课堂"
echo "  2. 安装 Tampermonkey"
echo "  3. 安装/更新雨课堂视频队列脚本 1.3.1"
echo "  4. 允许本站弹窗，并开启 Edge 的“允许用户脚本”"
echo
echo "把 Xephyr 窗口放到另一个虚拟桌面或副屏，不要最小化。"
echo "如果失败，查看 $LOG_DIR 下的日志。"
