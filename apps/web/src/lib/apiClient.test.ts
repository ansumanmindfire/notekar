import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiRequestError } from './apiClient';
import { useAuthStore } from '../stores/authStore';

const INITIAL_AUTH_STATE = {
  accessToken: null,
  user: null,
  status: 'idle' as const,
};

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

describe('apiClient', () => {
  beforeEach(() => {
    useAuthStore.setState(
      {
        ...INITIAL_AUTH_STATE,
        setSession: useAuthStore.getState().setSession,
        clearSession: useAuthStore.getState().clearSession,
        login: useAuthStore.getState().login,
        register: useAuthStore.getState().register,
        logout: useAuthStore.getState().logout,
        bootstrap: useAuthStore.getState().bootstrap,
      },
      true,
    );

    vi.stubGlobal('fetch', vi.fn());
  });

  describe('successful requests', () => {
    it('resolves with the parsed JSON body for a 2xx GET response and sends credentials: include', async () => {
      const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'note-1', title: 'Hello' }));

      const result = await apiRequest<{ id: string; title: string }>('/notes/note-1');

      expect(result).toEqual({ id: 'note-1', title: 'Hello' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.credentials).toBe('include');
      expect(init.method).toBe('GET');
    });

    it('resolves with the parsed JSON body for a 2xx POST response and includes Authorization header when a token is set', async () => {
      useAuthStore.setState({ accessToken: 'my-access-token' });
      const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'note-2' }, { status: 201 }));

      const result = await apiRequest<{ id: string }>('/notes', {
        method: 'POST',
        body: { title: 'New note' },
      });

      expect(result).toEqual({ id: 'note-2' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer my-access-token');
      expect(headers['Content-Type']).toBe('application/json');
      expect(init.body).toBe(JSON.stringify({ title: 'New note' }));
      expect(init.credentials).toBe('include');
    });

    it('does not include an Authorization header when no access token is set', async () => {
      const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce(jsonResponse({ items: [] }));

      await apiRequest('/notes');

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it('resolves with undefined for a 204 No Content response', async () => {
      const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce(emptyResponse(204));

      const result = await apiRequest('/notes/note-1');

      expect(result).toBeUndefined();
    });
  });

  describe('401 refresh-then-retry flow', () => {
    it('refreshes the access token and retries the original request exactly once on 401', async () => {
      useAuthStore.setState({ accessToken: 'stale-token', status: 'authenticated' });
      const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
      mockFetch
        .mockResolvedValueOnce(emptyResponse(401)) // 1: original /notes request
        .mockResolvedValueOnce(jsonResponse({ accessToken: 'new-token' })) // 2: /auth/refresh
        .mockResolvedValueOnce(jsonResponse({ items: ['note-1'] })); // 3: retried /notes request

      const result = await apiRequest<{ items: string[] }>('/notes');

      expect(result).toEqual({ items: ['note-1'] });
      expect(mockFetch).toHaveBeenCalledTimes(3);
      const [refreshUrl] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(refreshUrl).toEqual(expect.stringContaining('/auth/refresh'));
      expect(useAuthStore.getState().accessToken).toBe('new-token');
      expect(useAuthStore.getState().status).toBe('authenticated');
    });

    it('rejects and clears the session when the refresh call itself fails', async () => {
      useAuthStore.setState({ accessToken: 'stale-token', status: 'authenticated' });
      const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
      mockFetch
        .mockResolvedValueOnce(emptyResponse(401)) // 1: original /notes request
        .mockResolvedValueOnce(
          jsonResponse({ code: 'AUTH_INVALID_TOKEN', message: 'Refresh token invalid' }, { status: 401 }),
        ); // 2: /auth/refresh fails

      await expect(apiRequest('/notes')).rejects.toThrow(ApiRequestError);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
      expect(state.status).toBe('unauthenticated');
    });

    it('never re-triggers the refresh-retry loop when calling /auth/refresh directly', async () => {
      const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce(emptyResponse(401));

      await expect(apiRequest('/auth/refresh', { method: 'POST' })).rejects.toThrow(ApiRequestError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('error responses', () => {
    it('rejects with an ApiRequestError carrying code, message, and fields for a non-401 error status', async () => {
      const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          { code: 'VALIDATION_FAILED', message: 'Invalid input', fields: ['email'] },
          { status: 400 },
        ),
      );

      const error = await apiRequest('/auth/register', { method: 'POST', body: {} }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiRequestError);
      const apiError = error as ApiRequestError;
      expect(apiError.code).toBe('VALIDATION_FAILED');
      expect(apiError.message).toBe('Invalid input');
      expect(apiError.fields).toEqual(['email']);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to an UNKNOWN_ERROR code when the error body is not valid JSON', async () => {
      const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
      const malformedResponse = new Response('not json', {
        status: 500,
        statusText: 'Internal Server Error',
      });
      mockFetch.mockResolvedValueOnce(malformedResponse);

      const error = await apiRequest('/notes').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code).toBe('UNKNOWN_ERROR');
    });
  });
});
