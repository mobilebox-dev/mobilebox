#!/usr/bin/env bash
# VM-isolated phones, research (Android 15/16): Cuttlefish (crosvm + KVM) on a CI runner, from Google's packages and a
# public AOSP CI build. Cold boot, a restart from the kept disk, memory and idle CPU per phone.
#   RUNS=3 benchmarks/vm/cuttlefish.sh       (run as the runner user; installs with sudo)
set -uo pipefail
RUNS=${RUNS:-3} BOOT_LIMIT=${BOOT_LIMIT:-900}
OUT=$(realpath -m "${OUT:-results/vm-cuttlefish.csv}")
mkdir -p "$(dirname "$OUT")"; echo 'runtime,android,metric,run,value,unit,note' > "$OUT"
ms() { echo $(( $(date +%s%N) / 1000000 )); }
ANDROID=unknown
rec() { echo "cuttlefish,$ANDROID,$1,$2,$3,$4,\"${5:-}\"" >> "$OUT"; echo "cuttlefish $ANDROID $1 run $2: $3 $4 ${5:-}"; }
lscpu | grep -E 'Model name|^CPU\(s\)'; free -m | sed -n 2p; ls -l /dev/kvm /dev/vhost-vsock 2>&1

# Google's host packages (apt repository of the android-cuttlefish project).
t=$(ms)
sudo curl -fsSL https://us-apt.pkg.dev/doc/repo-signing-key.gpg -o /etc/apt/trusted.gpg.d/artifact-registry.asc
sudo chmod a+r /etc/apt/trusted.gpg.d/artifact-registry.asc
echo "deb https://us-apt.pkg.dev/projects/android-cuttlefish-artifacts android-cuttlefish main" | sudo tee /etc/apt/sources.list.d/artifact-registry.list > /dev/null
sudo apt-get update -qq && sudo apt-get install -y -qq cuttlefish-base cuttlefish-user > apt.log 2>&1 || { tail -20 apt.log; rec error 0 '' '' 'host packages did not install'; exit 1; }
sudo usermod -aG kvm,cvdnetwork,render "$USER"
sudo modprobe vhost_vsock; sudo modprobe vhost_net; ls -l /dev/vhost-vsock /dev/vhost-net # CI runners don't load them
rec setup_packages 0 $(( $(ms) - t )) ms "$(dpkg-query -W -f '${Version}' cuttlefish-base)"

# The rest as a fresh login of this user, so the new groups apply.
as_user() { sudo -u "$USER" -H bash -lc "$*"; }
t=$(ms); fetched=
case $(uname -m) in
  aarch64) BUILDS="aosp-android-latest-release/aosp_cf_arm64_only_phone-userdebug aosp-main/aosp_cf_arm64_only_phone-trunk_staging-userdebug" ;;
  *) BUILDS="aosp-android-latest-release/aosp_cf_x86_64_only_phone-userdebug aosp-main/aosp_cf_x86_64_phone-trunk_staging-userdebug" ;;
esac
[ -e /dev/kvm ] || { rec error 0 '' '' "no /dev/kvm on this runner ($(uname -m))"; cat "$OUT"; exit 0; }
for build in $BUILDS; do
  rm -rf ~/cf; mkdir -p ~/cf
  if as_user "cd ~/cf && cvd fetch --default_build=$build --target_directory=\$HOME/cf" > fetch.log 2>&1; then fetched=$build; break; fi
  tail -5 fetch.log
done
[ -n "$fetched" ] || { rec error 0 '' '' 'no AOSP Cuttlefish build could be fetched'; exit 1; }
rec setup_fetch 0 $(( $(ms) - t )) ms "$fetched"
rec image_mb 0 "$(du -sm ~/cf | cut -f1)" MB "host tools + images"

launch() { # extra args...; prints ms to boot_completed + screenshot, or nothing
  local t0; t0=$(ms)
  as_user "cd ~/cf && HOME=\$HOME/cf ./bin/launch_cvd --daemon --report_anonymous_usage_stats=n --memory_mb=4096 --cpus=2 --gpu_mode=guest_swiftshader --enable_sandbox=false $*" > launch.log 2>&1 || { tail -15 launch.log >&2; return; }
  while [ $(( ($(ms) - t0) / 1000 )) -lt "$BOOT_LIMIT" ]; do
    [ "$(timeout 10 ~/cf/bin/adb -s 0.0.0.0:6520 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && { ~/cf/bin/adb -s 0.0.0.0:6520 exec-out screencap -p > /dev/null; echo $(( $(ms) - t0 )); return; }
    ~/cf/bin/adb connect 0.0.0.0:6520 > /dev/null 2>&1; sleep 2
  done
}
stop() { as_user "cd ~/cf && HOME=\$HOME/cf ./bin/stop_cvd" > /dev/null 2>&1; sleep 2; }

for run in $(seq 1 "$RUNS"); do
  t=$(launch --resume=false)
  if [ -n "$t" ]; then
    [ "$run" = 1 ] && ANDROID=$(~/cf/bin/adb -s 0.0.0.0:6520 shell getprop ro.build.version.release | tr -d '\r') && sed -i "s/^cuttlefish,unknown,/cuttlefish,$ANDROID,/" "$OUT"
    rec cold_boot_to_screenshot "$run" "$t" ms "fresh userdata, $fetched"
  else rec error "$run" '' '' "cold boot: $(grep -m1 -iE 'error|fail' ~/cf/cuttlefish_runtime/launcher.log 2>/dev/null)"; fi
  if [ "$run" = 1 ] && [ -n "$t" ]; then
    sleep 60
    rss=0; for p in $(pgrep -f crosvm); do rss=$(( rss + $(ps -o rss= -p "$p") )); done
    rec rss_idle 1 $(( rss / 1024 )) MB "all crosvm processes, 60 s after boot, --memory_mb=4096"
    rec cpu_idle 1 "$(top -b -n 2 -d 5 | awk '/crosvm/ {s+=$9} END {print s}')" '%' "crosvm, of one core, 5 s sample"
    ~/cf/bin/adb -s 0.0.0.0:6520 shell getprop ro.build.fingerprint
    rec abilist 1 "$(~/cf/bin/adb -s 0.0.0.0:6520 shell getprop ro.product.cpu.abilist | tr -d '\r' | tr , ' ')" abis "native bridge: $(~/cf/bin/adb -s 0.0.0.0:6520 shell getprop ro.dalvik.vm.native.bridge | tr -d '\r')"
  fi
  stop
done
# Restart: the same disk (apps and data kept), what a parked phone's start would be.
for run in $(seq 1 "$RUNS"); do
  t=$(launch --resume=true)
  [ -n "$t" ] && rec restart_kept_disk_to_screenshot "$run" "$t" ms || rec error "r$run" '' '' 'restart failed'
  stop
done
cat "$OUT"
