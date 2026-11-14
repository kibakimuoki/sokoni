// Gives this release a new build id and writes it into every file that carries one. Run it before you package a release:  node tools/stamp-build.js
const fs = require("fs"), path = require("path"), root = path.join(__dirname, ".."), id = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ""), w = (rel, fn) => { const f = path.join(root, rel), t = fs.readFileSync(f, "utf8"), u = fn(t); if (u === t && !t.includes(id)) throw new Error("couldn't stamp " + rel); fs.writeFileSync(f, u); };
w("lib/build.js", (t) => t.replace(/const id = "[^"]*";/, `const id = "${id}";`));
for (const rel of ["public/index.html", "public/admin.html", "public/offline.html"]) w(rel, (t) => (/<meta name="sokoni-build"/.test(t) ? t.replace(/(<meta name="sokoni-build" content=")[^"]*(")/, `$1${id}$2`) : t.replace(/<head>/i, (h) => `${h}<meta name="sokoni-build" content="${id}">`)));
w("public/sw.js", (t) => (/^\/\/ build: \S+/.test(t) ? t.replace(/^\/\/ build: \S+/, `// build: ${id}`) : `// build: ${id}\n${t}`)); // a new stamp changes this file, so every browser fetches the new service worker too
console.log("Stamped build " + id);
