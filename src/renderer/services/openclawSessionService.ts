import { store } from '../store';
import {
  enterOpenClawDraft,
  exitOpenClawDraft,
  markOpenClawSessionRead,
  markOpenClawSessionUnread,
  recordOpenClawSessionDrift,
  removeOpenClawSessionItem,
  replaceOpenClawSessionProjection,
  setOpenClawCurrentHistory,
  setOpenClawCurrentSessionKey,
  setOpenClawDraftModelRef,
  setOpenClawLoadingHistory,
  setOpenClawLoadingList,
  setOpenClawSending,
  setOpenClawSessionItems,
  updateOpenClawSessionItem,
} from '../store/slices/openclawSessionSlice';
import type {
  OpenClawAgentStreamEvent,
  OpenClawChatAttachmentInput,
  OpenClawChatStreamEvent,
  OpenClawHistoryResult,
  OpenClawSessionDriftMessageSummary,
  OpenClawSessionDriftState,
  OpenClawSessionListItem,
  OpenClawSessionPatchInput,
  OpenClawSessionProjectionState,
  OpenClawSessionProjectionStats,
  OpenClawSessionRunPhase,
  OpenClawSessionSendInput,
  OpenClawSessionStreamEvent,
  OpenClawSessionUserMessageEvent,
} from '../types/openclawSession';
import {
  OpenClawGatewayAgentStream as OpenClawGatewayAgentStreamValue,
  OpenClawGatewayChatState as OpenClawGatewayChatStateValue,
  OpenClawSessionRunPhase as OpenClawSessionRunPhaseValue,
} from '../types/openclawSession';
import { toOpenClawModelRef } from '../utils/openclawModelRef';
import { i18nService } from './i18n';

const showToast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

const OpenClawProjectionMessageKind = {
  OptimisticUser: 'optimisticUser',
  SyncedUser: 'syncedUser',
  Assistant: 'assistant',
  Tool: 'tool',
  System: 'system',
} as const;

const OpenClawTextStreamMode = {
  Unknown: 'unknown',
  Snapshot: 'snapshot',
  Delta: 'delta',
} as const;

type OpenClawProjectionMessageKind =
  typeof OpenClawProjectionMessageKind[keyof typeof OpenClawProjectionMessageKind];

type OpenClawTextStreamMode =
  typeof OpenClawTextStreamMode[keyof typeof OpenClawTextStreamMode];

type OpenClawProjectionMessageMeta = {
  kind: OpenClawProjectionMessageKind;
  runId: string | null;
  segment?: 'pre_tool' | 'post_tool';
  toolCallId?: string | null;
  source?: 'agent' | 'chat' | 'local';
  idempotencyKey?: string | null;
  textStreamMode?: OpenClawTextStreamMode;
};

type OpenClawLocalMessageMeta = {
  skillIds?: string[];
};

