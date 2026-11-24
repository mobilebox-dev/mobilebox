// The shape of this module follows the @nomac/agent-device plugin (MIT, github.com/NoMac-app/agent-device-plugin),
// which binds a provider-owned phone to agent-device's operations the way @agent-device/revyl does.
import type {
  AppDeploymentInput,
  AppDeploymentResult,
  DeployMaterializedAppInput,
  MaterializeAppSourceInput,
} from '@agent-device/contracts/app-deployment-runtime';
import {
  applicationLifecycleOperationFacts,
  availableApplicationLifecycleOperations,
} from '@agent-device/contracts/application-lifecycle-runtime';
import {
  bindDirectApplicationLifecycle,
  bindProviderApplicationLifecycleInteractor,
} from '@agent-device/contracts/application-lifecycle-interaction';
import { appEventRuntimeOperationFacts } from '@agent-device/contracts/app-event-runtime';
import { backRuntimeOperationFacts } from '@agent-device/contracts/back-runtime';
import type { ProviderDeviceInstallResult } from '@agent-device/contracts/device';
import {
  bindProviderFocusInteractor,
  focusRuntimeOperationFacts,
} from '@agent-device/contracts/focus-runtime';
import { bindAdmittedProviderInteractorOperations } from '@agent-device/contracts/interactor-operation-binding';
import { INTERACTOR_OPERATIONS } from '@agent-device/contracts/interactor-operation-catalog';
import type { Interactor, RunnerContext } from '@agent-device/contracts/interactor-types';
import {
  type DeviceBinding,
  providerRuntimeOwner,
  type RuntimeFacts,
  type RuntimeOperationFact,
  type RuntimeOperationUnavailability,
  sameRuntimeOwner,
  unavailableFact,
} from '@agent-device/contracts/platform-runtime';
import type {
  PlatformRuntimeHost,
  PlatformRuntimeOperations,
  PlatformRuntimeOwner,
} from '@agent-device/contracts/platform-runtime-operations';
import { createUnavailablePlatformRuntimeFacts } from '@agent-device/contracts/platform-runtime-unavailable';
import {
  bindProviderScreenshotInteractor,
  defaultCaptureOnly,
  screenshotRuntimeOperationFacts,
} from '@agent-device/contracts/screenshot-runtime';
import {
  bindProviderScrollInteractor,
  scrollRuntimeOperationFacts,
} from '@agent-device/contracts/scroll-runtime';
import {
  bindProviderSnapshotInteractor,
  snapshotRuntimeOperationFacts,
} from '@agent-device/contracts/snapshot-runtime';
import { systemButtonRuntimeOperationFacts } from '@agent-device/contracts/system-button-runtime';
import {
  bindProviderTouchInteractor,
  touchRuntimeOperationFacts,
} from '@agent-device/contracts/touch-runtime';
import {
  bindProviderTypeTextInteractor,
  typeTextRuntimeOperationFacts,
} from '@agent-device/contracts/type-text-runtime';
import type { DeviceInfo } from '@agent-device/kernel/device';
import { AppError } from '@agent-device/kernel/errors';
import { setTimeout as sleep } from 'node:timers/promises';
import { isSupportedMobileboxDevice, MOBILEBOX_PROVIDER } from './device.ts';

const available = Object.freeze({ available: true } as const);
const unsupported = (message: string) => unavailableFact('unsupported-provider-mode', message);

/** Every operation's verdict when the device names no live Mobilebox phone. */
const liveSessionUnavailable = unavailableFact(
  'owner-capability-missing',
  'Mobilebox requires a live phone for this device; open it again to start one.',
);

// What a Mobilebox phone does not serve through agent-device, each with where to go instead.
const GAPS = {
  appLog: unsupported("Mobilebox serves app logs through its own API: GET /v1/phones/{id}/logs (MCP app_logs)."),
  apps: unsupported('Mobilebox lists installed apps through its own API (GET /v1/phones/{id}/apps); open an app by its package.'),
  appState: unsupported('Mobilebox does not report the foreground app to agent-device; a snapshot names it.'),
  network: unsupported('Mobilebox does not capture network traffic for agent-device.'),
  screenRecording: unsupported("Mobilebox records the screen through its own API (POST /v1/phones/{id}/recording/start)."),
  viewport: unsupported('Mobilebox phones keep their screen size.'),
  gesture: unsupported('Mobilebox does not run portable gesture plans yet; tap, long press, scroll, type and fill are available.'),
  elementText: unsupported('Mobilebox-owned devices read element text from the captured tree only.'),
  orientation: unsupported('Mobilebox phones stay in portrait through agent-device.'),
  fold: unsupported('Mobilebox phones have no hinge.'),
  telephony: unsupported('Mobilebox phones have no telephony through agent-device.'),
  tvRemote: unsupported('Mobilebox phones have no TV remote.'),
  keyboard: unsupported('Mobilebox does not expose keyboard actions to agent-device; type, fill and back are available.'),
  clipboard: unsupported('Mobilebox does not expose the clipboard.'),
  systemButton: unsupported('Mobilebox phones press back and home only.'),
  settings: unsupported("agent-device's settings are not mapped to Mobilebox; its API sets locale, location and network (PATCH /v1/phones/{id}/device)."),
  alert: unsupported('Read and answer dialogs from a snapshot on Mobilebox phones.'),
  audioProbe: unsupported('Mobilebox does not expose the audio probe.'),
  perf: unsupported('Mobilebox does not expose performance captures.'),
  shutdown: unsupported('Mobilebox owns the phone lifecycle; closing the lease deletes it.'),
  customSnapshotActions: unsupported('Custom snapshot actions are unavailable on Mobilebox phones.'),
  pushNotification: unsupported('Push notifications are unavailable for Mobilebox phones.'),
  uninstall: unsupported('Uninstall through the Mobilebox API (DELETE /v1/phones/{id}/apps/{package}); a new phone starts clean.'),
  headless: unsupported('Headless boot is unavailable for provider-owned devices.'),
  runtimeHints: unsupported('Runtime hints are not applied to provider-owned devices.'),
  appleRunner: unsupported('Apple runner preparation does not apply to Android phones.'),
  portReverse: unsupported('Mobilebox phones reach your local server at a public URL, not through port reverse.'),
} satisfies Record<string, RuntimeOperationUnavailability>;

