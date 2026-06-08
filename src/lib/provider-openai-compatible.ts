export type OpenAICompatibleBaseUrlResult =
  | { ok: true; value: string; normalized: boolean }
  | { ok: false; code: 'OPENAI_COMPATIBLE_BASE_URL_REQUIRED' | 'OPENAI_COMPATIBLE_BASE_URL_INVALID' | 'OPENAI_COMPATIBLE_V1_REQUIRED'; message: string };

/**
 * Normalize an OpenAI-compatible base URL to the SDK/discovery contract:
 * a clean HTTP(S) URL ending in `/v1`.
 *
 * Plain hosts are accepted and normalized (`https://api.example.com` →
 * `https://api.example.com/v1`). Provider-specific paths are accepted only
 * when the path already ends in `/v1` (`/compatible-mode/v1`). This prevents
 * chat requests and model discovery from guessing different endpoint shapes.
 */
export function normalizeOpenAICompatibleBaseUrl(raw: string | undefined | null): OpenAICompatibleBaseUrlResult {
  const input = (raw ?? '').trim();
  if (!input) {
    return {
      ok: false,
      code: 'OPENAI_COMPATIBLE_BASE_URL_REQUIRED',
      message: 'OpenAI-compatible providers must specify a base URL',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return {
      ok: false,
      code: 'OPENAI_COMPATIBLE_BASE_URL_INVALID',
      message: 'OpenAI-compatible base URL must be a valid http(s) URL',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      code: 'OPENAI_COMPATIBLE_BASE_URL_INVALID',
      message: 'OpenAI-compatible base URL must use http or https',
    };
  }

  if (parsed.search || parsed.hash) {
    return {
      ok: false,
      code: 'OPENAI_COMPATIBLE_BASE_URL_INVALID',
      message: 'OpenAI-compatible base URL must not include query string or hash',
    };
  }

  const hadTrailingSlash = /\/+$/.test(parsed.pathname);
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');

  const path = parsed.pathname;
  if (!path || path === '/') {
    parsed.pathname = '/v1';
    return {
      ok: true,
      value: parsed.toString().replace(/\/+$/, ''),
      normalized: true,
    };
  }

  if (path.endsWith('/v1')) {
    return {
      ok: true,
      value: parsed.toString().replace(/\/+$/, ''),
      normalized: hadTrailingSlash,
    };
  }

  return {
    ok: false,
    code: 'OPENAI_COMPATIBLE_V1_REQUIRED',
    message: 'OpenAI-compatible base URL with a custom path must end in /v1',
  };
}

export function validateOpenAICompatibleBaseUrl(raw: string | undefined | null): OpenAICompatibleBaseUrlResult {
  return normalizeOpenAICompatibleBaseUrl(raw);
}
