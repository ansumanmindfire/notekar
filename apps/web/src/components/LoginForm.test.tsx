import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginForm } from './LoginForm';
import { useAuthStore } from '../stores/authStore';
import { ApiRequestError } from '../lib/apiClient';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

const INITIAL_STATE = {
  accessToken: null,
  user: null,
  status: 'idle' as const,
};

function fillAndSubmit(email: string, password: string): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /log in/i }));
}

describe('LoginForm', () => {
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

  it('navigates to /notes on a successful login', async () => {
    const loginSpy = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ login: loginSpy });

    render(<LoginForm />);

    fillAndSubmit('user@example.com', 'correct-password');

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/notes' });
    });
    expect(loginSpy).toHaveBeenCalledWith('user@example.com', 'correct-password');
  });

  it('shows the identical generic error for a wrong password and an unknown email (anti-enumeration)', async () => {
    const wrongPasswordLogin = vi
      .fn()
      .mockRejectedValue(new ApiRequestError({ code: 'AUTH_INVALID_CREDENTIALS', message: 'nope' }));
    useAuthStore.setState({ login: wrongPasswordLogin });

    const { unmount } = render(<LoginForm />);
    fillAndSubmit('known@example.com', 'wrong-password');

    const wrongPasswordAlert = await screen.findByRole('alert');
    const wrongPasswordText = wrongPasswordAlert.textContent;
    expect(wrongPasswordText).toBe('Incorrect email or password.');
    unmount();

    const unknownEmailLogin = vi
      .fn()
      .mockRejectedValue(new ApiRequestError({ code: 'AUTH_INVALID_CREDENTIALS', message: 'nope' }));
    useAuthStore.setState({ login: unknownEmailLogin });

    render(<LoginForm />);
    fillAndSubmit('unknown@example.com', 'some-password');

    const unknownEmailAlert = await screen.findByRole('alert');
    expect(unknownEmailAlert.textContent).toBe(wrongPasswordText);
  });

  it('shows the rate-limit copy when login is rejected with RATE_LIMITED', async () => {
    const loginSpy = vi
      .fn()
      .mockRejectedValue(new ApiRequestError({ code: 'RATE_LIMITED', message: 'slow down' }));
    useAuthStore.setState({ login: loginSpy });

    render(<LoginForm />);
    fillAndSubmit('user@example.com', 'password123');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Too many attempts. Please wait a moment and try again.');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('disables the submit button and shows loading text while login is in flight, then re-enables it', async () => {
    let resolveLogin!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveLogin = resolve;
    });
    const loginSpy = vi.fn().mockReturnValue(pending);
    useAuthStore.setState({ login: loginSpy });

    render(<LoginForm />);
    fillAndSubmit('user@example.com', 'password123');

    const button = await screen.findByRole('button', { name: /logging in/i });
    expect(button).toBeDisabled();

    resolveLogin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^log in$/i })).not.toBeDisabled();
    });
  });

  it('blocks submission and shows an inline field error for an invalid email, without calling login', async () => {
    const loginSpy = vi.fn();
    useAuthStore.setState({ login: loginSpy });

    render(<LoginForm />);
    fillAndSubmit('not-an-email', 'password123');

    expect(await screen.findByText('Invalid email address')).toBeInTheDocument();
    expect(loginSpy).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
