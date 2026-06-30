import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { LandingPage } from '@/routes/LandingPage';
import { LoginPage } from '@/routes/LoginPage';
import { VaultPage } from '@/routes/VaultPage';
import { NotFoundPage } from '@/routes/NotFoundPage';

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'login', element: <LoginPage /> },
      {
        path: 'vault',
        element: (
          <RequireAuth>
            <VaultPage />
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
