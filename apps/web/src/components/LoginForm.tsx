import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { loginSchema } from 'shared';
import { useAuthStore } from '../stores/authStore';
import { ApiRequestError } from '../lib/apiClient';
import { getErrorMessage } from '../lib/errorMessages';

export function LoginForm() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const result = loginSchema.safeParse({ email, password });
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
      await login(result.data.email, result.data.password);
      await navigate({ to: '/notes' });
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.code : 'UNKNOWN_ERROR';
      setFormError(getErrorMessage(code));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <h1>Log in</h1>

      {formError && <p role="alert">{formError}</p>}

      <label htmlFor="login-email">Email</label>
      <input
        id="login-email"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
      />
      {fieldErrors.email && (
        <p id="login-email-error" role="alert">
          {fieldErrors.email}
        </p>
      )}

      <label htmlFor="login-password">Password</label>
      <input
        id="login-password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
      />
      {fieldErrors.password && (
        <p id="login-password-error" role="alert">
          {fieldErrors.password}
        </p>
      )}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
