// Two-level access gate + sync config.
//   locked  -> only the password screen
//   view    -> read-only; reads/syncs down but cannot change anything
//   edit    -> full access; changes save and sync to the shared workspace
// The gate (and sync) turn on only once BOTH real hashes are baked in; with the
// placeholders the app stays open + local-only so a deploy can't lock anyone out.
import { SUPABASE, VIEW_HASH, EDIT_HASH } from "./appconfig.js";

const ACCESS_KEY = "vs:v1:access";
const isHash = (h) => /^[0-9a-f]{64}$/i.test(h);
export const gateEnabled = isHash(VIEW_HASH) && isHash(EDIT_HASH);

export function getAccess() {
  const a = localStorage.getItem(ACCESS_KEY);
  return a === "edit" || a === "view" ? a : null;
}
export function setAccess(level) {
  localStorage.setItem(ACCESS_KEY, level);
  window.dispatchEvent(new Event("vs-config"));
}
export function clearAccess() {
  localStorage.removeItem(ACCESS_KEY);
  window.dispatchEvent(new Event("vs-config"));
}

// Whether the app is viewable at all (past the gate).
export function isUnlocked() {
  return !gateEnabled ? true : !!getAccess();
}
// Whether the user may change/save content.
export function canEdit() {
  return !gateEnabled ? true : getAccess() === "edit";
}
// Sync is active (read for view+edit) only once past the gate.
export function getConfig() {
  return gateEnabled && getAccess() ? { ...SUPABASE } : null;
}
export function isConfigured() {
  return gateEnabled && !!getAccess();
}
