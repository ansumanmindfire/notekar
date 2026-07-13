import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { apiRequest, ApiRequestError } from '../lib/apiClient';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

const mockedApiRequest = vi.mocked(apiRequest);

function fillAndSubmitRequestStep(email: string): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));
}

async function advanceToVerifyStep(email: string, infoMessage: string): Promise<void> {
  mockedApiRequest.mockResolvedValueOnce({ message: infoMessage });
  fillAndSubmitRequestStep(email);
  await screen.findByRole('status');
}

function fillAndSubmitVerifyStep(otp: string, newPassword: string, confirmNewPassword: string): void {
  fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: otp } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: newPassword } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: confirmNewPassword },
  });
  fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
}

describe('ForgotPasswordForm', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    navigateMock.mockClear();
  });

  it.each([
    ['registered@example.com', 'If that email is registered, a code has been sent.'],
    ['unregistered@example.com', 'If that email is registered, a code has been sent.'],
  ])(
    'calls apiRequest with /auth/forgot-password for %s and advances to the verify step showing the info message',
    async (email, infoMessage) => {
      mockedApiRequest.mockResolvedValueOnce({ message: infoMessage });

      render(<ForgotPasswordForm />);
      fillAndSubmitRequestStep(email);

      await waitFor(() => {
        expect(mockedApiRequest).toHaveBeenCalledWith('/auth/forgot-password', {
          method: 'POST',
          body: { email },
        });
      });

      const status = await screen.findByRole('status');
      expect(status.textContent).toBe(infoMessage);
      expect(screen.getByRole('heading', { name: /enter reset code/i })).toBeInTheDocument();
    },
  );

  it('blocks submission on an invalid email without calling apiRequest, showing an inline field error', async () => {
    mockedApiRequest.mockClear();

    render(<ForgotPasswordForm />);
    fillAndSubmitRequestStep('not-an-email');

    expect(await screen.findByText('Invalid email address')).toBeInTheDocument();
    expect(mockedApiRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /forgot password/i })).toBeInTheDocument();
  });

  it('shows the rate-limited copy and stays on the request step when apiRequest rejects with RATE_LIMITED', async () => {
    mockedApiRequest.mockRejectedValueOnce(
      new ApiRequestError({ code: 'RATE_LIMITED', message: 'too many requests' }),
    );

    render(<ForgotPasswordForm />);
    fillAndSubmitRequestStep('user@example.com');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Too many attempts. Please wait a moment and try again.');
    expect(screen.queryByRole('heading', { name: /enter reset code/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /forgot password/i })).toBeInTheDocument();
  });

  it('submits the reset-password request with email/otp/newPassword (no confirm field) and navigates to /login on success', async () => {
    render(<ForgotPasswordForm />);
    await advanceToVerifyStep('user@example.com', 'Check your email for a code.');

    mockedApiRequest.mockResolvedValueOnce(undefined);
    fillAndSubmitVerifyStep('123456', 'Correct-Password1', 'Correct-Password1');

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith('/auth/reset-password', {
        method: 'POST',
        body: {
          email: 'user@example.com',
          otp: '123456',
          newPassword: 'Correct-Password1',
        },
      });
    });

    const [, options] = mockedApiRequest.mock.calls[1]!;
    expect((options as { body: Record<string, unknown> }).body).not.toHaveProperty('confirmNewPassword');

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/login',
        search: { notice: 'password-reset' },
      });
    });
  });

  it('shows the exact generic OTP-invalid copy when apiRequest rejects with AUTH_OTP_INVALID', async () => {
    render(<ForgotPasswordForm />);
    await advanceToVerifyStep('user@example.com', 'Check your email for a code.');

    mockedApiRequest.mockRejectedValueOnce(
      new ApiRequestError({ code: 'AUTH_OTP_INVALID', message: 'otp invalid or expired' }),
    );
    fillAndSubmitVerifyStep('000000', 'Correct-Password1', 'Correct-Password1');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That code is invalid or has expired.');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('blocks submission on a client-side new-password/confirm mismatch without calling apiRequest for reset-password', async () => {
    render(<ForgotPasswordForm />);
    await advanceToVerifyStep('user@example.com', 'Check your email for a code.');

    mockedApiRequest.mockClear();
    fillAndSubmitVerifyStep('123456', 'Correct-Password1', 'Different-Password1');

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(mockedApiRequest).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('blocks submission on an invalid OTP format and a weak new password without calling apiRequest for reset-password', async () => {
    render(<ForgotPasswordForm />);
    await advanceToVerifyStep('user@example.com', 'Check your email for a code.');

    mockedApiRequest.mockClear();
    fillAndSubmitVerifyStep('12', 'short', 'short');

    expect(await screen.findByText('OTP must be a 6-digit code')).toBeInTheDocument();
    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(mockedApiRequest).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('disables the request-step button and shows loading text while the forgot-password request is in flight', async () => {
    let resolveRequest!: (value: { message: string }) => void;
    const pending = new Promise<{ message: string }>((resolve) => {
      resolveRequest = resolve;
    });
    mockedApiRequest.mockReturnValueOnce(pending);

    render(<ForgotPasswordForm />);
    fillAndSubmitRequestStep('user@example.com');

    const button = await screen.findByRole('button', { name: /sending/i });
    expect(button).toBeDisabled();

    resolveRequest({ message: 'Check your email for a code.' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /enter reset code/i })).toBeInTheDocument();
    });
  });

  it('disables the verify-step button and shows loading text while the reset-password request is in flight', async () => {
    render(<ForgotPasswordForm />);
    await advanceToVerifyStep('user@example.com', 'Check your email for a code.');

    let resolveReset!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveReset = resolve;
    });
    mockedApiRequest.mockReturnValueOnce(pending);

    fillAndSubmitVerifyStep('123456', 'Correct-Password1', 'Correct-Password1');

    const button = await screen.findByRole('button', { name: /resetting/i });
    expect(button).toBeDisabled();

    resolveReset();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^reset password$/i })).not.toBeDisabled();
    });
  });
});
