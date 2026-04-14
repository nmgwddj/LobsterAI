import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type {
  OpenClawSessionListItem,
  OpenClawSessionListVisualState,
} from '../../types/openclawSession';
import Modal from '../common/Modal';
import EllipsisHorizontalIcon from '../icons/EllipsisHorizontalIcon';
import PencilSquareIcon from '../icons/PencilSquareIcon';
import TrashIcon from '../icons/TrashIcon';
import {
  getOpenClawBuiltinChannelVisual,
  OpenClawBuiltinChannel,
  resolveOpenClawChannelVisual,
} from './constants';

interface OpenClawSessionItemProps {
  session: OpenClawSessionListItem;
  isActive: boolean;
  visualState: OpenClawSessionListVisualState;
  previewText?: string | null;
  showDriftDebug?: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: (pinned: boolean) => void;
  onRename: (title: string) => void;
}

const PushPinIcon: React.FC<React.SVGProps<SVGSVGElement> & { slashed?: boolean }> = ({
  slashed,
  ...props
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <g transform="rotate(45 12 12)">
      <path d="M9 3h6l-1 5 2 2v2H8v-2l2-2-1-5z" />
      <path d="M12 12v9" />
    </g>
    {slashed && <path d="M5 5L19 19" />}
  </svg>
);

const formatRelativeTime = (timestamp: number): { compact: string; full: string } => {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return { compact: 'now', full: i18nService.t('justNow') };
  if (minutes < 60) return { compact: `${minutes}m`, full: `${minutes} ${i18nService.t('minutesAgo')}` };
  if (hours < 24) return { compact: `${hours}h`, full: `${hours} ${i18nService.t('hoursAgo')}` };
  if (days === 1) return { compact: '1d', full: i18nService.t('yesterday') };
  return { compact: `${days}d`, full: `${days} ${i18nService.t('daysAgo')}` };
};

const OpenClawSessionItemStatusSlot: React.FC<{
  visualState: OpenClawSessionListVisualState;
}> = ({ visualState }) => {
  if (visualState === 'default') {
    return null;
  }

  if (visualState === 'unread') {
    return null;
  }

  if (visualState === 'running') {
    return (
      <span className="inline-flex items-center justify-center rounded-full bg-primary/10 p-1.5" aria-hidden="true">
        <span className="block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-primary/25 border-t-primary" />
      </span>
    );
  }

  if (visualState === 'aborting') {
    return (
      <span className="inline-flex items-center justify-center rounded-full bg-orange-500/10 p-1.5" aria-hidden="true">
        <span className="block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-orange-500/30 border-t-orange-500" />
      </span>
    );
  }

  if (visualState === 'just_finished') {
    return (
      <span className="inline-flex items-center justify-center rounded-full bg-emerald-500/10 p-1.5" aria-hidden="true">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className="h-3.5 w-3.5 text-emerald-500"
        >
          <path
            d="M5 10.5L8.2 13.5L15 6.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center justify-center rounded-full px-1.5 py-1" aria-hidden="true">
      <span className="block h-2 w-2 rounded-full bg-primary" />
    </span>
  );
};

const OpenClawSessionItem: React.FC<OpenClawSessionItemProps> = ({
  session,
  isActive,
  visualState,
  previewText,
  showDriftDebug = false,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
}) => {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const ignoreNextBlurRef = useRef(false);

  useEffect(() => {
    if (!isRenaming) {
      setRenameValue(session.title);
      ignoreNextBlurRef.current = false;
    }
  }, [isRenaming, session.title]);

  const calculateMenuPosition = (height: number) => {
    const rect = actionButtonRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const menuWidth = 180;
    const padding = 8;
    const x = Math.min(Math.max(padding, rect.right - menuWidth), window.innerWidth - menuWidth - padding);
    const y = Math.min(rect.bottom + 8, window.innerHeight - height - padding);
    return { x, y };
  };

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRenaming) return;
    if (menuPosition) {
      setMenuPosition(null);
      return;
    }
    const position = calculateMenuPosition(120);
    if (position) {
      setMenuPosition(position);
    }
  };

  useEffect(() => {
    if (!menuPosition) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !actionButtonRef.current?.contains(target)) {
        setMenuPosition(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuPosition]);

  useEffect(() => {
    if (!isRenaming) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [isRenaming]);

  const relativeTime = formatRelativeTime(session.updatedAt);
  const channelVisual = useMemo(() => {
    const resolvedChannelVisual = resolveOpenClawChannelVisual(session.channel);
    if (resolvedChannelVisual) {
      return resolvedChannelVisual;
    }
    if (!session.canDelete) {
      return getOpenClawBuiltinChannelVisual(OpenClawBuiltinChannel.Webchat);
    }
    return null;
  }, [session.canDelete, session.channel]);
  const hasPreview = Boolean(previewText && previewText.trim());
  return (
    <div
      onClick={() => {
        if (isRenaming) return;
        setMenuPosition(null);
        onSelect();
      }}
      className={`group relative cursor-pointer rounded-2xl border px-3 py-2.5 transition-all duration-150 ${
        isActive
          ? 'border-black/8 bg-black/[0.06] shadow-sm dark:border-white/10 dark:bg-white/[0.08]'
          : 'border-transparent hover:border-black/6 hover:bg-black/[0.04] dark:hover:border-white/8 dark:hover:bg-white/[0.05]'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {channelVisual?.kind === 'icon' && channelVisual.src && (
                <img
                  src={channelVisual.src}
                  alt={channelVisual.label}
                  title={channelVisual.label}
                  className="h-4 w-4 shrink-0 rounded-[4px] object-contain"
                />
              )}
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      ignoreNextBlurRef.current = true;
                      const nextTitle = renameValue.trim();
                      if (nextTitle && nextTitle !== session.title) onRename(nextTitle);
                      setIsRenaming(false);
                    }
                    if (event.key === 'Escape') {
                      ignoreNextBlurRef.current = true;
                      setRenameValue(session.title);
                      setIsRenaming(false);
                    }
                  }}
                  onBlur={() => {
                    if (ignoreNextBlurRef.current) {
                      ignoreNextBlurRef.current = false;
                      return;
                    }
                    const nextTitle = renameValue.trim();
                    if (nextTitle && nextTitle !== session.title) onRename(nextTitle);
                    setIsRenaming(false);
                  }}
                  className="min-w-0 w-full rounded-lg border border-border bg-background px-2 py-1 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              ) : (
                <h3 className={`truncate text-[15px] leading-5 text-foreground ${visualState === 'unread' ? 'font-semibold' : 'font-medium'}`}>
                  {session.title}
                </h3>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 pl-1 transition-opacity duration-150 group-hover:opacity-0">
            {showDriftDebug && (
              <span
                className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500 ring-2 ring-amber-500/15"
                title="projection drift detected"
                aria-hidden="true"
              />
            )}
            {session.pinned && (
              <PushPinIcon className="h-3.5 w-3.5 text-secondary/70" />
            )}
            <span className="text-[11px] font-medium tracking-[0.01em] text-secondary/80" title={relativeTime.full}>
              {relativeTime.compact}
            </span>
            <OpenClawSessionItemStatusSlot visualState={visualState} />
          </div>
        </div>

        <div className="mt-1 flex min-h-5 min-w-0 items-center gap-2">
            {channelVisual?.kind === 'text' && (
              <span className="max-w-[96px] shrink-0 truncate text-[10px] font-medium text-secondary/85">
                {channelVisual.label}
              </span>
            )}
            {hasPreview && (
              <div className={`min-w-0 truncate text-[13px] leading-5 ${visualState === 'unread' ? 'text-foreground/90' : 'text-secondary'}`}>
                {previewText}
              </div>
            )}
            {!hasPreview && (
            <div className="flex min-w-0 flex-1 items-center" aria-hidden="true">
              <div className="h-3 w-28 max-w-full rounded-full bg-black/[0.05] dark:bg-white/[0.08]" />
            </div>
          )}
        </div>
      </div>

      <div
        className={`absolute right-1.5 top-1.5 transition-opacity ${
          isRenaming ? 'pointer-events-none opacity-0' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'
        }`}
      >
        <button
          ref={actionButtonRef}
          onClick={openMenu}
          className="rounded-lg bg-surface-raised p-1.5 text-secondary transition-colors hover:bg-surface"
          aria-label={i18nService.t('coworkSessionActions')}
        >
          {session.pinned ? (
            <span className="relative block h-4 w-4">
              <PushPinIcon className="h-4 w-4 transition-opacity duration-150 group-hover:opacity-0" />
              <EllipsisHorizontalIcon className="absolute inset-0 h-4 w-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
            </span>
          ) : (
            <EllipsisHorizontalIcon className="h-4 w-4" />
          )}
        </button>
      </div>

      {menuPosition && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
          style={{ top: menuPosition.y, left: menuPosition.x }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsRenaming(true);
              setMenuPosition(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <PencilSquareIcon className="h-4 w-4" />
            {i18nService.t('renameConversation')}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin(!session.pinned);
              setMenuPosition(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <PushPinIcon slashed={session.pinned} className={`h-4 w-4 ${session.pinned ? 'opacity-60' : ''}`} />
            {session.pinned ? i18nService.t('coworkUnpinSession') : i18nService.t('coworkPinSession')}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (!session.canDelete) return;
              setShowConfirmDelete(true);
              setMenuPosition(null);
            }}
            disabled={!session.canDelete}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
              session.canDelete
                ? 'text-red-500 hover:bg-red-500/10'
                : 'cursor-not-allowed text-secondary/50'
            }`}
            title={!session.canDelete ? i18nService.t('openclawSessionDeleteMainForbidden') : undefined}
          >
            <TrashIcon className="h-4 w-4" />
            {i18nService.t('deleteSession')}
          </button>
        </div>
      )}

      {showConfirmDelete && session.canDelete && (
        <Modal onClose={() => setShowConfirmDelete(false)} className="w-full max-w-sm mx-4 bg-surface rounded-2xl shadow-xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="rounded-full bg-red-100 p-2 dark:bg-red-900/30">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-600 dark:text-red-500" />
            </div>
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('deleteTaskConfirmTitle')}
            </h2>
          </div>
          <div className="px-5 pb-4">
            <p className="text-sm text-secondary">
              {i18nService.t('deleteTaskConfirmMessage')}
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
            <button
              onClick={() => setShowConfirmDelete(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-raised"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              onClick={() => {
                onDelete();
                setShowConfirmDelete(false);
              }}
              className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
            >
              {i18nService.t('deleteSession')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default OpenClawSessionItem;
