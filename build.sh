#!/bin/bash
# Builds Coinsole.app. Needs macOS 12+ and Xcode's command line tools (xcode-select --install).
#
#   ./build.sh                 builds into ./build (Coinsole.app plus a Games folder with the built-in games)
#   ./build.sh ~/Desktop/Coinsole   builds into that folder instead
#
# Coinsole looks for its games in the "Games" folder next to the app. The built-in games
# (from games/) are copied there on every build; games you added yourself are left alone.
# They are also packed inside the app, for installed copies that have no folder next to them
# (see make_dmg.sh). The app runs on Apple silicon and Intel Macs, macOS 12 or later.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$SRC/VERSION")"
DEST="${1:-$SRC/build}"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
APP="$DEST/Coinsole.app"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
NEW="$TMP/Coinsole.app/Contents"
mkdir -p "$NEW/MacOS" "$NEW/Resources"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos12.0" "$SRC/main.swift" -o "$TMP/Coinsole-$arch"
done
lipo -create "$TMP/Coinsole-arm64" "$TMP/Coinsole-x86_64" -output "$NEW/MacOS/Coinsole"
cp -R "$SRC/ui" "$NEW/Resources/ui"
cp -R "$SRC/games" "$NEW/Resources/games"
rm -f "$NEW/Resources/games/"*.js "$NEW/Resources/games/"*.woff2 "$NEW/Resources/games/"*.txt   # the shared copies; each game has its own
cp "$SRC/LICENSE" "$SRC/ARTWORK.md" "$SRC/CREDITS.md" "$NEW/Resources/"
find "$NEW/Resources" -name .DS_Store -delete
swift "$SRC/make_icon.swift" "$TMP/icon.png"
mkdir "$TMP/icon.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$TMP/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$TMP/icon.png" --out "$TMP/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/icon.iconset" -o "$NEW/Resources/coinsole.icns"
cat > "$NEW/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Coinsole</string>
  <key>CFBundleDisplayName</key><string>Coinsole</string>
  <key>CFBundleIdentifier</key><string>local.coinsole</string>
  <key>CFBundleExecutable</key><string>Coinsole</string>
  <key>CFBundleIconFile</key><string>coinsole</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PL
# a fixed (ad-hoc) identity, so macOS remembers permissions (like Desktop folder access) across rebuilds
codesign --force -s - --identifier local.coinsole -r='designated => identifier "local.coinsole"' "$TMP/Coinsole.app"
rm -rf "${APP:?}"; mv "$TMP/Coinsole.app" "$APP"
# the built-in games
mkdir -p "$DEST/Games"
for game in "$SRC"/games/*/; do
  cp -R "${game%/}" "$DEST/Games/"
done
echo "Built: $APP"
