import { lazy, Suspense } from 'react';
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

// The LAZY admin diagnostics. Each carries a ~1–3 MB sidecar (the Foundry ingest report,
// the reconciled candidate queue) that is admin-only data and must not sit in a bundle a
// player downloads; a dynamic import puts each page and its sidecar in their own chunk,
// fetched only if the page is opened.
const EffectCoveragePage = lazy(() =>
  import('@/routes/EffectCoveragePage').then((m) => ({ default: m.EffectCoveragePage })),
);
const EffectReviewPage = lazy(() =>
  import('@/routes/EffectReviewPage').then((m) => ({ default: m.EffectReviewPage })),
);
const EffectAuthorPage = lazy(() =>
  import('@/routes/EffectAuthorPage').then((m) => ({ default: m.EffectAuthorPage })),
);

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
      {
        // Admin diagnostic: what the Foundry ingest mapped into our effect schema,
        // and what it could not. Unlinked from the nav. Gated the same way as the
        // admin dashboard — its ~3 MB ingest report is diagnostic data, not player
        // content.
        path: 'admin/effect-coverage',
        element: (
          <RequireAuth>
            <RequireAdmin>
              <Suspense fallback={<div className="px-4 py-12 text-center text-parchment/60">Loading…</div>}>
                <EffectCoveragePage />
              </Suspense>
            </RequireAdmin>
          </RequireAuth>
        ),
      },
      {
        // Admin review queue: the reconciled candidate proposals a human turns into
        // content. Gated and lazy for the same reason as effect-coverage — its ~1 MB
        // candidate sidecar is diagnostic data, not player content.
        path: 'admin/effect-review',
        element: (
          <RequireAuth>
            <RequireAdmin>
              <Suspense fallback={<div className="px-4 py-12 text-center text-parchment/60">Loading…</div>}>
                <EffectReviewPage />
              </Suspense>
            </RequireAdmin>
          </RequireAuth>
        ),
      },
      {
        // Admin authoring: the homebrew effect editor (stage 3). Gated + lazy like its siblings.
        path: 'admin/effect-author',
        element: (
          <RequireAuth>
            <RequireAdmin>
              <Suspense fallback={<div className="px-4 py-12 text-center text-parchment/60">Loading…</div>}>
                <EffectAuthorPage />
              </Suspense>
            </RequireAdmin>
          </RequireAuth>
        ),
      },
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
