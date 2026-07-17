import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import {
  fetchAdminCharacters,
  fetchAdminStats,
  fetchAdminUsers,
  fetchIsAdmin,
} from './api';

/**
 * Whether the signed-in user is an admin. Server-authoritative (the
 * `current_user_is_admin` RPC) — this only drives UI gating; the data RPCs each
 * re-check on the server, so a spoofed `true` still returns nothing.
 */
export function useIsAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['is-admin', user?.id],
    queryFn: fetchIsAdmin,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAdminStats(enabled: boolean) {
  return useQuery({ queryKey: ['admin-stats'], queryFn: fetchAdminStats, enabled });
}

export function useAdminUsers(enabled: boolean) {
  return useQuery({ queryKey: ['admin-users'], queryFn: fetchAdminUsers, enabled });
}

export function useAdminCharacters(enabled: boolean) {
  return useQuery({ queryKey: ['admin-characters'], queryFn: fetchAdminCharacters, enabled });
}
