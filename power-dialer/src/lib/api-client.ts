// ============================================================
// Frontend API client — injects X-Dialer-Key on every request
// ============================================================
// Auth key is persisted to localStorage so sessions survive page
// reloads, iframe navigation (Chrome extension side panel tabs),
// and browser refreshes without logging the rep out.

let _apiKey: string | null = null;

// Restore from localStorage on module load (client-side only)
if (typeof window !== "undefined") {
  _apiKey = localStorage.getItem("tcg_dialer_api_key");
}

export function setApiKey(key: string) {
  _apiKey = key;
  if (typeof window !== "undefined") {
    localStorage.setItem("tcg_dialer_api_key", key);
  }
}

export function clearApiKey() {
  _apiKey = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem("tcg_dialer_api_key");
  }
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
