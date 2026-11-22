// Mobilebox: cold start → first screenshot, observe, act, screenshot, app install, cost of the task, park → resume. Deletes every phone.
//   MOBILESANDBOX_API_KEY=... CLIENT="my laptop, Berlin" node benchmarks/mobilebox.mjs
//   SIZE=large …                      the large Android phone
//   PLATFORM=ios IOS_APP=YourApp.zip … an iOS simulator; IOS_APP is a .zip of a simulator .app (uploaded). No park on iOS.
import { readFileSync } from 'node:fs'
import { APK_URL, APK_PACKAGE, RUNS, TAPS, now, record, sleep } from './lib.mjs'

const base = process.env.MOBILESANDBOX_URL ?? 'https://mobilebox.dev'
const key = process.env.MOBILESANDBOX_API_KEY ?? (() => { throw new Error('Set MOBILESANDBOX_API_KEY') })()
const IOS = process.env.PLATFORM === 'ios', SIZE = process.env.SIZE ?? 'normal'
const iosApp = IOS ? readFileSync(process.env.IOS_APP ?? (() => { throw new Error('Set IOS_APP to a .zip of a simulator .app') })()) : null
const P = IOS ? 'Mobilebox, iOS simulator' : SIZE === 'large' ? 'Mobilebox, Android large' : 'Mobilebox', REGION = IOS ? 'service default' : 'EU (Germany)'

async function call(path, method = 'GET', body, type) {
  const bytes = body instanceof Uint8Array
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'mobilebox-benchmark MobileboxInternal', ...(body === undefined ? {} : { 'Content-Type': type ?? (bytes ? 'application/octet-stream' : 'application/json') }) },
    body: body === undefined ? undefined : bytes ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`)
  return r.headers.get('content-type')?.includes('json') ? r.json() : new Uint8Array(await r.arrayBuffer())
}
async function until(id, want) {
  for (const deadline = now() + 300_000; now() < deadline;) {
    const p = await call(`/v1/phones/${id}?wait=${want}&timeout=50`)
    if (p.status === want) return p
    if (p.status === 'failed') throw new Error(`phone ${id} failed`)
    await sleep(500)
  }
  throw new Error(`phone ${id} not ${want} after 300 s`)
}
const pngSize = (b) => { const v = new DataView(b.buffer, b.byteOffset); return [v.getUint32(16), v.getUint32(20)] } // IHDR width, height
const spent = async () => Number((await call('/v1/account')).spent_usd)

for (let run = 1; run <= RUNS; run++) {
  let id
  try {
    const spent0 = IOS && await spent()
    const t0 = now()
    id = (await call('/v1/phones', 'POST', { name: `benchmark-${run}`, idle_timeout: 300, max_duration: 900, ...(IOS ? { platform: 'ios' } : { size: SIZE }) })).id
    await until(id, 'ready')
    record(P, REGION, 'ready', run, now() - t0)
    const [w, h] = pngSize(await call(`/v1/phones/${id}/screenshot`))
    record(P, REGION, 'cold_start_to_screenshot', run, now() - t0)

    for (let i = 1; i <= TAPS; i++) { // observe, then one tap at two alternating points (the act returns the new screen), then a screenshot
      let t = now()
      await call(`/v1/phones/${id}/observe`)
      record(P, REGION, 'observe', `${run}.${i}`, now() - t)
      t = now()
      await call(`/v1/phones/${id}/actions`, 'POST', { actions: [{ type: 'tap', target: { x: Math.round(w * (i % 2 ? 0.28 : 0.72)), y: Math.round(h * 0.5) } }] })
      const acted = now()
      record(P, REGION, 'act', `${run}.${i}`, acted - t)
      await call(`/v1/phones/${id}/screenshot`)
      record(P, REGION, 'screenshot', `${run}.${i}`, now() - acted)
      record(P, REGION, 'tap_to_screenshot', `${run}.${i}`, now() - t)
    }

    let t = now()
    if (IOS) await call(`/v1/phones/${id}/apps`, 'POST', iosApp, 'application/zip')
    else await call(`/v1/phones/${id}/apps`, 'POST', { url: APK_URL }) // the phone downloads it, like the other providers
    record(P, REGION, 'app_install', run, now() - t, IOS ? `upload, ${iosApp.length} bytes` : 'URL')

    // The task ends here: its bill is the first session's (per second, one-minute minimum), read after the session closes.
    t = now()
    if (IOS) { // a deleted phone has no sessions to read, so its bill is the workspace's spend before and after (nothing else on the key)
      await call(`/v1/phones/${id}`, 'DELETE'); id = null
      await sleep(2000)
      record(P, REGION, 'task_cost_microusd', run, ((await spent()) - spent0) * 1e6, 'workspace spend delta')
    } else { await call(`/v1/phones/${id}/park`, 'POST'); await until(id, 'parked'); record(P, REGION, 'park', run, now() - t) }
    if (id) {
      const s = (await call(`/v1/phones/${id}/sessions`)).data[0]
      record(P, REGION, 'task_cost_microusd', run, Number(s.cost_usd) * 1e6, `${s.billed_seconds} s billed`)
      t = now()
      await call(`/v1/phones/${id}/start`, 'POST')
      await until(id, 'ready')
      await call(`/v1/phones/${id}/screenshot`)
      const kept = (await call(`/v1/phones/${id}/apps`)).data?.some((a) => a.package === APK_PACKAGE)
      record(P, REGION, 'resume_to_screenshot', run, now() - t, kept ? 'app kept after park' : 'APP MISSING after park')
    }
  } catch (e) {
    record(P, REGION, 'error', run, null, e.message.slice(0, 200))
  } finally {
    for (let i = 0; id && i < 5; i++) { // retried: a restarting API answers 502 for a few seconds
      try { await call(`/v1/phones/${id}`, 'DELETE'); id = null } catch (e) { if (i === 4) record(P, REGION, 'cleanup_failed', run, null, `${id} ${e.message}`); else await sleep(10_000) }
    }
  }
}
