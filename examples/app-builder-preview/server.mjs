// App-builder preview: one cloud phone per end user, embedded live in your own page.
// Zero dependencies, Node 20+. Your API key stays here on the server; the browser only ever gets a short-lived embed URL.
//
//   MOBILESANDBOX_API_KEY=… PUBLIC_URL=https://your-tunnel.example node server.mjs
//
// PUBLIC_URL is where Mobilebox can reach this server for webhooks, and the page origin the embed is locked to.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createHmac, timingSafeEqual } from 'node:crypto'
import assert from 'node:assert/strict'

const API = process.env.MOBILEBOX_API ?? 'https://mobilebox.dev/v1'
const KEY = process.env.MOBILESANDBOX_API_KEY
const PORT = Number(process.env.PORT ?? 3000)
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '')
const ORIGIN = new URL(PUBLIC_URL).origin
const HOOK_URL = `${PUBLIC_URL}/webhooks/mobilebox`

// --- Mobilebox REST, server-side only -----------------------------------------------------------------------------
async function mb(method, path, body) {
  const res = await fetch(API + path, {
    method, headers: { authorization: `Bearer ${KEY}`, ...(body && { 'content-type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
  })
  const data = res.status === 204 ? null : await res.json()
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? `${res.status}`), { status: res.status, mb: data?.error })
  return data
}
// Waits cap at 55 s per call; a phone still booting is normal, so ask again.
async function ready(phone) {
  while (phone.status === 'creating' || phone.status === 'starting') phone = await mb('GET', `/phones/${phone.id}?wait=ready`)
  if (phone.status !== 'ready') throw new Error(`phone ${phone.id} is ${phone.status}`)
  return phone
}

// One phone per end user: reuse it (start it if parked), or make it with the end_user label and a 30 Hz display.
async function phoneFor(endUser) {
  const [mine] = (await mb('GET', `/phones?end_user=${encodeURIComponent(endUser)}`)).data
  if (mine?.status === 'parked') return ready(await mb('POST', `/phones/${mine.id}/start?wait=ready`))
  if (mine) return ready(mine)
  return ready(await mb('POST', '/phones?wait=ready', { end_user: endUser, display_hz: 30, name: `preview-${endUser}`.slice(0, 64) }))
}

// The builder's app on the phone: an Expo link opens in Expo Go (Mobilebox installs the matching one), an APK URL installs.
async function load(phone, source) {
  if (/^exps?:\/\/|^https:\/\/(\w+\.)?expo\.dev\//.test(source)) {
    const { results } = await mb('POST', `/phones/${phone.id}/actions`, { actions: [{ type: 'open_url', url: source }] })
    if (!results[0].ok) throw new Error(results[0].error.message)
    return results[0].note ?? 'Opened the Expo link.'
  }
  const app = await mb('POST', `/phones/${phone.id}/apps`, { url: source, replace: true })
  await mb('POST', `/phones/${phone.id}/actions`, { actions: [{ type: 'open_app', package: app.package }] })
  return `Installed ${app.package} ${app.version_name ?? ''}`.trim() + '.'
}

// --- Webhooks: verify, keep the latest 200 events for the page to poll -----------------------------------------------
// ponytail: in memory; a real app stores phone state per end user in its database.
let secret = null
const events = [] // { seq, type, end_user, phone, status, reason, at }
let seq = 0

// Mobilebox-Signature: t=<unix s>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">; reject anything older than 5 minutes.
export function verify(secret, header, raw, now = Date.now()) {
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? '') ?? []
  if (!t || Math.abs(now / 1000 - Number(t)) > 300) return false
  const want = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
  return timingSafeEqual(Buffer.from(want), Buffer.from(v1))
}

function onWebhook(raw, signature) {
  if (!secret || !verify(secret, signature, raw)) return 401
  const event = JSON.parse(raw)
  if (events.some((e) => e.id === event.id)) return 204 // a retry of one we have: same Mobilebox-Delivery id
  const phone = event.data?.phone
  events.push({ seq: ++seq, id: event.id, type: event.type, end_user: phone?.end_user ?? null, phone: phone?.id ?? null, status: phone?.status ?? null, reason: event.data?.reason ?? null, at: event.created_at })
  if (events.length > 200) events.shift()
  return 204
}

