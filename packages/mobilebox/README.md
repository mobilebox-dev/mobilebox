# mobilebox

Watch a [Mobilebox](https://mobilebox.dev) phone live: its screen, plus every action your AI agent takes on it, in its own window. A cursor moves to each target, taps ripple, swipes leave a trail, typed text appears, and each step gets a caption.

![Live view: a cursor, taps, swipes, typed text and a caption for every step](https://github.com/mobilebox-dev/mobilebox/raw/main/.github/readme/live-view.gif)

```bash
export MOBILESANDBOX_API_KEY=...        # from https://mobilebox.dev/dashboard
npx mobilebox watch <phone_id>          # or pass the viewer link your agent got from watch_phone
```

Mobilebox gives AI agents cloud phones over MCP and a REST API: create a phone, read the screen, tap, type, install apps. Your agent can open the live view itself with the `watch_phone` MCP tool or `POST /v1/phones/{id}/view`.

## Tools for the Vercel AI SDK

`mobilebox/ai` gives `generateText` and `streamText` the Mobilebox MCP tools: `create_phone` (Android, or an iPhone simulator with `platform: "ios"`), `observe`, `act`, `screenshot`, `install_app`, `park_phone`, `delete_phone` and more.

```bash
npm i mobilebox ai @ai-sdk/mcp
```

```ts
import { generateText, isStepCount } from 'ai';
import { mobileboxTools } from 'mobilebox/ai';

const mobilebox = await mobileboxTools(); // reads MOBILESANDBOX_API_KEY
const { text } = await generateText({
  model: 'openai/gpt-5-mini',
  prompt: 'Open Settings > Display on a new phone, tell me the brightness level, then delete the phone.',
  tools: mobilebox.tools,
  stopWhen: isStepCount(10),
});
await mobilebox.close();
console.log(text);
```

Pass `tools: ['create_phone', 'observe', 'act', 'delete_phone']` to give the model fewer tools. Phones cost $0.01 a minute (iPhone $0.03) while they run, so tell the model to delete its phone.

- Website and pricing: https://mobilebox.dev
- Docs: https://mobilebox.dev/docs
- MCP server: `https://mobilebox.dev/mcp` (registry name `dev.mobilebox/mobilebox`)
- Examples: https://github.com/mobilebox-dev/mobilebox

Node 20 or newer. `npx mobilebox watch` has no dependencies; `mobilebox/ai` needs `@ai-sdk/mcp`. MIT.

## A provider for agent-device

[agent-device](https://github.com/callstack/agent-device) (Callstack) drives phones for coding agents. This package is also its Mobilebox provider plugin: each agent-device session gets its own cloud Android phone, deleted when the session closes.

```bash
agent-device plugins add mobilebox
export MOBILEBOX_API_KEY=mbx_...
export AGENT_DEVICE_SESSION=checkout-android
agent-device connect mobilebox
agent-device install com.example.app ./app-debug.apk
agent-device open com.example.app
agent-device snapshot -i
```

What it supports and how it is built: [packages/agent-device](https://github.com/mobilebox-dev/mobilebox/tree/main/packages/agent-device#readme).
