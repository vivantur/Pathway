import { requireSupabase } from '@/lib/supabase';

export type FeedbackKind = 'bug' | 'suggestion' | 'concern' | 'contact' | 'other';
export type FeedbackStatus = 'new' | 'read' | 'resolved';

export interface FeedbackInput {
  kind: FeedbackKind;
  name?: string;
  email?: string;
  subject?: string;
  message: string;
  /** Auth uid when signed in; null/omitted for anonymous submissions. */
  userId?: string | null;
  /** Route the user was on when they submitted (helps reproduce bugs). */
  page?: string;
}

export interface FeedbackRow {
  id: string;
  created_at: string;
  kind: FeedbackKind;
  name: string | null;
  email: string | null;
  subject: string | null;
  message: string;
  user_id: string | null;
  page: string | null;
  user_agent: string | null;
  status: FeedbackStatus;
}

/** Submit a feedback / contact message. Works signed-in or anonymously. */
export async function submitFeedback(input: FeedbackInput): Promise<void> {
  const supabase = requireSupabase();
  const trimmed = input.message.trim();
  if (!trimmed) throw new Error('Please enter a message.');
  if (trimmed.length > 5000) throw new Error('Message is too long (5000 characters max).');

  const { error } = await supabase.from('feedback').insert({
    kind: input.kind,
    name: input.name?.trim() || null,
    email: input.email?.trim() || null,
    subject: input.subject?.trim() || null,
    message: trimmed,
    user_id: input.userId ?? null,
    page: input.page ?? null,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null,
  });
  if (error) throw error;
}

/** Admin: the full inbox, newest first. RLS restricts this to admins. */
export async function fetchFeedback(): Promise<FeedbackRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FeedbackRow[];
}

/** Admin: change a submission's triage status. */
export async function updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('feedback').update({ status }).eq('id', id);
  if (error) throw error;
}
