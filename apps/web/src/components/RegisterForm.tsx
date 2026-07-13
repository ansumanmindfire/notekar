import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md p-8 rounded-2xl bg-white border border-slate-200 shadow-xl">
        <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-6">
          <h1 className="text-3xl font-bold text-slate-900 text-center mb-8">Create account</h1>

          {formError && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm" role="alert">
              {formError}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="register-email" className="block text-sm font-medium text-slate-700">Email</label>
            <input
              id="register-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
              className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 rounded-lg px-4 py-2.5 transition-colors"
            />
            {fieldErrors.email && (
              <p id="register-email-error" className="text-sm text-red-600 mt-1" role="alert">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="register-password" className="block text-sm font-medium text-slate-700">Password</label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby={fieldErrors.password ? 'register-password-error' : undefined}
              className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 rounded-lg px-4 py-2.5 transition-colors"
            />
            {fieldErrors.password && (
              <p id="register-password-error" className="text-sm text-red-600 mt-1" role="alert">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="register-confirm-password" className="block text-sm font-medium text-slate-700">Confirm password</label>
            <input
              id="register-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-describedby={fieldErrors.confirmPassword ? 'register-confirm-password-error' : undefined}
              className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 rounded-lg px-4 py-2.5 transition-colors"
            />
            {fieldErrors.confirmPassword && (
              <p id="register-confirm-password-error" className="text-sm text-red-600 mt-1" role="alert">
                {fieldErrors.confirmPassword}
              </p>
            )}
          </div>

          <button 
            type="submit" 
            disabled={isSubmitting}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mt-4"
          >
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-slate-600">
          Already have an account? <Link to="/login" className="text-indigo-600 hover:text-indigo-500 font-medium">Log in</Link>
        </div>
      </div>
    </div>
  );
}
