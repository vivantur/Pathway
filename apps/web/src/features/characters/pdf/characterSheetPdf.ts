import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { CharacterRow } from '../types';
import {
  ABILITY_ORDER,
  SKILL_ABILITY,
  SKILL_ORDER,
  abilityMod,
  acTotal,
  classDC,
  fmtMod,
  maxHp,
  perceptionBonus,
  profLabel,
  saveBonus,
  shieldBonus,
  skillBonus,
  sizeLabel,
  speed,
  weaponDamage,
  type PathbuilderBuild,
} from '../pathbuilder';
import { mergeWeapons } from '../weapons';

// ---- Page + palette (parchment / ink / gold — prints cleanly) ----
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const PARCHMENT = rgb(0.96, 0.93, 0.85);
const INK = rgb(0.16, 0.13, 0.1);
const MUTED = rgb(0.42, 0.38, 0.3);
const GOLD = rgb(0.68, 0.51, 0.19);
const NAVY = rgb(0.11, 0.15, 0.28);
const CREAM = rgb(0.97, 0.95, 0.88);
const LINE = rgb(0.78, 0.71, 0.55);
const BOX = rgb(0.99, 0.97, 0.92);

interface Fonts {
  body: PDFFont;
  bold: PDFFont;
  head: PDFFont;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number; // top-anchored cursor (distance from top handled via helpers)
  fonts: Fonts;
}

/** Build the Pathway character-sheet PDF and return its bytes. */
export async function buildCharacterSheetPdf(
  character: CharacterRow,
  build: PathbuilderBuild,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    body: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    head: await doc.embedFont(StandardFonts.TimesRomanBold),
  };
  const ctx: Ctx = { doc, page: null as unknown as PDFPage, y: 0, fonts };
  newPage(ctx);

  drawTitle(ctx, character, build);
  drawVitals(ctx, character, build);
  drawSaves(ctx, build);
  drawAbilities(ctx, build);
  drawSkills(ctx, build);
  drawStrikes(ctx, character, build);
  drawSpellcasting(ctx, build);
  drawFooterMeta(ctx, build);

  return doc.save();
}

// ---------------------------------------------------------------
// Page + primitive helpers
// ---------------------------------------------------------------

function newPage(ctx: Ctx): void {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: PARCHMENT });
  // Thin gilded frame.
  page.drawRectangle({
    x: MARGIN / 2,
    y: MARGIN / 2,
    width: PAGE_W - MARGIN,
    height: PAGE_H - MARGIN,
    borderColor: LINE,
    borderWidth: 1,
  });
  const pageNum = ctx.doc.getPageCount();
  page.drawText(`Pathway  ·  pathwaypf2e.com`, {
    x: MARGIN,
    y: MARGIN / 2 + 6,
    size: 7,
    font: ctx.fonts.body,
    color: MUTED,
  });
  page.drawText(`${pageNum}`, {
    x: PAGE_W - MARGIN,
    y: MARGIN / 2 + 6,
    size: 7,
    font: ctx.fonts.body,
    color: MUTED,
  });
  ctx.page = page;
  ctx.y = PAGE_H - MARGIN;
}

/** Ensure `needed` vertical points remain; otherwise start a new page. */
function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN + 12) newPage(ctx);
}

function textAt(
  page: PDFPage,
  str: string,
  x: number,
  topY: number,
  size: number,
  font: PDFFont,
  color = INK,
): void {
  page.drawText(str, { x, y: topY - size, size, font, color });
}

function sectionHeader(ctx: Ctx, title: string): void {
  ensure(ctx, 26);
  ctx.y -= 6;
  // Gold underline band.
  ctx.page.drawText(title.toUpperCase(), {
    x: MARGIN,
    y: ctx.y - 11,
    size: 11,
    font: ctx.fonts.head,
    color: NAVY,
  });
  ctx.y -= 15;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 1,
    color: GOLD,
  });
  ctx.y -= 8;
}

