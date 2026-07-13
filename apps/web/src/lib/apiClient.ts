import type { ApiError } from 'shared';
import { useAuthStore } from '../stores/authStore';

const BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

// These endpoints must never trigger the 401 refresh-retry loop: /auth/refresh is the
// refresh call itself (a 401 here means the refresh token is invalid, not that we should
// refresh again), and the others are pre-session calls with no accessToken to refresh.
const AUTH_ENDPOINTS_EXCLUDED_FROM_RETRY = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
];

export class ApiRequestError extends Error {
  code: string;
  fields: string[] | undefined;

  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = 'ApiRequestError';
    this.code = apiError.code;
    this.fields = apiError.fields;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function parseErrorResponse(response: Response): Promise<ApiRequestError> {
  const data = (await response.json().catch(() => null)) as ApiError | null;
  if (data && typeof data.code === 'string' && typeof data.message === 'string') {
    return new ApiRequestError(data);
  }
  return new ApiRequestError({ code: 'UNKNOWN_ERROR', message: response.statusText });
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const accessToken = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  return fetch(`${BASE_URL}${path}`, init);
}

async function refreshAccessToken(): Promise<void> {
  const response = await rawRequest('/auth/refresh', { method: 'POST' });
  if (!response.ok) {
    useAuthStore.getState().clearSession();
    throw await parseErrorResponse(response);
  }
  const data = (await response.json()) as { accessToken: string };
  useAuthStore.setState({ accessToken: data.accessToken, status: 'authenticated' });
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawRequest(path, options);

  if (response.status === 401 && !AUTH_ENDPOINTS_EXCLUDED_FROM_RETRY.includes(path)) {
    await refreshAccessToken();
    response = await rawRequest(path, options);
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
