import { GildedRule } from '@/components/ui/GildedRule';

const ABILITIES = [
  { label: 'STR', mod: '+4' },
  { label: 'DEX', mod: '+1' },
  { label: 'CON', mod: '+2' },
  { label: 'INT', mod: '+0' },
  { label: 'WIS', mod: '+1' },
  { label: 'CHA', mod: '+3' },
];

/**
 * The "one book, two covers" proof: the same character rendered as the web
 * sheet and as bot output, with the same HP on both sides.
 *
 * Static showcase markup, not live data — it illustrates the product rather
 * than reading from it.
 */
export function SyncShowcase() {
  return (
    <section id="table" className="relative z-[1] mx-auto max-w-[1280px] scroll-mt-10 px-8 pb-[90px] pt-10">
      <div data-reveal>
        <GildedRule className="mb-3.5" />
      </div>

      <div data-reveal className="mb-[54px] text-center">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.34em] text-arcane">
          One book · two covers
        </p>
        <h2 className="mx-auto mt-3.5 max-w-[700px] font-display text-[40px] font-bold leading-[1.15] text-gold-soft [text-wrap:balance]">
          The web is your study.
          <br />
          Discord is your table.
        </h2>
        <p className="mx-auto mt-4 max-w-[560px] text-[19px] leading-[1.6] text-dim">
          Build in the browser tonight; roll it in Discord tomorrow. Same character, same backend,
          no exports, no re-typing — the ink dries in both places at once.
        </p>
      </div>

      <div className="grid items-stretch gap-[26px] wide:grid-cols-[1.05fr_.95fr]">
        <WebSheetCard />
        <DiscordCard />
      </div>

      <p data-reveal className="mx-auto mt-[22px] text-center text-[15px] italic text-faint">
        Live sync — the HP bar above and the embed below are the same number.
      </p>
    </section>
  );
}

