# OpenHands + Mobilebox: an OpenHands agent builds your Android app, runs it on a cloud phone, reads the crash, fixes
# the code, checks the fix on the phone and pushes it. BUILD and APK describe your build; LLM_MODEL picks the model.
#   pip install openhands-sdk openhands-tools
#   cd your-app-repo && MOBILESANDBOX_API_KEY=... LLM_API_KEY=... python agent.py
import json, os, time, urllib.request
from pydantic import SecretStr
from openhands.sdk import LLM, Agent, Conversation, Tool
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.terminal import TerminalTool

API, KEY = 'https://mobilebox.dev', os.environ['MOBILESANDBOX_API_KEY']
BUILD = os.environ.get('BUILD', './gradlew assembleDebug')
APK = os.environ.get('APK', 'app/build/outputs/apk/debug/app-debug.apk')


def phones(method, path=''):  # your code owns the phone: create it, and always delete it
    req = urllib.request.Request(f'{API}/v1/phones{path}', method=method, headers={'Authorization': f'Bearer {KEY}'})
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read() or 'null')


llm = LLM(usage_id='agent', model=os.environ.get('LLM_MODEL', 'anthropic/claude-sonnet-4-5-20250929'),
          api_key=SecretStr(os.environ['LLM_API_KEY']), base_url=os.environ.get('LLM_BASE_URL'))
agent = Agent(llm=llm, tools=[Tool(name=TerminalTool.name), Tool(name=FileEditorTool.name)],
              mcp_config={'mobilebox': {'url': f'{API}/mcp', 'headers': {'Authorization': f'Bearer {KEY}'},
                                        'timeout': 120_000}})  # milliseconds, not seconds

t0 = time.time()
phone = phones('POST', '?wait=ready')['id']
try:
    conversation = Conversation(agent=agent, workspace=os.getcwd())
    # The terminal gets the key as $MOBILESANDBOX_API_KEY for uploads; OpenHands masks it in all output. It types the
    # export into its shell, so keep that shell's history off disk.
    os.environ['HISTFILE'] = '/dev/null'
    conversation.update_secrets({'MOBILESANDBOX_API_KEY': KEY})
    conversation.send_message(
        f'The app in this repo crashes. Fix it and prove the fix on the Android cloud phone {phone}. '
        f'Build with `{BUILD}`. Install the build with: curl -fsS -H "Authorization: Bearer $MOBILESANDBOX_API_KEY" '
        f'--data-binary @{APK} {API}/v1/phones/{phone}/apps . Then use the Mobilebox tools: act with open_app '
        'to start it and read the screen, app_logs for the crash and its stack trace. Fix the code, rebuild, '
        'reinstall and check on the phone that the crash is gone, then commit and git push. Report the crash, '
        "the fix and what the screen shows now. Don't create or delete phones.")
    conversation.run()
finally:
    phones('DELETE', f'/{phone}')
    print(f'phone {phone} deleted after {time.time() - t0:.0f} s')
