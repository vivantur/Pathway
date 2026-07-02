'use strict';

// Compatibility launcher for old deploy commands run from the repo root.
// The active slash-command deploy script lives in apps/bot; prefer `npm run deploy`.
require('./apps/bot/src/deploy');
