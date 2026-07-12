// SPDX-License-Identifier: GPL-3.0-only
// ————————————————————————————————————————————————
// Storage adapter.
//
// Shared team data (roster, matches, events, predictions) lives in one
// Supabase table shaped as a key/value store, protected by a team
// passcode: the app sends the passcode as a header with every request,
// and the database's row-level-security policies reject anything without
// the correct code. The passcode itself lives only in the database
// (see supabase/schema.sql) and in each parent's localStorage — never
// in this repo or the built site.
//
// Personal data (your recorder name/id, your copy of the passcode)
// lives in this device's localStorage.
// ————————————————————————————————————————————————

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TEAM = import.meta.env.VITE_TEAM_ID || "default";

export const configured = Boolean(url && anonKey);

const PASS_KEY = "matchday:teampass";

function currentPass() {
  try {
    return localStorage.getItem(PASS_KEY) || "";
  } catch {
    return "";
  }
}

let supabase = null;
function rebuildClient() {
  supabase = configured
    ? createClient(url, anonKey, {
        global: { headers: { "x-matchday-pass": currentPass() } },
      })
    : null;
}
rebuildClient();

export function hasPass() {
  return currentPass().length > 0;
}

export function setTeamPass(pass) {
  try {
    localStorage.setItem(PASS_KEY, pass.trim());
  } catch {
    /* ignore */
  }
  rebuildClient();
}

export function clearTeamPass() {
  try {
    localStorage.removeItem(PASS_KEY);
  } catch {
    /* ignore */
  }
  rebuildClient();
}

// Returns true (correct), false (wrong), or null (couldn't reach the database).
export async function checkPass() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("check_pass");
  if (error) return null;
  return data === true;
}

const k = (key) => `${TEAM}:${key}`;

// ——— shared (whole team sees this, passcode required) ———
export async function sGet(key) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("kv")
    .select("value")
    .eq("key", k(key))
    .maybeSingle();
  if (error) return null;
  return data ? data.value : null;
}

export async function sSet(key, value) {
  if (!supabase) return false;
  const { error } = await supabase
    .from("kv")
    .upsert({ key: k(key), value, updated_at: new Date().toISOString() });
  return !error;
}

export async function sList(prefix) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("kv")
    .select("key")
    .like("key", `${k(prefix)}%`);
  if (error || !data) return [];
  return data.map((r) => r.key.slice(TEAM.length + 1));
}

// ——— personal (this device only) ———
export function pGet(key) {
  try {
    const v = localStorage.getItem(`matchday:${key}`);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export function pSet(key, value) {
  try {
    localStorage.setItem(`matchday:${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
