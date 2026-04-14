export interface OpenClawSessionListItem {
  sessionKey: string;
  title: string;
  canDelete: boolean;
  pinned: boolean;
  updatedAt: number;
  createdAt: number;
  modelProvider: string | null;
  model: string | null;
  lastMessagePreview: string | null;
  channel: string | null;
  origin: string | null;
  bindingState: OpenClawSessionBindingState;
  raw: Record<string, unknown>;
}

export const OpenClawSessionBindingState = {
  Current: 'current',
  Stale: 'stale',
  Unknown: 'unknown',
} as const;

export type OpenClawSessionBindingState =
  typeof OpenClawSessionBindingState[keyof typeof OpenClawSessionBindingState];

export interface OpenClawHistoryResult {
  sessionKey: string;
  messages: unknown[];
  raw: Record<string, unknown>;
}

export const OpenClawSessionRunPhase = {
  Idle: 'idle',
  Sending: 'sending',
  Running: 'running',
  Aborting: 'aborting',
} as const;

export type OpenClawSessionRunPhase =
  typeof OpenClawSessionRunPhase[keyof typeof OpenClawSessionRunPhase];

export const OpenClawGatewayEventKind = {
  Chat: 'chat',
  Agent: 'agent',
} as const;

export type OpenClawGatewayEventKind =
  typeof OpenClawGatewayEventKind[keyof typeof OpenClawGatewayEventKind];

export const OpenClawGatewayChatState = {
  Delta: 'delta',
  Final: 'final',
  Aborted: 'aborted',
  Error: 'error',
} as const;

export type OpenClawGatewayChatState =
  typeof OpenClawGatewayChatState[keyof typeof OpenClawGatewayChatState];

export const OpenClawGatewayAgentStream = {
  Assistant: 'assistant',
  Tool: 'tool',
  Lifecycle: 'lifecycle',
  Error: 'error',
} as const;

export type OpenClawGatewayAgentStream =
  typeof OpenClawGatewayAgentStream[keyof typeof OpenClawGatewayAgentStream];

export interface OpenClawChatStreamEvent {
  kind: typeof OpenClawGatewayEventKind.Chat;
  sessionKey: string;
  runId: string | null;
  seq: number | null;
  state: OpenClawGatewayChatState;
  message?: unknown;
  errorMessage?: string;
  stopReason?: string;
  receivedAt: number;
}

export interface OpenClawAgentStreamEvent {
  kind: typeof OpenClawGatewayEventKind.Agent;
  sessionKey: string;
  runId: string | null;
  seq: number | null;
  stream: OpenClawGatewayAgentStream;
  data?: unknown;
  receivedAt: number;
}

export interface OpenClawSessionUserMessageEvent {
  kind: 'session';
  sessionKey: string;
  event: 'userMessage';
  message: {
    role: 'user';
    content: string;
  };
  source: 'historySync';
  receivedAt: number;
}

export type OpenClawSessionStreamEvent =
  | OpenClawChatStreamEvent
  | OpenClawAgentStreamEvent
  | OpenClawSessionUserMessageEvent;

export interface OpenClawSessionProjectionStats {
  chatEventCount: number;
  agentEventCount: number;
  chatSeqGapCount: number;
  agentSeqGapCount: number;
  chatSeqRegressionCount: number;
  agentSeqRegressionCount: number;
  lastChatSeq: number | null;
  lastAgentSeq: number | null;
  driftDetectedCount: number;
  lastDriftAt: number | null;
  lastDriftReason: string | null;
}

export interface OpenClawSessionProjectionState {
  sessionKey: string;
  history: OpenClawHistoryResult | null;
  messages: unknown[];
  phase: OpenClawSessionRunPhase;
  runId: string | null;
  lastAckStatus: string | null;
  stats: OpenClawSessionProjectionStats;
}

export const OpenClawSessionListVisualState = {
  Default: 'default',
  Unread: 'unread',
  Running: 'running',
  Aborting: 'aborting',
  JustFinished: 'just_finished',
} as const;

export type OpenClawSessionListVisualState =
  typeof OpenClawSessionListVisualState[keyof typeof OpenClawSessionListVisualState];

export interface OpenClawSessionReadState {
  lastReadAt: number | null;
  lastSeenMessageFingerprint: string | null;
}

export interface OpenClawSessionFinishState {
  finishedAt: number | null;
}

export interface OpenClawSessionDriftMessageSummary {
  count: number;
  lastFingerprint: string | null;
  hasAssistantOutputAfterLastUser: boolean;
}

export interface OpenClawSessionDriftState {
  count: number;
  lastDetectedAt: number | null;
  lastReason: string | null;
  previous: OpenClawSessionDriftMessageSummary | null;
  history: OpenClawSessionDriftMessageSummary | null;
}

export interface OpenClawChatAttachmentInput {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content: string;
}

export interface OpenClawSessionSendInput {
  sessionKey: string;
  message: string;
  idempotencyKey: string;
  thinking?: string;
  deliver?: boolean;
  timeoutMs?: number;
  attachments?: OpenClawChatAttachmentInput[];
}

export interface OpenClawSessionPatchInput {
  sessionKey: string;
  label?: string | null;
  pinned?: boolean;
  model?: string | null;
}
