// Shim so the vendored companion engine's `./proficiency` import resolves to
// the web app's vendored copy of the core proficiency table. Keeps
// companions/engine.ts byte-identical to packages/core/src/companion.ts.
export * from '@/features/builder/data/proficiency';
