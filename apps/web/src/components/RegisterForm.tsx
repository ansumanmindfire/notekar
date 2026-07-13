import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { registerSchema } from 'shared';
import { useAuthStore } from '../stores/authStore';
import { ApiRequestError } from '../lib/apiClient';
import { getErrorMessage } from '../lib/errorMessages';

export function RegisterForm() {
  const navigate = useNavigate();
  const register = useAuthStore((state) => state.register);
  const login = useAuthStore((state) => state.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (password !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }

    const result = registerSchema.safeParse({ email, password });
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
      await register(result.data.email, result.data.password);
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.code : 'UNKNOWN_ERROR';
      setFormError(getErrorMessage(code));
      setIsSubmitting(false);
      return;
    }

    try {
      // Registration returns no session (AB-1002 contract), so we chain a login call
      // with the same credentials to satisfy FR-AUTH-1. One "Register" click therefore
      // consumes both the registration rate limit (3/hr/IP) and the login rate limit
      // (5/min/IP) — an accepted tradeoff per the FRS limits, not an oversight to
      // "optimize away" without re-reading AB-1010's spec.
      await login(result.data.email, result.data.password);
      await navigate({ to: '/notes' });
    } catch {
      await navigate({ to: '/login', search: { notice: 'account-created' } });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <h1>Create account</h1>

      {formError && <p role="alert">{formError}</p>}

      <label htmlFor="register-email">Email</label>
      <input
        id="register-email"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
      />
      {fieldErrors.email && (
        <p id="register-email-error" role="alert">
          {fieldErrors.email}
        </p>
      )}

      <label htmlFor="register-password">Password</label>
      <input
        id="register-password"
        name="password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-describedby={fieldErrors.password ? 'register-password-error' : undefined}
      />
      {fieldErrors.password && (
        <p id="register-password-error" role="alert">
          {fieldErrors.password}
        </p>
      )}

      <label htmlFor="register-confirm-password">Confirm password</label>
      <input
        id="register-confirm-password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        aria-describedby={fieldErrors.confirmPassword ? 'register-confirm-password-error' : undefined}
      />
      {fieldErrors.confirmPassword && (
        <p id="register-confirm-password-error" role="alert">
          {fieldErrors.confirmPassword}
        </p>
      )}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
