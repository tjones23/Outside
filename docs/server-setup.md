# Handoff: host Outside on the server

You are a Claude Code agent on the machine that will host **Outside**
(https://github.com/tjones23/Outside). This file is the whole brief: what the
app is, how it must be hosted, one launcher feature you need to build, and how
to prove it works. It was written on a development Mac where Outside was built
and tested. Outside does **not** run there any more.

Read `AGENTS.md` before you touch any Next.js code. This is Next 16, and it
differs from what you may know. Its docs are in `node_modules/next/dist/docs/`.

## Goal

When you're done, all of this should be true on this machine:

- Outside's production build runs on port **3001** (`next start`, never `next dev`).
- It is reachable from the tailnet at **`https://outside.<tailnet>.ts.net`**.
  - Plain port 443, no `:8443`.
  - The name belongs to a **separate Tailscale node named `outside`** that only
    Outside's launcher runs, alongside whatever Tailscale this machine already uses.
  - The tailnet is `haddock-sunfish.ts.net`, so the expected URL is
    `https://outside.haddock-sunfish.ts.net`.
- Optionally, it is also reachable on the local network at `http://<lan-ip>:3001`.
  - The user asked for local network plus tailnet. Offer it, and turn it on if they want it.
- It is started and stopped with the repo's launchers, the same way as WhatsGood.
- It doesn't interfere with WhatsGood if WhatsGood is hosted here too, which is likely.

Decisions already made with the user. Don't reopen them:

- **No Caddy.** LAN is plain HTTP; HTTPS comes only from Tailscale.
- **No auth.** It's reachable only on the LAN and the tailnet, and it holds no personal data server-side.
- **A separate Tailscale node for Outside**, not Tailscale Services and not a second
  port on this machine's node. It stays within the free Personal plan: user-owned
  devices are unlimited. It must be a normal node, **not ephemeral**.

## What Outside is (60-second version)

- **What it shows:** live NWS tornado and severe-thunderstorm warnings and watches,
  SPC storm reports, SPC outlooks (with CIG hatching) and NOAA MRMS radar, on a
  Leaflet map. It also has Reports, Alerts, Places and Settings pages.
- **Data flow:** every upstream is keyless. Server-side fetches sit behind `use cache`
  (`src/lib/sources/`), and the browser polls `/api/*`.
- **State:** filters, saved places and notification settings live in each browser's
  localStorage. There is no database.
- **Config:** optional `.env.local` with `OUTSIDE_CONTACT`, the User-Agent contact.
  It defaults to the repo URL. Nothing is required.
- **Secure-context features:** location and notifications work only in a secure
  context — the tailnet HTTPS address and `localhost`. The UI explains this on the
  LAN address. That's expected, not a bug.
- **Notifications:** they come from the open page polling once a minute. There is
  no push server.

Hosting is modeled on WhatsGood's launchers (github.com/tjones23/WhatsGood, branch
`build-whatsgood`):

- `run-prod.command` / `run-dev.command` with a shared `scripts/run-common.sh`.
- The closed-lid sleep hold is shared between both apps through `scripts/lid-hold.sh`.
  It must stay **byte-identical** in both repos.

## Step 0 — look before changing anything

Run these and read the output:

```bash
uname -a; sw_vers 2>/dev/null          # the launchers are macOS-only (caffeinate, pmset, ioreg)
node -v; npm -v                         # Node 20.9+ required; the dev Mac used Node 26
command -v tailscale tailscaled; tailscale version
ps aux | grep -iE 'tailscale|IPNExtension' | grep -v grep
tailscale status; tailscale serve status
ls ~/Documents/Dev 2>/dev/null          # is WhatsGood checked out here? on which branch?
lsof -nP -iTCP:3000 -iTCP:3001 -sTCP:LISTEN
```

What to look for:

- **Not macOS?** Stop and tell the user. The launchers depend on macOS tools. On
  Linux, the equivalent is a systemd unit for `next start` plus the same userspace
  `tailscaled` described below. Propose that and ask before building it.
- **Two Tailscale clients.** The dev Mac had both Tailscale.app and a Homebrew
  `tailscaled` running. They showed up as two nodes, and the bare `tailscale` CLI
  silently switched to the app's daemon. Outside's new node avoids this entirely by
  always passing its own `--socket`. Note what you find, and tell the user if WhatsGood
  is affected: WhatsGood's launcher uses the bare CLI.
- **Missing `tailscaled`.** You need a standalone `tailscaled` binary for the separate
  node. The App Store / standalone Tailscale.app doesn't provide one you can run like
  this. If `command -v tailscaled` finds nothing, `brew install tailscale`. You only
  need the binary; don't `brew services start` it.