function wrapText(str: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = str.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------
// Sections
// ---------------------------------------------------------------

function drawTitle(ctx: Ctx, character: CharacterRow, build: PathbuilderBuild): void {
  const name = character.name || build.name || 'Unnamed Character';
  const bandH = 40;
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - bandH,
    width: CONTENT_W,
    height: bandH,
    color: NAVY,
  });
  textAt(ctx.page, name, MARGIN + 12, ctx.y - 6, 20, ctx.fonts.head, CREAM);

  const level = character.level ?? build.level ?? 1;
  const ancestry = [character.ancestry_name ?? build.ancestry, build.heritage]
    .filter(Boolean)
    .join(' ');
  const parts = [
    `Level ${level}`,
    ancestry,
    character.class_name ?? build.class,
    character.background_name ?? build.background,
  ].filter(Boolean) as string[];
  textAt(ctx.page, parts.join('   ·   '), MARGIN + 12, ctx.y - 28, 9, ctx.fonts.body, rgb(0.85, 0.82, 0.7));
  ctx.y -= bandH + 12;
}

function drawVitals(ctx: Ctx, character: CharacterRow, build: PathbuilderBuild): void {
  const hp = maxHp(build);
  const cur = character.current_hp;
  const shield = shieldBonus(build);
  const ac = acTotal(build);
  const cells: Array<[string, string]> = [
    ['HP', `${cur ?? '—'} / ${hp ?? '—'}`],
    ['AC', `${ac ?? '—'}${shield > 0 ? ` (+${shield})` : ''}`],
    ['Perception', fmtMod(perceptionBonus(build))],
    ['Class DC', `${classDC(build) ?? '—'}`],
    ['Speed', `${speed(build)} ft`],
    ['Size', sizeLabel(build.size) ?? '—'],
  ];
  statRow(ctx, cells);
}

function drawSaves(ctx: Ctx, build: PathbuilderBuild): void {
  statRow(ctx, [
    ['Fortitude', fmtMod(saveBonus(build, 'fortitude'))],
    ['Reflex', fmtMod(saveBonus(build, 'reflex'))],
    ['Will', fmtMod(saveBonus(build, 'will'))],
  ]);
}

/** A row of evenly-spaced labelled stat boxes. */
function statRow(ctx: Ctx, cells: Array<[string, string]>): void {
  const gap = 8;
  const h = 34;
  ensure(ctx, h + 6);
  const w = (CONTENT_W - gap * (cells.length - 1)) / cells.length;
  const top = ctx.y;
  cells.forEach(([label, value], i) => {
    const x = MARGIN + i * (w + gap);
    ctx.page.drawRectangle({
      x,
      y: top - h,
      width: w,
      height: h,
      color: BOX,
      borderColor: LINE,
      borderWidth: 0.75,
    });
    const lw = ctx.fonts.body.widthOfTextAtSize(label.toUpperCase(), 6.5);
    textAt(ctx.page, label.toUpperCase(), x + (w - lw) / 2, top - 6, 6.5, ctx.fonts.body, GOLD);
    const vw = ctx.fonts.bold.widthOfTextAtSize(value, 13);
    textAt(ctx.page, value, x + (w - vw) / 2, top - 15, 13, ctx.fonts.bold, INK);
  });
  ctx.y = top - h - 8;
}

function drawAbilities(ctx: Ctx, build: PathbuilderBuild): void {
  sectionHeader(ctx, 'Ability Scores');
  const labels: Record<string, string> = {
    str: 'STR',
    dex: 'DEX',
    con: 'CON',
    int: 'INT',
    wis: 'WIS',
    cha: 'CHA',
  };
  const cells = ABILITY_ORDER.map((a): [string, string] => {
    const score = build.abilities?.[a];
    const mod = abilityMod(score);
    return [labels[a], `${score ?? '—'}  (${fmtMod(mod)})`];
  });
  statRow(ctx, cells);
}

