// A hosted form embedded from a configured URL, with an email fallback and a plain sentence when neither is set.
// Padma stores no form answers itself: the form provider and the sheet behind it do.
import { ExternalLink, Mail } from 'lucide-react';
import { mailto } from './config';

export type FormEmbedProps = {
  /** hosted form URL (already validated by config.ts) */
  url: string | null;
  /** fallback address */
  email: string | null;
  /** iframe title and the label of the email button */
  title: string;
  emailSubject: string;
  /** sentence under the email button */
  emailNote?: string;
  /** shown when neither a form nor an address is configured */
  closedText: string;
  testId: string;
};

export function FormEmbed({ url, email, title, emailSubject, emailNote, closedText, testId }: FormEmbedProps) {
  if (url) {
    return (
      <div className="site-form" data-testid={testId} data-mode="form">
        <iframe className="site-form__frame" src={url} title={title} loading="lazy" referrerPolicy="no-referrer" />
        <p className="site-form__alt">
          Form not loading? <a href={url} target="_blank" rel="noopener noreferrer">Open the form in a new tab <ExternalLink aria-hidden="true" /></a>
        </p>
      </div>
    );
  }
  if (email) {
    return (
      <div className="site-form site-form--mail" data-testid={testId} data-mode="email">
        <a className="site-btn site-btn--primary" href={mailto(email, emailSubject)}><Mail aria-hidden="true" /> {title}</a>
        {/* the address as plain text (one link only), for people whose browser has no mail program set up */}
        <p className="site-form__alt">{emailNote ? `${emailNote} ` : ''}The address is <span className="site-email">{email}</span>.</p>
      </div>
    );
  }
  return <p className="site-closed" data-testid={testId} data-mode="closed">{closedText}</p>;
}
