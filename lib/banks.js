// Built-in bank directory (names only) so the payout form always works, even before any payment provider is connected.
// When Flutterwave is connected its live bank list (with real transfer codes) is used instead, and a directory pick is matched by name at payout time.
// Not every bank is listed — sellers can always choose "My bank isn't listed" and type it.
const D = {
  KE: "KCB Bank,Equity Bank,Co-operative Bank of Kenya,Absa Bank Kenya,Standard Chartered Kenya,NCBA Bank,Stanbic Bank Kenya,I&M Bank,Diamond Trust Bank (DTB),Family Bank,Sidian Bank,Bank of Africa Kenya,HF Group (Housing Finance),Prime Bank,Gulf African Bank,Guaranty Trust Bank Kenya,Citibank Kenya,Ecobank Kenya,Access Bank Kenya,Credit Bank,SBM Bank Kenya,Consolidated Bank,Middle East Bank Kenya,First Community Bank,Victoria Commercial Bank,Mayfair Bank,Spire Bank,UBA Kenya,M-Oriental Bank,National Bank of Kenya,Postbank (Kenya),ABC Bank,Development Bank of Kenya,Kenya Women Microfinance Bank,Faulu Microfinance Bank,Kingdom Bank,Mwalimu National SACCO,Stima SACCO,Unaitas SACCO",
  UG: "Stanbic Bank Uganda,Centenary Bank,dfcu Bank,Absa Bank Uganda,Equity Bank Uganda,KCB Bank Uganda,Standard Chartered Uganda,Bank of Africa Uganda,Housing Finance Bank,Orient Bank,PostBank Uganda,Diamond Trust Bank Uganda,Ecobank Uganda,Cairo Bank Uganda,Finance Trust Bank,Tropical Bank,Opportunity Bank",
  TZ: "CRDB Bank,NMB Bank,NBC Bank,Stanbic Bank Tanzania,Equity Bank Tanzania,KCB Bank Tanzania,Exim Bank Tanzania,Absa Bank Tanzania,DTB Tanzania,Azania Bank,Bank of Africa Tanzania,Akiba Commercial Bank,TPB Bank,Citibank Tanzania,Standard Chartered Tanzania,Tanzania Commercial Bank",
  RW: "Bank of Kigali,I&M Bank Rwanda,Equity Bank Rwanda,KCB Bank Rwanda,Access Bank Rwanda,Ecobank Rwanda,GT Bank Rwanda,BPR Bank Rwanda,Cogebanque,Urwego Bank,AB Bank Rwanda,Zigama CSS",
  ET: "Commercial Bank of Ethiopia,Awash Bank,Dashen Bank,Bank of Abyssinia,Wegagen Bank,Hibret Bank,Nib International Bank,Cooperative Bank of Oromia,Zemen Bank,Abay Bank,Lion International Bank,Bunna International Bank,Enat Bank,Berhan Bank",
  NG: "Access Bank,GTBank,Zenith Bank,First Bank of Nigeria,UBA,Stanbic IBTC,Fidelity Bank,FCMB,Union Bank,Sterling Bank,Wema Bank,Polaris Bank,Ecobank Nigeria,Keystone Bank,Heritage Bank,Standard Chartered Nigeria,Citibank Nigeria,Providus Bank,Kuda Bank,OPay,PalmPay,Moniepoint",
  GH: "GCB Bank,Ecobank Ghana,Stanbic Bank Ghana,Absa Bank Ghana,Fidelity Bank Ghana,CalBank,Zenith Bank Ghana,Access Bank Ghana,Standard Chartered Ghana,Republic Bank Ghana,Agricultural Development Bank (ADB),Prudential Bank,Consolidated Bank Ghana,First National Bank Ghana,UBA Ghana,GT Bank Ghana",
  ZA: "Standard Bank,FNB (First National Bank),Absa,Nedbank,Capitec,Investec,African Bank,TymeBank,Discovery Bank,Bidvest Bank,Bank Zero",
  EG: "National Bank of Egypt,Banque Misr,Commercial International Bank (CIB),QNB Egypt,Banque du Caire,HSBC Egypt,Bank of Alexandria,Faisal Islamic Bank of Egypt,Arab African International Bank,Housing and Development Bank",
  ZM: "Zanaco,Stanbic Bank Zambia,Absa Bank Zambia,Standard Chartered Zambia,First National Bank Zambia,Indo-Zambia Bank,Ecobank Zambia,Access Bank Zambia,United Bank for Africa Zambia",
  MW: "National Bank of Malawi,Standard Bank Malawi,FDH Bank,NBS Bank,First Capital Bank,Ecobank Malawi,CDH Investment Bank",
  IN: "State Bank of India,HDFC Bank,ICICI Bank,Axis Bank,Kotak Mahindra Bank,Punjab National Bank,Bank of Baroda,Canara Bank,IndusInd Bank,Yes Bank,IDFC FIRST Bank",
  US: "Chase,Bank of America,Wells Fargo,Citibank,U.S. Bank,PNC Bank,Capital One,TD Bank,Truist",
  GB: "Barclays,HSBC UK,Lloyds Bank,NatWest,Santander UK,Nationwide,Monzo,Starling Bank,Revolut",
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const list = (cc) => (D[cc] ? D[cc].split(",").map((n) => ({ code: slug(n), name: n })) : []);
module.exports = { list, slug };
