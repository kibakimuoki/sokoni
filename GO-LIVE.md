# Going live — the checklist

Nothing here is optional unless it says so. Tick them in order. "Check with a lawyer/accountant" means exactly that: I am not one.

## A. Accounts and keys you must obtain
- [ ] **Equity (Jenga) live credentials** — merchant code, consumer secret, API key — and your account linked to your Jenga profile (use the email drafted for you). Ask them to confirm: M-Pesa prompt enabled, balance + statement access, send-money (wallet + PesaLink), what Pay Bill 247247 shows on your statement, fees and limits.
- [ ] **Signing key**: Operations → Payment setup → *Generate signing keys*; upload the **public** half in the Jenga console. Use a fresh key for live.
- [ ] **NOWPayments** live API key + IPN secret; USDC switched on (Polygon / Base / Solana / BSC are cheap); payout wallet set. (Practise first with `NOWPAYMENTS_SANDBOX=1`.)
- [ ] **An Anthropic API key** (optional but powers the quality reports, price guide, weight estimates and translations). Set a spending limit, and enter it only in Operations → Payment setup (never paste it into a chat or e-mail; if you ever do, revoke it and make a new one).
- [ ] **Checking the AI key:** after you paste it in Operations → Payment setup → AI and press Save, press **Test connection** on that card. It makes a real call and, if it fails, says why in plain words (wrong or revoked key, an admin key, a wrong model name, no credit, a spending limit, or no internet). The **Workspace ID** box is optional and normally not needed — the key already belongs to its workspace; fill it in only if your AI provider tells you the API needs it.
- [ ] **A permanent https address** and hosting that **keeps the data folder** between restarts and redeploys.

### While you wait for Equity's API credentials
- **M-Pesa already works with Pay Bill.** As soon as your Equity **account number** is saved (Operations → Payment setup → Equity), customers who tap M-Pesa can choose *Pay Bill from the M-Pesa menu* (business number 247247, your account number as the account). The *PIN prompt* option is shown as "Coming soon" until the credentials are in.
- **Confirmation is by hand until then.** Sokoni can't read your statement yet, so each Pay Bill order appears in **Operations → Payment setup → Equity → "Pay Bill payments waiting for you to confirm"**. Check your Equity account (or its SMS) for the money, then press **Money received ✓** (change the amount if they paid less). Check it at least a few times a day and tell customers how long it takes (the app tells them "within a few hours").
- **Plugging the credentials in later changes nothing for customers:** the same orders start confirming by themselves, and the PIN prompt becomes available.
- **Sign-in codes and receipts:** nothing to flip — see PAYMENTS-SETUP.md ("Plugging them in later"). Connect Africa's Talking (SMS) and Resend (email), press both test buttons, and codes switch on by themselves; receipts start as soon as the email provider is connected.

### Ask Equity / Finserve about the other networks
Add these to your email to them: (1) *Is the PIN prompt (STK/USSD push) available for Airtel Money and T-Kash on our merchant account, or only Safaricom M-Pesa?* (2) *Please authorise the Equitel prompt for our merchant code.* (3) *Can Telkom T-Kash customers pay Pay Bill 247247, and how do Airtel, Equitel and T-Kash payments appear on our statement narration?* Add a network to `PROMPT_NETWORKS` / `PAYBILL_NETWORKS` only after they confirm.

