import { describe, expect, it } from "vitest";
import {
  availableVariants,
  toggleAvailable,
  toggleDeclarationSchema,
  toggleTags,
  type ToggleDeclaration,
} from "./toggles.js";

describe("toggleTags", () => {
  it("asserts nothing for a toggle the player has not flipped", () => {
    const decls: ToggleDeclaration[] = [{ option: "reveal-beasts" }];
    expect(toggleTags(decls, {})).toEqual([]);
    expect(toggleTags(decls, undefined)).toEqual([]);
  });

  it("asserts the bare tag for a plain toggle switched on", () => {
    expect(toggleTags([{ option: "reveal-beasts" }], { "reveal-beasts": true })).toEqual(["reveal-beasts"]);
  });

  it("treats false as off", () => {
    expect(toggleTags([{ option: "reveal-beasts" }], { "reveal-beasts": false })).toEqual([]);
  });

  it("asserts BOTH the base and the variant tag when a variant is picked", () => {
    // The corpus consumes both forms: some effects predicate on `deflecting-wave`,
    // others on `deflecting-wave:acid`. Emitting only one would miss half.
    const decl: ToggleDeclaration = {
      option: "deflecting-wave",
      variants: [{ value: "acid" }, { value: "fire" }],
    };
    expect(toggleTags([decl], { "deflecting-wave": "acid" }).sort()).toEqual([
      "deflecting-wave",
      "deflecting-wave:acid",
    ]);
  });

  it("ignores a stored variant the declaration no longer offers", () => {
    // Stored state outlives content; a dropped variant must not crash or emit a tag
    // nothing can consume. The base tag still fires — the toggle IS on.
    const decl: ToggleDeclaration = { option: "deflecting-wave", variants: [{ value: "acid" }] };
    expect(toggleTags([decl], { "deflecting-wave": "cold" })).toEqual(["deflecting-wave"]);
  });

  it("asserts an alwaysOn tag with no player state at all", () => {
    expect(toggleTags([{ option: "ageless-spirit", alwaysOn: true }], {})).toEqual(["ageless-spirit"]);
  });

  it("unions across several declarations without duplicating a shared base", () => {
    const decls: ToggleDeclaration[] = [
      { option: "spellshape", variants: [{ value: "reach-spell" }] },
      { option: "spellshape", variants: [{ value: "widen-spell" }] },
    ];
    const tags = toggleTags(decls, { spellshape: "reach-spell" }).sort();
    expect(tags).toEqual(["spellshape", "spellshape:reach-spell"]);
  });
});

describe("availability", () => {
  it("offers an unconditional toggle regardless of tags", () => {
    expect(toggleAvailable({ option: "x" }, new Set())).toBe(true);
  });

  it("gates a toggle on its `when`", () => {
    const decl: ToggleDeclaration = { option: "x", when: { tag: "self:trait:elf" } };
    expect(toggleAvailable(decl, new Set())).toBe(false);
    expect(toggleAvailable(decl, new Set(["self:trait:elf"]))).toBe(true);
  });

  it("filters variants by their own `when`", () => {
    // Crystal Healing's +3 needs more training than its +1.
    const decl: ToggleDeclaration = {
      option: "crystal-healing",
      variants: [
        { value: "1" },
        { value: "2", when: { tag: "trained:occultism:3" } },
        { value: "3", when: { tag: "trained:occultism:4" } },
      ],
    };
    expect(availableVariants(decl, new Set()).map((v) => v.value)).toEqual(["1"]);
    expect(availableVariants(decl, new Set(["trained:occultism:3"])).map((v) => v.value)).toEqual(["1", "2"]);
  });

  it("returns no variants for a plain toggle", () => {
    expect(availableVariants({ option: "x" }, new Set())).toEqual([]);
  });
});

describe("the schema", () => {
  it("accepts a plain toggle, a variant picker, and an alwaysOn", () => {
    expect(() => toggleDeclarationSchema.parse({ option: "x" })).not.toThrow();
    expect(() =>
      toggleDeclarationSchema.parse({ option: "x", variants: [{ value: "a", label: "A" }] }),
    ).not.toThrow();
    expect(() => toggleDeclarationSchema.parse({ option: "x", alwaysOn: true })).not.toThrow();
  });

  it("rejects an empty option and an empty variant list", () => {
    expect(() => toggleDeclarationSchema.parse({ option: "" })).toThrow();
    expect(() => toggleDeclarationSchema.parse({ option: "x", variants: [] })).toThrow();
  });

  it("rejects unknown fields — the strict boundary", () => {
    expect(() => toggleDeclarationSchema.parse({ option: "x", toggleable: true })).toThrow();
  });
});
