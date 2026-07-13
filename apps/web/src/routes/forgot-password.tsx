import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { useAuthStore } from '../stores/authStore';
import { ForgotPasswordForm } from '../components/ForgotPasswordForm';

export const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  beforeLoad: () => {
    if (useAuthStore.getState().status === 'authenticated') {
      throw redirect({ to: '/notes' });
    }
  },
  component: ForgotPasswordForm,
});
