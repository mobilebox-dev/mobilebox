import type { SnapshotRuntimeResult } from '@agent-device/contracts/interactor-types';
import { snapshotViewportSizeFrom } from '@agent-device/kernel/rect';
import { acquireProviderKeyboard } from '@agent-device/contracts/tap-keyboard-occlusion';
import type { MobileboxElement, MobileboxScreen } from './client.ts';

// Mobilebox lists a screen as elements (GET /v1/phones/{id}/observe): each with its Android class
// family, text, content description, resource id, bounds in screen pixels and state. They are written
// back as the uiautomator XML the WebDriver-backed Android devices parse, so a selector written against
// a local device resolves here from the same node facts.
const CLASSES: Record<string, string> = {
  Button: 'android.widget.Button',
  Text: 'android.widget.TextView',
  TextField: 'android.widget.EditText',
  Switch: 'android.widget.Switch',
  Checkbox: 'android.widget.CheckBox',
  Radio: 'android.widget.RadioButton',
  Image: 'android.widget.ImageView',
  List: 'androidx.recyclerview.widget.RecyclerView',
  Row: 'android.view.ViewGroup',
  Visual: 'android.view.View',
};
const CLICKABLE = new Set(['Button', 'Row', 'Switch', 'Checkbox', 'Radio', 'TextField']);

const escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function mobileboxScreenToUiautomatorXml(screen: MobileboxScreen, size?: { width: number; height: number }): string {
  const pkg = screen.app ?? '';
  const node = (e: MobileboxElement) => {
    const [l, t, r, b] = e.bounds;
    const attrs: Record<string, string | boolean> = {
      class: CLASSES[e.type] ?? 'android.view.View',
      package: pkg,
      text: e.text ?? '',
      'content-desc': e.desc ?? '',
      'resource-id': e.id ?? '',
      bounds: `[${l},${t}][${r},${b}]`,
      clickable: CLICKABLE.has(e.type),
      scrollable: e.type === 'List',
      editable: e.type === 'TextField',
      enabled: !e.state.includes('disabled'),
      checked: e.state.includes('checked'),
      selected: e.state.includes('selected'),
      focused: e.state.includes('focused'),
      password: e.state.includes('password'),
      displayed: true,
    };
    return `<node ${Object.entries(attrs).map(([k, v]) => `${k}="${escape(String(v))}"`).join(' ')}/>`;
  };
  const root = size ? ` bounds="[0,0][${size.width},${size.height}]"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0"><node class="android.widget.FrameLayout" package="${escape(pkg)}" text="" content-desc="" resource-id="" clickable="false" enabled="true" displayed="true"${root}>${screen.elements.map(node).join('')}</node></hierarchy>`;
}

/** The screen as agent-device's Android snapshot nodes, sized to the phone's screen. */
export async function mobileboxSnapshot(screen: MobileboxScreen, size?: { width: number; height: number }): Promise<SnapshotRuntimeResult> {
  const [{ parseWebDriverAndroidSnapshotNodes }, { stampSnapshotIdentity }] = await Promise.all([
    import('@agent-device/provider-webdriver/android-snapshot'),
    import('@agent-device/contracts/snapshot-producers'),
  ]);
  const viewport = size ? snapshotViewportSizeFrom({ x: 0, y: 0, ...size }) : undefined;
  const { nodes, keyboard } = acquireProviderKeyboard({
    nodes: parseWebDriverAndroidSnapshotNodes(mobileboxScreenToUiautomatorXml(screen, size)),
    viewport: viewport ? { x: 0, y: 0, ...viewport } : null,
  });
  // Snapshot producers are a closed list a plugin cannot add to. A Mobilebox tree comes from the
  // provider's own reading of the screen, as Revyl's does, with the same guarantees: no truncation
  // evidence, provider-derived residue; so it reports Revyl's Android producer, as the NoMac plugin
  // reports Revyl's iOS one.
  return stampSnapshotIdentity(
    { nodes, keyboard, ...(viewport ? { viewport } : {}) },
    { backend: 'android', producer: 'revyl-android-tree' },
  ) satisfies SnapshotRuntimeResult;
}
