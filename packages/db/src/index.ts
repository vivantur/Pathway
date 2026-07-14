// @pathway/db — the data layer. Owns Supabase queries and validates every row at
// the edge using core's Zod schemas. Depends on @pathway/core (never the reverse).
// The Supabase client is injected by the caller (web = anon, bot = service), so
// db never handles env/secrets.
//
// TODO: generate DB types (`supabase gen types typescript`) to type the client;
// for now the client is generically typed and coerceSpell parses rows from unknown.

// Spells — the first content entity's read/write seam over @pathway/core's
// coerceSpell. Predates the generic factory below; a cleanup can point it there.
export * from './spells';

// Generic content-store factory (read/coerce/partition/write) + the entity stores
// built on it: ancestries, heritages, backgrounds. The reusable seam every future
// content entity plugs into.
export * from './content-store';
export * from './ancestries';
export * from './backgrounds';