type OpenClawProjectionMessageRecord = Record<string, unknown> & {
  lobsterProjection?: OpenClawProjectionMessageMeta;
  lobsterMessageMeta?: OpenClawLocalMessageMeta;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const safeTrim = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const stringifyStructured = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const collectTextBlocks = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? [text] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextBlocks(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  const texts: string[] = [];
  if (typeof value.text === 'string' && value.text.trim()) {
    texts.push(value.text.trim());
  }
  if (value.content !== undefined) {
    texts.push(...collectTextBlocks(value.content));
  }
  if (value.parts !== undefined) {
    texts.push(...collectTextBlocks(value.parts));
  }
  return texts;
};

const extractMessageText = (message: unknown): string => {
  if (!isRecord(message)) {
    return typeof message === 'string' ? message : '';
  }

  const textBlocks = collectTextBlocks(message.content);
  if (textBlocks.length > 0) {
    return textBlocks.join('\n').trim();
  }

  if (typeof message.text === 'string') {
    return message.text.trim();
  }

  return '';
};

const computeSuffixPrefixOverlap = (left: string, right: string): number => {
  const leftProbe = left.slice(-256);
  const rightProbe = right.slice(0, 256);
  const maxOverlap = Math.min(leftProbe.length, rightProbe.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (leftProbe.slice(-size) === rightProbe.slice(0, size)) {
      return size;
    }
  }
  return 0;
};

const mergeStreamingText = (
  previousText: string,
  incomingText: string,
  mode: OpenClawTextStreamMode,
): { text: string; mode: OpenClawTextStreamMode } => {
  if (!incomingText) {
    return { text: previousText, mode };
  }
  if (!previousText) {
    return { text: incomingText, mode };
  }
  if (incomingText === previousText) {
    return { text: previousText, mode };
  }

  if (mode === OpenClawTextStreamMode.Snapshot) {
    if (previousText.startsWith(incomingText) && incomingText.length < previousText.length) {
      return { text: previousText, mode };
    }
    return { text: incomingText, mode };
  }

  if (mode === OpenClawTextStreamMode.Delta) {
    if (incomingText.startsWith(previousText)) {
      return { text: incomingText, mode: OpenClawTextStreamMode.Snapshot };
    }
    const overlap = computeSuffixPrefixOverlap(previousText, incomingText);
    return { text: previousText + incomingText.slice(overlap), mode };
  }

  if (incomingText.startsWith(previousText) || incomingText.includes(previousText)) {
    return { text: incomingText, mode: OpenClawTextStreamMode.Snapshot };
  }
  if (previousText.startsWith(incomingText)) {
    return { text: previousText, mode: OpenClawTextStreamMode.Snapshot };
  }

  const overlap = computeSuffixPrefixOverlap(previousText, incomingText);
  if (overlap > 0) {
    return {
      text: previousText + incomingText.slice(overlap),
      mode: OpenClawTextStreamMode.Delta,
    };
  }

  return {
    text: previousText + incomingText,
    mode: OpenClawTextStreamMode.Delta,
  };
};

const createInitialStats = (): OpenClawSessionProjectionStats => ({
  chatEventCount: 0,
  agentEventCount: 0,
  chatSeqGapCount: 0,
  agentSeqGapCount: 0,
  chatSeqRegressionCount: 0,
  agentSeqRegressionCount: 0,
  lastChatSeq: null,
  lastAgentSeq: null,
  driftDetectedCount: 0,
  lastDriftAt: null,
  lastDriftReason: null,
});

const createInitialProjectionState = (sessionKey: string): OpenClawSessionProjectionState => ({
  sessionKey,
  history: null,
  messages: [],
  phase: OpenClawSessionRunPhaseValue.Idle,
  runId: null,
  lastAckStatus: null,
  stats: createInitialStats(),
});

const getProjectionMeta = (message: unknown): OpenClawProjectionMessageMeta | null => {
  if (!isRecord(message) || !isRecord(message.lobsterProjection)) {
    return null;
  }

  const kind = safeTrim(message.lobsterProjection.kind) as OpenClawProjectionMessageKind;
  if (!kind) {
    return null;
  }

  return {
    kind,
    runId: typeof message.lobsterProjection.runId === 'string'
      ? message.lobsterProjection.runId
      : null,
    segment: message.lobsterProjection.segment === 'post_tool'
      ? 'post_tool'
      : message.lobsterProjection.segment === 'pre_tool'
        ? 'pre_tool'
        : undefined,
    toolCallId: typeof message.lobsterProjection.toolCallId === 'string'
      ? message.lobsterProjection.toolCallId
      : null,
    source: message.lobsterProjection.source === 'agent'
      || message.lobsterProjection.source === 'chat'
      || message.lobsterProjection.source === 'local'
      ? message.lobsterProjection.source
      : undefined,
    idempotencyKey: typeof message.lobsterProjection.idempotencyKey === 'string'
      ? message.lobsterProjection.idempotencyKey
      : null,
    textStreamMode: message.lobsterProjection.textStreamMode === OpenClawTextStreamMode.Snapshot
      ? OpenClawTextStreamMode.Snapshot
      : message.lobsterProjection.textStreamMode === OpenClawTextStreamMode.Delta
        ? OpenClawTextStreamMode.Delta
        : message.lobsterProjection.textStreamMode === OpenClawTextStreamMode.Unknown
          ? OpenClawTextStreamMode.Unknown
          : undefined,
  };
};

const withProjectionMeta = (
  message: Record<string, unknown>,
  meta: OpenClawProjectionMessageMeta,
): OpenClawProjectionMessageRecord => ({
  ...message,
  lobsterProjection: meta,
});

const withLocalMessageMeta = (
  message: OpenClawProjectionMessageRecord,
  localMeta?: OpenClawLocalMessageMeta,
): OpenClawProjectionMessageRecord => {
  if (!localMeta || !Array.isArray(localMeta.skillIds) || localMeta.skillIds.length === 0) {
    return message;
  }

  return {
    ...message,
    lobsterMessageMeta: {
      skillIds: [...localMeta.skillIds],
    },
  };
};

const getLocalMessageMeta = (message: unknown): OpenClawLocalMessageMeta | null => {
  if (!isRecord(message) || !isRecord(message.lobsterMessageMeta)) {
    return null;
  }

  const skillIds = Array.isArray(message.lobsterMessageMeta.skillIds)
    ? message.lobsterMessageMeta.skillIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];

  if (skillIds.length === 0) {
    return null;
  }

  return {
    skillIds,
  };
};

const buildOptimisticUserMessage = (
  input: { message: string; attachments?: OpenClawChatAttachmentInput[]; skillIds?: string[] },
  idempotencyKey: string,
): OpenClawProjectionMessageRecord => {
  const trimmedMessage = input.message.trim();
  const content = trimmedMessage || i18nService.t('openclawSessionAttachmentOnlyMessage');
  return withLocalMessageMeta(withProjectionMeta({
    role: 'user',
    content,
    attachments: input.attachments,
  }, {
    kind: OpenClawProjectionMessageKind.OptimisticUser,
    runId: null,
    source: 'local',
    idempotencyKey,
  }), {
    skillIds: input.skillIds,
  });
};

const buildSystemMessage = (text: string, runId: string | null): OpenClawProjectionMessageRecord => {
  return withProjectionMeta({
    role: 'system',
    content: text,
  }, {
    kind: OpenClawProjectionMessageKind.System,
    runId,
    source: 'local',
  });
};

const updateStats = (
  stats: OpenClawSessionProjectionStats,
  event: OpenClawSessionStreamEvent,
): OpenClawSessionProjectionStats => {
  if (event.kind === 'session') {
    return stats;
  }

  const next = { ...stats };
  const isChat = event.kind === 'chat';
  const previousSeq = isChat ? next.lastChatSeq : next.lastAgentSeq;

  if (isChat) {
    next.chatEventCount += 1;
  } else {
    next.agentEventCount += 1;
  }

  if (typeof event.seq === 'number') {
    if (typeof previousSeq === 'number') {
      if (event.seq < previousSeq) {
        if (isChat) {
          next.chatSeqRegressionCount += 1;
        } else {
          next.agentSeqRegressionCount += 1;
        }
      } else if (event.seq > previousSeq + 1) {
        if (isChat) {
          next.chatSeqGapCount += 1;
        } else {
          next.agentSeqGapCount += 1;
        }
      }
    }

    if (isChat) {
      next.lastChatSeq = event.seq;
    } else {
      next.lastAgentSeq = event.seq;
    }
  }

  return next;
};

const findProjectionMessageIndex = (
  messages: unknown[],
  predicate: (meta: OpenClawProjectionMessageMeta | null) => boolean,
): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(getProjectionMeta(messages[index]))) {
      return index;
    }
  }
  return -1;
};

