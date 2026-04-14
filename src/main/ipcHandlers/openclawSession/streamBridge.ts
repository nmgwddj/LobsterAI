import { BrowserWindow } from 'electron';

import type {
  GatewayEventFrame,
  OpenClawRuntimeAdapter,
  OpenClawSessionProjectionEvent,
} from '../../libs/agentEngine/openclawRuntimeAdapter';
import { OpenClawSessionIpcChannel } from './constants';

const attachedAdapters = new WeakSet<OpenClawRuntimeAdapter>();

type OpenClawGatewayChatState = 'delta' | 'final' | 'aborted' | 'error';
type OpenClawGatewayAgentStream = 'assistant' | 'tool' | 'lifecycle' | 'error';

type OpenClawSessionStreamEvent =
  | {
    kind: 'chat';
    sessionKey: string;
    runId: string | null;
    seq: number | null;
    state: OpenClawGatewayChatState;
    message?: unknown;
    errorMessage?: string;
    stopReason?: string;
    receivedAt: number;
  }
  | {
    kind: 'agent';
    sessionKey: string;
    runId: string | null;
    seq: number | null;
    stream: OpenClawGatewayAgentStream;
    data?: unknown;
    receivedAt: number;
  }
  | {
    kind: 'session';
    sessionKey: string;
    event: 'userMessage';
    message: {
      role: 'user';
      content: string;
    };
    source: 'historySync';
    receivedAt: number;
  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
};

const toSeq = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const normalizeChatEvent = (event: GatewayEventFrame): OpenClawSessionStreamEvent | null => {
  if (event.event !== 'chat' || !isRecord(event.payload)) {
    return null;
  }

  const sessionKey = toTrimmedString(event.payload.sessionKey);
  const state = toTrimmedString(event.payload.state) as OpenClawGatewayChatState | null;
  if (!sessionKey || !state) {
    return null;
  }

  return {
    kind: 'chat',
    sessionKey,
    runId: toTrimmedString(event.payload.runId),
    seq: toSeq(event.seq),
    state,
    message: event.payload.message,
    errorMessage: toTrimmedString(event.payload.errorMessage) ?? undefined,
    stopReason: toTrimmedString(event.payload.stopReason) ?? undefined,
    receivedAt: Date.now(),
  };
};

const normalizeAgentEvent = (event: GatewayEventFrame): OpenClawSessionStreamEvent | null => {
  if (event.event !== 'agent' || !isRecord(event.payload)) {
    return null;
  }

  const sessionKey = toTrimmedString(event.payload.sessionKey);
  const stream = toTrimmedString(event.payload.stream) as OpenClawGatewayAgentStream | null;
  if (!sessionKey || !stream) {
    return null;
  }

  return {
    kind: 'agent',
    sessionKey,
    runId: toTrimmedString(event.payload.runId),
    seq: toSeq(event.seq),
    stream,
    data: event.payload.data,
    receivedAt: Date.now(),
  };
};

const normalizeStreamEvent = (event: GatewayEventFrame): OpenClawSessionStreamEvent | null => {
  return normalizeChatEvent(event) ?? normalizeAgentEvent(event);
};

const normalizeSessionProjectionEvent = (
  event: OpenClawSessionProjectionEvent,
): OpenClawSessionStreamEvent => {
  return {
    kind: 'session',
    sessionKey: event.sessionKey,
    event: event.kind,
    message: event.message,
    source: event.source,
    receivedAt: event.receivedAt,
  };
};

const forwardStreamEvent = (event: OpenClawSessionStreamEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    window.webContents.send(OpenClawSessionIpcChannel.StreamEvent, event);
  }
};

export function registerOpenClawSessionStreamBridge(
  getOpenClawRuntimeAdapter: () => OpenClawRuntimeAdapter | null,
): void {
  const adapter = getOpenClawRuntimeAdapter();
  if (!adapter) {
    return;
  }
  if (attachedAdapters.has(adapter)) {
    return;
  }
  attachedAdapters.add(adapter);

  adapter.onGatewayEvent((event) => {
    const normalized = normalizeStreamEvent(event);
    if (!normalized) {
      return;
    }
    forwardStreamEvent(normalized);
  });

  adapter.onSessionProjectionEvent((event) => {
    forwardStreamEvent(normalizeSessionProjectionEvent(event));
  });
}
