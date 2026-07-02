'use strict';

// Launcher for hosts (e.g. Railway) whose start command runs `node index.js`
// from this app's root directory. The real entry point is src/index.js;
// `npm start` runs that directly, and this file makes the bare `node index.js`
// invocation work too.
require('./src/index');