const findAssistantProjectionIndex = (
  messages: unknown[],
  runId: string | null,
  segment: 'pre_tool' | 'post_tool',
): number => {
  return findProjectionMessageIndex(messages, (meta) => {
    return meta?.kind === OpenClawProjectionMessageKind.Assistant
      && meta.runId === runId
      && (meta.segment ?? 'pre_tool') === segment;
  });
};

const findToolProjectionIndex = (messages: unknown[], runId: string | null, toolCallId: string): number => {
  return findProjectionMessageIndex(messages, (meta) => {
    return meta?.kind === OpenClawProjectionMessageKind.Tool
      && meta.runId === runId
      && meta.toolCallId === toolCallId;
  });
};

const replaceMessageAt = (
  messages: unknown[],
  index: number,
  message: OpenClawProjectionMessageRecord,
): unknown[] => {
  const nextMessages = [...messages];
  nextMessages[index] = message;
  return nextMessages;
};

const appendMessage = (
  messages: unknown[],
  message: OpenClawProjectionMessageRecord,
): unknown[] => [...messages, message];

const removeOptimisticUserMessages = (messages: unknown[]): unknown[] => {
  return messages.filter((message) => getProjectionMeta(message)?.kind !== OpenClawProjectionMessageKind.OptimisticUser);
};

const hasToolProjectionForRun = (messages: unknown[], runId: string | null): boolean => {
  return messages.some((message) => {
    const meta = getProjectionMeta(message);
    return meta?.kind === OpenClawProjectionMessageKind.Tool && meta.runId === runId;
  });
};

const upsertAssistantMessage = (
  runtime: OpenClawSessionProjectionState,
  options: {
    runId: string | null;
    message?: unknown;
    text?: string;
    source: 'agent' | 'chat';
    replaceExisting?: boolean;
  },
): OpenClawSessionProjectionState => {
  const segment: 'pre_tool' | 'post_tool' = hasToolProjectionForRun(runtime.messages, options.runId)
    ? 'post_tool'
    : 'pre_tool';
  const index = findAssistantProjectionIndex(runtime.messages, options.runId, segment);
  const existingMeta = index >= 0 ? getProjectionMeta(runtime.messages[index]) : null;
  const existingText = index >= 0 ? extractMessageText(runtime.messages[index]) : '';
  const incomingText = options.text ?? extractMessageText(options.message);
  const merged = options.replaceExisting
    ? { text: incomingText, mode: OpenClawTextStreamMode.Snapshot }
    : mergeStreamingText(
      existingText,
      incomingText,
      existingMeta?.textStreamMode ?? OpenClawTextStreamMode.Unknown,
    );
  const mergedText = merged.text;

  if (!mergedText && !options.message) {
    return runtime;
  }

  if (existingMeta?.source === 'agent' && options.source === 'chat' && !options.replaceExisting) {
    return runtime;
  }

  const nextMessage = options.message && isRecord(options.message)
    ? withProjectionMeta({ ...options.message }, {
      kind: OpenClawProjectionMessageKind.Assistant,
      runId: options.runId,
      segment,
      source: options.source,
      textStreamMode: options.source === 'chat' ? OpenClawTextStreamMode.Snapshot : merged.mode,
    })
    : withProjectionMeta({
      role: 'assistant',
      content: mergedText,
    }, {
      kind: OpenClawProjectionMessageKind.Assistant,
      runId: options.runId,
      segment,
      source: options.source,
      textStreamMode: options.source === 'chat' ? OpenClawTextStreamMode.Snapshot : merged.mode,
    });

  if (
    index >= 0
    && mergedText === existingText
    && existingMeta?.source === options.source
    && existingMeta?.segment === segment
    && (existingMeta?.textStreamMode ?? OpenClawTextStreamMode.Unknown)
      === (options.source === 'chat' ? OpenClawTextStreamMode.Snapshot : merged.mode)
  ) {
    return runtime;
  }

  const nextMessages = index >= 0
    ? replaceMessageAt(runtime.messages, index, nextMessage)
    : appendMessage(runtime.messages, nextMessage);

  return {
    ...runtime,
    messages: nextMessages,
  };
};

const upsertToolMessage = (
  runtime: OpenClawSessionProjectionState,
  params: {
    runId: string | null;
    toolCallId: string;
    toolName: string;
    args?: unknown;
    result?: unknown;
  },
): OpenClawSessionProjectionState => {
  const index = findToolProjectionIndex(runtime.messages, params.runId, params.toolCallId);
  const current = index >= 0 && isRecord(runtime.messages[index]) ? runtime.messages[index] : null;
  const currentContent = Array.isArray(current?.content) ? current.content[0] : null;
  const extraContent = params.result !== undefined
    ? stringifyStructured(params.result)
    : isRecord(currentContent) && currentContent.extra_content !== undefined
      ? currentContent.extra_content
      : '';

  const nextToolMessage = withProjectionMeta({
    role: 'assistant',
    content: [{
      type: 'toolCall',
      name: params.toolName,
      arguments: params.args ?? (isRecord(currentContent) ? currentContent.arguments : undefined),
      extra_content: extraContent,
    }],
  }, {
    kind: OpenClawProjectionMessageKind.Tool,
    runId: params.runId,
    toolCallId: params.toolCallId,
    source: 'agent',
  });

  const nextMessages = index >= 0
    ? replaceMessageAt(runtime.messages, index, nextToolMessage)
    : appendMessage(runtime.messages, nextToolMessage);

  return {
    ...runtime,
    messages: nextMessages,
  };
};

const isProjectionToolMessage = (message: unknown): boolean => {
  return getProjectionMeta(message)?.kind === OpenClawProjectionMessageKind.Tool;
};

const hasAssistantOutputAfterLastUser = (messages: unknown[]): boolean => {
  let sawLatestUser = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role = isRecord(message) ? safeTrim(message.role).toLowerCase() : '';
    if (role === 'assistant' || role === 'system') {
      if (role === 'assistant' && isProjectionToolMessage(message)) {
        continue;
      }
      if (!sawLatestUser) {
        return true;
      }
    }
    if (role === 'user') {
      if (!sawLatestUser) {
        sawLatestUser = true;
        continue;
      }
      return false;
    }
  }
  return false;
};

