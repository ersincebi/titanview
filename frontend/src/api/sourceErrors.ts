export const UNOFFICIAL_DISABLED_CODE = 'unofficial_sources_disabled';

export class UnofficialSourcesDisabledError extends Error {
  readonly code = UNOFFICIAL_DISABLED_CODE;
  constructor(message?: string) {
    super(message || 'Unofficial data sources are disabled — enable them in Settings → Data sources.');
    this.name = 'UnofficialSourcesDisabledError';
  }
}

export function isUnofficialDisabledError(e: unknown): boolean {
  if (!e) return false;
  if (e instanceof UnofficialSourcesDisabledError) return true;
  if (typeof e === 'object' && 'code' in e && (e as { code?: unknown }).code === UNOFFICIAL_DISABLED_CODE) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes(UNOFFICIAL_DISABLED_CODE) || msg.includes('unofficial data sources');
}
