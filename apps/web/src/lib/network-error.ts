/**
 * ONE list of the messages that mean "the request never reached the server"
 * (offline, refused connection, DNS failure) — as opposed to the server answering
 * with an error. Read by `useAuth` (an offline failure must not sign the cached user
 * out) and by the SWR onError policy (an offline failure must not raise a
 * "Load Error" toast). They kept separate lists until 2026-10-21, and ECONNREFUSED
 * was "offline" to one and a visible error to the other (D-L2).
 *
 * Message markers only. Each caller keeps its own extra rules: SWR also treats any
 * TypeError as offline for the toast, but the keep-session decision deliberately
 * does not — that set is security-relevant.
 */
const NETWORK_ERROR_MARKERS = [
  'failed to fetch',        // Chrome / WebView fetch
  'networkerror',           // Firefox
  'network request failed', // React Native / some WebViews
  'load failed',            // Safari
  'failed to connect',      // CapacitorHttp (Android)
  'unable to resolve host', // Android DNS
  'econnrefused',           // connection refused
] as const;

/** True when `message` says the request never reached the server. Case-insensitive. */
export function isNetworkErrorMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return NETWORK_ERROR_MARKERS.some((m) => msg.includes(m));
}

/**
 * True when `err` is a request that never reached the server. An error with a
 * numeric HTTP `status` came FROM the server (api-client stamps it on every
 * answer), so it is never a network failure — even when the server's own message
 * relays a failed connection of its own ("LDAP bind failed: connect ECONNREFUSED").
 * A fetch rejection carries no status.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (!err) return false;
  if (typeof (err as { status?: unknown }).status === 'number') return false;
  return isNetworkErrorMessage(String((err as { message?: unknown }).message ?? err));
}
