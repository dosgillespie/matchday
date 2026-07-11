# Matchday ⚽

Pitch-side stat tracker for junior football teams, built by parents for parents.

**What it's for, in order:** (1) a better supporting experience for the parents — a shared live score and feed wherever you're standing, plus pre-match predictions settled properly at full time; (2) a record that helps the coaches — who scored and when, auto-generated match reports; (3) a season memory — when a fixture comes around again, the app shows how it went last time.

Several parents open the same web link during a match and record events in parallel — goals (with the match minute, automatically), assists, tackles and saves. The app merges everyone's entries into one live feed and auto-generates a match report and season stats.

**Predictions 🔮** — before kick-off, each parent locks in: half-time score, full-time score, minute and team of the first goal, minute and team of the last goal. Predictions lock at kick-off and are scored automatically at full time (FT exact score 15 pts / correct result 5 · HT exact 10 / result 3 · first & last goal team 5 each · first & last goal minute up to 10 each, −1 per minute off). The winner gets the 🏆 in the match summary; ranking the adults is entirely allowed.

**"Last time we played them" 📖** — type an opposition name into the new-fixture form and, if we've met them before, the app shows the previous result with a tap-through to the full report.

**Why parallel input never causes conflicts:** each device writes only to its own event "bucket" in the database, and the app merges all buckets when reading. Two parents tapping at the same instant can never overwrite each other. No accounts, no locking — you just enter your name once so entries are attributed.

**Field-tested details:**
- **Duplicate guard.** If another parent logged the same action for the same player within the last 90 seconds, the app asks "probably the same one?" before adding — the classic two-parents-log-one-goal mistake gets caught at the moment it happens, not discovered at half time.
- **Clock nudges.** Banners remind whoever's holding a phone to tap Kick off at the whistle and Start 2nd half at the restart, and the save toast flags any event recorded without a match minute.
- **Squad order, not a leaderboard.** Player tables display in shirt-number order, never sorted by goals. The stats are all there for the coach, without publicly ranking 9-year-olds in front of the parent group.

**Match-day tips:** it works fine with everyone recording everything (the duplicate guard has your back), but the smoothest pattern is a loose split — e.g. one parent owns goals/assists, another tackles/saves. And whoever taps Kick off should stand near the ref's whistle, not the tea urn.

## How it's built

