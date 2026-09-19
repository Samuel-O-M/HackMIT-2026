import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { elapsed } from '../lib/dates';
import type { TranscriptTurn } from '../types/ui';

interface Props {
  source?: { sessionId: string; changeId: string };
  /** Fallback anchor for turns that name no change: match on what was heard. */
  reportedText: string;
  children: ReactNode;
}

const WIDTH = 460;
const MAX_HEIGHT = 340;
const GAP = 8;
const OPEN_DELAY_MS = 180;
const CLOSE_DELAY_MS = 140;

/** One fetch per call; every row in a session reads the same transcript. */
const cache = new Map<string, Promise<TranscriptTurn[]>>();

function loadTranscript(sessionId: string) {
  let hit = cache.get(sessionId);
  if (!hit) {
    hit = api.getTranscript(sessionId).catch((err) => {
      cache.delete(sessionId);
      throw err;
    });
    cache.set(sessionId, hit);
  }
  return hit;
}

function normalise(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The verbatim "Heard:" quote. Hovering (or focusing) it opens the whole call
 * transcript, scrolled to the turn that produced this change, so the
 * coordinator can judge the capture against what was actually said around it.
 */
export function TranscriptPeek({ source, reportedText, children }: Props) {
  const anchor = useRef<HTMLParagraphElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const schedule = useCallback((next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const sessionId = source?.sessionId;
  useEffect(() => {
    if (!open || !sessionId || turns) return;
    let live = true;
    setFailed(false);
    loadTranscript(sessionId).then(
      (t) => live && setTurns(t),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [open, sessionId, turns]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // The diff scrolls inside .main, so a positioned child would be clipped;
  // place a fixed popover from the anchor's rect instead, and close if it
  // scrolls away rather than leave it stranded.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const above = below < MAX_HEIGHT + GAP && rect.top > below;
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - WIDTH - 12));
      setPos({ left, top: above ? rect.top - GAP : rect.bottom + GAP, above });
    };
    place();
    // Capture phase sees every scroll on the page, including the popover's own
    // (which we trigger when centring the highlighted turn). Only an outside
    // scroll should dismiss it.
    const close = (e: Event) => {
      if (e.target instanceof Node && popover.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('resize', place);
    document.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const changeId = source?.changeId;
  const quote = normalise(reportedText);
  let hits = turns ? turns.map((t) => t.speaker === 'participant' && (t.yields ?? []).includes(changeId ?? '')) : [];
  if (turns && !hits.some(Boolean)) {
    hits = turns.map((t) => t.speaker === 'participant' && quote !== '' && normalise(t.text).includes(quote));
  }
  const firstHit = hits.indexOf(true);

  useEffect(() => {
    if (!open || !turns || !pos) return;
    const el = popover.current?.querySelector<HTMLElement>('[data-hit="true"]');
    if (el && popover.current) {
      const box = popover.current;
      box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    }
  }, [open, turns, pos === null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!source) return <p className="drug-verbatim">{children}</p>;

  return (
    <>
      <p
        ref={anchor}
        className="drug-verbatim peekable"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Heard: ${reportedText}. Show the surrounding call transcript.`}
        onMouseEnter={() => schedule(true, OPEN_DELAY_MS)}
        onMouseLeave={() => schedule(false, CLOSE_DELAY_MS)}
        onFocus={() => schedule(true, 0)}
        onBlur={() => schedule(false, CLOSE_DELAY_MS)}
      >
        {children}
      </p>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popover}
            role="dialog"
            aria-label="Call transcript"
            className="peek"
            style={{
              left: pos.left,
              width: WIDTH,
              maxHeight: MAX_HEIGHT,
              ...(pos.above ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
            onMouseEnter={() => schedule(true, 0)}
            onMouseLeave={() => schedule(false, CLOSE_DELAY_MS)}
          >
            <div className="peek-head">Call transcript</div>
            {failed && <p className="peek-note">The transcript could not be loaded.</p>}
            {!failed && !turns && <p className="peek-note">Loading…</p>}
            {turns && turns.length === 0 && <p className="peek-note">No transcript was recorded for this call.</p>}
            {turns && firstHit === -1 && turns.length > 0 && (
              <p className="peek-note">Couldn’t pin this to a single line; showing the whole call.</p>
            )}
            {turns?.map((turn, i) => (
              <div className="turn" key={`${turn.atMs}-${i}`} data-who={turn.speaker} data-hit={hits[i]}>
                <div>
                  <div className="turn-who">{turn.speaker === 'agent' ? 'Agent' : 'Participant'}</div>
                  <div className="turn-at">{elapsed(turn.atMs)}</div>
                </div>
                <p className="turn-text">{turn.text}</p>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
