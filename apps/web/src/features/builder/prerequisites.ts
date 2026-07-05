import { getDataset, type Feat } from '@/features/builder/data';
import { abilityModifier, chosenFeatIds, computeAbilityScores, skillRankMap } from './rules';
import type { BuilderState } from './types';

/**
 * Best-effort feat prerequisite enforcement.
 *
 * Prerequisite strings are free text, so we only ENFORCE what we can parse with
 * confidence, and never block on what we can't:
 *   - ability requirements    — "Dexterity +2" (modifier at least +2)
 *   - skill proficiency       — "trained/expert/master/legendary in <skill>"
 *   - feat requirements       — the string names another feat in the dataset
 * Anything else (class features, heritages, orders, "at least 100 years old")
 * evaluates to 'unknown' and is allowed — shown as text for the player to judge,
 * exactly as before. Clauses separated by ";" must all hold; " or " within a
 * clause passes if any branch passes (or is unknown).
 */
export type PrereqStatus = 'met' | 'unmet' | 'unknown';

export interface PrereqCheck {
  status: PrereqStatus;
  /** Human-readable requirements that are confidently NOT met. */
  unmet: string[];
}

const RANK_NEEDED: Record<string, number> = { trained: 1, expert: 2, master: 3, legendary: 4 };

const ABILITY_KEYS: Record<string, 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'> = {
  str: 'str', strength: 'str',
  dex: 'dex', dexterity: 'dex',
  con: 'con', constitution: 'con',
  int: 'int', intelligence: 'int',
  wis: 'wis', wisdom: 'wis',
  cha: 'cha', charisma: 'cha',
};

export interface PrereqContext {
  abilityMods: Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>;
  /** skill id (lowercase) → proficiency rank at the character's current level. */
  skillRanks: Record<string, number>;
  /** lowercase skill NAME → skill id. */
  skillIdByName: Map<string, string>;
  /** lowercase feat name → exists in the dataset. */
  featNames: Set<string>;
  /** lowercase names of feats this build has chosen (any level). */
  chosenNames: Set<string>;
}

/** Build the evaluation context once per state (checks against it are cheap). */
export function prereqContext(state: BuilderState): PrereqContext {
  const ds = getDataset();
  const scores = computeAbilityScores(state);
  const abilityMods = {
    str: abilityModifier(scores.str),
    dex: abilityModifier(scores.dex),
    con: abilityModifier(scores.con),
    int: abilityModifier(scores.int),
    wis: abilityModifier(scores.wis),
    cha: abilityModifier(scores.cha),
  };
  const ranks = skillRankMap(state);
  const skillRanks: Record<string, number> = {};
  const skillIdByName = new Map<string, string>();
  for (const s of ds.skills) {
    skillIdByName.set(s.name.toLowerCase(), s.id);
    skillRanks[s.id] = ranks.get(s.id) ?? 0;
  }
  const featNames = new Set(ds.feats.map((f) => f.name.toLowerCase()));
  const chosenNames = new Set<string>();
  for (const id of chosenFeatIds(state)) {
    const f = ds.feats.find((x) => x.id === id);
    if (f) chosenNames.add(f.name.toLowerCase());
  }
  return { abilityMods, skillRanks, skillIdByName, featNames, chosenNames };
}

function evalBranch(branch: string, ctx: PrereqContext): PrereqStatus {
  const c = branch.trim().toLowerCase().replace(/[.,;]+$/, '');
  if (!c) return 'unknown';

  // Ability: "dexterity +2" / "Str 2"
  const ab = c.match(/^([a-z]+)\s*\+?(\d+)$/);
  if (ab && ABILITY_KEYS[ab[1]]) {
    return ctx.abilityMods[ABILITY_KEYS[ab[1]]] >= Number(ab[2]) ? 'met' : 'unmet';
  }

  // Skill proficiency: "trained in athletics"
  const prof = c.match(/^(trained|expert|master|legendary) in (.+)$/);
  if (prof) {
    const skillId = ctx.skillIdByName.get(prof[2].trim());
    if (!skillId) return 'unknown'; // Lore, Perception, weapons, saves — not enforced
    return (ctx.skillRanks[skillId] ?? 0) >= RANK_NEEDED[prof[1]] ? 'met' : 'unmet';
  }

  // Feat requirement: the branch IS a feat name from the dataset.
  if (ctx.featNames.has(c)) {
    return ctx.chosenNames.has(c) ? 'met' : 'unmet';
  }

  return 'unknown';
}

