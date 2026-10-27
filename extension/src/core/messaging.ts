/**
 * Cross-context message contracts between the side panel, the service worker
 * and the content script. Kept in one place so both sides cannot drift.
 */

export const MSG = {
  contentReady: 'echo:content-ready',
  contentState: 'echo:content-state',
  contentMessages: 'echo:content-messages',
  panelHello: 'echo:panel-hello',
  start: 'echo:start',
  pause: 'echo:pause',
  resume: 'echo:resume',
  stop: 'echo:stop',
  getState: 'echo:getState',
  setInterval: 'echo:setInterval',
  clearConversation: 'echo:clearConversation',
  ackConversationChange: 'echo:ackConversationChange',
  composerStatus: 'echo:composerStatus',
  insertDraft: 'echo:insertDraft',
  broadcastState: 'echo:broadcast-state',
} as const;

export interface ContentSnapshot {
  monitoring: 'idle' | 'running' | 'paused' | 'stopped';
  scanInterval: number;
  conversation: { key: string; label: string; url: string | null } | null;
  messages: unknown[];
  diagnostics: import('./models').Diagnostics;
  conversationChanged: boolean;
}
