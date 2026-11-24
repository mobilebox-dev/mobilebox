// Builds the published `mobilebox` package from watch.ts: the same code with its types stripped, so
// `npx mobilebox watch <id>` runs on plain Node. `npm pack` here runs it (prepack); the output stays out of git.
// Usage: node packages/mobilebox/build.ts [out dir, default this folder]
import { readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { join } from 'node:path'

const out = process.argv[2] ?? import.meta.dirname
const source = readFileSync(new URL('./watch.ts', import.meta.url), 'utf8')
// The bin always runs (import.meta.main is Node 24+; the package supports older Node).
const js = stripTypeScriptTypes(source).replace('if (import.meta.main) {', 'if (true) {')
if (js.includes('import.meta.main')) throw new Error('watch.ts: expected one `if (import.meta.main) {` block')
writeFileSync(join(out, 'mobilebox.js'), `#!/usr/bin/env node\n${js}`, { mode: 0o755 })
