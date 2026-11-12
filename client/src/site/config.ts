// Build-time settings for the public site. Every value is optional: with nothing set the pages still read correctly
// ("Sign-ups open soon.", "run by its two student founders"). No person's name or address lives in the code.
//   VITE_REGISTRY_FORM_URL  hosted registry sign-up form (embedded on /join)
//   VITE_PILOT_FORM_URL     hosted pilot-enquiry form (embedded on /researchers)
//   VITE_CONTACT_EMAIL      contact and deletion address
//   VITE_FOUNDERS           comma-separated founder names, e.g. "First Last, First Last"
const env = import.meta.env as unknown as Record<string, string | boolean | undefined>;

function text(key: string): string | null {
  const v = env[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
/** Only http(s) URLs are accepted (the value ends up in an iframe src and a link). */
export function httpUrl(v: string | null): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
export function emailAddress(v: string | null): string | null {
  return v && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) ? v : null;
}
export function nameList(v: string | null): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
/** ["A"] → "A"; ["A","B"] → "A and B"; ["A","B","C"] → "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export const SITE = {
  registryFormUrl: httpUrl(text('VITE_REGISTRY_FORM_URL')),
  pilotFormUrl: httpUrl(text('VITE_PILOT_FORM_URL')),
  contactEmail: emailAddress(text('VITE_CONTACT_EMAIL')),
  founders: nameList(text('VITE_FOUNDERS')),
} as const;

/** "run by A and B", or the neutral wording when no names are configured. */
export function runBy(founders: readonly string[] = SITE.founders): string {
  return founders.length > 0 ? `run by ${joinNames([...founders])}` : 'run by its two student founders';
}

/** Registry notice version shown on /privacy. Bump both whenever the notice text changes. */
export const NOTICE_VERSION = '0.2';
export const NOTICE_DATE = '12 November 2026';

/** Who may join the registry (shown on /join and /privacy). */
export const ELIGIBILITY = 'US residents aged 18 or older (19 or older in Alabama and Nebraska, 21 or older in Mississippi).';

export function mailto(address: string, subject: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`;
}
