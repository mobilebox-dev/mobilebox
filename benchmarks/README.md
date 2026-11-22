# Benchmarks

The scripts and raw data behind [mobilebox.dev/benchmarks](https://mobilebox.dev/benchmarks): how fast cloud phones for agents start, react and install an app, and what a task costs, measured the same way for every service. Mobilebox (Android normal, Android large, iOS simulator) is re-run on the 1st of every month into `results/<date>/`.

## What each run does

1. **Cold start**: clock starts before the create request, stops when the first screenshot's bytes arrive.
2. **Observe, act, screenshot** (`mobilebox.mjs` since 2026-11-22): 10 rounds of read the screen as elements, one tap at two alternating points (the act returns the new screen), a full screenshot. `tap_to_screenshot` = act + screenshot, comparable with the 2026-11-08 run's tap + screenshot.
3. **Install**: Android, [Fossify Calculator 1.4.0](https://f-droid.org/packages/org.fossify.math/) (`org.fossify.math`, ~4 MB): from its F-Droid URL where the API takes a URL, uploaded over ADB where it doesn't. iOS: any simulator build, a .zip of the `.app`, uploaded (`IOS_APP`).
4. **Cost per task** (`task_cost_microusd`, the `ms` column holds micro-dollars): what the workspace was billed for the session up to here. Android: the first session's `cost_usd` after park. iOS: the workspace's `spent_usd` before and after delete (run nothing else on the key meanwhile).
5. **Park and resume** (where the service has it): park, start again, screenshot, check the app is still installed.
6. **Cleanup**: every phone deleted in `finally`; failures are written to the CSV, never dropped.

Medians and p90 use the nearest rank. No outliers are removed.

## Run

Node 24. `npm install` here pulls only the Limrun SDK.

```bash
npm install
MOBILESANDBOX_API_KEY=... IOS_APP=YourApp.zip CLIENT="Berlin, home fibre" ./run-mobilebox.sh   # Android normal, large, iOS → results/<date>/ + summary.csv
MOBILESANDBOX_API_KEY=... SIZE=large CLIENT="..." node mobilebox.mjs                          # one setup; PLATFORM=ios IOS_APP=… for iOS
LIM_API_KEY=... CLIENT="..." node limrun.mjs
PHONE_HARNESS_API_KEY=... ADB=$(which adb) CLIENT="..." node phoneharness.mjs
ACCEL=on ./emulator.sh       # needs ANDROID_HOME; ACCEL=off for software emulation
node summarize.mjs [dir]     # <dir>/*.csv → <dir>/summary.csv (default results/, the 2026-11-08 run)
node chart.mjs               # results/summary.csv → results/cold-start.svg (+ -narrow.svg)
```

`RUNS` (default 5) and `TAPS` (default 10) change the counts. `mobilebox.mjs` holds one phone at a time; don't run two copies (or the workflow and a local run) on the same key at once, or other jobs on that key can hit the per-key phone limit. `CLIENT` labels where the script ran; network distance is part of every number.

The [benchmarks workflow](../.github/workflows/benchmarks.yml) runs the emulator with and without KVM and Mobilebox from the same `ubuntu-latest` runner.

## Results

| Run | Folder | What |
|---|---|---|
| 2026-11-22T1813 | `results/2026-11-22T1813/` | Android normal and large again, after the warm pool ([#321](https://github.com/Musti7even/phonebox/issues/321)): a plain create gets a pre-booted phone, a large one still boots fresh. 10 sessions each; one large session lost its later steps when the API restarted for another deploy (18:20 UTC), so an 11th was run. The site's CSV for this run adds the iOS rows of the run before |
| 2026-11-22 | `results/2026-11-22/` | Mobilebox Android normal, Android large, iOS simulator; 10 sessions each, client in Nuremberg, Germany. One Android normal and one Android large session got a 502 while the API restarted for a deploy (16:28 and 16:42 UTC); both are in the CSVs as `error`, and an 11th session was run for each; `summary.csv` = [mobilebox.dev/benchmark-mobilebox-2026-11-22.csv](https://mobilebox.dev/benchmark-mobilebox-2026-11-22.csv) |
| 2026-11-08 | `results/` (files below) | Mobilebox, Limrun, Phone Harness, emulator on GitHub Actions |

### 2026-11-08

| File | What |
|---|---|
| `results/summary.csv` | n, failures, median and p90 per service, client and metric |
| `results/mobilebox.csv`, `limrun.csv`, `phoneharness.csv` | one row per measurement, client in Nuremberg, Germany |
| `results/emulator-on.csv`, `emulator-off.csv`, `mobilebox-ci.csv` | the GitHub Actions run ([42517634798](https://github.com/mobilebox-dev/mobilebox/actions/runs/42517634798)), rebuilt from its job log because that run wrote its CSVs to the wrong folder (fixed since); timestamps are log times |
| `results/excluded-mobilebox-deploy-overlap.csv` | an earlier Mobilebox batch that overlapped a production deploy (3 of 10 runs failed with 502) and used APK upload instead of URL install. Kept for the record, left out of the summary |
| `results/cold-start.svg`, `cold-start-narrow.svg` | the chart on the page, desktop and phone widths |

Vendor terms were read before measuring. BrowserStack, Genymotion SaaS and LambdaTest restrict publishing performance results or use by competitors, so there are no scripts for them.
