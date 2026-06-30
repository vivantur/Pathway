import { Outlet } from 'react-router-dom';
import { Header } from './Header';

/** The persistent grimoire shell: header + page outlet + footer. */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-midnight-800 bg-grimoire-radial text-silver">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Outlet />
      </main>
      <footer className="border-t border-gold/10 px-4 py-6 text-center text-xs text-silver/40">
        Pathway · A second client on the Pathfinder 2e ecosystem · Phase W0
      </footer>
    </div>
  );
}
