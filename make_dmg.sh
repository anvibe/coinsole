#!/bin/bash
# Makes build/Coinsole-<version>.dmg: open it and drag Coinsole onto Applications.
#
#   ./make_dmg.sh
#
# So that it opens on other Macs without a warning, the app has to be signed and notarised. That needs
# an Apple Developer Program membership and, once per Mac:
#
#   1. a "Developer ID Application" certificate: Xcode > Settings > Accounts > your team >
#      Manage Certificates > + > Developer ID Application
#   2. saved notary credentials (it asks for an app-specific password from account.apple.com):
#      xcrun notarytool store-credentials coinsole-notary --apple-id <your Apple ID> --team-id <your team ID>
#
# With both in place this script signs, notarises and staples the disk image by itself. Without them it
# still makes the image, signed ad hoc: people then choose System Settings > Privacy & Security >
# Open Anyway the first time. COINSOLE_SIGN_ID and COINSOLE_NOTARY_PROFILE override the defaults.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$SRC/VERSION")"
DMG="$SRC/build/Coinsole-$VERSION.dmg"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
SIGN_ID="${COINSOLE_SIGN_ID:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}"
PROFILE="${COINSOLE_NOTARY_PROFILE:-coinsole-notary}"

"$SRC/build.sh" "$TMP/build"
mkdir -p "$TMP/dmg" "$SRC/build"
cp -R "$TMP/build/Coinsole.app" "$TMP/dmg/"
ln -s /Applications "$TMP/dmg/Applications"
if [ -n "$SIGN_ID" ]; then
  echo "Signing with: $SIGN_ID"
  codesign --force --options runtime --timestamp -s "$SIGN_ID" "$TMP/dmg/Coinsole.app"
  codesign --verify --strict "$TMP/dmg/Coinsole.app"
fi
hdiutil create -quiet -volname Coinsole -srcfolder "$TMP/dmg" -fs HFS+ -format UDZO -ov "$DMG"

if [ -z "$SIGN_ID" ]; then
  echo "NOT NOTARISED: no \"Developer ID Application\" certificate on this Mac (see the top of this script)."
else
  codesign --force --timestamp -s "$SIGN_ID" "$DMG"
  if xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
    echo "Sending to Apple for notarisation (usually a few minutes)..."
    xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait | tee "$TMP/notary.log"
    grep -q "status: Accepted" "$TMP/notary.log" || { echo "Apple did not accept it: xcrun notarytool log <id> --keychain-profile $PROFILE"; exit 1; }
    xcrun stapler staple "$DMG"
    xcrun stapler validate "$DMG"
    echo "Signed and notarised."
  else
    echo "SIGNED BUT NOT NOTARISED: no saved notary credentials named \"$PROFILE\" (see the top of this script)."
  fi
fi
echo "Disk image: $DMG"
