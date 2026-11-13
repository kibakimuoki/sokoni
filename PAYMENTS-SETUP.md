# Going live with real payments (Kenya-first)

This turns Sokoni from the demo into real money. The app side is ready (signed webhooks, amount re-checks, reconciliation, automatic payouts, backups, launch limits).
What's left is three things only **you** can do: a registered business, accounts/keys with the payment providers, and a public HTTPS server.
Provider rules change — the facts below were checked in October 2026; confirm each against the provider's own page before you rely on it.

## Your payment policy (read this first)
- **Buyers in Kenya pay with M-Pesa** (Paybill): either a prompt on their phone for their PIN, or by paying from their own M-Pesa menu (Pay Bill → your business number → an account number unique to the order). Both are confirmed **automatically**.
- **Everyone else pays in USDC** (a dollar stablecoin, through NOWPayments). So do Kenyan buyers whose order is **above M-Pesa's limit per transaction** (default KES 250,000 — set `MPESA_MAX_KES` to what your Paybill actually allows; check with Safaricom).
- Card, PayPal, mobile money and bank transfer **stay in the code but are hidden** until you connect them. Sections 0 and 0b below describe them for later.
- **Money in and out is recorded by the company** in a permanent ledger. Buyers and sellers see it under Account → Payments & earnings, with a receipt emailed to the address they signed up with. **Riders are paid the instant the buyer confirms the delivery code.**
- **Sokoni Coin** is an in-app reward (section 4c), not a cryptocurrency.
- **Bank transfer (KES) into your I&M account is also on** (section 4d), for buyers who prefer to pay from their bank or from M-Pesa into the account.
- **Accounts need no codes for now:** phone, email and a strong password only (section 2b explains the risks and how to switch codes on later).

## 0. Which providers can you actually use?

