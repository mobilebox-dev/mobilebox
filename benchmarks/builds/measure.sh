#!/usr/bin/env bash
# #482 research: one real Expo app (create-expo-app blank) → expo prebuild → Gradle release APK, three times:
# cold (empty caches), warm (caches kept, outputs cleaned), incremental (one JS line changed). Wall time, CPU seconds,
# peak memory of the build's processes and of the host. Prints a summary; nothing is published.
set -uo pipefail
out=$PWD/results; mkdir -p "$out"; echo "$(uname -m) $(nproc) cpus $(free -g | awk '/Mem:/{print $2}') GB" > "$out/host.txt"
peak() { local p=0; while kill -0 "$1" 2>/dev/null; do u=$(free -m | awk '/Mem:/{print $3}'); [ "$u" -gt "$p" ] && p=$u; sleep 1; done; echo "$p"; }
step() { # name, then the command
  local name=$1; shift; local base=$(free -m | awk '/Mem:/{print $3}') t0=$(date +%s)
  /usr/bin/time -f '%U %S %M' -o "$out/$name.time" "$@" > "$out/$name.log" 2>&1 & local pid=$!
  local p=$(peak $pid); wait $pid; local rc=$?
  read -r u s rss < <(tail -1 "$out/$name.time" 2>/dev/null) || { u=0; s=0; rss=0; }
  printf '%s rc=%s wall_s=%s cpu_s=%.0f host_used_peak_mb=%s (base %s) max_rss_mb=%s\n' "$name" "$rc" "$(( $(date +%s) - t0 ))" "$(echo "$u + $s" | bc)" "$p" "$base" "$(( rss / 1024 ))" | tee -a "$out/summary.txt"
  return $rc
}
cd "$(mktemp -d)"
step create npx --yes create-expo-app@latest app --template blank || { tail -30 "$out/create.log"; exit 1; }
cd app; grep '"expo"' package.json | tee -a "$out/summary.txt"
step prebuild npx expo prebuild -p android --no-install || tail -30 "$out/prebuild.log"
cd android
step cold ./gradlew assembleRelease --no-daemon || tail -40 "$out/cold.log"
./gradlew clean --no-daemon > /dev/null 2>&1
step warm ./gradlew assembleRelease --no-daemon || tail -20 "$out/warm.log"
sed -i 's/Open up App.js to start working on your app!/Edited for the incremental build/' ../App.js
step incremental ./gradlew assembleRelease --no-daemon || tail -20 "$out/incremental.log"
ls -la app/build/outputs/apk/release/ 2>/dev/null | tee -a "$out/summary.txt"
du -sh ~/.gradle ~/.npm ../node_modules 2>/dev/null | tee -a "$out/summary.txt"
grep -h -i "ndk\|cmake\|aapt2" "$out/cold.log" | sort | uniq -c | sort -rn | head -8 | tee -a "$out/summary.txt"
