import { createHash, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import type {
  DeviceInventoryProvider,
  DeviceLease,
  LeaseLifecycleContext,
  LeaseLifecycleProvider,
  ProviderDeviceInstallOptions,
  ProviderDeviceInstallResult,
  ProviderDeviceRuntime,
  ProviderExpiredLeaseRecovery,
} from '@agent-device/contracts/device';
import type { Interactor, RunnerContext } from '@agent-device/contracts/interactor-types';
import { providerRuntimeOwner } from '@agent-device/contracts/platform-runtime';
import type { PlatformRuntimeHost, PlatformRuntimeProviderModule } from '@agent-device/contracts/platform-runtime-operations';
import { rejectRefusedProviderProfileFields } from '@agent-device/contracts/provider-profile-fields';
import type { DeviceInfo } from '@agent-device/kernel/device';
import { AppError } from '@agent-device/kernel/errors';
import { MobileboxClient } from './client.ts';
import {
  buildMobileboxDevice,
  MOBILEBOX_BACKEND,
  MOBILEBOX_PROFILE_FIELDS,
  MOBILEBOX_PROVIDER,
  mobileboxAndroidVersion,
  parseMobileboxDeviceId,
} from './device.ts';
import { createMobileboxAndroidInteractor } from './interactor.ts';

export type MobileboxRuntimeOptions = Readonly<{
  /** The workspace's API key (mbx_…); a lease refuses without one. */
  apiKey?: string;
  /** https://mobilebox.dev unless set. */
  baseUrl?: string;
  clientVersion: string;
  runtimeInstance?: string;
  fetch?: typeof fetch;
}>;

type Session = { lease: DeviceLease; phoneId: string; device: DeviceInfo; size?: Promise<{ width: number; height: number }> };

export type MobileboxRuntime = ProviderDeviceRuntime & { recoverExpiredLease: ProviderExpiredLeaseRecovery; hasLiveSession(device: DeviceInfo): boolean };

const LIVE = new Set(['creating', 'starting', 'ready', 'parking']);

export function createMobileboxRuntime(options: MobileboxRuntimeOptions): Readonly<{ runtime: MobileboxRuntime; platformModule: PlatformRuntimeProviderModule }> {
  const runtime = new MobileboxRuntimeImplementation(options);
  const owner = providerRuntimeOwner(MOBILEBOX_PROVIDER, runtimeInstance(options));
  if (owner.kind !== 'provider-runtime') throw new TypeError('Invalid Mobilebox runtime owner');
  return Object.freeze({
    runtime,
    platformModule: Object.freeze({
      owner,
      loadRuntime: async (host: PlatformRuntimeHost) =>
        (await import('./platform-runtime.ts')).createMobileboxPlatformRuntimeOwner({
          host,
          runtimeInstance: owner.instance,
          ownsDevice: (device) => runtime.ownsDevice(device),
          hasLiveSession: (device) => runtime.hasLiveSession(device),
          getInteractor: (device, runner) => runtime.getInteractor(device, runner),
          installApp: async (device, apkPath, signal) => await runtime.installApk(device, apkPath, signal),
        }),
    }),
  });
}

class MobileboxRuntimeImplementation implements MobileboxRuntime {
  readonly provider = MOBILEBOX_PROVIDER;
  private readonly client: MobileboxClient;
  private readonly sessions = new Map<string, Session>();

  readonly leaseLifecycle: LeaseLifecycleProvider = {
    allocate: async (lease, context) => await this.allocate(lease, context),
    release: async (lease) => await this.release(lease),
  };

  readonly recoverExpiredLease: ProviderExpiredLeaseRecovery = async (lease) => {
    if (lease.leaseProvider !== this.provider || lease.backend !== MOBILEBOX_BACKEND) {
      throw new AppError('UNSUPPORTED_OPERATION', 'Mobilebox cannot recover this expired lease.', { leaseId: lease.leaseId });
    }
    await this.release(lease);
  };

  readonly deviceInventoryProvider: DeviceInventoryProvider = async (request) => {
    if (request.leaseProvider !== this.provider || !request.leaseId) return null;
    const session = this.sessions.get(request.leaseId);
    if (!session) return null;
    if (request.platform && request.platform !== 'android') return [];
    return [session.device];
  };

  constructor(options: MobileboxRuntimeOptions) {
    this.client = new MobileboxClient(options);
  }

  ownsDevice(device: DeviceInfo): boolean {
    return parseMobileboxDeviceId(device.id) !== undefined;
  }

  hasLiveSession(device: DeviceInfo): boolean {
    return this.sessionFor(device) !== undefined;
  }

  getInteractor(device: DeviceInfo, _runner?: RunnerContext): Interactor | undefined {
    const session = this.sessionFor(device);
    if (!session) return undefined;
    // The screen's size, read once per phone from its first screenshot (a PNG's IHDR).
    const screen = () =>
      (session.size ??= this.client.screenshot(session.phoneId).then((png) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) })));
    return createMobileboxAndroidInteractor({ client: this.client, phoneId: session.phoneId, screen });
  }

  async installApp(device: DeviceInfo, _app: string, appPath: string, _options?: ProviderDeviceInstallOptions): Promise<ProviderDeviceInstallResult | undefined> {
    return await this.installApk(device, appPath);
  }

  /** An .apk (or a split bundle: .apks, .xapk) from the host, uploaded to the phone and installed. */
  async installApk(device: DeviceInfo, apkPath: string, signal?: AbortSignal): Promise<ProviderDeviceInstallResult | undefined> {
    const session = this.sessionFor(device);
    if (!session) return undefined;
    if (!/\.(apk|apks|xapk)$/i.test(apkPath)) {
      throw new AppError('INVALID_ARGS', `${apkPath} is not an .apk, .apks or .xapk; Mobilebox phones install Android packages.`);
    }
    const installed = await this.client.install(session.phoneId, await fs.promises.readFile(apkPath), signal);
    return { packageName: installed.package, launchTarget: installed.package };
  }

  async shutdown(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map(async (s) => await this.client.deletePhone(s.phoneId)));
  }

  private async allocate(lease: DeviceLease, context?: LeaseLifecycleContext): Promise<Record<string, unknown> | undefined> {
    if (lease.leaseProvider !== this.provider || lease.backend !== MOBILEBOX_BACKEND) return undefined;
    rejectRefusedProviderProfileFields(context?.flags, MOBILEBOX_PROFILE_FIELDS);
    const existing = this.sessions.get(lease.leaseId);
    if (existing) return { mobileboxPhoneId: existing.phoneId, device: existing.device };
    const android = mobileboxAndroidVersion(context?.flags);
    context?.signal?.throwIfAborted();
    try {
      // The lease's own idempotency key: an allocation retried after a lost answer reaches the same phone.
      const phone = await this.client.createPhone(leaseLabel(lease.leaseId), `agent-device-${hash(lease.leaseId)}`, { android }, context?.signal);
      const ready = phone.status === 'ready' ? phone : await this.client.readPhone(phone.id, context?.signal);
      if (ready.status !== 'ready') {
        await this.client.deletePhone(phone.id).catch(() => {});
        throw new AppError('COMMAND_FAILED', `The Mobilebox phone did not get ready (${ready.status}).`, { mobileboxPhoneId: phone.id });
      }
      const session: Session = { lease, phoneId: phone.id, device: buildMobileboxDevice(lease, phone.id, android) };
      this.sessions.set(lease.leaseId, session);
      return { mobileboxPhoneId: phone.id, device: session.device };
    } catch (error) {
      // The daemon drops a lease that failed to allocate without releasing it: whatever this started goes now.
      await this.deleteLabelled(lease.leaseId).catch(() => {});
      throw context?.signal?.aborted ? context.signal.reason : error;
    }
  }

  private async release(lease: DeviceLease): Promise<Record<string, unknown> | undefined> {
    const session = this.sessions.get(lease.leaseId);
    if (session) {
      this.sessions.delete(lease.leaseId);
      await this.client.deletePhone(session.phoneId);
      return { mobileboxPhoneId: session.phoneId };
    }
    // A lease this daemon lost track of (a restart): its phone carries the lease's name.
    if (lease.leaseProvider !== this.provider || lease.backend !== MOBILEBOX_BACKEND) return undefined;
    const deleted = await this.deleteLabelled(lease.leaseId);
    return deleted.length ? { mobileboxPhoneId: deleted[0] } : undefined;
  }

  private async deleteLabelled(leaseId: string): Promise<string[]> {
    const phones = (await this.client.phones()).filter((p) => p.name === leaseLabel(leaseId) && LIVE.has(p.status));
    for (const p of phones) await this.client.deletePhone(p.id);
    return phones.map((p) => p.id);
  }

  private sessionFor(device: DeviceInfo): Session | undefined {
    const parsed = parseMobileboxDeviceId(device.id);
    return parsed ? this.sessions.get(parsed.leaseId) : undefined;
  }
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

/** The phone's name: the lease it belongs to, so a lost lease's phone can be found and deleted. */
export function leaseLabel(leaseId: string): string {
  return `agent-device-${hash(leaseId).slice(0, 24)}`;
}

/** A stable owner instance per account, without the key in it. */
function runtimeInstance(options: MobileboxRuntimeOptions): string {
  if (options.runtimeInstance?.trim()) return options.runtimeInstance.trim();
  const principal = JSON.stringify({ provider: MOBILEBOX_PROVIDER, base: options.baseUrl ?? 'default', apiKey: options.apiKey });
  return `principal-${scryptSync(principal, 'agent-device:mobilebox-runtime-owner:v1', 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
}
