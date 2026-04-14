import { createSelector } from '@reduxjs/toolkit';

import type { RootState } from '../index';
import type { OpenClawSessionListItem } from '../../types/openclawSession';

export const selectOpenClawSessionItems = (state: RootState) => state.openclawSession.items;
export const selectOpenClawCurrentSessionKey = (state: RootState) => state.openclawSession.currentSessionKey;
export const selectCurrentAgentId = (state: RootState) => state.agent.currentAgentId;

export type OpenClawVisibleSessionItem = {
  item: OpenClawSessionListItem;
  derivedAgentId: string;
  bindingState: OpenClawSessionListItem['bindingState'];
};

export const deriveAgentIdFromSessionKey = (sessionKey: string | null | undefined): string => {
  const normalizedSessionKey = typeof sessionKey === 'string' ? sessionKey.trim() : '';
  if (!normalizedSessionKey.startsWith('agent:')) {
    return 'main';
  }
  const parts = normalizedSessionKey.split(':');
  const agentId = parts[1]?.trim();
  return agentId || 'main';
};

export const selectVisibleOpenClawSessionEntries = createSelector(
  [selectOpenClawSessionItems, selectCurrentAgentId],
  (items, currentAgentId): OpenClawVisibleSessionItem[] => {
    return items
      .map((item) => ({
        item,
        derivedAgentId: deriveAgentIdFromSessionKey(item.sessionKey),
        bindingState: item.bindingState ?? 'unknown',
      }))
      .filter((entry) => {
        return entry.derivedAgentId === currentAgentId
          && entry.bindingState !== 'stale';
      });
  },
);

export const selectVisibleOpenClawItems = createSelector(
  [selectVisibleOpenClawSessionEntries],
  (entries) => entries.map((entry) => entry.item),
);

export const selectVisibleCurrentOpenClawItem = createSelector(
  [selectVisibleOpenClawItems, selectOpenClawCurrentSessionKey],
  (items, currentSessionKey) => {
    if (!currentSessionKey) {
      return null;
    }
    return items.find((item) => item.sessionKey === currentSessionKey) ?? null;
  },
);
