const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// These are the Foundry PF2e compendium spell pack URLs from GitHub
const SPELL_PACK_URLS = [
  'https://raw.githubusercontent.com/foundryvtt/pf2e/master/packs/spells.db',
];

// ── Parse a Foundry .db file (newline-delimited JSON) ────────────────
function parseFoundryDb(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

// ── Convert a Foundry spell entry to our format ──────────────────────
function convertSpell(raw) {
  const sys = raw.system ?? raw.data ?? {};
  const desc = sys.description?.value ?? '';

  // Traditions
  const traditions = Object.entries(sys.traditions ?? {})
    .filter(([, v]) => v === true)
    .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));

  // Traits
  const traits = Object.keys(sys.traits?.value ? 
    sys.traits.value.reduce((a, t) => ({ ...a, [t]: true }), {}) : 
    (sys.traits ?? {}))
    .filter(t => typeof t === 'string');

  // Saving throw
  const savingThrow = sys.save?.statistic ?? sys.defense?.save?.statistic ?? null;

  // Attack
  const isAttack = sys.spellType?.value === 'attack' || sys.defense?.passive !== undefined;

  // Damage
  let damage = null;
  if (sys.damage && Object.keys(sys.damage).length > 0) {
    const dmgEntries = Object.values(sys.damage);
    if (dmgEntries.length > 0) {
      damage = dmgEntries.map(d => `${d.formula ?? d.value ?? ''} ${d.type?.value ?? d.type ?? ''}`.trim()).join(', ');
    }
  }

  // Heightened
  let heightened = null;
  if (sys.heightening) {
    if (sys.heightening.type === 'fixed') {
      heightened = {};
      Object.entries(sys.heightening.levels ?? {}).forEach(([lvl, data]) => {
        const dmg = Object.values(data.damage ?? {}).map(d => `${d.formula ?? ''} ${d.type?.value ?? ''}`.trim()).join(', ');
        if (dmg) heightened[`+${lvl}`] = dmg;
      });
    } else if (sys.heightening.type === 'interval') {
      const dmg = Object.values(sys.heightening.damage ?? {}).map(d => `${d.formula ?? ''} ${d.type?.value ?? ''}`.trim()).join(', ');
      if (dmg) heightened = { [`Every ${sys.heightening.interval} levels`]: dmg };
    }
  }

  return {
    name: raw.name,
    level: sys.level?.value ?? sys.level ?? 1,
    school: sys.school?.value ?? sys.school ?? null,
    traditions,
    traits,
    cast: sys.time?.value ?? sys.casting?.time ?? null,
    range: sys.range?.value ?? null,
    area: sys.area ? `${sys.area.value ?? ''} ${sys.area.type ?? ''}`.trim() : null,
    targets: sys.targets?.value ?? null,
    duration: sys.duration?.value ?? null,
    savingThrow,
    attack: isAttack,
    damage,
    heightened,
    description: desc,
    source: 'foundry',
    custom: false
  };
}

async function main() {
  console.log('Downloading Foundry PF2e spell data...');

  let allSpells = [];

  for (const url of SPELL_PACK_URLS) {
    try {
      console.log('Fetching:', url);
      const res = await fetch(url);
      const text = await res.text();
      const entries = parseFoundryDb(text);
      console.log(`Parsed ${entries.length} entries`);

      const spells = entries
        .filter(e => e.type === 'spell')
        .map(convertSpell)
        .filter(s => s.name && s.level !== undefined);

      console.log(`Converted ${spells.length} spells`);
      allSpells = allSpells.concat(spells);
    } catch (err) {
      console.error('Failed to fetch:', url, err.message);
    }
  }

  // Remove duplicates by name
  const seen = new Set();
  allSpells = allSpells.filter(s => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort alphabetically
  allSpells.sort((a, b) => a.name.localeCompare(b.name));

  // covertspells.js lives in systems/; the repo's spells.json source lives in
  // gamedata/ (not data/ — that name collides with Railway's volume mount).
  // After running this script, commit the updated gamedata/spells.json. To
  // push the new content to a running bot, set FORCE_RESEED_SPELLS=1 on
  // Railway and redeploy; the seeder will overwrite the volume copy and
  // preserve any homebrew entries.
  const SPELLS_PATH = path.join(__dirname, '..', 'gamedata', 'spells.json');

  // Load any existing custom spells and preserve them
  let customSpells = [];
  if (fs.existsSync(SPELLS_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(SPELLS_PATH, 'utf8'));
      customSpells = existing.filter(s => s.custom === true);
      if (customSpells.length > 0) {
        console.log(`Preserving ${customSpells.length} custom spells`);
      }
    } catch {
      console.log('No existing spells.json found, starting fresh');
    }
  }

  // Merge — custom spells take priority over foundry ones with same name
  const customNames = new Set(customSpells.map(s => s.name.toLowerCase()));
  const foundryFiltered = allSpells.filter(s => !customNames.has(s.name.toLowerCase()));
  const finalSpells = [...foundryFiltered, ...customSpells]
    .sort((a, b) => a.name.localeCompare(b.name));

  fs.writeFileSync(SPELLS_PATH, JSON.stringify(finalSpells, null, 2), 'utf8');
  console.log(`\nDone! Saved ${finalSpells.length} spells to spells.json`);
  console.log(`  - ${foundryFiltered.length} from Foundry PF2e`);
  console.log(`  - ${customSpells.length} custom spells`);
}

main();