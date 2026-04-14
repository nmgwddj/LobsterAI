import React from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import type { Model } from '../../store/slices/modelSlice';
import type { CoworkImageAttachment } from '../../types/cowork';
import type { OpenClawChatAttachmentInput } from '../../types/openclawSession';
import { resolveOpenClawModelRef, toOpenClawModelRef } from '../../utils/openclawModelRef';
import CoworkPromptInput from '../cowork/CoworkPromptInput';

interface OpenClawSessionInputProps {
  sessionKey: string;
  modelRef?: string | null;
  showModelSelector?: boolean;
  showWorkingDirectorySelector?: boolean;
  sending?: boolean;
  disabled?: boolean;
  embedded?: boolean;
  onSubmit?: (input: {
    message: string;
    attachments?: OpenClawChatAttachmentInput[];
  }) => Promise<boolean | void> | boolean | void;
  onStop?: () => void;
  onModelChange?: (modelRef: string | null) => Promise<void> | void;
}

const buildImageAttachments = (
  imageAttachments?: CoworkImageAttachment[],
): OpenClawChatAttachmentInput[] => {
  if (!Array.isArray(imageAttachments) || imageAttachments.length === 0) {
    return [];
  }

  return imageAttachments.map((attachment) => ({
    type: 'image',
    mimeType: attachment.mimeType,
    fileName: attachment.name,
    content: attachment.base64Data,
  }));
};

const MAIN_MANAGED_SESSION_RE = /^agent:main:lobsterai:/;

const shouldShowWorkingDirectorySelector = (sessionKey: string): boolean => {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) {
    return true;
  }

  return MAIN_MANAGED_SESSION_RE.test(normalizedSessionKey);
};

const OpenClawSessionInput: React.FC<OpenClawSessionInputProps> = ({
  sessionKey,
  modelRef,
  showModelSelector = true,
  showWorkingDirectorySelector,
  sending = false,
  disabled = false,
  embedded = false,
  onSubmit,
  onStop,
  onModelChange,
}) => {
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const workingDirectory = useSelector((state: RootState) => state.cowork.config.workingDirectory || '');
  const normalizedModelRef = modelRef?.trim() ?? '';
  const selectedModel = normalizedModelRef
    ? resolveOpenClawModelRef(normalizedModelRef, availableModels)
    : null;
  const hasInvalidExplicitModel = Boolean(normalizedModelRef) && !selectedModel;
  const showFolderSelector = showWorkingDirectorySelector ?? shouldShowWorkingDirectorySelector(sessionKey);

  const handleModelChange = async (nextModel: Model | null): Promise<void> => {
    if (!onModelChange) return;
    await onModelChange(nextModel ? toOpenClawModelRef(nextModel) : null);
  };

  const handleWorkingDirectoryChange = async (nextWorkingDirectory: string): Promise<void> => {
    await coworkService.updateConfig({ workingDirectory: nextWorkingDirectory });
  };

  const handleSubmit = async (
    prompt: string,
    _skillPrompt?: string,
    imageAttachments?: CoworkImageAttachment[],
  ): Promise<boolean> => {
    if (!onSubmit) {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('openclawSessionSendPending'),
      }));
      return false;
    }

    const message = prompt.trim();
    const attachments = buildImageAttachments(imageAttachments);
    if (!message.trim() && attachments.length === 0) {
      return false;
    }

    const result = await onSubmit({
      message,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    return result !== false;
  };

  const inputNode = (
    <CoworkPromptInput
      sessionId={sessionKey}
      size="large"
      isStreaming={sending}
      disabled={disabled}
      placeholder={i18nService.t('openclawSessionInputPlaceholder')}
      workingDirectory={workingDirectory}
      onWorkingDirectoryChange={handleWorkingDirectoryChange}
      showFolderSelector={showFolderSelector}
      showModelSelector={showModelSelector}
      modelSelectorValue={showModelSelector ? selectedModel : undefined}
      modelSelectorDefaultLabel={showModelSelector ? i18nService.t('coworkOpenClawSessionDefaultModel') : undefined}
      modelSelectorInvalid={showModelSelector ? hasInvalidExplicitModel : undefined}
      onModelSelectorChange={showModelSelector ? handleModelChange : undefined}
      onSubmit={handleSubmit}
      onStop={onStop}
    />
  );

  if (embedded) {
    return inputNode;
  }

  return (
    <div className="shrink-0 px-4 pb-4 pt-3">
      <div className="mx-auto max-w-3xl">
        {inputNode}
      </div>
    </div>
  );
};

export default OpenClawSessionInput;
