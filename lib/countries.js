// All countries/regions with their primary currency. Names come from Node's built-in ICU data.
// Currency data is maintained by hand — double-check anything critical (e.g. recent currency changes).
const RAW = "AF:AFN,AL:ALL,DZ:DZD,AD:EUR,AO:AOA,AG:XCD,AR:ARS,AM:AMD,AU:AUD,AT:EUR,AZ:AZN,BS:BSD,BH:BHD,BD:BDT,BB:BBD,BY:BYN,BE:EUR,BZ:BZD,BJ:XOF,BT:BTN,BO:BOB,BA:BAM,BW:BWP,BR:BRL,BN:BND,BG:EUR,BF:XOF,BI:BIF,CV:CVE,KH:KHR,CM:XAF,CA:CAD,CF:XAF,TD:XAF,CL:CLP,CN:CNY,CO:COP,KM:KMF,CG:XAF,CD:CDF,CR:CRC,CI:XOF,HR:EUR,CU:CUP,CY:EUR,CZ:CZK,DK:DKK,DJ:DJF,DM:XCD,DO:DOP,EC:USD,EG:EGP,SV:USD,GQ:XAF,ER:ERN,EE:EUR,SZ:SZL,ET:ETB,FJ:FJD,FI:EUR,FR:EUR,GA:XAF,GM:GMD,GE:GEL,DE:EUR,GH:GHS,GR:EUR,GD:XCD,GT:GTQ,GN:GNF,GW:XOF,GY:GYD,HT:HTG,HN:HNL,HU:HUF,IS:ISK,IN:INR,ID:IDR,IR:IRR,IQ:IQD,IE:EUR,IL:ILS,IT:EUR,JM:JMD,JP:JPY,JO:JOD,KZ:KZT,KE:KES,KI:AUD,KP:KPW,KR:KRW,XK:EUR,KW:KWD,KG:KGS,LA:LAK,LV:EUR,LB:LBP,LS:LSL,LR:LRD,LY:LYD,LI:CHF,LT:EUR,LU:EUR,MG:MGA,MW:MWK,MY:MYR,MV:MVR,ML:XOF,MT:EUR,MH:USD,MR:MRU,MU:MUR,MX:MXN,FM:USD,MD:MDL,MC:EUR,MN:MNT,ME:EUR,MA:MAD,MZ:MZN,MM:MMK,NA:NAD,NR:AUD,NP:NPR,NL:EUR,NZ:NZD,NI:NIO,NE:XOF,NG:NGN,MK:MKD,NO:NOK,OM:OMR,PK:PKR,PW:USD,PS:ILS,PA:PAB,PG:PGK,PY:PYG,PE:PEN,PH:PHP,PL:PLN,PT:EUR,QA:QAR,RO:RON,RU:RUB,RW:RWF,KN:XCD,LC:XCD,VC:XCD,WS:WST,SM:EUR,ST:STN,SA:SAR,SN:XOF,RS:RSD,SC:SCR,SL:SLE,SG:SGD,SK:EUR,SI:EUR,SB:SBD,SO:SOS,ZA:ZAR,SS:SSP,ES:EUR,LK:LKR,SD:SDG,SR:SRD,SE:SEK,CH:CHF,SY:SYP,TW:TWD,TJ:TJS,TZ:TZS,TH:THB,TL:USD,TG:XOF,TO:TOP,TT:TTD,TN:TND,TR:TRY,TM:TMT,TV:AUD,UG:UGX,UA:UAH,AE:AED,GB:GBP,US:USD,UY:UYU,UZ:UZS,VU:VUV,VA:EUR,VE:VES,VN:VND,YE:YER,ZM:ZMW,ZW:ZWG,HK:HKD,MO:MOP,PR:USD";
const currencyByCountry = {};
RAW.split(",").forEach((p) => { const [c, cur] = p.split(":"); currencyByCountry[c] = cur; });
let dn = null;
try { dn = new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) { /* fall back to codes */ }
const COUNTRIES = Object.keys(currencyByCountry)
  .map((code) => ({ code, name: (dn && dn.of(code)) || code, currency: currencyByCountry[code] }))
  .sort((a, b) => a.name.localeCompare(b.name));
const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));
const CURRENCIES = [...new Set(COUNTRIES.map((c) => c.currency))].sort();
const CURRENCY_SET = new Set(CURRENCIES);
function currencyOf(code) { return currencyByCountry[code] || "USD"; }
function decimalsOf(currency) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits; } catch { return 2; }
}
function roundMoney(amount, currency) {
  const d = decimalsOf(currency); const f = 10 ** d;
  return Math.round(amount * f) / f;
}
module.exports = { COUNTRIES, COUNTRY_CODES, CURRENCIES, CURRENCY_SET, currencyOf, roundMoney };