export type MobileboxPlatformRuntimeOwnerOptions = Readonly<{
  host: PlatformRuntimeHost;
  runtimeInstance: string;
  ownsDevice(device: DeviceInfo): boolean;
  hasLiveSession(device: DeviceInfo): boolean;
  getInteractor(device: DeviceInfo, runner?: RunnerContext): Interactor | undefined;
  installApp(device: DeviceInfo, apkPath: string, signal: AbortSignal): Promise<ProviderDeviceInstallResult | undefined>;
}>;

function lifecycleFacts(cell: RuntimeOperationFact) {
  return applicationLifecycleOperationFacts({
    resolveOpenTarget: cell,
    prepareApplicationOpen: cell,
    openApplication: cell,
    applyRuntimeHints: GAPS.runtimeHints,
    clearRuntimeHints: GAPS.runtimeHints,
    closeApplication: cell,
    finalizeApplicationClose: cell,
    prepareAppleRunner: GAPS.appleRunner,
    configureProviderPortReverse: GAPS.portReverse,
  });
}

function mobileboxRuntimeFacts(
  owner: ReturnType<typeof providerRuntimeOwner>,
  device: DeviceInfo,
  live: boolean,
): RuntimeFacts<PlatformRuntimeOperations> {
  const cell: RuntimeOperationFact = live && isSupportedMobileboxDevice(device) ? available : liveSessionUnavailable;
  const gap = (fact: RuntimeOperationUnavailability) => (cell.available ? fact : liveSessionUnavailable);
  const base = createUnavailablePlatformRuntimeFacts(device, owner, {
    appLog: gap(GAPS.appLog),
    apps: gap(GAPS.apps),
    appState: gap(GAPS.appState),
    network: gap(GAPS.network),
    screenRecording: gap(GAPS.screenRecording),
    screenshot: liveSessionUnavailable,
    snapshot: liveSessionUnavailable,
    viewport: gap(GAPS.viewport),
    focus: liveSessionUnavailable,
    gesture: gap(GAPS.gesture),
    scroll: liveSessionUnavailable,
    typeText: liveSessionUnavailable,
    touch: gap(unsupported('Mobilebox taps, long-presses and fills at points.')),
    elementText: gap(GAPS.elementText),
    back: liveSessionUnavailable,
    orientation: gap(GAPS.orientation),
    fold: GAPS.fold,
    telephony: GAPS.telephony,
    tvRemote: GAPS.tvRemote,
    keyboard: gap(GAPS.keyboard),
    clipboard: gap(GAPS.clipboard),
    systemButton: gap(GAPS.systemButton),
    triggerAppEvent: gap(unsupported('Mobilebox does not open deep links through agent-device yet.')),
    settings: gap(GAPS.settings),
    readAlert: gap(GAPS.alert),
    awaitAlert: gap(GAPS.alert),
    acceptAlert: gap(GAPS.alert),
    dismissAlert: gap(GAPS.alert),
    audioProbeCapture: gap(GAPS.audioProbe),
    audioProbeQuery: gap(GAPS.audioProbe),
    perf: gap(GAPS.perf),
    readiness: liveSessionUnavailable,
    shutdown: gap(GAPS.shutdown),
    lifecycle: lifecycleFacts(cell),
  });
  return Object.freeze({
    device: base.device,
    operations: Object.freeze({
      ...base.operations,
      ...snapshotRuntimeOperationFacts({ capture: cell, customActions: gap(GAPS.customSnapshotActions), withoutActiveApp: cell }),
      ...screenshotRuntimeOperationFacts({ capture: cell }),
      ...focusRuntimeOperationFacts({ focus: cell }),
      ...typeTextRuntimeOperationFacts({ type: cell }),
      ...touchRuntimeOperationFacts({
        unsupported: gap(unsupported('Mobilebox taps, long-presses and fills at points.')),
        tap: cell,
        longPress: cell,
        fill: cell,
      }),
      ...scrollRuntimeOperationFacts({ scroll: cell }),
      ...backRuntimeOperationFacts({ back: cell }),
      ...appEventRuntimeOperationFacts({ triggerAppEvent: gap(unsupported('Mobilebox does not open deep links through agent-device yet.')) }),
      ...systemButtonRuntimeOperationFacts({ unsupported: gap(GAPS.systemButton), home: cell }),
      ensureReady: cell,
      bootTarget: cell,
      bootTargetHeadless: gap(GAPS.headless),
      deployApp: cell,
      materializeAppSource: cell,
      deployMaterializedApp: cell,
      sendPushNotification: gap(GAPS.pushNotification),
      uninstallApp: gap(GAPS.uninstall),
    }),
  });
}

