/* =====================================================================================
   IMAGES -- Supabase Storage, public buckets, stable public URLs.
   =====================================================================================
   The old app pushed a base64 file into Drive and stored a drive.google.com/thumbnail URL.
   Same shape here: the browser sends a data: URL, the server decodes and uploads it with the
   service role, and the row stores the public URL. Old Drive URLs stay as they are -- they are
   public and they work -- so a migrated product shows its photo on day one. */

export const BUCKETS = { product: 'product-images', logo: 'logos', photo: 'profile-photos' };
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Reads a data: URL into { bytes, contentType, ext } or throws a plain 400. */
export function decodeDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) { const e = new Error('That did not look like an image.'); e.status = 400; throw e; }
  const contentType = m[1];
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(contentType)) { const e = new Error('Only JPG, PNG, WEBP or GIF images are accepted.'); e.status = 400; throw e; }
  let bytes;
  try { bytes = Buffer.from(m[2], 'base64'); } catch { const e = new Error('That image could not be read.'); e.status = 400; throw e; }
  if (!bytes.length) { const e = new Error('That image was empty.'); e.status = 400; throw e; }
  if (bytes.length > MAX_IMAGE_BYTES) { const e = new Error('That image is too large (over 3MB). Please choose a smaller one.'); e.status = 400; throw e; }
  const ext = /png/i.test(contentType) ? 'png' : /webp/i.test(contentType) ? 'webp' : /gif/i.test(contentType) ? 'gif' : 'jpg';
  return { bytes, contentType, ext };
}

/** The public URL of an object, built the way Supabase builds it, so the fake in tests and the
    real project agree without a second round trip to ask. */
export function publicUrl(bucket, path) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return base + '/storage/v1/object/public/' + bucket + '/' + path;
}

/** Uploads bytes at `path` in `bucket` (overwriting) and returns the public URL. A cache-busting
    query is appended because the path is reused per product/logo and browsers cache aggressively. */
export async function uploadImage(db, bucket, path, { bytes, contentType }, nowMs = Date.now()) {
  const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
  if (error) { const e = new Error('Upload failed: ' + (error.message || error)); e.status = 502; throw e; }
  return publicUrl(bucket, path) + '?v=' + Math.floor(nowMs / 1000);
}
