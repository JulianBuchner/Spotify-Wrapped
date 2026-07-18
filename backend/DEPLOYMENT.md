# Deployment & Database Guide

How to ship a backend change to the Raspberry Pi, and how to pull the live database
down to this PC to browse it with Prisma Studio.

## The setup (for reference)

| Thing | Value |
|---|---|
| Pi SSH | `julian@julian-pi.fritz.box` (passwordless key already configured) |
| Repo on Pi | `/home/julian/Spotify-Wrapped` (git `origin` = your GitHub, branch `master`) |
| Backend on Pi | `/home/julian/Spotify-Wrapped/backend` |
| Process manager | **pm2**, app name **`Spotify-Wrapped-backend`** (runs `dist/server.js`) |
| Node | v20.19.6 via **nvm** (auto-loads in an interactive SSH session) |
| Live database | `/home/julian/Spotify-Wrapped/backend/dev.db` (SQLite) |
| Auto-start on reboot | enabled (`pm2 save` already done) |
| Daily backups | `~/spotify-wrapped-backups/backup_db.sh` via cron at 03:15, keeps last 14 |

> The TypeScript is **compiled** before it runs (`npm run build` → `dist/`), and pm2 runs
> the compiled `dist/server.js`. So a source change is not live until you build **and**
> restart pm2.

---

## 1. Deploy a backend update

### On this PC — commit and push
```powershell
cd D:\Coding\Spotify-Wrapped
git add .
git commit -m "your message"
git push
```

### On the Pi — pull, build, restart
Open an interactive SSH session (so `node`/`npm`/`pm2` are on PATH):
```powershell
ssh julian@julian-pi.fritz.box
```
Then, on the Pi:
```bash
cd ~/Spotify-Wrapped
git pull

cd backend
npm install        # only needed if package.json dependencies changed
npm run build      # compile TypeScript -> dist/
pm2 restart Spotify-Wrapped-backend

# verify it came back up cleanly
pm2 logs Spotify-Wrapped-backend --lines 30
```
Press `Ctrl+C` to stop tailing the logs. Type `exit` to leave the Pi.

**Quick health check** (from the Pi, or replace `127.0.0.1` when off-box):
```bash
curl -s http://127.0.0.1:3000/health        # -> {"status":"ok"}
curl -s http://127.0.0.1:3000/api/plays/count
```

> **If `git pull` complains** about local changes to `backend/package-lock.json`
> (the Pi sometimes rewrites it during `npm install`), discard the Pi's copy and pull again:
> ```bash
> git checkout -- backend/package-lock.json
> git pull
> ```

---

## 2. Copy the newest database to this PC (for Prisma Studio)

Never copy the live `dev.db` with a plain `scp` while the app is writing — you can get a
corrupt file. Instead make a **consistent snapshot** first. The easiest way is to run the
existing backup script on the Pi (it produces a clean snapshot and updates `dev-latest.db`),
then download that.

Run this from a **PowerShell window on this PC** (close Prisma Studio first if it's open,
otherwise the file is locked):

```powershell
# 1. Make a fresh, consistent snapshot on the Pi
ssh julian@julian-pi.fritz.box "bash ~/spotify-wrapped-backups/backup_db.sh"

# 2. Download it over the local dev.db  (the -O flag avoids a Windows scp "broken pipe")
scp -O julian@julian-pi.fritz.box:/home/julian/spotify-wrapped-backups/backups/dev-latest.db "D:\Coding\Spotify-Wrapped\backend\dev.db"

# 3. Browse it
cd D:\Coding\Spotify-Wrapped\backend
npx prisma studio
```

That's it — Prisma Studio opens at http://localhost:5555 showing the full play history.

> The local `backend\dev.db` is only ever a **throwaway copy for browsing**. The real,
> authoritative database is the one on the Pi. Overwriting the local copy loses nothing.

---

## Troubleshooting

- **`pm2: command not found` (or `node`/`npm`) over SSH** — this only happens with
  non-interactive one-liners like `ssh host "pm2 ..."`, because nvm isn't loaded.
  Either run it inside an interactive session (just `ssh julian@julian-pi.fritz.box` first),
  or prefix the command:
  ```bash
  export PATH=$HOME/.nvm/versions/node/v20.19.6/bin:$PATH; pm2 list
  ```

- **Is it actually running?**
  ```bash
  pm2 list          # Spotify-Wrapped-backend should be "online"
  pm2 logs Spotify-Wrapped-backend --lines 50
  ```

- **It crashed / won't start** — check the logs above, then:
  ```bash
  pm2 restart Spotify-Wrapped-backend
  ```

- **After a Pi reboot** it should come back automatically. If it didn't:
  ```bash
  pm2 resurrect
  ```

- **Confirm new data is being recorded** — the play count should climb over a few minutes:
  ```bash
  curl -s http://127.0.0.1:3000/api/plays/count
  ```

> **Reminder:** backups currently live only on the Pi's SD card. If that card fails, the
> backups die with the database. Consider an off-Pi copy (pull to this PC on a schedule,
> or push to a NAS/cloud) before relying on it long-term.
