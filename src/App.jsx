// SPDX-License-Identifier: GPL-3.0-only
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { sGet, sSet, sList, pGet, pSet, configured, hasPass, setTeamPass, clearTeamPass, checkPass } from "./storage.js";

// ————————————————————————————————————————————————
// MATCHDAY — grassroots stat tracker, v1
// Multiple parents record in parallel: each device writes
// only to its own event "bucket" key, so nobody ever
// overwrites anyone else's taps. Reads merge all buckets.
// ————————————————————————————————————————————————

const C = {
  pitch: "#122B22",
  panel: "#1B3D30",
  panelHi: "#24503F",
  chalk: "#F4F6F1",
  chalkDim: "rgba(244,246,241,0.55)",
  line: "rgba(244,246,241,0.16)",
  hivis: "#FFB020",
  hivisDark: "#3A2400",
  danger: "#FF6B5E",
};

const ACTIONS = [
  { type: "goal", label: "Goal", emoji: "⚽" },
  { type: "assist", label: "Assist", emoji: "🅰️" },
  { type: "tackle", label: "Tackle", emoji: "🛡️" },
  { type: "save", label: "Save", emoji: "🧤" },
];
const ACTION_META = Object.fromEntries(ACTIONS.map((a) => [a.type, a]));

const uid = () => Math.random().toString(36).slice(2, 9);

async function loadEvents(matchId) {
  const keys = await sList(`evt:${matchId}:`);
  const buckets = await Promise.all(keys.map((key) => sGet(key)));
  return buckets
    .filter(Boolean)
    .flat()
    .sort((a, b) => a.t - b.t);
}

function matchMinute(match, t) {
  if (!match || !match.koTs) return null;
  const half = match.halfLen || 25;
  if (match.h2Ts && t >= match.h2Ts) {
    return Math.min(half * 2 + 10, half + Math.max(1, Math.ceil((t - match.h2Ts) / 60000)));
  }
  return Math.min(half + 10, Math.max(1, Math.ceil((t - match.koTs) / 60000)));
}

function tally(events) {
  const per = {};
  let us = 0,
    them = 0;
  for (const e of events) {
    if (e.type === "opp_goal") {
      them++;
      continue;
    }
    if (e.type === "goal") us++;
    if (e.pid) {
      per[e.pid] = per[e.pid] || { goal: 0, assist: 0, tackle: 0, save: 0 };
      per[e.pid][e.type] = (per[e.pid][e.type] || 0) + 1;
    }
  }
  return { per, us, them };
}

// Player tables display in squad order (shirt number, then name) — never
// ranked by goals. It's a team game and these are 9-year-olds; the stats
// are there without turning the app into a public leaderboard of kids.
function squadOrder(a, b) {
  const an = parseInt(a.p.num, 10);
  const bn = parseInt(b.p.num, 10);
  const aHas = !Number.isNaN(an);
  const bHas = !Number.isNaN(bn);
  if (aHas && bHas && an !== bn) return an - bn;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  return a.p.name.localeCompare(b.p.name);
}

// ——— tiny UI atoms ———
function Btn({ children, onClick, kind = "solid", style = {}, disabled }) {
  const base = {
    fontFamily: "'Barlow Condensed', system-ui, sans-serif",
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    borderRadius: 12,
    border: "none",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    padding: "14px 18px",
    fontSize: 17,
    transition: "transform 80ms",
  };
  const kinds = {
    solid: { background: C.hivis, color: C.hivisDark },
    ghost: { background: "transparent", color: C.chalk, border: `1.5px solid ${C.line}` },
    danger: {
      background: "transparent",
      color: C.danger,
      border: "1.5px solid rgba(255,107,94,0.4)",
    },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...kinds[kind], ...style }}
      onPointerDown={(e) => !disabled && (e.currentTarget.style.transform = "scale(0.97)")}
      onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      {children}
    </button>
  );
}

function Field({ value, onChange, placeholder, ...rest }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%",
        boxSizing: "border-box",
        background: "rgba(0,0,0,0.25)",
        border: `1.5px solid ${C.line}`,
        borderRadius: 12,
        color: C.chalk,
        padding: "14px 16px",
        fontSize: 17,
        outline: "none",
      }}
      {...rest}
    />
  );
}

function Eyebrow({ children }) {
  return (
    <div
      style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        fontSize: 13,
        color: C.chalkDim,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: C.pitch, color: C.chalk }}>
      <div style={{ maxWidth: 560, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
        {children}
      </div>
    </div>
  );
}

function Display({ children, size = 44 }) {
  return (
    <div
      style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        fontSize: size,
        lineHeight: 1,
      }}
    >
      {children}
    </div>
  );
}

