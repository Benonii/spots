import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { Happening } from "./lib/types";
import { fetchHappenings } from "./lib/supabase";
import {
  dedupe,
  flyerGradient,
  groupByDay,
  heading,
  priceLabel,
  timeLabel,
} from "./lib/happenings";
import { track } from "./lib/analytics";
import { BrandMark } from "./components/BrandMark";

function BackIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 4 6 8l4 4" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8.5V7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v1.5a2.2 2.2 0 0 0 0 4.4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4.1a2.2 2.2 0 0 0 0-4.4z" />
      <path d="M14 6.5v11" strokeDasharray="2 2.4" />
    </svg>
  );
}

/**
 * The event's flyer, which is the whole visual identity of a Telegram events
 * post — every one of the first two dozen carried an image.
 *
 * The box reserves its ratio before the image arrives, so a page of flyers
 * can't shift under the reader as they load (we measure CLS in production).
 * Telegram's CDN is a third party, so a failed load falls back to the same
 * deterministic warm gradient a spot without a cover uses.
 */
function Flyer({ happening }: { happening: Happening }) {
  const [failed, setFailed] = useState(false);
  const label = heading(happening).title;
  return (
    <a
      className="hap-flyer"
      href={happening.source_url}
      target="_blank"
      rel="noreferrer"
      style={{ backgroundImage: flyerGradient(happening.id) }}
      aria-label={`Open ${label} on Telegram`}
      onClick={() => void track("happening_open", { id: happening.id })}
    >
      {happening.image_url && !failed && (
        <img
          src={happening.image_url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </a>
  );
}

function HappeningItem({ happening }: { happening: Happening }) {
  const time = timeLabel(happening.starts_at);
  const price = priceLabel(happening);
  const { title, venueUsed } = heading(happening);
  // Venue and time are one line of orientation; either can be missing, and an
  // empty separator is worse than a shorter line.
  const meta = [venueUsed ? null : happening.venue_name, time].filter(Boolean).join(" · ");

  return (
    <li className="hap-item">
      <Flyer happening={happening} />
      <div className="hap-main">
        <a
          className="hap-title"
          href={happening.source_url}
          target="_blank"
          rel="noreferrer"
          onClick={() => void track("happening_open", { id: happening.id })}
        >
          {title}
        </a>
        {meta && <span className="hap-meta">{meta}</span>}
        {happening.summary && <p className="hap-summary">{happening.summary}</p>}
      </div>
      <div className="hap-side">
        {price && <span className="hap-price">{price}</span>}
        {happening.ticket_url && (
          <a
            className="action-btn"
            href={happening.ticket_url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Tickets for ${title}`}
            onClick={() => void track("happening_tickets", { id: happening.id })}
          >
            <TicketIcon />
            <span className="abtn-label">Tickets</span>
          </a>
        )}
      </div>
    </li>
  );
}

export function Happenings() {
  const [happenings, setHappenings] = useState<Happening[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    void track("happenings_view");
    fetchHappenings()
      .then(setHappenings)
      .catch(() => setLoadFailed(true));
  }, []);

  const groups = useMemo(
    () => (happenings ? groupByDay(dedupe(happenings)) : []),
    [happenings],
  );

  const header = (
    <header className="near-top">
      <Link to="/" className="near-back">
        <BackIcon /> All spots
      </Link>
      <div className="near-title">
        <BrandMark className="brand-mark" />
        <div>
          <h1>What's on</h1>
          <p>Events we're tracking around Addis</p>
        </div>
      </div>
    </header>
  );

  let body: ReactNode;
  if (loadFailed) {
    body = (
      <div className="near-state">
        <h2>Couldn't load events</h2>
        <p>We couldn't reach the server. Check your connection and try again.</p>
      </div>
    );
  } else if (!happenings) {
    body = (
      <div className="near-state" aria-busy="true">
        <span className="near-spinner" aria-hidden="true" />
        <p>Looking for what's on…</p>
      </div>
    );
  } else if (!groups.length) {
    // The launch state, and the honest state whenever the city goes quiet —
    // written to say what happens next rather than just "nothing here".
    body = (
      <div className="near-state">
        <h2>Nothing on the calendar yet</h2>
        <p>
          We follow the channels that announce concerts, pop-ups and screenings
          around town, and list them here as they're posted. Most land only a
          few days ahead — so it's worth another look later in the week.
        </p>
        <Link to="/" className="appstate-btn">
          Browse spots instead
        </Link>
      </div>
    );
  } else {
    body = (
      <div className="hap-days">
        {groups.map((group, index) => (
          <section
            key={group.key}
            className="hap-day"
            // Staggered entrance, capped so a long list doesn't wait on the
            // tail. Purely decorative: the global reduced-motion rule flattens
            // it, and the content is laid out identically either way.
            style={{ "--stagger": `${Math.min(index, 6) * 55}ms` } as CSSProperties}
          >
            <h2 className="hap-daylabel">{group.label}</h2>
            <ul className="hap-list">
              {group.happenings.map((happening) => (
                <HappeningItem key={happening.id} happening={happening} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="app near-page hap-page">
      {header}
      {body}
    </div>
  );
}
