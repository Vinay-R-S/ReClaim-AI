import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedbackMessage, FeedbackTone } from '../components/ui/Feedback';

/** How long a message stays before it clears itself. */
const DEFAULT_TIMEOUT_MS = 4000;

/**
 * One transient message per screen.
 *
 * Every modal had its own copy of "set a message, `setTimeout` to clear it",
 * and each one leaked its timer on unmount. The timer is owned here and
 * cancelled on the way out.
 */
export function useFeedback(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setFeedback(null);
  }, []);

  const show = useCallback(
    (tone: FeedbackTone, message: string, { sticky = false } = {}) => {
      if (timer.current) clearTimeout(timer.current);

      setFeedback({ tone, message });

      // A sticky message is one the user has to act on, so it stays until the
      // next one replaces it.
      timer.current = sticky
        ? null
        : setTimeout(() => {
            timer.current = null;
            setFeedback(null);
          }, timeoutMs);
    },
    [timeoutMs],
  );

  /**
   * Errors stay until something replaces them.
   *
   * An error is a thing the user has to do something about, and a message that
   * clears itself after four seconds is one they can miss entirely while they
   * are looking at the control that produced it.
   */
  const showError = useCallback(
    (message: string, options?: { sticky?: boolean }) =>
      show('error', message, { sticky: options?.sticky ?? true }),
    [show],
  );

  const showSuccess = useCallback(
    (message: string, options?: { sticky?: boolean }) => show('success', message, options),
    [show],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { feedback, show, showError, showSuccess, clear };
}
