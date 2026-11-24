#!/usr/bin/env bash
# VM-isolated phones, research (Android 15/16): the Android emulator with KVM on a CI runner.
# Cold boot (-no-snapshot), then a warm start from a saved RAM snapshot, plus memory and idle CPU per phone.
#   API=35 RUNS=3 benchmarks/vm/emulator.sh     (API 35 = Android 15, 36 = Android 16)
set -uo pipefail
API=${API:-35} RUNS=${RUNS:-3} BOOT_LIMIT=${BOOT_LIMIT:-600}
IMAGE="system-images;android-$API;google_apis;x86_64"
OUT=$(realpath -m "${OUT:-results/vm-emulator-$API.csv}")
SDK=${ANDROID_HOME:?set ANDROID_HOME}
export PATH="$SDK/cmdline-tools/latest/bin:$SDK/emulator:$SDK/platform-tools:$PATH"
export ANDROID_AVD_HOME=${ANDROID_AVD_HOME:-$HOME/.android/avd}
mkdir -p "$ANDROID_AVD_HOME" "$(dirname "$OUT")"
echo 'runtime,android,metric,run,value,unit,note' > "$OUT"
ms() { echo $(( $(date +%s%N) / 1000000 )); }
rec() { echo "emulator,$API,$1,$2,$3,$4,\"${5:-}\"" >> "$OUT"; echo "emulator API $API $1 run $2: $3 $4 ${5:-}"; }
lscpu | grep -E 'Model name|^CPU\(s\)'; free -m | sed -n 2p; ls -l /dev/kvm

t=$(ms)
yes | sdkmanager --licenses > /dev/null
sdkmanager --install emulator platform-tools "$IMAGE" > /dev/null || { rec error 0 '' '' "sdkmanager could not install $IMAGE"; exit 1; }
echo no | avdmanager create avd -n vm -k "$IMAGE" -d pixel_6 --force > /dev/null
rec setup 0 $(( $(ms) - t )) ms "$IMAGE"
rec image_mb 0 "$(du -sm "$SDK/system-images/android-$API" | cut -f1)" MB

boot() { # run args...: waits for sys.boot_completed and one screenshot; prints ms or nothing
  local t0; t0=$(ms)
  emulator -avd vm -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -accel on -memory 2048 -cores 2 "$@" > emu.log 2>&1 &
  echo $! > emu.pid
  while [ $(( ($(ms) - t0) / 1000 )) -lt "$BOOT_LIMIT" ] && kill -0 "$(cat emu.pid)" 2>/dev/null; do
    [ "$(timeout 10 adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && { adb exec-out screencap -p > /dev/null; echo $(( $(ms) - t0 )); return; }
    sleep 1
  done
}
stop() { adb emu kill > /dev/null 2>&1; sleep 3; kill "$(cat emu.pid)" 2>/dev/null; wait "$(cat emu.pid)" 2>/dev/null; adb kill-server > /dev/null 2>&1; }

for run in $(seq 1 "$RUNS"); do
  adb start-server > /dev/null 2>&1
  t=$(boot -no-snapshot -wipe-data)
  [ -n "$t" ] && rec cold_boot_to_screenshot "$run" "$t" ms || rec error "$run" '' '' "cold boot: $(grep -m1 -iE 'error|fatal' emu.log)"
  stop
done

# Warm: boot once, let it settle, save a snapshot, then start from it.
adb start-server > /dev/null 2>&1
t=$(boot -no-snapshot-load)
if [ -n "$t" ]; then
  rec abilist 1 "$(adb shell getprop ro.product.cpu.abilist | tr -d '\r' | tr , ' ')" abis "native bridge: $(adb shell getprop ro.dalvik.vm.native.bridge | tr -d '\r')"
  sleep 60
  pid=$(pgrep -f qemu-system-x86_64 | head -1)
  rec rss_idle 1 "$(( $(ps -o rss= -p "$pid") / 1024 ))" MB "qemu RSS 60 s after boot, -memory 2048"
  rec cpu_idle 1 "$(top -b -n 2 -d 5 -p "$pid" | awk 'END {print $9}')" '%' "of one core, 5 s sample"
  adb emu avd snapshot save warm > /dev/null 2>&1
  stop
  for run in $(seq 1 "$RUNS"); do
    adb start-server > /dev/null 2>&1
    t=$(boot -snapshot warm -no-snapshot-save)
    [ -n "$t" ] && rec warm_start_to_screenshot "$run" "$t" ms "from a RAM snapshot" || rec error "w$run" '' '' "snapshot start failed: $(grep -m1 -iE 'snapshot|error' emu.log)"
    stop
  done
  rec snapshot_mb 1 "$(du -sm "$ANDROID_AVD_HOME/vm.avd/snapshots" | cut -f1)" MB
fi
cat "$OUT"
