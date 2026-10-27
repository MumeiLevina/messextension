/**
 * Shared domain models. Platform-independent by design so the conversation
 * logic can be ported to Android later without touching the Messenger adapter.
 */

export type SenderDirection = 'incoming' | 'outgoing' | 'unknown';

export type ScanIntervalMs = 3000 | 5000 | 10000;

export const SCAN_INTERVAL_OPTIONS: ScanIntervalMs[] = [3000, 5000, 10000];
export const DEFAULT_SCAN_INTERVAL: ScanIntervalMs = 5000;

export interface MessageIdentity {
  /** Stable-ish DOM handle when the adapter can provide one. */
  domId: string | null;
  /** Conversation the message belongs to; prevents cross-thread mixing. */
  conversationKey: string;
  /** Direction is part of identity: the same text from two sides is two messages. */
  direction: SenderDirection;
  /** Visible timestamp text, when present. */
  timestamp: string | null;
  /** Normalized text, used only as a tiebreaker, never as the sole key. */
  normalizedText: string;
  /** Position of the bubble within the visible list, used as a last-resort tiebreaker. */
  ordinal: number;
  /** Neighbouring text, disambiguates two identical adjacent bubbles. */
  neighbors: string;
}

export interface MessengerMessage {
  id: string;
  text: string;
  normalizedText: string;
  direction: SenderDirection;
  timestamp: string | null;
  /** True when the direction was inferred from layout rather than an explicit marker. */
  directionIsHeuristic: boolean;
  conversationKey: string;
  conversationLabel: string;
  detectedAt: number;
  domId: string | null;
  ordinal: number;
  /** Per-element identity; survives reordering, but intentionally not a rerender. */
  renderId?: string;
  /** Absolute time only when explicitly supplied by a rendered <time datetime>. */
  sentAtMs?: number | null;
}

export interface ConversationInfo {
  key: string;
  label: string;
  /** URL of the thread when the adapter can read it. */
  url: string | null;
}

export type MonitoringState = 'idle' | 'running' | 'paused' | 'stopped';

/**
 * Why the most recent extraction pass ended without usable messages, or 'ok'
 * when it produced a readable conversation. Never contains message text.
 */
export type ExtractionStatus =
  | 'idle'
  | 'ok'
  | 'no-conversation'
  | 'no-container'
  | 'no-visible-messages'
  | 'all-rejected'
  | 'loading'
  | 'already-ingested'
  | 'communication-failed'
  | 'stopped'
  | 'baseline'
  | 'historical-backfill'
  | 'unanchored'
  | 'error';

export type ExtractionStrategy = 'scroller' | 'aria-list' | 'semantic-log' | 'none';

export interface TrackingDiagnostics {
  monitoringSessionStartedAt: number | null;
  baselineEstablished: boolean;
  baselineEstablishedAt: number | null;
  tailAnchorEstablished: boolean;
  baselineMessageCount: number;
  knownMessageCount: number;
  newMessagesEmittedCount: number;
  suppressedHistoricalCount: number;
  suppressedDuplicateCount: number;
  suppressedBackfillCount: number;
  suppressedUnanchoredCount: number;
}

export interface Diagnostics extends TrackingDiagnostics {
  monitoringSessionStatus: MonitoringState;
  lastScanAt: number | null;
  lastSuccessAt: number | null;
  messagesDetected: number;
  changesProcessed: number;
  duplicatesPrevented: number;
  parseErrors: number;
  avgLatencyMs: number;
  lastLatencyMs: number;
  scanCount: number;
  domSupported: boolean;
  adapterVersion: string;
  lastError: string | null;
  ocrAvailable: boolean;
  speechAvailable: boolean;
  /** Sanitized pipeline counters observed during the most recent scan. */
  lastStatus: ExtractionStatus;
  lastCandidates: number;
  lastParsed: number;
  lastRejected: number;
  lastDuplicates: number;
  /** Messages handed to the side panel in this session. */
  lastSent: number;
  strategy: ExtractionStrategy;
  containerFound: boolean;
  deliveryState: 'idle' | 'pending' | 'delivered' | 'panel-unavailable' | 'failed';
  lastDeliveryError: string | null;
  lastSentAt: number | null;
}

export const emptyDiagnostics = (): Diagnostics => ({
  monitoringSessionStatus: 'idle',
  monitoringSessionStartedAt: null,
  baselineEstablished: false,
  baselineEstablishedAt: null,
  tailAnchorEstablished: false,
  baselineMessageCount: 0,
  knownMessageCount: 0,
  newMessagesEmittedCount: 0,
  suppressedHistoricalCount: 0,
  suppressedDuplicateCount: 0,
  suppressedBackfillCount: 0,
  suppressedUnanchoredCount: 0,
  lastScanAt: null,
  lastSuccessAt: null,
  messagesDetected: 0,
  changesProcessed: 0,
  duplicatesPrevented: 0,
  parseErrors: 0,
  avgLatencyMs: 0,
  lastLatencyMs: 0,
  scanCount: 0,
  domSupported: false,
  adapterVersion: '0.0.0',
  lastError: null,
  ocrAvailable: false,
  speechAvailable: false,
  lastStatus: 'idle',
  lastCandidates: 0,
  lastParsed: 0,
  lastRejected: 0,
  lastDuplicates: 0,
  lastSent: 0,
  strategy: 'none',
  containerFound: false,
  deliveryState: 'idle',
  lastDeliveryError: null,
  lastSentAt: null,
});

export interface ExtractedConversation {
  conversation: ConversationInfo;
  messages: MessengerMessage[];
  /** True when the adapter recognised the page but the DOM layout has changed. */
  unsupported: boolean;
  warning: string | null;
  /** Sanitized counters for the diagnostics panel. */
  candidates: number;
  parsed: number;
  rejected: number;
  /** Why the pass produced no usable messages, if it produced none. */
  status: ExtractionStatus;
  strategy: ExtractionStrategy;
  atBottom: boolean;
  /**
   * The DOM node that holds the rendered messages, when one was found.
   * The observer attaches here so it never watches the whole page.
   */
  container: HTMLElement | null;
}
