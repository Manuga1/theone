import type { ReactNode } from 'react';

export type RevokeDialogProps = {
  open: boolean;
  title?: ReactNode;
  licenseNumber?: string | null;
  orgName?: string;
  studyName?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Forward-only revocation: the next dataset refresh drops the member; prior analyses and ledger rows stay. */
export function RevokeDialog({ open, title = 'Revoke license?', licenseNumber, orgName, studyName, busy, onConfirm, onCancel }: RevokeDialogProps) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__title">{title}</div>
        <div className="dialog__body">
          {licenseNumber && (
            <p style={{ marginTop: 0 }}>
              License <strong>#{licenseNumber}</strong>
              {orgName ? <> held by <strong>{orgName}</strong></> : null}
              {studyName ? <> for <em>{studyName}</em></> : null} will be revoked immediately.
            </p>
          )}
          <p>
            Revocation is forward-only: your data is removed from the next dataset refresh and no new analyses may use it.
            Analyses already performed are not undone, and payments already made stay in your ledger.
          </p>
        </div>
        <div className="dialog__actions">
          <button className="btn" onClick={onCancel} disabled={busy}>Keep license</button>
          <button className="btn btn--danger" onClick={onConfirm} disabled={busy}>{busy ? 'Revoking…' : 'Revoke license'}</button>
        </div>
      </div>
    </div>
  );
}
