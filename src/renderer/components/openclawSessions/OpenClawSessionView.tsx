import React, { useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';

import { openclawSessionService } from '../../services/openclawSessionService';
import type { RootState } from '../../store';
import {
  selectVisibleCurrentOpenClawItem,
  selectVisibleOpenClawItems,
} from '../../store/selectors/openclawSessionSelectors';
import OpenClawSessionDetail from './OpenClawSessionDetail';
import OpenClawSessionSidebar from './OpenClawSessionSidebar';

const OpenClawSessionView: React.FC = () => {
  const {
    currentSessionKey,
    currentHistory,
    projectionBySessionKey,
    loadingList,
    loadingHistory,
    sending,
  } = useSelector((state: RootState) => state.openclawSession);
  const items = useSelector(selectVisibleOpenClawItems);
  const currentItem = useSelector(selectVisibleCurrentOpenClawItem);

  const currentProjectedHistory = useMemo(() => {
    if (!currentSessionKey) {
      return currentHistory;
    }
    const projection = projectionBySessionKey[currentSessionKey];
    if (!projection) {
      return currentHistory;
    }
    return {
      sessionKey: currentSessionKey,
      messages: projection.messages,
      raw: projection.history?.raw ?? currentHistory?.raw ?? {},
    };
  }, [currentHistory, currentSessionKey, projectionBySessionKey]);

  useEffect(() => {
    void openclawSessionService.loadList();
  }, []);

  useEffect(() => {
    if (!currentSessionKey) return;
    void openclawSessionService.loadHistory(currentSessionKey);
  }, [currentSessionKey]);

  return (
    <div className="flex h-full min-h-0 bg-background">
      <OpenClawSessionSidebar
        items={items}
        currentSessionKey={currentSessionKey}
        loading={loadingList}
        onSelect={(sessionKey) => {
          void openclawSessionService.loadHistory(sessionKey);
        }}
        onDelete={(sessionKey) => {
          void openclawSessionService.deleteSession(sessionKey);
        }}
        onTogglePin={(sessionKey, pinned) => {
          void openclawSessionService.patchSession({ sessionKey, pinned });
        }}
        onRename={(sessionKey, title) => {
          void openclawSessionService.patchSession({ sessionKey, label: title });
        }}
      />
      <OpenClawSessionDetail
        item={currentItem}
        history={currentProjectedHistory}
        loading={loadingHistory}
        sending={sending}
        onRename={async (title) => {
          if (!currentItem || !title.trim()) return;
          await openclawSessionService.patchSession({
            sessionKey: currentItem.sessionKey,
            label: title.trim(),
          });
        }}
        onTogglePinned={async () => {
          if (!currentItem) return;
          await openclawSessionService.patchSession({
            sessionKey: currentItem.sessionKey,
            pinned: !currentItem.pinned,
          });
        }}
        onSaveModel={async (model) => {
          if (!currentItem) return;
          await openclawSessionService.patchSession({
            sessionKey: currentItem.sessionKey,
            model: model.trim() || null,
          });
        }}
        onDelete={async () => {
          if (!currentItem) return;
          await openclawSessionService.deleteSession(currentItem.sessionKey);
        }}
      />
    </div>
  );
};

export default OpenClawSessionView;
