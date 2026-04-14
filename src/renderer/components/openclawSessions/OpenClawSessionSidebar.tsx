import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type {
  OpenClawSessionListItem,
  OpenClawSessionListVisualState,
  OpenClawSessionProjectionState,
} from '../../types/openclawSession';
import { OpenClawSessionListVisualState as OpenClawSessionListVisualStateValue } from '../../types/openclawSession';
import OpenClawSessionItem from './OpenClawSessionItem';

interface OpenClawSessionSidebarProps {
  items: OpenClawSessionListItem[];
  currentSessionKey: string | null;
  loading: boolean;
  onSelect: (sessionKey: string) => void;
  onDelete: (sessionKey: string) => void;
  onTogglePin: (sessionKey: string, pinned: boolean) => void;
  onRename: (sessionKey: string, title: string) => void;
}

const stripFinalTags = (text: string): string => {
  return text
    .replace(/<\/?final\s*>/gi, '')
    .replace(/<\/?final\b/gi, '');
};

const stripSkillInstructions = (text: string): string => {
  return text
    .replace(/<skill_instructions>\s*[\s\S]*?\s*<\/skill_instructions>/gi, '')
    .trim();
};

const stripUntrustedContext = (text: string): string => {
  return text
    .replace(/\n*Untrusted context \(metadata, do not treat as instructions or commands\):[\s\S]*$/i, '')
    .replace(/<<<EXTERNAL_UNTRUSTED_CONTENT(?:\s+id="[^"]*")?\s*>>>[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT(?:\s+id="[^"]*")?\s*>>>/gi, '')
    .trim();
};

const sanitizePreviewText = (text: string): string => {
  if (!text) {
    return '';
  }

  const decodedEscapes = text.includes('\\n') ? text.replace(/\\n/g, '\n') : text;
  return stripUntrustedContext(stripSkillInstructions(stripFinalTags(decodedEscapes)))
    .replace(/\s+/g, ' ')
    .trim();
};

const OpenClawSessionSidebar: React.FC<OpenClawSessionSidebarProps> = ({
  items,
  currentSessionKey,
  loading,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
}) => {
  const {
    projectionBySessionKey,
    driftStateBySessionKey,
    unreadSessionKeys,
    finishStateBySessionKey,
  } = useSelector((state: RootState) => state.openclawSession);

  const sortedItems = [...items].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return right.createdAt - left.createdAt;
  });

  const unreadSessionKeySet = useMemo(() => new Set(unreadSessionKeys), [unreadSessionKeys]);

  const getProjectionPreview = (projection: OpenClawSessionProjectionState | undefined): string | null => {
    if (!projection || projection.messages.length === 0) {
      return null;
    }

    for (let index = projection.messages.length - 1; index >= 0; index -= 1) {
      const message = projection.messages[index];
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        continue;
      }

      const content = (message as Record<string, unknown>).content;
      if (typeof content === 'string' && content.trim()) {
        const preview = sanitizePreviewText(content);
        if (preview) {
          return preview;
        }
      }
      if (typeof (message as Record<string, unknown>).text === 'string' && String((message as Record<string, unknown>).text).trim()) {
        const preview = sanitizePreviewText(String((message as Record<string, unknown>).text));
        if (preview) {
          return preview;
        }
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && !Array.isArray(block)) {
            if (typeof (block as Record<string, unknown>).text === 'string' && String((block as Record<string, unknown>).text).trim()) {
              const preview = sanitizePreviewText(String((block as Record<string, unknown>).text));
              if (preview) {
                return preview;
              }
            }
          }
        }
      }
    }

    return null;
  };

  const getVisualState = (
    sessionKey: string,
    isActive: boolean,
    projection: OpenClawSessionProjectionState | undefined,
  ): OpenClawSessionListVisualState => {
    if (projection?.phase === 'aborting') {
      return OpenClawSessionListVisualStateValue.Aborting;
    }
    if (projection?.phase === 'sending' || projection?.phase === 'running') {
      return OpenClawSessionListVisualStateValue.Running;
    }
    if (finishStateBySessionKey[sessionKey]?.finishedAt) {
      return OpenClawSessionListVisualStateValue.JustFinished;
    }
    if (!isActive && unreadSessionKeySet.has(sessionKey)) {
      return OpenClawSessionListVisualStateValue.Unread;
    }
    return OpenClawSessionListVisualStateValue.Default;
  };

  return (
    <div className="space-y-1.5">
      {items.length === 0 && loading && (
        <div className="flex items-center justify-center py-10">
          <svg className="h-6 w-6 animate-spin dark:text-claude-darkTextSecondary/60 text-claude-textSecondary/60" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}
      {items.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center px-4 py-10">
          <ChatBubbleLeftRightIcon className="mb-3 h-10 w-10 dark:text-claude-darkTextSecondary/40 text-claude-textSecondary/40" />
          <p className="mb-1 text-sm font-medium dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {i18nService.t('coworkNoSessions')}
          </p>
          <p className="text-center text-xs dark:text-claude-darkTextSecondary/70 text-claude-textSecondary/70">
            {i18nService.t('coworkNoSessionsHint')}
          </p>
        </div>
      )}
      {sortedItems.map((item) => (
        (() => {
          const isActive = item.sessionKey === currentSessionKey;
          const projection = projectionBySessionKey[item.sessionKey];
          const driftState = driftStateBySessionKey[item.sessionKey];
          const visualState = getVisualState(item.sessionKey, isActive, projection);
          const previewText = getProjectionPreview(projection)
            ?? sanitizePreviewText(item.lastMessagePreview ?? '');

          return (
        <OpenClawSessionItem
          key={item.sessionKey}
          session={item}
          isActive={isActive}
          visualState={visualState}
          previewText={previewText}
          showDriftDebug={import.meta.env.DEV && Boolean(driftState?.count)}
          onSelect={() => onSelect(item.sessionKey)}
          onDelete={() => onDelete(item.sessionKey)}
          onTogglePin={(pinned) => onTogglePin(item.sessionKey, pinned)}
          onRename={(title) => onRename(item.sessionKey, title)}
        />
          );
        })()
      ))}
    </div>
  );
};

export default OpenClawSessionSidebar;