// ————————————————————————————————————————————————
export default function App() {
  const [booted, setBooted] = useState(false);
  const [me, setMe] = useState(() => pGet("me"));
  const [roster, setRoster] = useState([]);
  const [matches, setMatches] = useState([]);
  const [screen, setScreen] = useState("home");
  const [activeId, setActiveId] = useState(null);
  const [events, setEvents] = useState([]);
  const [preds, setPreds] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [pendingDupe, setPendingDupe] = useState(null);
  const [toast, setToast] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const [passDraft, setPassDraft] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [gateMsg, setGateMsg] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [, setTick] = useState(0);
  const pollRef = useRef(null);

  const activeMatch = matches.find((m) => m.id === activeId) || null;

  const say = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const loadShared = useCallback(async () => {
    const [r, ms] = await Promise.all([sGet("roster"), sGet("matches")]);
    if (r) setRoster(r);
    if (ms) setMatches(ms);
    const live = (ms || []).find((x) => x.status === "live");
    if (live) {
      setActiveId(live.id);
      setEvents(await loadEvents(live.id));
      setPreds(await loadPredictions(live.id));
      setScreen("live");
    }
  }, []);

  useEffect(() => {
    if (!configured) {
      setBooted(true);
      return;
    }
    (async () => {
      if (!hasPass()) {
        setBooted(true);
        return; // passcode gate will show
      }
      const ok = await checkPass();
      if (ok === true) {
        setUnlocked(true);
        await loadShared();
      } else if (ok === false) {
        clearTeamPass();
        setGateMsg("The team passcode has changed — enter the new one from the group chat.");
      } else {
        setGateMsg(
          "Couldn't reach the database to check the passcode — check your signal and reload."
        );
      }
      setBooted(true);
    })();
  }, [loadShared]);

  async function submitGate() {
    if (!me && !nameDraft.trim()) {
      setGateMsg("Pop your name in too — it's shown next to what you record.");
      return;
    }
    if (!passDraft.trim()) {
      setGateMsg("Enter the team passcode from the group chat.");
      return;
    }
    setGateBusy(true);
    setGateMsg("");
    setTeamPass(passDraft);
    const ok = await checkPass();
    if (ok === true) {
      if (!me) saveMe(nameDraft);
      setUnlocked(true);
      await loadShared();
    } else if (ok === false) {
      clearTeamPass();
      setGateMsg("That's not the team passcode — check the group chat and try again.");
    } else {
      clearTeamPass();
      setGateMsg("Couldn't reach the database — check your signal and try again.");
    }
    setGateBusy(false);
  }

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    const ms = await sGet("matches");
    if (ms) setMatches(ms);
    const r = await sGet("roster");
    if (r) setRoster(r);
    if (activeId) {
      setEvents(await loadEvents(activeId));
      setPreds(await loadPredictions(activeId));
    }
  }, [activeId]);

  useEffect(() => {
    if (screen === "live" && activeId) {
      pollRef.current = setInterval(refresh, 6000);
      return () => clearInterval(pollRef.current);
    }
  }, [screen, activeId, refresh]);

  function saveMe(name) {
    const m = { name: name.trim(), rid: uid() };
    setMe(m);
    pSet("me", m);
  }

  async function saveRoster(next) {
    setRoster(next);
    await sSet("roster", next);
  }

  async function saveMatches(next) {
    setMatches(next);
    await sSet("matches", next);
  }

  async function patchMatch(id, patch) {
    const fresh = (await sGet("matches")) || matches;
    const next = fresh.map((m) => (m.id === id ? { ...m, ...patch } : m));
    await saveMatches(next);
    return next;
  }

  async function savePrediction(draft) {
    if (!activeMatch || activeMatch.koTs) {
      say("Predictions lock at kick-off");
      return;
    }
    const rec = { ...draft, name: me.name, rid: me.rid, t: draft.t || Date.now() };
    setPreds((prev) => [...prev.filter((p) => p.rid !== me.rid), rec].sort((a, b) => a.t - b.t));
    const ok = await sSet(`pred:${activeMatch.id}:${me.rid}`, rec);
    say(ok ? "Prediction locked in 🔮" : "Couldn't save — check connection");
  }

  async function record(type, pid, force = false) {
    if (!activeMatch) return;
    const t = Date.now();
    if (!force) {
      // Someone else logged the same action for the same player moments ago —
      // almost certainly the same real-world event. Check before double counting.
      const dupe = events.find(
        (e) =>
          e.type === type &&
          e.pid === (pid || null) &&
          e.rid !== me.rid &&
          Math.abs(t - e.t) < 90000
      );
      if (dupe) {
        setSheet(null);
        setPendingDupe({ type, pid, dupe });
        return;
      }
    }
    const ev = {
      id: uid(),
      t,
      type,
      pid: pid || null,
      min: matchMinute(activeMatch, t),
      by: me ? me.name : "?",
      rid: me ? me.rid : null,
    };
    setEvents((prev) => [...prev, ev].sort((a, b) => a.t - b.t)); // optimistic
    setSheet(null);
    const key = `evt:${activeMatch.id}:${me.rid}`;
    const mine = (await sGet(key)) || [];
    const ok = await sSet(key, [...mine, ev]);
    if (!ok) say("Couldn't save — check connection");
    else {
      const p = roster.find((x) => x.id === pid);
      const base =
        type === "opp_goal"
          ? "Opposition goal recorded"
          : `${ACTION_META[type].label} — ${p ? p.name : ""}`;
      say(
        ev.min
          ? `${base}${type === "opp_goal" ? "" : `, ${ev.min}'`}`
          : `${base} (no minute — clock not started)`
      );
    }
  }

  async function undo(ev) {
    if (!me || ev.rid !== me.rid) return; // can only remove your own
    const key = `evt:${activeMatch.id}:${me.rid}`;
    const mine = (await sGet(key)) || [];
    await sSet(key, mine.filter((x) => x.id !== ev.id));
    setEvents((prev) => prev.filter((x) => x.id !== ev.id));
    say("Removed");
  }

  const { per, us, them } = useMemo(() => tally(events), [events]);

  const clockLabel = (() => {
    if (!activeMatch) return "";
    if (activeMatch.status === "ft") return "FT";
    if (!activeMatch.koTs) return "Not kicked off";
    if (activeMatch.htTs && !activeMatch.h2Ts) return "Half time";
    const min = matchMinute(activeMatch, Date.now());
    return `${min}'`;
  })();

  if (!configured)
    return (
      <Shell>
        <div style={{ padding: "48px 24px" }}>
          <Display>Matchday</Display>
          <p style={{ color: C.chalkDim, lineHeight: 1.6, marginTop: 16 }}>
            The app isn't connected to a database yet. Set{" "}
            <code style={{ color: C.hivis }}>VITE_SUPABASE_URL</code> and{" "}
            <code style={{ color: C.hivis }}>VITE_SUPABASE_ANON_KEY</code> — see the README for
            the five-minute setup.
          </p>
        </div>
      </Shell>
    );

  if (!booted)
    return (
      <Shell>
        <div style={{ padding: 40, color: C.chalkDim }}>Warming up…</div>
      </Shell>
    );

  if (!unlocked || !me)
    return (
      <Shell>
        <div style={{ padding: "48px 24px" }}>
          <Display>Matchday</Display>
          <p style={{ color: C.chalkDim, lineHeight: 1.5, margin: "12px 0 20px" }}>
            One shared page for the whole touchline: a live score and feed wherever you're
            standing, pre-match predictions settled properly at full time, an automatic report for
            the coaches, and a season record — so next time we meet a team, we know how it went
            last time. You don't have to record anything — plenty of parents just watch.
          </p>
          <p style={{ color: C.chalkDim, lineHeight: 1.5, margin: "0 0 28px", fontSize: 14 }}>
            🔐 Team-only: everything is locked behind our passcode, so the kids' names and our
            scores stay inside the parents' group.
          </p>
          {!me && (
            <>
              <Eyebrow>Your name (shown next to what you record)</Eyebrow>
              <Field value={nameDraft} onChange={setNameDraft} placeholder="e.g. Dave H" />
              <div style={{ height: 14 }} />
            </>
          )}
          {me && (
            <p style={{ color: C.chalkDim, fontSize: 14, margin: "0 0 10px" }}>
              Recording as <b style={{ color: C.chalk }}>{me.name}</b>
            </p>
          )}
          <Eyebrow>Team passcode (it's in the group chat)</Eyebrow>
          <Field
            value={passDraft}
            onChange={setPassDraft}
            placeholder="e.g. orange-whistle-42"
            autoCapitalize="none"
            autoCorrect="off"
          />
          {gateMsg && (
            <p style={{ color: C.hivis, fontSize: 14, margin: "10px 0 0" }}>{gateMsg}</p>
          )}
          <div style={{ marginTop: 16 }}>
            <Btn onClick={submitGate} disabled={gateBusy} style={{ width: "100%" }}>
              {gateBusy ? "Checking…" : "Unlock"}
            </Btn>
          </div>
          <p style={{ color: C.chalkDim, fontSize: 12, marginTop: 14 }}>
            You'll only be asked once on this device.
          </p>
        </div>
      </Shell>
    );

  const nav = (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "12px 16px",
        borderBottom: `1px solid ${C.line}`,
        alignItems: "center",
      }}
    >
      {[
        ["home", "Matches"],
        ["season", "Season"],
        ["roster", "Squad"],
      ].map(([s, label]) => (
        <button
          key={s}
          onClick={async () => {
            await refresh();
            setScreen(s);
          }}
          style={{
            background: screen === s ? C.panelHi : "transparent",
            color: screen === s ? C.chalk : C.chalkDim,
            border: "none",
            borderRadius: 10,
            padding: "8px 14px",
            fontFamily: "'Barlow Condensed', sans-serif",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          {label}
        </button>
      ))}
      <div style={{ marginLeft: "auto", color: C.chalkDim, fontSize: 13 }}>{me.name}</div>
    </div>
  );

  return (
    <Shell>
      {nav}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            background: C.hivis,
            color: C.hivisDark,
            padding: "10px 18px",
            borderRadius: 999,
            fontWeight: 700,
            fontSize: 14,
            zIndex: 50,
            boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          }}
        >
          {toast}
        </div>
      )}

      {pendingDupe && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            style={{
              background: C.panelHi,
              borderRadius: 18,
              padding: 22,
              maxWidth: 420,
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <Display size={24}>Already logged?</Display>
            <p style={{ lineHeight: 1.5, margin: "12px 0 18px", fontSize: 15 }}>
              <b>{pendingDupe.dupe.by}</b> recorded the same{" "}
              {pendingDupe.type === "opp_goal"
                ? "opposition goal"
                : `${ACTION_META[pendingDupe.type].label.toLowerCase()} for ${
                    (roster.find((x) => x.id === pendingDupe.pid) || {}).name || "this player"
                  }`}{" "}
              {Math.max(1, Math.round((Date.now() - pendingDupe.dupe.t) / 1000))}s ago — probably
              the same one, so it's already counted.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              <Btn kind="ghost" onClick={() => setPendingDupe(null)}>
                Same one — don't add
              </Btn>
              <Btn
                onClick={() => {
                  const { type, pid } = pendingDupe;
                  setPendingDupe(null);
                  record(type, pid, true);
                }}
              >
                Different — add it
              </Btn>
            </div>
          </div>
        </div>
      )}

      {screen === "roster" && <RosterScreen roster={roster} saveRoster={saveRoster} say={say} />}

      {screen === "home" && (
        <HomeScreen
          matches={matches}
          onStart={async (opp, halfLen) => {
            if (roster.length === 0) {
              say("Add players to the squad first");
              setScreen("roster");
              return;
            }
            const m = {
              id: uid(),
              opp: opp.trim() || "Opposition",
              date: new Date().toISOString().slice(0, 10),
              halfLen,
              status: "live",
              koTs: null,
              htTs: null,
              h2Ts: null,
            };
            await saveMatches([m, ...matches]);
            setActiveId(m.id);
            setEvents([]);
            setPreds([]);
            setScreen("live");
          }}
          onOpen={async (m) => {
            setActiveId(m.id);
            setEvents(await loadEvents(m.id));
            setPreds(await loadPredictions(m.id));
            setScreen(m.status === "live" ? "live" : "summary");
          }}
        />
      )}

      {screen === "live" && activeMatch && (
        <LiveScreen
          match={activeMatch}
          roster={roster}
          events={events}
          per={per}
          us={us}
          them={them}
          clockLabel={clockLabel}
          me={me}
          sheet={sheet}
          setSheet={setSheet}
          record={record}
          undo={undo}
          refresh={refresh}
          onKickOff={() => patchMatch(activeMatch.id, { koTs: Date.now() })}
          onHalfTime={() => patchMatch(activeMatch.id, { htTs: Date.now() })}
          onSecondHalf={() => patchMatch(activeMatch.id, { h2Ts: Date.now() })}
          onFullTime={async () => {
            await patchMatch(activeMatch.id, { status: "ft", ftTs: Date.now(), gf: us, ga: them });
            setScreen("summary");
          }}
          preds={preds}
          onSavePred={savePrediction}
        />
      )}

      {screen === "summary" && activeMatch && (
        <SummaryScreen match={activeMatch} roster={roster} events={events} preds={preds} />
      )}

      {screen === "season" && <SeasonScreen matches={matches} roster={roster} />}
    </Shell>
  );
}

