import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthApi, AuthSession } from './authStore';
import { setAuthApi, useAuthStore } from './authStore';

const INITIAL_STATE = {
  accessToken: null,
  user: null,
  status: 'idle' as const,
};

function makeMockAuthApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    login: vi.fn(),
    register: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

describe('authStore', () => {
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
  });

  describe('bootstrap', () => {
    it('sets status to authenticated with the refreshed accessToken and a null user when refresh resolves', async () => {
      const mockApi = makeMockAuthApi({
        refresh: vi.fn().mockResolvedValue({ accessToken: 'refreshed-token' }),
      });
      setAuthApi(mockApi);

      await useAuthStore.getState().bootstrap();

      const state = useAuthStore.getState();
      expect(state.status).toBe('authenticated');
      expect(state.accessToken).toBe('refreshed-token');
      expect(state.user).toBeNull();
      expect(mockApi.refresh).toHaveBeenCalledTimes(1);
    });

    it('sets status to unauthenticated and clears session when refresh rejects', async () => {
      const mockApi = makeMockAuthApi({
        refresh: vi.fn().mockRejectedValue(new Error('no refresh cookie')),
      });
      setAuthApi(mockApi);

      await useAuthStore.getState().bootstrap();

      const state = useAuthStore.getState();
      expect(state.status).toBe('unauthenticated');
      expect(state.accessToken).toBeNull();
      expect(state.user).toBeNull();
    });
  });

  describe('logout', () => {
    it('clears local session state when authApi.logout resolves', async () => {
      const mockApi = makeMockAuthApi({
        logout: vi.fn().mockResolvedValue(undefined),
      });
      setAuthApi(mockApi);

      // Seed an authenticated session first.
      useAuthStore.getState().setSession({
        accessToken: 'seed-token',
        user: { id: 'user-1', email: 'seed@example.com' },
      });
      expect(useAuthStore.getState().status).toBe('authenticated');

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.status).toBe('unauthenticated');
      expect(state.accessToken).toBeNull();
      expect(state.user).toBeNull();
      expect(mockApi.logout).toHaveBeenCalledTimes(1);
    });

    it('still clears local session state when authApi.logout rejects (network failure)', async () => {
      const mockApi = makeMockAuthApi({
        logout: vi.fn().mockRejectedValue(new Error('network down')),
      });
      setAuthApi(mockApi);

      useAuthStore.getState().setSession({
        accessToken: 'seed-token',
        user: { id: 'user-1', email: 'seed@example.com' },
      });

      // The store's logout() propagates the network error (the `try/finally` has no
      // `catch`), but the `finally` block must still clear local session state
      // regardless of the network outcome (AB-1002/FR-AUTH-4).
      await expect(useAuthStore.getState().logout()).rejects.toThrow('network down');

      const state = useAuthStore.getState();
      expect(state.status).toBe('unauthenticated');
      expect(state.accessToken).toBeNull();
      expect(state.user).toBeNull();
    });
  });

  describe('login', () => {
    it('synchronously flips to authenticating, then resolves to authenticated with the returned session', async () => {
      const session: AuthSession = {
        accessToken: 'login-token',
        user: { id: 'user-2', email: 'login@example.com' },
      };
      let resolveLogin!: (value: AuthSession) => void;
      const loginPromise = new Promise<AuthSession>((resolve) => {
        resolveLogin = resolve;
      });
      const mockApi = makeMockAuthApi({
        login: vi.fn().mockReturnValue(loginPromise),
      });
      setAuthApi(mockApi);

      const call = useAuthStore.getState().login('login@example.com', 'password123');

      // Status must flip synchronously, before the login promise settles.
      expect(useAuthStore.getState().status).toBe('authenticating');

      resolveLogin(session);
      await call;

      const state = useAuthStore.getState();
      expect(state.status).toBe('authenticated');
      expect(state.accessToken).toBe(session.accessToken);
      expect(state.user).toEqual(session.user);
      expect(mockApi.login).toHaveBeenCalledWith('login@example.com', 'password123');
    });
  });

  describe('persistence', () => {
    it('never writes to localStorage or sessionStorage (no Zustand persist middleware; access token stays in-memory only)', async () => {
      const localSetItemSpy = vi.spyOn(window.localStorage, 'setItem');
      const sessionSetItemSpy = vi.spyOn(window.sessionStorage, 'setItem');

      const mockApi = makeMockAuthApi({
        login: vi.fn().mockResolvedValue({
          accessToken: 'login-token',
          user: { id: 'user-3', email: 'persist-check@example.com' },
        }),
        logout: vi.fn().mockResolvedValue(undefined),
      });
      setAuthApi(mockApi);

      await useAuthStore.getState().login('persist-check@example.com', 'password123');
      await useAuthStore.getState().logout();

      // A store wrapped in Zustand's persist() middleware would write the serialized
      // state (including the access token) to storage on every state change; a plain
      // in-memory store never touches localStorage/sessionStorage at all.
      expect(localSetItemSpy).not.toHaveBeenCalled();
      expect(sessionSetItemSpy).not.toHaveBeenCalled();

      localSetItemSpy.mockRestore();
      sessionSetItemSpy.mockRestore();
    });
  });
});
