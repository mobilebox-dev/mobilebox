# Installing Mobilebox (for AI agents)

Mobilebox is a hosted MCP server: there is nothing to install or build. You connect your MCP client to `https://mobilebox.dev/mcp` (Streamable HTTP).

## Fastest: follow setup.md

Read https://mobilebox.dev/setup.md?via=llms-install and follow it. It gets your user an API key from their email address (they read you a 6-digit code), adds the MCP server to your client, starts a first phone and checks each step.

## Or configure it directly

1. **Sign in, no key:** clients with MCP OAuth (Claude Code, Cursor, VS Code, Cline with OAuth support) add the URL with no header and sign the user in through the browser.
2. **With an API key:** your user creates one at https://mobilebox.dev/dashboard (API keys). Keep it in an environment variable, `MOBILESANDBOX_API_KEY`, never in a committed file.

Cline (`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "mobilebox": {
      "type": "streamableHttp",
      "url": "https://mobilebox.dev/mcp",
      "headers": { "Authorization": "Bearer ${MOBILESANDBOX_API_KEY}" }
    }
  }
}
```

If your client can't read environment variables in this file, paste the key in place of `${MOBILESANDBOX_API_KEY}` in the user's local settings only.

## Check it works

- `tools/list` shows 19 tools, including `create_phone`, `observe`, `act` and `delete_phone`.
- Call `create_phone`, then `observe`: you get the phone's screen as numbered elements. Then `delete_phone`.

Pricing: cloud Android $0.01 a minute, iPhone and iPad simulators $0.03, billed per second; new workspaces get free credit. Docs: https://mobilebox.dev/docs
