import type { ConversationInfo, MessengerMessage, TrackingDiagnostics } from './models';
import { normalizeForDisplay } from './text-normalizer';

interface Entry { key: number; message: MessengerMessage }
export interface IngestContext { atBottom: boolean; observedAt?: number }
export type IngestKind = 'baseline' | 'new' | 'duplicates' | 'backfill' | 'unanchored' | 'empty';

const stableId = (m: MessengerMessage) => m.domId?.startsWith('message:') ? m.domId : null;
const text = (m: MessengerMessage) => normalizeForDisplay(m.text).normalize('NFC');
function equivalent(a: MessengerMessage, b: MessengerMessage): boolean {
  const aId = stableId(a), bId = stableId(b);
  if (aId && bId) return aId === bId;
  return text(a) === text(b) && (a.direction === b.direction || a.direction === 'unknown' || b.direction === 'unknown') &&
    (!a.timestamp || !b.timestamp || a.timestamp === b.timestamp);
}

/** Known history and panel output are deliberately separate. No DOM index is an identity. */
export class NewMessageSession {
  private conversation: ConversationInfo | null = null;
  private available = true;
  private startedAt: number | null = null;
  private baselineAt: number | null = null;
  private entries = new Map<number, Entry>();
  private stable = new Map<string, Entry>();
  private rendered = new Map<string, Entry>();
  private previous: Entry[] = [];
  private output: MessengerMessage[] = [];
  private serial = 0;
  private tail: Entry | null = null;
  private tailEstablished = false;
  private baselineCount = 0;
  private historical = 0;
  private duplicates = 0;
  private backfill = 0;
  private unanchored = 0;
  private emitted = 0;
  private lastDuplicates = 0;
  lastIngestKind: IngestKind = 'empty';

  get active(): ConversationInfo | null { return this.available ? this.conversation : null; }
  get activeMessages(): MessengerMessage[] { return this.available ? this.output : []; }
  get statistics(): TrackingDiagnostics {
    return { monitoringSessionStartedAt: this.startedAt, baselineEstablished: this.baselineAt !== null,
      baselineEstablishedAt: this.baselineAt, tailAnchorEstablished: this.tailEstablished, baselineMessageCount: this.baselineCount,
      knownMessageCount: this.entries.size, newMessagesEmittedCount: this.emitted,
      suppressedHistoricalCount: this.historical, suppressedDuplicateCount: this.duplicates,
      suppressedBackfillCount: this.backfill, suppressedUnanchoredCount: this.unanchored };
  }
  beginSession(at = Date.now()): void { this.reset(); this.startedAt = at; }
  reset(): void { this.clearThread(); this.startedAt = null; }
  forgetConversation(): void { this.clearThread(); }
  markUnavailable(): void { this.available = false; }
  clearActive(): void { this.output = []; } // Clearing the view must never replay known history.
  lastDuplicateCount(): number { return this.lastDuplicates; }

  private clearThread(): void {
    this.conversation = null; this.available = true; this.baselineAt = null;
    this.entries.clear(); this.stable.clear(); this.rendered.clear(); this.previous = [];
    this.output = []; this.tail = null; this.tailEstablished = false; this.baselineCount = 0;
    this.historical = 0; this.duplicates = 0; this.backfill = 0; this.unanchored = 0;
    this.emitted = 0; this.lastDuplicates = 0; this.lastIngestKind = 'empty';
  }
  select(conversation: ConversationInfo): boolean {
    const changed = this.conversation?.key !== conversation.key;
    if (changed) this.clearThread();
    this.conversation = conversation; this.available = true;
    return changed;
  }

  private remember(message: MessengerMessage): Entry {
    const entry = { key: ++this.serial, message: { ...message } };
    this.entries.set(entry.key, entry);
    const id = stableId(message); if (id) this.stable.set(id, entry);
    return entry;
  }