function WebSheetCard() {
  return (
    <div
      data-reveal
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-card backdrop-blur-[6px]"
    >
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-[11px]">
        <span className="h-2.5 w-2.5 rounded-full bg-silver/25" />
        <span className="h-2.5 w-2.5 rounded-full bg-silver/25" />
        <span className="h-2.5 w-2.5 rounded-full bg-silver/25" />
        <span className="ml-2.5 font-mono text-[12.5px] text-faint">pathwaypf2e.com/vault/seelah</span>
      </div>

      <div className="px-[26px] py-6">
        <div className="flex items-center justify-between gap-3.5">
          <div className="flex items-center gap-3.5">
            <div
              className="flex h-[52px] w-[52px] items-center justify-center rounded-lg border border-line-strong font-display text-[19px] font-bold text-gold"
              style={{
                background:
                  'repeating-linear-gradient(-45deg,rgb(var(--c-gold) / .12) 0 6px,transparent 6px 12px)',
              }}
            >
              S
            </div>
            <div>
              <p className="font-display text-xl font-bold text-gold-soft">Seelah</p>
              <p className="mt-0.5 text-[14.5px] italic text-faint">
                Human · Champion of Iomedae · Level 5
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-line-strong px-3.5 py-2 text-center">
            <p className="font-display text-[22px] font-extrabold text-gold-soft">23</p>
            <p className="text-[10.5px] uppercase tracking-[0.2em] text-faint">AC</p>
          </div>
        </div>

        {/* Hit points */}
        <div className="mt-[18px]">
          <div className="flex justify-between text-[13px] text-faint">
            <span className="uppercase tracking-[0.15em]">Hit Points</span>
            <span className="font-mono text-dim">58 / 73</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded bg-silver/[0.12]">
            <div className="h-full w-[79%] rounded bg-gradient-to-r from-gold-deep to-gold-soft" />
          </div>
        </div>

        <div className="mt-[18px] grid grid-cols-6 gap-2">
          {ABILITIES.map((a) => (
            <div key={a.label} className="rounded-md border border-line px-1 py-[9px] text-center">
              <p className="text-[10px] tracking-[0.15em] text-faint">{a.label}</p>
              <p className="mt-[3px] font-display text-base font-bold text-silver">{a.mod}</p>
            </div>
          ))}
        </div>

        <div className="mt-[18px] flex flex-wrap gap-2">
          <span className="rounded-[5px] border border-line-strong px-3 py-1.5 text-[13px] text-gold-soft">
            ⚔ Longsword +12
          </span>
          <span className="rounded-[5px] border border-line px-3 py-1.5 text-[13px] text-dim">
            🛡 Raise a Shield
          </span>
          <span className="rounded-[5px] border border-line px-3 py-1.5 text-[13px] text-dim">
            ✦ Lay on Hands 2/3
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Deliberately NOT themed: Discord's client is dark regardless of Pathway's
 * theme, so this card hardcodes Discord's palette in both modes. Themed tokens
 * here would misrepresent what the reader actually sees in Discord.
 */
function DiscordCard() {
  return (
    <div
      data-reveal
      className="flex flex-col overflow-hidden rounded-xl bg-[#313338] font-sans shadow-card"
    >
      <div className="flex items-center gap-2 border-b border-[#26272b] px-4 py-3 text-sm font-semibold text-[#dbdee1]">
        <span className="text-lg font-normal text-[#80848e]">#</span> goblin-warrens
        <span className="ml-auto text-[11px] font-normal text-[#80848e]">Pathway is online ●</span>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 p-4">
        {/* Player message */}
        <div className="flex gap-2.5">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[#4e5058] text-sm font-semibold text-[#dbdee1]">
            M
          </div>
          <div>
            <span className="text-sm font-semibold text-[#f2f3f5]">Mira</span>{' '}
            <span className="text-[11px] text-[#80848e]">9:41 PM</span>
            <p className="mt-0.5 font-mono text-sm text-[#dbdee1]">
              <span className="whitespace-nowrap rounded-[3px] bg-[#3c45a5] px-1 py-px text-[#c9cdfb]">
                /check athletics
              </span>
              <span className="animate-cursorblink">▏</span>
            </p>
          </div>
        </div>

        {/* Bot: check result */}
        <div className="flex gap-2.5">
          <BotAvatar />
          <div className="min-w-0 flex-1">
            <BotName time="9:41 PM" />
            <div className="mt-1 rounded border-l-4 border-[#d4af37] bg-[#2b2d31] px-[13px] py-[11px]">
              <p className="text-[14.5px] font-semibold text-[#e8cf7e]">Seelah — Athletics check</p>
              <p className="mt-[5px] text-sm text-[#dbdee1]">
                🎲 <strong className="text-white">d20 (14) + 11 = 25</strong> vs DC 20 —{' '}
                <strong className="text-[#57f287]">Success</strong>
              </p>
              <p className="mt-[5px] text-xs text-[#949ba4]">Trained · +4 Str · +5 prof · +2 item</p>
            </div>
          </div>
        </div>

        {/* Bot: combat tracker */}
        <div className="flex gap-2.5">
          <BotAvatar />
          <div className="min-w-0 flex-1">
            <BotName />
            <div className="mt-1 rounded border-l-4 border-[#39d6e8] bg-[#2b2d31] px-[13px] py-[11px]">
              <p className="text-[14.5px] font-semibold text-[#8be9f2]">Combat — Round 2</p>
              <p className="mt-[5px] text-[13px] text-[#dbdee1]">
                Seelah <strong className="text-white">58/73 HP</strong> · Goblin Pyro{' '}
                <em>frightened 1</em> · Mira&apos;s familiar acts next
              </p>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {['⚔️ Strike', '🛡️ Raise Shield', '✦ Lay on Hands', '➡️ End turn'].map((b) => (
                <span key={b} className="rounded bg-[#2b2d31] px-[11px] py-[5px] text-[12.5px] text-[#dbdee1]">
                  {b}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-4 mb-4 rounded-lg bg-[#383a40] px-3.5 py-2.5 text-[13.5px] text-[#80848e]">
        Message #goblin-warrens
      </div>
    </div>
  );
}

/**
 * The mark as it appears in Discord — literal colors, not theme tokens, so it
 * matches the surrounding hardcoded Discord card in light mode too.
 */
function BotAvatar() {
  return (
    <svg width="36" height="36" viewBox="0 0 64 64" className="flex-none" aria-hidden>
      <rect width="64" height="64" rx="32" fill="#0b1026" />
      <path d="M32 10 L36 30 L56 32 L36 34 L32 54 L28 34 L8 32 L28 30 Z" fill="#d4af37" />
    </svg>
  );
}

function BotName({ time }: { time?: string }) {
  return (
    <>
      <span className="text-sm font-semibold text-[#f2f3f5]">Pathway</span>{' '}
      <span className="rounded-[3px] bg-[#5865f2] px-[5px] py-px align-[1px] text-[10px] font-semibold text-white">
        APP
      </span>
      {time && <span className="ml-1 text-[11px] text-[#80848e]">{time}</span>}
    </>
  );
}