// ————————————————— roster —————————————————
function RosterScreen({ roster, saveRoster, say }) {
  const [name, setName] = useState("");
  const [num, setNum] = useState("");
  return (
    <div style={{ padding: 20 }}>
      <Eyebrow>Shared squad list</Eyebrow>
      <Display size={32}>Squad</Display>
      <p style={{ color: C.chalkDim, fontSize: 13, margin: "10px 0 0" }}>
        Tip: use first names or initials — this list is visible to everyone with the link.
      </p>
      <div style={{ display: "flex", gap: 8, margin: "18px 0" }}>
        <div style={{ width: 72 }}>
          <Field value={num} onChange={setNum} placeholder="#" inputMode="numeric" />
        </div>
        <Field value={name} onChange={setName} placeholder="Player name" />
        <Btn
          onClick={() => {
            if (!name.trim()) return;
            saveRoster([...roster, { id: uid(), name: name.trim(), num: num.trim() }]);
            setName("");
            setNum("");
            say("Added");
          }}
        >
          Add
        </Btn>
      </div>
      {roster.length === 0 && (
        <p style={{ color: C.chalkDim }}>No players yet. Add the squad before the first match.</p>
      )}
      {roster.map((p) => (
        <div
          key={p.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 4px",
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          <span
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 700,
              width: 34,
              color: C.hivis,
              fontSize: 20,
            }}
          >
            {p.num || "–"}
          </span>
          <span style={{ flex: 1, fontSize: 17 }}>{p.name}</span>
          <button
            onClick={() => saveRoster(roster.filter((x) => x.id !== p.id))}
            style={{
              background: "none",
              border: "none",
              color: C.chalkDim,
              cursor: "pointer",
              fontSize: 15,
            }}
          >
            remove
          </button>
        </div>
      ))}
    </div>
  );
}

