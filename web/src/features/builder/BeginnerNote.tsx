import { useApp } from '@/features/builder/appStore';
import type { StepId } from './types';

/** Plain-language guidance shown per step when Beginner Mode is on. */
const HELP: Record<StepId, { title: string; body: string }> = {
  ancestry: {
    title: 'What is an ancestry?',
    body: 'Your ancestry is your character’s people — like human, elf, or dwarf. It decides your starting Hit Points (how tough you are), how fast you move, your size, and gives you a couple of ability boosts. After picking an ancestry you’ll pick a heritage, a specific lineage within that people.',
  },
  heritage: {
    title: 'What is a heritage?',
    body: 'A heritage is your specific lineage within your ancestry — for example, a Rock Dwarf or a Cavern Elf. It grants a small extra ability. You can also choose a Versatile Heritage (like Nephilim or Dhampir) instead, which any ancestry can take. Pick whichever fits your character’s story.',
  },
  background: {
    title: 'What is a background?',
    body: 'Your background is what you did before adventuring — a soldier, an acolyte, a criminal. It trains you in a skill and a bit of specialized “Lore,” gives you two ability boosts, and a handy skill feat. Pick whatever fits the story you imagine.',
  },
  class: {
    title: 'What is a class?',
    body: 'Your class is your adventuring profession — fighter, wizard, cleric, and so on. It’s the biggest choice: it sets your key ability, your Hit Points, what you’re good at, and your special abilities. Some classes also ask you to pick a sub-choice (like a wizard’s thesis).',
  },
  abilities: {
    title: 'What are ability boosts?',
    body: 'Everyone starts with 10 in each of the six abilities (Strength, Dexterity, and so on). A “boost” raises one by 2. You get boosts from your ancestry, background, class, and four “free” boosts you assign however you like. Higher is better — put boosts into what your class cares about most.',
  },
  skills: {
    title: 'What does training a skill do?',
    body: 'Being “trained” in a skill makes you noticeably better at it. Your class and background train some for free; you get to choose the rest. Smart characters (high Intelligence) get to train extra skills. The number on the right shows your total bonus.',
  },
  feats: {
    title: 'What are feats?',
    body: 'Feats are special abilities you pick to customize your character. At level 1 you choose one ancestry feat and one class feat, and your background hands you a skill feat automatically. There’s no wrong answer — pick what sounds fun.',
  },
  advancement: {
    title: 'How does leveling work?',
    body: 'Characters grow over many game sessions. You don’t have to fill in all 20 levels now — pick the level you’re playing, make that level’s choices, and save. Later, when your character earns a level in your game, come back and press “Level Up” to add just the new level. Each level hands you specific things (a class feat, a skill increase, and so on), shown as its own card.',
  },
  equipment: {
    title: 'How does gear work?',
    body: 'Buy items from the shop to spend your gold, then press “Equip” on armor, a shield, or a weapon to use it. Equipped armor changes your AC (and heavy armor can slow you if you’re not strong enough); equipped weapons show their attack bonus and damage on the right. New level-1 characters start with 15 gp.',
  },
  spells: {
    title: 'How do spells work?',
    body: 'If your class casts spells, pick your cantrips (at-will spells you can cast any number of times) and your leveled spells. Prepared casters (wizards, clerics) choose spells to have ready; spontaneous casters (bards, sorcerers) build a repertoire they cast freely. Your Spell attack and Spell DC — how hard your spells are to resist — show up top. Not a caster? Just skip this step.',
  },
  review: {
    title: 'You’re almost done!',
    body: 'This page checks your character is complete and lets you save it or export it. “Download JSON” gives you a file your Pathway Discord bot can read. Anything still missing is listed in red so you know what to finish.',
  },
};

export function BeginnerNote({ step }: { step: StepId }) {
  const beginner = useApp((s) => s.beginner);
  if (!beginner) return null;
  const help = HELP[step];
  return (
    <div className="mb-5 flex gap-3 rounded-xl border border-arcane-400/30 bg-arcane-500/10 p-4">
      <span className="mt-0.5 text-lg" aria-hidden>
        💡
      </span>
      <div>
        <div className="font-display text-arcane-400">{help.title}</div>
        <p className="mt-1 font-ui text-sm leading-relaxed text-parchment/80">{help.body}</p>
      </div>
    </div>
  );
}