const buildUserSkillIdQueue = (messages: unknown[]): Array<{ text: string; skillIds: string[] }> => {
  return messages
    .map((message) => {
      const role = isRecord(message) ? safeTrim(message.role).toLowerCase() : '';
      const localMeta = getLocalMessageMeta(message);
      const text = extractMessageText(message).trim();
      if (role !== 'user' || !text || !localMeta?.skillIds?.length) {
        return null;
      }
      return {
        text,
        skillIds: localMeta.skillIds,
      };
    })
    .filter((entry): entry is { text: string; skillIds: string[] } => Boolean(entry));
};

const applyUserSkillMetadataFromPreviousProjection = (
  messages: unknown[],
  previous: OpenClawSessionProjectionState | null,
): unknown[] => {
  if (!previous) {
    return messages;
  }

  const pendingUserSkills = buildUserSkillIdQueue(previous.messages);
  if (pendingUserSkills.length === 0) {
    return messages;
  }

  return messages.map((message) => {
    const role = isRecord(message) ? safeTrim(message.role).toLowerCase() : '';
    const text = extractMessageText(message).trim();
    if (role !== 'user' || !text) {
      return message;
    }

    const matched = pendingUserSkills[0];
    if (!matched || matched.text !== text) {
      return message;
    }

    pendingUserSkills.shift();
    if (!isRecord(message)) {
      return message;
    }

    return withLocalMessageMeta({ ...message }, {
      skillIds: matched.skillIds,
    });
  });
};

const shouldCollapseAssistantHistoryMessage = (
  previousMessage: unknown,
  nextMessage: unknown,
): boolean => {
  const previousRole = isRecord(previousMessage) ? safeTrim(previousMessage.role).toLowerCase() : '';
  const nextRole = isRecord(nextMessage) ? safeTrim(nextMessage.role).toLowerCase() : '';
  if (previousRole !== 'assistant' || nextRole !== 'assistant') {
    return false;
  }

  if (isProjectionToolMessage(previousMessage) || isProjectionToolMessage(nextMessage)) {
    return false;
  }

  const previousText = extractMessageText(previousMessage).trim();
  const nextText = extractMessageText(nextMessage).trim();
  if (!previousText || !nextText) {
    return false;
  }

  return previousText === nextText
    || nextText.includes(previousText)
    || previousText.includes(nextText);
};

const normalizeHistoryMessages = (messages: unknown[]): unknown[] => {
  const normalized: unknown[] = [];

  messages.forEach((message) => {
    const role = isRecord(message) ? safeTrim(message.role).toLowerCase() : '';
    if (role === 'user') {
      normalized.push(message);
      return;
    }

    const previousMessage = normalized[normalized.length - 1];
    if (previousMessage && shouldCollapseAssistantHistoryMessage(previousMessage, message)) {
      const previousText = extractMessageText(previousMessage).trim();
      const nextText = extractMessageText(message).trim();
      if (nextText.length >= previousText.length) {
        normalized[normalized.length - 1] = message;
      }
      return;
    }

    normalized.push(message);
  });

  return normalized;
};

const applyHistoryBaseline = (
  sessionKey: string,
  history: OpenClawHistoryResult,
  previous: OpenClawSessionProjectionState | null,
): OpenClawSessionProjectionState => {
  const historyMessages = Array.isArray(history.messages)
    ? normalizeHistoryMessages([...history.messages])
    : [];
  return {
    sessionKey,
    history,
    messages: applyUserSkillMetadataFromPreviousProjection(historyMessages, previous),
    phase: OpenClawSessionRunPhaseValue.Idle,
    runId: null,
    lastAckStatus: previous?.lastAckStatus ?? null,
    stats: previous?.stats ?? createInitialStats(),
  };
};

const computeLastMessageFingerprint = (messages: unknown[]): string | null => {
  if (messages.length === 0) {
    return null;
  }

  const lastMessage = messages[messages.length - 1];
  if (typeof lastMessage === 'string') {
    return lastMessage;
  }

  try {
    return JSON.stringify(lastMessage);
  } catch {
    return String(lastMessage);
  }
};

const summarizeMessagesForDrift = (messages: unknown[]): OpenClawSessionDriftMessageSummary => {
  return {
    count: messages.length,
    lastFingerprint: computeLastMessageFingerprint(messages),
    hasAssistantOutputAfterLastUser: hasAssistantOutputAfterLastUser(messages),
  };
};

class OpenClawSessionService {
  private initialized = false;
  private pendingFinalHistorySyncKeys = new Set<string>();
  private pendingAssistantEventsBySessionKey = new Map<string, OpenClawAgentStreamEvent>();
  private assistantEventFlushTimer: number | null = null;
  private static readonly ASSISTANT_EVENT_THROTTLE_MS = 60;

  private logSessionHistoryDebug(sessionKey: string, messages: unknown[]): void {
    const state = store.getState().openclawSession;
    const session = state.items.find((item) => item.sessionKey === sessionKey) ?? null;

    console.log('[OpenClawSessionService] loaded session detail:', {
      sessionKey,
      session,
    });
    console.log('[OpenClawSessionService] loaded session history:', {
      sessionKey,
      messageCount: messages.length,
      messages,
    });
  }

