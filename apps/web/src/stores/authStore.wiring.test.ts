import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './authStore';

// This suite intentionally does NOT call `setAuthApi(...)`. It exercises the REAL
// default `authApi` wiring (task AB-1010/2.3: authStore actions call through
// `apiClient.ts` against the real endpoints) by mocking the global `fetch` directly,
// the same way `apiClient.test.ts` does. `apps/web/vitest.config.ts` sets
// `isolate: false` (to fix worker timeouts), which shares the module registry across
// test files in a worker - so `authStore.test.ts`'s `setAuthApi(mockApi)` calls must
// restore the real `authApi` in their own `afterEach`, or this suite would silently
// exercise a leftover mock instead of the real wiring it's meant to test.

const INITIAL_STATE = {
  accessToken: null,
  user: null,
  status: 'idle' as const,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('authStore real wiring (default authApi, no setAuthApi override)', () => {
  beforeEach(() => {
    useAuthStore.setState(
      {
        ...INITIAL_STATE,
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login() POSTs { email, password } to /auth/login and hydrates the session from the response', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ accessToken: 'tok', user: { id: '1', email: 'a@b.com' } }),
    );

    await useAuthStore.getState().login('a@b.com', 'pw');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toEqual(expect.stringContaining('/auth/login'));
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.com', password: 'pw' }));

    const state = useAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.accessToken).toBe('tok');
    expect(state.user).toEqual({ id: '1', email: 'a@b.com' });
  });

  it('register() POSTs { email, password } to /auth/register (no body-shape typo)', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: '1', email: 'a@b.com' }, 201));

    await useAuthStore.getState().register('a@b.com', 'pw');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toEqual(expect.stringContaining('/auth/register'));
    expect(init.method).toBe('POST');
    const parsedBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(parsedBody).toEqual({ email: 'a@b.com', password: 'pw' });
    expect(parsedBody).not.toHaveProperty('passowrd');
  });

  it('bootstrap() POSTs to /auth/refresh with no request body, relying solely on the httpOnly cookie', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({ accessToken: 'refreshed-token' }));

    await useAuthStore.getState().bootstrap();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toEqual(expect.stringContaining('/auth/refresh'));
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('include');

    const state = useAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.accessToken).toBe('refreshed-token');
    expect(state.user).toBeNull();
  });

  it('logout() POSTs to /auth/logout and clears the local session', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'seed-token',
      user: { id: '1', email: 'a@b.com' },
    });

    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await useAuthStore.getState().logout();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toEqual(expect.stringContaining('/auth/logout'));
    expect(init.method).toBe('POST');

    const state = useAuthStore.getState();
    expect(state.status).toBe('unauthenticated');
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
  });
});
