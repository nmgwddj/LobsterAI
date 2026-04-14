import { ipcMain } from 'electron';

import type { OpenClawRuntimeAdapter } from '../../libs/agentEngine/openclawRuntimeAdapter';
import { OpenClawSessionFacade } from '../../libs/openclawSessionFacade';
import { OpenClawSessionIpcChannel } from './constants';
import { registerOpenClawSessionStreamBridge } from './streamBridge';

export interface OpenClawSessionHandlerDeps {
  getOpenClawRuntimeAdapter: () => OpenClawRuntimeAdapter | null;
}

export function registerOpenClawSessionHandlers(
  deps: OpenClawSessionHandlerDeps,
): void {
  const facade = new OpenClawSessionFacade(deps.getOpenClawRuntimeAdapter);
  const ensureStreamBridge = () => {
    registerOpenClawSessionStreamBridge(deps.getOpenClawRuntimeAdapter);
  };
  ensureStreamBridge();

  ipcMain.handle(OpenClawSessionIpcChannel.List, async () => {
    try {
      ensureStreamBridge();
      const result = await facade.listSessions();
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list OpenClaw sessions',
      };
    }
  });

  ipcMain.handle(OpenClawSessionIpcChannel.GetHistory, async (_event, sessionKey: string) => {
    try {
      ensureStreamBridge();
      const result = await facade.getHistory(sessionKey);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get OpenClaw session history',
      };
    }
  });

  ipcMain.handle(
    OpenClawSessionIpcChannel.Send,
    async (
      _event,
      input: {
        sessionKey: string;
        message: string;
        idempotencyKey: string;
        thinking?: string;
        deliver?: boolean;
        timeoutMs?: number;
        attachments?: Array<{
          type?: string;
          mimeType?: string;
          fileName?: string;
          content: string;
        }>;
      },
    ) => {
      try {
        ensureStreamBridge();
        const result = await facade.sendMessage(input);
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to send OpenClaw message',
        };
      }
    },
  );

  ipcMain.handle(OpenClawSessionIpcChannel.Abort, async (_event, sessionKey: string) => {
    try {
      ensureStreamBridge();
      const result = await facade.abortMessage(sessionKey);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to abort OpenClaw session',
      };
    }
  });

  ipcMain.handle(OpenClawSessionIpcChannel.Delete, async (_event, sessionKey: string) => {
    try {
      ensureStreamBridge();
      const result = await facade.deleteSession(sessionKey);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete OpenClaw session',
      };
    }
  });

  ipcMain.handle(
    OpenClawSessionIpcChannel.Patch,
    async (
      _event,
      input: { sessionKey: string; label?: string | null; pinned?: boolean; model?: string | null },
    ) => {
      try {
        ensureStreamBridge();
        const result = await facade.patchSession(input);
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to patch OpenClaw session',
        };
      }
    },
  );
}
