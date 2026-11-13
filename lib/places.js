// Town/area suggestions per country + reverse geocoding.
//   Kenya: built-in gazetteer (instant, offline).  Everywhere else: GeoNames (set GEONAMES_USERNAME — free account at geonames.org),
//   else the keyless Photon geocoder (komoot) as a best-effort fallback. For heavy production traffic use a paid geocoder.
// Results are cached and each caller is rate-limited, in line with those services' fair-use rules.
const KE = {
  "Nairobi": "Nairobi,Westlands,Karen,Kasarani,Embakasi,Langata,Kibera,Eastleigh,Gigiri,Kileleshwa,Lavington,Ruaraka,Dagoretti",
  "Kiambu": "Thika,Ruiru,Juja,Kikuyu,Limuru,Kiambu,Githunguri,Karuri,Kabete,Gatundu,Lari,Tigoni",
  "Murang'a": "Murang'a,Kenol,Maragua,Kandara,Kangari,Kiriaini,Makuyu",
  "Nakuru": "Nakuru,Naivasha,Gilgil,Molo,Njoro,Subukia,Bahati,Rongai (Nakuru)",
  "Meru": "Meru,Maua,Nkubu,Timau,Chuka",
  "Nyeri": "Nyeri,Karatina,Othaya,Mukurweini,Naro Moru",
  "Kirinyaga": "Kerugoya,Kutus,Sagana,Wanguru,Mwea",
  "Machakos": "Machakos,Athi River,Kangundo,Matuu,Tala",
  "Makueni": "Wote,Makueni,Emali,Sultan Hamud,Mtito Andei",
  "Kajiado": "Kitengela,Ngong,Rongai,Kajiado,Isinya,Namanga,Loitokitok,Ongata Rongai",
  "Laikipia": "Nanyuki,Nyahururu,Rumuruti,Dol Dol",
  "Nyandarua": "Ol Kalou,Engineer,Ndaragwa",
  "Embu": "Embu,Runyenjes,Siakago",
  "Kitui": "Kitui,Mwingi,Mutomo",
  "Uasin Gishu": "Eldoret,Moi's Bridge,Burnt Forest",
  "Trans-Nzoia": "Kitale,Endebess,Kiminini",
  "Nandi": "Kapsabet,Nandi Hills,Mosoriot",
  "Kericho": "Kericho,Litein,Londiani",
  "Bomet": "Bomet,Sotik,Mulot",
  "Narok": "Narok,Kilgoris,Mai Mahiu,Ewaso Ngiro",
  "Kisumu": "Kisumu,Ahero,Maseno,Muhoroni",
  "Kakamega": "Kakamega,Mumias,Butere,Malava",
  "Bungoma": "Bungoma,Webuye,Kimilili,Chwele",
  "Busia": "Busia,Malaba,Port Victoria,Nambale",
  "Siaya": "Siaya,Bondo,Ugunja",
  "Homa Bay": "Homa Bay,Mbita,Oyugis",
  "Migori": "Migori,Awendo,Rongo,Isebania",
  "Kisii": "Kisii,Ogembo,Suneka",
  "Nyamira": "Nyamira,Keroka",
  "Vihiga": "Vihiga,Mbale,Luanda",
  "Mombasa": "Mombasa,Likoni,Nyali,Changamwe,Mtwapa",
  "Kilifi": "Kilifi,Malindi,Watamu,Mariakani,Kaloleni",
  "Kwale": "Ukunda,Diani,Kwale,Msambweni,Lunga Lunga",
  "Taita-Taveta": "Voi,Taveta,Wundanyi,Mwatate",
  "Tana River": "Hola,Garsen",
  "Lamu": "Lamu,Mpeketoni",
  "Garissa": "Garissa,Dadaab",
  "Wajir": "Wajir", "Mandera": "Mandera", "Marsabit": "Marsabit,Moyale", "Isiolo": "Isiolo",
  "Tharaka-Nithi": "Chuka,Marimanti", "Turkana": "Lodwar,Kakuma", "West Pokot": "Kapenguria,Makutano", "Samburu": "Maralal",
  "Elgeyo-Marakwet": "Iten,Kapsowar", "Baringo": "Kabarnet,Eldama Ravine,Marigat",
};
const KE_LIST = []; Object.entries(KE).forEach(([county, towns]) => { KE_LIST.push({ name: county + " County", region: "Kenya", kind: "county", c: county }); towns.split(",").forEach((t) => KE_LIST.push({ name: t, region: county, kind: "town", c: county })); });
const KE_XY = {}; "Nairobi:-1.2921,36.8219;Westlands:-1.2676,36.8108;Karen:-1.3197,36.7075;Kasarani:-1.2214,36.8987;Embakasi:-1.3190,36.8970;Langata:-1.3622,36.7521;Kibera:-1.3133,36.7886;Eastleigh:-1.2733,36.8467;Gigiri:-1.2333,36.8;Kileleshwa:-1.2833,36.7833;Lavington:-1.2833,36.7667;Ruaraka:-1.2333,36.8667;Dagoretti:-1.2967,36.7333;Thika:-1.0332,37.0693;Ruiru:-1.1459,36.9608;Juja:-1.1,37.0167;Kikuyu:-1.2462,36.663;Limuru:-1.1067,36.6431;Kiambu:-1.1714,36.8356;Githunguri:-1.0636,36.7783;Karuri:-1.1833,36.7667;Kabete:-1.25,36.7167;Gatundu:-0.9967,36.91;Lari:-1.05,36.6167;Tigoni:-1.1583,36.65;Murang'a:-0.721,37.1526;Kenol:-0.9667,37.0167;Maragua:-0.7833,37.1333;Kandara:-0.9,37.0;Makuyu:-0.9167,37.1;Nakuru:-0.3031,36.08;Naivasha:-0.7167,36.4333;Gilgil:-0.496,36.324;Molo:-0.25,35.7333;Njoro:-0.3333,35.9333;Bahati:-0.2667,36.1;Meru:0.047,37.649;Maua:0.2333,37.9333;Nkubu:-0.0667,37.6667;Chuka:-0.3333,37.65;Nyeri:-0.4201,36.9476;Karatina:-0.4833,37.1333;Othaya:-0.5333,36.95;Naro Moru:-0.1667,37.0167;Kerugoya:-0.4986,37.28;Kutus:-0.5667,37.3167;Sagana:-0.6667,37.2;Mwea:-0.7167,37.3667;Machakos:-1.5177,37.2634;Athi River:-1.4553,36.9786;Kangundo:-1.3,37.35;Matuu:-1.15,37.5333;Tala:-1.3167,37.35;Wote:-1.7833,37.6333;Makueni:-1.8036,37.62;Emali:-2.0833,37.4667;Sultan Hamud:-2.0167,37.3667;Mtito Andei:-2.6833,38.1667;Kitengela:-1.475,36.9553;Ngong:-1.3667,36.65;Ongata Rongai:-1.3964,36.7467;Rongai (Nakuru):-0.1736,35.863;Kajiado:-1.85,36.7833;Isinya:-1.6667,36.85;Namanga:-2.5461,36.7889;Loitokitok:-2.9167,37.5167;Nanyuki:0.0167,37.0667;Nyahururu:0.0333,36.3667;Rumuruti:0.2667,36.5333;Ol Kalou:-0.2667,36.3833;Engineer:-0.5667,36.5833;Embu:-0.539,37.4574;Runyenjes:-0.4167,37.5667;Kitui:-1.3667,38.0106;Mwingi:-0.9333,38.0667;Eldoret:0.5143,35.2698;Kitale:1.0191,35.0023;Kapsabet:0.2,35.1;Nandi Hills:0.1,35.1833;Kericho:-0.3689,35.2831;Litein:-0.5833,35.1833;Londiani:-0.1667,35.6;Bomet:-0.7813,35.3416;Sotik:-0.6833,35.1167;Narok:-1.078,35.8601;Kilgoris:-1.0,34.8833;Mai Mahiu:-0.9833,36.5833;Kisumu:-0.0917,34.768;Ahero:-0.1667,34.9167;Maseno:-0.005,34.6015;Muhoroni:-0.15,35.2;Kakamega:0.2827,34.7519;Mumias:0.3333,34.4833;Butere:0.2167,34.4833;Bungoma:0.5635,34.5606;Webuye:0.6,34.7667;Kimilili:0.7833,34.7167;Busia:0.4608,34.1115;Malaba:0.6333,34.2667;Siaya:0.06,34.2878;Bondo:0.2167,34.2667;Homa Bay:-0.5273,34.4571;Mbita:-0.4167,34.2;Oyugis:-0.5,34.7333;Migori:-1.0634,34.4731;Rongo:-0.7667,34.6;Isebania:-1.25,34.4833;Kisii:-0.6817,34.7667;Ogembo:-0.8167,34.7333;Nyamira:-0.5667,34.9333;Keroka:-0.7833,34.95;Vihiga:0.0667,34.7167;Mombasa:-4.0435,39.6682;Likoni:-4.0833,39.6667;Nyali:-4.0,39.7167;Changamwe:-4.0333,39.6167;Mtwapa:-3.9333,39.7333;Kilifi:-3.6305,39.8499;Malindi:-3.2192,40.1169;Watamu:-3.35,40.0167;Mariakani:-3.8667,39.4667;Ukunda:-4.2833,39.5667;Diani:-4.3167,39.5833;Kwale:-4.1737,39.4521;Msambweni:-4.4667,39.4833;Voi:-3.3961,38.5561;Taveta:-3.4,37.6833;Wundanyi:-3.4,38.3667;Hola:-1.5,40.0333;Lamu:-2.2717,40.902;Garissa:-0.4532,39.6461;Wajir:1.7471,40.0573;Mandera:3.9366,41.867;Marsabit:2.3333,37.9833;Moyale:3.5167,39.05;Isiolo:0.3546,37.5822;Lodwar:3.119,35.5973;Kakuma:3.7333,34.8667;Kapenguria:1.2333,35.1167;Maralal:1.0967,36.6983;Iten:0.6667,35.5083;Kabarnet:0.4919,35.743;Eldama Ravine:0.05,35.7167;Marigat:0.4667,36.0833".split(";").forEach((p) => { const i = p.lastIndexOf(":"), [la, ln] = p.slice(i + 1).split(","); KE_XY[p.slice(0, i)] = [Number(la), Number(ln)]; });
KE_LIST.forEach((p) => { const xy = KE_XY[p.name] || (p.kind === "county" ? KE_XY[(KE[p.c] || "").split(",")[0]] : null); if (xy) { p.lat = xy[0]; p.lng = xy[1]; } });
const OFFLINE = { KE: KE_LIST };
const haversine = (a, b, c, d) => { const r = (x) => (x * Math.PI) / 180, h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const inKenya = (lat, lon) => lat > -4.8 && lat < 5.1 && lon > 33.8 && lon < 41.95;
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const cache = new Map(); const hits = new Map();
const rateLimited = (ip) => { const now = Date.now(); const a = (hits.get(ip) || []).filter((t) => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 40; };
async function jget(url, headers = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
  try { const r = await fetch(url, { headers: { "User-Agent": "SokoniMarketplace/1.0 (+https://sokoni.example)", ...headers }, signal: ctrl.signal }); if (!r.ok) return null; return await r.json(); } catch { return null; } finally { clearTimeout(t); }
}
const cached = async (key, fn) => { const h = cache.get(key); if (h && Date.now() - h.at < 3600e3) return h.v; const v = await fn(); if (v) { cache.set(key, { at: Date.now(), v }); if (cache.size > 5000) cache.delete(cache.keys().next().value); } return v; };

function offline(cc, q) {
  const list = OFFLINE[cc]; if (!list) return null; const nq = norm(q);
  const pre = list.filter((p) => norm(p.name).startsWith(nq)); const inc = list.filter((p) => !norm(p.name).startsWith(nq) && norm(p.name).includes(nq));
  return [...pre, ...inc].slice(0, 8).map((p) => ({ name: p.name, region: p.region, country: cc, lat: p.lat == null ? null : p.lat, lng: p.lng == null ? null : p.lng }));
}
async function search(cc, q) {
  q = String(q || "").trim(); if (!q) return [];
  const off = offline(cc, q); if (off && off.length >= 5) return off;
  const online = await cached(`s|${cc}|${norm(q)}`, async () => {
    const gn = process.env.GEONAMES_USERNAME;
    if (gn) {
      const d = await jget(`http://api.geonames.org/searchJSON?name_startsWith=${encodeURIComponent(q)}&country=${cc}&featureClass=P&maxRows=8&orderby=population&style=short&username=${encodeURIComponent(gn)}`);
      return d && d.geonames ? d.geonames.map((g) => ({ name: g.name, region: g.adminName1 || "", country: cc, lat: Number(g.lat), lng: Number(g.lng) })) : null;
    }
    const d = await jget(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=20&osm_tag=place&lang=en`);
    if (!d || !d.features) return null;
    return d.features.filter((f) => (f.properties.countrycode || "").toUpperCase() === cc).slice(0, 8)
      .map((f) => ({ name: f.properties.name, region: f.properties.state || f.properties.county || "", country: cc, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }));
  });
  const seen = new Set(); return [...(off || []), ...(online || [])].filter((p) => { const k = norm(p.name) + "|" + norm(p.region); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
}
// Reverse geocoding: try several services in turn and always aim to return a human NAME (suburb / village / town), never just numbers.
const best = (o) => o.suburb || o.neighbourhood || o.quarter || o.village || o.hamlet || o.town || o.city_district || o.city || o.municipality || o.county || "";
async function reverse(lat, lon) {
  return cached(`r|${lat.toFixed(3)}|${lon.toFixed(3)}`, async () => {
    const gn = process.env.GEONAMES_USERNAME;
    if (gn) { const d = await jget(`http://api.geonames.org/findNearbyPlaceNameJSON?lat=${lat}&lng=${lon}&style=short&username=${encodeURIComponent(gn)}`); const g = d && d.geonames && d.geonames[0]; if (g && g.name) return { name: g.name, region: g.adminName1 || "", country: (g.countryCode || "").toUpperCase(), lat, lng: lon }; }
    const nom = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, ""), em = process.env.GEOCODER_EMAIL ? `&email=${encodeURIComponent(process.env.GEOCODER_EMAIL)}` : "";
    const n = await jget(`${nom}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1&accept-language=en${em}`); const a = n && n.address;
    if (a && best(a)) return { name: best(a), region: a.state || a.state_district || a.county || "", country: String(a.country_code || "").toUpperCase(), lat, lng: lon };
    const d = await jget(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`); const f = d && d.features && d.features[0];
    if (f) { const p = f.properties, nm = p.suburb || p.locality || p.district || p.city || p.county || p.name || ""; if (nm) return { name: nm, region: p.state || p.county || "", country: (p.countrycode || "").toUpperCase(), lat, lng: lon }; }
    if (inKenya(lat, lon)) { let near = null, nd = Infinity; for (const p of KE_LIST) if (p.lat != null && p.kind === "town") { const km = haversine(lat, lon, p.lat, p.lng); if (km < nd) { nd = km; near = p; } } // offline fallback: nearest known Kenyan town
      if (near && nd <= 80) return { name: near.name, region: near.region, country: "KE", lat, lng: lon, approx: true, nearKm: Math.round(nd) }; }
    return null;
  });
}
module.exports = { search, reverse, rateLimited };
