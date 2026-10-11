#!/bin/zsh
# 编译 Diem.app：打包网页和命令 → 编译 Swift 外壳（Apple 芯片 + Intel）→ 拷资源 → 生成图标 → 签名
# Build Diem.app: bundle the web UI and CLI tools → compile the Swift shell (universal) → copy resources → icon → sign
set -euo pipefail
APP_SRC="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$APP_SRC/.." && pwd)"
APP="$ROOT/outputs/Diem.app"
C="$APP/Contents"

cd "$APP_SRC"
[ -d node_modules ] || npm install --silent
npx tsc --noEmit -p .
node tools/build.mjs

rm -rf "$APP"
mkdir -p "$C/MacOS" "$C/Resources"
BIN_TMP="$(mktemp -d)"
for arch in arm64 x86_64; do
  xcrun swiftc -O "$APP_SRC/native/main.swift" "$APP_SRC/native/AppDelegate.swift" -target "$arch-apple-macos14.0" -o "$BIN_TMP/Diem-$arch" \
    -framework Cocoa -framework WebKit -framework UserNotifications -framework CoreLocation -framework CoreWLAN -framework EventKit
done
lipo -create "$BIN_TMP/Diem-arm64" "$BIN_TMP/Diem-x86_64" -output "$C/MacOS/Diem"
rm -rf "$BIN_TMP"
cp "$APP_SRC/native/Info.plist" "$C/Info.plist"
cp -R "$APP_SRC/native/en.lproj" "$APP_SRC/native/zh-Hans.lproj" "$C/Resources/"
cp "$APP_SRC/web/dist/index.html" "$APP_SRC/web/dist/app.js" "$APP_SRC/web/dist/style.css" "$C/Resources/"
# 工作目录要用的：bin/ 下的命令、给 Claude Code 的规则、第一次打开时的示例
cp -R "$APP_SRC/web/dist/bin" "$C/Resources/bin"
cp -R "$ROOT/workspace-rules" "$C/Resources/workspace-rules"
cp -R "$ROOT/example-workspace" "$C/Resources/example-workspace"

ICONSET="$ROOT/outputs/.Diem.iconset"
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
sips -s format png -z 1024 1024 "$APP_SRC/native/Diem.svg" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
for s in 16 32 128 256 512; do
  sips -z $s $s "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); [ $s -lt 512 ] && sips -z $d $d "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$C/Resources/Diem.icns"
rm -rf "$ICONSET"
codesign --force --deep --sign - "$APP"
echo "Built: $APP"
