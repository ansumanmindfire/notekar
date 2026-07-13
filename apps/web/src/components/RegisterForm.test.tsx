import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RegisterForm } from './RegisterForm';
import { useAuthStore } from '../stores/authStore';
import { ApiRequestError } from '../lib/apiClient';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const INITIAL_STATE = {
  accessToken: null,
  user: null,
  status: 'idle' as const,
};

function fillAndSubmit(email: string, password: string, confirmPassword: string): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirmPassword } });
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
}

describe('RegisterForm', () => {
  beforeEach(() => {
    navigateMock.mockClear();
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

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('registers, chains a login with the same credentials, and navigates to /notes on success', async () => {
    const registerSpy = vi.fn().mockResolvedValue(undefined);
    const loginSpy = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ register: registerSpy, login: loginSpy });

    render(<RegisterForm />);
    fillAndSubmit('newuser@example.com', 'Correct-Password1', 'Correct-Password1');

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/notes' });
    });
    expect(registerSpy).toHaveBeenCalledWith('newuser@example.com', 'Correct-Password1');
    expect(loginSpy).toHaveBeenCalledWith('newuser@example.com', 'Correct-Password1');
  });

  it('blocks submission on a client-side confirm-password mismatch without calling register or login', async () => {
    const registerSpy = vi.fn();
    const loginSpy = vi.fn();
    useAuthStore.setState({ register: registerSpy, login: loginSpy });

    render(<RegisterForm />);
    fillAndSubmit('newuser@example.com', 'Correct-Password1', 'different-password');

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(registerSpy).not.toHaveBeenCalled();
    expect(loginSpy).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('shows the duplicate-email copy when register rejects with USER_EXISTS, and never calls login', async () => {
    const registerSpy = vi
      .fn()
      .mockRejectedValue(new ApiRequestError({ code: 'USER_EXISTS', message: 'already registered' }));
    const loginSpy = vi.fn();
    useAuthStore.setState({ register: registerSpy, login: loginSpy });

    render(<RegisterForm />);
    fillAndSubmit('duplicate@example.com', 'Correct-Password1', 'Correct-Password1');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('An account with this email already exists.');
    expect(loginSpy).toHaveBeenCalledTimes(0);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('navigates to /login with an account-created notice (no raw error) when the chained login fails', async () => {
    const registerSpy = vi.fn().mockResolvedValue(undefined);
    const loginSpy = vi
      .fn()
      .mockRejectedValue(new ApiRequestError({ code: 'AUTH_INVALID_CREDENTIALS', message: 'nope' }));
    useAuthStore.setState({ register: registerSpy, login: loginSpy });

    render(<RegisterForm />);
    fillAndSubmit('newuser@example.com', 'Correct-Password1', 'Correct-Password1');

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/login', search: { notice: 'account-created' } });
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the submit button and shows loading text while the register+login chain is in flight, then re-enables it', async () => {
    let resolveRegister!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveRegister = resolve;
    });
    const registerSpy = vi.fn().mockReturnValue(pending);
    const loginSpy = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ register: registerSpy, login: loginSpy });

    render(<RegisterForm />);
    fillAndSubmit('newuser@example.com', 'Correct-Password1', 'Correct-Password1');

    const button = await screen.findByRole('button', { name: /creating account/i });
    expect(button).toBeDisabled();

    resolveRegister();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^create account$/i })).not.toBeDisabled();
    });
  });
});
