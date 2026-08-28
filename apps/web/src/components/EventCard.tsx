import { useState, type CSSProperties } from "react";
import type { Happening } from "../lib/types";
import {
  calendarUrl,
  countdown,
  dateStamp,
  dayLabel,
  flyerGradient,
  flyerSrcSet,
  heading,
  priceLabel,
  timeLabel,
} from "../lib/happenings";
import { useSwipeDeck } from "../lib/swipe";
import { track } from "../lib/analytics";

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8.5V7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v1.5a2.2 2.2 0 0 0 0 4.4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4.1a2.2 2.2 0 0 0 0-4.4z" />
      <path d="M14 6.5v11" strokeDasharray="2 2.4" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M21.9 4.3 18.9 19c-.2 1-.8 1.2-1.7.8l-4.6-3.4-2.2 2.1c-.3.3-.5.5-1 .5l.3-4.6L18.2 6c.4-.3-.1-.5-.6-.2L7.3 12.3 2.8 10.9c-1-.3-1-1 .2-1.4l17.6-6.8c.8-.3 1.5.2 1.3 1.6z" />
    </svg>
  );
}

function CalendarPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3M12 13v5M9.5 15.5h5" />
    </svg>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === "left" ? "M10 4 6 8l4 4" : "M6 4l4 4-4 4"} />
    </svg>
  );
}

/**
 * One event, sized and built like a SpotCard so the two decks are the same
 * object with different contents.
 *
 * Two columns rather than three: a spot's third column is its map, and an event
 * has no coordinates to put in one — nothing links a Telegram post to a place
 * in the catalog. The flyer takes that room instead, which suits a poster.
 */
export function EventCard({
  happening,
  index,
  total,
  onPrev,
  onNext,
}: {
  happening: Happening;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [flyerFailed, setFlyerFailed] = useState(false);
  const swipe = useSwipeDeck({ onPrev, onNext });

  const { title, venueUsed } = heading(happening);
  const time = timeLabel(happening.starts_at);
  const price = priceLabel(happening);
  const stamp = dateStamp(happening.starts_at);
  const soon = countdown(happening.starts_at);

  const ticketHost = happening.ticket_url
    ? new URL(happening.ticket_url).hostname.replace(/^www\./, "")
    : null;

  return (
    <>
      <div className="spotcard eventcard" {...swipe.cardProps}>
        <a
          className="spot-cover"
          style={
            {
              backgroundImage: flyerGradient(happening.id),
              // fills the space the uncropped poster leaves, blurred (see CSS)
              "--flyer": happening.image_url ? `url("${happening.image_url}")` : "none",
            } as CSSProperties
          }
          href={happening.source_url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${title} on Telegram`}
          onClick={() => void track("happening_open", { id: happening.id })}
        >
          {happening.image_url && !flyerFailed && (
            <img
              className="cover-img"
              src={happening.image_url}
              srcSet={flyerSrcSet(happening.image_url)}
              sizes="(max-width: 900px) 100vw, 380px"
              alt=""
              decoding="async"
              referrerPolicy="no-referrer"
              onError={(event) => {
                // A missing WebP variant is recoverable; a missing original is not.
                const image = event.currentTarget;
                if (image.srcset) image.srcset = "";
                else setFlyerFailed(true);
              }}
            />
          )}
          <span className="cover-area">{dayLabel(happening.starts_at)}</span>
          {time && <span className="cover-count">{time}</span>}
        </a>

        <div className="spot-left">
          <div className="spot-headrow">
            <h2 className="spot-name">{title}</h2>
            {price && <span className="event-price">{price}</span>}
          </div>

          {!venueUsed && happening.venue_name && (
            <div className="spot-loc">
              <span className="loc-dot" />
              {happening.venue_name}
            </div>
          )}

          <div className="spot-actions">
            {happening.ticket_url && (
              <a
                className="action-btn"
                href={happening.ticket_url}
                target="_blank"
                rel="noreferrer"
                onClick={() => void track("happening_tickets", { id: happening.id })}
              >
                <TicketIcon /> Tickets
              </a>
            )}
            <a
              className="action-btn"
              href={calendarUrl(happening)}
              target="_blank"
              rel="noreferrer"
              onClick={() => void track("happening_calendar", { id: happening.id })}
            >
              <CalendarPlusIcon /> Add to calendar
            </a>
            <a
              className="action-btn"
              href={happening.source_url}
              target="_blank"
              rel="noreferrer"
              onClick={() => void track("happening_open", { id: happening.id })}
            >
              <TelegramIcon /> Post
            </a>
          </div>

          {happening.summary && <p className="spot-summary">{happening.summary}</p>}

          <div className="spot-meta">
            <div className="meta-block">
              <div className="meta-label">When</div>
              <div className="event-when">
                <span className="event-daynum">{stamp.day}</span>
                <span className="event-daytext">
                  <b>{stamp.weekday}</b>
                  {stamp.month}
                </span>
              </div>
              <div className="meta-sub">
                {time ? `${time} · ${soon}` : `${soon} · time not announced`}
              </div>
            </div>

            <div className="meta-block">
              <div className="meta-label">Tickets</div>
              {price ? (
                <>
                  <div className="event-priceline">{price}</div>
                  <div className="meta-sub">
                    {ticketHost ? `via ${ticketHost}` : "see the post for details"}
                  </div>
                </>
              ) : (
                <>
                  <div className="event-priceline event-priceline-none">
                    No price given
                  </div>
                  <div className="meta-sub">
                    {ticketHost ? `via ${ticketHost}` : "check the post before you go"}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="spot-nav">
        <button className="navbtn" onClick={onPrev} aria-label="Previous">
          <Chevron dir="left" />
        </button>
        <span className="nav-count">
          {index + 1} <i>of</i> {total}
        </span>
        <button className="navbtn" onClick={onNext} aria-label="Next">
          <Chevron dir="right" />
        </button>
      </div>
    </>
  );
}
