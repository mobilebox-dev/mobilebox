import type { DeviceLease } from '@agent-device/contracts/device';
import type { ProviderProfileFieldDeclaration } from '@agent-device/contracts/provider-profile-fields';
import type { DeviceInfo } from '@agent-device/kernel/device';
import { AppError } from '@agent-device/kernel/errors';

export const MOBILEBOX_PROVIDER = 'mobilebox';
export const MOBILEBOX_BACKEND = 'android-instance';
/** Mobilebox runs Android 12, 13 and 14 (the default) phones. */
const ANDROID_VERSIONS = ['12', '13', '14'] as const;

/** `--provider-os-version` picks the Android version; every other cloud profile field is refused, not dropped. */
export const MOBILEBOX_PROFILE_FIELDS: ProviderProfileFieldDeclaration = {
  provider: MOBILEBOX_PROVIDER,
  label: 'Mobilebox',
  fields: {
    providerApp: 'refused',
    providerOsVersion: 'consumed',
    providerDeviceType: 'refused',
    providerProject: 'refused',
    providerBuild: 'refused',
    providerSessionName: 'refused',
    providerDeviceOrientation: 'refused',
    providerGeoLocation: 'refused',
    providerTimezone: 'refused',
    providerAppiumVersion: 'refused',
    providerLanguage: 'refused',
    providerLocale: 'refused',
    providerNetworkProfile: 'refused',
    providerCustomNetwork: 'refused',
    providerNoResignApp: 'refused',
    providerNetworkLogs: 'refused',
    providerNetworkHosts: 'refused',
    awsProjectArn: 'refused',
    awsDeviceArn: 'refused',
    awsAppArn: 'refused',
    awsRegion: 'refused',
    awsInteractionMode: 'refused',
  },
};

/** The Android version a lease asks for: 14 unless `--provider-os-version` says 12 or 13. */
export function mobileboxAndroidVersion(flags: Readonly<Record<string, unknown>> | undefined): string {
  const asked = typeof flags?.providerOsVersion === 'string' ? flags.providerOsVersion.trim() : '';
  const major = asked.split('.')[0] || '14';
  if (!(ANDROID_VERSIONS as readonly string[]).includes(major)) {
    throw new AppError('INVALID_ARGS', `Mobilebox has no Android ${asked}; pass 12, 13 or 14 (the default) to --provider-os-version.`);
  }
  return major;
}

export function buildMobileboxDevice(lease: DeviceLease, phoneId: string, android: string): DeviceInfo {
  return {
    platform: 'android',
    id: `${MOBILEBOX_PROVIDER}:android:${lease.leaseId}`,
    // The phone id whole: it is what the Mobilebox dashboard and API name the phone by.
    name: `Mobilebox ${phoneId}`,
    kind: 'emulator',
    target: 'mobile',
    osVersion: android,
    booted: true,
  };
}

export function parseMobileboxDeviceId(value: string): { leaseId: string } | undefined {
  const [prefix, platform, ...rest] = value.split(':');
  const leaseId = rest.join(':');
  return prefix === MOBILEBOX_PROVIDER && platform === 'android' && leaseId ? { leaseId } : undefined;
}

export function isSupportedMobileboxDevice(device: DeviceInfo): boolean {
  return parseMobileboxDeviceId(device.id) !== undefined && device.platform === 'android' && device.target === 'mobile';
}
