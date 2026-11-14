# Putting Sokoni online — sokony.com on a Namecheap VPS

**The picture.** Your code lives on **GitHub** (a private copy). A small rented computer — the **VPS** at Namecheap — runs Sokoni all day and night. **Caddy** (a free web server on that computer) gives `https://www.sokony.com` its padlock and passes visitors to Sokoni. Your **domain** (sokony.com) points at the VPS. You type commands in **cmd** on your own Windows computer, and a few on the server through **ssh**.

```
 your PC ──push──▶ GitHub ──pull──▶ VPS (Ubuntu) ◀── visitors ── https://www.sokony.com
                                    ├─ Caddy  (HTTPS)
                                    ├─ Sokoni (always running, restarts itself)
                                    └─ /var/lib/sokoni  (all your data and photos)  ──daily backup──▶ your PC
```

## Read this first: which Namecheap product?
* **Buy a VPS (e.g. "Pulsar": 2 CPU cores, 2 GB RAM, about US$7–10 a month — check the checkout page; the renewal price is higher).** Choose **Ubuntu 24.04** (or 22.04), **no control panel**, **self-managed / unmanaged**.
* **Do not use Namecheap shared hosting ("Stellar" etc.) for Sokoni.** It can run small Node apps through cPanel, but programs there may be paused or killed, and Sokoni *must* stay awake: every few minutes it matches bank payments, sends payouts and refunds, sends reminders and keeps backups. It also has no root access for the web server and photo storage Sokoni needs. Keep shared hosting for e-mail or a simple website if you like.

---
## PART A — On your own computer (cmd)

### Step 1 — Check your tools
Open **cmd** and run each line:
```
node -v
git --version
ssh -V
```
* `node -v` must show **v20.9 or higher** (v22 is ideal).
* If `git` is not found, install **Git for Windows** from git-scm.com (accept the defaults), then **close and reopen cmd**.
* `ssh` is built into Windows 10/11. If it is missing: Settings → Apps → Optional features → add **OpenSSH Client**.