// --- One-time setup: allow this page to frame phones, and point the workspace's webhook here --------------------------
async function setup() {
  const { origins } = await mb('GET', '/embed/origins')
  const want = [...new Set([...origins, ORIGIN, `http://localhost:${PORT}`])].slice(0, 20)
  if (want.length !== origins.length) await mb('PUT', '/embed/origins', { origins: want })
  const hook = await mb('GET', '/webhooks')
  // A workspace has one webhook URL. Don't take over one that points elsewhere unless asked.
  if (hook.url && hook.url !== HOOK_URL && process.env.MOBILEBOX_TAKE_WEBHOOK !== '1') {
    console.warn(`This workspace's webhook goes to ${hook.url}; phone states won't update here. Use a separate workspace, or MOBILEBOX_TAKE_WEBHOOK=1 to point it here.`)
    return
  }
  secret = hook.url === HOOK_URL ? hook.secret : (await mb('PUT', '/webhooks', { url: HOOK_URL })).secret
}

// --- HTTP ----------------------------------------------------------------------------------------------------------
const page = readFileSync(new URL('./index.html', import.meta.url))
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const read = (req) => new Promise((done, fail) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy() }).on('end', () => done(s)).on('error', fail) })
const END_USER = /^[\w.@:+-]{1,128}$/

const server = createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL)
  try {
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page) }
    if (req.method === 'POST' && url.pathname === '/webhooks/mobilebox') { res.writeHead(onWebhook(await read(req), req.headers['mobilebox-signature'])); return res.end() }
    // Polled every 2 s by the page: an event stream would be simpler, but tunnels and proxies often hold it back.
    if (req.method === 'GET' && url.pathname === '/api/events') return json(res, 200, { webhooks: Boolean(secret), events: events.filter((e) => e.seq > Number(url.searchParams.get('since') ?? 0)) })
    if (req.method === 'POST' && url.pathname === '/api/preview') {
      const { endUser, source } = JSON.parse(await read(req))
      if (!END_USER.test(endUser ?? '') || !/^(https?|exps?):\/\/\S+$/.test(source ?? '')) return json(res, 400, { error: 'An end user id (letters, digits, . _ - @ : +) and an APK or Expo URL.' })
      // The page that will hold the iframe: this server's own origin (locked by Mobilebox with frame-ancestors).
      const origin = req.headers.origin === `http://localhost:${PORT}` ? req.headers.origin : ORIGIN
      const phone = await phoneFor(endUser)
      const loaded = await load(phone, source)
      const embed = await mb('POST', `/phones/${phone.id}/embed`, { origin, interactive: true, ttl: 900 })
      return json(res, 200, { phone: phone.id, display_hz: phone.display_hz, notice: phone.notice ?? null, loaded, url: embed.url, expires_at: embed.expires_at })
    }
    if (req.method === 'POST' && url.pathname === '/api/park') {
      const { endUser } = JSON.parse(await read(req))
      const [mine] = END_USER.test(endUser ?? '') ? (await mb('GET', `/phones?end_user=${encodeURIComponent(endUser)}`)).data : []
      if (!mine) return json(res, 404, { error: 'No phone for that end user.' })
      await mb('DELETE', `/phones/${mine.id}/embed`) // the open iframe ends now
      return json(res, 200, { phone: (await mb('POST', `/phones/${mine.id}/park`)).id })
    }
    if (req.method === 'GET' && url.pathname === '/api/usage') return json(res, 200, (await mb('GET', '/account/usage?by=end_user')).end_users)
    json(res, 404, { error: 'not found' })
  } catch (e) {
    console.error(req.url, e.message)
    json(res, e.status && e.status < 500 ? e.status : 502, { error: e.message, ...(e.mb?.next && { next: e.mb.next }) })
  }
})

if (process.argv.includes('--self-check')) {
  const raw = '{"type":"phone.ready"}', t = Math.floor(Date.now() / 1000), sig = createHmac('sha256', 'whsec_x').update(`${t}.${raw}`).digest('hex')
  assert.ok(verify('whsec_x', `t=${t},v1=${sig}`, raw), 'a signed body verifies')
  assert.ok(!verify('whsec_x', `t=${t},v1=${sig}`, raw + ' '), 'a changed body fails')
  assert.ok(!verify('whsec_x', `t=${t - 600},v1=${sig}`, raw), 'an old one fails')
  assert.ok(!verify('whsec_y', `t=${t},v1=${sig}`, raw), 'another secret fails')
  console.log('self-check ok')
} else if (!KEY) {
  console.error('Set MOBILESANDBOX_API_KEY (https://mobilebox.dev/signup).')
  process.exit(1)
} else {
  await setup()
  server.listen(PORT, () => console.log(`Preview on http://localhost:${PORT} (embeds locked to ${ORIGIN}; webhooks ${secret ? `to ${HOOK_URL}` : 'off'})`))
}
