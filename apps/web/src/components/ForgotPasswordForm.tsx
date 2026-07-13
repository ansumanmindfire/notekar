import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { forgotPasswordSchema, resetPasswordSchema } from 'shared';
import type { ForgotPasswordResponse } from 'shared';
import { apiRequest, ApiRequestError } from '../lib/apiClient';
import { getErrorMessage } from '../lib/errorMessages';

type Step = 'request' | 'verify';

export function ForgotPasswordForm() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const result = forgotPasswordSchema.safeParse({ email });
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && !(field in errors)) {
          errors[field] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      // The backend always returns an identical 200 response whether or not the email is
      // registered (FR-AUTH-5 anti-enumeration) — the UI simply relays that message as-is,
      // it never branches based on which case occurred.
      const response = await apiRequest<ForgotPasswordResponse>('/auth/forgot-password', {
        method: 'POST',
        body: { email: result.data.email },
      });
      setInfoMessage(response.message);
      setStep('verify');
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.code : 'UNKNOWN_ERROR';
      setFormError(getErrorMessage(code));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (newPassword !== confirmNewPassword) {
      setFieldErrors({ confirmNewPassword: 'Passwords do not match' });
      return;
    }

    const result = resetPasswordSchema.safeParse({ email, otp, newPassword });
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && !(field in errors)) {
          errors[field] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest<void>('/auth/reset-password', { method: 'POST', body: result.data });
      await navigate({ to: '/login', search: { notice: 'password-reset' } });
    } catch (error) {
      // AUTH_OTP_INVALID covers wrong/expired/exhausted OTP and an unregistered email
      // uniformly, matching the backend's anti-enumeration design (FR-AUTH-6).
      const code = error instanceof ApiRequestError ? error.code : 'UNKNOWN_ERROR';
      setFormError(getErrorMessage(code));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === 'request') {
    return (
      <form onSubmit={(event) => void handleRequestSubmit(event)} noValidate>
        <h1>Forgot password</h1>

        {formError && <p role="alert">{formError}</p>}

        <label htmlFor="forgot-password-email">Email</label>
        <input
          id="forgot-password-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby={fieldErrors.email ? 'forgot-password-email-error' : undefined}
        />
        {fieldErrors.email && (
          <p id="forgot-password-email-error" role="alert">
            {fieldErrors.email}
          </p>
        )}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Sending…' : 'Send reset code'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={(event) => void handleVerifySubmit(event)} noValidate>
      <h1>Enter reset code</h1>

      {infoMessage && <p role="status">{infoMessage}</p>}
      {formError && <p role="alert">{formError}</p>}

      <label htmlFor="reset-otp">6-digit code</label>
      <input
        id="reset-otp"
        name="otp"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={otp}
        onChange={(event) => setOtp(event.target.value)}
        aria-describedby={fieldErrors.otp ? 'reset-otp-error' : undefined}
      />
      {fieldErrors.otp && (
        <p id="reset-otp-error" role="alert">
          {fieldErrors.otp}
        </p>
      )}

      <label htmlFor="reset-new-password">New password</label>
      <input
        id="reset-new-password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        aria-describedby={fieldErrors.newPassword ? 'reset-new-password-error' : undefined}
      />
      {fieldErrors.newPassword && (
        <p id="reset-new-password-error" role="alert">
          {fieldErrors.newPassword}
        </p>
      )}

      <label htmlFor="reset-confirm-new-password">Confirm new password</label>
      <input
        id="reset-confirm-new-password"
        name="confirmNewPassword"
        type="password"
        autoComplete="new-password"
        value={confirmNewPassword}
        onChange={(event) => setConfirmNewPassword(event.target.value)}
        aria-describedby={
          fieldErrors.confirmNewPassword ? 'reset-confirm-new-password-error' : undefined
        }
      />
      {fieldErrors.confirmNewPassword && (
        <p id="reset-confirm-new-password-error" role="alert">
          {fieldErrors.confirmNewPassword}
        </p>
      )}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Resetting…' : 'Reset password'}
      </button>
    </form>
  );
}
