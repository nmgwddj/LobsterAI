import { mapOpenClawSessionListItem } from '../ipcHandlers/openclawSession/helpers';
import type { OpenClawRuntimeAdapter } from './agentEngine/openclawRuntimeAdapter';

type SessionListResponse = {
  sessions?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

type ChatHistoryResponse = {
  messages?: unknown[];
  [key: string]: unknown;
};

type ChatSendResponse = {
  runId?: string;
  status?: string;
  [key: string]: unknown;
};

type ChatAttachmentInput = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content: string;
};

type ChatAbortResponse = {
  ok?: boolean;
  aborted?: boolean;
  runIds?: string[];
  [key: string]: unknown;
};

export class OpenClawSessionFacade {
  constructor(
    private readonly getOpenClawRuntimeAdapter: () => OpenClawRuntimeAdapter | null,
  ) {}

  private async getGatewayClient() {
    const adapter = this.getOpenClawRuntimeAdapter();
    if (!adapter) {
      throw new Error('OpenClaw runtime adapter is not initialized.');
    }

    await adapter.ensureReady();
    await adapter.connectGatewayIfNeeded();

    const client = adapter.getGatewayClient();
    if (!client) {
      throw new Error('OpenClaw gateway client is unavailable.');
    }

    return client;
  }

  async listSessions() {
    const client = await this.getGatewayClient();
    const adapter = this.getOpenClawRuntimeAdapter();
    const result = await client.request<SessionListResponse>('sessions.list', {
      includeGlobal: true,
      includeUnknown: true,
      includeDerivedTitles: true,
      includeLastMessage: true,
    });

    const sessions = Array.isArray(result.sessions) ? result.sessions : [];

    return {
      ...result,
      sessions: sessions.map((session) => {
        const sessionKey = typeof session.key === 'string' ? session.key.trim() : '';
        const bindingState = sessionKey && adapter
          ? adapter.getSessionBindingState(sessionKey)
          : 'unknown';
        return mapOpenClawSessionListItem(session, bindingState);
      }),
    };
  }

  async getHistory(sessionKey: string) {
    const client = await this.getGatewayClient();
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) {
      throw new Error('Session key is required.');
    }

    const result = await client.request<ChatHistoryResponse>('chat.history', {
      sessionKey: normalizedSessionKey,
    });

    return {
      sessionKey: normalizedSessionKey,
      messages: Array.isArray(result.messages) ? result.messages : [],
      raw: result,
    };
  }

  async sendMessage(input: {
    sessionKey: string;
    message: string;
    idempotencyKey: string;
    thinking?: string;
    deliver?: boolean;
    timeoutMs?: number;
    attachments?: ChatAttachmentInput[];
  }) {
    const client = await this.getGatewayClient();
    const normalizedSessionKey = input.sessionKey.trim();
    const normalizedIdempotencyKey = input.idempotencyKey.trim();
    if (!normalizedSessionKey) {
      throw new Error('Session key is required.');
    }
    if (!normalizedIdempotencyKey) {
      throw new Error('Idempotency key is required.');
    }

    return client.request<ChatSendResponse>('chat.send', {
      sessionKey: normalizedSessionKey,
      message: input.message,
      thinking: input.thinking,
      deliver: input.deliver ?? false,
      timeoutMs: input.timeoutMs,
      attachments: input.attachments,
      idempotencyKey: normalizedIdempotencyKey,
    });
  }

  async abortMessage(sessionKey: string) {
    const client = await this.getGatewayClient();
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) {
      throw new Error('Session key is required.');
    }

    return client.request<ChatAbortResponse>('chat.abort', {
      sessionKey: normalizedSessionKey,
    });
  }

  async deleteSession(sessionKey: string) {
    const client = await this.getGatewayClient();
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) {
      throw new Error('Session key is required.');
    }

    return client.request<Record<string, unknown>>('sessions.delete', {
      key: normalizedSessionKey,
    });
  }

  async patchSession(input: {
    sessionKey: string;
    label?: string | null;
    pinned?: boolean;
    model?: string | null;
  }) {
    const client = await this.getGatewayClient();
    const normalizedSessionKey = input.sessionKey.trim();
    if (!normalizedSessionKey) {
      throw new Error('Session key is required.');
    }

    const payload: Record<string, unknown> = {
      key: normalizedSessionKey,
    };
    if (input.label !== undefined) {
      payload.label = input.label;
    }
    if (input.pinned !== undefined) {
      payload.pinned = input.pinned;
    }
    if (input.model !== undefined) {
      payload.model = input.model;
    }

    return client.request<Record<string, unknown>>('sessions.patch', payload);
  }
}