  /** One-to-one sequence alignment is only a rerender fallback, constrained by strong anchors. */
  private reconcile(batch: MessengerMessage[]): { resolved: (Entry | null)[]; direct: Set<number> } {
    const resolved: (Entry | null)[] = batch.map(() => null);
    const direct = new Set<number>(), used = new Set<number>();
    for (let j = 0; j < batch.length; j++) {
      const message = batch[j]!;
      const id = stableId(message);
      const entry = (id ? this.stable.get(id) : undefined) ??
        (message.renderId ? this.rendered.get(message.renderId) : undefined);
      if (entry && !used.has(entry.key) && (id === stableId(entry.message) && id !== null || equivalent(entry.message, message))) {
        resolved[j] = entry; direct.add(j); used.add(entry.key);
      }
    }
    const old = this.previous;
    const oldPositions = new Map(old.map((e, i) => [e.key, i]));
    const low = batch.map(() => -1), high = batch.map(() => old.length);
    let bound = -1;
    for (let j = 0; j < batch.length; j++) { low[j] = bound; const p = resolved[j] && oldPositions.get(resolved[j]!.key); if (typeof p === 'number') bound = p; }
    bound = old.length;
    for (let j = batch.length - 1; j >= 0; j--) { high[j] = bound; const p = resolved[j] && oldPositions.get(resolved[j]!.key); if (typeof p === 'number') bound = p; }
    const match = (i: number, j: number) => !resolved[j] && !used.has(old[i]!.key) && i > low[j]! && i < high[j]! && equivalent(old[i]!.message, batch[j]!);
    // Avoid unbounded quadratic work on unexpectedly huge DOM windows. Strong
    // identities still work; ambiguous windows are suppressed rather than guessed.
    if (old.length * batch.length <= 1_000_000) {
      const dp = Array.from({ length: old.length + 1 }, () => new Uint32Array(batch.length + 1));
      for (let i = old.length - 1; i >= 0; i--) for (let j = batch.length - 1; j >= 0; j--) {
        dp[i]![j] = match(i, j) ? 1 + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
      for (let i = 0, j = 0; i < old.length && j < batch.length;) {
        if (match(i, j) && dp[i]![j] === 1 + dp[i + 1]![j + 1]!) { resolved[j] = old[i]!; used.add(old[i]!.key); i++; j++; }
        else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
        else j++;
      }
    }
    return { resolved, direct };
  }

  ingest(candidates: MessengerMessage[], context: IngestContext): MessengerMessage[] {
    if (!this.conversation || this.startedAt === null) return [];
    const ids = new Set<string>();
    let repeated = 0;
    const batch = candidates.filter(m => {
      if (m.conversationKey !== this.conversation!.key) return false;
      const id = stableId(m) ?? m.renderId;
      if (id && ids.has(id)) { repeated++; return false; }
      if (id) ids.add(id);
      return true;
    });
    const now = context.observedAt ?? Date.now();
    this.lastDuplicates = repeated;
    this.duplicates += repeated;
    if (this.baselineAt === null) {
      this.baselineAt = now; this.baselineCount = batch.length; this.historical += batch.length;
      this.previous = batch.map(m => this.remember(m));
      this.rendered = new Map(this.previous.filter(e => e.message.renderId).map(e => [e.message.renderId!, e]));
      this.tailEstablished = context.atBottom;
      this.tail = context.atBottom ? this.previous.at(-1) ?? null : null;
      this.lastIngestKind = 'baseline';
      return [];
    }
    if (!batch.length) { this.lastIngestKind = 'empty'; return []; }
    const { resolved, direct } = this.reconcile(batch);
    const tailIndex = this.tail ? resolved.findIndex(e => e?.key === this.tail!.key) : -1;
    const uniqueTail = this.tail && this.previous.filter(e => equivalent(e.message, this.tail!.message)).length === 1 &&
      batch.filter(m => equivalent(m, this.tail!.message)).length === 1;
    const provedTail = tailIndex >= 0 && (direct.has(tailIndex) || uniqueTail);
    const emptyStart = this.tailEstablished && this.tail === null && this.entries.size === 0 && context.atBottom;
    const added: MessengerMessage[] = [];
    let backfilled = 0, uncertain = 0;
    for (let j = 0; j < batch.length; j++) {
      const message = batch[j]!;
      const known = resolved[j];
      if (known) {
        this.lastDuplicates++;
        const existing = this.output.findIndex(m => m.id === `tracked:${known.key}`);
        if (existing >= 0) this.output[existing] = { ...message, id: this.output[existing]!.id };
        known.message = { ...message };
        const id = stableId(message); if (id) this.stable.set(id, known);
        continue;
      }
      const entry = this.remember(message); resolved[j] = entry;
      const cutoff = Math.max(this.baselineAt, this.tail?.message.sentAtMs ?? this.baselineAt);
      const datedNew = typeof message.sentAtMs === 'number' && Number.isFinite(message.sentAtMs) && message.sentAtMs > cutoff && message.sentAtMs <= now + 120_000;
      const datedHistorical = typeof message.sentAtMs === 'number' && Number.isFinite(message.sentAtMs) && message.sentAtMs <= this.baselineAt;
      if (!datedHistorical && (emptyStart || (this.tailEstablished && provedTail && j > tailIndex) || datedNew)) {
        const emitted = { ...message, id: `tracked:${entry.key}` };
        this.output.push(emitted); added.push(emitted); this.emitted++;
      } else {
        this.historical++; this.backfill++; backfilled++;
        if (context.atBottom && this.tailEstablished && !provedTail) { this.unanchored++; uncertain++; }
      }
    }
    this.duplicates += this.lastDuplicates - repeated;
    this.previous = resolved.filter((e): e is Entry => e !== null);
    this.rendered = new Map(this.previous.filter(e => e.message.renderId).map(e => [e.message.renderId!, e]));
    // Scrolling into older history never moves the frontier backwards. When a
    // disjoint window reaches the bottom, establish a conservative fresh anchor.
    if (added.length || (context.atBottom && (!this.tailEstablished || !provedTail))) {
      this.tail = this.previous.at(-1) ?? this.tail; this.tailEstablished = true;
    }
    this.lastIngestKind = added.length ? 'new' : uncertain ? 'unanchored' : backfilled ? 'backfill' : 'duplicates';
    return added;
  }
}
