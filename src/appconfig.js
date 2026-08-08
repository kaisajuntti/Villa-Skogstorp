// Baked-in configuration for this one project (Villa Skogstorp).
// The publishable key is browser-safe; the password gates below are a light lock
// to keep the page private (not cryptographic security — the repo is public).
export const SUPABASE = {
  url: "https://xeoxxqahepdedjgfhfbo.supabase.co",
  key: "sb_publishable_hocvLC9wkoHeMiM0kGhx9g_Q3dZtZkW",
  workspace: "skogstorp",
};

// SHA-256 (hex, lowercase) of each password. Replace both before the gate turns on.
// VIEW = open the site read-only. EDIT = unlock changing + saving/sharing.
export const VIEW_HASH = "01a62a76fe4989f47da2e864bbe0290ad4b832257557c8e6aa626345e1e6ac50";
export const EDIT_HASH = "7a5ff56cc45345769c10904c054e9e91c024ab909c51d1bc26a5af4abdd4bcc1";