### Step 2 — Go to the app folder and scan for secrets
```
cd C:\Users\HomePC\Downloads\sokoni-app\sokoni-app
node tools/check-setup.js
node tools/scan-secrets.js --also "YOUR-EQUITY-ACCOUNT-NUMBER,YOUR-PHONE-NUMBER"
```
The second command lists anything that looks like a key, a password or customer data, **and** any private value you give it after `--also`. It must say **“✓ Nothing found”**. It never prints a secret. (Your settings file `sokoni.env` lives in `C:\Users\HomePC\`, *outside* this folder, and `.gitignore` also blocks it — that is deliberate.)

### Step 3 — Make a private home for the code on GitHub
1. Sign in at github.com → **New repository**.
2. Name: `sokoni`. Choose **Private**. **Do not** tick “Add a README / .gitignore / license”. Click **Create repository**.

### Step 4 — Send the code to GitHub
Still in the app folder, in cmd (replace the name and e-mail; use your GitHub user name in the web address):
```
git init -b main
git config user.name "Your Name"
git config user.email "you@example.com"
git add .
git status
```
Look at the list `git status` prints: you must **not** see `data`, `sokoni.env`, `.env` or `node_modules`. Then:
```
git commit -m "Sokoni first version"
git remote add origin https://github.com/YOUR-GITHUB-NAME/sokoni.git
git push -u origin main
```
A browser window will ask you to sign in to GitHub — approve it. (If it asks for a password in cmd instead, GitHub no longer accepts passwords: create a token at GitHub → Settings → Developer settings → Personal access tokens → *Fine-grained* → your `sokoni` repository → *Contents: Read and write*, and paste the token as the password.) Finally open the repository page in your browser and check that no settings file or data folder is there.

---
## PART B — The server

### Step 5 — Buy and start the VPS
Namecheap → **Hosting → VPS** → choose the plan → at checkout pick **Ubuntu 24.04**, **no control panel**, **unmanaged**, and the data-centre closest to Kenya that is offered. After it is ready: Namecheap **Dashboard → Product List → Manage** shows the server's **IP address** (four numbers like `203.0.113.10`) and the **root password** (also e-mailed). Write them down safely. Below, `YOUR.IP` means that address.

### Step 6 — Point sokony.com at the server
Namecheap → **Domain List → Manage** (next to sokony.com):
1. **Nameservers**: choose **Namecheap BasicDNS**.
2. **Advanced DNS** tab → delete any existing “URL Redirect” or “parking” records.
3. **Add New Record**: type **A Record**, Host `@`, Value `YOUR.IP`, TTL Automatic.
4. **Add New Record**: type **A Record**, Host `www`, Value `YOUR.IP`, TTL Automatic.

It can take a few minutes up to a few hours. Check from cmd:
```
nslookup www.sokony.com
nslookup sokony.com
```
Both must show `YOUR.IP`. (Do the next steps while you wait.)

### Step 7 — Connect to the server and lock the doors
In cmd:
```
ssh root@YOUR.IP
```
Type `yes` when asked about the fingerprint, then the root password (nothing shows while you type — that is normal). You are now typing **on the server**. Run:
```
apt update && apt -y upgrade
adduser --disabled-password --gecos "" sokoni
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
apt -y install fail2ban
timedatectl set-timezone Africa/Nairobi
```
(`ufw` is the firewall: only ssh and web traffic can reach the server. `fail2ban` blocks anyone who keeps guessing the ssh password.) Strongly recommended later: log in with an ssh key instead of a password — search “ssh key login Ubuntu” or ask me.

### Step 8 — Install Node, git and Caddy
```
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs git
node -v
apt -y install debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt -y install caddy
```
`node -v` must show v22. (The Caddy lines are from Caddy's own installation page, caddyserver.com/docs/install — if one fails, copy the current commands from there.)

### Step 9 — Put the code on the server
The server only needs to *read* your private repository, so give it a read-only “deploy key”:
```
su - sokoni
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```
Copy the line that starts with `ssh-ed25519`. In GitHub: your repository → **Settings → Deploy keys → Add deploy key** → paste it, title “vps”, leave **“Allow write access” OFF** → Add. Back on the server:
```
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
chmod 600 ~/.ssh/config
git clone git@github.com:YOUR-GITHUB-NAME/sokoni.git app
cd app
npm install --omit=dev
exit
```
(Type `yes` if asked to trust github.com. `exit` takes you back to the root prompt. If the `sharp` step prints a warning, that is allowed — it is optional; without it the duplicate-photo check is weaker.)

### Step 10 — Make the passwords and the settings file
Still as root on the server:
```
mkdir -p /etc/sokoni /var/lib/sokoni /var/backups/sokoni/app
cp /home/sokoni/app/deploy/sokoni.env.example /etc/sokoni/sokoni.env
node -e "const c=require('crypto'); console.log('ADMIN_TOKEN='+c.randomBytes(24).toString('base64url')); console.log('SERVER_SECRET='+c.randomBytes(32).toString('base64url')); console.log('ADMIN_PATH=/ops-'+c.randomBytes(8).toString('hex')+'.html')"
nano /etc/sokoni/sokoni.env
```
The `node -e` command prints three lines. In `nano`, **replace** the three `<...>` placeholder lines (`ADMIN_TOKEN`, `SERVER_SECRET`, `ADMIN_PATH`) with those three lines, and fill in `JENGA_ACCOUNT_NUMBER` and `JENGA_ACCOUNT_NAME`. Save with **Ctrl+O, Enter**, leave with **Ctrl+X**. **Copy the whole file into your password manager now** (and never paste it into a chat). Then:
```
chown -R sokoni:sokoni /var/lib/sokoni /var/backups/sokoni
chown root:sokoni /etc/sokoni/sokoni.env
chmod 640 /etc/sokoni/sokoni.env
```

### Step 11 — Check the settings
```
su - sokoni -c "cd app && SOKONI_ENV_FILE=/etc/sokoni/sokoni.env node tools/check-setup.js"
```
You want **only ✓ lines**: settings file found, all files from one download, your admin address (`http://localhost:3000/ops-….html`), a strong password. Fix anything with a ✗ before going on.

### Step 12 — Start Sokoni (and keep it running)
```
cp /home/sokoni/app/deploy/sokoni.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now sokoni
systemctl status sokoni --no-pager
journalctl -u sokoni -n 40 --no-pager
```
The log should show `Sokoni running at … (listening on 127.0.0.1 only)`, `Build: … (all files match)` and a `🔒 Admin console:` line. From now on it starts by itself when the server restarts and restarts itself if it ever crashes. (To watch it live: `journalctl -u sokoni -f`, stop with Ctrl+C.)

### Step 13 — Switch on HTTPS (Caddy)
```
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
cp /home/sokoni/app/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
systemctl status caddy --no-pager
```
Caddy gets the padlock certificate by itself — this only works once Step 6's DNS check shows the right IP.

### Step 14 — Look at it
In your browser:
* `https://www.sokony.com` → the Sokoni app, with a padlock. `https://sokony.com` should jump to the `www` address.
* `https://www.sokony.com/api/health` → a short “ok” message.
* `https://www.sokony.com/admin.html` → must say **“Not found”**.
* `https://www.sokony.com/ops-….html` (your own address from Step 10) → the admin sign-in. Sign in with your new `ADMIN_TOKEN`.

---
## PART C — After it is live
1. In **Operations → Payment setup → Equity**, copy the **new callback addresses** (they now start `https://www.sokony.com/…`) into the Jenga console, and press **Run all checks** when your credentials arrive.
2. Paste your AI key in Operations → Payment setup → AI, then **Test connection**.
3. Verify sokony.com with your e-mail provider (add the DNS records it shows in Namecheap → Advanced DNS) and set the “from” address.
4. Work through **GO-LIVE.md** (small real-money tests, privacy policy, terms, lawyer for the coin).
5. Turn on **backups** (Part E) *today*.

## PART D — Updating Sokoni later
On your PC, in the app folder:
```
node tools/stamp-build.js
npm test
node tools/scan-secrets.js
git add -A
git commit -m "What I changed"
git push
```
Then put it live (this makes a backup first, pulls, installs, checks, restarts and tests):
```
ssh root@YOUR.IP "bash /home/sokoni/app/deploy/update.sh"
```
**Going back** if a new version misbehaves: `ssh root@YOUR.IP`, then `su - sokoni -c "cd app && git log --oneline -5"`, pick the earlier line's code, run `su - sokoni -c "cd app && git checkout THAT-CODE"` and `systemctl restart sokoni`. (Your data is untouched by updates.)

## PART E — Backups (do this)
**Why:** the app's own automatic backups copy the data files only, and sit on the same disk. They do **not** include the photos, and they would vanish with the disk. `deploy/backup.sh` saves *everything* (data, photos, documents) in one file every night.
On the server, as root:
```
(crontab -l 2>/dev/null; echo "0 3 * * * bash /home/sokoni/app/deploy/backup.sh >> /var/log/sokoni-backup.log 2>&1") | crontab -
bash /home/sokoni/app/deploy/backup.sh
```
**A copy on your own computer** (so losing the server loses nothing): open `deploy\pull-backup.cmd` from the app folder in Notepad, put your server's IP address on the `SERVER=` line, save, and double-click it once a week (or schedule it in Windows Task Scheduler). The file it saves holds customer data and documents — keep it on an encrypted drive.
**Restoring** (after a disaster, on a fresh server with Steps 7–13 done): copy the backup file up with `scp C:\sokoni-offsite-backups\sokoni-DATE.tar.gz root@YOUR.IP:/root/`, then on the server `systemctl stop sokoni`, `tar -xzf /root/sokoni-DATE.tar.gz -C /var/lib`, `chown -R sokoni:sokoni /var/lib/sokoni`, `systemctl start sokoni`. You also need your settings file from the password manager (without `SERVER_SECRET` the keys saved in the admin page can't be read — you would re-enter them).

---
## PART F — How Sokoni stores photos and data (and when you will outgrow it)

**Everything lives in one folder on the server: `/var/lib/sokoni`.**
| What | Where | Notes |
|---|---|---|
| Users, listings, orders, messages, ratings, payments ledger, analytics… | `*.json` files, one per kind (`orders.json`, `listings.json`, …) | this is the “database” |
| Listing photos | `uploads/` (one `.jpg` per photo) | shown to the public by address |
| Company documents, saved keys, signing keys | `private/` | never served to the public; keys are encrypted |
| Quality-training photos + labels | `dataset/` | a second copy of each listing photo, plus labels |
| The app's own data backups | `/var/backups/sokoni/app` | data files only — **no photos** |

**Exactly where the photos are.** `uploads` inside the data folder: on your Windows computer with the settings you have now that is **`C:\sokoni-data\uploads`** (open it with `explorer C:\sokoni-data\uploads`); on the server it is **`/var/lib/sokoni/uploads`** (look with `ls -lh /var/lib/sokoni/uploads | head`). Each file is named after its listing, e.g. `3f2a…-1.jpg`, `3f2a…-2.jpg`. Private things — company documents and riders' vehicle photos — are in the `private` folder next to it, and are never shown to the public. If you are ever unsure, `node tools/check-setup.js` prints the exact folders and how many photos are in them.

**Photos.** The phone camera takes each photo at 1280 pixels wide as a JPEG (quality 85%) and Sokoni saves it as a plain file. Expect **150–350 KB per photo**, five photos per listing: about **1–1.8 MB per listing**, and the training copy doubles that to **roughly 2–3.5 MB per listing**. A 40 GB server disk therefore holds on the order of **10,000 listings** before it is full. Check with `df -h` (free disk) and `du -sh /var/lib/sokoni/*` (what is using it).

**The database is JSON files — simple, safe and fine to launch with, but not forever.** Every request that needs, say, the orders reads the *whole* `orders.json` file, and every change rewrites it (written safely: a half-finished write can never corrupt the file, and a `.bak` copy is kept). We measured this:
| Orders stored | File size | One read | One write |
|---|---|---|---|
| 1,000 | 1 MB | ~6 ms | ~12 ms |
| 10,000 | 10 MB | ~31 ms | ~103 ms |
| 50,000 | 49 MB | ~330 ms | ~718 ms |

(On a rented VPS expect numbers maybe twice as slow.) So: **up to roughly 10,000–20,000 orders it feels instant**; by 50,000 pages get sluggish and payments queue behind each other. Other limits: it runs on **one server only** (two copies would overwrite each other), there is no searching or indexing, and the busiest files (the activity log, messages, the ledger, analytics) grow fastest.

**When to move on.** Watch for pages taking over a second, `orders.json` above ~25 MB, or the disk over 70% full. The upgrade is a normal database (SQLite or PostgreSQL) for the records and a photo store (Cloudflare R2 or Amazon S3) with a CDN for the pictures. That is a planned job, not an emergency, and nothing you do now blocks it; until then, the nightly backup is your safety net. For a Kenya-first launch, this setup is a good fit.

---
## Troubleshooting
| You see | Most likely | Do this |
|---|---|---|
| `ssh: connect to host … timed out` | wrong IP, server still starting, or ssh blocked | re-check the IP in Namecheap; wait 5 minutes; |
| Browser: “site can't be reached” | DNS not updated yet, or Caddy not running | `nslookup www.sokony.com` must show your IP; `systemctl status caddy` |
| Browser warns “not secure” / Caddy log shows certificate errors | DNS not pointing to the server yet, or ports 80/443 blocked | fix DNS (Step 6); `ufw status` must list 80 and 443; `journalctl -u caddy -n 50` |
| **502 Bad Gateway** | Sokoni isn't running | `systemctl status sokoni`; `journalctl -u sokoni -n 60 --no-pager` |
| The normal Sokoni page at your admin address | `ADMIN_PATH` isn't active | run the Step 11 command and read it |
| `EACCES` / “permission denied” in the log | wrong owner on the data folder | `chown -R sokoni:sokoni /var/lib/sokoni /var/backups/sokoni` |
| `npm install` complains about `sharp` | optional picture library | safe to ignore; Sokoni still runs |
| `git pull` says “Permission denied (publickey)” | the deploy key wasn't added | redo the deploy-key part of Step 9 |
