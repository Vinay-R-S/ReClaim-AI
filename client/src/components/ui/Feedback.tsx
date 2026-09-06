import { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Inline feedback, the app's replacement for `window.alert`.
 *
 * Every modal used to report a missing field with a blocking browser dialog,
 * including for expected states like "you have not picked an image yet"
 * (defect UI-16). The markup here is the banner `EditReportModal` already grew
 * for itself, lifted out so the other screens stop inventing their own.
 */

export type FeedbackTone = 'success' | 'error' | 'info';

const TONE_STYLES: Record<FeedbackTone, string> = {
  success: 'bg-green-50 text-green-700 border-green-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
};

const TONE_ICONS: Record<FeedbackTone, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

export interface FeedbackMessage {
  tone: FeedbackTone;
  message: string;
}

interface FeedbackProps extends FeedbackMessage {
  onDismiss?: () => void;
  className?: string;
}

export function Feedback({ tone, message, onDismiss, className }: FeedbackProps) {
  const Icon = TONE_ICONS[tone];
  const banner = useRef<HTMLDivElement>(null);

  // The banner usually sits at the top of a scrolling panel while the button
  // that produced the message is at the bottom of it. `window.alert` was
  // unmissable; this has to be brought into view or the user sees the button
  // do nothing at all.
  useEffect(() => {
    banner.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [message, tone]);

  return (
    <div
      ref={banner}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'p-3 rounded-lg flex items-start gap-2 text-sm border',
        TONE_STYLES[tone],
        className,
      )}
    >
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 hover:opacity-70 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
