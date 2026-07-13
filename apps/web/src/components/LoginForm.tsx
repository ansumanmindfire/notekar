import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md p-8 rounded-2xl bg-white border border-slate-200 shadow-xl">
        <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-6">
          <h1 className="text-3xl font-bold text-slate-900 text-center mb-8">Log in</h1>

          {formError && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm" role="alert">
              {formError}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">Email</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
              className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 rounded-lg px-4 py-2.5 transition-colors"
            />
            {fieldErrors.email && (
              <p id="login-email-error" className="text-sm text-red-600 mt-1" role="alert">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">Password</label>
              <Link to="/forgot-password" className="text-sm text-indigo-600 hover:text-indigo-500 font-medium">Forgot password?</Link>
            </div>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
              className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 rounded-lg px-4 py-2.5 transition-colors"
            />
            {fieldErrors.password && (
              <p id="login-password-error" className="text-sm text-red-600 mt-1" role="alert">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <button 
            type="submit" 
            disabled={isSubmitting}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mt-4"
          >
            {isSubmitting ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-slate-600">
          Don&apos;t have an account? <Link to="/register" className="text-indigo-600 hover:text-indigo-500 font-medium">Register here</Link>
        </div>
      </div>
    </div>
  );
}
