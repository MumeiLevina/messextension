import type { ConversationInfo, MessengerMessage } from './models';
import { MessageDeduplicator } from '../content/message-deduplicator';

/**
 * Holds the messages of the currently selected conversation.
 *
 * The state is strictly per-conversation: when the user switches threads the
 * previous thread's messages are archived under their own key and a new
 * conversation starts empty. Messages from different threads can never be
 * interleaved in the visible list.
 */
export class ConversationState {
  private conversations = new Map<string, ConversationInfo>();
  private messages = new Map<string, MessengerMessage[]>();
  private dedup = new MessageDeduplicator();
  private activeKey: string | null = null;
  private lastDuplicates = 0;

  get active(): ConversationInfo | null {
    return this.activeKey ? this.conversations.get(this.activeKey) ?? null : null;
  }

  get activeMessages(): MessengerMessage[] {
    return this.activeKey ? this.messages.get(this.activeKey) ?? [] : [];
  }

  /** All known conversations, most recently active first. */
  listConversations(): ConversationInfo[] {
    return [...this.conversations.values()];
  }

  /**
   * Selects a conversation. Returns true when the selection changed.
   */
  select(conversation: ConversationInfo): boolean {
    const changed = this.activeKey !== conversation.key;
    if (changed) {
      this.activeKey = conversation.key;
      this.messages.set(conversation.key, this.messages.get(conversation.key) ?? []);
    }
    this.conversations.set(conversation.key, conversation);
    return changed;
  }

  /**
   * Ingests a batch of extracted messages into the active conversation.
   * Returns only the messages that are genuinely new.
   */
  ingest(batch: MessengerMessage[]): MessengerMessage[] {
    if (!this.activeKey) return [];
    const list = this.messages.get(this.activeKey) ?? [];
    const result = this.dedup.ingest(batch);
    this.lastDuplicates = result.duplicates;
    for (const m of result.added) {
      list.push(m);
    }
    this.messages.set(this.activeKey, list);
    return result.added;
  }

  /** Number of duplicate events prevented in the last ingest call. */
  lastDuplicateCount(): number {
    return this.lastDuplicates;
  }

  clearActive(): void {
    if (!this.activeKey) return;
    this.messages.set(this.activeKey, []);
    this.dedup.reset(this.activeKey);
  }

  reset(): void {
    this.conversations.clear();
    this.messages.clear();
    this.dedup.reset();
    this.activeKey = null;
  }
}
