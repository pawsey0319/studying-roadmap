#!/usr/bin/env bash
# Build only: never signs a release, uploads, tags, deploys or publishes.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/app"
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) throw Error("Node 22+ required")'
JAVA_VERSION="$(java -version 2>&1)"
printf '%s\n' "$JAVA_VERSION"
if [[ ! "$JAVA_VERSION" =~ version\ \"21[\"\.] ]]; then
  echo 'JDK 21 required (set JAVA_HOME and PATH to the same JDK 21)' >&2; exit 1
fi
: "${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK with platforms android-36 and build-tools 36.0.0}"
if [[ ! -f "$ANDROID_HOME/platforms/android-36/android.jar" ]]; then
  echo 'Missing SDK platform android-36 (no automatic SDK download)' >&2; exit 1
fi
npm ci --no-audit --no-fund
bash build-web.sh
if [[ ! -f android/gradlew ]]; then npx cap add android; fi
npx cap sync android
python3 patch-android.py 1 0.0.0-verify
cd android
# Debug build uses Android debug signing, not any release credentials.
# Lint validates manifest/API usage; javac/assembleDebug compile actual Android+Capacitor code.
# Explicitly clear release env vars so local release credentials are not consumed.
env -u ANDROID_KEYSTORE_FILE -u ANDROID_KEYSTORE_PASSWORD -u ANDROID_KEY_ALIAS -u ANDROID_KEY_PASSWORD \
  bash ./gradlew --no-daemon :app:assembleDebug :app:lintDebug
printf '\nBuild-only output: %s\n' "$ROOT/app/android/app/build/outputs/apk/debug/app-debug.apk"
