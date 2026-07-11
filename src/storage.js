// SPDX-License-Identifier: GPL-3.0-only
// ————————————————————————————————————————————————
// Storage adapter.
//
// Shared team data (roster, matches, events) lives in one
// Supabase table shaped as a key/value store. Personal data
// (your recorder name/id) lives in this device's localStorage.
//
// Everything the app knows about storage goes through this
// file, so swapping the backend (Firebase, your own API, …)
// only ever means editing storage.js.
// ————————————————————————————————————————————————

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TEAM = import.meta.env.VITE_TEAM_ID || "default";

export const configured = Boolean(url && anonKey);

const supabase = configured ? createClient(url, anonKey) : null;

const k = (key) => `${TEAM}:${key}`;

// ——— shared (whole team sees this) ———
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
