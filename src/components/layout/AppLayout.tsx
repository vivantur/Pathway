import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';

/** The persistent grimoire shell: header + page outlet + footer. */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-midnight-800 bg-grimoire-radial text-silver">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
