// ============================================================
// Frontend API client — injects X-Dialer-Key on every request
// ============================================================

let _apiKey: string | null = null;

export function setApiKey(key: string) {
  _apiKey = key;
}

export function getApiKey(): string | null {
  return _apiKey;
}

export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  if (_apiKey) {
    headers.set("X-Dialer-Key", _apiKey);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}