- **WhatsGood here.** If WhatsGood is checked out here, make sure it's on
  `build-whatsgood` at or after commit `9da6731` ("Share the Mac with Outside"), so
  both apps share the lid-hold registry. Pull it if the user agrees; it's their repo.

## Step 1 — clone and verify the app

```bash
cd ~/Documents/Dev            # or wherever the user keeps projects; ask if unclear
git clone https://github.com/tjones23/Outside.git && cd Outside
npm install
npm test && npm run typecheck && npm run lint
npm run check:sources          # every upstream should pass
./run-prod.command rebuild     # production build; does not start it
./run-prod.command start       # 127.0.0.1:3001 only
curl -s localhost:3001/api/alerts | head -c 200
```

Known facts about the upstreams, all already handled in the code:

- **Radar (NOAA MRMS):** this server draws it. While someone has radar on,
  `/api/mrms` fetches the last hour from `mrms.ncep.noaa.gov` (about 1.2 MB a
  frame, every ten minutes) and writes tiles through zoom 9 to `.outside/mrms/`
  (tens of MB, pruned as frames age out). Nothing runs while nobody is looking,
  and there is no extra process or job to start. It covers the continental US only.
- **Basemap:** the map uses Esri Dark Gray Canvas, because CARTO's dark tiles now
  demand an API key.
- **Per-request rendering:** pages are rendered per request (`RenderPerRequest` in
  `src/app/layout.tsx`). That's required so the nonce-based CSP can stamp Next's
  inline scripts. Don't "optimize" it back to static.

## Step 2 — build the separate-node feature in the launcher

Today `scripts/run-common.sh` hosts on the tailnet with the **machine's own node**:
it runs `tailscale serve --bg --https=$TS_HTTPS_PORT $PORT`, with `TS_HTTPS_PORT`
defaulting to 8443. Change it so Outside runs **its own userspace `tailscaled`**,
and serves from that node on 443.

### Design

1. **Settings.** Add these near `PORT`:

   ```bash
   TS_NODE_NAME="${OUTSIDE_TS_HOSTNAME:-outside}"
   TS_STATE_DIR="$STATE_DIR/tailscale"          # .outside/ is already gitignored
   TS_SOCKET="$TS_STATE_DIR/tailscaled.sock"
   TS_DAEMON_LOG="$TS_STATE_DIR/tailscaled.log"
   TSD_BIN="$(command -v tailscaled || echo /opt/homebrew/opt/tailscale/bin/tailscaled)"
   ```

   - Change the `TS_HTTPS_PORT` default to **443**. The node is Outside's alone, so
     there's no port to share.
   - Keep `OUTSIDE_TS_PORT` as the override.
   - Keep `TS_BIN` as the `tailscale` CLI.

2. **One wrapper for every CLI call.** Add `ts() { "$TS_BIN" --socket="$TS_SOCKET" "$@"; }`
   and replace **every** `"$TS_BIN" …` call with `ts …`. That includes `ts_state`,
   `ts_hostname`, `ts_serve_url`, `ts_connect`, `ts_unserve` and the `serve --bg` call
   in `run-prod.command`'s `tailnet_on`. After this, nothing in Outside's scripts may
   touch the machine's own Tailscale.

3. **Start and stop the daemon.** No root needed in userspace mode.

   ```bash
   ts_daemon_running() { ts status --json --peers=false >/dev/null 2>&1; }

   ts_daemon_start() {
     ts_daemon_running && return 0
     mkdir -p "$TS_STATE_DIR"
     detach "$TS_DAEMON_LOG" "$TSD_BIN" --tun=userspace-networking \
       --statedir="$TS_STATE_DIR" --socket="$TS_SOCKET" --port=0
     # wait up to ~15s for the socket to answer, surfacing a crash via the log
   }

   ts_daemon_stop() {
     # `ts down` is not needed; just end the process and remove the stale socket
   }
   ```

   `detach` already exists in `run-common.sh`: it uses `setsid`, so the daemon
   survives the terminal closing.

4. **`ts_connect`.** Start the daemon, then check `ts_state`:
   - `NeedsLogin` or `NoState` (first run): run `ts up --hostname="$TS_NODE_NAME"`
     **in the foreground, without `--timeout`**. It prints a login URL. Tell the
     person to open it, and wait. Only do this when a human is attached (`[ -t 0 ]`).
     Otherwise fail with the instruction `./run-prod.command tailnet` from a terminal.
   - `Stopped`: run `ts up --hostname="$TS_NODE_NAME"`.
   - The comment in the existing `ts_connect` about never passing flags to `up` applies
     to a *shared* node with prefs owned by someone else. This node is ours, so always
     pass the same `--hostname`.

