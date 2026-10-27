import { fingerprint, normalizeForDisplay } from '../core/text-normalizer';
import type { MessageIdentity, MessengerMessage } from '../core/models';

/**
 * Incremental message identification.
 *
 * The rule from the spec: normalized text alone is NEVER the unique key.
 * "A: Hello / A: Hello / B: Hello" must yield three distinct messages.
 *
 * The key is built from, in order of strength:
 *   1. conversation key  (thread isolation — never mix threads)
 *   2. a stable DOM id when the adapter exposes one
 *   3. direction + ordinal + timestamp + text fingerprint + neighbour context
 *
 * DOM re-renders can destroy ids, so we additionally keep a positional history
 * that lets a re-created element inherit the identity of the element it
 * replaced when the surrounding context is unchanged.
 */
export interface DedupResult {
  added: MessengerMessage[];
  duplicates: number;
}

export class MessageDeduplicator {
  /** conversationKey -> ordered list of known identities. */
  /** Duplicate events prevented during the most recent ingest call. */
  lastDuplicates = 0;

  private history = new Map<string, MessageIdentity[]>();
  /** Composite key -> the identity it was created from. */
  private seen = new Map<string, MessageIdentity>();
  /** conversationKey -> last identity, used for re-render inheritance. */
  private lastByConversation = new Map<string, MessageIdentity>();

  reset(conversationKey?: string): void {
    if (conversationKey) {
      this.history.delete(conversationKey);
      this.lastByConversation.delete(conversationKey);
      for (const key of [...this.seen.keys()]) {
        if (key.startsWith(`${conversationKey}|`)) this.seen.delete(key);
      }
    } else {
      this.history.clear();
      this.lastByConversation.clear();
      this.seen.clear();
    }
  }

  get conversationKeys(): string[] {
    return [...this.history.keys()];
  }

  /**
   * Builds the composite key. Text is one component among many, so two
   * identical texts in the same direction but different positions stay distinct.
   */
  private static key(identity: MessageIdentity): string {
    const parts = [
      identity.conversationKey,
      identity.direction,
      identity.ordinal,
      identity.timestamp ?? '',
      fingerprint(identity.normalizedText, 60),
      fingerprint(identity.neighbors, 30),
    ];
    return parts.join('|');
  }

  /**
   * Matches a candidate against known identities.
   *
   * A DOM id match is authoritative when the text still agrees. Otherwise we
   * fall back to a positional match: same direction, same ordinal, same text,
   * and either the same timestamp or a timestamp on one side only (timestamps
   * can appear late as a relative label).
   */
  private match(identity: MessageIdentity, known: MessageIdentity[]): MessageIdentity | null {
    // 1. Strong DOM id match.
    if (identity.domId) {
      for (const k of known) {
        if (k.domId && k.domId === identity.domId && k.direction === identity.direction) {
          if (k.normalizedText === identity.normalizedText || k.normalizedText === '') return k;
          // An edited bubble must reach the panel with its new content.
          continue;
        }
      }
      // Semantic message ids are stronger than position. A new message may
      // reuse a virtualized slot and have exactly the same text as its predecessor.
      if (identity.domId.startsWith('message:') && known.some(k => k.domId?.startsWith('message:'))) return null;
    }

    // 2. Positional match — same slot in the same conversation.
    const sameSlot = known.filter(
      (k) =>
        k.direction === identity.direction &&
        k.ordinal === identity.ordinal &&
        k.normalizedText === identity.normalizedText,
    );
    if (sameSlot.length === 1) {
      const k = sameSlot[0];
      const tsCompatible = k.timestamp === identity.timestamp || !k.timestamp || !identity.timestamp;
      if (tsCompatible) return k;
    }

    // 3. Neighbour-anchored match for messages that shifted position because
    //    something above them was added or removed.
    if (identity.neighbors) {
      const anchored = known.filter(
        (k) =>
          k.direction === identity.direction &&
          k.normalizedText === identity.normalizedText &&
          (k.timestamp === identity.timestamp || !k.timestamp || !identity.timestamp) &&
          k.ordinal === identity.ordinal &&
          k.neighbors === identity.neighbors,
      );
      if (anchored.length === 1) return anchored[0];
    }

    return null;
  }

  /**
   * Registers a batch of candidate messages.
   *
   * `id` is assigned by the caller (the conversation state) and is stable for
   * the lifetime of the session.
   */
  ingest(candidates: MessengerMessage[]): DedupResult {
    const added: MessengerMessage[] = [];
    let duplicates = 0;
    this.lastDuplicates = 0;

    for (const candidate of candidates) {
      const key = candidate.conversationKey;
      const known = this.history.get(key) ?? [];

      const identity: MessageIdentity = {
        domId: candidate.domId,
        conversationKey: key,
        direction: candidate.direction,
        timestamp: candidate.timestamp,
        normalizedText: normalizeForDisplay(candidate.text).normalize('NFC'),
        ordinal: candidate.ordinal,
        neighbors: '',
      };

      // Neighbour context is derived from the surrounding candidates.
      const idx = candidates.indexOf(candidate);
      const prev = candidates[idx - 1];
      const next = candidates[idx + 1];
      identity.neighbors = fingerprint(
        `${prev ? prev.text : ''}~${next ? next.text : ''}`,
        80,
      );

      const composite = MessageDeduplicator.key(identity);
      const matched = this.match(identity, known);

      if (matched) {
        duplicates += 1;
        this.lastDuplicates = duplicates;
        // Keep the strongest identity fields forward (a DOM id may appear later).
        if (!matched.domId && identity.domId) matched.domId = identity.domId;
        if (!matched.timestamp && identity.timestamp) matched.timestamp = identity.timestamp;
        this.seen.set(MessageDeduplicator.key(matched), matched);
        continue;
      }

      const stored: MessageIdentity = { ...identity };
      known.push(stored);
      this.history.set(key, known);
      this.seen.set(composite, stored);
      this.lastByConversation.set(key, stored);
      added.push(candidate);
    }

    return { added, duplicates };
  }

  /** True when the conversation key changed since the last ingest. */
  isKnownConversation(key: string): boolean {
    return this.history.has(key);
  }

  /**
   * Re-anchors a conversation after a scroll or a re-render: the DOM ids that
   * disappeared are forgotten so they can be re-detected later, but their
   * message ids stay stable in the conversation state.
   */
  forgetMissingDomIds(conversationKey: string, liveDomIds: Set<string>): void {
    const known = this.history.get(conversationKey);
    if (!known) return;
    for (const k of known) {
      if (k.domId && !liveDomIds.has(k.domId)) k.domId = null;
    }
  }
}
