import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type {
  OpenClawHistoryResult,
  OpenClawSessionDriftState,
  OpenClawSessionFinishState,
  OpenClawSessionListItem,
  OpenClawSessionProjectionState,
  OpenClawSessionReadState,
} from '../../types/openclawSession';

interface OpenClawSessionState {
  items: OpenClawSessionListItem[];
  currentSessionKey: string | null;
  currentHistory: OpenClawHistoryResult | null;
  projectionBySessionKey: Record<string, OpenClawSessionProjectionState>;
  driftStateBySessionKey: Record<string, OpenClawSessionDriftState>;
  readStateBySessionKey: Record<string, OpenClawSessionReadState>;
  finishStateBySessionKey: Record<string, OpenClawSessionFinishState>;
  unreadSessionKeys: string[];
  draftSessionKey: string | null;
  draftModelRef: string | null;
  loadingList: boolean;
  loadingHistory: boolean;
  sending: boolean;
}

const initialState: OpenClawSessionState = {
  items: [],
  currentSessionKey: null,
  currentHistory: null,
  projectionBySessionKey: {},
  driftStateBySessionKey: {},
  readStateBySessionKey: {},
  finishStateBySessionKey: {},
  unreadSessionKeys: [],
  draftSessionKey: null,
  draftModelRef: null,
  loadingList: false,
  loadingHistory: false,
  sending: false,
};

const openclawSessionSlice = createSlice({
  name: 'openclawSession',
  initialState,
  reducers: {
    setOpenClawSessionItems(state, action: PayloadAction<OpenClawSessionListItem[]>) {
      state.items = action.payload;
    },
    setOpenClawCurrentSessionKey(state, action: PayloadAction<string | null>) {
      state.currentSessionKey = action.payload;
    },
    setOpenClawCurrentHistory(state, action: PayloadAction<OpenClawHistoryResult | null>) {
      state.currentHistory = action.payload;
    },
    replaceOpenClawSessionProjection(
      state,
      action: PayloadAction<OpenClawSessionProjectionState>,
    ) {
      state.projectionBySessionKey[action.payload.sessionKey] = action.payload;
      if (state.currentSessionKey === action.payload.sessionKey) {
        state.currentHistory = action.payload.history;
      }
    },
    recordOpenClawSessionDrift(
      state,
      action: PayloadAction<{ sessionKey: string; drift: OpenClawSessionDriftState }>,
    ) {
      state.driftStateBySessionKey[action.payload.sessionKey] = action.payload.drift;
    },
    markOpenClawSessionRead(
      state,
      action: PayloadAction<{ sessionKey: string; readAt?: number | null; fingerprint?: string | null }>,
    ) {
      state.readStateBySessionKey[action.payload.sessionKey] = {
        lastReadAt: action.payload.readAt ?? Date.now(),
        lastSeenMessageFingerprint: action.payload.fingerprint ?? null,
      };
      state.unreadSessionKeys = state.unreadSessionKeys.filter(
        (sessionKey) => sessionKey !== action.payload.sessionKey,
      );
    },
    markOpenClawSessionUnread(state, action: PayloadAction<string>) {
      if (state.unreadSessionKeys.includes(action.payload)) {
        return;
      }
      state.unreadSessionKeys.push(action.payload);
    },
    recordOpenClawSessionFinished(
      state,
      action: PayloadAction<{ sessionKey: string; finishedAt?: number | null }>,
    ) {
      state.finishStateBySessionKey[action.payload.sessionKey] = {
        finishedAt: action.payload.finishedAt ?? Date.now(),
      };
    },
    clearOpenClawSessionFinished(state, action: PayloadAction<string>) {
      delete state.finishStateBySessionKey[action.payload];
    },
    enterOpenClawDraft(
      state,
      action: PayloadAction<{ sessionKey: string; modelRef: string | null }>,
    ) {
      state.draftSessionKey = action.payload.sessionKey;
      state.draftModelRef = action.payload.modelRef;
      state.currentSessionKey = action.payload.sessionKey;
      state.currentHistory = null;
    },
    exitOpenClawDraft(state) {
      state.draftSessionKey = null;
      state.draftModelRef = null;
    },
    setOpenClawDraftModelRef(state, action: PayloadAction<string | null>) {
      state.draftModelRef = action.payload;
    },
    setOpenClawLoadingList(state, action: PayloadAction<boolean>) {
      state.loadingList = action.payload;
    },
    setOpenClawLoadingHistory(state, action: PayloadAction<boolean>) {
      state.loadingHistory = action.payload;
    },
    setOpenClawSending(state, action: PayloadAction<boolean>) {
      state.sending = action.payload;
    },
    resetOpenClawSessionView(state) {
      state.currentSessionKey = null;
      state.currentHistory = null;
      state.draftSessionKey = null;
      state.draftModelRef = null;
      state.sending = false;
    },
    removeOpenClawSessionItem(state, action: PayloadAction<string>) {
      state.items = state.items.filter((item) => item.sessionKey !== action.payload);
      delete state.projectionBySessionKey[action.payload];
      delete state.driftStateBySessionKey[action.payload];
      delete state.readStateBySessionKey[action.payload];
      delete state.finishStateBySessionKey[action.payload];
      state.unreadSessionKeys = state.unreadSessionKeys.filter((sessionKey) => sessionKey !== action.payload);
      if (state.currentSessionKey === action.payload) {
        state.currentSessionKey = null;
        state.currentHistory = null;
      }
    },
    updateOpenClawSessionItem(
      state,
      action: PayloadAction<{ sessionKey: string; updates: Partial<OpenClawSessionListItem> }>,
    ) {
      const item = state.items.find((entry) => entry.sessionKey === action.payload.sessionKey);
      if (!item) return;
      Object.assign(item, action.payload.updates);
    },
  },
});

export const {
  setOpenClawSessionItems,
  setOpenClawCurrentSessionKey,
  setOpenClawCurrentHistory,
  replaceOpenClawSessionProjection,
  recordOpenClawSessionDrift,
  markOpenClawSessionRead,
  markOpenClawSessionUnread,
  recordOpenClawSessionFinished,
  clearOpenClawSessionFinished,
  enterOpenClawDraft,
  exitOpenClawDraft,
  setOpenClawDraftModelRef,
  setOpenClawLoadingList,
  setOpenClawLoadingHistory,
  setOpenClawSending,
  resetOpenClawSessionView,
  removeOpenClawSessionItem,
  updateOpenClawSessionItem,
} = openclawSessionSlice.actions;

export default openclawSessionSlice.reducer;
