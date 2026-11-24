import fs from 'node:fs';
import path from 'node:path';
import type { FillBackendResult, Interactor, ScreenshotOptions } from '@agent-device/contracts/interactor-types';
import type { ScrollExecutionOptions } from '@agent-device/contracts/scroll-command';
import { AppError } from '@agent-device/kernel/errors';
import type { MobileboxClient } from './client.ts';

/**
 * A Mobilebox phone driven through its REST actions (POST /v1/phones/{id}/actions): taps and text at
 * points, apps by package, the screen through observe and screenshot. Points are screen pixels, as
 * observe reports them.
 */
export type MobileboxPhoneSession = Readonly<{ client: MobileboxClient; phoneId: string; screen(): Promise<{ width: number; height: number }> }>;

const DEFAULT_LONG_PRESS_MS = 800;
const px = (v: number) => Math.max(0, Math.round(v));

export function createMobileboxAndroidInteractor(session: MobileboxPhoneSession): Interactor {
  const act = async (...actions: Record<string, unknown>[]) => await session.client.act(session.phoneId, actions);
  const unsupported = (command: string, message: string): never => {
    throw new AppError('UNSUPPORTED_OPERATION', message, { command });
  };
  return {
    async open(app: string, options?: { url?: string }) {
      if (options?.url || /^[a-z][a-z0-9+.-]*:\/\//i.test(app)) {
        unsupported('open', 'Mobilebox opens apps by package name; deep links are not available through agent-device yet.');
      }
      await act({ type: 'open_app', package: app });
    },
    async openDevice() {},
    async close(app: string) {
      if (app) await act({ type: 'close_app', package: app });
    },
    async tap(x: number, y: number) {
      await act({ type: 'tap', target: { x: px(x), y: px(y) } });
    },
    async longPress(x: number, y: number, durationMs = DEFAULT_LONG_PRESS_MS) {
      await act({ type: 'long_press', target: { x: px(x), y: px(y) }, duration_ms: Math.min(10_000, Math.max(100, Math.round(durationMs))) });
    },
    async focus(x: number, y: number) {
      await act({ type: 'tap', target: { x: px(x), y: px(y) } });
    },
    /** Types into whatever holds focus, through Mobilebox's own input method. */
    async type(text: string, delayMs?: number) {
      if (delayMs && delayMs > 0) unsupported('type', 'Mobilebox types text at once; drop --delay-ms.');
      await act({ type: 'type', text });
    },
    /** Taps the field at the point and replaces its text. */
    async fill(x: number, y: number, text: string, delayMs?: number): Promise<FillBackendResult> {
      if (delayMs && delayMs > 0) unsupported('fill', 'Mobilebox fills a field at once; drop --delay-ms.');
      await act({ type: 'type', text, target: { x: px(x), y: px(y) }, clear: true });
      return { textEntryReadiness: 'focused-element' };
    },
    async scroll(direction: 'up' | 'down' | 'left' | 'right', options?: ScrollExecutionOptions) {
      if (options?.pixels !== undefined || options?.durationMs !== undefined || options?.amount !== undefined) {
        // A measured scroll is a swipe of that length through the middle of the screen.
        const { width, height } = await session.screen();
        const distance = options?.pixels ?? Math.round((direction === 'up' || direction === 'down' ? height : width) * Math.min(0.9, options?.amount ?? 0.5));
        const cx = Math.round(width / 2), cy = Math.round(height / 2), half = Math.round(distance / 2);
        // Content moves down when the finger moves down: scrolling "down" drags up.
        const [from, to] =
          direction === 'down' ? [[cx, cy + half], [cx, cy - half]]
          : direction === 'up' ? [[cx, cy - half], [cx, cy + half]]
          : direction === 'right' ? [[cx + half, cy], [cx - half, cy]]
          : [[cx - half, cy], [cx + half, cy]];
        await act({ type: 'swipe', from, to, duration_ms: Math.min(5000, Math.max(50, options?.durationMs ?? 300)) });
        return;
      }
      await act({ type: 'scroll', direction });
    },
    async screenshot(outPath: string, options?: ScreenshotOptions) {
      if (options?.pixelDensity !== undefined && options.pixelDensity !== 1) {
        unsupported('screenshot', 'Mobilebox screenshots are the phone\'s own pixels; drop --pixel-density.');
      }
      const png = await session.client.screenshot(session.phoneId);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      await fs.promises.writeFile(outPath, png);
    },
    async snapshot() {
      const [{ mobileboxSnapshot }, screen, size] = await Promise.all([
        import('./snapshot.ts'),
        session.client.observe(session.phoneId),
        session.screen(),
      ]);
      return await mobileboxSnapshot(screen, size);
    },
    async back() {
      await act({ type: 'back' });
    },
    async home() {
      await act({ type: 'home' });
    },
    async setOrientation() {
      unsupported('orientation', 'Mobilebox phones stay in portrait through agent-device.');
    },
    async setSetting() {
      unsupported('settings', 'agent-device\'s settings are not mapped to Mobilebox; use the Mobilebox API\'s device settings.');
    },
  } as Interactor;
}
