import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RouteError } from '@/components/RouteError';
import { RequireAuth } from '@/components/RequireAuth';
import { RequireAdmin } from '@/components/RequireAdmin';
import { LandingPage } from '@/routes/LandingPage';
import { AboutPage } from '@/routes/AboutPage';
import { RoadmapPage } from '@/routes/RoadmapPage';
import { RulesLibraryPage } from '@/routes/RulesLibraryPage';
import { LoginPage } from '@/routes/LoginPage';
import { VaultPage } from '@/routes/VaultPage';
import { AddCharacterPage } from '@/routes/AddCharacterPage';
import { CharacterBuilderPage } from '@/routes/CharacterBuilderPage';
import { ContentGate } from '@/features/builder/ContentGate';
import { CharacterPage } from '@/routes/CharacterPage';
import { PublicSharePage } from '@/routes/PublicSharePage';
import { AdminPage } from '@/routes/AdminPage';
import { ContactPage } from '@/routes/ContactPage';
import { CampaignsPage } from '@/routes/CampaignsPage';
import { CampaignPage } from '@/routes/CampaignPage';
import { NotFoundPage } from '@/routes/NotFoundPage';

export const router = createBrowserRouter([
  {
    // The landing page sits OUTSIDE AppLayout: it is full-bleed and supplies
    // its own header/footer, which AppLayout's centered, padded <main> would
    // fight. Everything else keeps the shared grimoire shell below.
    path: '/',
    element: <LandingPage />,
    errorElement: <RouteError />,
  },
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { path: 'about', element: <AboutPage /> },
      { path: 'roadmap', element: <RoadmapPage /> },
      { path: 'rules', element: <RulesLibraryPage /> },
      { path: 'contact', element: <ContactPage /> },
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
        element: (
          <ContentGate>
            <CharacterBuilderPage />
          </ContentGate>
        ),
      },
      {
        // Edit / level-up an existing character in the builder. Registered
        // before :charKey so it wins the match.
        path: 'vault/:charKey/edit',
        element: (
          <RequireAuth>
            <ContentGate>
              <CharacterBuilderPage />
            </ContentGate>
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
      {
        path: 'campaigns',
        element: (
          <RequireAuth>
            <CampaignsPage />
          </RequireAuth>
        ),
      },
      {
        path: 'campaigns/:campaignId',
        element: (
          <RequireAuth>
            <CampaignPage />
          </RequireAuth>
        ),
      },
      {
        // Admin dashboard. Signed-in AND admin-flagged; the server RPCs it
        // calls re-check is_admin(), so the guard is defence-in-depth, not the
        // security boundary.
        path: 'admin',
        element: (
          <RequireAuth>
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
