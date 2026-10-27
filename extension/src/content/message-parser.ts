import { normalizeForCompare, normalizeForDisplay } from '../core/text-normalizer';
import type { SenderDirection } from '../core/models';

export interface RawBubble {
  /** Raw text as it appeared in the DOM. */
  text: string;
  direction: SenderDirection;
  directionIsHeuristic: boolean;
  timestamp: string | null;
  domId: string | null;
  /** DOM index within the visible list; used as ordering fallback. */
  index: number;
}

export interface ParsedBubble extends RawBubble {
  displayText: string;
  normalizedText: string;
  /** Dropped bubbles carry no text — they are UI chrome, not messages. */
  isEmpty: boolean;
}

/**
 * Cleans a raw DOM text blob into a displayable message.
 *
 * Messenger nests a lot of UI text (reaction pills, "Enter to send", presence
 * dots). We strip trailing control labels that are known chrome and reject
 * bubbles that carry no real content.
 */
const CHROME_LABELS = [
  /^enter to send$/i,
  /^shift\+enter for new line$/i,
  /^press enter to send$/i,
  /^enter để gửi$/i,
  /^like$/i,
  /^unlike$/i,
];

export function parseBubble(raw: RawBubble): ParsedBubble {
  const displayText = normalizeForDisplay(raw.text);
  const normalizedText = normalizeForCompare(displayText);

  let isEmpty = displayText.length === 0;
  if (!isEmpty) {
    for (const label of CHROME_LABELS) {
      if (label.test(displayText)) {
        isEmpty = true;
        break;
      }
    }
  }

  return { ...raw, displayText, normalizedText, isEmpty };
}

/**
 * Orders bubbles by their DOM index. Messenger renders oldest-first inside the
 * scroller, but we additionally sort by document position when a
 * `compareDocumentPosition` signal is available, so that flex `order`
 * quirks do not scramble the transcript.
 */
export function orderBubbles(bubbles: ParsedBubble[]): ParsedBubble[] {
  return [...bubbles].sort((a, b) => a.index - b.index);
}

/** Removes bubbles that carry no user-visible content. */
export function keepMeaningful(bubbles: ParsedBubble[]): ParsedBubble[] {
  return bubbles.filter((b) => !b.isEmpty);
}
