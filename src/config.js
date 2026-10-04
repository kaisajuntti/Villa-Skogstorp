// Access + sync config, derived from the Supabase Auth session (auth.js).
//   logged out -> only the login screen
//   view       -> read-only; reads/syncs down but cannot change anything
//   edit       -> full access; changes save and sync to the shared workspace
// Access level = app_metadata.access on the user, set by admin (supabase/01_auth.sql).
// Anything other than 'edit' is treated as read-only (the database enforces the same).
import { SUPABASE } from "./appconfig.js";
import { getSession } from "./auth.js";

export const gateEnabled = true;

export function getAccess() {
  const s = getSession();
  if (!s) return null;
  return s.user?.app_metadata?.access === "edit" ? "edit" : "view";
}

// Whether the app is viewable at all (logged in on this device).
export function isUnlocked() {
  return !!getSession();
}
// Whether the user may change/save content.
export function canEdit() {
  return getAccess() === "edit";
}
export function currentUser() {
  return getSession()?.user || null;
}
// Sync is active (read for view+edit) only when logged in.
export function getConfig() {
  const s = getSession();
  return s ? { ...SUPABASE, user: s.user?.email || null } : null;
}
export function isConfigured() {
  return !!getSession();
}
