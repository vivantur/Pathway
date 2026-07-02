// @pathway/db — the data layer. Owns the Supabase client, generated DB types,
// and query modules. Depends on @pathway/core (never the reverse) and validates
// every write at the edge using core's Zod schemas.
//
// TODO: Supabase client factory, generated types, and per-table query modules.

import { CORE_PLACEHOLDER } from '@pathway/core';

export const DB_PLACEHOLDER = CORE_PLACEHOLDER;