// ————————————————— home —————————————————
function HomeScreen({ matches, onStart, onOpen }) {
  const [opp, setOpp] = useState("");
  const [halfLen, setHalfLen] = useState(25);

  // "How did we do last time?" — match the typed opposition against the record.
  const prev = useMemo(() => {
    const key = opp.trim().toLowerCase();
    if (key.length < 3) return null;
    return (
      matches.find((m) => {
        if (m.status !== "ft") return false;
        const name = m.opp.trim().toLowerCase();
        return name === key || name.includes(key) || key.includes(name);
      }) || null
    );
  }, [opp, matches]);
  const [prevScore, setPrevScore] = useState(null);
  useEffect(() => {
    if (!prev) {
      setPrevScore(null);
      return;
    }
    if (prev.gf != null) {
      setPrevScore({ gf: prev.gf, ga: prev.ga });
      return;
    }
    let alive = true;
    loadEvents(prev.id).then((evs) => {
      if (!alive) return;
      const t = tally(evs);
      setPrevScore({ gf: t.us, ga: t.them });
    });
    return () => {
      alive = false;
    };
  }, [prev]);

  return (
    <div style={{ padding: 20 }}>
      <Eyebrow>New fixture</Eyebrow>
      <Field value={opp} onChange={setOpp} placeholder="Opposition, e.g. Hillsborough Colts" />
      {prev && prevScore && (
        <button
          onClick={() => onOpen(prev)}
          style={{
            background: "none",
            border: "none",
            color: C.hivis,
            cursor: "pointer",
            fontSize: 14,
            padding: "8px 2px 0",
            textAlign: "left",
          }}
        >
          📖 Last time vs {prev.opp} ({prev.date}):{" "}
          {prevScore.gf > prevScore.ga ? "Won" : prevScore.gf < prevScore.ga ? "Lost" : "Drew"}{" "}
          {prevScore.gf}–{prevScore.ga} — tap for the full report
        </button>
      )}
      <div style={{ display: "flex", gap: 8, margin: "12px 0 8px", alignItems: "center" }}>
        <span style={{ color: C.chalkDim, fontSize: 14 }}>Half length:</span>
        {[20, 25, 30].map((n) => (
          <button
            key={n}
            onClick={() => setHalfLen(n)}
            style={{
              background: halfLen === n ? C.hivis : "transparent",
              color: halfLen === n ? C.hivisDark : C.chalkDim,
              border: `1.5px solid ${halfLen === n ? C.hivis : C.line}`,
              borderRadius: 999,
              padding: "6px 14px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {n} min
          </button>
        ))}
      </div>
      <Btn onClick={() => onStart(opp, halfLen)} style={{ width: "100%", marginTop: 8 }}>
        Start match
      </Btn>

      <div style={{ marginTop: 32 }}>
        <Eyebrow>Match record</Eyebrow>
        {matches.length === 0 && <p style={{ color: C.chalkDim }}>No matches yet.</p>}
        {matches.map((m) => (
          <MatchRow key={m.id} m={m} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function MatchRow({ m, onOpen }) {
  const [score, setScore] = useState(m.gf != null ? `${m.gf}–${m.ga}` : null);
  useEffect(() => {
    if (m.gf != null) return;
    let alive = true;
    loadEvents(m.id).then((evs) => {
      if (!alive) return;
      const t = tally(evs);
      setScore(`${t.us}–${t.them}`);
    });
    return () => {
      alive = false;
    };
  }, [m.id, m.gf]);
  return (
    <button
      onClick={() => onOpen(m)}
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        gap: 12,
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 14,
        padding: "14px 16px",
        marginBottom: 10,
        cursor: "pointer",
        color: C.chalk,
        textAlign: "left",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 17, fontWeight: 600 }}>vs {m.opp}</div>
        <div style={{ color: C.chalkDim, fontSize: 13 }}>{m.date}</div>
      </div>
      <Display size={26}>{score !== null ? score : "–"}</Display>
      <span
        style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontSize: 13,
          color: m.status === "live" ? C.hivis : C.chalkDim,
        }}
      >
        {m.status === "live" ? "Live" : "FT"}
      </span>
    </button>
  );
}

// ————————————————— live —————————————————
function LiveScreen(props) {
  const {
    match, roster, events, per, us, them, clockLabel, me,
    sheet, setSheet, record, undo, refresh,
    onKickOff, onHalfTime, onSecondHalf, onFullTime,
    preds, onSavePred,
  } = props;

  const phaseBtn = !match.koTs ? (
    <Btn onClick={onKickOff}>Kick off</Btn>
  ) : !match.htTs ? (
    <Btn kind="ghost" onClick={onHalfTime}>Half time</Btn>
  ) : !match.h2Ts ? (
    <Btn onClick={onSecondHalf}>Start 2nd half</Btn>
  ) : (
    <Btn kind="ghost" onClick={onFullTime}>Full time</Btn>
  );

  return (
    <div>
      {/* scoreboard */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: `linear-gradient(180deg, ${C.panelHi}, ${C.panel})`,
          borderBottom: `2px solid ${C.hivis}`,
          padding: "18px 20px 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <Display size={40}>US</Display>
          <Display size={54}>
            <span style={{ color: C.hivis }}>{us}</span>
            <span style={{ color: C.chalkDim, padding: "0 6px" }}>–</span>
            <span style={{ color: C.hivis }}>{them}</span>
          </Display>
          <Display size={40}>
            <span style={{ fontSize: 24, color: C.chalkDim }}>vs</span> {match.opp}
          </Display>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <span
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: C.hivis,
              minWidth: 44,
            }}
          >
            {clockLabel}
          </span>
          <div style={{ flex: 1 }} />
          {phaseBtn}
        </div>
      </div>

      {!match.koTs && (
        <div style={{ background: "rgba(255,176,32,0.12)", color: C.hivis, padding: "10px 20px", fontSize: 14 }}>
          ⏱ Tap <b>Kick off</b> at the whistle — until then, events save without a match minute.
        </div>
      )}
      {match.koTs && match.htTs && !match.h2Ts && (
        <div style={{ background: "rgba(255,176,32,0.12)", color: C.hivis, padding: "10px 20px", fontSize: 14 }}>
          🍊 Half time. Tap <b>Start 2nd half</b> at the restart so minutes stay accurate.
        </div>
      )}

      <div style={{ padding: 16 }}>
        {!match.koTs && (
          <PredictionPanel
            preds={preds}
            me={me}
            locked={false}
            onSave={onSavePred}
            oppName={match.opp}
          />
        )}
        {match.koTs && preds.length > 0 && (
          <p style={{ color: C.chalkDim, fontSize: 13, margin: "0 0 14px" }}>
            🔮 {preds.length} prediction{preds.length === 1 ? "" : "s"} in (
            {preds.map((p) => p.name).join(", ")}) — settled automatically at full time.
          </p>
        )}
        <Eyebrow>Tap a player, then the action</Eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {roster.map((p) => {
            const s = per[p.id];
            const active = sheet === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setSheet(active ? null : p.id)}
                style={{
                  background: active ? C.hivis : C.panel,
                  color: active ? C.hivisDark : C.chalk,
                  border: `1.5px solid ${active ? C.hivis : C.line}`,
                  borderRadius: 14,
                  padding: "16px 12px",
                  cursor: "pointer",
                  textAlign: "left",
                  minHeight: 74,
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span
                    style={{
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 700,
                      fontSize: 20,
                      color: active ? C.hivisDark : C.hivis,
                    }}
                  >
                    {p.num || ""}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 17 }}>{p.name}</span>
                </div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                  {s
                    ? `⚽${s.goal || 0}  🅰️${s.assist || 0}  🛡️${s.tackle || 0}  🧤${s.save || 0}`
                    : "—"}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 12 }}>
          <Btn kind="danger" style={{ width: "100%" }} onClick={() => record("opp_goal", null)}>
            Opposition goal
          </Btn>
        </div>

        <div style={{ marginTop: 28 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Eyebrow>Match feed</Eyebrow>
            <button
              onClick={refresh}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                color: C.chalkDim,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              ↻ refresh
            </button>
          </div>
          {events.length === 0 && (
            <p style={{ color: C.chalkDim, fontSize: 15 }}>
              Nothing yet. Every parent's entries appear here — the feed re-checks every few
              seconds.
            </p>
          )}
          {[...events].reverse().map((e) => {
            const p = roster.find((x) => x.id === e.pid);
            const meta = ACTION_META[e.type];
            return (
              <div
                key={e.id}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 2px",
                  borderBottom: `1px solid ${C.line}`,
                  fontSize: 15,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 700,
                    color: C.hivis,
                    width: 34,
                  }}
                >
                  {e.min ? `${e.min}'` : "–"}
                </span>
                <span style={{ flex: 1 }}>
                  {e.type === "opp_goal" ? (
                    <span style={{ color: C.danger }}>⚽ Opposition goal</span>
                  ) : (
                    <>
                      {meta ? meta.emoji : ""} {meta ? meta.label : e.type} —{" "}
                      <b>{p ? p.name : "?"}</b>
                    </>
                  )}
                  <span style={{ color: C.chalkDim, fontSize: 12 }}> · {e.by}</span>
                </span>
                {e.rid === me.rid && (
                  <button
                    onClick={() => undo(e)}
                    style={{
                      background: "none",
                      border: "none",
                      color: C.chalkDim,
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    undo
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* action sheet */}
      {sheet && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 40,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setSheet(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: C.panelHi,
              borderRadius: "20px 20px 0 0",
              padding: "20px 20px 32px",
              width: "100%",
              maxWidth: 560,
              boxSizing: "border-box",
            }}
          >
            <Display size={26}>{(roster.find((x) => x.id === sheet) || {}).name}</Display>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
              {ACTIONS.map((a) => (
                <Btn
                  key={a.type}
                  onClick={() => record(a.type, sheet)}
                  style={{ padding: "20px 12px", fontSize: 19 }}
                >
                  {a.emoji} {a.label}
                </Btn>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ————————————————— summary —————————————————
function SummaryScreen({ match, roster, events, preds }) {
  const { per, us, them } = tally(events);
  const goals = events.filter((e) => e.type === "goal" || e.type === "opp_goal");
  const rows = roster
    .map((p) => ({ p, s: per[p.id] || { goal: 0, assist: 0, tackle: 0, save: 0 } }))
    .sort(squadOrder);
  const result = us > them ? "Win" : us < them ? "Loss" : "Draw";

  const copyReport = () => {
    const lines = [
      `MATCH REPORT — vs ${match.opp} (${match.date})`,
      `Final score: Us ${us}–${them} ${match.opp} (${result})`,
      ``,
      `Goals:`,
      ...goals.map((g) => {
        const p = roster.find((x) => x.id === g.pid);
        return g.type === "opp_goal"
          ? `  ${g.min || "?"}' — ${match.opp}`
          : `  ${g.min || "?"}' — ${p ? p.name : "?"}`;
      }),
      ``,
      `Player stats (G/A/Tackles/Saves):`,
      ...rows
        .filter((r) => r.s.goal + r.s.assist + r.s.tackle + r.s.save > 0)
        .map((r) => `  ${r.p.name}: ${r.s.goal}/${r.s.assist}/${r.s.tackle}/${r.s.save}`),
    ];
    if (navigator.clipboard) navigator.clipboard.writeText(lines.join("\n"));
  };

  return (
    <div style={{ padding: 20 }}>
      <Eyebrow>{match.date} · Full time</Eyebrow>
      <Display size={36}>
        Us{" "}
        <span style={{ color: C.hivis }}>
          {us}–{them}
        </span>{" "}
        {match.opp}
      </Display>
      <div style={{ color: C.chalkDim, marginTop: 6 }}>{result}</div>

      <div style={{ marginTop: 26 }}>
        <Eyebrow>Goal timeline</Eyebrow>
        {goals.length === 0 && <p style={{ color: C.chalkDim }}>Goalless.</p>}
        {goals.map((g) => {
          const p = roster.find((x) => x.id === g.pid);
          return (
            <div
              key={g.id}
              style={{
                display: "flex",
                gap: 12,
                padding: "8px 0",
                borderBottom: `1px solid ${C.line}`,
              }}
            >
              <span
                style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 700,
                  color: C.hivis,
                  width: 36,
                }}
              >
                {g.min ? `${g.min}'` : "–"}
              </span>
              <span style={{ color: g.type === "opp_goal" ? C.danger : C.chalk }}>
                ⚽ {g.type === "opp_goal" ? match.opp : p ? p.name : "?"}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 26 }}>
        <Eyebrow>Player stats</Eyebrow>
        <StatTable rows={rows} />
      </div>

      {preds && preds.length > 0 && (
        <PredictionResults match={match} events={events} preds={preds} />
      )}

      <div style={{ marginTop: 24 }}>
        <Btn kind="ghost" style={{ width: "100%" }} onClick={copyReport}>
          Copy report for the coach
        </Btn>
      </div>
    </div>
  );
}

function StatTable({ rows }) {
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 44px 44px 44px 44px",
          color: C.chalkDim,
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          padding: "6px 0",
        }}
      >
        <span>Player</span>
        <span>⚽</span>
        <span>🅰️</span>
        <span>🛡️</span>
        <span>🧤</span>
      </div>
      {rows.map(({ p, s }) => (
        <div
          key={p.id}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 44px 44px 44px 44px",
            padding: "10px 0",
            borderBottom: `1px solid ${C.line}`,
            fontSize: 16,
          }}
        >
          <span>{p.name}</span>
          <span>{s.goal || "·"}</span>
          <span>{s.assist || "·"}</span>
          <span>{s.tackle || "·"}</span>
          <span>{s.save || "·"}</span>
        </div>
      ))}
    </div>
  );
}

// ————————————————— season —————————————————
function SeasonScreen({ matches, roster }) {
  const [agg, setAgg] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const per = {};
      let w = 0, d = 0, l = 0, gf = 0, ga = 0;
      for (const m of matches) {
        const evs = await loadEvents(m.id);
        const t = tally(evs);
        gf += t.us;
        ga += t.them;
        if (m.status === "ft") {
          if (t.us > t.them) w++;
          else if (t.us < t.them) l++;
          else d++;
        }
        for (const [pid, s] of Object.entries(t.per)) {
          per[pid] = per[pid] || { goal: 0, assist: 0, tackle: 0, save: 0 };
          for (const key of Object.keys(s)) per[pid][key] += s[key];
        }
      }
      if (alive) setAgg({ per, w, d, l, gf, ga });
    })();
    return () => {
      alive = false;
    };
  }, [matches]);

  if (!agg) return <div style={{ padding: 24, color: C.chalkDim }}>Adding it all up…</div>;

  const rows = roster
    .map((p) => ({ p, s: agg.per[p.id] || { goal: 0, assist: 0, tackle: 0, save: 0 } }))
    .sort(squadOrder);

  return (
    <div style={{ padding: 20 }}>
      <Eyebrow>Season so far</Eyebrow>
      <Display size={32}>
        W{agg.w} · D{agg.d} · L{agg.l}
      </Display>
      <div style={{ color: C.chalkDim, marginTop: 6 }}>
        Goals for {agg.gf} · against {agg.ga} · {matches.length} match
        {matches.length === 1 ? "" : "es"} recorded
      </div>
      <div style={{ marginTop: 26 }}>
        <Eyebrow>Totals — in squad order, it's a team game</Eyebrow>
        <StatTable rows={rows} />
      </div>
    </div>
  );
}

// ————————————————— predictions —————————————————
// Each parent's prediction lives in its own key (pred:{matchId}:{rid}) —
// same bucket pattern as events, so parallel submissions never collide.

async function loadPredictions(matchId) {
  const keys = await sList(`pred:${matchId}:`);
  const rows = await Promise.all(keys.map((key) => sGet(key)));
  return rows.filter(Boolean).sort((a, b) => a.t - b.t);
}

function outcome(us, them) {
  return us > them ? 1 : us < them ? -1 : 0;
}

function actualFromMatch(match, events) {
  const ft = tally(events);
  const halfLen = match.halfLen || 25;
  const htEvents = events.filter((e) =>
    match.htTs ? e.t <= match.htTs : (e.min || 0) <= halfLen
  );
  const ht = tally(htEvents);
  const goals = events.filter((e) => e.type === "goal" || e.type === "opp_goal");
  const mk = (g) => ({ min: g.min != null ? g.min : null, team: g.type === "goal" ? "us" : "them" });
  return {
    ft: { us: ft.us, them: ft.them },
    ht: { us: ht.us, them: ht.them },
    first: goals.length ? mk(goals[0]) : null,
    last: goals.length ? mk(goals[goals.length - 1]) : null,
  };
}

// Scoring: FT exact 15 / result 5 · HT exact 10 / result 3 ·
// first/last goal team 5 each · first/last goal minute up to 10 each (−1 per minute off).
// Goal categories are skipped for everyone in a goalless game, and minute
// categories are skipped if the clock wasn't running when the goal was logged.
function scorePrediction(p, a) {
  let pts = 0;
  const detail = [];
  if (p.ftUs === a.ft.us && p.ftThem === a.ft.them) {
    pts += 15;
    detail.push("FT score spot on +15");
  } else if (outcome(p.ftUs, p.ftThem) === outcome(a.ft.us, a.ft.them)) {
    pts += 5;
    detail.push("FT result +5");
  }
  if (p.htUs === a.ht.us && p.htThem === a.ht.them) {
    pts += 10;
    detail.push("HT score spot on +10");
  } else if (outcome(p.htUs, p.htThem) === outcome(a.ht.us, a.ht.them)) {
    pts += 3;
    detail.push("HT result +3");
  }
  if (a.first) {
    if (p.firstTeam === a.first.team) {
      pts += 5;
      detail.push("1st-goal team +5");
    }
    if (a.first.min != null) {
      const d = Math.max(0, 10 - Math.abs((p.firstMin || 0) - a.first.min));
      if (d > 0) {
        pts += d;
        detail.push(`1st-goal minute +${d}`);
      }
    }
  }
  if (a.last) {
    if (p.lastTeam === a.last.team) {
      pts += 5;
      detail.push("last-goal team +5");
    }
    if (a.last.min != null) {
      const d = Math.max(0, 10 - Math.abs((p.lastMin || 0) - a.last.min));
      if (d > 0) {
        pts += d;
        detail.push(`last-goal minute +${d}`);
      }
    }
  }
  return { pts, detail };
}

function fmtPred(p, oppShort) {
  const team = (t) => (t === "us" ? "Us" : oppShort);
  return `HT ${p.htUs}–${p.htThem} · FT ${p.ftUs}–${p.ftThem} · 1st: ${team(p.firstTeam)} ${p.firstMin}' · last: ${team(p.lastTeam)} ${p.lastMin}'`;
}

function Stepper({ label, value, onChange }) {
  const btn = {
    background: "rgba(0,0,0,0.25)",
    border: `1.5px solid ${C.line}`,
    color: C.chalk,
    borderRadius: 10,
    width: 40,
    height: 40,
    fontSize: 20,
    cursor: "pointer",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: C.chalkDim, fontSize: 13, width: 44 }}>{label}</span>
      <button style={btn} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <span
        style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontWeight: 700,
          fontSize: 26,
          minWidth: 26,
          textAlign: "center",
          color: C.hivis,
        }}
      >
        {value}
      </span>
      <button style={btn} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

function TeamToggle({ value, onChange, oppShort }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[
        ["us", "Us"],
        ["them", oppShort],
      ].map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          style={{
            background: value === v ? C.hivis : "transparent",
            color: value === v ? C.hivisDark : C.chalkDim,
            border: `1.5px solid ${value === v ? C.hivis : C.line}`,
            borderRadius: 999,
            padding: "7px 14px",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function MinuteField({ value, onChange }) {
  return (
    <input
      value={String(value)}
      onChange={(e) => {
        const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
        onChange(Number.isNaN(n) ? 0 : Math.min(99, n));
      }}
      inputMode="numeric"
      style={{
        width: 58,
        boxSizing: "border-box",
        background: "rgba(0,0,0,0.25)",
        border: `1.5px solid ${C.line}`,
        borderRadius: 10,
        color: C.hivis,
        padding: "8px 10px",
        fontSize: 18,
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        textAlign: "center",
        outline: "none",
      }}
    />
  );
}

function PredictionPanel({ preds, me, locked, onSave, oppName }) {
  const oppShort = oppName.split(" ")[0];
  const mine = preds.find((p) => p.rid === me.rid);
  const [draft, setDraft] = useState(
    mine || {
      htUs: 1, htThem: 0, ftUs: 2, ftThem: 1,
      firstMin: 10, firstTeam: "us", lastMin: 40, lastTeam: "us",
    }
  );
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div
      style={{
        margin: "0 0 20px",
        background: C.panel,
        border: `1.5px solid ${C.line}`,
        borderRadius: 16,
        padding: 16,
      }}
    >
      <Eyebrow>Predictions — lock in before kick-off 🔮</Eyebrow>
      {!locked && (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <div style={{ color: C.chalkDim, fontSize: 13, marginBottom: 6 }}>Half time</div>
              <div style={{ display: "grid", gap: 8 }}>
                <Stepper label="Us" value={draft.htUs} onChange={set("htUs")} />
                <Stepper label={oppShort} value={draft.htThem} onChange={set("htThem")} />
              </div>
            </div>
            <div>
              <div style={{ color: C.chalkDim, fontSize: 13, marginBottom: 6 }}>Full time</div>
              <div style={{ display: "grid", gap: 8 }}>
                <Stepper label="Us" value={draft.ftUs} onChange={set("ftUs")} />
                <Stepper label={oppShort} value={draft.ftThem} onChange={set("ftThem")} />
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <div style={{ color: C.chalkDim, fontSize: 13, marginBottom: 6 }}>First goal</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <MinuteField value={draft.firstMin} onChange={set("firstMin")} />
                <span style={{ color: C.chalkDim }}>′ by</span>
                <TeamToggle value={draft.firstTeam} onChange={set("firstTeam")} oppShort={oppShort} />
              </div>
            </div>
            <div>
              <div style={{ color: C.chalkDim, fontSize: 13, marginBottom: 6 }}>Last goal</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <MinuteField value={draft.lastMin} onChange={set("lastMin")} />
                <span style={{ color: C.chalkDim }}>′ by</span>
                <TeamToggle value={draft.lastTeam} onChange={set("lastTeam")} oppShort={oppShort} />
              </div>
            </div>
          </div>
          <Btn style={{ width: "100%" }} onClick={() => onSave(draft)}>
            {mine ? "Update my prediction" : "Lock in my prediction"}
          </Btn>
        </>
      )}
      {locked && (
        <p style={{ color: C.chalkDim, fontSize: 14, margin: "4px 0 10px" }}>
          Locked at kick-off — scored automatically at full time.
        </p>
      )}
      {preds.length > 0 && (
        <div style={{ marginTop: locked ? 0 : 14 }}>
          {preds.map((p) => (
            <div
              key={p.rid}
              style={{
                padding: "8px 0",
                borderBottom: `1px solid ${C.line}`,
                fontSize: 14,
              }}
            >
              <b>{p.name}</b>
              <span style={{ color: C.chalkDim }}> — {fmtPred(p, oppShort)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PredictionResults({ match, events, preds }) {
  const oppShort = match.opp.split(" ")[0];
  const actual = actualFromMatch(match, events);
  const scored = preds
    .map((p) => ({ p, ...scorePrediction(p, actual) }))
    .sort((a, b) => b.pts - a.pts || a.p.t - b.p.t);
  const top = scored.length ? scored[0].pts : 0;
  return (
    <div style={{ marginTop: 26 }}>
      <Eyebrow>Prediction league 🔮</Eyebrow>
      {!actual.first && (
        <p style={{ color: C.chalkDim, fontSize: 13 }}>
          Goalless game — goal categories skipped, scores only.
        </p>
      )}
      {scored.map(({ p, pts, detail }) => {
        const winner = pts === top && pts > 0;
        return (
          <div key={p.rid} style={{ padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 16 }}>
                {winner ? "🏆 " : ""}
                {p.name}
              </span>
              <span
                style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 700,
                  color: C.hivis,
                  fontSize: 20,
                  marginLeft: "auto",
                }}
              >
                {pts} pts
              </span>
            </div>
            <div style={{ color: C.chalkDim, fontSize: 13, marginTop: 2 }}>
              {fmtPred(p, oppShort)}
            </div>
            {detail.length > 0 && (
              <div style={{ color: C.chalkDim, fontSize: 12, marginTop: 2 }}>
                {detail.join(" · ")}
              </div>
            )}
          </div>
        );
      })}
      <p style={{ color: C.chalkDim, fontSize: 12, marginTop: 10 }}>
        Scoring: FT exact 15 / result 5 · HT exact 10 / result 3 · first & last goal team 5 each ·
        first & last goal minute up to 10 each (−1 per minute off).
      </p>
    </div>
  );
}
