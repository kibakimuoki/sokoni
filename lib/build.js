// Every release carries ONE build id, stamped into the server, the app, the admin page, the offline page and the service worker (tools/stamp-build.js).
// If you copy only SOME files from a newer download, the files disagree: the server warns when it starts, and the admin page shows a red banner.
const fs = require("fs"), path = require("path");
const id = "202611141128";
const META = /<meta name="sokoni-build" content="([^"]+)"/, MARKERS = { "public/index.html": META, "public/admin.html": META, "public/offline.html": META, "public/sw.js": /\/\/ build: (\S+)/ };
function check(read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8")) { // → a list of problems (empty = every file is from this build)
  const problems = []; for (const [rel, re] of Object.entries(MARKERS)) { let t; try { t = read(rel); } catch (e) { problems.push(`${rel} is missing`); continue; } const m = re.exec(t); if (!m) problems.push(`${rel} has no build stamp (it is from an older version)`); else if (m[1] !== id) problems.push(`${rel} is from build ${m[1]}, but the server is build ${id}`); }
  return problems;
}
module.exports = { id, check, MARKERS };
