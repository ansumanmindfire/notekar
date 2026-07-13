import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
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
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md p-8 rounded-2xl bg-white border border-slate-200 shadow-xl">
          <form onSubmit={(event) => void handleRequestSubmit(event)} noValidate className="space-y-6">
            <h1 className="text-3xl font-bold text-slate-900 text-center mb-8">Forgot password</h1>

            {formError && (
              <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm" role="alert">
                {formError}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="forgot-password-email" className="block text-sm font-medium text-slate-700">Email</label>
              <input
                id="forgot-password-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby={fieldErrors.email ? 'forgot-password-email-error' : undefined}
                className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 rounded-lg px-4 py-2.5 transition-colors"
              />
              {fieldErrors.email && (
                <p id="forgot-password-email-error" className="text-sm text-red-600 mt-1" role="alert">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mt-4"
            >
              {isSubmitting ? 'Sending…' : 'Send reset code'}
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-slate-600">
            Remember your password? <Link to="/login" className="text-indigo-600 hover:text-indigo-500 font-medium">Log in</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md p-8 rounded-2xl bg-white border border-slate-200 shadow-xl">
        <form onSubmit={(event) => void handleVerifySubmit(event)} noValidate className="space-y-6">
          <h1 className="text-3xl font-bold text-slate-900 text-center mb-8">Enter reset code</h1>

          {infoMessage && (
            <div className="p-4 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 text-sm" role="status">
              {infoMessage}
            </div>
          )}
          {formError && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm" role="alert">
              {formError}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="reset-otp" className="block text-sm font-medium text-slate-700">6-digit code</label>
            <input
              id="reset-otp"
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              aria-describedby={fieldErrors.otp ? 'reset-otp-error' : undefined}
              className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 rounded-lg px-4 py-2.5 transition-colors"
            />
            {fieldErrors.otp && (
              <p id="reset-otp-error" className="text-sm text-red-600 mt-1" role="alert">
                {fieldErrors.otp}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="reset-new-password" className="block text-sm font-medium text-slate-700">New password</label>
            <input
              id="reset-new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              aria-describedby={fieldErrors.newPassword ? 'reset-new-password-error' : undefined}
              className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 rounded-lg px-4 py-2.5 transition-colors"
            />
            {fieldErrors.newPassword && (
              <p id="reset-new-password-error" className="text-sm text-red-600 mt-1" role="alert">
                {fieldErrors.newPassword}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="reset-confirm-new-password" className="block text-sm font-medium text-slate-700">Confirm new password</label>
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
              className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 rounded-lg px-4 py-2.5 transition-colors"
            />
            {fieldErrors.confirmNewPassword && (
              <p id="reset-confirm-new-password-error" className="text-sm text-red-600 mt-1" role="alert">
                {fieldErrors.confirmNewPassword}
              </p>
            )}
          </div>

          <button 
            type="submit" 
            disabled={isSubmitting}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mt-4"
          >
            {isSubmitting ? 'Resetting…' : 'Reset password'}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-slate-600">
          Remember your password? <Link to="/login" className="text-indigo-600 hover:text-indigo-500 font-medium">Log in</Link>
        </div>
      </div>
    </div>
  );
}