### Paystack (the chosen M-Pesa route) — see PAYMENTS-SETUP.md 4k
- [ ] Paystack status **Approved** (not only Pre-approved), 2FA switched on, and Paystack's **written** answer on holding seller funds until delivery.
- [ ] Test secret key saved in Operations → Payment setup → Paystack; **Test connection** is green; webhook address saved in Paystack (test).
- [ ] Preferences: **Mobile Money** ticked and **“Confirm transfers before sending”** unticked; payout schedule on **manual**; the server's IP on the IP Whitelist.
- [ ] **Quality:** every listing in the Market shows a grade chip, "Quality check in progress" or "Not graded yet" — and listings published before the AI key worked are graded automatically within a few minutes of the server starting (Operations → AI shows the key works).
- [ ] **Waiting time:** the sell page, Account → payouts, a held order and a rider's job card all say how many days a payout takes (the number is `PAYOUT_WAIT_DAYS`, 2 with Paystack).
- [ ] **Download card:** a brand-new visitor's first screen (even the language choice) starts with "Get the Sokoni app", the header has a Get the app icon, and it opens the how-to-install details.
- [ ] Buyers see M-Pesa, Airtel Money, Card and crypto (open the payment screen of a test order and look); Equity stays hidden until its codes are in. The card form opens OVER Sokoni (no redirect).
- [ ] Make one small LIVE M-Pesa payment and look at your Paystack balance: it should receive the order total (the buyer paid a little more — the payment fee — and Paystack kept exactly that).
- [ ] Test mode: one M-Pesa payment held, one card payment held, one payout, one M-Pesa refund, one card refund, one failed prompt — all as expected (list: 4k → “Check these in Paystack's TEST mode”).
- [ ] Then **live**: live key and Live Webhook URL; one small real payment; one real seller paid **by hand**; only then switch *Automatic payouts to M-Pesa* On.

### Fincra (replaces Equity for the PIN prompt and payouts) — see PAYMENTS-SETUP.md 4j
- [ ] **Fincra's written approval** of the marketplace model (collect, hold until delivery, pay sellers and riders), obtained by describing Sokoni exactly as it is.
- [ ] Their **prohibited-business sheet** read (docs.fincra.com/docs/faq) and the Sokoni Coin described honestly.
- [ ] Business ID, secret API key and webhook secret entered in Operations → Payment setup → Fincra; **this server's IP whitelisted** in Fincra; the **webhook address** registered; **Test connection** is green.
- [ ] One **sandbox** payment, one payout, one refund tested end to end (list: PAYMENTS-SETUP.md 4j → “Check these in the Fincra sandbox”).
- [ ] Then **live**: one small real payment; one real seller paid **by hand**; only then switch *Automatic payouts to M-Pesa* On.

## B. Settings (your `sokoni.env`)
- [ ] `SERVER_SECRET` — 30+ random characters, **different** from `ADMIN_TOKEN`. Keep it forever (it unlocks the keys saved in the admin page).
- [ ] `ADMIN_TOKEN` — a LONG random password (24+ characters; see README, "Keeping the admin console private"). No `#` at the front unless you will type it. Your admin page will be on the internet, so also consider `ADMIN_PATH` (a secret page address) and/or `ADMIN_ALLOWED_IPS`, and `TRUST_PROXY=1` if you sit behind Cloudflare.
- [ ] **Domain:** `PUBLIC_BASE_URL=https://www.sokony.com`; re-register the Equity callbacks on the new address; verify the domain with your e-mail provider (README, "Your domain").
- [ ] `PUBLIC_BASE_URL=https://your-domain` · `SOKONI_DATA_DIR=` a permanent folder · `JENGA_ENV=production` · `JENGA_ACCOUNT_NUMBER` · `JENGA_ACCOUNT_NAME`
- [ ] **Remove** `DEV_PAYMENTS`, `DEV_OTP`, `NOWPAYMENTS_SANDBOX`, and any test values. The start-up message warns if a test setting is still on.
- [ ] Decide: `PLATFORM_COMMISSION_PERCENT` (default 7), `DELIVERY_SELLER_SHARE_PCT` (30), `DELIVERY_SELLER_CAP_PCT` (10), `RIDER_CUT_PCT` (0) — see PRICING.md. Consider turning sign-in codes on (`VERIFY_CODES=1`, needs an SMS/e-mail provider) before real money flows.
- [ ] Run `node tools/check-setup.js` — it must show only ✓ lines (settings file found, all files from one download, your admin address, a strong admin password).
- [ ] Start Sokoni and read the start-up lines: *Settings read from…*, *Payments enabled…*, *Admin console: enabled*, no ⚠ warnings.

## C. Prove it with real, small amounts (in this order)
1. [ ] Operations → Payment setup → **Run all checks** (Equity) → three green steps.
2. [ ] A KES 100+ order, paid with the **M-Pesa prompt** from your own phone → held automatically.
3. [ ] **One small Pay Bill payment from EACH network you offer** (M-Pesa, Airtel Money, Equitel): open *Recent credits seen on the statement* and note how Equity wrote each line (the phone? a transaction code?). If a network's payments don't match by themselves, confirm them by hand and tell me what the narration looks like.
3b. [ ] Another paid by **Pay Bill 247247** → held within a couple of minutes. Open *Recent credits seen on the statement* and note how Equity wrote the line (tell me if it shows neither the M-Pesa code nor the phone).
4. [ ] A **bank transfer** (PesaLink from another bank) with the reference → held.
5. [ ] A **crypto** order of $2+ in USDC → "confirming" → held; USDC arrives in your wallet.
6. [ ] A **payout** to your own M-Pesa (KES 100 minimum) and one to a bank account → paid automatically.
7. [ ] A **dispute** you decide for the buyer → the **refund** goes back by itself (M-Pesa) — crypto refunds are manual.
8. [ ] A **rider** job end to end: offer → accept → pickup code → delivery code → rider paid.
9. [ ] **Notifications** on a real phone: Account → Notifications → Turn on → Send a test.
10. [ ] Install the app on an Android phone (Chrome → Install app) and on a computer.

## D. Watch after launch
- [ ] **Operations → Economics** after the first dozen real orders: is the net near 5%? Replace the assumed `COST_*` figures with your real fees.
- [ ] **Operations → Payment setup → Equity** card: balance vs *owed to sellers* (top up if short) and *Recent credits* for anything unmatched ("assign…").
- [ ] **Crypto** card: *to convert* — turn USDC into shillings and record it.
- [ ] Back-ups: the data folder is copied to a `sokoni-backups` folder automatically; also copy it somewhere else regularly.

## E. Legal and compliance (check with a lawyer and an accountant)
- [ ] **Register the business** and get a **KRA PIN**; ask your accountant about VAT/withholding on the commission and on delivery fees.
- [ ] **Data protection (Kenya's Data Protection Act, 2019):** check whether you must **register with the Office of the Data Protection Commissioner**. Publish a **Privacy Policy** that says: what you collect (names, phones, e-mails, locations, product photos, payment records), why, who receives it in general terms (payment providers, SMS/e-mail providers, **AI service providers that analyse product photos**, hosting), that some of these are **outside Kenya**, how long you keep data, and how people can ask for access or deletion. Your listing screen already tells sellers their photos and quality results may be used, without their name, to improve the quality checks — your policy must say the same. It must also say that **buyers' ratings and comments are shown publicly without their name**, that **reminders** to rate are sent by notification and e-mail, and that **order, listing and quality records are kept permanently for analytics** (in a form that shows people only as codes). (An opt-out is *not* built yet.)
- [ ] **Terms of Service**: escrow and how long money is held, disputes and who decides, the seller's delivery contribution, refunds (what is automatic, what isn't), prohibited goods, the sanctions list, your commission, **and the 0.05% coin levy (charged to both sides; half returned as fee-lowering coins)**. Say nothing about the coin being tradable or listed.
- [ ] **Payments law:** holding buyers' money before paying sellers (escrow) can count as a payment service. Ask whether you need a licence or a trust/escrow arrangement with your bank.
- [ ] **The coin levy and crypto:** you now collect real money tied to a coin. Get a lawyer's written advice **before launch**, not just before listing, and set aside at least the dollar value of the coins users hold (Operations → Economics). Don't announce a coin listing, date or price. Moving crypto for others (e.g. paying sellers in USDC) may need a virtual-asset licence. See COIN.md.

## F. What stays manual, always
Crypto refunds · refunds on foreign wire transfers or outside KES 100–140,000 · a bank deposit with no reference that fits more than one order · deciding disputes · turning USDC into shillings.
