# Making Sokoni a real app

Sokoni is a website that already behaves like an app. You can take it further in stages. Each stage reuses the same code — you never rebuild it.

## Stage 1 — Install it from the browser (built, free, works today)
This is a "Progressive Web App" (PWA). The app now has an icon, a manifest, a service worker and an offline page.

| Device | How to install |
|---|---|
| **Windows / Mac (Chrome or Edge)** | Open the site → click the **install icon** at the right end of the address bar (or menu ⋮ → *Cast, save and share* → *Install Sokoni*). It works on `http://localhost:3000` too. |
| **Android (Chrome)** | Open your **public https address** → Sokoni shows a **"Get the Sokoni app"** banner → tap **Install**. (Or menu ⋮ → *Install app*.) |
| **iPhone / iPad (Safari)** | Open the site → **Share** button → **Add to Home Screen**. (iPhones don't show an install banner; this is the way.) |

What people get: their own icon, full-screen with no browser bar, home-screen shortcuts (long-press the icon: **Sell produce**, **My orders**, **Messages**), a friendly page when they're offline, and updates that arrive by themselves — no store, no waiting.

What it deliberately does *not* do: it never stores listings, prices, orders, payments or photos for offline use. Live money data always comes fresh from the server.

**You need:** a public **https** address (the same one payments need — see PAYMENTS-SETUP.md section 2). Phones will not install an app from a plain `http://` or a `localhost` address.

Test it yourself: Chrome → press F12 → **Application** tab → **Manifest** (should list the icons and show no errors) and **Service workers** (should say "activated and is running").

## Stage 2 — Google Play (Android) with the same code
Android phones dominate in Kenya, so this is the next stage. Google Play accepts a website wrapped as an app (a "Trusted Web Activity"): it opens Sokoni full-screen, with no browser bar, and appears in the Play Store.

1. **Deploy** Sokoni on a public https domain.
2. **Create the package** with the free **PWABuilder** website (pwabuilder.com — paste your address, choose *Android*) or Google's **Bubblewrap** command-line tool. You get an `.aab` file.
3. **Tell Sokoni who the app is.** In Play Console copy the app's **package name** (for example `africa.sokoni.app`) and its **signing certificate SHA-256 fingerprint**, then set on your server:
   `ANDROID_PACKAGE=africa.sokoni.app` and `ANDROID_SHA256=AA:BB:…` (several fingerprints can be comma-separated).
   Sokoni then publishes `/.well-known/assetlinks.json` automatically — Android uses it to confirm the app and the website belong together (without it you see a browser bar).
4. **Upload** to Play Console and fill in the listing: screenshots, a privacy-policy web address, the data-safety form, content rating.

**What it costs and how long it takes** (checked October 2026):
- A Play developer account costs **US$25, once** (not per app, not per year).
- **A new *personal* account** (created after 13 November 2023) must first run a **closed test with at least 12 testers who stay opted in for 14 continuous days** before Google lets you apply for production. Budget about **three weeks** for a first launch. A tester who leaves before day 14 doesn't count — start with more than 12.
- **An *organisation* account** skips the 12-tester rule, but needs business verification, which can take longer. Since you plan to register a business anyway, create the account in the business's name.
- Google is also introducing developer verification for apps installed from outside Play; publishing through Play Store itself isn't affected.

## Stage 3 — Apple App Store (only if iPhone users matter)
- An Apple developer account is **US$99 per year**.
- Apple's review guidelines reject apps that are just a repackaged website. A plain wrapper is likely to be refused, so you would wrap Sokoni with **Capacitor** and add real native features (for example push notifications and the camera). That is a larger piece of work.
- iPhone apps can only be built with Apple's Xcode, which runs **only on a Mac**. Without one, use a cloud build service (several offer rented Macs by the minute).
- Meanwhile iPhone users can already add Sokoni to their home screen (Stage 1).

## Stage 4 — A fully native app (React Native or Flutter)
Only worth it if you outgrow the above. It is a rebuild of the screens, and your server (everything in `server.js` and `lib/`) stays as it is.

## What I'd do
1. **Now:** Stage 1 — nothing to build, just deploy it and install it.
2. **When your business is registered and the site is deployed:** Stage 2, creating the Play account in the business's name; start recruiting 12+ testers (friends, family, your first sellers) as soon as the account exists.
3. **Later, if iPhone users ask for it:** Stage 3.

## Push notifications are built
Turn them on in **Account → Notifications**. People are told about a new order, an accepted order, a payment held, a rider offer or assignment, pickup and delivery, a payout, a dispute and new chat messages. They work on Android (Chrome) and on a computer; on iPhone only for the app added to the Home Screen. Messages are encrypted for each device; the server only talks to the real push services (Google, Mozilla, Apple, Microsoft). The sender identity is made once and kept in the data folder — keep that folder private and permanent. English only for now.

## Not built yet
Notification wording in Swahili and the other languages.

## Changing the icon
The icon is drawn in `tools/make-icons.js`. Edit the colours or shapes and run `node tools/make-icons.js` (needs `npm install sharp --no-save` once) to regenerate every size.

## The download card (what visitors see about the app)
The **first screen a visitor sees — even the language choice — and the first page after signing in** start with a "Get the Sokoni app" card: what the app gives (full-screen from its own icon, works on weak internet, order and payment alerts, live photos built in) and two buttons. When the browser can install the app (Chrome and Edge on Android and computers) the main button is **Install now**. When it can't (iPhone, Safari, Firefox) it is **Show me how**, and **What you get** opens a panel that explains the benefits and the exact install steps for iPhone/iPad, Android and a computer, marking the visitor's own device. The header also carries a **Get the app** icon on every page. Closing the card hides it for a week (never for ever); once the app is installed the card and the icon disappear. The Account page keeps a "See details" button. All of it is translated (Swahili and French are hand-written; other languages are translated automatically once the AI key is on).