5. **`tailnet_on` / `tailnet_off`.**
   - `tailnet_on` = daemon start, then connect, then (server already running)
     `ts serve --bg --https="$TS_HTTPS_PORT" "$PORT"`.
   - `tailnet_off` = `ts_unserve`, then `ts_daemon_stop`. The node shows offline in the
     admin console until next time. It is **not** deleted, and the saved state means no
     re-login.
   - `stop_server` already calls `ts_unserve` unless it is passed `keep-serve`; make it
     also stop the daemon on a full stop.
   - Once the name is confirmed, `print_urls` should show `https://outside.<tailnet>.ts.net`.

6. **Name collisions.** If the tailnet already has an `outside`, Tailscale hands out
   `outside-1`. After `up`, read `ts_hostname` and print the real URL. If it isn't
   `outside.<tailnet>.ts.net`, tell the user the old node exists and can be removed in
   the admin console.

7. **Status and menus.**
   - `status` and `menu_header` should name the node and say whether its daemon is running.
   - The `hosting_active` / lid-hold logic needs no change: it keys off `ts_serve_url`,
     which now reads Outside's own socket.

8. **Docs.**
   - Update `README.md` "Hosting it": the address table, and the "Running alongside
     WhatsGood" paragraph. Outside no longer uses 8443 — it has its own node.
   - Update the header comments of both `.command` files and the `.env.example`
     comments (`OUTSIDE_TS_HOSTNAME`, `OUTSIDE_TS_PORT`).
   - WhatsGood's README has a matching paragraph mentioning 8443. Offer to fix it, as
     a separate commit in that repo.

Keep the code in the same style as the rest of the script: small functions,
comments that say *why*, `say` / `ok` / `warn` / `err` for output. Match
WhatsGood's tone. `bash -n` every script you touch.

## Step 3 — the user's part

Tell the user plainly when each of these is needed. None can be done by you:

1. **Open the login URL** that `./run-prod.command tailnet` prints the first time,
   signed in as the tailnet owner.
2. **In the Tailscale admin console → Machines → `outside` → "Disable key expiry"**,
   or the node drops off in about 180 days and needs another login.
3. **Optional: keep the Mac awake with the lid closed.** Run `./run-prod.command setup`
   (it asks for their password). This installs a sudoers rule allowing only
   `pmset -a disablesleep 0|1`.
   - Skip it if WhatsGood's `setup` was already run here. The rule is checked by
     command, and either app's rule serves both.
   - If this is a desktop Mac that never closes a lid, it doesn't matter.
4. **Optional: local network too.** `./run-prod.command lan`.

## Step 4 — verify

Check each of these, and report exactly what passed and what didn't:

```bash
./run-prod.command tailnet
./run-prod.command status
ts() { tailscale --socket=.outside/tailscale/tailscaled.sock "$@"; }; ts status; ts serve status
curl -sS -o /dev/null -w '%{http_code}\n' https://outside.haddock-sunfish.ts.net/
#   (first request can take ~30s while the certificate is issued)
curl -sS https://outside.haddock-sunfish.ts.net/api/reports?days=1 | head -c 200
tailscale serve status        # the machine's own node: must NOT list Outside
```

- **From another tailnet device** (ask the user to open the URL on their phone):
  - The map loads, and radar can be turned on in Filters.
  - The locate button works, which proves the secure context.
  - On iPhone, notifications need Add to Home Screen first.
- **Stop and start again.** `./run-prod.command tailnet off` withdraws the node, and the
  URL stops answering. `tailnet` brings it back without a new login.
- **Reboot survival (optional, ask first).** After a reboot nothing starts on its own;
  that is by design, just like WhatsGood. `./run-prod.command tailnet` should bring it
  back without a login.
- **If WhatsGood runs here too:**
  - Host both.
  - Confirm each launcher's `status` shows only its own URL.
  - Confirm `tailnet off` on one leaves the other up.
  - Confirm sleep stays disabled (`pmset -g | grep SleepDisabled`) until *both* stop.
    This needs `setup` done.
- **Nothing left behind:** after `./run-prod.command stop`, no `tailscaled` with
  Outside's socket is running, and no `caffeinate -i -w` remains for its pid.

## Step 5 — commit

- Commit the launcher change and docs to Outside on a branch, then ask the user
  before merging or pushing to `main`.
- End commit messages with the co-author line your harness specifies.
- Don't commit anything under `.outside/`. That's where the node's Tailscale state
  (its keys) lives, and it's gitignored; check that it stays out of `git status`.

## Reference: ports and names

| | WhatsGood | Outside |
|---|---|---|
| Next server | 3000 | 3001 (`OUTSIDE_PORT`) |
| Tailnet | machine's own node, 443 | own node `outside`, 443 |
| LAN | `http://<ip>:3000` | `http://<ip>:3001` |
| Lid-hold registry | `~/.local/state/lid-hold/` (shared) | same |
| Runtime state | `.whatsgood/` | `.outside/` (incl. `tailscale/`) |
