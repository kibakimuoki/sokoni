// International dialling prefixes for every country in the list, and phone normalisation to E.164 (+<country><number>).
// Countries that share +1 (USA, Canada and the Caribbean) all use "+1"; the area code is part of the number the person types.
const RAW = "AF:93 AL:355 DZ:213 AD:376 AO:244 AG:1 AR:54 AM:374 AU:61 AT:43 AZ:994 BS:1 BH:973 BD:880 BB:1 BY:375 BE:32 BZ:501 BJ:229 BT:975 BO:591 BA:387 BW:267 BR:55 BN:673 BG:359 BF:226 BI:257 KH:855 CM:237 CA:1 CV:238 CF:236 TD:235 CL:56 CN:86 CO:57 KM:269 CG:242 CD:243 CR:506 CI:225 HR:385 CU:53 CY:357 CZ:420 DK:45 DJ:253 DM:1 DO:1 EC:593 EG:20 SV:503 GQ:240 ER:291 EE:372 SZ:268 ET:251 FJ:679 FI:358 FR:33 GA:241 GM:220 GE:995 DE:49 GH:233 GR:30 GD:1 GT:502 GN:224 GW:245 GY:592 HT:509 HN:504 HK:852 HU:36 IS:354 IN:91 ID:62 IR:98 IQ:964 IE:353 IL:972 IT:39 JM:1 JP:81 JO:962 KZ:7 KE:254 KI:686 XK:383 KW:965 KG:996 LA:856 LV:371 LB:961 LS:266 LR:231 LY:218 LI:423 LT:370 LU:352 MO:853 MG:261 MW:265 MY:60 MV:960 ML:223 MT:356 MH:692 MR:222 MU:230 MX:52 FM:691 MD:373 MC:377 MN:976 ME:382 MA:212 MZ:258 MM:95 NA:264 NR:674 NP:977 NL:31 NZ:64 NI:505 NE:227 NG:234 KP:850 MK:389 NO:47 OM:968 PK:92 PW:680 PS:970 PA:507 PG:675 PY:595 PE:51 PH:63 PL:48 PT:351 PR:1 QA:974 RO:40 RU:7 RW:250 WS:685 SM:378 ST:239 SA:966 SN:221 RS:381 SC:248 SL:232 SG:65 SK:421 SI:386 SB:677 SO:252 ZA:27 KR:82 SS:211 ES:34 LK:94 KN:1 LC:1 VC:1 SD:249 SR:597 SE:46 CH:41 SY:963 TW:886 TJ:992 TZ:255 TH:66 TL:670 TG:228 TO:676 TT:1 TN:216 TR:90 TM:993 TV:688 UG:256 UA:380 AE:971 GB:44 US:1 UY:598 UZ:998 VU:678 VA:379 VE:58 VN:84 YE:967 ZM:260 ZW:263";
const DIAL = {}; for (const p of RAW.split(" ")) { const [c, d] = p.split(":"); DIAL[c] = "+" + d; }
const dialOf = (cc) => DIAL[String(cc || "").toUpperCase()] || "";
const validE164 = (p) => /^\+[1-9]\d{7,14}$/.test(p);
// "0712 345 678" + KE → +254712345678 · "712345678" + KE → +254712345678 · "+44 7911 123456" stays · "00254…" → +254…
function normalizePhone(input, cc) {
  const s = String(input || "").trim().replace(/[\s().-]/g, ""); if (!s) return "";
  if (s.startsWith("+")) return "+" + s.slice(1).replace(/\D/g, ""); if (s.startsWith("00")) return "+" + s.slice(2).replace(/\D/g, "");
  const digits = s.replace(/\D/g, ""), d = dialOf(cc); if (!d) return "+" + digits; const dd = d.slice(1);
  if (digits.startsWith("0")) return "+" + dd + digits.replace(/^0+/, "");
  if (dd.length > 1 && digits.startsWith(dd) && digits.length >= dd.length + 7) return "+" + digits; // typed the code without the +
  return "+" + dd + digits;
}
const maskPhone = (p) => { const s = String(p || ""); return s.length > 6 ? s.slice(0, 4) + "•".repeat(Math.max(3, s.length - 7)) + s.slice(-3) : "•••"; };
const maskEmail = (e) => { const [u, d] = String(e || "").split("@"); return d ? (u.length > 2 ? u.slice(0, 2) : u.slice(0, 1)) + "•••@" + d : "•••"; };
module.exports = { DIAL, dialOf, validE164, normalizePhone, maskPhone, maskEmail };
