# Dark Sun Essentials — working notes

## Where the code lives vs. where it runs

All editing happens in this repo checkout on the Mac. **Nothing is verified here.**

Live testing happens on Chris's Foundry install on the Pi, over Tailscale:

```
ssh chris@raspberrypi.minskin-chinstrap.ts.net
```

(The `chris@` matters — a bare hostname SSH fails Tailscale's local-user lookup.)

### The remote install

| | |
|---|---|
| Foundry | v14, build 365 (`/home/chris/foundry/main.js`) |
| dnd5e | 5.3.3 |
| User data | `/mnt/foundry/foundryuserdata` (symlinked as `~/foundryuserdata`) |
| Module dir | `~/foundryuserdata/Data/modules/dark-sun-essentials` |
| Server | port 30000, run under PM2 as process `foundry` |
| Restart | `pm2 restart foundry` |

Those versions match `module.json`'s `verified` fields (Foundry 14, dnd5e 5.3.3),
so the Pi is the exact target we claim compatibility with.

The installed module is a **copy**, not a symlink to a checkout — deploying means
pushing files over and restarting:

```
rsync -av --delete \
  --exclude '.git*' --exclude test --exclude docs --exclude node_modules \
  --exclude package.json --exclude CLAUDE.md --exclude .DS_Store \
  ./ chris@raspberrypi.minskin-chinstrap.ts.net:foundryuserdata/Data/modules/dark-sun-essentials/
```

then `ssh chris@raspberrypi.minskin-chinstrap.ts.net pm2 restart foundry`.

It overwrites a live module directory and bounces the server, so ask before
pushing and dry-run (`-n`) first if anything about the tree has changed.

There's also a `foundry-relay` systemd service on port 3010 ("Foundry VTT REST
API Relay", driving a headless Chromium). It may be a way to poke the running
world programmatically; nobody has tried using it for module testing yet.

## What counts as tested

- `npm test` (`node --test test/*.test.mjs`) runs locally and covers the pure
  logic: coinage, config shape, i18n keys, manifest, migration, world script.
  It is a pre-flight check, not proof.
- Anything touching Foundry hooks, dnd5e config mutation, the settings UI, item
  properties, or vehicles needs a real load on the Pi before it's called done.
- Report local test results and remote verification separately. If a change was
  only tested locally, say so.
