# Sokoni Coin — trust collateral for produce trade

**One sentence:** Sokoni Coin is not money. It is *earned trust that can be put to work*: the more good trades you complete, the more coins you have to stand behind your word, and the more buyers can rely on you.

## Why not "a coin like Bitcoin or USDC"?
Bitcoin is valuable because it is scarce and anyone can trade it. USDC is valuable because every coin is backed by a dollar and can be cashed out at par. A coin that is **tradable and cashable** is, in Kenya, a regulated product:

- The **Virtual Asset Service Providers Act, 2025** has been in force since **4 November 2025**, and the **VASP Regulations, 2026** were gazetted on **22 July 2026**.
- There are ten licence categories. The **Central Bank (CBK)** supervises wallet providers, virtual-asset payment processors and **stablecoin issuers**; the **Capital Markets Authority (CMA)** supervises exchanges, brokers, investment advisers, asset managers, **ICO providers, tokenisation providers and token issuance platforms**.
- Minimum capital is large: reported figures are up to **KES 300 million for a stablecoin issuer**, KES 150 million for a wallet provider, KES 100 million for an exchange and about KES 20 million for ICO providers and token issuance platforms. Stablecoin issuers must also hold reserves, redeem at par, and publish independently audited reserve reports. *(Reports of the draft and final figures differ — confirm the numbers with a lawyer.)*
- Foreign providers that market to Kenyan users can fall inside the rules too.

So the choice is not "build a token or don't". It is: **do not make the coin a store of value that people can trade or cash out** — instead make it valuable for what it *unlocks*. That is the design below, and it keeps Sokoni outside those licence categories (a lawyer must confirm this once the business is registered).

## The rules of the coin (what is built today)
**Earned only, from a pool each trade creates.** When a trade completes, each side puts **0.05% of the trade value** into a pool (0.10% in all). **Half of the pool is Sokoni's** (kept in a treasury account), and **the other half is shared equally by the buyer and the seller**. **The levy is real money.** The buyer's total goes up by 0.05% of the goods value (its own line, "Coin levy", on the receipt) and the seller's payout goes down by 0.05% — so on a US$1,000 trade each side pays US$0.50, a pool of US$1.00. Sokoni receives all of that money. Half of the pool (US$0.50) is Sokoni's to keep; the other half is **returned to the two users as coins** — 25 each — which then take US$0.01 each off their future selling fees. A buyer who is refunded gets the levy back; a seller whose order is refunded is never charged it. On a US$1,000 trade (at US$0.01 a coin): 50 coins to Sokoni, 25 to the buyer, 25 to the seller. Nothing for test trades or trading with yourself. Coins can't be bought. Operations → Economics shows how many coins exist, how many Sokoni holds and how many users hold.
**Closed loop.** Coins can't be sent to anyone, sold, cashed out, or earn interest. There is no buyback, no promised price, no yield.

**What they are for**
| Use | How it works |
|---|---|
| **Fee discount** | Each coin takes about US$0.01 off your selling fee, up to 50% of the fee on a payout. Applied automatically. |
| **🛡 Trust Bond** | Lock earned coins behind your word. At least **100** locked coins earns the **Bonded** badge and a small lift in the market ranking (worth about 3 days of freshness). Buyers see how many coins stand behind the seller. |
| **Slashing** | If a seller **loses a dispute**, **half of their bond is forfeited**: half of that goes to the buyer (as coins), half is burned. Once per order. |
| **Unlocking** | Takes **14 days** and never completes while any dispute against you is open — so you can't dodge a loss by withdrawing. |
| **⭐ Boost** | Spend **20 coins a day** (1–7 days) to pin a listing to the top of the market. |

**Why this is the clever part:** the bond turns earned reputation into collateral. A seller who has traded honestly for months has real skin in the game that a brand-new account simply cannot fake — without anyone having to put up money. And because slashed coins go to the buyer or are burned, nothing is ever created from a dispute.

## Settings (all optional; defaults shown)
`COIN_LEVY_PCT=0.05` (each side) · `COIN_LEVY_CHARGED=1` (set 0 to charge nothing and only record coins) · `COIN_SOKONI_SHARE=0.5` · `COIN_USD_VALUE=0.01` · `COIN_MAX_COMMISSION_SHARE=0.5` · `BOND_MIN_COINS=100` · `BOND_COOLDOWN_DAYS=14` · `BOND_SLASH_SHARE=0.5` · `BOOST_COINS_PER_DAY=20`

## Phases
1. **Now (built):** closed-loop trust coin as above. A permanent, append-only ledger records every coin.
2. **After the business is registered and a lawyer has read this document:** consider *fast release* — a bonded seller with a clean record is paid sooner after delivery, with the bond covering the buyer's risk. Also a public "Sokoni Score" built from the same history.
3. **Only if the business case is clear and licensing is affordable:** an on-chain, **non-transferable** reputation token (it proves your record; it is not money), or a partnership with an already-licensed issuer. Do **not** issue a transferable, cashable coin without the licences above.

## What this document is not
It is a product design, not legal advice. Before any change that makes coins transferable, redeemable for cash, or promoted as an investment, take advice from a Kenyan lawyer experienced with the VASP Act.

## Listing the coin so it can be traded — read this first
You have said you would like the coin to become tradable once enough trades have happened. Two plain facts:
1. **Sokoni holding half of every coin created, with a plan to list them, is a token issuance with a promoter allocation.** Under Kenya's Virtual Asset Service Providers Act, 2025 and the 2026 Regulations, issuing or listing such a token needs a licence (the Capital Markets Authority supervises token issuance and exchanges; the Central Bank supervises stablecoins and wallets), with minimum capital in the millions of shillings.
2. **Telling users now that their coins "will be tradable" is a promise about future value.** That can be treated as promoting an investment. The app deliberately says only what is true today: coins lower your fees, can't be bought, sent or cashed out. **Don't announce a listing, a date or a price anywhere** until a Kenyan lawyer has advised you.

What *is* built is the bookkeeping: every coin is recorded in a permanent ledger with who earned it and from which trade, and Sokoni's share is tracked separately, so a future, licensed step has clean records to start from.

### Because the levy is real money, three more things
1. **You now owe users something.** The users' half of the levy is promised back as coins that lower their fees. Operations → Economics shows *the dollar value of coins users hold* — keep at least that much set aside, because that is what you would give up if every coin were used.
2. **"Pay a little now, get a tradable coin later" is the shape regulators call a token offering.** Collecting real money from the public with a stated plan to list a coin is the riskiest version of this idea. Describe the levy only as what it is today — *a small levy, half of which comes back as fee-lowering coins* — and say nothing about trading, listing, price or future value. Get a Kenyan lawyer's written advice **before** you collect this from real customers at scale, not only before you list.
3. **Your terms must say it.** The levy has to be disclosed up front in your Terms of Service and shown on every receipt (it is). Ask your accountant how it is treated for tax.
