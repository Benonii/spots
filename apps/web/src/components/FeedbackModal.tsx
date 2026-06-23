import { useEffect, useId, useRef, useState, type FC, type FormEvent } from "react";
import { submitFeedback, type FeedbackKind } from "../lib/feedback";

const MAX = 2000;

type Kind = { value: FeedbackKind; label: string; hint: string; Icon: FC };

const KINDS: Kind[] = [
  { value: "bug", label: "Bug", hint: "Something's broken or behaving wrong", Icon: BugIcon },
  { value: "feature", label: "Idea", hint: "A feature or spot you'd like to see", Icon: BulbIcon },
  { value: "general", label: "General", hint: "Anything else on your mind", Icon: ChatIcon },
];

function BugIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="6" width="8" height="13" rx="4" />
      <path d="M9 9 6.5 6.5M15 9l2.5-2.5M8 13H4m16 0h-4M9 17l-2.5 2.5M15 17l2.5 2.5" />
    </svg>
  );
}
function BulbIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1 1 1.6l.1.5h4.8l.1-.5c.1-.6.4-1.1 1-1.6A6 6 0 0 0 12 3z" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16v11H9l-4 3v-3H4z" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

type Status = "idle" | "sending" | "sent" | "error";

export function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<FeedbackKind>("general");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const titleId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  // Reset to a clean form whenever the modal (re)opens, and remember what to
  // refocus on close.
  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    setKind("general");
    setMessage("");
    setEmail("");
    setStatus("idle");
    // focus the message field once the dialog has painted
    const t = setTimeout(() => textareaRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Escape to close, focus trap within the dialog, and body scroll lock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || !focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const canSend = message.trim().length > 0 && status !== "sending";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setStatus("sending");
    try {
      await submitFeedback({ kind, message, email });
      setStatus("sent");
      // let the success state breathe, then close
      setTimeout(onClose, 1400);
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="fb-scrim" onClick={onClose}>
      <div
        className="fb-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="fb-close" type="button" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>

        {status === "sent" ? (
          <div className="fb-done">
            <span className="fb-done-mark" aria-hidden="true">
              <CheckIcon />
            </span>
            <h2 id={titleId}>Thank you</h2>
            <p>Your feedback landed. We read every note.</p>
          </div>
        ) : (
          <form className="fb-form" onSubmit={onSubmit}>
            <header className="fb-head">
              <h2 id={titleId}>Send feedback</h2>
              <p>Found a bug, want a feature, or just have a thought? Tell us.</p>
            </header>

            <div className="fb-kinds" role="radiogroup" aria-label="Type of feedback">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.value}
                  className={"fb-kind" + (kind === k.value ? " on" : "")}
                  onClick={() => setKind(k.value)}
                >
                  <k.Icon />
                  <span className="fb-kind-label">{k.label}</span>
                </button>
              ))}
            </div>
            <p className="fb-kind-hint">{KINDS.find((k) => k.value === kind)?.hint}</p>

            <label className="fb-field">
              <span className="fb-label">Your feedback</span>
              <textarea
                ref={textareaRef}
                className="fb-textarea"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
                placeholder={
                  kind === "bug"
                    ? "What happened, and what did you expect?"
                    : kind === "feature"
                      ? "What would you like to be able to do?"
                      : "Share anything — what you love, what's confusing…"
                }
                rows={5}
                maxLength={MAX}
                required
              />
              <span className="fb-count">{message.length}/{MAX}</span>
            </label>

            <label className="fb-field">
              <span className="fb-label">
                Email <span className="fb-optional">— optional, if you want a reply</span>
              </span>
              <input
                className="fb-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>

            {status === "error" && (
              <p className="fb-error" role="alert">
                Couldn't send that — check your connection and try again.
              </p>
            )}

            <div className="fb-actions">
              <button type="button" className="fb-cancel" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="fb-submit" disabled={!canSend}>
                {status === "sending" ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
