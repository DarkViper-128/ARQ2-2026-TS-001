import { useAuth } from '../context/AuthContext';

const GATEWAY_BASE = '/v1';

function getHeaders(token: string | null) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function apiRequest(
  path: string,
  options: RequestInit = {},
  token: string | null = null,
) {
  const response = await fetch(`${GATEWAY_BASE}${path}`, {
    ...options,
    headers: { ...getHeaders(token), ...options.headers },
  });

  if (response.status === 401) {
    throw new Error('UNAUTHENTICATED');
  }
  if (response.status === 403) {
    throw new Error('FORBIDDEN');
  }
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.detail || `Error ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  get: (path: string, token: string | null = null) =>
    apiRequest(path, { method: 'GET' }, token),

  post: (path: string, body: unknown, token: string | null = null) =>
    apiRequest(path, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),

  delete: (path: string, token: string | null = null) =>
    apiRequest(path, { method: 'DELETE' }, token),

  postWithHeaders: (
    path: string,
    body: unknown,
    extraHeaders: Record<string, string>,
    token: string | null = null,
  ) =>
    apiRequest(path, {
      method: 'POST',
      headers: { ...extraHeaders },
      body: JSON.stringify(body),
    }, token),
};

export { useAuth };
