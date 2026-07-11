# Eidolons — rules source text

Supplied by the project owner (2026-07-11), per the rules-from-source policy.
Source: Secrets of Magic pg. 58 (+ pg. 144 Boost Eidolon).

## Overview

Each eidolon draws on a magical tradition and manifests from related essence.
Arcane eidolons (dragon, construct) form from mental/astral essence; divine
eidolons (angel, demon, psychopomp) from spiritual essence; occult eidolons
(phantoms, tied to an emotion) from spiritual/ectoplasmic essence; primal
eidolons (beast, plant, fey) from life essence.

## Proficiencies

The eidolon's level equals yours. It begins with **expert** proficiency in
Fortitude and Will saves and **trained** proficiency in Reflex saves and
Perception. It is trained in unarmed attacks and unarmored defense. It shares
your skill proficiencies. Certain class features increase its proficiencies.

> Implementation note (packages/core `scaleEidolon`): the eidolon's
> save/Perception/unarmored progression is read from core's `summoner`
> proficiency table, whose base ranks are Fortitude 2, Will 2, Reflex 1,
> Perception 1, unarmored 1 — matching this text exactly. The unarmed-attack
> track is eidolon-specific (trained → expert 5th → master 13th).

## Ability Scores

An eidolon's ability scores depend on the chosen array (e.g. marauding dragon
vs cunning dragon). **The eidolon gets boosts to its ability scores at the same
time you do** (the summoner's ability boosts class feature — i.e. four boosts
at 5th/10th/15th/20th, using the standard +2 / +1-above-18 rule). It also
increases one score by 2 when it gains its **transcendence** ability.

> KNOWN GAP (not yet implemented): `scaleEidolon` uses the static level-1 array
> with no boost progression, so a high-level eidolon's ability-derived stats
> read low. A correct fix requires the eidolon to STORE its four-per-tier boost
> choices (a builder UI + data change, like the PC's `progression.boosts`), plus
> the summoner's transcendence level for the +2. Left for a dedicated pass.

## Unarmed Attacks

The eidolon starts with two unarmed attacks (form/damage type chosen by the
player). **Primary** (choose one): 1d8 (disarm, nonlethal, shove, or trip);
1d6 (fatal d10); 1d6 (forceful and sweep); 1d6 (deadly d8 and finesse).
**Secondary**: always 1d6 with agile and finesse.

## Eidolon Array

Each array sets ability scores AND the defensive form: an item bonus to AC and
a Dexterity cap. (E.g. a demon can be a wrecker — higher Str, higher AC item
bonus — or a tempter — higher Cha, higher Dex cap.)

## Gear

An eidolon can't wear/use magic items except items with the eidolon trait (max
two invested). Via its link to you it benefits from your invested items: item
bonuses to Perception and skills from your invested magic items; item bonus to
AC from your armor's potency rune / bracers of armor; item bonus to saves from
your resilient rune / bracers; and its Strikes benefit from your handwraps of
mighty blows (or one Invested magic weapon you hold).

## Eidolon Spells

An eidolon normally can't Cast a Spell; feats/abilities can grant it. It uses
YOUR spell DC and spell attack modifier, shares your focus pool for eidolon
link spells (but can't Refocus), and can cast only spells from its own
abilities.

## Boost Eidolon (cantrip, Secrets of Magic pg. 144)

One action, verbal; range 100 feet; targets your eidolon; duration 1 round.
Your eidolon gains a +2 status bonus to damage rolls with its unarmed attacks.
If its Strikes deal more than one weapon damage die, the bonus increases to +2
per weapon damage die, to a maximum of +8 with four dice. (Combat buff, not
stat scaling — belongs in spell/combat handling, not `scaleEidolon`.)
