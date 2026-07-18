import type { ReactNode } from 'react';
import {
  ABILITY_KEYS,
  ABILITY_NAMES,
  findAncestry,
  findBackground,
  findClass,
  findFeat,
  findHeritage,
  findItem,
  findSkill,
  findSpell,
} from '@/features/builder/data';
import { backgroundLoreSubject, deriveCharacter, formatSenseLabel, loreDisplayName } from './rules';
import { casterConfig, spellStats } from './spellcasting';
import { grantedFocusSpell } from './subclassEffects';
import type { BuilderState } from './types';

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel p-5">
      <h4 className="mb-3 font-display text-lg text-gold-400">{title}</h4>
      {children}
    </section>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-gold-500/25 bg-midnight-700/50 px-2 py-0.5 font-ui text-xs text-parchment/80">
      {children}
    </span>
  );
}

/** A read-only, at-a-glance summary of every choice on the build. */
export function CharacterOverview({ state }: { state: BuilderState }) {
  const d = deriveCharacter(state);
  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  const heritage = findHeritage(state.ancestryId, state.heritageId);
  const background = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  const klass = state.classId ? findClass(state.classId) : undefined;
  const subclass = klass?.subclasses?.find((s) => s.id === state.subclassId);

  // Feats across every level.
  const feats: { level: number; type: string; name: string }[] = [];
  const pushFeat = (id: string | undefined, type: string, level: number) => {
    const f = id ? findFeat(id) : undefined;
    if (f) feats.push({ level, type, name: f.name });
  };
  pushFeat(state.ancestryFeatId, 'Ancestry', 1);
  pushFeat(state.classFeatId, 'Class', 1);
  if (background?.skillFeat) pushFeat(background.skillFeat, 'Skill', 1);
  for (const [lvlStr, g] of Object.entries(state.progression)) {
    const lvl = Number(lvlStr);
    pushFeat(g.classFeatId, 'Class', lvl);
    pushFeat(g.ancestryFeatId, 'Ancestry', lvl);
    pushFeat(g.skillFeatId, 'Skill', lvl);
    pushFeat(g.generalFeatId, 'General', lvl);
    pushFeat(g.archetypeFeatId, 'Archetype', lvl);
  }
  feats.sort((a, b) => a.level - b.level || a.type.localeCompare(b.type));

  const trained = d.skills.filter((s) => s.rank > 0);
  const languages = [...(ancestry?.languages ?? []), ...state.languageChoices];
  const inventory = state.inventory
    .map((e) => ({ item: findItem(e.itemId), qty: e.qty, equipped: e.equipped }))
    .filter((x) => x.item);

  const cfg = casterConfig(state.classId, state.subclassId);
  const spells = spellStats(state);
  const cantrips = state.spellcasting.cantrips.map((id) => findSpell(id)?.name).filter(Boolean);
  const spellRanks = Object.entries(state.spellcasting.spellsByRank)
    .map(([r, ids]) => ({ rank: Number(r), names: ids.map((id) => findSpell(id)?.name).filter(Boolean) }))
    .filter((g) => g.names.length)
    .sort((a, b) => a.rank - b.rank);

  return (
    <div className="flex flex-col gap-4">
      <Section title="Identity">
        <div className="flex items-center gap-3">
          {state.portrait && (
            <img src={state.portrait} alt="" className="h-16 w-16 rounded-full border border-gold-500/40 object-cover" />
          )}
          <div>
            <div className="font-display text-xl text-parchment">{state.name || 'Unnamed Adventurer'}</div>
            <div className="font-ui text-sm text-parchment/70">
              Level {state.level} {[heritage?.name, ancestry?.name].filter(Boolean).join(' ')}{' '}
              {klass?.name}
              {subclass ? ` (${subclass.name})` : ''}
              {background ? ` · ${background.name}` : ''}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Gained for Free">
        <div className="flex flex-col gap-2 font-ui text-sm text-parchment/85">
          {klass?.features?.length ? (
            <div>
              <span className="text-gold-400">{klass.name} features:</span> {klass.features.join(', ')}
            </div>
          ) : null}
          {ancestry && (
            <div>
              <span className="text-gold-400">{ancestry.name}:</span> {ancestry.hp} HP · {ancestry.size}{' '}
              · {ancestry.speed} ft Speed
              {ancestry.traits?.length ? ` · ${ancestry.traits.join(', ')}` : ''}
            </div>
          )}
          {heritage && (
            <div>
              <span className="text-gold-400">{heritage.name}:</span> {heritage.description}
            </div>
          )}
          {background && (
            <div>
              <span className="text-gold-400">{background.name}:</span> trained in{' '}
              {findSkill(background.trainedSkill)?.name ?? background.trainedSkill} and{' '}
              {(() => {
                const lore = backgroundLoreSubject(state);
                return lore ? loreDisplayName(lore) : 'a Lore of your choice';
              })()}
              {background.skillFeat ? `; ${findFeat(background.skillFeat)?.name ?? ''} feat` : ''}
            </div>
          )}
          {!klass && !ancestry && (
            <p className="text-parchment/50">Choose an ancestry and class to see their grants.</p>
          )}
        </div>
      </Section>

      <Section title="Abilities">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ABILITY_KEYS.map((k) => (
            <div key={k} className="rounded-lg border border-gold-500/20 bg-midnight-800/50 py-2 text-center" title={ABILITY_NAMES[k]}>
              <div className="font-ui text-[10px] uppercase tracking-widest text-parchment/60">{k}</div>
              <div className="font-display text-lg text-parchment">{d.scores[k]}</div>
              <div className="font-ui text-xs text-gold-400">{sign(d.mods[k])}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Defenses & Vitals">
        <div className="flex flex-wrap gap-2 font-ui text-sm text-parchment/85">
          <Chip>HP {d.maxHp}</Chip>
          <Chip>AC {d.shieldBonus ? `${d.ac}/${d.ac + d.shieldBonus}` : d.ac}</Chip>
          <Chip>Perception {sign(d.perception)}</Chip>
          <Chip>Fort {sign(d.saves.fortitude)}</Chip>
          <Chip>Reflex {sign(d.saves.reflex)}</Chip>
          <Chip>Will {sign(d.saves.will)}</Chip>
          <Chip>Class DC {d.classDc}</Chip>
          <Chip>Speed {d.speed} ft</Chip>
          {d.focusPoints > 0 && <Chip>Focus {d.focusPoints}</Chip>}
        </div>
        {state.level > 1 && (
          <p className="mt-2 font-ui text-xs text-parchment/50">
            Weapon attack bonuses use your level-1 weapon proficiency; class-based
            weapon-mastery increases (which depend on your chosen weapon group)
            aren&apos;t modeled, so strikes can read low at high levels.
          </p>
        )}
      </Section>

      {(d.senses.length > 0 || d.resistances.length > 0) && (
        <Section title="Senses & Resistances">
          <div className="flex flex-col gap-3">
            {d.senses.length > 0 && (
              <div>
                <div className="mb-1 font-ui text-xs uppercase tracking-wider text-parchment/50">Senses</div>
                <div className="flex flex-wrap gap-1.5">
                  {d.senses.map((s) => (
                    <Chip key={s.type}>{formatSenseLabel(s)}</Chip>
                  ))}
                </div>
              </div>
            )}
            {d.resistances.length > 0 && (
              <div>
                <div className="mb-1 font-ui text-xs uppercase tracking-wider text-parchment/50">Resistances</div>
                <div className="flex flex-wrap gap-1.5">
                  {d.resistances.map((r) => (
                    <Chip key={r.type}>
                      {r.type[0].toUpperCase() + r.type.slice(1)} {r.value}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {trained.length > 0 && (
        <Section title={`Trained Skills (${trained.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {trained.map((s) => (
              <Chip key={s.id}>
                {s.name} {sign(s.modifier)}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      {feats.length > 0 && (
        <Section title={`Feats (${feats.length})`}>
          <div className="flex flex-col gap-1">
            {feats.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 font-ui text-sm">
                <span className="text-parchment">{f.name}</span>
                <span className="font-ui text-[10px] uppercase tracking-wider text-parchment/50">
                  {f.type} · Lv {f.level}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {d.effectNotes.length > 0 && (
        <Section title={`Feat Effects (${d.effectNotes.length})`}>
          <div className="flex flex-col gap-1">
            {d.effectNotes.map((n, i) => (
              <div
                key={`${n.source}-${n.stat}-${i}`}
                className="flex items-baseline justify-between gap-2 font-ui text-sm"
              >
                <span className="text-parchment">{n.source}</span>
                <span className="text-gold-400/90">{n.summary}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {d.situational.length > 0 && (
        <Section title={`Situational (${d.situational.length})`}>
          {/* NOT included in the totals above — these apply only in their listed
              situation, so the player applies them at the table. */}
          <div className="flex flex-col gap-1">
            {d.situational.map((c, i) => (
              <div
                key={`${c.source}-${c.stat}-${i}`}
                className="flex items-baseline justify-between gap-2 font-ui text-sm"
              >
                <span className="text-parchment">{c.source}</span>
                <span className="text-gold-400/90">
                  {c.summary} <span className="text-parchment/60">{c.condition}</span>
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {cfg && (
        <Section title="Spells">
          <div className="mb-2 flex flex-wrap gap-2">
            <Chip>
              {cfg.type} {cfg.tradition}
            </Chip>
            {spells && <Chip>Spell attack {sign(spells.attack)}</Chip>}
            {spells && <Chip>Spell DC {spells.dc}</Chip>}
          </div>
          {grantedFocusSpell(state.classId, state.subclassId) && (
            <p className="font-ui text-sm text-parchment/80">
              <span className="text-gold-400">Focus spell:</span>{' '}
              {grantedFocusSpell(state.classId, state.subclassId)}
            </p>
          )}
          {cantrips.length > 0 && (
            <p className="font-ui text-sm text-parchment/80">
              <span className="text-gold-400">Cantrips:</span> {cantrips.join(', ')}
            </p>
          )}
          {spellRanks.map((g) => (
            <p key={g.rank} className="font-ui text-sm text-parchment/80">
              <span className="text-gold-400">Rank {g.rank}:</span> {g.names.join(', ')}
            </p>
          ))}
          {cantrips.length === 0 && spellRanks.length === 0 && (
            <p className="font-ui text-sm text-parchment/50">No spells selected yet.</p>
          )}
        </Section>
      )}

      {languages.length > 0 && (
        <Section title="Languages">
          <div className="flex flex-wrap gap-1.5">
            {languages.map((l) => (
              <Chip key={l}>{l}</Chip>
            ))}
          </div>
        </Section>
      )}

      <Section title="Equipment">
        <div className="mb-2 font-ui text-sm text-parchment/70">Gold: {state.money} gp</div>
        {inventory.length ? (
          <div className="flex flex-col gap-1">
            {inventory.map((x) => (
              <div key={x.item!.id} className="flex items-center justify-between gap-2 font-ui text-sm">
                <span className="text-parchment">
                  {x.item!.name}
                  {x.qty > 1 ? ` ×${x.qty}` : ''}
                </span>
                {x.equipped && <span className="font-ui text-[10px] uppercase tracking-wider text-gold-400">Equipped</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="font-ui text-sm text-parchment/50">No items.</p>
        )}
      </Section>
    </div>
  );
}
