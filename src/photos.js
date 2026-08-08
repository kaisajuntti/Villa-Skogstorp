// Photo uploads via Supabase Storage (bucket `vs-photos`, public read).
// Images are downscaled to a reasonable JPEG before upload so they stay light
// but keep enough detail for reference photos. The public URL is stored in the
// doc / comment record; `path` is kept so the object can be deleted later.
import { SUPABASE } from "./appconfig.js";

export const PHOTO_BUCKET = "vs-photos";
const base = SUPABASE.url.replace(/\/+$/, "");
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const authHeaders = () => ({ apikey: SUPABASE.key, Authorization: "Bearer " + SUPABASE.key });

export function photoUrl(path) {
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${encodeURI(path)}`;
}

// Decode a File to an <img>. Tries an object URL first, then falls back to a
// data URL (helps with some iOS Safari / HEIC / iCloud cases).
function loadImage(file) {
  const tryLoad = (src, revoke) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = () => { if (revoke) URL.revokeObjectURL(src); reject(new Error("decode")); };
    img.src = src;
  });
  const objUrl = URL.createObjectURL(file);
  return tryLoad(objUrl, true)
    .then((img) => { URL.revokeObjectURL(objUrl); return img; })
    .catch(() => new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => tryLoad(fr.result, false).then(resolve, reject);
      fr.onerror = () => reject(new Error("read"));
      fr.readAsDataURL(file);
    }));
}

// Downscale an image File to a JPEG Blob (max dimension `maxDim`).
async function downscaleToBlob(file, maxDim = 2000, quality = 0.82) {
  let img;
  try { img = await loadImage(file); }
  catch { throw new Error("Kunde inte läsa bilden. Prova en annan bild (t.ex. spara som JPEG), eller ladda ned den från iCloud först."); }
  const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(1, Math.round((img.width || 1) * scale));
  const h = Math.max(1, Math.round((img.height || 1) * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", quality));
  if (blob) return blob;
  // Fallback if toBlob is unavailable/returns null.
  const dataUrl = c.toDataURL("image/jpeg", quality);
  const bin = atob(dataUrl.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: "image/jpeg" });
}

// Upload a photo File; resolves to { path, url }.
export async function uploadPhoto(file) {
  const blob = await downscaleToBlob(file);
  const path = `${SUPABASE.workspace}/${rid()}.jpg`;
  const r = await fetch(`${base}/storage/v1/object/${PHOTO_BUCKET}/${encodeURI(path)}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "image/jpeg", "x-upsert": "false" },
    body: blob,
  });
  if (!r.ok) {
    const msg = r.status === 400 || r.status === 404
      ? "Storage-bucketen 'vs-photos' saknas — skapa den i Supabase först."
      : "Uppladdning misslyckades (HTTP " + r.status + ")";
    throw new Error(msg);
  }
  return { path, url: photoUrl(path) };
}

// Best-effort delete of a previously uploaded object.
export async function deletePhoto(path) {
  if (!path) return;
  try {
    await fetch(`${base}/storage/v1/object/${PHOTO_BUCKET}/${encodeURI(path)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  } catch { /* ignore */ }
}