function drawSkills(ctx: Ctx, build: PathbuilderBuild): void {
  sectionHeader(ctx, 'Skills');
  const rowH = 13;
  const colW = CONTENT_W / 2;
  const rows = SKILL_ORDER.map((s) => {
    const rank = build.proficiencies?.[s] ?? 0;
    const ab = SKILL_ABILITY[s];
    return {
      name: cap(s),
      total: fmtMod(skillBonus(build, s)),
      rank: profLabel(rank),
      ab: ab ? ab.toUpperCase() : '',
    };
  });
  const half = Math.ceil(rows.length / 2);
  ensure(ctx, half * rowH + 6);
  const top = ctx.y;
  rows.forEach((r, i) => {
    const col = i < half ? 0 : 1;
    const rowIdx = i < half ? i : i - half;
    const x = MARGIN + col * colW;
    const ry = top - rowIdx * rowH;
    textAt(ctx.page, `${r.name} (${r.ab})`, x, ry, 8.5, ctx.fonts.body, INK);
    textAt(ctx.page, r.total, x + colW - 96, ry, 8.5, ctx.fonts.bold, INK);
    textAt(ctx.page, r.rank, x + colW - 70, ry, 8, ctx.fonts.body, MUTED);
  });
  ctx.y = top - half * rowH - 6;
}

function drawStrikes(ctx: Ctx, character: CharacterRow, build: PathbuilderBuild): void {
  const weapons = mergeWeapons(build, character.overlay ?? null);
  if (weapons.length === 0) return;
  sectionHeader(ctx, 'Strikes');
  const rowH = 13;
  // header
  ensure(ctx, rowH * 2);
  const top = ctx.y;
  textAt(ctx.page, 'WEAPON', MARGIN, top, 6.5, ctx.fonts.bold, GOLD);
  textAt(ctx.page, 'ATTACK', MARGIN + 260, top, 6.5, ctx.fonts.bold, GOLD);
  textAt(ctx.page, 'DAMAGE', MARGIN + 330, top, 6.5, ctx.fonts.bold, GOLD);
  ctx.y = top - rowH;
  for (const w of weapons) {
    ensure(ctx, rowH);
    const ry = ctx.y;
    textAt(ctx.page, w.display || w.name || 'Weapon', MARGIN, ry, 8.5, ctx.fonts.body, INK);
    textAt(ctx.page, w.attack != null ? fmtMod(w.attack) : '—', MARGIN + 260, ry, 8.5, ctx.fonts.bold, INK);
    textAt(ctx.page, weaponDamage(w), MARGIN + 330, ry, 8.5, ctx.fonts.body, INK);
    ctx.y = ry - rowH;
  }
  ctx.y -= 4;
}

function drawSpellcasting(ctx: Ctx, build: PathbuilderBuild): void {
  const casters = (build.spellCasters ?? []).filter(
    (c) => (c.spells ?? []).some((s) => (s.list ?? []).length > 0),
  );
  if (casters.length === 0) return;
  sectionHeader(ctx, 'Spellcasting');
  for (const c of casters) {
    ensure(ctx, 16);
    textAt(
      ctx.page,
      `${c.name}  ·  ${c.magicTradition}  ·  ${c.spellcastingType}`,
      MARGIN,
      ctx.y,
      9,
      ctx.fonts.bold,
      NAVY,
    );
    ctx.y -= 13;
    const levels = [...(c.spells ?? [])].sort((a, b) => a.spellLevel - b.spellLevel);
    for (const lvl of levels) {
      const list = (lvl.list ?? []).filter(Boolean);
      if (list.length === 0) continue;
      const head = lvl.spellLevel === 0 ? 'Cantrips' : `Rank ${lvl.spellLevel}`;
      const lines = wrapText(list.join(', '), ctx.fonts.body, 8.5, CONTENT_W - 70);
      ensure(ctx, lines.length * 11 + 2);
      textAt(ctx.page, head, MARGIN, ctx.y, 8, ctx.fonts.bold, GOLD);
      lines.forEach((ln, i) => {
        textAt(ctx.page, ln, MARGIN + 62, ctx.y - i * 11, 8.5, ctx.fonts.body, INK);
      });
      ctx.y -= lines.length * 11 + 3;
    }
    ctx.y -= 4;
  }
}

function drawFooterMeta(ctx: Ctx, build: PathbuilderBuild): void {
  const langs = build.languages ?? [];
  if (langs.length === 0) return;
  ensure(ctx, 20);
  sectionHeader(ctx, 'Languages');
  const lines = wrapText(langs.join(', '), ctx.fonts.body, 9, CONTENT_W);
  lines.forEach((ln, i) => textAt(ctx.page, ln, MARGIN, ctx.y - i * 12, 9, ctx.fonts.body, INK));
  ctx.y -= lines.length * 12;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
