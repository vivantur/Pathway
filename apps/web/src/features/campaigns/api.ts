import { requireSupabase } from '@/lib/supabase';

export type CampaignRole = 'gm' | 'player';

/** One row from `my_campaigns()` — a campaign the signed-in user is in. */
export interface CampaignSummary {
  id: string;
  name: string;
  description: string | null;
  gm_user_id: string;
  role: CampaignRole;
  member_count: number;
  updated_at: string;
}

/** The `campaigns` table row (readable by members). */
export interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  gm_user_id: string;
  join_code: string;
  created_at: string;
  updated_at: string;
}

/** One party member + the character they bring, from `campaign_party()`. */
export interface PartyMember {
  user_id: string;
  username: string | null;
  role: CampaignRole;
  char_key: string | null;
  character_id: string | null;
  character_name: string | null;
  level: number | null;
  ancestry_name: string | null;
  class_name: string | null;
  current_hp: number | null;
  art: string | null;
}

export async function fetchMyCampaigns(): Promise<CampaignSummary[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('my_campaigns');
  if (error) throw error;
  return (data ?? []) as CampaignSummary[];
}

export async function createCampaign(name: string, description: string): Promise<string> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('create_campaign', {
    p_name: name,
    p_description: description,
  });
  if (error) throw error;
  return data as string; // new campaign id
}

export async function joinCampaign(code: string, charKey: string): Promise<string> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('join_campaign', {
    p_code: code,
    p_char_key: charKey,
  });
  if (error) throw error;
  return data as string; // campaign id
}

export async function fetchCampaign(id: string): Promise<CampaignRow | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, description, gm_user_id, join_code, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as CampaignRow | null) ?? null;
}

export async function fetchParty(campaignId: string): Promise<PartyMember[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('campaign_party', { cid: campaignId });
  if (error) throw error;
  return (data ?? []) as PartyMember[];
}

export async function updateCampaign(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('campaigns')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteCampaign(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('campaigns').delete().eq('id', id);
  if (error) throw error;
}

/** Set (or change) which character the signed-in user brings to a campaign. */
export async function setMyCharacter(
  campaignId: string,
  userId: string,
  charKey: string | null,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('campaign_members')
    .update({ char_key: charKey })
    .eq('campaign_id', campaignId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Remove a member (GM kicks anyone; a player removes themselves = leave). */
export async function removeMember(campaignId: string, userId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('campaign_members')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('user_id', userId);
  if (error) throw error;
}