  private detectProjectionDrift(
    sessionKey: string,
    previous: OpenClawSessionProjectionState | null,
    nextHistory: OpenClawHistoryResult,
  ): { stats: OpenClawSessionProjectionStats; drift: OpenClawSessionDriftState } | null {
    if (!previous) {
      return null;
    }

    const previousSummary = summarizeMessagesForDrift(previous.messages);
    const nextSummary = summarizeMessagesForDrift(Array.isArray(nextHistory.messages) ? nextHistory.messages : []);

    if (
      previousSummary.hasAssistantOutputAfterLastUser
      || !nextSummary.hasAssistantOutputAfterLastUser
      || previousSummary.lastFingerprint === nextSummary.lastFingerprint
    ) {
      return null;
    }

    const detectedAt = Date.now();
    const reason = 'history_contains_assistant_output_missing_from_projection';

    console.warn('[OpenClawSessionService] projection drift detected after history reload:', {
      sessionKey,
      reason,
      previous: previousSummary,
      history: nextSummary,
      runId: previous.runId,
      phase: previous.phase,
      stats: previous.stats,
      detectedAt,
    });

    return {
      stats: {
        ...previous.stats,
        driftDetectedCount: previous.stats.driftDetectedCount + 1,
        lastDriftAt: detectedAt,
        lastDriftReason: reason,
      },
      drift: {
        count: previous.stats.driftDetectedCount + 1,
        lastDetectedAt: detectedAt,
        lastReason: reason,
        previous: previousSummary,
        history: nextSummary,
      },
    };
  }

  private createDraftSessionKey(): string {
    const currentAgentId = store.getState().agent.currentAgentId?.trim() || 'main';
    return `agent:${currentAgentId}:lobsterai:direct:${crypto.randomUUID()}`;
  }

  private buildFinalHistorySyncKey(sessionKey: string, runId: string | null): string {
    return `${sessionKey}::${runId ?? 'no-run'}`;
  }

  private ensureInitialized(): void {
    if (this.initialized) {
      return;
    }

    const api = window.electron?.openclawSessions;
    if (!api?.onStreamEvent) {
      return;
    }

    api.onStreamEvent((event) => {
      this.handleStreamEvent(event as OpenClawSessionStreamEvent);
    });
    this.initialized = true;
  }

  private getProjection(sessionKey: string): OpenClawSessionProjectionState {
    return store.getState().openclawSession.projectionBySessionKey[sessionKey]
      ?? createInitialProjectionState(sessionKey);
  }

  private writeProjection(projection: OpenClawSessionProjectionState): void {
    store.dispatch(replaceOpenClawSessionProjection(projection));
    this.syncSendingFlag();
  }

  private syncUnreadStateForProjection(sessionKey: string, projection: OpenClawSessionProjectionState): void {
    const state = store.getState().openclawSession;
    const fingerprint = computeLastMessageFingerprint(projection.messages);
    const readState = state.readStateBySessionKey[sessionKey];
    const hasAssistantOutput = hasAssistantOutputAfterLastUser(projection.messages);

    if (state.currentSessionKey === sessionKey) {
      store.dispatch(markOpenClawSessionRead({
        sessionKey,
        fingerprint,
      }));
      return;
    }

    if (!hasAssistantOutput || !fingerprint || readState?.lastSeenMessageFingerprint === fingerprint) {
      return;
    }

    store.dispatch(markOpenClawSessionUnread(sessionKey));
  }

  private syncSendingFlag(): void {
    const state = store.getState().openclawSession;
    const currentSessionKey = state.currentSessionKey;
    const currentProjection = currentSessionKey
      ? state.projectionBySessionKey[currentSessionKey] ?? null
      : null;
    const sending = currentProjection !== null
      && currentProjection.phase !== OpenClawSessionRunPhaseValue.Idle;
    store.dispatch(setOpenClawSending(sending));
  }

  private shouldScheduleFinalHistorySync(
    event: OpenClawChatStreamEvent,
    projection: OpenClawSessionProjectionState,
  ): boolean {
    if (event.state !== OpenClawGatewayChatStateValue.Final) {
      return false;
    }

    const state = store.getState().openclawSession;
    if (state.currentSessionKey !== event.sessionKey) {
      return false;
    }

    const finalText = event.message !== undefined ? extractMessageText(event.message).trim() : '';
    if (finalText) {
      return false;
    }

    return !hasAssistantOutputAfterLastUser(projection.messages);
  }

  private scheduleFinalHistorySync(sessionKey: string, runId: string | null): void {
    const syncKey = this.buildFinalHistorySyncKey(sessionKey, runId);
    if (this.pendingFinalHistorySyncKeys.has(syncKey)) {
      return;
    }

    this.pendingFinalHistorySyncKeys.add(syncKey);
    console.warn('[OpenClawSessionService] scheduling targeted final history sync:', {
      sessionKey,
      runId,
      reason: 'chat_final_missing_text',
    });

    window.setTimeout(() => {
      const state = store.getState().openclawSession;
      if (state.currentSessionKey !== sessionKey) {
        this.pendingFinalHistorySyncKeys.delete(syncKey);
        return;
      }

      void this.fetchHistory(sessionKey, false)
        .catch((error) => {
          console.error('[OpenClawSessionService] targeted final history sync failed:', error);
        })
        .finally(() => {
          this.pendingFinalHistorySyncKeys.delete(syncKey);
        });
    }, 120);
  }

  private async fetchList(showLoading: boolean): Promise<void> {
    this.ensureInitialized();
    const api = window.electron?.openclawSessions;
    if (!api) return;

    if (showLoading) {
      store.dispatch(setOpenClawLoadingList(true));
    }
    try {
      const result = await api.list();
      if (result.success && result.result?.sessions) {
        const sessions = result.result.sessions as unknown as OpenClawSessionListItem[];
        store.dispatch(setOpenClawSessionItems(sessions));
      }
    } finally {
      if (showLoading) {
        store.dispatch(setOpenClawLoadingList(false));
      }
    }
  }

  async loadList(): Promise<void> {
    await this.fetchList(true);
  }

