// Run a backup by hand:  node tools/backup.js
require("../lib/env"); const b = require("../lib/backup"); const d = b.backupNow(); console.log(d ? "Backup written to " + d : "Backup FAILED: " + b.state.error);
