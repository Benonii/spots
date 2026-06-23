/**
 * Floating "What's New" trigger, pinned to the top-right corner of the viewport.
 * Lives outside the routed app view so it shows across every state, and keeps the
 * header's topbar-right slot free for the "Near me" control. The Shiplog widget
 * (loaded in index.html) binds the changelog panel to [data-shiplog-open].
 */
export function WhatsNewButton() {
  return (
    <button type="button" className="whatsnew-btn" data-shiplog-open title="What's New">
      <span className="whatsnew-label">What's New</span>
    </button>
  );
}
