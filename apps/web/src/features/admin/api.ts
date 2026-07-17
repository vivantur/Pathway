import { requireSupabase } from '@/lib/supabase';

/** Headline counts from the `admin_stats()` RPC. */
export interface AdminStats {
  users: number;
  admins: number;
  characters: number;
  public_characters: number;
  companions: number;
  characters_active_7d: number;
  characters_active_30d: number;
}

/** One row from `admin_users()`. */
export interface AdminUserRow {
  user_id: string;
  discord_id: string | null;
  discord_username: string | null;
  character_count: number;
  last_activity: string | null;
}

/** One row from `admin_characters()`. */
export interface AdminCharacterRow {
  id: string;
  char_key: string;
  name: string;
  owner_user_id: string | null;
  owner_username: string | null;
  ancestry_name: string | null;
  class_name: string | null;
  level: number | null;
  experience: number | null;
  is_public: boolean;
  updated_at: string | null;
}

/** Whether the signed-in user is a flagged admin (server-checked). */
export async function fetchIsAdmin(): Promise<boolean> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('current_user_is_admin');
  if (error) throw error;
  return data === true;
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('admin_stats');
  if (error) throw error;
  return data as AdminStats;
}

export async function fetchAdminUsers(): Promise<AdminUserRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('admin_users');
  if (error) throw error;
  return (data ?? []) as AdminUserRow[];
}

export async function fetchAdminCharacters(): Promise<AdminCharacterRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('admin_characters');
  if (error) throw error;
  return (data ?? []) as AdminCharacterRow[];
}
