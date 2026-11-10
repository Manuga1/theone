// Client-side file fingerprinting for the ingestion inbox: files are never uploaded, only their metadata
// (name, size, mime, sha256 and a short text sample for text/CSV/XML/JSON) is posted to POST /participant/ingest/files.
export const SHA_LIMIT_BYTES = 200 * 1024 * 1024; // hash only files < 200 MB; larger files post sha256: null
export const TEXT_SAMPLE_BYTES = 4096;

export async function sha256Hex(file: File): Promise<string | null> {
  if (file.size >= SHA_LIMIT_BYTES) return null;
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export function isTextLike(file: File): boolean {
  const n = file.name.toLowerCase();
  return /^text\//.test(file.type) || /\/(json|xml|csv)$/.test(file.type) || /\.(txt|csv|tsv|json|xml|md|vcf)$/.test(n);
}

export async function textSample(file: File): Promise<string | null> {
  if (!isTextLike(file)) return null;
  try {
    const head = await file.slice(0, TEXT_SAMPLE_BYTES).text();
    return head.replace(/\0/g, '');
  } catch {
    return null;
  }
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