- **Frontend:** React + Vite, one page, no framework beyond that. Static files.
- **Hosting:** GitHub Pages (free). Deployed automatically by GitHub Actions on every push to `main`.
- **Storage:** a free [Supabase](https://supabase.com) project — one Postgres table used as a key/value store. This is where roster, matches and events live. The GitHub Pages site itself stores nothing.
- All storage access goes through [`src/storage.js`](src/storage.js) (~60 lines), so swapping the backend means editing one file.

## What is Supabase, and who can get into it?

Supabase is a widely used "backend as a service": a company that hosts a Postgres database for you (on AWS infrastructure) with a web dashboard and an API. It plays the same role Firebase (Google) plays for many apps. Points that matter for governance:

- **You get a separate, secure admin login.** The Supabase account (dashboard) is completely separate from the parents' app. You sign in at supabase.com with an email + password (or GitHub SSO), and you can — and should — enable two-factor authentication under Account → Security. Only the account holder can see the dashboard, run SQL, change access policies, export data, or delete the project. Parents never log into Supabase; they only ever see the app.
- **The app talks to the database with a limited "anon" key**, which can only do what the access policies in [`supabase/schema.sql`](supabase/schema.sql) permit — read/write the one `kv` table. It cannot administer the project.
- **Data location is your choice.** When you create the project you pick the hosting region. **Pick "West Europe (London) — eu-west-2"** so the data stays in the UK (see setup step 1). A project's region is fixed at creation, so choose it correctly the first time.
- **Security posture:** Supabase is SOC 2 Type II audited and ISO 27001 certified, encrypts data at rest (AES-256) and in transit (TLS), and publishes a GDPR Data Processing Agreement (DPA) covering its role as a data processor. Their security page is at [supabase.com/security](https://supabase.com/security) and legal documents at [supabase.com/legal/dpa](https://supabase.com/legal/dpa).

## Information governance (UK GDPR & the club)

> This section is practical guidance from the project, not legal advice.

Even a small stats app processes **personal data of children** (names linked to performance). The v1 design keeps the data footprint deliberately tiny, and here is how the responsibilities line up:

**Roles.** Under UK GDPR, whoever decides to run this app for the team is the **data controller**. Supabase is a **data processor** acting on your instructions, under its published DPA. GitHub Pages only serves the app's code and holds no team data.

**What data exists, and what doesn't.** The database holds: player first names/initials and shirt numbers, match events (who did what, in which minute), opposition team names, the first name of the recording parent, and parents' pre-match predictions (scores and minutes, under their first name). It holds no dates of birth, no addresses, no contact details, no photos, and no accounts. Parents' own names live only in their phone's local storage plus next to their entries.

**Data minimisation.** Use first names or initials only — the app reminds you on the Squad screen. Stats about a 9-year-old's tackles tied to "Alfie B" is a much smaller matter than a full name, and works just as well on the touchline.

**Lawful basis and consent.** The clean approach for a kids' team: tell all parents what's being recorded and where it's stored, and get their agreement before adding their child — a short message in the team group and a note at sign-up is the usual grassroots pattern. If any parent objects, don't add that child (the app works fine with a partial squad).

**Individual rights.** Erasure and access are simple at this scale: the dashboard's table editor lets you view, export (CSV), or delete anything in seconds. If a parent asks for their child's data to be removed, delete the player and their events — done same day.

**Retention.** Decide up front how long stats live — e.g. delete the project (one click, everything gone) at the end of each season, or when the cohort moves on. Write the chosen period into your note to parents.

**Access reality.** v1 has no logins in the app itself: anyone who has the web link can read and write the team's data. That is a deliberate trade-off for zero-friction pitch-side use, and it is the single most important thing to explain to the club. Mitigations: share the link only within the parents' group, use first names/initials, and know that the worst case if the link leaks is disclosure of first names + football stats, not contact or identity data. If the link ever leaks or you get junk data: change `VITE_TEAM_ID`, redeploy, and re-enter the squad. Adding a team passcode or proper Supabase Auth login is the top roadmap item and a good first contribution.

**A one-page checklist to take to the club:**
1. Named person responsible (controller): ______
2. Data recorded: first names/initials, shirt numbers, match events, match minutes. Nothing else.
3. Where stored: Supabase (London region, UK), encrypted, under Supabase's GDPR DPA.
4. Who can access: parents with the link (read/write in-app); dashboard admin only via the 2FA-protected Supabase account.
5. Consent: all parents informed and agreed before their child is added.
6. Retention: deleted at ______ (e.g. end of season).
7. Erasure requests: actioned via dashboard, same day.

## Deploy your own (about 15 minutes)

### 1. Set up the database (Supabase)

1. Create a free account at [supabase.com](https://supabase.com). Immediately enable two-factor authentication (Account → Security).
2. Create a **New project** — and at this step set **Region: West Europe (London) / eu-west-2** so data stays in the UK. (Region can't be changed later without migrating.)
3. In the project dashboard, open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
4. Go to **Project Settings → API** and copy two values:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (a long string)

### 2. Put the code on GitHub

1. Create a new repository on GitHub (public is fine — the secrets stay out of the code).
2. Push this folder to it:
   ```bash
   git init
   git add .
   git commit -m "Matchday v1"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```

### 3. Add the two secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | your Project URL from step 1 |
| `VITE_SUPABASE_ANON_KEY` | your anon public key from step 1 |

(Optional: under the **Variables** tab, add `VITE_TEAM_ID` with a short name like `blades-u10` — this namespaces your data so several teams could share one database.)

### 4. Turn on GitHub Pages

In your repo: **Settings → Pages → Build and deployment → Source** → choose **GitHub Actions**.

### 5. Deploy

Go to the **Actions** tab and re-run the "Deploy to GitHub Pages" workflow (or just push any commit). When it goes green, your app is live at:

```
https://YOUR-USERNAME.github.io/YOUR-REPO/
```

Send that link to the other parents. On their phones, "Add to Home Screen" makes it feel like an app.

## Running locally

```bash
cp .env.example .env   # fill in your Supabase URL + anon key
npm install
npm run dev
```

## Using it on match day

1. First visit: enter your name (stored only on your device; shown next to your entries).
2. **Squad** tab: add the players once (first names or initials). Everyone shares this list.
3. **Matches** tab: enter the opposition, pick the half length, **Start match**, then **Kick off** — from that moment every event gets an automatic match minute.
4. Tap a player, tap the action (Goal / Assist / Tackle / Save). There's an **Opposition goal** button, and you can undo your own entries from the feed.
5. **Full time** produces the summary: score, goal timeline with minutes, per-player table, and a **Copy report for the coach** button.
6. The **Season** tab aggregates W/D/L, goals for/against, and player totals across all matches.

## Costs

£0 at this scale. GitHub Pages is free for public repos; Supabase's free tier (500 MB database) is orders of magnitude more than a season of U10 stats will use.

## Roadmap ideas (PRs welcome)

- **Team passcode or Supabase Auth login** (top priority — closes the open-link trade-off above)
- Substitutions and minutes played
- Editable event minutes (for the goal you logged 30 seconds late)
- Attempted vs completed tackles
- Realtime updates via Supabase subscriptions instead of 6-second polling
- Per-match export to CSV
- One-click "delete season" button in-app

## License

GPL-3.0-only — see [LICENSE](LICENSE). This is a copyleft license: anyone may use, modify and even sell this software, but any distributed derivative must also be released under the GPL with full source code, which prevents it being turned into a closed-source proprietary product. (Note for maintainers: for web apps specifically, the AGPL-3.0 additionally requires source disclosure from anyone *hosting* a modified version as a service; switching later is a one-file change if contributors agree.)
