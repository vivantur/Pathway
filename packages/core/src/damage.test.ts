import { describe, expect, it } from "vitest";
import {
  DAMAGE_CATEGORIES,
  DAMAGE_TYPES,
  ENERGY_DAMAGE_TYPES,
  OTHER_DAMAGE_TYPES,
  PHYSICAL_DAMAGE_TYPES,
  isDamageCategory,
  isDamageType,
  isEnergyDamageType,
  isKnownDamageMaterial,
  isPhysicalDamageType,
  type DamageDescriptor,
} from "./damage.js";

describe("damage-type vocabulary", () => {
  it("has 3 physical, 8 energy and 1 other type, unioned without overlap", () => {
    expect(PHYSICAL_DAMAGE_TYPES).toHaveLength(3);
    expect(ENERGY_DAMAGE_TYPES).toHaveLength(8);
    expect(OTHER_DAMAGE_TYPES).toHaveLength(1);
    expect(DAMAGE_TYPES).toHaveLength(12);
    expect(new Set(DAMAGE_TYPES).size).toBe(12);
  });

  it("recognises bleed as a damage type, but not as physical or energy", () => {
    // Bleed exists so a resistance/weakness or a crit specialization can NAME it
    // (owner ruling, 2026-07-19). Classing it physical would silently let anything
    // resisting physical damage shrug it off.
    expect(isDamageType("bleed")).toBe(true);
    expect(isPhysicalDamageType("bleed")).toBe(false);
    expect(isEnergyDamageType("bleed")).toBe(false);
  });

  it("keeps `persistent` a CATEGORY, so persistent bleed is the pair", () => {
    // Most bleed is persistent, but the two are orthogonal — collapsing them
    // would make non-persistent bleed inexpressible.
    const persistentBleed: DamageDescriptor = { type: "bleed", categories: ["persistent"] };
    expect(persistentBleed.type).toBe("bleed");
    expect(persistentBleed.categories).toEqual(["persistent"]);
    expect(isDamageType("persistent")).toBe(false);
  });

  it("classifies physical vs energy correctly", () => {
    expect(isPhysicalDamageType("slashing")).toBe(true);
    expect(isPhysicalDamageType("fire")).toBe(false);
    expect(isEnergyDamageType("void")).toBe(true);
    expect(isEnergyDamageType("piercing")).toBe(false);
    expect(isDamageType("acid")).toBe(true);
    expect(isDamageType("radiant")).toBe(false); // 5e type, not PF2e
  });

  it("recognizes known materials and categories", () => {
    expect(isKnownDamageMaterial("silver")).toBe(true);
    expect(isKnownDamageMaterial("cold-iron")).toBe(true);
    expect(isKnownDamageMaterial("plutonium")).toBe(false);
    for (const c of DAMAGE_CATEGORIES) expect(isDamageCategory(c)).toBe(true);
    expect(isDamageCategory("magical")).toBe(false);
  });

  it("allows a descriptor to carry a material, categories, and a cosmetic label", () => {
    const d: DamageDescriptor = {
      type: "slashing",
      material: "silver",
      categories: ["persistent"],
      label: "decomposition",
    };
    expect(d.type).toBe("slashing");
    // An unknown material string is representable (extensible), just not "known".
    const homebrew: DamageDescriptor = { type: "fire", material: "phlogiston" };
    expect(isKnownDamageMaterial(homebrew.material)).toBe(false);
  });
});
