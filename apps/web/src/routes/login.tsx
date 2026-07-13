import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './root';
import { useAuthStore } from '../stores/authStore';
import { LoginForm } from '../components/LoginForm';
import { useEffect } from 'react';
import { toast } from 'sonner';

type LoginNotice = 'account-created' | 'password-reset';

interface LoginSearch {
  notice?: LoginNotice;
}

const NOTICE_COPY: Record<LoginNotice, string> = {
  'account-created': 'Account created — please sign in.',
  'password-reset': 'Password updated — please sign in.',
};

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const notice = search.notice;
    if (notice === 'account-created' || notice === 'password-reset') {
      return { notice };
    }
    return {};
  },
  beforeLoad: () => {
    if (useAuthStore.getState().status === 'authenticated') {
      throw redirect({ to: '/notes' });
    }
  },
  component: LoginRouteComponent,
});

function LoginRouteComponent() {
  const { notice } = loginRoute.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    if (notice) {
      toast.success(NOTICE_COPY[notice], { id: notice });
      void navigate({ to: '/login', replace: true });
    }
  }, [notice, navigate]);

  return <LoginForm />;
}
