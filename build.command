#!/bin/zsh
# Diem: build & relaunch. Double-click this file. / 双击即可：退出 → 编译 → 打开。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/outputs/Diem.app"
pkill -f "Diem.app/Contents/MacOS/Diem" 2>/dev/null; sleep 1
zsh "$ROOT/app/build-app.sh" || { echo "Build failed. / 编译失败。"; exit 1; }
touch "$APP"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -x "$LSREG" ] && "$LSREG" -f "$APP" >/dev/null 2>&1
open "$APP"
