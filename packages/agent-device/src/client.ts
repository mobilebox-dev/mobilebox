import { AppError } from '@agent-device/kernel/errors';

/** A Mobilebox phone as the REST API returns it (the fields this plugin reads). */
export type MobileboxPhone = Readonly<{ id: string; name: string; status: string; android?: string }>;
/** One element of a phone's screen: what `GET /v1/phones/{id}/observe` lists. */
export type MobileboxElement = Readonly<{
  ref: number;
  type: string;
  text: string | null;
  desc: string | null;
  id: string | null;
  summary: string | null;
  bounds: [number, number, number, number];
  center: [number, number];
  state: string[];
}>;
export type MobileboxScreen = Readonly<{ app: string | null; elements: MobileboxElement[] }>;
type ActionResult = Readonly<{ type: string; ok: boolean; error?: { code: string; message: string } }>;

export const MOBILEBOX_DEFAULT_URL = 'https://mobilebox.dev';

export type MobileboxClientOptions = Readonly<{
  apiKey?: string;
  baseUrl?: string;
  clientVersion: string;
  fetch?: typeof fetch;
}>;

/** Mobilebox's REST API (https://mobilebox.dev/openapi.json), the calls a lease needs. */
export class MobileboxClient {
  private readonly options: MobileboxClientOptions;
  private readonly base: string;
  private readonly fetcher: typeof fetch;

  constructor(options: MobileboxClientOptions) {
    this.options = options;
    this.base = (options.baseUrl?.trim() || MOBILEBOX_DEFAULT_URL).replace(/\/+$/, '');
    this.fetcher = options.fetch ?? fetch;
  }

  async request(
    method: string,
    path: string,
    init: { body?: unknown; bytes?: Uint8Array; headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<Response> {
    const key = this.options.apiKey?.trim();
    if (!key) {
      throw new AppError('INVALID_ARGS', 'Mobilebox needs MOBILEBOX_API_KEY, a Mobilebox API key.', {
        hint: 'Create one at https://mobilebox.dev/dashboard (keys start with mbx_).',
      });
    }
    const timeout = AbortSignal.timeout(init.timeoutMs ?? 120_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const res = await this.fetcher(`${this.base}${path}`, {
      method,
      signal,
      headers: {
        authorization: `Bearer ${key}`,
        'user-agent': `agent-device/${this.options.clientVersion} mobilebox-plugin`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.bytes ? { 'content-type': 'application/vnd.android.package-archive' } : {}),
        ...init.headers,
      },
      body: (init.bytes as BodyInit | undefined) ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; next?: string } } | null;
      throw new AppError(
        res.status === 401 || res.status === 403 ? 'UNAUTHORIZED' : 'COMMAND_FAILED',
        `Mobilebox ${method} ${path.split('?')[0]}: ${body?.error?.message ?? res.statusText}`,
        { status: res.status, code: body?.error?.code, ...(body?.error?.next ? { hint: body.error.next } : {}) },
      );
    }
    return res;
  }

  private async json<T>(method: string, path: string, init?: Parameters<MobileboxClient['request']>[2]): Promise<T> {
    return (await (await this.request(method, path, init)).json()) as T;
  }

  /** Creates a phone and waits until it is ready; the idempotency key makes a retried create reach the same phone. */
  async createPhone(name: string, idempotencyKey: string, options: { android?: string }, signal?: AbortSignal): Promise<MobileboxPhone> {
    return await this.json('POST', '/v1/phones?wait=ready', {
      body: { name, ...(options.android ? { android: options.android } : {}) },
      headers: { 'idempotency-key': idempotencyKey },
      signal,
      timeoutMs: 300_000,
    });
  }

  async readPhone(id: string, signal?: AbortSignal): Promise<MobileboxPhone> {
    return await this.json('GET', `/v1/phones/${id}?wait=ready&timeout=55`, { signal, timeoutMs: 70_000 });
  }

  async phones(): Promise<MobileboxPhone[]> {
    return (await this.json<{ data: MobileboxPhone[] }>('GET', '/v1/phones')).data;
  }

  async deletePhone(id: string): Promise<void> {
    await this.request('DELETE', `/v1/phones/${id}`).catch((error: unknown): void => {
      if (error instanceof AppError && error.details?.status === 404) return; // already gone
      throw error;
    });
  }

  async account(): Promise<Record<string, unknown>> {
    return await this.json('GET', '/v1/account', { timeoutMs: 15_000 });
  }

  /** Runs actions in order; the first one that fails ends the batch and is thrown. */
  async act(id: string, actions: Record<string, unknown>[], signal?: AbortSignal): Promise<void> {
    const res = await this.json<{ results: ActionResult[] }>('POST', `/v1/phones/${id}/actions`, { body: { actions }, signal });
    const failed = res.results.find((r) => !r.ok);
    if (failed) {
      throw new AppError('COMMAND_FAILED', `Mobilebox could not ${failed.type}: ${failed.error?.message ?? 'no answer'}`, {
        code: failed.error?.code,
      });
    }
  }

  async observe(id: string, signal?: AbortSignal): Promise<MobileboxScreen> {
    return await this.json('GET', `/v1/phones/${id}/observe`, { signal });
  }

  async screenshot(id: string, signal?: AbortSignal): Promise<Buffer> {
    return Buffer.from(await (await this.request('GET', `/v1/phones/${id}/screenshot`, { signal })).arrayBuffer());
  }

  async install(id: string, apk: Uint8Array, signal?: AbortSignal): Promise<{ package: string; version_name?: string | null }> {
    return await this.json('POST', `/v1/phones/${id}/apps?grant_permissions=true`, { bytes: apk, signal, timeoutMs: 600_000 });
  }

  async uninstall(id: string, pkg: string, signal?: AbortSignal): Promise<void> {
    await this.request('DELETE', `/v1/phones/${id}/apps/${encodeURIComponent(pkg)}`, { signal });
  }
}
