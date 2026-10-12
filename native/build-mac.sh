#!/bin/sh
# Builds the native macOS helpers into bin/. UNIVERSAL=1 builds arm64 + x86_64 (for releases).
set -e
cd "$(dirname "$0")/.."
mkdir -p bin

swift_build() { # <source> <output>
  if [ "$UNIVERSAL" = "1" ]; then
    swiftc -O -target arm64-apple-macos13 "$1" -o "$2-arm64"
    swiftc -O -target x86_64-apple-macos13 "$1" -o "$2-x86_64"
    lipo -create "$2-arm64" "$2-x86_64" -output "$2"
    rm "$2-arm64" "$2-x86_64"
  else
    swiftc -O "$1" -o "$2"
  fi
}

[ "$UNIVERSAL" != "1" ] && [ bin/au-snapshot -nt native/snapshot.swift ] || swift_build native/snapshot.swift bin/au-snapshot
[ "$UNIVERSAL" != "1" ] && [ bin/livecapture -nt native/livecapture.swift ] || swift_build native/livecapture.swift bin/livecapture
[ "$UNIVERSAL" != "1" ] && [ -x bin/vst3-snapshot ] || sh native/build-vst3.sh
echo "native helpers ready"
