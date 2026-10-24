// Wrap a mutation: tracks a busy flag, toasts errors, and (optionally) a success message.
import { useCallback, useState } from 'react';
import { pushToast, toastError } from './toast';

export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { success?: string; errorPrefix?: string } = {}) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setBusy(true);
      try {
        const r = await fn(...args);
        if (opts.success) pushToast('success', opts.success);
        return r;
      } catch (e) {
        toastError(e, opts.errorPrefix);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, opts.success, opts.errorPrefix],
  );
  return { run, busy };
}
