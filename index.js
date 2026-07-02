'use strict';

// Compatibility launcher for hosts that still run `node index.js` from the repo
// root. The active bot lives in apps/bot (an npm workspace); prefer `npm start`.
require('./apps/bot/src/index');