/**
 * Evaluate one branch, distributing a proficiency prefix over bare list items:
 * in "trained in Arcana, Nature, or Religion" the later alternatives arrive as
 * bare skill names — retry them with the list's rank prefix.
 */
function evalBranchWithPrefix(branch: string, prefix: string | null, ctx: PrereqContext): PrereqStatus {
  const direct = evalBranch(branch, ctx);
  if (direct !== 'unknown' || !prefix) return direct;
  return evalBranch(`${prefix} in ${branch}`, ctx);
}

function evalClause(clause: string, ctx: PrereqContext): PrereqStatus {
  const hasOr = /\s+or\s+/i.test(clause);
  if (hasOr) {
    // The whole comma/or list is alternatives: met if any alternative is met,
    // unknown if none met but any is unparseable, unmet only when all fail.
    const alts = clause.split(/\s*,\s*|\s+or\s+/i).filter(Boolean);
    const prefixMatch = alts[0]?.trim().toLowerCase().match(/^(trained|expert|master|legendary) in /);
    const prefix = prefixMatch ? prefixMatch[1] : null;
    let sawUnknown = false;
    for (const a of alts) {
      const r = evalBranchWithPrefix(a, prefix, ctx);
      if (r === 'met') return 'met';
      if (r === 'unknown') sawUnknown = true;
    }
    return sawUnknown ? 'unknown' : 'unmet';
  }
  // No "or": commas separate AND requirements ("Strength +3, expert in
  // Intimidation") — every parseable part must hold.
  const parts = clause.split(/\s*,\s*/).filter(Boolean);
  let sawUnknown = false;
  for (const p of parts) {
    const r = evalBranch(p, ctx);
    if (r === 'unmet') return 'unmet';
    if (r === 'unknown') sawUnknown = true;
  }
  return sawUnknown ? 'unknown' : 'met';
}

/** Check one feat's prerequisites against a prebuilt context. */
export function checkFeat(ctx: PrereqContext, feat: Pick<Feat, 'prerequisites'>): PrereqCheck {
  const text = feat.prerequisites?.trim();
  if (!text) return { status: 'met', unmet: [] };
  const clauses = text.split(';').map((s) => s.trim()).filter(Boolean);
  const unmet: string[] = [];
  let sawUnknown = false;
  for (const clause of clauses) {
    const r = evalClause(clause, ctx);
    if (r === 'unmet') unmet.push(clause);
    else if (r === 'unknown') sawUnknown = true;
  }
  if (unmet.length) return { status: 'unmet', unmet };
  return { status: sawUnknown ? 'unknown' : 'met', unmet: [] };
}

/**
 * Validation problems for every chosen feat whose prerequisites are confidently
 * unmet. Surfaced on the Review step alongside validate()'s problems.
 */
export function prerequisiteProblems(state: BuilderState): string[] {
  const ds = getDataset();
  const ctx = prereqContext(state);
  const problems: string[] = [];
  const check = (featId: string | undefined, where: string) => {
    if (!featId) return;
    const feat = ds.feats.find((f) => f.id === featId);
    if (!feat) return;
    const r = checkFeat(ctx, feat);
    if (r.status === 'unmet') {
      problems.push(`${where}: ${feat.name} requires ${r.unmet.join('; ')}.`);
    }
  };
  check(state.ancestryFeatId, 'Level 1 ancestry feat');
  check(state.classFeatId, 'Level 1 class feat');
  for (const [lvlStr, gains] of Object.entries(state.progression ?? {})) {
    const lvl = Number(lvlStr);
    if (lvl > (state.level || 1)) continue;
    check(gains.classFeatId, `Level ${lvl} class feat`);
    check(gains.ancestryFeatId, `Level ${lvl} ancestry feat`);
    check(gains.skillFeatId, `Level ${lvl} skill feat`);
    check(gains.generalFeatId, `Level ${lvl} general feat`);
    check(gains.archetypeFeatId, `Level ${lvl} archetype feat`);
  }
  return problems;
}
