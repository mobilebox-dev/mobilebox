# Mobilebox for agent-device

Mobilebox cloud Android phones as an [agent-device](https://github.com/callstack/agent-device) provider. Your agent runs `agent-device` as usual; each session gets its own Mobilebox phone, created on the first device command and deleted when the session closes. A phone costs $0.01 a minute, billed per second; a new Android 14 phone is ready for its first screenshot in about 1.4 s ([benchmarks](https://mobilebox.dev/benchmarks)).

We build Mobilebox; this plugin is ours, not Callstack's. It ships inside the [`mobilebox`](https://www.npmjs.com/package/mobilebox) npm package as its `mobilebox/agent-device` export; this folder is its source. Report problems in [this repository](https://github.com/mobilebox-dev/mobilebox/issues).

## Install

```bash
agent-device plugins add mobilebox
```

## Connect

Create an API key in the [Mobilebox dashboard](https://mobilebox.dev/dashboard), then:

```bash
export MOBILEBOX_API_KEY=mbx_...
export AGENT_DEVICE_SESSION=checkout-android
agent-device connect mobilebox
```

`connect` checks the key and starts no phone. Pass `--provider-os-version 12` or `13` for an older Android; 14 is the default.

## Install and run an app

```bash
agent-device install com.example.app ./app-debug.apk
agent-device open com.example.app
agent-device snapshot -i
agent-device press @e12
agent-device screenshot after.png
agent-device close
agent-device disconnect
```

`install` takes a local `.apk`, `.apks` or `.xapk` (arm64-v8a, 32-bit armeabi-v7a or universal); download one from a URL first. `close` deletes the phone, so nothing keeps billing.

## What a Mobilebox phone supports here

| Works | Not through agent-device (use the Mobilebox API or MCP) |
|---|---|
| `install`, `open` and `close` by package, `snapshot`, `screenshot`, `press`, `fill`, `type`, `scroll`, `longpress`, `back`, `home` | deep links, app logs (`GET /v1/phones/{id}/logs`), screen recording, uninstall, locale, location and network settings, orientation, clipboard |

A snapshot is Mobilebox's own reading of the screen (the elements `GET /v1/phones/{id}/observe` lists, written as uiautomator XML for agent-device's Android parser), so taps land on the same points the Mobilebox API would tap. Points are the phone's pixels (1080×2400 by default).

## Options

```json
{ "plugins": { "mobilebox": { "options": { "apiKey": "mbx_...", "baseUrl": "https://mobilebox.dev" } } } }
```

Both are optional: `MOBILEBOX_API_KEY` and `MOBILEBOX_API_URL` are read when they are left out.

## How it is built

agent-device's provider plugins bundle parts of agent-device that are not published on their own, so this package is built the way Callstack builds `@agent-device/revyl` and `@agent-device/testmu`: inside agent-device's repository, at the release in [`AGENT_DEVICE_VERSION`](AGENT_DEVICE_VERSION).

```bash
scripts/build.sh
```

It clones that release, runs the unit test and the type check, builds, runs Callstack's package check against the published agent-device of the same release (an isolated `plugins add` install, then `connect` to a stand-in Mobilebox), and packs a tarball. With `DIST_OUT=../mobilebox/agent-device` it also copies the plugin into the `mobilebox` package, as [publish.yml](../../.github/workflows/publish.yml) does for a release. It needs git, Node 22 or later and npm. The build script and the platform module's shape follow [@nomac/agent-device](https://github.com/NoMac-app/agent-device-plugin) (MIT).

## License

MIT. The published package bundles parts of agent-device, which is MIT-licensed by Callstack; both notices are in [LICENSE](LICENSE).