  private async fetchHistory(sessionKey: string, showLoading: boolean): Promise<void> {
    this.ensureInitialized();
    const api = window.electron?.openclawSessions;
    if (!api || !sessionKey) return;

    store.dispatch(exitOpenClawDraft());
    store.dispatch(setOpenClawCurrentSessionKey(sessionKey));
    if (showLoading) {
      store.dispatch(setOpenClawLoadingHistory(true));
    }
    try {
      const result = await api.getHistory(sessionKey);
      if (result.success && result.result) {
        const messages = Array.isArray(result.result.messages) ? result.result.messages : [];
        this.logSessionHistoryDebug(sessionKey, messages);
        const previousProjection = store.getState().openclawSession.projectionBySessionKey[sessionKey] ?? null;
        const driftResult = this.detectProjectionDrift(sessionKey, previousProjection, result.result);
        const projection = applyHistoryBaseline(
          sessionKey,
          result.result,
          previousProjection,
        );
        if (driftResult) {
          projection.stats = driftResult.stats;
          store.dispatch(recordOpenClawSessionDrift({
            sessionKey,
            drift: driftResult.drift,
          }));
        }
        store.dispatch(setOpenClawCurrentHistory(result.result));
        this.writeProjection(projection);
        store.dispatch(markOpenClawSessionRead({
          sessionKey,
          fingerprint: computeLastMessageFingerprint(projection.messages),
        }));
      }
    } finally {
      if (showLoading) {
        store.dispatch(setOpenClawLoadingHistory(false));
      }
    }
  }

  async loadHistory(sessionKey: string): Promise<void> {
    await this.fetchHistory(sessionKey, true);
  }

  private updateProjectionForEvent(
    sessionKey: string,
    updater: (projection: OpenClawSessionProjectionState) => OpenClawSessionProjectionState,
  ): OpenClawSessionProjectionState {
    const projection = updater(this.getProjection(sessionKey));
    this.writeProjection(projection);
    return projection;
  }

  private handleChatEvent(projection: OpenClawSessionProjectionState, event: OpenClawChatStreamEvent) {
    let nextProjection: OpenClawSessionProjectionState = {
      ...projection,
      runId: event.runId ?? projection.runId,
      stats: updateStats(projection.stats, event),
    };

    if (event.state === OpenClawGatewayChatStateValue.Delta) {
      nextProjection = {
        ...nextProjection,
        phase: OpenClawSessionRunPhaseValue.Running,
      };
      if (event.message !== undefined) {
        nextProjection = upsertAssistantMessage(nextProjection, {
          runId: event.runId,
          message: event.message,
          source: 'chat',
        });
      }
      return nextProjection;
    }

    if (event.state === OpenClawGatewayChatStateValue.Final) {
      nextProjection = {
        ...nextProjection,
        phase: OpenClawSessionRunPhaseValue.Idle,
      };
      if (event.message !== undefined) {
        nextProjection = upsertAssistantMessage(nextProjection, {
          runId: event.runId,
          message: event.message,
          source: 'chat',
          replaceExisting: false,
        });
      }
      return nextProjection;
    }

    if (event.state === OpenClawGatewayChatStateValue.Aborted) {
      nextProjection = {
        ...nextProjection,
        phase: OpenClawSessionRunPhaseValue.Idle,
      };
      if (event.message !== undefined) {
        nextProjection = upsertAssistantMessage(nextProjection, {
          runId: event.runId,
          message: event.message,
          source: 'chat',
        });
      }
      return {
        ...nextProjection,
        messages: appendMessage(
          nextProjection.messages,
          buildSystemMessage(i18nService.t('openclawSessionRunAborted'), event.runId),
        ),
      };
    }

    if (event.state === OpenClawGatewayChatStateValue.Error) {
      const errorText = event.errorMessage
        ? `${i18nService.t('openclawSessionRunErrorPrefix')}${event.errorMessage}`
        : i18nService.t('openclawSessionRunFailed');
      return {
        ...nextProjection,
        phase: OpenClawSessionRunPhaseValue.Idle,
        messages: appendMessage(
          nextProjection.messages,
          buildSystemMessage(errorText, event.runId),
        ),
      };
    }

    return nextProjection;
  }

  private handleAgentEvent(
    projection: OpenClawSessionProjectionState,
    event: OpenClawAgentStreamEvent,
  ): OpenClawSessionProjectionState {
    let nextProjection: OpenClawSessionProjectionState = {
      ...projection,
      runId: event.runId ?? projection.runId,
      stats: updateStats(projection.stats, event),
    };

    if (event.stream === OpenClawGatewayAgentStreamValue.Assistant) {
      const assistantText = extractMessageText(event.data);
      if (!assistantText) {
        return {
          ...nextProjection,
          phase: OpenClawSessionRunPhaseValue.Running,
        };
      }

      nextProjection = upsertAssistantMessage({
        ...nextProjection,
        phase: OpenClawSessionRunPhaseValue.Running,
      }, {
        runId: event.runId,
        text: assistantText,
        source: 'agent',
      });
      return nextProjection;
    }

    if (event.stream === OpenClawGatewayAgentStreamValue.Tool && isRecord(event.data)) {
      const phase = safeTrim(event.data.phase);
      const toolCallId = safeTrim(event.data.toolCallId);
      const toolName = safeTrim(event.data.name) || 'tool';
      if (!toolCallId) {
        return nextProjection;
      }

      if (phase === 'start') {
        return upsertToolMessage({
          ...nextProjection,
          phase: OpenClawSessionRunPhaseValue.Running,
        }, {
          runId: event.runId,
          toolCallId,
          toolName,
          args: event.data.args,
        });
      }

      if (phase === 'update') {
        return upsertToolMessage({
          ...nextProjection,
          phase: OpenClawSessionRunPhaseValue.Running,
        }, {
          runId: event.runId,
          toolCallId,
          toolName,
          result: event.data.partialResult,
        });
      }

      if (phase === 'result') {
        return upsertToolMessage({
          ...nextProjection,
          phase: OpenClawSessionRunPhaseValue.Running,
        }, {
          runId: event.runId,
          toolCallId,
          toolName,
          result: event.data.result,
        });
      }
    }

    if (event.stream === OpenClawGatewayAgentStreamValue.Lifecycle && isRecord(event.data)) {
      const phase = safeTrim(event.data.phase);
      if (phase === 'start') {
        return {
          ...nextProjection,
          phase: OpenClawSessionRunPhaseValue.Running,
        };
      }
      if (phase === 'end' || phase === 'error') {
        return {
          ...nextProjection,
          phase: OpenClawSessionRunPhaseValue.Idle,
        };
      }
    }

    return nextProjection;
  }

