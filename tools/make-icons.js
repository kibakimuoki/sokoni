// Draws the Sokoni app icon (a tomato on green) and exports every size a phone or computer needs into public/icons.
// Run:  node tools/make-icons.js     (needs the "sharp" package once:  npm install sharp --no-save)
const fs = require("fs"), path = require("path"); let sharp; try { sharp = require("sharp"); } catch (e) { console.error('Install sharp first:  npm install sharp --no-save'); process.exit(1); }
const out = path.join(__dirname, "..", "public", "icons");
const tomato = (scale) => `<g transform="translate(256 262) scale(${scale}) translate(-256 -262)">
  <defs><radialGradient id="t" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#ff7a68"/><stop offset=".55" stop-color="#e83a3a"/><stop offset="1" stop-color="#b81f2a"/></radialGradient><linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9be564"/><stop offset="1" stop-color="#3f9d3a"/></linearGradient></defs>
  <ellipse cx="256" cy="300" rx="168" ry="150" fill="url(#t)"/><ellipse cx="206" cy="238" rx="46" ry="28" fill="#fff" opacity=".28" transform="rotate(-28 206 238)"/>
  <g transform="translate(256 168)" fill="url(#l)" stroke="#2f7d32" stroke-width="3" stroke-linejoin="round">${[0, 72, 144, 216, 288].map((a) => `<path transform="rotate(${a})" d="M0 0 C-30 -18 -34 -62 0 -84 C34 -62 30 -18 0 0Z"/>`).join("")}</g>
  <rect x="246" y="100" width="20" height="52" rx="8" fill="#3b8d34"/></g>`;
const bg = (round) => `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a8a57"/><stop offset="1" stop-color="#14502f"/></linearGradient></defs><rect width="512" height="512" ${round ? 'rx="116"' : ""} fill="url(#g)"/>`;
const svg = (round, scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg(round)}${tomato(scale)}</svg>`;
(async () => {
  fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "icon.svg"), svg(true, 1));
  const png = (name, size, s) => sharp(Buffer.from(s)).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(out, name));
  await png("icon-192.png", 192, svg(true, 1)); await png("icon-512.png", 512, svg(true, 1));
  await png("maskable-512.png", 512, svg(false, 0.74)); // full-bleed with the tomato kept inside the "safe zone" so Android can crop it into any shape
  await png("apple-touch-icon.png", 180, svg(false, 0.86)); await png("favicon-32.png", 32, svg(true, 1));
  console.log("icons written to", out);
})();
