import { describe, expect, it } from 'vitest';
import { mobileboxScreenToUiautomatorXml } from './snapshot.ts';

// A Mobilebox screen (GET /v1/phones/{id}/observe) as uiautomator XML: the attributes the WebDriver
// Android parser reads, with values escaped and states carried over.
describe('mobileboxScreenToUiautomatorXml', () => {
  it('writes each element as a node with its class, label, id, bounds and state', () => {
    const xml = mobileboxScreenToUiautomatorXml(
      {
        app: 'org.fossify.math',
        elements: [
          { ref: 1, type: 'Button', text: '7', desc: null, id: 'org.fossify.math:id/btn_7', summary: null, bounds: [0, 1200, 270, 1400], center: [135, 1300], state: [] },
          { ref: 2, type: 'TextField', text: 'a "b" & <c>', desc: 'Search', id: null, summary: null, bounds: [10, 20, 30, 40], center: [20, 30], state: ['focused', 'disabled'] },
        ],
      },
      { width: 1080, height: 2400 },
    );
    expect(xml).toContain('bounds="[0,0][1080,2400]"');
    expect(xml).toContain('class="android.widget.Button" package="org.fossify.math" text="7"');
    expect(xml).toContain('resource-id="org.fossify.math:id/btn_7" bounds="[0,1200][270,1400]" clickable="true"');
    expect(xml).toContain('text="a &quot;b&quot; &amp; &lt;c&gt;" content-desc="Search"');
    expect(xml).toContain('editable="true" enabled="false"');
    expect(xml).toContain('focused="true"');
  });
});
