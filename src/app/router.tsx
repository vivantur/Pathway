import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { LandingPage } from '@/routes/LandingPage';
import { AboutPage } from '@/routes/AboutPage';
import { RoadmapPage } from '@/routes/RoadmapPage';
import { RulesLibraryPage } from '@/routes/RulesLibraryPage';
import { LoginPage } from '@/routes/LoginPage';
import { VaultPage } from '@/routes/VaultPage';
import { AddCharacterPage } from '@/routes/AddCharacterPage';
import { CharacterBuilderPage } from '@/routes/CharacterBuilderPage';
import { CharacterPage } from '@/routes/CharacterPage';
import { PublicSharePage } from '@/routes/PublicSharePage';
import { NotFoundPage } from '@/routes/NotFoundPage';

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'roadmap', element: <RoadmapPage /> },
      { path: 'rules', element: <RulesLibraryPage /> },
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
        // Public: anyone can build a character and export JSON. Saving to the
        // vault (and syncing to the bot) requires login, enforced in the
        // builder's Save button.
        path: 'vault/create',
        element: <CharacterBuilderPage />,
      },
      {
        // Edit / level-up an existing character in the builder. Registered
        // before :charKey so it wins the match.
        path: 'vault/:charKey/edit',
        element: (
          <RequireAuth>
            <CharacterBuilderPage />
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
      {
        // Public share view — no RequireAuth. RLS on characters must
        // include a policy allowing `is_public = true` for anon reads.
        path: 'share/:shareId',
        element: <PublicSharePage />,
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
