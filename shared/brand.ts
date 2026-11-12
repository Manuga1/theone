// One place for the product name and the honest status wording. Change BRAND.name here if the name changes.
export const BRAND = {
  name: 'Padma',
  /** shown under the name on public pages */
  tagline: 'A registry of adults who want to take part in paid health research, and a service that helps research teams reach them.',
  /** the true state of the project; shown on every public page */
  statusLine: 'Padma is a student project in pilot stage. It has no enrolled participants yet.',
  /** shown on every screen of the product demo, at every width */
  demoBanner: 'Simulated data. Not real people. Do not enter real health information.',
  /** attached to every dollar figure in the participant demo */
  illustrativeLabel: 'illustrative, not an offer',
  /** printed across protocol sheets */
  watermark: 'Illustration. Padma has no enrolled participants yet.',
  notAffiliated: 'Padma is not affiliated with or endorsed by Vanderbilt University or Vanderbilt University Medical Center.',
} as const;

/** Header carrying the admin token for destructive demo endpoints (reset, advance) on hosted deployments. */
export const ADMIN_HEADER = 'x-demo-admin';