  private handleSessionEvent(
    projection: OpenClawSessionProjectionState,
    event: OpenClawSessionUserMessageEvent,
  ): OpenClawSessionProjectionState {
    if (event.event !== 'userMessage') {
      return projection;
    }

    const nextMessage = withProjectionMeta({
      role: 'user',
      content: event.message.content,
    }, {
      kind: OpenClawProjectionMessageKind.SyncedUser,
      runId: null,
      source: 'local',
      idempotencyKey: `history-sync-user:${event.receivedAt}:${event.message.content}`,
    });
    const previousLocalMeta = getLocalMessageMeta(
      projection.messages[projection.messages.length - 1],
    );
    const nextUserMessage = withLocalMessageMeta(nextMessage, previousLocalMeta ?? undefined);

    const lastMessage = projection.messages[projection.messages.length - 1];
    const lastRole = isRecord(lastMessage) ? safeTrim(lastMessage.role).toLowerCase() : '';
    const lastText = extractMessageText(lastMessage).trim();
    if (lastRole === 'user' && lastText === event.message.content.trim()) {
      return projection;
    }

    return {
      ...projection,
      messages: appendMessage(
        removeOptimisticUserMessages(projection.messages),
        nextUserMessage,
      ),
    };
  }

  private shouldThrottleStreamEvent(event: OpenClawSessionStreamEvent): event is OpenClawAgentStreamEvent {
    return event.kind === 'agent' && event.stream === OpenClawGatewayAgentStreamValue.Assistant;
  }

  private scheduleAssistantEventFlush(): void {
    if (this.assistantEventFlushTimer !== null) {
      return;
    }
    this.assistantEventFlushTimer = window.setTimeout(() => {
      this.assistantEventFlushTimer = null;
      this.flushPendingAssistantEvents();
    }, OpenClawSessionService.ASSISTANT_EVENT_THROTTLE_MS);
  }

  private enqueueAssistantEvent(event: OpenClawAgentStreamEvent): void {
    this.pendingAssistantEventsBySessionKey.set(event.sessionKey, event);
    this.scheduleAssistantEventFlush();
  }

  private flushPendingAssistantEvents(sessionKey?: string): void {
    if (sessionKey) {
      const pendingEvent = this.pendingAssistantEventsBySessionKey.get(sessionKey);
      if (!pendingEvent) {
        return;
      }
      this.pendingAssistantEventsBySessionKey.delete(sessionKey);
      this.processStreamEvent(pendingEvent);
      return;
    }

    if (this.pendingAssistantEventsBySessionKey.size === 0) {
      return;
    }

    const pendingEvents = Array.from(this.pendingAssistantEventsBySessionKey.values());
    this.pendingAssistantEventsBySessionKey.clear();
    pendingEvents.forEach((pendingEvent) => this.processStreamEvent(pendingEvent));
  }

  private processStreamEvent(event: OpenClawSessionStreamEvent): void {
    if (!event.sessionKey) {
      return;
    }

    const nextProjection = this.updateProjectionForEvent(event.sessionKey, (projection) => {
      const nextProjection = event.kind === 'chat'
        ? this.handleChatEvent(projection, event)
        : event.kind === 'agent'
          ? this.handleAgentEvent(projection, event)
          : this.handleSessionEvent(projection, event);

      return nextProjection;
    });
    this.syncUnreadStateForProjection(event.sessionKey, nextProjection);

    if (event.kind === 'chat' && this.shouldScheduleFinalHistorySync(event, nextProjection)) {
      this.scheduleFinalHistorySync(event.sessionKey, event.runId);
    }

    const state = store.getState().openclawSession;
    const sessionExists = state.items.some((item) => item.sessionKey === event.sessionKey);
    if (!sessionExists) {
      void this.fetchList(false);
      return;
    }

    if (
      event.kind === 'chat'
      && (
        event.state === OpenClawGatewayChatStateValue.Final
        || event.state === OpenClawGatewayChatStateValue.Aborted
        || event.state === OpenClawGatewayChatStateValue.Error
      )
    ) {
      void this.fetchList(false);
    }
  }

  private handleStreamEvent(event: OpenClawSessionStreamEvent): void {
    if (!event.sessionKey) {
      return;
    }

    if (this.shouldThrottleStreamEvent(event)) {
      this.enqueueAssistantEvent(event);
      return;
    }

    this.flushPendingAssistantEvents(event.sessionKey);
    this.processStreamEvent(event);
  }