| Provider | Works for a Kenya-based business? | Needs | Use it for |
|---|---|---|---|
| **Flutterwave** | **Yes — start here.** Kenya is supported, with a sole-proprietor route and a company route | Business profile, address proof, KRA PIN certificate of the business (sole proprietor) or incorporation papers (company), payout bank/M-Pesa details, a website or social page | Cards, M-Pesa, other mobile money, bank transfer in; M-Pesa & bank payouts out |
| **M-Pesa Daraja (direct)** | Yes, but **only for a registered business** with a Safaricom-issued Paybill or Till (bank-issued ones don't work) | Business registration certificate, KRA PIN, signed go-live request, **https** callbacks, your server's IP whitelisted; B2C payouts and reversals (refunds) are separate approvals; approval takes days to weeks | M-Pesa straight into your own shortcode, usually the cheapest — add it second |
| **Stripe** | **Not as a direct account.** Kenya is on Stripe's "extended network" (it runs through Paystack), so you can't sign up for Stripe directly from Kenya | A US/other-country company (e.g. Stripe Atlas) if you really want it | Skip for now. Paystack is licensed in Kenya and could be added as an adapter later |
| **PayPal** | **Yes.** Kenya is one of very few African countries where a PayPal *Business* account can receive payments. Nigeria is not (buyers there can still *pay* with PayPal) | Sole-proprietor registration or company papers, a linked Kenyan bank account; proceeds can go to a bank or M-Pesa. Fees are high (international receipts plus an exchange-rate spread — check PayPal's current page) and new business accounts can get payout holds | A second option for buyers in the USA, Europe and Brazil who prefer PayPal. Not your only rail |
| **Crypto (NOWPayments)** | Optional | Their account verification | Stablecoin/crypto buyers. Payments are final, so refunds are manual |

### Important: holding buyers' money is regulated
Sokoni holds the buyer's payment until delivery. In Kenya, businesses that provide payment services (including holding customer funds, wallets or escrow) fall under the Central Bank of Kenya's National Payment System rules, and licensing is demanding.
A new National Payment System Bill, 2026 is currently only a **draft** that would tighten rules on customer funds. The safest design is for a **licensed provider to hold the money** and for Sokoni to instruct releases, rather than you touching funds yourself.
**See a Kenyan fintech/financial-services lawyer before you take real customers' money** — this is not legal advice.

## 0b. How a buyer in the USA (or anywhere) pays you — and where the money sits
By your policy the app shows **M-Pesa** (Kenya) and **Crypto (USDC)**. The other buttons — Mobile money, Card, PayPal, International payment — appear only if you connect that provider later. "International payment" lets a buyer abroad choose a secure payment page *or* a bank transfer. What happens behind each:

| Buyer chooses | What they do | How you receive it | How the app learns it arrived |
|---|---|---|---|
| **Card** (Visa/Mastercard, incl. US cards) | Pays in USD (or the order currency) on the provider's secure page | Into your Flutterwave balance (turn **USD** on in that account) | Automatically — signed webhook + re-check |
| **International → secure page** | Same page; also shows local methods | Same | Automatically |
| **International → bank transfer (wire / ACH)** | Sends USD/EUR/GBP from their bank using **your details + a unique reference** (e.g. `SOK1A2B3C4D`) | Into **your** USD/EUR/GBP receiving account. Providers that advertise receiving details for Kenyan businesses include **Payoneer**, **Eversend**, **nSave** and **Raenest** (check each one's current terms and fees). **Wise Business is reported to be send-only in Kenya — confirm before relying on it.** A Kenyan bank USD account also works (SWIFT wire: slower and costlier) | Automatically if you connect arrival notifications (below); otherwise **you press Confirm received** under *Payments → Bank transfers* |
| **PayPal** | Approves on PayPal's page (PayPal balance or card) | Into your PayPal Business balance, then withdraw to bank/M-Pesa | Automatically — the app asks PayPal for the order (never trusts the redirect), plus an optional signed webhook |
| **M-Pesa** | Approves a prompt on their phone | Flutterwave balance, or your own Paybill/Till with Daraja | Automatically |
| **Crypto** | Pays USDT/USDC/BTC… on the NOWPayments page | NOWPayments balance / your payout wallet | Automatically (signed IPN). Final — no chargebacks, refunds manual |

**"Held" is a status in the app.** The money physically sits in your provider/bank account until the app pays the seller (and rider) after delivery. So keep enough balance to cover payouts, and remember the regulatory note in section 0 about holding customers' money.

### Every country, not a handful
The app works out what a buyer can use **from their country** — all 200 countries on the list, in 7 world regions (Africa, Europe, Middle East, Asia, North America, Latin America & Caribbean, Oceania). Open **Operations → Payment setup → "Where can buyers pay from?"**: it shows each region summarised, and a **look-up box where you type any country** (e.g. Brazil, Japan, Nigeria) to see exactly what a buyer there can do, what currency they'd be charged in, and what's still missing. It updates as you connect each account.

What a buyer sees depends on their country:
- **Everywhere:** cards (Visa/Mastercard), PayPal, bank transfer to your USD/EUR/GBP account, and crypto — each turns on when you connect that account.
- **Mobile money** in the African countries Flutterwave covers (Kenya shows **M-Pesa**; Uganda, Tanzania, Rwanda, Ghana, Zambia, Malawi, Sierra Leone, Senegal, Côte d'Ivoire, Benin, Burkina Faso, Mali, Togo, Niger, Guinea, Cameroon, Gabon, Congo and DR Congo show **Mobile money**). Confirm the list against your Flutterwave dashboard; change it with `MOBILE_MONEY_COUNTRIES`.
- **Local currency:** if the buyer's currency is supported by the connected card or PayPal rail they're charged in it (e.g. UGX, NGN, GHS, EUR, GBP, BRL on PayPal), otherwise in USD — always with the exact amount shown first.
- **Typical local methods** are listed per country (e.g. Pix and boleto in Brazil, iDEAL in the Netherlands, UPI in India, Alipay/WeChat in China, GCash in the Philippines, BLIK in Poland, Swish in Sweden…). These are a guide to what buyers expect. In Africa most are reachable through Flutterwave. **Elsewhere they are marked "not reachable yet"**: they need a cross-border acquirer (EBANX, dLocal, Adyen, Airwallex or 2Checkout), who onboard businesses one by one, so they aren't self-serve for a small Kenyan business. Until you have volume from a country that justifies one of those contracts, buyers there still pay by card, PayPal, bank transfer or crypto.

Two things the map is deliberately careful about:
- **Sanctions.** Cuba, Iran, North Korea and Syria are **blocked by default** (sign-up and orders), because payment providers refuse them and routing them can get your accounts closed. Add more with `BLOCKED_COUNTRIES`. The default list can be switched off with `SANCTIONS_DEFAULTS=off` — only on advice from a lawyer. A further group (e.g. Russia, Belarus, Myanmar, Venezuela, Afghanistan, Libya, Sudan, Somalia, Yemen, Zimbabwe, Iraq, Lebanon) is shown with a caution: providers commonly restrict or heavily screen them, so confirm with yours.
- **Crypto isn't legal for buyers everywhere.** China, Algeria, Bangladesh, Nepal, Egypt, Iraq, Qatar, Tunisia and Morocco are shown as *restricted* (reported as banned or heavily restricted) — I don't promise crypto works there. Everywhere else it's "check local law".

### Paying in their own currency
A listing is priced in the seller's currency (say KES or BRL), but a payment method may not accept that currency. The app handles it: it charges in a currency the method **does** accept — the buyer's own currency if supported, otherwise USD — and shows the exact amount on the payment button *before* they pay ("You pay USD 20.40"). That exact amount and currency are stored and checked on every confirmation: paying less, or the right number in the wrong currency, is refused and flagged. A small buffer is added (default **2%**, `FX_MARGIN_PERCENT`) so exchange-rate moves between the quote and when the money settles don't leave you short of what you owe sellers — keep it above zero. Sellers and riders are still paid in the order's currency.

### Bank transfers in detail
- The buyer sees: an exact amount (locked at the moment they choose — KES orders are converted to your first receivable currency), your bank details, the reference, and a deadline (7 days; `WIRE_EXPIRY_DAYS`). They can tap **I've sent the transfer** (a hint for you, it changes nothing).
- Nothing is held until the money **arrives**. A small shortfall caused by bank fees is accepted (default 2%, `WIRE_TOLERANCE_PERCENT`); a bigger shortfall or the wrong currency is refused with a clear message so you can ask for the difference or refund.
- **Automatic confirmation:** set an *arrival-notification secret* under Payment setup. Anything that can send a web request (a Wise/bank automation, Zapier/Make, a small script) can then `POST https://your-domain/api/webhooks/wire` with JSON `{"reference":"SOK…","amount":123.45,"currency":"USD","bankReference":"…"}` and the header `x-sokoni-signature` = the hex HMAC-SHA256 of the raw body keyed with that secret. Unknown references are logged for review, never guessed. I did **not** connect Wise's or Payoneer's own APIs: Payoneer's is partner-only and I couldn't verify Wise's here — so until you automate it, you confirm arrivals by hand (a few clicks, only for bank transfers).
- Unpaid transfers expire after the deadline and the buyer can start again. Refunds of bank transfers are manual (the console flags them).

### Crypto, in plain words
NOWPayments shows the buyer the coin and amount; when it confirms, the order is held. The crypto lands in your NOWPayments balance/wallet — but sellers and riders are paid in **KES**. So at some point you must convert crypto to shillings (an exchange or off-ramp you trust) to refill the float your payouts come from. Plan that treasury step before you promote crypto, and ask your lawyer about your obligations.

## Entering the keys: Operations → Payment setup
You don't have to edit files. Open **Operations → Payment setup**: four tiles show whether each buyer method is *ready* and exactly what's missing; below them each provider has its own form, the addresses to register with that provider (with Copy buttons), a **Generate** button for the secret values you invent, and **Test connection**. Secrets are stored **encrypted** (needs `SERVER_SECRET` set on the server) and are never shown again — only "saved ••••1234". Values saved there override the same setting in the host environment; **Clear** goes back to the environment.

## 1. Order of work
1. **Register the business.** Business name (eCitizen / Business Registration Service), KRA PIN for the business, a business bank account, proof of address. Everything below depends on this. You also need a **Paybill** from Safaricom.
2. **Deploy** the app on a public https:// address (section 2) — providers can't reach `localhost`.
3. **Email for receipts** (Operations → Payment setup → Email; Resend free plan is enough to start). Sign-in codes by SMS/email are **off for now** — see section 2b for the risks and how to switch them on later.
4. **M-Pesa Paybill** (section 4): sandbox → phone prompt → paying from the M-Pesa menu → register the Paybill addresses → test with the simulate button → apply for production.
5. **USDC** (section 4b): NOWPayments account, USDC only.
6. **Soft launch** with a tiny order cap and a few invited users (section 5).
7. Later, only if you want them: Flutterwave, PayPal, cards (section 3).

## 2. Deploy
Needs: Node 18+, https, a **persistent disk** for the data folder, and **one instance** (the JSON store is not multi-server).
- **Render (easiest):** this folder includes a `render.yaml` blueprint and a `Dockerfile`. New → Blueprint → pick the repo. It creates the service, a persistent disk and the secrets. **Right after the first deploy, copy `SERVER_SECRET` and `ADMIN_TOKEN` from the Environment page into your password manager** — `SERVER_SECRET` decrypts every key you save in Payment setup, so losing it means re-entering them. Then set `PUBLIC_BASE_URL` to your https address.
- **Any Docker host (Railway, Fly, a VPS):** `docker build -t sokoni .` then run it with a volume on `/data` and the variables below.
- **Render / Railway / Fly without Docker:** create a web service from this folder (`npm install`, `node server.js`), attach a persistent volume, and set `SOKONI_DATA_DIR` to the volume path (e.g. `/var/data`). Set the health check to `/api/health`.
- **A small VPS** (recommended once a provider asks for a fixed IP): Node + a reverse proxy (Caddy or nginx) with a free Let's Encrypt certificate, run with systemd or pm2.
- **Static outbound IP:** Daraja production whitelists your server's IP, and some payout APIs can too. Many cheap platforms use changing IPs — if so, use a VPS or a static-IP add-on.
- **Never upload `.env`.** Put the variables in the host's "Environment" settings instead. Set at least:
```
PUBLIC_BASE_URL=https://your-domain.example      # must be https, no trailing slash
ADMIN_TOKEN=<16+ random characters>
SERVER_SECRET=<long random string>
SOKONI_DATA_DIR=/var/data
PLATFORM_COMMISSION_PERCENT=7                     # about 5% net after provider fees — see PRICING.md
# MAX_ORDER_USD=                                  # optional: limit the size of one order. Leave it out for NO limit.
# DEV_PAYMENTS must be absent. (It is ignored on a public address anyway.)
```
- **Backups:** the app snapshots its data every 6 hours into `sokoni-backups` next to the data folder (keeps the newest 30; `node tools/backup.js` runs one now). A backup on the same disk doesn't survive losing the disk — copy that folder off the machine regularly (cloud drive, rclone, scp). To restore: stop the app, copy the `.json` files and `private/` back.
- **Capacity:** the file store is fine for a pilot (hundreds of orders). Plan a Postgres move before you grow.

After deploying, open **Operations → Providers**. The **Go-live checklist** shows what still needs fixing, and each provider card shows the exact addresses to register and a **Test connection** button.

## 2b. Sign-in codes (SMS + email) — switched OFF for now
**How it works:** until an SMS provider **and** an email provider are both connected **and tested**, nobody receives codes: sign-up and login need only a **phone number, an email and a password**. The moment both are connected and each has passed a *Send a test … to me*, **codes switch on by themselves** — no setting to change. (`VERIFY_CODES=1` forces them on for local testing, `VERIFY_CODES=0` forces them off.)

**What works while it is off**
- **Sign-up:** name, country, phone (prefix filled in from the country), email, and a strong password (10+ characters with a small letter, a capital, a number and a special character; common words and the person's own name/phone/email are refused). The account exists straight away and is marked *not verified*.
- **Login:** phone or email + password. Ten wrong passwords lock that number for 15 minutes.
- **Riders** still need vehicle details and the live number-plate photo (checked by the AI, then by a person if unclear). **Freight companies** still need a licence number.
- **Forgot password:** the self-service reset needs codes, so it says *contact support*. **You reset it for them** in **Operations → Users**: search the person, press *Reset password*, and give them the temporary password privately. They are signed out everywhere and should change it at once (Account → Password). **Check who is asking first** — for example call them back on the number they registered with — because that password gives access to the account and its money.

**The risks you are accepting (please read)**
- **Nobody proves a number or email is theirs.** Anyone can register with someone else's phone number or email — and since each number can be used once, that blocks the real owner from joining.
- **Receipts go to whatever email was typed**, so a wrong or deliberately false address receives someone else's purchase details (crop, amount, the other person's name).
- **No second factor.** A stolen or guessed password is enough to log in and reach the wallet.
- **Bots can create accounts.** There is a per-connection limit (`SIGNUP_PER_HOUR`, default 60) but no phone/email check.
- M-Pesa auto-approval by the payer's phone number is weaker, because the phone on the account is unverified.
- Strongly consider turning codes (at least email) on **before real money flows at scale**.

**Receipts still need an email provider** (Operations → Payment setup → *Email*; Resend's free plan is 100 emails a day). Without one, transactions work but nobody is emailed.

**Plugging them in later (nothing to flip):** (1) **SMS** — create an Africa's Talking account (best for Kenya) or Twilio; in Operations → Payment setup → SMS paste the username and API key (Kenyan sender names need approval; the default sender works to start). (2) **Email** — create a Resend account, verify your sending domain (add the DNS records it shows), then paste the API key and the *Send from* address (it must be on that verified domain). (3) Press *Send a test SMS to me* and *Send a test email to me* and check that both arrive. As soon as both tests succeed, codes are ON: sign-up needs both codes and every login needs one. **Accounts made while codes were off are asked to verify both their phone and email at their next login**; older accounts without an email are asked to add one. If you later switch to a different provider, that provider must be tested again before codes stay on. **Receipts** go out by email as soon as the email provider is connected (they are not sent retroactively for earlier payments).

### When you switch codes on: providers
**You need one SMS provider and one email provider** (Operations → Payment setup, top two cards; keys are stored encrypted like the payment keys). Each card has **"Send a test … to me"** — use it until the message really arrives.
| | Options | What to do |
|---|---|---|
| **SMS** | **Africa's Talking** (strong across Kenya and Africa) or **Twilio** (global) | Create the account, copy the API key (Twilio: Account SID + Auth Token + a sending number), top up credit. Optional: ask them to approve a sender name such as SOKONI so codes show a name, not a number. Approval can take days in some countries — until then codes arrive from a number. Use the Africa's Talking *sandbox* only for testing: it doesn't send real SMS. |
| **Email** | **Resend** or **SendGrid** | Add your domain and the DNS records they give you, wait until it shows verified, create an API key, and set the sender (e.g. `Sokoni <no-reply@your-domain.com>`). A sender on an unverified domain is rejected or lands in spam. |

If either is missing, **Providers → Go-live checklist shows a red error** and sign-up is refused with a clear message (it never silently skips verification).

**Testing on your own computer without providers:** run with `DEV_OTP=1`. The codes then appear on the sign-up and login screens (and in the server log). This only works when `PUBLIC_BASE_URL` is empty or `localhost` — on a public address it is ignored, so it can never leak real codes.

**Delivery riders** must register a **vehicle type, number plate, make/model and a live photo of the vehicle with its plate** (taken with the camera — no gallery). The AI reads the plate from the photo and the rider is verified automatically only if it matches; anything unclear or different goes to **Operations → Riders**, where you see the photo, the plate typed and the plate read, and approve or reject (with a reason the rider sees). Riders can't go online until verified, and can retake the photo from Account. Bicycles need no plate. The AI reading is a helpful check, not proof — look at the photos.

## 3. Flutterwave (optional — not part of your core policy)
1. Create an account, choose Kenya, and use **test mode** first. In *Settings → API keys* copy the **secret key** (test keys contain `TEST`).
2. Add to your host settings: `FLW_SECRET_KEY=…` and `FLW_SECRET_HASH=` (a long random value **you** choose).
3. In *Settings → Webhooks* set the URL to `https://your-domain/api/webhooks/flutterwave` and the **secret hash to the same value** as `FLW_SECRET_HASH`.
4. Operations → Providers → **Test connection** on Flutterwave. It should say "Key accepted" and show your balance.
5. Place test orders with Flutterwave's test cards/numbers. Confirm the order flips to "Paid · held safely" with no admin action.
6. **Activate the account** (Flutterwave's *Activate your account* flow): upload the business documents. When approved, swap in the **live** key. The console's key badge changes from TEST to LIVE.
7. **Payouts:** the app pays sellers and riders with Flutterwave transfers (M-Pesa and bank). Enable transfers on the account, fund the balance, and add your server IP to their whitelist if asked. This app uses Flutterwave's v3 API with a secret key — if your dashboard only offers different credentials, tell me and I'll adapt the code.
8. **Settlement lag:** a buyer's card/M-Pesa money may not be available to send out immediately. If a payout hits "insufficient balance" the app does **not** mark it failed — it shows *waiting for settlement* in the console and retries every 30 minutes for 3 days. Keep a small float in the balance so early payouts aren't delayed.

## 4. M-Pesa Paybill (Daraja) — your main rail, do this first
1. Create a developer account at developer.safaricom.co.ke, make an app with *Lipa na M-Pesa Online* (and B2C when approved). Test in the **sandbox** first (shortcode 174379 with the sandbox passkey from the portal).
2. Settings: `MPESA_ENV=sandbox`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_BASE_URL=https://your-domain`.
3. **Paybill vs Till:** a Paybill works as is. For a **Till (Buy Goods)** also set `MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline` and `MPESA_TILL_NUMBER=<your till>` (keep `MPESA_SHORTCODE` as the head-office/store number Safaricom gave you). Check these against your Safaricom approval letter.
4. For payouts (B2C) also set `MPESA_INITIATOR_NAME`, `MPESA_INITIATOR_PASSWORD` and `MPESA_CERT_PATH` (Safaricom's public certificate file).
5. Providers page shows the three callback URLs to give Safaricom: `/api/mpesa/stk-callback`, `/api/mpesa/b2c-callback`, `/api/mpesa/b2c-timeout` (all must be https).
6. **Go live:** apply for production credentials (business certificate, KRA PIN, signed go-live letter, your server IP), then switch to `MPESA_ENV=production` with the production key, secret, passkey and shortcode. **M-Pesa refunds** need Safaricom's separate Reversal approval — until then the console flags M-Pesa refunds as manual.

### 4a. How "pay from my M-Pesa menu" is confirmed automatically
1. The buyer taps M-Pesa → "I'll pay from my phone's M-Pesa menu". The app shows **your business number**, an **account number that belongs to that order** (like `SOKC96281A1`) and the exact amount in KES.
2. They pay. **Safaricom tells your server** about the payment (the "C2B confirmation"). The app matches the account number and holds the order — no human involved. Part-payments add up; a repeated notification is counted once.
3. **Register your addresses once:** Operations → **Payments → M-Pesa Paybill → Register with Safaricom**. The two addresses contain a secret, so only Safaricom can use them, and they avoid words like "mpesa" (Safaricom refuses such addresses, as I understand its rules). Setting `MPESA_C2B_VERSION=v1` switches to the older registration call if v2 isn't enabled for you.
4. *Optional:* ask Safaricom to enable **external validation** on your Paybill. Then a wrongly typed account number is rejected **before** the customer's money moves.
5. **Test without real money:** in the sandbox, paste an order id and press **Simulate a customer paying**. (This refuses to run in production.)

**"Upload the receipt":** the buyer can type the M-Pesa code (like `SHK3L9X2PA`) and/or upload a photo of the message. That is only a **pointer**, because SMS and screenshots can be faked. The app looks the code up in **Safaricom's own record** and approves automatically **only if** the account number or the payer's phone number matches the buyer. If the code isn't known yet, it waits and approves the moment Safaricom's notice arrives. Anything doubtful (someone else's payment, a mistyped account number that doesn't match) lands in **Payments → M-Pesa Paybill** for a person, with the receipt photo — **Apply to order** finishes it. A payment for an order that is already paid, or an overpayment, is flagged there too so you can refund the difference.

### 4b. USDC (crypto) for international buyers and large orders
1. Create a **NOWPayments** account; copy the **API key** and **IPN secret** into Payment setup. Set the IPN address it shows you in their dashboard.
2. In their dashboard (*Settings → Payments → Coins*) **enable only the USDC networks you want** (pick one with low fees and wide wallet support). To pin one in the app instead, enter its NOWPayments code under "Pin the coin" (`CRYPTO_PAY_CURRENCY`). I couldn't verify their code names offline — check the exact code in their dashboard.
3. Decide where the money lands: NOWPayments can hold it for you or send it to **your own wallet**. Prefer your own wallet.
4. Buyers see the amount in US dollars on a USDC payment page. **Crypto payments are final**, so refunds are manual.
5. **Payouts:** sellers and riders in Kenya are paid by M-Pesa (B2C). Payouts to people abroad (bank, wallet) show under *Payouts → Needs manual payment* until you pay them.
6. Crypto isn't allowed for buyers in every country (the country look-up shows which are restricted).

### 4c. Wallet, receipts and Sokoni Coin
- **Wallet:** Account → Payments & earnings. It shows money in, money out, money held for the seller, fees paid, the Sokoni Coin balance and every entry, with a **CSV statement** to download. Every user sees only their own entries.
- **Receipts:** an email goes to the address the person signed up with for each payment, refund and payout (and each rider's delivery fee). If emailing fails, the transaction is **not** affected.
- **Sokoni Coin** is a reward the company records in its ledger — **not a blockchain token**. Both buyer and seller earn `COIN_EARN_PER_USD` coins (default **0.5**) per US$1 of every completed trade. Each coin is worth `COIN_USD_VALUE` dollars (default **0.01**) off the seller's fee, up to `COIN_MAX_COMMISSION_SHARE` (default **50%**) of the commission on a payout, applied automatically. **You fund this out of your commission:** the defaults cost about 1% of order value. Coins can't be bought, sent or cashed out, and sandbox payments and trades with yourself earn nothing.
- **Why not a real token?** A token people can buy, trade or redeem for money can fall under Kenya's virtual-asset and e-money rules, and needs a licence. Speak to a fintech lawyer before building one. This design keeps the same ledger so it can be extended later.

### 4d. Your I&M bank account, Paybill 542542 — and why STK push needs one more step
**What 542542 is.** It is **I&M Bank's own Paybill**, shared by everyone who banks with I&M. A customer who pays it with your 14-digit account number as the account puts money straight into your account, like any deposit. It is *not* a Paybill registered in your name.

**What that means for Sokoni**
- **STK push can't be raised through it.** An STK push (the PIN pop-up) can only be started by whoever owns the Paybill/Till with Safaricom, using that shortcode's own Daraja credentials. Sokoni doesn't have those for 542542.
- **No automatic confirmation.** Safaricom reports a payment to the *owner* of the Paybill (I&M), not to your server, so Sokoni isn't told.
- **Buyers can't be told apart by account number.** Everyone would type the same account number, so a payment can't be matched to an order by number.

**What is switched on now: Bank transfer (Kenyan shillings).** Load the details from `my-bank-settings.env` (copy the lines into `.env` next to `server.js`, or type them into *Operations → Payment setup → International bank transfer*). Buyers then see a **Bank transfer** button showing your account, the exact shillings, a unique reference, and these two ways to pay: **from a bank** (PesaLink / EFT / RTGS — put the reference in the payment description) or **from M-Pesa** (Pay Bill 542542, your account number, the exact amount). After paying they press *I've sent the transfer* and can **paste the M-Pesa code** in the note box. The order is **held when you press *Confirm received*** in **Operations → Payments → Bank transfers**, after you see the money in your account (the buyer's note and reference are shown next to the waiting transfer so you can find it on your statement). It's manual, which is fine for the first orders but will not scale. Tolerance is 0%: a transfer even KES 1 short is not accepted automatically.

**How to get real STK push + automatic confirmation** (pick one):
| Option | What you get | Status in the app |
|---|---|---|
| **Your own Safaricom Paybill/Till** (Daraja) | STK push *and* automatic confirmation, your own account numbers per order | **Built** (section 4). Needs a registered business and Safaricom's go-live. |
| **IntaSend** (collections API) | STK push through their platform; they pay out to your bank. Their help page lists 1% on M-Pesa collections; accounts may involve a screening call and have per-transaction/day limits. Check their current terms. | **Not built yet** — a connection can be added once you have an account (they offer sandbox keys to test). |
| **Flutterwave** | M-Pesa STK push in Kenya | **Built** (section 3). Needs their account approval. |
| **I&M "Lipa na I&M Bank"** | A business Paybill code of your own routed into your I&M account, with reports; I&M's page says it is set up through your relationship manager and has no merchant charge. | Not an API, so no STK push or automatic confirmation. |
| **I&M "Mpesa Xpress"** | I&M's own web page sends an STK prompt to a payer who types your account number | Not connected to Sokoni; no callback. |

**A risk to weigh: the account is in a personal name.** Escrow means holding buyers' money until delivery. Doing that through a personal account mixes your own funds with customers', can make the bank question or freeze an account that suddenly receives many deposits, and may need a payment-service licence in Kenya. Speak to a fintech lawyer, and consider a business account (and a business Paybill) before volumes grow.

### 4f. Equity Bank (Jenga) — the M-Pesa PIN prompt, settled straight into your Equity account
Built from Equity's own documentation (developer.jengahq.io). Collecting money works end to end; **paying people out through Equity is off until you switch it on** (see the end).

**Set it up (sandbox first)**
1. **Get your sandbox credentials** from the Jenga console: *Merchant Code*, *Consumer Secret*, *API Key* (Integrations & Keys). Treat them like passwords — type them only into Sokoni, never into chat or email. (Anything you have pasted somewhere public should be regenerated with "Generate New Key" in the console.)
2. **Enter them in Sokoni:** Operations → Payment setup → the **Equity Bank (Jenga)** form at the top: merchant code, consumer secret, API key, **your Equity account number** (the account customers' money is credited to — for the sandbox use a test account from Jenga's docs/console) and the business name shown to the payer. Leave Environment on *Sandbox*. Save.
3. **Make your signing key:** in the **Equity Bank — signing keys** card press **Generate signing keys**, copy the **public key** it shows, and **upload it in the Jenga console** (API Keys). Equity uses it to check the signature on every request. (Sokoni keeps the private half encrypted; it needs `SERVER_SECRET` set on your host.)
4. **Press Test connection** on the Equity form. Green means Equity accepted your merchant code, consumer secret and API key.
5. **Ask Finserve to switch the service on.** If a payment fails with *"hasn't switched this service on"* (Equity code 106401 / 401101), email **support@finserve.africa** with your merchant code and ask them to activate **M-Pesa STK push (account-based settlement)** for it.
6. **Give Sokoni a public https address** (`PUBLIC_BASE_URL`) — Equity must be able to call it back (see the tunnel steps in 4e).
7. **Try an order** as a Kenyan buyer, using one of Jenga's test mobile numbers (the Jenga console lists test cards, accounts and mobile numbers).

**How a payment flows:** the buyer taps M-Pesa → Equity sends the PIN prompt → the money is credited to your Equity account in real time → Equity calls your server → Sokoni checks it and holds the order. Sokoni uses the Equity route first for Kenyan buyers; `MPESA_PROVIDER=daraja` or `=flutterwave` picks another.

**How the callback is protected.** Equity does not sign its callbacks, so Sokoni (1) puts a secret in the callback address, (2) accepts only a reference it issued, (3) requires the amount to be enough and the number to match, and (4) asks Equity's records for a second opinion — if Equity says the payment *failed*, the order is not held. Equity's status **"paid but not credited to you"** (codes 2 and 4) is **never** held automatically; it is flagged in Payments → Events for you to check your Equity account.

**Paying sellers and riders through Equity (off by default).** Equity's own documentation says M-Pesa wallet payouts **can only be tested in production**. So: go live, then switch `JENGA_PAYOUTS` on **only after** sending one real KES 10 payout to your own number and seeing it arrive and the callback complete. Until then payouts go through whatever else you have connected, or are paid by hand.

**Going to production:** create production credentials in the Jenga console, set Environment to *Production*, **generate and upload a new signing key for production**, and repeat steps 4–5 for your live merchant code.

### 4e. Making every payment confirm by itself — what it takes, method by method
**The one rule:** a payment can only be confirmed automatically if *someone tells your server it happened*. Safaricom tells the owner of a Paybill, NOWPayments tells you about a crypto payment, and a bank can tell you if it offers that. If nobody tells your server, a person (or a pasted statement) has to.

| Buyer pays by | Who tells Sokoni | Automatic today? | What you must do |
|---|---|---|---|
| **USDC** | NOWPayments calls your server | **Yes — built and tested** | Your NOWPayments **API key + IPN secret**, a **public https address**, USDC switched on in their dashboard. In Operations → Payment setup press **Test connection**; the Crypto tile must turn green. |
| **M-Pesa (prompt or Paybill) on a Paybill/Till that is yours** | Safaricom calls your server | **Yes — built and tested** | A Paybill/Till registered to you with Safaricom + Daraja go-live (section 4), or Flutterwave (section 3). |
| **M-Pesa prompt through Equity Bank (Jenga)** | Equity calls your server | **Yes — built (section 4f)** | A Jenga account, your signing key uploaded, M-Pesa STK push switched on by Equity, a public https address. |
| **M-Pesa into your I&M account via I&M's Paybill 542542** | Only **I&M** is told | **No** — Safaricom reports it to I&M, not to you | Ask I&M for **Business Connect** (real-time payment notifications) — see below. Until then: statement paste or alert forwarding. |
| **Bank transfer (PesaLink / EFT / RTGS) to your I&M account** | Only your bank | **Statement paste: one click. Alert forwarding: automatic, opt-in.** Full automation needs a bank notification feed. | See "Matching bank text" below. |

**Matching bank text (works today, no bank needed).** Operations → Payments → *Bank transfers*:
- **Paste a statement.** Copy the deposit lines from your online banking (any format) and press **Match and confirm**. A payment is confirmed only when its line carries the order's reference (`SOK…`) **or** the M-Pesa code the buyer typed in their "I've sent it" note, **and** the amount is right. Debits and running balances are ignored (a big balance can't pass for the payment). Anything doubtful — a short amount, a code that fits two orders — is listed for a person. Pasting twice never confirms twice.
- **Forward your bank's alerts (automatic).** Your bank sends you an SMS or email when money arrives. Set `BANK_AUTO_CONFIRM=1`, then copy the secret address shown on that tab into (a) an Android app that forwards SMS (filter on your bank's sender and the word "credited"), or (b) a Make/Zapier scenario that watches your bank's emails and POSTs the text. Only alerts that say money was *received* and carry our reference or the buyer's code with the right amount are used, and anything above `BANK_AUTO_MAX` is left for a person.
  - **Risk:** SMS sender names can be forged, so a fake "credited" message that reaches your phone could hold an order with no money behind it. Keep `BANK_AUTO_MAX` low, prefer email alerts, and move to a real bank feed as volume grows.
  - I could not see what I&M's alerts look like. The matcher reads any text, but **send me one real alert (hide your balance) and I'll check it matches**.

**What to ask I&M for (this is what makes Paybill 542542 + your account automatic).** I&M offers **Business Connect**, which its own page describes as collections with *instant payment notifications for all successful payments* from M-Pesa Paybill, RTGS and transfers, with real-time validation of customer details. It needs a **business account**. Ask your relationship manager for: Business Connect / Lipa na I&M Bank, the notification (webhook) API specification, and a sandbox. When I have the specification I can connect it to the existing arrival endpoint.

**Testing from your own computer.** Providers can't call `localhost`, so nothing can confirm by itself while Sokoni only runs on your PC (the go-live checklist shows a red error for this). To test: install Cloudflare's `cloudflared` and run `cloudflared tunnel --url http://localhost:3000` (or `ngrok http 3000`). It prints an https address; put it in `PUBLIC_BASE_URL`, restart, and re-register the callback addresses shown in Payment setup. Quick-tunnel addresses change each time you restart them; for real use deploy (section 2).

## 5. Soft launch (first weeks)
- Optional: set `MAX_ORDER_USD` (e.g. 50) while you test with real money, then remove the line. With no line there is no limit. Invite 10–20 real farmers/buyers you know.
- Before inviting anyone, run each of these yourself with KES 10–50 and write down the result: card payment → held → delivery code → seller paid; M-Pesa STK → held; pay then **close the page** (confirmation must still arrive); a dispute with a refund; a payout while the balance is empty (should say *waiting for settlement*, then pay by itself once topped up); a rider fee payout.
- **Every day**: Operations → Payments → *Reconciliations* should be empty, and **Export CSV** and compare it against the provider dashboards. Download a backup copy off the server.
- Watch *Provider events* for `needs_review` or `failed` rows (bad signatures, amount mismatches, partial crypto payments).

## 6. Unit economics (check before launch)
Each order costs you: the provider's collection fee (PayPal is usually the most expensive; card/M-Pesa rails less), any currency-conversion cost, the payout fee (M-Pesa/bank transfer), and the rider payout is a pass-through. Look up the **current** fee pages for Flutterwave and Safaricom, add them up for a typical order, and set `PLATFORM_COMMISSION_PERCENT` comfortably above that — otherwise every sale loses money. Refunds and chargebacks cost extra.

## 7. If something goes wrong
- **Payment confirmed at the provider but still "pending" here:** the poller re-checks every 5 minutes; it's also listed under Reconciliations.
- **Payout stuck:** Payouts tab → *Retry now*, or *Needs manual payment* then *Mark as paid* once you've sent it by hand.
- **Provider keys leaked:** revoke and reissue at the provider, update the setting, restart. Never paste keys into chats or screenshots.
- **Data file error on start-up:** the app restores the last good copy automatically; if nothing is readable it refuses to run (so it can't overwrite anything) — restore from `sokoni-backups`.

## 8. Not built yet
Authenticator-app (TOTP) codes and passkeys · account deletion · sign-out of a single lost device (a password change signs out all) · Postgres / multiple servers · a Paystack or IntaSend adapter · the Daraja Reversal API for automatic M-Pesa refunds · KYC and sanctions screening · tax invoices (ask your accountant about KRA obligations such as eTIMS) · two-factor sign-in for the admin console.

## 4k. Paystack (Kenya) — M-Pesa and Airtel Money prompts, money held in your balance, automatic payouts

**How it works.** The buyer gets a PIN prompt on their phone. The money lands in **your Paystack balance** and *stays there* because you switch the account to **manual payouts** ("settled to balance"). When the delivery is confirmed, Sokoni sends the seller's payout, the rider's fee, or a refund **out of that balance** by API (Paystack "Transfers"), with nobody clicking anything. Sokoni's delay is a rule in Sokoni (no transfer before the delivery code), not a person.

**What buyers see.** While Paystack is connected, buyers see **Paystack's options — M-Pesa, Airtel Money and Card — plus crypto (USDC)**. PayPal, Stripe, Flutterwave, the bank-transfer option and Equity's Pay Bill are **not shown, not even greyed out, and the server refuses them if someone tries to ask for them by hand**. Equity's Pay Bill and bank transfer appear on their own the moment you enter Equity's **codes** (merchant code, consumer secret, API key and the signing key) — an account number alone does not show anything. To bring every other connected provider back (PayPal, Stripe, Flutterwave, …), set *Payment options buyers see* on the Paystack card to **Everything that is connected**.

**Card payments.** Paystack's secure card form opens **over Sokoni — the buyer never leaves the page** — for exactly the order amount in KES (the amount comes from our server and cannot be changed in the browser). If the form hasn't loaded within 10 seconds, or the browser blocks it, the buyer is sent to Paystack's own page instead. The card number is typed into Paystack's secure form and never reaches Sokoni, so Sokoni stays outside card-data (PCI) rules. We deliberately do not build our own card fields: they would put card numbers on our server, and Paystack's card API is only for PCI DSS-compliant businesses (Paystack may close an integration that uses it otherwise). International cards work (the buyer's bank converts to KES). The money lands in your Paystack balance and is held there like an M-Pesa payment, and Sokoni confirms it the same way (signed notification, then Paystack's own record). The buyer needs an email address on their account. Card refunds go back to the card through Paystack's refund API (never to a phone); the answer arrives on Paystack's refund notification, and a failed refund is flagged for a person with the dashboard steps. Cards are charged in KES, so orders listed in another currency don't offer Paystack cards. Card fees are higher than M-Pesa (Paystack publishes 2.9% for local and 3.8% for international cards).

**What sellers, riders and buyers are told about waiting.** The app tells people how long a payout takes, in the places they look: the sell page ("How you're paid"), Account → payouts, a held order (the seller sees "about 2 days after the buyer paid"; the buyer sees how refunds arrive: M-Pesa as soon as a refund is decided, cards after several days because the bank decides) and the rider's job card. The number comes from the setting *Days sellers wait for a payout* (`PAYOUT_WAIT_DAYS`): leave it empty for **2** while Paystack is connected (0 for providers that settle instantly); if you keep a float in your Paystack balance so payouts leave straight away, lower it. A payout that is waiting for the buyer's payment to settle shows the same message on the seller's order instead of an unexplained "queued".

**How fast a payment is confirmed.** Paystack's notification (the webhook) confirms a payment in seconds, but it can only reach a site that is online at a public address with the webhook address saved in Paystack. Without it, Sokoni asks Paystack itself: every few seconds while the buyer has the order open (`PAYMENT_CHECK_EVERY_MS`, default 8000), and in any case on a 5-minute sweep. Either way it is Paystack's own record that is checked — right amount, right currency — never the buyer's word.

**Timing to expect.** Paystack credits collected money to the balance about **2 days** after the buyer pays (Kenya T+2), and only settled money can be paid out. So the first sellers are paid about 2 days after the buyer's payment; after that, earlier sales fund later payouts straight away. If the balance is short, Sokoni **waits and retries** (for up to 7 days — `PAYOUT_FUNDS_WAIT_HOURS`, default 168; Paystack's "2 days" can mean business days, so a Thursday payment may only settle on Monday) instead of failing.

**Before real customers pay through it:** your Paystack status must be **Approved** (not only Pre-approved), Paystack must have confirmed in writing that holding seller funds until delivery is acceptable (its ineligible-business list names escrow), and your lawyer must have answered (GO-LIVE.md section E).

**Set-up — start with the TEST key:**
1. Paystack dashboard → **Settings → API Keys & Webhooks** → copy the **Test Secret Key** (starts `sk_test_`).
2. Operations → **Payment setup → Paystack**: paste it, **Save**, press **Test connection**. Green means Paystack accepted the key (it also shows your KES balance).
3. Same Paystack page: paste the **webhook address shown on the Paystack card** (`https://your-domain/api/webhooks/paystack`) into **Test Webhook URL** → *Save changes*. Paystack signs every notification with your secret key — there is no separate webhook secret.
4. Paystack **Settings → Preferences**: tick **Mobile Money** (M-Pesa), and under Transfers **untick “Confirm transfers before sending”**. Without that second step every payout waits for a one-time code. Do this for test mode and, later, live mode. Because anyone holding your secret key could then start transfers, keep the key only in the Sokoni settings, turn on **2FA** on your Paystack login, and add your server's **IP address** to the IP Whitelist (leave it empty while you test from your own computer).
5. Pay a small test order with M-Pesa. The order should become *held* by itself; then release it and watch the payout.
6. **Airtel Money** prompts are on by default through Paystack (provider `atl`, the same call as M-Pesa). To switch them off, set *Networks that get a PIN prompt* (under the Equity card) to `mpesa`. If Paystack asks Airtel buyers for an extra code, Sokoni says so and sends them back to M-Pesa — tell me and I'll add the code step. Equitel and T-Kash are not offered through Paystack.

**Going live:** Paystack **Settings → Payout schedule → manual / settle to balance** (ask Paystack support to switch it on if you don't see it); enter the **live** secret key (`sk_live_`) and the **Live Webhook URL**; make one small real payment; pay one real seller **by hand** and see it arrive; only then set *Automatic payouts to M-Pesa* to **On** (with a live key they stay Off by themselves).

**What keeps the money safe (built in and tested):**
- A **notification is never trusted on its own**: it must carry Paystack's signature (HMAC-SHA512 of the exact body, keyed with your secret key), and then Sokoni asks Paystack for *its own record* of the payment — right amount, right currency, status success — before holding the order.
- Missed notifications are caught by the **sweep** (every 5 minutes), for payments, payouts, rider fees and refunds.
- **A payout is never sent twice.** Before sending, Sokoni asks Paystack whether that reference already exists; only a *failed*, *reversed* or *waiting-for-a-code* transfer may be retried, under a new reference. If Paystack can't be asked, nothing is sent. A payout that is **reversed after it succeeded** is flagged for a person — never silently re-sent.
- Refunds go to the M-Pesa number that **paid**, by transfer (Paystack refunds M-Pesa payments only by e-mail, which can't be automated).

**Who pays Paystack's fee.** By default the buyer does. Paystack takes 1.5% of every M-Pesa or Airtel Money payment (2.9% local / 3.8% international for cards), so Sokoni asks the buyer for  *total ÷ (1 − fee)*, rounded up to a whole shilling for mobile money — a KES 300 order asks for KES 305 — and shows the difference as a "payment fee" line (without naming the provider). Paystack takes its 1.5% of the larger amount and the order's money reaches you in full; sellers are paid exactly as before; a payment short of the full amount is still refused; a refund gives back everything the buyer paid. Switch it in Payment setup → Paystack → *Payment fee*: *mobile money only* (default), *cards too* (priced at the local 2.9%, so an international card still costs you about 0.9%), or *off* (you pay it). If Paystack's rate for you changes, set `PAYSTACK_FEE_MOBILE_PCT` / `PAYSTACK_FEE_CARD_PCT`. Paystack's own pricing page lists passing fees on as an allowed choice. **Payouts are separate:** each payout to a wallet still costs you KES 20–60 (below).

**Costs and limits (from Paystack's published pricing — check them before you rely on them):** collecting 1.5% on M-Pesa; each payout to an M-Pesa wallet costs KES 20 (up to 1,500), 40 (up to 20,000) or 60 (above); one M-Pesa payment can be at most KES 150,000 (`PAYSTACK_MPESA_MAX`) and one payout to a wallet KES 10–250,000 (`PAYSTACK_MOBILE_MIN` / `PAYSTACK_MOBILE_MAX`). Orders above the M-Pesa limit are told to pay another way.

**Not built yet:** Pesalink bank payments, payouts to bank accounts, Equitel / T-Kash, and charging cards in another currency than KES.

### Check these in Paystack's TEST mode (the documents left them open)
Run one test of each before real money and tell me anything that behaves differently — each is a one-line change:
1. The prompt request (`/charge` with `mobile_money` and provider `mpesa` / `atl`) answers `pay_offline` for Kenya M-Pesa and Airtel. If a network asks for a code, Sokoni says so and sends the buyer back to M-Pesa.
2. Creating an M-Pesa payout recipient: Sokoni sends the number as `07…` with the bank code found by looking up "M-PESA" in Paystack's mobile-money list.
3. The look-ups by reference (`/transaction/verify/…`, `/transfer/verify/…`) and the status words `success` / `failed` / `reversed`.
4. Whether **Transfers** are switched on for your account (Paystack's error is “You cannot initiate third party payouts at this time” — Sokoni shows it in words and tells you to ask Paystack).
5. Whether Paystack sends `charge.failed` (if not, the sweep closes failed prompts within minutes anyway).
6. Paystack's **test numbers** for M-Pesa prompts, and its **test cards**, in test mode.
7. The card form (`/transaction/initialize` with only the card channel) opens over Sokoni from its access code (falling back to Paystack's page, after which the buyer lands on `?order=…&paid=1`); the card refund request (`/refund` with the transaction reference and amount) is accepted for a test card payment; and Paystack's refund notifications are named `refund.processed` and `refund.failed` and carry the original transaction reference.

## 4j. Fincra (Kenya) — M-Pesa, Airtel Money and Equitel PIN prompts, and M-Pesa payouts

**Why Fincra.** Equity's merchant API is for a business collecting money for itself and declined Sokoni's marketplace model. Fincra's published terms allow a client to collect from customers and third parties and to pay third parties, **once Fincra has onboarded and approved the business**. Its Kenya service (from its documentation): a PIN prompt on M-Pesa, Airtel Money and Equitel; collected money lands in **your Fincra wallet**; payouts go from that wallet to M-Pesa wallets in KES.

**Before you build on it — get these three things first (nothing below replaces them):**
1. **Fincra's written approval** that a marketplace may collect buyers' payments, hold them until delivery is confirmed, and pay farmers and riders. Describe Sokoni exactly as it is when you apply. Describing it as an ordinary shop would breach their terms and can get funds frozen.
2. **A Kenyan lawyer's advice** on holding funds for sellers (see GO-LIVE.md section E). A provider's licence covers the provider, not you.
3. A decision on the **Sokoni Coin**: Fincra's list of prohibited businesses is on a sheet linked from docs.fincra.com/docs/faq — read it, and describe the coin honestly in your application.

**Set-up (sandbox first):**
1. Create the Fincra business account. In **sandbox** no real documents are needed.
2. Fincra dashboard → **Settings → API**: copy the **Business ID**, the **secret API key** and the **webhook secret key**. Sandbox and live keys are different.
3. In the same place **whitelist this server's public IP address** (the VPS address in DEPLOY.md). Every call is refused until you do.
4. Operations → **Payment setup → Fincra**: paste the three values, set Environment to **Sandbox**, press **Save**, then **Test connection**. A green answer means Fincra accepted the key and Business ID.
5. Register the **webhook address** shown on the Fincra card (it is `https://your-domain/api/webhooks/fincra`) in the Fincra dashboard.
6. Pay a small test order with M-Pesa using Fincra's **test mobile numbers** (docs.fincra.com → Test Credentials). The order should become *held* by itself.
7. **Airtel Money and Equitel prompts** are off until you add them to *Networks that get a PIN prompt* (the setting under the Equity card): `mpesa,airtel,equitel`. Test each in the sandbox first. If Fincra asks one of them for a one-time code, Sokoni says so and sends the buyer back to M-Pesa — that step isn't built yet. T-Kash isn't offered through Fincra.

**Going live:** set Environment to **Live**, enter the *live* keys, and make one small real payment. **Automatic payouts stay OFF with real money** until you switch *Automatic payouts to M-Pesa* to On, after you have paid one real seller by hand and seen it arrive. In the sandbox they are on by themselves.

**What keeps the money safe (built in and tested):**
- A **notification is never trusted on its own.** Every one must carry Fincra's signature (HMAC-SHA512 with your webhook secret), and even then Sokoni asks Fincra for *its own record* of the payment before it holds the order — right amount, right currency, status success.
- A notification that never arrives is caught by the **sweep** (every 5 minutes), for payments, payouts, rider fees and refunds.
- **A payout is never sent twice.** Before sending, Sokoni asks Fincra whether that reference already exists. Only an explicit *failed* may be retried, and then under a new reference (Fincra never accepts a reused one). If Fincra can't be asked, nothing is sent.
- An **empty wallet** is not a failure: collected money first has to settle into the *available* balance, so the payout waits and retries for up to 3 days.
- Refunds go automatically to the M-Pesa number that **paid**, for exactly what was charged.

**Limits assumed:** payouts of KES 10 to KES 250,000 per transfer (change with `FINCRA_MOBILE_MIN` / `FINCRA_MOBILE_MAX` once Fincra confirms its real limits). Payouts go to M-Pesa wallets only; bank payouts are not routed through Fincra. Fincra's documents disagree on whether Kenyan *bank* payouts exist, so Sokoni doesn't rely on them.

### Check these in the Fincra sandbox (the documents left them open)
Run one test of each before real money, and tell me anything that behaves differently — each is a one-line change:
1. **Where charges start:** Sokoni uses `/checkout/charges` (the documented Direct Charge address). Fincra's reference also mentions `/checkout-core/…` for a newer checkout. "Test connection" doesn't exercise it; the first test payment does.
2. **How a charge is looked up:** `/checkout/charges/merchant-reference/{your reference}`, and the words `success` / `failed` for the status.
3. **The payout request:** whether Fincra wants a `sender` on local KES payouts (if so, fill *Sender name* in the card), whether amounts may carry cents, and whether an Airtel or Equitel number accepts the wallet code `SAFARICOM` (Sokoni assumes M-Pesa because the seller chose M-Pesa).
4. **One-time codes:** whether Airtel Money / Equitel prompts ask for an OTP.
5. **Failed-charge notifications:** that Fincra sends `charge.failed` (the sweep closes a failed charge within minutes anyway).
6. **How long collected money takes to become payable**, and the fees — they decide the real net revenue (Operations → Economics uses a cost assumption you can change with `COST_PCT_MPESA`).

## 4g. Equity Bank business account — go-live (the account number is the last piece)
Everything is built so that **entering your Equity account number is the only thing left**. Open **Operations → Payment setup**: the *Equity Bank — go-live checklist* shows what is done and what is missing, and **Run all checks** logs in to Equity, reads your balance and your statement (nothing is sent) so you know the connection really works.

What switches on by itself once the account number is in:
- **M-Pesa prompt** (STK push) with settlement straight into the account.
- **Bank-transfer details for buyers** (Equity Bank, your account number, SWIFT EQBLKENA) — derived from the account; you type nothing else. Set `JENGA_ACCOUNT_NAME` to your registered business name exactly as Equity has it.
- **Bank transfers confirm themselves.** Sokoni reads your account statement every 90 seconds and matches the buyer's reference (SOKxxxxxxxx). If a buyer pressed "I've sent it" and *exactly one* waiting order fits the amount, it is matched too — never a guess between two. A payment that is too small waits for a top-up.
- **Automatic payouts** (live mode): M-Pesa wallets for KES 100–140,000 per transfer (Equity's limits), and **PesaLink to a Kenyan bank account** for larger amounts. Sokoni checks the balance first and waits (retrying for 3 days) if funds are short. In the sandbox, payouts stay off; set `JENGA_PAYOUTS=0` to stop them live.
- **Automatic refunds**: when an admin decides a dispute for the buyer, the money returns to the buyer's M-Pesa by itself, and is retried by itself if the account is briefly short.
- **A safety breaker**: three signature/credential rejections in a row pause payouts for 30 minutes instead of failing every order; the money stays held.

**Go-live steps:** (1) credentials + signing key (section 4f), (2) public https address, (3) enter the account number, (4) *Run all checks*, (5) `JENGA_ENV=production` with your live credentials, (6) send one real **KES 100** payout to your own phone (Equity's minimum — and wallet payouts can only be tested live).

**Still manual, because no software can reverse them:** crypto refunds, refunds on foreign wire transfers, refunds outside KES 100–140,000, and a bank deposit with no reference that fits more than one waiting order. Each appears as a plain-language item in the exceptions list.

## 4h. Crypto (USDC) — go-live

**Read first — what NOWPayments is and isn't for Sokoni.** It accepts crypto from buyers anywhere, prices it in dollars and settles it into your NOWPayments custody balance. It is **crypto only**: its documents never mention M-Pesa, KES, mobile money or bank accounts, and its payouts go only to crypto wallets (with 2FA and a pre-approved IP address and wallet list required by default). So it is a good *international buyer* option and **not** a way to collect or pay out Kenyan shillings. Its optional "customer accounts" (custody sub-accounts that can hold and transfer funds between users) would make Sokoni a facilitator of crypto custody for others: ask NOWPayments in writing whether a marketplace may use them for third-party sellers, what they cost, and which countries are restricted, and take your lawyer's view (the Kenya VASP Act — see GO-LIVE.md section E) before ever building on them.

**Two NOWPayments dashboard settings to keep OFF** (Settings → Payments → Payment details → Deposits): *Wrong-asset deposits auto-processing* and any setting that treats short or repeated deposits as "Finished". NOWPayments itself says never to ship goods automatically on a repeated deposit. Sokoni is built to cope either way: it trusts the amount that actually arrived, not the label, and a **repeated deposit** (one carrying a `parent_payment_id`) is never counted automatically — it appears in Operations → Events as `repeat_deposit` for you to check and, if needed, send back by hand.

*Fixed rate* (`is_fixed_rate`) and *fee paid by the buyer* are left off on purpose: a fixed rate freezes the price for only 10 minutes and then the payment expires, which is too short for many buyers.
1. Create an account at nowpayments.io and set your **payout wallet** (a USDC address you control). In **Settings → Payments → Coins**, switch **USDC on** — prefer cheap networks (Polygon, Solana, Base).
2. Create an **API key** and an **IPN secret**; enter both in Payment setup → Crypto. Register the notification address the checklist shows.
3. **Practise first:** set `NOWPAYMENTS_SANDBOX=1` with a *sandbox* key — no real coins. Press **Test connection**: it lists the USDC networks you have enabled, or warns if none.
4. Remove `NOWPAYMENTS_SANDBOX` to go live.

Behaviour you can rely on: a payment seen on the network shows "confirming" to the buyer and is held only when final; a shortfall of a few cents (exchange withdrawal fees — the smaller of $1 and 2%) is accepted; a **real** partial payment is not held and the buyer is told how much to send; if it expires, the money that arrived is recorded as owed back; overpayments still complete the order. Orders under `CRYPTO_MIN_USD` (default $2) are refused with a plain explanation.

**Safety net for a missed notification.** NOWPayments tells Sokoni a payment is done by sending a notification to your public address. If that address is down or has changed (a temporary tunnel does this), the notification is lost. So: (1) as soon as *any* notification arrives, Sokoni remembers the payment's number and, every few minutes, asks NOWPayments itself until it finishes; (2) if none ever arrived, the buyer opens *Paid, but this page hasn't updated?* on the order page and pastes the **Payment ID** shown on the payment page — Sokoni asks NOWPayments directly and acts only if that payment belongs to that very order. For real customers, still use a permanent address.

**The USDC ↔ shilling float:** sellers are always paid in shillings from your Equity account, so USDC from crypto buyers accumulates. The crypto card shows *Crypto orders paid out — to convert*. When you convert USDC to shillings (a licensed exchange or off-ramp) and deposit it in Equity, enter the amount ("I converted this") to keep the float honest. Keep enough shillings in Equity to cover payouts; the Equity card warns when you are short.

## 4i. Two ways to pay with M-Pesa, and bank transfers for local people
**M-Pesa, both ways, once Equity is connected**
1. **PIN prompt** — the buyer taps Pay, a pop-up appears on their phone, they enter their M-Pesa PIN. Instant, and Equity tells Sokoni by itself.
2. **Pay Bill from the M-Pesa menu** (the backup) — Business number **247247** (Equity's Pay Bill; change it with `EQUITY_PAYBILL` if Equity gives you another), account number **your Equity account number**. M-Pesa shows your account name before the buyer confirms.

**How a Pay Bill payment confirms by itself.** Equity's shared Pay Bill can't carry an order reference, so Sokoni recognises the payment on **your Equity statement** (checked about every 90 seconds, and straight away when a buyer submits their code):
1. If the buyer typed their **M-Pesa code** and a credit carrying that code is on the statement → the order is held. A code alone approves nothing; the credit must exist on Equity's own record.
2. If the credit carries the **buyer's phone number** and the right amount, and exactly one waiting order of theirs fits → held. If two orders fit, Sokoni does **not** guess — the code settles which one.
3. A part-payment is recorded and the buyer is told how much is left; the second payment completes the order. Anything extra is flagged for you.
4. An unpaid Pay Bill order expires after a day; the buyer can start again.
5. A payment with nothing to identify it is parked; in **Payment setup → Equity → Recent credits** an admin presses **assign…** and types the order id (the first six characters are enough). That is the only manual step, and it should be rare.

**Please check this once:** I could not see how Equity actually writes Pay Bill credits on a statement. After your first real Pay Bill payment, open **Recent credits seen on the statement** and look at the description. If it shows the M-Pesa code or the payer's phone, matching works as described. If it shows neither, tell me what it looks like and I will adjust the matching. Also confirm with Equity that paying Pay Bill 247247 with your account number credits your business account.

**Refunds** for Pay Bill payments, like prompt payments, go back to the buyer's M-Pesa automatically.

**Bank transfer is for local people too.** A Kenyan buyer sees a transfer written for Kenya: pay from any Kenyan bank by **PesaLink** (usually instant), EFT, RTGS, or between Equity accounts — in shillings, with Equity's bank code (68), your account number, and the payment reference to put in the transfer description. SWIFT details are folded away under "Paying from a bank outside Kenya?" and shown plainly to buyers abroad. Bank transfers confirm the same way as above (the reference on the statement; or, if the buyer pressed "I've sent it" and exactly one waiting order fits the amount).
