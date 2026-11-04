#!/usr/bin/env bash
# Offline verification without the Android SDK.
#
#   1. Always: compile + run the 145-check pure-Kotlin core suite (kotlinc + java).
#   2. Optional: type-check the Android app layer when an API-35 android.jar and
#      a directory of compile-only Jetpack API contracts are supplied:
#
#        ANDROID_JAR=$ANDROID_HOME/platforms/android-35/android.jar \
#        API_STUBS_DIR=/path/to/contract-stubs \
#        ./tools/verify-offline.sh
#
# The contracts are deliberately NOT part of this repository: shipping fake
# declarations next to real sources would invite accidental use in a build.
# A real Gradle build (./gradlew :app:assembleDebug) is the authoritative check.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/vidlyrics-offline-verify"
mkdir -p "$OUT"

if ! command -v kotlinc >/dev/null 2>&1; then
  echo "kotlinc not found on PATH (Kotlin 2.0+ required)." >&2; exit 1
fi
if ! command -v java >/dev/null 2>&1; then
  echo "java not found on PATH (JDK 17+ required)." >&2; exit 1
fi

echo "== Core suite =="
"$HERE/core/verify.sh"

if [[ -n "${ANDROID_JAR:-}" && -n "${API_STUBS_DIR:-}" ]]; then
  echo "== App layer type-check (API contracts) =="
  mapfile -t STUBS < <(find "$API_STUBS_DIR" -name '*.kt' | sort)
  mapfile -t CORE < <(find "$HERE/core/src/main/kotlin" -name '*.kt' | sort)
  mapfile -t APP  < <(find "$HERE/app/src/main/java" -name '*.kt' | sort)
  kotlinc -cp "$ANDROID_JAR" "${STUBS[@]}" "${CORE[@]}" "${APP[@]}" \
      -d "$OUT/app-typecheck.jar"
  echo "App layer type-check passed (${#APP[@]} Kotlin files)."
else
  echo "Skipping app layer type-check (set ANDROID_JAR and API_STUBS_DIR to enable)."
fi
