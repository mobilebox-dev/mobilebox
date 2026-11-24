import type { AgentDevicePlugin, ProviderPluginHost } from 'agent-device/plugins';

type Connection = NonNullable<AgentDevicePlugin['connection']>;
import { MOBILEBOX_BASE_URL_VARIABLE, MOBILEBOX_CREDENTIAL_VARIABLE } from './connection.ts';
import { MOBILEBOX_PROVIDER } from './device.ts';

export type MobileboxPluginOptions = {
  /** Used instead of `MOBILEBOX_API_KEY` when set. */
  apiKey?: string;
  /** Mobilebox's address; https://mobilebox.dev unless `MOBILEBOX_API_URL` or this says otherwise. */
  baseUrl?: string;
};

const loadConnection = async () => await import('./connection.ts');

/**
 * Mobilebox cloud Android phones as an agent-device provider: one phone per lease, created on the
 * lease's first device command and deleted when it is released, billed per second by Mobilebox
 * ($0.01 a minute). The key comes from `options.apiKey`, else `MOBILEBOX_API_KEY`.
 */
function mobilebox(options: MobileboxPluginOptions = {}): AgentDevicePlugin {
  const withKey = (host: ProviderPluginHost): ProviderPluginHost =>
    options.apiKey || options.baseUrl
      ? {
          ...host,
          env: {
            ...host.env,
            ...(options.apiKey ? { [MOBILEBOX_CREDENTIAL_VARIABLE]: options.apiKey } : {}),
            ...(options.baseUrl ? { [MOBILEBOX_BASE_URL_VARIABLE]: options.baseUrl } : {}),
          },
        }
      : host;
  return {
    apiVersion: 2,
    provider: MOBILEBOX_PROVIDER,
    credentials: {
      variables: [...(options.apiKey ? [] : [MOBILEBOX_CREDENTIAL_VARIABLE]), ...(options.baseUrl ? [] : [MOBILEBOX_BASE_URL_VARIABLE])],
    },
    connection: {
      capabilities: {
        leaseKind: 'direct-device-provider',
        requiresAppAttachment: false,
        requiresRemoteDaemon: false,
        supportsArtifacts: false,
        // A phone starts with no app of yours: `install` puts it there, so `open <package>` never selects an upload.
        supportsDeferredAppSelection: false,
        supportsDirectPortReverse: false,
        usesCloudWebDriverLease: false,
        holdsCloudDevice: true,
      },
      resolve: async (context: Parameters<Connection['resolve']>[0]) => (await loadConnection()).resolveMobileboxConnection({ flags: context.flags, env: withKey(context.host).env }),
      verify: async (context: Parameters<Connection['verify']>[0]) =>
        await (await loadConnection()).verifyMobileboxConnection({ flags: context.flags, env: withKey(context.host).env, clientVersion: context.host.clientVersion }),
    },
    // No network and no phone here: a lease creates the phone on its first device command.
    setup: async (host: ProviderPluginHost) => {
      const env = withKey(host).env;
      const { createMobileboxRuntime } = await import('./runtime.ts');
      return createMobileboxRuntime({
        apiKey: env[MOBILEBOX_CREDENTIAL_VARIABLE]?.trim() || undefined,
        baseUrl: env[MOBILEBOX_BASE_URL_VARIABLE],
        clientVersion: host.clientVersion,
      });
    },
  };
}

export { mobilebox as default };
