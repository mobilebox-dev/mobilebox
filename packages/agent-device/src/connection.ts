import type { CliFlags } from '@agent-device/contracts/command';
import { rejectRefusedProviderProfileFields } from '@agent-device/contracts/provider-profile-fields';
import type { ProviderConnectionVerification } from '@agent-device/contracts/remote';
import { AppError } from '@agent-device/kernel/errors';
import { MobileboxClient } from './client.ts';
import { MOBILEBOX_PROFILE_FIELDS, MOBILEBOX_PROVIDER, mobileboxAndroidVersion } from './device.ts';

export const MOBILEBOX_CREDENTIAL_VARIABLE = 'MOBILEBOX_API_KEY';
export const MOBILEBOX_BASE_URL_VARIABLE = 'MOBILEBOX_API_URL';

type Env = Readonly<Record<string, string | undefined>>;

function requireAndroid(flags: CliFlags): 'android' {
  if (flags.platform !== undefined && flags.platform !== 'android') {
    throw new AppError('INVALID_ARGS', 'Mobilebox serves Android phones here; leave --platform out or pass android.');
  }
  return 'android';
}

/** `agent-device connect mobilebox`: the profile a lease reads. No phone starts until a device command. */
export function resolveMobileboxConnection({ flags, env }: { flags: CliFlags; env: Env }) {
  rejectRefusedProviderProfileFields(flags, MOBILEBOX_PROFILE_FIELDS);
  if (!env[MOBILEBOX_CREDENTIAL_VARIABLE]?.trim()) {
    throw new AppError('INVALID_ARGS', `connect ${MOBILEBOX_PROVIDER} needs ${MOBILEBOX_CREDENTIAL_VARIABLE}, a Mobilebox API key.`, {
      hint: 'Create one at https://mobilebox.dev/dashboard.',
    });
  }
  mobileboxAndroidVersion(flags);
  return {
    profile: {
      leaseProvider: MOBILEBOX_PROVIDER,
      platform: requireAndroid(flags),
      ...(flags.providerOsVersion ? { providerOsVersion: flags.providerOsVersion } : {}),
    } as const,
  };
}

/** Checks the key by reading the account; starts no phone. */
export async function verifyMobileboxConnection({
  flags,
  env,
  clientVersion,
  fetch,
}: {
  flags: CliFlags;
  env: Env;
  clientVersion: string;
  fetch?: typeof globalThis.fetch;
}): Promise<ProviderConnectionVerification> {
  const android = mobileboxAndroidVersion(flags);
  const client = new MobileboxClient({
    apiKey: env[MOBILEBOX_CREDENTIAL_VARIABLE],
    baseUrl: env[MOBILEBOX_BASE_URL_VARIABLE],
    clientVersion,
    fetch,
  });
  await client.account();
  return {
    provider: MOBILEBOX_PROVIDER,
    service: 'Mobilebox',
    verificationMessage: 'Mobilebox key verified.',
    device: { status: 'deferred', name: `Mobilebox cloud Android ${android} phone`, platform: 'android' },
    app: { status: 'missing', message: 'Install an APK once the phone starts: agent-device install <app> <path-to.apk>.' },
  };
}
