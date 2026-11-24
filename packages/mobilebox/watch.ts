// `mobilebox watch` (#139): open a phone's live view in its own app window. Node built-ins only, because this file is
// also the published `mobilebox` package (build.ts strips its types): `npx mobilebox watch <id>`.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

type Env = Record<string, string | undefined>

// Chromium browsers open a URL as an app window (no tabs or address bar); the first one installed wins.
function browsers(platform: string, env: Env): string[] {
  if (platform === 'darwin') return ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser'].map((app) => `/Applications/${app}.app/Contents/MacOS/${app}`)
  if (platform === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter((r): r is string => Boolean(r))
    return ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe'].flatMap((exe) => roots.map((r) => `${r}\\${exe}`))
  }
  const dirs = (env.PATH ?? '').split(':').filter(Boolean)
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser'].flatMap((b) => dirs.map((d) => join(d, b)))
}

export function opener(url: string, platform: string = process.platform, env: Env = process.env, exists: (file: string) => boolean = existsSync): { cmd: string; args: string[]; app: boolean } {
  const browser = browsers(platform, env).find((b) => exists(b))
  if (browser) return { cmd: browser, args: [`--app=${url}`, '--window-size=1180,900'], app: true }
  if (platform === 'darwin') return { cmd: 'open', args: [url], app: false }
  if (platform === 'win32') return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url], app: false }
  return { cmd: 'xdg-open', args: [url], app: false }
}

// A viewer link as given, or a fresh one for a phone id from the API (POST /v1/phones/{id}/view) with the key.
export async function viewUrl(arg: string, env: Env = process.env): Promise<string> {
  arg = arg.trim().replace(/^(['"])(.*)\1$/, '$2') // a link pasted with the quotes it was shown in
  if (/^https?:\/\//.test(arg)) {
    const url = new URL(arg)
    if (url.pathname !== '/watch' || !url.hash.startsWith('#v1.')) throw new Error('That is not a viewer link: it looks like https://mobilebox.dev/watch#v1.…')
    return arg
  }
  if (!/^ph_[a-z0-9]{1,61}$/.test(arg)) throw new Error('Pass a phone id (ph_…) or a viewer link.')
  const key = env.MOBILESANDBOX_API_KEY
  if (!key) throw new Error('Set MOBILESANDBOX_API_KEY to your API key, or pass the viewer link your agent got from watch_phone.')
  const base = (env.MOBILESANDBOX_URL ?? 'https://mobilebox.dev').replace(/\/$/, '')
  const res = await fetch(`${base}/v1/phones/${arg}/view`, { method: 'POST', headers: { authorization: `Bearer ${key}` } })
  const body = await res.json().catch(() => ({})) as { url?: string; error?: { code: string; message: string; next?: string } }
  if (!res.ok || !body.url) throw new Error(body.error ? `${body.error.code}: ${body.error.message}${body.error.next ? `\nnext: ${body.error.next}` : ''}` : `The API answered ${res.status}.`)
  return body.url
}

export async function watch(arg: string): Promise<void> {
  const url = await viewUrl(arg)
  const { cmd, args, app } = opener(url)
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => console.log('Could not open a browser; open the link yourself.'))
  child.unref()
  console.log(`${app ? 'Opened the live view in its own window' : 'Opened the live view in your browser'}:\n${url}`)
}

export const HELP = `mobilebox — watch a Mobilebox phone live

  mobilebox watch <phone_id | viewer link>   open the phone's live view in its own window

A phone id needs MOBILESANDBOX_API_KEY (and MOBILESANDBOX_URL for another server); a viewer link from the
watch_phone MCP tool or POST /v1/phones/{id}/view needs nothing else.`

if (import.meta.main) {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd !== 'watch' || !arg) console.log(HELP)
  else watch(arg).catch((e: Error) => { console.error(`error: ${e.message}`); process.exit(1) })
}
