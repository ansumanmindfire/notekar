import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './root';
import { PublicSharePage } from '../components/shares/PublicSharePage';

export const sharesTokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shares/$token',
  component: SharesTokenComponent,
});

function SharesTokenComponent() {
  const { token } = sharesTokenRoute.useParams();
  return <PublicSharePage token={token} />;
}
