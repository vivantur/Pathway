import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { relinkCurrentUser, type RelinkResult } from '@/features/characters/api';
import { useAuth } from './useAuth';

/**
 * Run the self-relink RPC once per signed-in session.
 *
 * On first Discord login this claims the user's existing bot characters by
 * rewriting their bot `users.id` to the web `auth.uid()`. It's idempotent, so
 * we cache it with `staleTime: Infinity` — it fires once per user and never
 * re-runs unless the app reloads. When it actually links (status 'linked'),
 * we invalidate the characters cache so the vault repopulates immediately.
 *
 * Errors are swallowed into the query state rather than thrown at the UI: a
 * failed relink shouldn't block the app, and the most common non-link results
 * ('already_linked', 'no_bot_identity') are normal, not errors.
 */
export function useRelink() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const handledRef = useRef<string | null>(null);

  const query = useQuery<RelinkResult>({
    queryKey: ['relink', user?.id],
    queryFn: relinkCurrentUser,
    enabled: Boolean(user),
    staleTime: Infinity,
    retry: false,
  });

  // When the relink actually claims characters, refresh the vault list once.
  useEffect(() => {
    if (!query.data || !user) return;
    if (query.data.status !== 'linked') return;
    if (handledRef.current === user.id) return;
    handledRef.current = user.id;
    qc.invalidateQueries({ queryKey: ['characters'] });
  }, [query.data, user, qc]);

  return query;
}
