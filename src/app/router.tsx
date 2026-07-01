import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { LandingPage } from '@/routes/LandingPage';
import { AboutPage } from '@/routes/AboutPage';
import { RoadmapPage } from '@/routes/RoadmapPage';
import { LoginPage } from '@/routes/LoginPage';
import { VaultPage } from '@/routes/VaultPage';
import { AddCharacterPage } from '@/routes/AddCharacterPage';
import { CharacterPage } from '@/routes/CharacterPage';
import { NotFoundPage } from '@/routes/NotFoundPage';

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'roadmap', element: <RoadmapPage /> },
      { path: 'login', element: <LoginPage /> },
      {
        path: 'vault',
        element: (
          <RequireAuth>
            <VaultPage />
          </RequireAuth>
        ),
      },
      {
        // Register the literal /vault/new BEFORE /vault/:charKey so it wins
        // the match; React Router prefers static segments but we're explicit
        // here so a future reader doesn't wonder about ordering.
        path: 'vault/new',
        element: (
          <RequireAuth>
            <AddCharacterPage />
          </RequireAuth>
        ),
      },
      {
        path: 'vault/:charKey',
        element: (
          <RequireAuth>
            <CharacterPage />
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
