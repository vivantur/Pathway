import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import {
  deleteCompanion,
  listCompanions,
  saveCompanion,
  setActiveCompanion,
  type SaveCompanionInput,
} from './api';

export const companionsKey = (userId: string | undefined, charKey: string) =>
  ['companions', userId, charKey] as const;

/** Live list of a character's companions from the `companions` table. */
export function useCompanions(charKey: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: companionsKey(user?.id, charKey ?? ''),
    queryFn: () => listCompanions(user!.id, charKey!),
    enabled: Boolean(user && charKey),
  });
}

export function useSaveCompanion(charKey: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SaveCompanionInput, 'userId' | 'charKey'>) =>
      saveCompanion({ ...input, userId: user!.id, charKey: charKey! }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: companionsKey(user?.id, charKey ?? '') });
    },
  });
}

export function useDeleteCompanion(charKey: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (compKey: string) => deleteCompanion(user!.id, charKey!, compKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: companionsKey(user?.id, charKey ?? '') });
    },
  });
}

export function useSetActiveCompanion(charKey: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (compKey: string) => setActiveCompanion(user!.id, charKey!, compKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: companionsKey(user?.id, charKey ?? '') });
    },
  });
}
