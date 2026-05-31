// VPN/proxy checks have been removed from enforcement. This function now
// returns a non-blocking result so callers can optionally show an advisory
// message but not block registration or other flows.
export interface IPCheckResult {
  blocked: false;
  reason?: string;
  ip?: string;
  country?: string;
}

export async function checkVPNOrProxy(): Promise<IPCheckResult> {
  return { blocked: false };
}
