import { createContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';

export interface AuthContextValue {
  /** Current Supabase session, or null when signed out. */
  session: Session | null;
  user: User | null;
  /** True until the initial session lookup resolves. */
  loading: boolean;
  /** Send a magic-link / OTP email for passwordless sign-in. */
  signInWithEmail: (email: string) => Promise<void>;
  /** Start the Discord OAuth flow (the path that unifies web ⇄ bot identity). */
  signInWithDiscord: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