  async sendMessage(input: Omit<OpenClawSessionSendInput, 'idempotencyKey'>): Promise<boolean> {
    this.ensureInitialized();
    const api = window.electron?.openclawSessions;
    const normalizedSessionKey = input.sessionKey.trim();
    if (!api || !normalizedSessionKey) return false;

    const hasMessage = input.message.trim().length > 0;
    const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;
    if (!hasMessage && !hasAttachments) return false;

    const idempotencyKey = `lobster-openclaw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const activeSkillIds = [...store.getState().skill.activeSkillIds];

    this.updateProjectionForEvent(normalizedSessionKey, (projection) => ({
      ...projection,
      messages: appendMessage(
        removeOptimisticUserMessages(projection.messages),
        buildOptimisticUserMessage({
          ...input,
          skillIds: activeSkillIds,
        }, idempotencyKey),
      ),
      phase: OpenClawSessionRunPhaseValue.Sending,
      runId: null,
    }));

    const result = await api.send({
      ...input,
      sessionKey: normalizedSessionKey,
      idempotencyKey,
    });

    if (!result.success) {
      this.updateProjectionForEvent(normalizedSessionKey, (projection) => ({
        ...projection,
        messages: removeOptimisticUserMessages(projection.messages),
        phase: OpenClawSessionRunPhaseValue.Idle,
      }));
      showToast(result.error || i18nService.t('openclawSessionSendFailed'));
      return false;
    }

    this.updateProjectionForEvent(normalizedSessionKey, (projection) => ({
      ...projection,
      phase: OpenClawSessionRunPhaseValue.Running,
      runId: typeof result.result?.runId === 'string' ? result.result.runId : projection.runId,
      lastAckStatus: typeof result.result?.status === 'string' ? result.result.status : projection.lastAckStatus,
    }));

    await this.fetchList(false);
    return true;
  }

  startDraftSession(): void {
    const state = store.getState();
    const selectedModel = state.model.selectedModel;
    const modelRef = selectedModel ? toOpenClawModelRef(selectedModel) : null;
    const sessionKey = this.createDraftSessionKey();
    store.dispatch(enterOpenClawDraft({
      sessionKey,
      modelRef,
    }));
    this.writeProjection(createInitialProjectionState(sessionKey));
  }

  updateDraftModel(modelRef: string | null): void {
    store.dispatch(setOpenClawDraftModelRef(modelRef));
  }

  async sendDraftMessage(input: {
    message: string;
    attachments?: OpenClawSessionSendInput['attachments'];
  }): Promise<boolean> {
    const state = store.getState().openclawSession;
    const draftSessionKey = state.draftSessionKey?.trim();
    if (!draftSessionKey) {
      return false;
    }

    const draftModelRef = state.draftModelRef?.trim() ?? '';
    if (draftModelRef) {
      const patched = await this.patchSession({
        sessionKey: draftSessionKey,
        model: draftModelRef,
      });
      if (!patched) {
        return false;
      }
    }

    const sent = await this.sendMessage({
      sessionKey: draftSessionKey,
      message: input.message,
      attachments: input.attachments,
    });
    if (!sent) {
      return false;
    }

    store.dispatch(exitOpenClawDraft());
    store.dispatch(setOpenClawCurrentSessionKey(draftSessionKey));
    this.syncSendingFlag();
    return true;
  }

  async abortMessage(sessionKey: string): Promise<boolean> {
    this.ensureInitialized();
    const api = window.electron?.openclawSessions;
    if (!api || !sessionKey) return false;

    this.updateProjectionForEvent(sessionKey, (projection) => ({
      ...projection,
      phase: OpenClawSessionRunPhaseValue.Aborting,
    }));

    const result = await api.abort(sessionKey);
    if (!result.success) {
      this.updateProjectionForEvent(sessionKey, (projection) => ({
        ...projection,
        phase: OpenClawSessionRunPhaseValue.Idle,
      }));
      showToast(result.error || i18nService.t('openclawSessionAbortFailed'));
      return false;
    }

    await this.fetchList(false);
    return true;
  }

  async deleteSession(sessionKey: string): Promise<boolean> {
    const api = window.electron?.openclawSessions;
    if (!api || !sessionKey) return false;
    const state = store.getState().openclawSession;
    const item = state.items.find((entry) => entry.sessionKey === sessionKey);
    if (item && item.canDelete === false) {
      showToast(i18nService.t('openclawSessionDeleteMainForbidden'));
      return false;
    }

    const result = await api.delete(sessionKey);
    if (!result.success) {
      const errorMessage = typeof result.error === 'string' && result.error.trim()
        ? result.error
        : i18nService.t('openclawSessionDeleteFailed');
      showToast(errorMessage);
      return false;
    }

    store.dispatch(removeOpenClawSessionItem(sessionKey));
    this.syncSendingFlag();
    return true;
  }

  async patchSession(input: OpenClawSessionPatchInput): Promise<boolean> {
    const api = window.electron?.openclawSessions;
    if (!api) return false;

    const result = await api.patch(input);
    if (!result.success) {
      return false;
    }

    const updates: Partial<OpenClawSessionListItem> = {};
    if (input.label !== undefined && input.label !== null) {
      updates.title = input.label;
    }
    if (input.pinned !== undefined) {
      updates.pinned = input.pinned;
    }
    if (input.model !== undefined) {
      const [provider, model] = (input.model ?? '').split('/', 2);
      updates.modelProvider = provider || null;
      updates.model = model || null;
    }

    store.dispatch(updateOpenClawSessionItem({
      sessionKey: input.sessionKey,
      updates,
    }));
    return true;
  }

  getCurrentProjectedHistory(): OpenClawHistoryResult | null {
    const state = store.getState().openclawSession;
    const sessionKey = state.currentSessionKey;
    if (!sessionKey) {
      return null;
    }

    const projection = state.projectionBySessionKey[sessionKey];
    if (!projection) {
      return state.currentHistory;
    }

    return {
      sessionKey,
      messages: projection.messages,
      raw: projection.history?.raw ?? {},
    };
  }

  getCurrentRunPhase(): OpenClawSessionRunPhase {
    const state = store.getState().openclawSession;
    const sessionKey = state.currentSessionKey;
    if (!sessionKey) {
      return OpenClawSessionRunPhaseValue.Idle;
    }
    return state.projectionBySessionKey[sessionKey]?.phase ?? OpenClawSessionRunPhaseValue.Idle;
  }

  hasPendingAssistantOutput(sessionKey: string | null): boolean {
    if (!sessionKey) {
      return false;
    }

    const projection = store.getState().openclawSession.projectionBySessionKey[sessionKey];
    if (!projection) {
      return false;
    }

    if (projection.phase === OpenClawSessionRunPhaseValue.Idle) {
      return false;
    }

    return !hasAssistantOutputAfterLastUser(projection.messages);
  }
}

export const openclawSessionService = new OpenClawSessionService();
