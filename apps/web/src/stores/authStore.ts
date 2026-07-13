import { create } from 'zustand';
import type { AuthUser, LoginResponse, RegisterResponse, RefreshResponse } from 'shared';
import { apiRequest } from '../lib/apiClient';

export type AuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'unauthenticated';

export type AuthSession = LoginResponse;

export interface AuthApi {
  login(email: string, password: string): Promise<LoginResponse>;
  register(email: string, password: string): Promise<RegisterResponse>;
  refresh(): Promise<RefreshResponse>;
  logout(): Promise<void>;
}

const realAuthApi: AuthApi = {
  login: (email, password) =>
    apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } }),
  register: (email, password) =>
    apiRequest<RegisterResponse>('/auth/register', { method: 'POST', body: { email, password } }),
  refresh: () => apiRequest<RefreshResponse>('/auth/refresh', { method: 'POST' }),
  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
};

let authApi: AuthApi = realAuthApi;

export function setAuthApi(api: AuthApi): void {
  authApi = api;
}

export interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  setSession: (session: LoginResponse) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  status: 'idle',

  setSession: ({ accessToken, user }) => {
    set({ accessToken, user, status: 'authenticated' });
  },

  clearSession: () => {
    set({ accessToken: null, user: null, status: 'unauthenticated' });
  },

  login: async (email, password) => {
    set({ status: 'authenticating' });
    try {
      const session = await authApi.login(email, password);
      get().setSession(session);
    } catch (error) {
      set({ status: 'unauthenticated' });
      throw error;
    }
  },

  register: async (email, password) => {
    await authApi.register(email, password);
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      get().clearSession();
    }
  },

  bootstrap: async () => {
    try {
      const { accessToken } = await authApi.refresh();
      // /auth/refresh returns only an accessToken (no user profile endpoint exists
      // in the AB-1002 contract), so `user` stays null until a fresh login/register.
      set({ accessToken, user: null, status: 'authenticated' });
    } catch {
      get().clearSession();
    }
  },
}));
