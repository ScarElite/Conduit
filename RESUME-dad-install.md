# RESUME — Getting Conduit onto Dad's computer

Status as of 2026-07-13. Everything is built and staged. **One manual step left.**
(2026-07-13: v1.0.2 published — Ctrl+V/right-click paste, clickable links,
scroll-nav buttons. OneDrive folder refreshed to the v1.0.2 installer.
Terminal improvements ongoing; sharing with Dad deferred until they're done.)

---

## 2026-07-16 — Dad's app stuck on an old version

His install isn't picking up releases. The update FEED is healthy (verified:
`update.electronjs.org/ScarElite/Conduit/win32-x64/1.0.2` correctly serves the
latest release), so the problem is on his machine. Likely one of:

1. **He installed the old v1.0.0 from the OneDrive folder** — v1.0.0 predates
   the auto-updater entirely (added in v1.0.1). It will never update itself.
2. **He never relaunches Conduit** — updates download in the background but only
   apply on the NEXT launch. (v1.0.8 adds a "restart to update" pill so this is
   visible now.)
3. **Short sessions** — the full update is a ~180 MB download; if he opens the
   app for only a minute, the download may never finish before he closes it.

**The reliable fix (one phone call):** have him download and run the installer
again from the permanent link — it updates in place, no uninstall needed:
https://github.com/ScarElite/Conduit/releases/latest/download/ConduitSetup.exe
(SmartScreen warning again: "More info" → "Run anyway".)

That lands him on v1.0.8+, which has a `/update` command you can talk him
through ("type `/`, pick update, Enter"), a version badge in the title bar to
confirm what he's running, and a title-bar pill whenever an update is staged.

**Debugging his machine:** v1.0.8 logs every updater event to
`%TEMP%\conduit-diag.log` (`update: checking / downloading / ready / error …`)
— read that file to see exactly why an update isn't landing.

---

## THE ONE THING LEFT TO DO

Share the OneDrive folder with Dad. This can't be scripted — do it in File Explorer:

1. Open `C:\Users\mra02\OneDrive\Conduit for Dad\`
2. Right-click the folder → **Share**
3. Set to **"Anyone with the link"** ← important, or he'll need a Microsoft account
4. **Copy link** → text it to him

Then he's on his own with the instructions. Done.

---

## What's already done

- Built a fresh **v1.0.0** installer via `npm run make`.
- Staged the share folder `C:\Users\mra02\OneDrive\Conduit for Dad\` containing:
  - `ConduitSetup.exe` (172 MB) — self-contained; he needs no Node, no repo, no dev tools
  - `START HERE.txt` — plain-English walkthrough written for him

`START HERE.txt` covers, in order: download → SmartScreen bypass → install →
Claude Code install → sign-in → troubleshooting.

---

## Things to know / likely failure points

**SmartScreen is the big one.** The installer isn't code-signed, so Windows shows
"Windows protected your PC" and the **Run anyway** button is *hidden until he clicks
"More info"*. This is where a non-technical person gives up and assumes it's a virus.
The note calls this out explicitly, but **be on the phone with him for this moment if
you can.**

**Claude Code needs a PAID plan.** Free Claude accounts do NOT include Claude Code.
He needs Pro or Max from https://claude.com/pricing *before* he starts. Flagged in the
note, but it's the other hard dead-end.

**He must restart Conduit after installing Claude Code**, or `claude` won't be on PATH.
Own step in the note; also in its troubleshooting list.

**Claude Code install command** (verified current against official docs, 2026-07-11):
```powershell
irm https://claude.ai/install.ps1 | iex
```
Works because Conduit spawns PowerShell by default (`pwsh.exe` if present, else
`powershell.exe` — see `src/main/pty.ts:18`). On his fresh machine it'll be
`powershell.exe`. No admin rights needed; native installer auto-updates itself.

If PowerShell blocks it with "running scripts is disabled":
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Shipping him an update later — AUTOMATIC as of v1.0.1 (2026-07-12)

The repo is now **public** and the app auto-updates from GitHub Releases
(update.electronjs.org, wired via `update-electron-app` in `src/main/main.ts`,
`notifyUser: false`). Installed apps check on launch + every 10 min, download
silently, and switch over on the **next launch** — never mid-session.

To ship an update now:

1. Bump `version` in `package.json` — still not optional, Squirrel keys on it.
2. `npm run publish` (needs `GITHUB_TOKEN`; the stored git credential works).
   That builds AND uploads the release. Done — his installed app picks it up
   by itself within ~10 minutes and applies it next time he opens Conduit.

No more copying installers to OneDrive for updates. The OneDrive folder only
matters for his FIRST install (or point him at the permanent link:
https://github.com/ScarElite/Conduit/releases/latest/download/ConduitSetup.exe).

---

## Considered but not done

- ~~**GitHub Release** (ScarElite/Conduit)~~ — DONE 2026-07-12. Repo made public
  (secret-scanned full history first — clean), releases published via
  `@electron-forge/publisher-github`.
- **Code signing** — would kill the SmartScreen warning entirely. Costs money
  (cert + reputation build-up). Only worth it if Conduit goes wider than family.
