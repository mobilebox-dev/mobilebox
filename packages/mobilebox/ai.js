// Mobilebox tools for the Vercel AI SDK (#130): the hosted MCP server's tools (create_phone, observe, act, screenshot,
// install_app, park_phone, delete_phone, ...) as AI SDK tools. Needs `@ai-sdk/mcp` next to `ai`.
//   const mobilebox = await mobileboxTools()            // MOBILESANDBOX_API_KEY from the environment
//   await generateText({ model, prompt, tools: mobilebox.tools, stopWhen: isStepCount(10) })
//   await mobilebox.close()
import { createMCPClient } from '@ai-sdk/mcp'

export const MCP_URL = 'https://mobilebox.dev/mcp'

export async function mobileboxTools({ apiKey = process.env.MOBILESANDBOX_API_KEY, url = MCP_URL, tools } = {}) {
  if (!apiKey) throw new Error('mobileboxTools: set MOBILESANDBOX_API_KEY or pass apiKey (create one at https://mobilebox.dev/dashboard)')
  const client = await createMCPClient({ transport: { type: 'http', url, headers: { Authorization: `Bearer ${apiKey}` } } })
  try {
    const all = await client.tools()
    // ponytail: a name filter, not schemas; pass `tools` to give the model fewer tools.
    const picked = tools ? Object.fromEntries(Object.entries(all).filter(([name]) => tools.includes(name))) : all
    return { tools: picked, close: () => client.close() }
  } catch (err) {
    await client.close()
    throw err
  }
}
