import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import {
  createCampaign,
  deleteCampaign,
  fetchCampaign,
  fetchMyCampaigns,
  fetchParty,
  joinCampaign,
  removeMember,
  setMyCharacter,
  updateCampaign,
} from './api';

export function useMyCampaigns() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-campaigns', user?.id],
    queryFn: fetchMyCampaigns,
    enabled: !!user,
  });
}

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ['campaign', id],
    queryFn: () => fetchCampaign(id!),
    enabled: !!id,
  });
}

export function useParty(id: string | undefined) {
  return useQuery({
    queryKey: ['campaign-party', id],
    queryFn: () => fetchParty(id!),
    enabled: !!id,
    // Party stats (HP etc.) change during play — keep them reasonably fresh.
    refetchInterval: 30_000,
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description: string }) =>
      createCampaign(name, description),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-campaigns'] }),
  });
}

export function useJoinCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, charKey }: { code: string; charKey: string }) =>
      joinCampaign(code, charKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-campaigns'] }),
  });
}

export function useUpdateCampaign(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { name?: string; description?: string | null }) => updateCampaign(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', id] });
      qc.invalidateQueries({ queryKey: ['my-campaigns'] });
    },
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCampaign(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-campaigns'] }),
  });
}

export function useSetMyCharacter(campaignId: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (charKey: string | null) => setMyCharacter(campaignId, user!.id, charKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaign-party', campaignId] }),
  });
}

export function useRemoveMember(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeMember(campaignId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign-party', campaignId] });
      qc.invalidateQueries({ queryKey: ['my-campaigns'] });
    },
  });
}
