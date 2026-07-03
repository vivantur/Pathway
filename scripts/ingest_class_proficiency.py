#!/usr/bin/env python3
"""Ingest per-class proficiency advancement from the Foundry VTT `pf2e` system.

The web builder's dataset originally stored only each class's *level-1*
proficiencies, so derived numbers (saves, Perception, class DC, weapon/armor
proficiency, spell attack & DC) were frozen for all 20 levels. This script reads
each class's granted class-feature items from a local clone of foundryvtt/pf2e,
parses the proficiency increases stated in each feature's description ("Your
proficiency rank for X increases to expert/master/legendary"), and merges a
`proficiencyIncreases: [{level, target, rank}]` array into the builder's
`classes.json`. The engine in @pathway/core then advances proficiency by level.

Provenance/mechanics only — descriptions and flavor are not copied, only the
(level, stat, rank) tuples.

Usage:
    git clone --depth 1 https://github.com/foundryvtt/pf2e.git
    python3 scripts/ingest_class_proficiency.py \
        --foundry ./pf2e/packs/pf2e \
        --classes apps/web/src/features/builder/data/classes.json

Notes / known gaps:
  * Cleric spell-proficiency advancement is gated behind its Doctrine (a
    subclass choice) rather than a class-level feature, so it is not emitted
    here and cleric spell DC stays trained. Other classes are class-level.
  * "Weapon Specialization" features grant flat damage, not proficiency, and are
    correctly ignored.
"""
import argparse
import glob
import html
import json
import os
import re

RANK = {'trained': 1, 'expert': 2, 'master': 3, 'legendary': 4}

# Spellcasting proficiency is pinned by feature slug in the Foundry data.
SPELLCASTER_RANK = {
    'Expert Spellcaster': 2, 'Master Spellcaster': 3, 'Legendary Spellcaster': 4,
    'Expert Spellcasting': 2, 'Master Spellcasting': 3, 'Legendary Spellcasting': 4,
}

TO_RANK = re.compile(r'\bto (trained|expert|master|legendary)\b', re.I)


def strip_tags(s):
    return re.sub(r'<[^>]+>', ' ', s)


def paragraphs(descr):
    parts = re.findall(r'<p>(.*?)</p>', descr, flags=re.S) or [descr]
    out = []
    for p in parts:
        m = re.match(r'\s*<strong>(.*?)</strong>', p, flags=re.S)
        header = strip_tags(m.group(1)).strip() if m else None
        out.append((header, html.unescape(strip_tags(p))))
    return out


def target_occurrences(span):
    """(position, target) for every proficiency target named in a text span."""
    occ = []

    def find(pat, tgt):
        for m in re.finditer(pat, span):
            occ.append((m.start(), tgt))

    find(r'\bclass dc\b', 'classDC')
    find(r'\bperception\b', 'perception')
    find(r'\breflex\b', 'reflex')
    find(r'\bfortitude\b', 'fortitude')
    if 'save' in span:
        find(r'\bwill\b', 'will')
    if 'spell' in span and ('attack' in span or 'dc' in span or 'spellcast' in span):
        m = re.search(r'\bspell', span)
        if m:
            occ.append((m.start(), 'spell'))
    if 'armor' in span or 'defense' in span:
        find(r'\bunarmored\b', 'defenses.unarmored')
        find(r'\blight\b', 'defenses.light')
        find(r'\bmedium\b', 'defenses.medium')
        find(r'\bheavy\b', 'defenses.heavy')
    if 'weapon' in span or re.search(r'\bunarmed\b', span):
        find(r'\bsimple\b', 'attacks.simple')
        find(r'\bmartial\b', 'attacks.martial')
        find(r'\badvanced\b', 'attacks.advanced')
        find(r'\bunarmed\b', 'attacks.unarmed')
    return occ


def parse_increases(descr, class_name, all_class_names):
    """Yield (target, rank). Each target is attributed to the nearest rank
    marker in its own direction, so both "ranks for A increase to master" and
    "rank increases to master with A" parse, including two-rank sentences."""
    for header, text in paragraphs(descr):
        if header and class_name and header.lower() in all_class_names \
                and header.lower() != class_name.lower():
            continue  # a class-specific paragraph for a *different* class
        for sentence in re.split(r'(?<=[.;])\s+', text):
            low = sentence.lower()
            if 'proficiency' not in low or 'increase' not in low:
                continue
            marks = [(RANK[m.group(1).lower()], m.start()) for m in TO_RANK.finditer(low)]
            occ = target_occurrences(low)
            if not marks or not occ:
                continue
            follow = min(p for p, _ in occ) > marks[0][1]
            for pos, tgt in occ:
                if follow:
                    cands = [m for m in marks if m[1] <= pos] or marks
                    rank = max(cands, key=lambda m: m[1])[0]
                else:
                    cands = [m for m in marks if m[1] >= pos] or marks
                    rank = min(cands, key=lambda m: m[1])[0]
                yield (tgt, rank)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--foundry', required=True, help='path to foundry pf2e packs/pf2e dir')
    ap.add_argument('--classes', required=True, help='path to builder classes.json to enrich')
    ap.add_argument('--dry-run', action='store_true', help='print, do not write')
    args = ap.parse_args()

    features_dir = os.path.join(args.foundry, 'class-features')
    classes_dir = os.path.join(args.foundry, 'classes')

    feat_by_name = {}
    for f in glob.glob(os.path.join(features_dir, '*.json')):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        if isinstance(d, dict) and d.get('type') == 'feat':
            feat_by_name[d.get('name')] = d

    foundry_classes = {}
    all_class_names = set()
    for f in glob.glob(os.path.join(classes_dir, '*.json')):
        d = json.load(open(f))
        slug = d['system'].get('slug') or d['name'].lower()
        foundry_classes[slug] = d
        all_class_names.add(d['name'].lower())

    web_classes = json.load(open(args.classes))
    web_ids = {c['id'] for c in web_classes}

    increases = {}
    for slug, d in foundry_classes.items():
        if slug not in web_ids:
            continue
        sysd, name = d['system'], d['name']
        incs = []
        if (sysd.get('spellcasting') or 0) >= 1:
            incs.append({'level': 1, 'target': 'spell', 'rank': 1})
        for it in sysd.get('items', {}).values():
            lvl, fname = it.get('level'), it.get('name')
            if fname in SPELLCASTER_RANK:
                incs.append({'level': lvl, 'target': 'spell', 'rank': SPELLCASTER_RANK[fname]})
                continue
            feat = feat_by_name.get(fname)
            if not feat:
                continue
            descr = feat['system'].get('description', {}).get('value', '') or ''
            for tgt, rank in parse_increases(descr, name, all_class_names):
                incs.append({'level': lvl, 'target': tgt, 'rank': rank})
        # dedupe: highest rank per (level, target)
        best = {}
        for i in incs:
            k = (i['level'], i['target'])
            if k not in best or i['rank'] > best[k]['rank']:
                best[k] = i
        increases[slug] = sorted(best.values(), key=lambda x: (x['level'], x['target']))

    for c in web_classes:
        if c['id'] in increases:
            c['proficiencyIncreases'] = increases[c['id']]

    total = sum(len(v) for v in increases.values())
    print(f'enriched {len(increases)}/{len(web_classes)} classes with {total} increases')
    if args.dry_run:
        print(json.dumps(increases, indent=1))
        return
    json.dump(web_classes, open(args.classes, 'w'), indent=2, ensure_ascii=False)
    open(args.classes, 'a').write('\n')
    print(f'wrote {args.classes}')


if __name__ == '__main__':
    main()
