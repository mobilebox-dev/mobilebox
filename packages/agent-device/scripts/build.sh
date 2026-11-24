#!/bin/sh
# Builds, tests and packs @mobilebox/agent-device the way Callstack builds its own provider plugins
# (@agent-device/revyl, @agent-device/testmu): inside agent-device's repository, at the release named in
# AGENT_DEVICE_VERSION, where agent-device's internal packages resolve and get bundled into dist.
# Adapted from @nomac/agent-device's scripts/build.sh (MIT).
#
#   scripts/build.sh              the tarball lands in this folder: mobilebox-agent-device-<version>.tgz
#   WORK=/tmp/x scripts/build.sh  builds in that folder (default: a new temporary one), outside this repository
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
release=$(tr -d '[:space:]' < "$here/AGENT_DEVICE_VERSION")
if [ -n "${WORK:-}" ]; then
  case "$WORK" in /*) work=$WORK ;; *) work=$PWD/$WORK ;; esac
  case "$work/" in "$here"/*) echo "WORK must be outside $here" >&2; exit 1 ;; esac
  rm -rf "$work"
else
  work=$(mktemp -d "${TMPDIR:-/tmp}/mobilebox-agent-device-build.XXXXXX")
fi
git clone --quiet --depth 1 --branch "v$release" https://github.com/callstack/agent-device.git "$work"
package="$work/packages/provider-mobilebox"
mkdir -p "$package"
cp -R "$here/src" "$here/test" "$here/package.json" "$here/tsconfig.json" "$here/tsdown.config.ts" "$here/README.md" "$here/LICENSE" "$package/"

cd "$work"
# The pnpm agent-device pins (package.json packageManager), on PATH, so the package check's own pnpm calls use it too.
pnpm_version=$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")
npm install --silent --no-audit --no-fund --prefix "$work/.tools" "pnpm@$pnpm_version"
PATH="$work/.tools/node_modules/.bin:$PATH"
export PATH
pnpm install --no-frozen-lockfile
pnpm exec vitest run packages/provider-mobilebox
pnpm exec tsc -b packages/provider-mobilebox
(cd "$package" && pnpm build)
# Callstack's package check: the published agent-device of this release installs the packed plugin into an
# empty plugin home and connects through it to a stand-in Mobilebox (test/package-smoke.mjs).
AGENT_DEVICE_SESSION=mobilebox-package-check AGENT_DEVICE_CORE_SPEC="agent-device@$release" \
  node scripts/check-provider-plugin.mjs "$package"
version=$(node -p "require('$package/package.json').version")
(cd "$package" && pnpm pack --out "$here/mobilebox-agent-device-$version.tgz")
echo "Packed $here/mobilebox-agent-device-$version.tgz, built against agent-device $release."
