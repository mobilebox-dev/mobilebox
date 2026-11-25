# Haystack + Mobilebox: a Haystack Agent drives a cloud Android phone over MCP.
#   pip install haystack-ai mcp-haystack
#   MOBILESANDBOX_API_KEY=... OPENAI_API_KEY=... python agent.py
import json, os, urllib.request

from haystack.components.agents import Agent
from haystack.components.generators.chat import OpenAIChatGenerator
from haystack.dataclasses import ChatMessage
from haystack.utils import Secret
from haystack_integrations.tools.mcp import MCPToolset, StreamableHttpServerInfo

API = "https://mobilebox.dev"
AUTH = {"Authorization": f"Bearer {os.environ['MOBILESANDBOX_API_KEY']}"}


def phones(method, path=""):  # your code owns the phone: create it, and always delete it
    req = urllib.request.Request(f"{API}/v1/phones{path}", method=method, headers=AUTH)
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read() or "null")


phone = phones("POST", "?wait=ready")["id"]
toolset = MCPToolset(
    server_info=StreamableHttpServerInfo(url=f"{API}/mcp", token=Secret.from_env_var("MOBILESANDBOX_API_KEY")),
    tool_names=["observe", "act", "screenshot", "install_app"],  # the agent drives; it can't create or delete phones
    invocation_timeout=60,
    eager_connect=True,
)
try:
    agent = Agent(
        chat_generator=OpenAIChatGenerator(model=os.environ.get("MODEL", "gpt-5.4-mini")),
        tools=toolset,
        system_prompt=f"You operate the Android phone {phone} with the Mobilebox tools. "
        "Observe, act, and check each result on the returned screen.",
        max_agent_steps=20,
    )
    result = agent.run(messages=[ChatMessage.from_user("Open Settings > Display and tell me the brightness level.")])
    print(result["last_message"].text)
finally:
    toolset.close()
    phones("DELETE", f"/{phone}")
