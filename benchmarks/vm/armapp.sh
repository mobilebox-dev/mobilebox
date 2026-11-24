#!/usr/bin/env bash
# Does an arm64-only app run? VLC's arm64-v8a build from F-Droid: install, launch, still running after 10 s, no native crash.
#   ADB="adb -s ..." benchmarks/vm/armapp.sh  → prints "ok" or the reason
set -u
APK=/tmp/vlc-arm64.apk
[ -f $APK ] || curl -fsSL -o $APK https://f-droid.org/repo/org.videolan.vlc_13070206.apk
inst=$($ADB install -r $APK 2>&1 | tail -1)
case "$inst" in Success*) ;; *) echo "install: $inst"; exit 0;; esac
$ADB shell monkey -p org.videolan.vlc -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1
sleep 10
pid=$($ADB shell pidof org.videolan.vlc | tr -d '\r')
crash=$($ADB shell "logcat -d -b crash,main | grep -E 'UnsatisfiedLinkError|FATAL EXCEPTION|SIGILL|dlopen failed' | head -2" | tr -d '\r' | tr '\n' ' ')
[ -n "$pid" ] && [ -z "$crash" ] && echo ok || echo "pid=${pid:-none} ${crash:0:200}"
