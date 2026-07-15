import { describe, expect, it } from "vitest";
import {
  DAMAGE_CATEGORIES,
  DAMAGE_TYPES,
  ENERGY_DAMAGE_TYPES,
  PHYSICAL_DAMAGE_TYPES,
  isDamageCategory,
  isDamageType,
  isEnergyDamageType,
  isKnownDamageMaterial,
  isPhysicalDamageType,
  type DamageDescriptor,
} from "./damage.js";

describe("damage-type vocabulary", () => {
  it("has 3 physical and 8 energy types, unioned without overlap", () => {
    expect(PHYSICAL_DAMAGE_TYPES).toHaveLength(3);
    expect(ENERGY_DAMAGE_TYPES).toHaveLength(8);
    expect(DAMAGE_TYPES).toHaveLength(11);
    expect(new Set(DAMAGE_TYPES).size).toBe(11);
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
