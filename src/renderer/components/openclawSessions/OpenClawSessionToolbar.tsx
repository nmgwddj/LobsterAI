import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { OpenClawSessionListItem } from '../../types/openclawSession';
import Modal from '../common/Modal';
import EllipsisHorizontalIcon from '../icons/EllipsisHorizontalIcon';
import PencilSquareIcon from '../icons/PencilSquareIcon';
import TrashIcon from '../icons/TrashIcon';

interface OpenClawSessionToolbarProps {
  item: OpenClawSessionListItem | null;
  onRename: (title: string) => Promise<void>;
  onTogglePinned: () => Promise<void>;
  onSaveModel: (model: string) => Promise<void>;
  onDelete: () => Promise<void>;
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

const OpenClawSessionToolbar: React.FC<OpenClawSessionToolbarProps> = ({
  item,
  onRename,
  onTogglePinned,
  onSaveModel,
  onDelete,
}) => {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [modelValue, setModelValue] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [savingRename, setSavingRename] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [savingDelete, setSavingDelete] = useState(false);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRenameValue(item?.title ?? '');
    setModelValue(item?.modelProvider && item?.model ? `${item.modelProvider}/${item.model}` : '');
  }, [item]);

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
    if (!showRenameModal) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [showRenameModal]);

  useEffect(() => {
    if (!showModelModal) return;
    requestAnimationFrame(() => {
      modelInputRef.current?.focus();
      modelInputRef.current?.select();
    });
  }, [showModelModal]);

  if (!item) return null;

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (menuPosition) {
      setMenuPosition(null);
      return;
    }

    const rect = actionButtonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const menuWidth = 190;
    const menuHeight = 180;
    const padding = 8;
    const x = Math.min(
      Math.max(padding, rect.right - menuWidth),
      window.innerWidth - menuWidth - padding,
    );
    const y = Math.min(rect.bottom + 8, window.innerHeight - menuHeight - padding);
    setMenuPosition({ x, y });
  };

  const handleRenameSave = async () => {
    const nextTitle = renameValue.trim();
    if (!nextTitle || nextTitle === item.title || savingRename) {
      setShowRenameModal(false);
      return;
    }

    setSavingRename(true);
    try {
      await onRename(nextTitle);
      setShowRenameModal(false);
    } finally {
      setSavingRename(false);
    }
  };

  const handleModelSave = async () => {
    if (savingModel) return;

    setSavingModel(true);
    try {
      await onSaveModel(modelValue.trim());
      setShowModelModal(false);
    } finally {
      setSavingModel(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (savingDelete) return;

    setSavingDelete(true);
    try {
      await onDelete();
      setShowDeleteModal(false);
    } finally {
      setSavingDelete(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          ref={actionButtonRef}
          type="button"
          onClick={openMenu}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
          aria-label={i18nService.t('coworkSessionActions')}
        >
          <EllipsisHorizontalIcon className="h-5 w-5" />
        </button>
      </div>

      {menuPosition && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[190px] overflow-hidden rounded-xl border border-border bg-surface shadow-popover"
          style={{ top: menuPosition.y, left: menuPosition.x }}
          role="menu"
        >
          <button
            type="button"
            onClick={() => {
              setMenuPosition(null);
              setShowRenameModal(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <PencilSquareIcon className="h-4 w-4 text-secondary" />
            {i18nService.t('renameConversation')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuPosition(null);
              void onTogglePinned();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <PushPinIcon slashed={item.pinned} className={`h-4 w-4 text-secondary ${item.pinned ? 'opacity-60' : ''}`} />
            {item.pinned ? i18nService.t('coworkUnpinSession') : i18nService.t('coworkPinSession')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuPosition(null);
              setShowModelModal(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <svg
              className="h-4 w-4 text-secondary"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3v18" />
              <path d="M3 12h18" />
              <path d="M6.5 6.5l11 11" />
              <path d="M17.5 6.5l-11 11" />
            </svg>
            {i18nService.t('editModel')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!item.canDelete) return;
              setMenuPosition(null);
              setShowDeleteModal(true);
            }}
            disabled={!item.canDelete}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
              item.canDelete
                ? 'text-red-500 hover:bg-red-500/10'
                : 'cursor-not-allowed text-secondary/50'
            }`}
            title={!item.canDelete ? i18nService.t('openclawSessionDeleteMainForbidden') : undefined}
          >
            <TrashIcon className="h-4 w-4" />
            {i18nService.t('deleteSession')}
          </button>
        </div>
      )}

      {showRenameModal && (
        <Modal
          onClose={() => setShowRenameModal(false)}
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
          className="w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-modal modal-content"
        >
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('renameConversation')}
            </h2>
          </div>
          <div className="px-5 py-4">
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleRenameSave();
                }
              }}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={() => setShowRenameModal(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-raised"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleRenameSave()}
              disabled={savingRename}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {i18nService.t('save')}
            </button>
          </div>
        </Modal>
      )}

      {showModelModal && (
        <Modal
          onClose={() => setShowModelModal(false)}
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
          className="w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-modal modal-content"
        >
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('editModel')}
            </h2>
          </div>
          <div className="space-y-3 px-5 py-4">
            <div className="rounded-xl border border-border bg-background px-3 py-2">
              <div className="mb-1 text-xs text-secondary">provider/model</div>
              <input
                ref={modelInputRef}
                value={modelValue}
                onChange={(event) => setModelValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleModelSave();
                  }
                }}
                placeholder="provider/model"
                className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-secondary"
              />
            </div>
            <p className="text-xs leading-5 text-secondary">
              {i18nService.t('openclawSessionModelHint')}
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={() => setShowModelModal(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-raised"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleModelSave()}
              disabled={savingModel}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {i18nService.t('save')}
            </button>
          </div>
        </Modal>
      )}

      {showDeleteModal && item.canDelete && (
        <Modal
          onClose={() => setShowDeleteModal(false)}
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
          className="mx-4 w-full max-w-sm overflow-hidden rounded-2xl bg-surface shadow-modal modal-content"
        >
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
              type="button"
              onClick={() => setShowDeleteModal(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-raised"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteConfirm()}
              disabled={savingDelete}
              className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {i18nService.t('deleteSession')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
};

export default OpenClawSessionToolbar;
