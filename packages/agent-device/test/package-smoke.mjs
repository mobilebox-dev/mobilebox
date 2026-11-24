// Callstack's package check (scripts/check-provider-plugin.mjs): connects through the packed plugin to a
// stand-in Mobilebox that answers the one call `connect` makes, GET /v1/account.
export const provider = 'mobilebox';
export const args = ['--platform', 'android'];
export function environment(endpoint) {
  return { MOBILEBOX_API_KEY: 'mbx_test', MOBILEBOX_API_URL: endpoint };
}
export function respond(url, rejectCredentials) {
  if (!url.startsWith('/v1/account'))
    return { status: 404, body: { error: { code: 'not_found', message: 'No route.' } } };
  return rejectCredentials
    ? { status: 401, body: { error: { code: 'unauthorized', message: 'Invalid API key.' } } }
    : { body: { project: 'prj_test', balance_usd: '5.000000' } };
}
