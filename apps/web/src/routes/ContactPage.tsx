import { useState, type FormEvent } from 'react';
import { GildedRule } from '@/components/ui/GildedRule';
import { ConfigNotice } from '@/components/ConfigNotice';
import { useAuth } from '@/features/auth/useAuth';
import { supabase } from '@/lib/supabase';
import { links } from '@/lib/links';
import { useSubmitFeedback } from '@/features/feedback/useFeedback';
import type { FeedbackKind } from '@/features/feedback/api';

const KINDS: { value: FeedbackKind; label: string; hint: string }[] = [
  { value: 'bug', label: 'Bug report', hint: 'Something is broken or wrong.' },
  { value: 'suggestion', label: 'Suggestion', hint: 'An idea or feature request.' },
  { value: 'concern', label: 'Concern', hint: 'Something that worries you.' },
  { value: 'contact', label: 'General', hint: 'Just reaching out.' },
];

export function ContactPage() {
  const { user } = useAuth();
  const submit = useSubmitFeedback();

  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [honeypot, setHoneypot] = useState(''); // spam trap; humans never fill this
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supabase) return <ConfigNotice />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Honeypot filled → almost certainly a bot. Pretend success, insert nothing.
    if (honeypot.trim()) {
      setSent(true);
      return;
    }
    try {
      await submit.mutateAsync({
        kind,
        name,
        email,
        subject,
        message,
        page: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your message.');
    }
  }

  const inputClass =
    'mt-1 w-full rounded-md border border-gold/20 bg-midnight-900 px-3 py-2 text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none';

  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-lg border border-gold/20 bg-midnight-700/50 p-7 shadow-gilded">
        <h1 className="text-center font-display text-2xl text-gold">Get in touch</h1>
        <p className="mt-2 text-center text-sm text-silver/70">
          Found a bug, have an idea, or just want to reach out? Send it here — it goes straight to
          the person who runs Pathway.
        </p>

        <GildedRule className="my-6" />

        {sent ? (
          <div className="space-y-4 text-center">
            <p className="rounded-md border border-emerald/30 bg-emerald/10 p-4 text-sm text-emerald-soft">
              Thank you — your message has been received. {email.trim() ? 'You may hear back at the email you gave.' : ''}
            </p>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setMessage('');
                setSubject('');
              }}
              className="text-sm text-gold underline underline-offset-2 hover:text-gold/80"
            >
              Send another
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <fieldset>
              <legend className="text-sm text-silver/80">What is this about?</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setKind(k.value)}
                    aria-pressed={kind === k.value}
                    className={[
                      'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      kind === k.value
                        ? 'border-gold/60 bg-gold/10 text-gold'
                        : 'border-gold/15 bg-midnight-900/50 text-silver/70 hover:border-gold/40',
                    ].join(' ')}
                  >
                    <div className="font-medium">{k.label}</div>
                    <div className="text-[0.7rem] text-silver/50">{k.hint}</div>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-silver/80">
                Name <span className="text-silver/40">(optional)</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="What should I call you?" />
              </label>
              <label className="block text-sm text-silver/80">
                Email <span className="text-silver/40">(optional)</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="So I can reply"
                />
              </label>
            </div>

            <label className="block text-sm text-silver/80">
              Subject <span className="text-silver/40">(optional)</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} placeholder="A short summary" />
            </label>

            <label className="block text-sm text-silver/80">
              Message
              <textarea
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                maxLength={5000}
                className={inputClass}
                placeholder="Tell me what's on your mind. For a bug, what were you doing and what happened?"
              />
            </label>

            {/* Honeypot: hidden from humans, catnip for bots. */}
            <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
              </label>
            </div>

            <button
              type="submit"
              disabled={submit.isPending || !message.trim()}
              className="w-full rounded-md bg-gold px-4 py-2.5 font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submit.isPending ? 'Sending…' : 'Send message'}
            </button>

            {error && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>
            )}

            <p className="text-center text-xs text-silver/50">
              Prefer email or Discord? Reach out via{' '}
              <a href={links.contactEmail} className="text-gold underline underline-offset-2 hover:text-gold/80">
                email
              </a>
              {links.communityDiscord ? (
                <>
                  {' '}or the{' '}
                  <a href={links.communityDiscord} target="_blank" rel="noreferrer" className="text-gold underline underline-offset-2 hover:text-gold/80">
                    community Discord
                  </a>
                </>
              ) : null}
              .
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
