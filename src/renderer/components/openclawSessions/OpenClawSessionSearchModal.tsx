import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type {
  OpenClawSessionListItem,
  OpenClawSessionListVisualState,
  OpenClawSessionProjectionState,
} from '../../types/openclawSession';
import { OpenClawSessionListVisualState as OpenClawSessionListVisualStateValue } from '../../types/openclawSession';
import Modal from '../common/Modal';
import SearchIcon from '../icons/SearchIcon';
import OpenClawSessionItem from './OpenClawSessionItem';

interface OpenClawSessionSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: OpenClawSessionListItem[];
  currentSessionKey: string | null;
  onSelect: (sessionKey: string) => Promise<void> | void;
  onDelete: (sessionKey: string) => Promise<void> | void;
  onTogglePin: (sessionKey: string, pinned: boolean) => Promise<void> | void;
  onRename: (sessionKey: string, title: string) => Promise<void> | void;
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

const OpenClawSessionSearchModal: React.FC<OpenClawSessionSearchModalProps> = ({
  isOpen,
  onClose,
  items,
  currentSessionKey,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const {
    projectionBySessionKey,
    driftStateBySessionKey,
    unreadSessionKeys,
    finishStateBySessionKey,
  } = useSelector((state: RootState) => state.openclawSession);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return;
    }
    setSearchQuery('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const unreadSessionKeySet = useMemo(() => new Set(unreadSessionKeys), [unreadSessionKeys]);

  const sortedItems = useMemo(() => {
    return [...items].sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }
      return right.createdAt - left.createdAt;
    });
  }, [items]);

  const filteredItems = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    if (!trimmedQuery) {
      return sortedItems;
    }

    return sortedItems.filter((item) => {
      const projection = projectionBySessionKey[item.sessionKey];
      const previewText = getProjectionPreview(projection)
        ?? sanitizePreviewText(item.lastMessagePreview ?? '');
      const modelRef = item.modelProvider && item.model
        ? `${item.modelProvider}/${item.model}`
        : '';
      const haystacks = [
        item.title,
        previewText,
        item.channel ?? '',
        item.sessionKey,
        modelRef,
      ];

      return haystacks.some((value) => value.toLowerCase().includes(trimmedQuery));
    });
  }, [projectionBySessionKey, searchQuery, sortedItems]);

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

  const handleSelect = async (sessionKey: string) => {
    await onSelect(sessionKey);
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 flex items-start justify-center modal-backdrop p-6"
      className="modal-content mt-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-modal"
    >
      <div role="dialog" aria-modal="true" aria-label={i18nService.t('search')}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={i18nService.t('searchConversations')}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder-secondary focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-secondary transition-colors hover:bg-surface-raised"
            aria-label={i18nService.t('close')}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-3 py-3">
          {filteredItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-secondary">
              {i18nService.t('searchNoResults')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredItems.map((item) => {
                const isActive = item.sessionKey === currentSessionKey;
                const projection = projectionBySessionKey[item.sessionKey];
                const driftState = driftStateBySessionKey[item.sessionKey];
                const previewText = getProjectionPreview(projection)
                  ?? sanitizePreviewText(item.lastMessagePreview ?? '');
                const visualState = getVisualState(item.sessionKey, isActive, projection);

                return (
                  <OpenClawSessionItem
                    key={item.sessionKey}
                    session={item}
                    isActive={isActive}
                    visualState={visualState}
                    previewText={previewText}
                    showDriftDebug={import.meta.env.DEV && Boolean(driftState?.count)}
                    onSelect={() => {
                      void handleSelect(item.sessionKey);
                    }}
                    onDelete={() => {
                      void onDelete(item.sessionKey);
                    }}
                    onTogglePin={(pinned) => {
                      void onTogglePin(item.sessionKey, pinned);
                    }}
                    onRename={(title) => {
                      void onRename(item.sessionKey, title);
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default OpenClawSessionSearchModal;
