# Recorded runs

Every example, run unchanged against production (`https://mobilebox.dev`) with only `MOBILESANDBOX_API_KEY` set. After each run, `GET /v1/phones` returned no phones.

**2026-11-04**, Node 24.22, Python 3.14, curl + jq on Linux. Test APK: [Editor 1.98](https://f-droid.org/packages/org.billthefarmer.editor/) from F-Droid.

| Example | Command | Result | Time |
|---|---|---|---|
| curl | `examples/curl/walkthrough.sh` | created, observed, Settings > Display, `screen.png`, deleted | 24.7 s |
| Python | `python3 examples/python/mobilebox.py` | `ok: brightness level is 83%`, deleted | 29.6 s |
| TypeScript | `node examples/typescript/mobilebox.ts` | `ok: brightness level is 83%`, deleted | 26.1 s |
| Claude Code replay | `examples/claude-code/replay.sh editor.apk org.billthefarmer.editor "Access all files"` | uploaded 1.98, opened, `PASS: "Access all files" is on screen`, deleted | 21.6 s |
| Claude Code replay, failure path | same, label `Untitled.txt` (not on the first screen) | `2. wait_for failed — wait_timeout`, exit 1, deleted | not timed |
| CI smoke | `node examples/github-actions/smoke.mjs` (label `Access all files`) | `Smoke passed: org.billthefarmer.editor 1.98 shows "Access all files"`, deleted | 21.5 s |
| CI smoke, failure path | same, label `Untitled.txt` | exit 1 with `wait_timeout` and the screen text, deleted | 51.8 s |
| CI smoke, cancelled | same, `kill -INT` after 35 s (like a cancelled job) | exit 130, `Deleted ph_…` from the signal handler, list empty afterwards | 35 s |
| Time to a ready phone | `POST /v1/phones?wait=ready` with an `Idempotency-Key`, then `DELETE`, three times in a row | ready, deleted | 18.1 s, 18.3 s, 18.8 s |
| Keyless MCP check | `node scripts/check-mcp.mjs` | initialize, tools/list (12 tools), README table and `server.json` match | 0.6 s |

Times include boot (the phone is free until ready) and are measured on the calling machine, network included. Not run here: Claude Code itself on the prompt in [claude-code/README.md](claude-code/README.md); the replay sends the same tool calls. The CI `smoke` job runs all of the above on every push to `main` once the `MOBILESANDBOX_API_KEY` secret is set.


**2026-11-05**, in CI's production smoke ([run 42114977012](https://github.com/mobilebox-dev/mobilebox/actions/runs/42114977012)), ubuntu-latest, curl + jq.

| Example | Command | Result | Time |
|---|---|---|---|
| Live view | `examples/watch/watch.sh` (`CI` set, so the view is printed, not opened) | `live view: https://mobilebox.dev/watch#v1.…`, `ok: Settings > Display is open`, deleted | 26 s |
| Keyless MCP check | `node scripts/check-mcp.mjs` | initialize, tools/list (13 tools, `watch_phone` added), README table and `server.json` match | 0.6 s |

**2026-11-05**, framework integrations ([integrations/](integrations)), each run once against production from Linux, Python 3.12 / Node 24.22. Models came through an OpenAI-compatible endpoint (`OPENAI_BASE_URL`, `MODEL`), except the Claude Agent SDK (its default Claude model). Framework versions: openai-agents 0.24.0, langgraph 1.2.20 + langchain-mcp-adapters 0.3.2, crewai 1.15.35, browser-use 0.13.14, @mastra/core 1.82.0 + @mastra/mcp 2.8.0, ai 7.0.163 + @ai-sdk/mcp 2.0.91, @anthropic-ai/claude-agent-sdk 0.3.318.

| Example | Model | Result | Time |
|---|---|---|---|
| OpenAI Agents SDK | GLM-5.3 (Chat Completions) | `Brightness level: 83%`, deleted | 37.9 s |
| LangGraph | GLM-5.3 | `Brightness level: 83%`, deleted | 30.7 s |
| CrewAI | GLM-5.3 (LiteLLM) | `The brightness level ... is 83%`, deleted | 36 s |
| browser-use | Kimi K3.1 Pro | phone: Android 14 (Settings > About phone); web: released 4 October 2023 (Wikipedia), deleted | 174 s |
| Mastra | GLM-5.3 (`togetherai/…`) | `Brightness level: 83%`, deleted | 33 s |
| Vercel AI SDK | GLM-5.3 | `Brightness level: 83%`, deleted | 32 s |
| Claude Agent SDK | Claude (default) | `The brightness level is 83%`, deleted | 35 s |

Times include boot and the model's own latency. The CrewAI run used the `act` schema with swipe points as plain arrays (CrewAI drops tools whose schema has tuple-form `items`), served on production with the next release.

<details>
<summary>Python output</summary>

```text
ready: ph_on7c4dcbzlnk
app: com.android.settings
[1] List #com.android.settings:id/content_parent (540,1137)
[2] View desc="Display" (540,266)
[3] Button desc="Navigate up" (73,136)
[4] List #com.android.settings:id/recycler_view (540,1403)
[5] Text "Brightness" (550,621)
[6] Row "Brightness level" — 83% (540,771)
[7] Text "Lock display" (550,962)
[8] Row "Lock screen" — Show all notification content (540,1112)
[9] Row "Screen timeout" — Not set (540,1318)
[10] Text "Appearance" (550,1509)
[11] Button (540,1659)
[12] Switch desc="Dark theme" (943,1659)
[13] Text "Dark theme" (198,1633)
[14] Text "Will never turn on automatically" (320,1694)
[15] Row "Display size and text" (540,1839)
[16] Text "Color" (550,2005)
[17] Row "Colors" (540,2129)
[18] Text "Other display controls" (550,2272)
ok: brightness level is 83%
deleted: ph_on7c4dcbzlnk
```
</details>

**2026-11-08**, Python packages ([packages/python/](../packages/python)), from Linux, Python 3.12, langchain-core 1.7.6, langchain-tests 1.1.9. Each run creates one phone and deletes it; afterwards `GET /v1/phones` showed none of ours (one older parked phone from another key was left alone).

| Package | Command | Result | Time |
|---|---|---|---|
| `mobilebox` | `MOBILEBOX_LIVE=1 pytest -m live` | created, listed, observed, Settings > Display, failed tap with `code` and `next`, PNG, watch link, installed Editor 1.98, parked, started, deleted | 37.8 s |
| `langchain-mobilebox` | `MOBILEBOX_LIVE=1 pytest tests/integration_tests` | LangChain standard `ToolsIntegrationTests` on `mobilebox_observe`; create, act, failed action reported, screenshot block, install, park, delete through the tools | 27.9 s |
| both, offline | `pytest` in each package, Python 3.10 and 3.14, from the built wheels | 60 passed (incl. LangChain standard `ToolsUnitTests` for all 7 tools) | 3 s |

**2026-11-23**, OpenHands ([integrations/openhands](integrations/openhands)), from Linux, Python 3.14, openhands-sdk and openhands-tools 1.63.1. The app: a one-activity test app that crashes on start (`Integer.parseInt("v2")`), built with the plain SDK tools (`BUILD=./build.sh APK=build/app.apk`), in a git repo with a local remote. No model credit on this machine, so a scripted stand-in made the model's calls over an OpenAI-compatible endpoint (`LLM_BASE_URL`); OpenHands, its terminal, file editor and MCP client, the build and Mobilebox were real.

| Step | Tool | Result | Time |
|---|---|---|---|
| Phone ready, OpenHands up, MCP tools listed | `POST /v1/phones?wait=ready`, `mcp_config` | ready | 3.8 s |
| Build and install | terminal: `./build.sh && curl --data-binary @build/app.apk …/v1/phones/{id}/apps` | `{"package":"dev.mobilebox.demo",…}` | 2.9 s |
| Open it | `act` open_app + 2.5 s wait | the launcher: the app crashed | 3.2 s |
| Read the crash | `app_logs` | `FATAL EXCEPTION: main … NumberFormatException: For input string: "v2"`, `at dev.mobilebox.demo.Main.onCreate(Main.java:13)` | 0.2 s |
| Fix | file editor: `Integer.parseInt(BUILD.substring(1))` | edited | 0.1 s |
| Rebuild and reinstall | terminal, as above | installed | 2.5 s |
| Check the fix | `act` open_app + 2.5 s wait | `[2] Text "Build 2 works"` | 3.6 s |
| Push | terminal: `git commit -am … && git push origin main` | `main -> main` | 0.2 s |

17 s from the first step to the report, 15 s of phone time; the phone was deleted. The API key was absent from every log and file afterwards (OpenHands masks secrets and the example keeps the shell history off disk).

## App-builder preview

**2026-11-25**, Node 24 on Linux, `examples/app-builder-preview` against production through a Cloudflare quick tunnel, driven in Chrome. Details and the recording: [app-builder-preview/README.md](app-builder-preview/README.md#recorded-run).

| Step | Result | Time |
|---|---|---|
| Preview `user_42`, F-Droid Editor 1.98 APK, new phone | installed, live in the page at 30 Hz | 29 s |
| Preview `user_42` again, parked phone | started, `phone.ready` webhook, live | 15 s |
| Preview `user_7`, Expo SDK 58 tunnel link, new phone | Expo Go 58.0.6 installed itself, app live, Fast Refresh in the embed | 30 s |
| Park | `phone.parked` webhooks (signature checked), usage per end user updated | 2 s |

Afterwards both phones were deleted, the webhook removed and the page's origin taken off the list.

