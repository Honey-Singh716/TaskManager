
const RAW_API_URL = (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");
// If VITE_API_URL is configured, use it.
// In dev mode, default to http://localhost:3000 if not specified.
// In prod mode, default to "" (relative to current domain) if not specified.
const API_URL = RAW_API_URL || (import.meta.env.DEV ? "http://localhost:3000" : "");

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export async function apiRequest(
  path: string,
  options: RequestInit = {},
  token?: string
) {
  const headers = new Headers(options.headers);

  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_URL}${cleanPath}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error || `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, data);
  }

  return data;
}
