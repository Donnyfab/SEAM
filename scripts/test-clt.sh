#!/bin/bash
# Runs `swift test` on a Command-Line-Tools-only machine (no Xcode), where Swift Testing's
# framework and interop dylib are not on the default search paths. Unneeded once Xcode is installed.
set -euo pipefail
D=/Library/Developer/CommandLineTools/Library/Developer
cd "$(dirname "$0")/.."
exec swift test -Xswiftc -F -Xswiftc "$D/Frameworks" -Xlinker -F -Xlinker "$D/Frameworks" \
  -Xlinker -rpath -Xlinker "$D/Frameworks" -Xlinker -rpath -Xlinker "$D/usr/lib" "$@"
