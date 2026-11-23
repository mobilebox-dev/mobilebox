#!/usr/bin/env bash
# The monthly Mobilebox run: Android normal, Android large, Android 12 and 13, iOS simulator, one after another (no two phones at once,
# so nothing else on the key or the host skews the numbers), into results/<date>/, then results/<date>/summary.csv.
#   MOBILESANDBOX_API_KEY=... IOS_APP=YourApp.zip CLIENT="..." ./run-mobilebox.sh
set -euo pipefail
cd "$(dirname "$0")"
D=results/${DATE:-$(date -u +%F)}; mkdir -p "$D"
export RUNS=${RUNS:-10} TAPS=${TAPS:-10}
OUT=$D/android-normal.csv node mobilebox.mjs
SIZE=large OUT=$D/android-large.csv node mobilebox.mjs
ANDROID=12 OUT=$D/android-12.csv node mobilebox.mjs
ANDROID=13 OUT=$D/android-13.csv node mobilebox.mjs
PLATFORM=ios OUT=$D/ios.csv node mobilebox.mjs
node summarize.mjs "$D"