export function createMobileboxPlatformRuntimeOwner(options: MobileboxPlatformRuntimeOwnerOptions): PlatformRuntimeOwner {
  const owner = providerRuntimeOwner(MOBILEBOX_PROVIDER, options.runtimeInstance);
  const ownsDevice = (device: DeviceInfo) => isSupportedMobileboxDevice(device) && options.ownsDevice(device);
  const live = (device: DeviceInfo) => ownsDevice(device) && options.hasLiveSession(device);
  return Object.freeze({
    owner,
    ownsDevice,
    inspectFacts: async (device) => mobileboxRuntimeFacts(owner, device, live(device)),
    bind: async (request) => {
      if (request.intent.kind === 'exact-owner' && !sameRuntimeOwner(request.intent.owner, owner)) {
        throw new AppError('UNSUPPORTED_OPERATION', 'Mobilebox runtime owner identity does not match');
      }
      if (!isSupportedMobileboxDevice(request.device)) {
        throw new AppError('UNSUPPORTED_PLATFORM', 'Mobilebox serves the Android phones it started');
      }
      if (!live(request.device)) {
        throw new AppError('UNSUPPORTED_OPERATION', 'The Mobilebox phone for this device is no longer live', {
          reason: 'provider-session-unavailable',
        });
      }
      return bindMobileboxPhone(options, owner, request.device, request.scope.signal);
    },
    shutdown: async () => undefined,
  });
}

function bindMobileboxPhone(
  options: MobileboxPlatformRuntimeOwnerOptions,
  owner: ReturnType<typeof providerRuntimeOwner>,
  device: DeviceInfo,
  signal: AbortSignal,
): DeviceBinding<PlatformRuntimeOperations> {
  const facts = mobileboxRuntimeFacts(owner, device, true);
  const resolveInteractor = (runner: RunnerContext) => options.getInteractor(device, runner);
  const install = async (apkPath: string): Promise<AppDeploymentResult> => {
    const result = await options.installApp(device, apkPath, signal);
    if (!result) throw new AppError('UNSUPPORTED_OPERATION', 'The Mobilebox phone for this device is no longer live.');
    return result;
  };
  const operations = {
    ensureReady: async () => ({ ...device, booted: true }),
    bootTarget: async () => ({ ...device, booted: true }),
    ...availableApplicationLifecycleOperations(
      bindDirectApplicationLifecycle({
        owner: 'Mobilebox',
        openTargetIdentity: 'bundle-id',
        closeBeforeRelaunch: true,
        binding: bindProviderApplicationLifecycleInteractor({ device, signal, resolveInteractor }),
      }),
      lifecycleFacts(available),
    ),
    ...bindProviderSnapshotInteractor({ device, signal, resolveInteractor }),
    ...bindProviderScreenshotInteractor({
      device,
      signal,
      resolveInteractor,
      captureCapabilities: defaultCaptureOnly('Mobilebox captures through its own screenshot endpoint'),
    }),
    ...bindProviderFocusInteractor({ device, signal, resolveInteractor }),
    ...bindProviderTypeTextInteractor({ device, signal, resolveInteractor }),
    ...bindProviderTouchInteractor({
      device,
      signal,
      resolveInteractor,
      facts: facts.operations,
      pause: async (milliseconds) => await sleep(milliseconds, undefined, { signal }),
    }),
    ...bindProviderScrollInteractor({ device, signal, resolveInteractor }),
    ...bindAdmittedProviderInteractorOperations({ operations: INTERACTOR_OPERATIONS, device, signal, resolveInteractor, facts: facts.operations }),
    deployApp: async (input: AppDeploymentInput) => await install(input.appPath),
    // A URL or a build output becomes a local .apk the way agent-device prepares any Android app.
    materializeAppSource: async (input: MaterializeAppSourceInput) => await options.host.androidDeployment.prepareArtifact(input, { signal }),
    deployMaterializedApp: async (input: DeployMaterializedAppInput) => await install(input.artifact.uploadPath ?? input.artifact.installablePath),
  } satisfies DeviceBinding<PlatformRuntimeOperations>['operations'];
  return Object.freeze({ device, owner, facts, operations: Object.freeze(operations), [Symbol.asyncDispose]: async () => undefined });
}
