#!/usr/bin/env bash
# Compile and run the pure-Kotlin core verification suite WITHOUT an Android SDK.
# Requires kotlinc (2.0+) and java (17+) on PATH. Useful in CI before the
# (much slower) Android build.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${TMPDIR:-/tmp}/vidlyrics-core-verify"
mkdir -p "$OUT"
kotlinc "$HERE/src/main/kotlin/com/vidlyrics/core/"*.kt \
        "$HERE/src/test/kotlin/com/vidlyrics/core/CoreSelfTest.kt" \
        -include-runtime -d "$OUT/coretest.jar"
java -jar "$OUT/coretest.jar"
