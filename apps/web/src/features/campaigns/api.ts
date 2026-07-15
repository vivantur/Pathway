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

// --- session journal -------------------------------------------------------

export interface JournalEntry {
  id: string;
  campaign_id: string;
  author_user_id: string | null;
  title: string | null;
  body: string;
  session_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface JournalInput {
  title?: string;
  body: string;
  sessionDate?: string; // YYYY-MM-DD
}

export async function fetchJournal(campaignId: string): Promise<JournalEntry[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('campaign_journal')
    .select('id, campaign_id, author_user_id, title, body, session_date, created_at, updated_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as JournalEntry[];
}

export async function postJournal(
  campaignId: string,
  authorUserId: string,
  input: JournalInput,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('campaign_journal').insert({
    campaign_id: campaignId,
    author_user_id: authorUserId,
    title: input.title?.trim() || null,
    body: input.body.trim(),
    session_date: input.sessionDate || null,
  });
  if (error) throw error;
}

export async function updateJournalEntry(id: string, input: JournalInput): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('campaign_journal')
    .update({
      title: input.title?.trim() || null,
      body: input.body.trim(),
      session_date: input.sessionDate || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteJournalEntry(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('campaign_journal').delete().eq('id', id);
  if (error) throw error;
}

// --- NPCs ------------------------------------------------------------------

export interface Npc {
  id: string;
  name: string;
  role: string | null;
  location: string | null;
  description: string | null;
  /** GM-only notes — null for players (the RPC strips them). */
  gm_notes: string | null;
  is_secret: boolean;
  updated_at: string;
}

export interface NpcInput {
  name: string;
  role?: string;
  location?: string;
  description?: string;
  gmNotes?: string;
  isSecret?: boolean;
}

/** The visible NPCs for the caller (GM: all + gm_notes; players: revealed only). */
export async function fetchNpcs(campaignId: string): Promise<Npc[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('campaign_npcs_list', { cid: campaignId });
  if (error) throw error;
  return (data ?? []) as Npc[];
}

function npcRow(input: NpcInput) {
  return {
    name: input.name.trim(),
    role: input.role?.trim() || null,
    location: input.location?.trim() || null,
    description: input.description?.trim() || null,
    gm_notes: input.gmNotes?.trim() || null,
    is_secret: input.isSecret ?? false,
  };
}

export async function createNpc(campaignId: string, input: NpcInput): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('campaign_npcs').insert({ campaign_id: campaignId, ...npcRow(input) });
  if (error) throw error;
}

export async function updateNpc(id: string, input: NpcInput): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('campaign_npcs')
    .update({ ...npcRow(input), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteNpc(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('campaign_npcs').delete().eq('id', id);
  if (error) throw error;
}
