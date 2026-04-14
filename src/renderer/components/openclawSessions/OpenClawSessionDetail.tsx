import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid';
import { FolderIcon, InformationCircleIcon } from '@heroicons/react/24/solid';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { getScheduledReminderDisplayText } from '../../../scheduledTask/reminderText';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type {
  OpenClawChatAttachmentInput,
  OpenClawHistoryResult,
  OpenClawSessionListItem,
} from '../../types/openclawSession';
import type { Skill } from '../../types/skill';
import { getCompactFolderName } from '../../utils/path';
import ComposeIcon from '../icons/ComposeIcon';
import PuzzleIcon from '../icons/PuzzleIcon';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import MarkdownContent from '../MarkdownContent';
import WindowTitleBar from '../window/WindowTitleBar';
import OpenClawLazyRenderTurn from './OpenClawLazyRenderTurn';
import OpenClawSessionInput from './OpenClawSessionInput';
import OpenClawSessionToolbar from './OpenClawSessionToolbar';

const NAV_SCROLL_LOCK_DURATION = 800;
const NAV_BOTTOM_SNAP_THRESHOLD = 20;

interface OpenClawSessionDetailProps {
  item: OpenClawSessionListItem | null;
  history: OpenClawHistoryResult | null;
  loading: boolean;
  draft?: boolean;
  draftSessionKey?: string | null;
  draftModelRef?: string | null;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  sending?: boolean;
  onSend?: (input: {
    message: string;
    attachments?: OpenClawChatAttachmentInput[];
  }) => Promise<boolean | void>;
  onAbort?: () => Promise<boolean | void>;
  onRename: (title: string) => Promise<void>;
  onTogglePinned: () => Promise<void>;
  onSaveModel: (model: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

type OpenClawRole = 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result' | 'unknown';

type OpenClawTextItem = {
  kind: 'text';
  id: string;
  role: OpenClawRole;
  text: string;
  skillIds?: string[];
};

type OpenClawThinkingItem = {
  kind: 'thinking';
  id: string;
  text: string;
};

type OpenClawToolCallItem = {
  kind: 'tool_call';
  id: string;
  toolName: string;
  argumentsText: string;
  extraText: string;
};

type OpenClawUnknownItem = {
  kind: 'unknown';
  id: string;
  label: string;
  content: string;
};

type OpenClawRenderItem =
  | OpenClawTextItem
  | OpenClawThinkingItem
  | OpenClawToolCallItem
  | OpenClawUnknownItem;

type OpenClawConversationTurn = {
  id: string;
  userMessage: OpenClawTextItem | null;
  assistantItems: OpenClawRenderItem[];
};

type OpenClawRailItem = {
  key: string;
  turnIndex: number;
  label: string;
  contentLen: number;
  isUser: boolean;
  railIndex: number;
};

type OpenClawContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_call'; toolName: string; argumentsText: string; extraText: string }
  | { kind: 'unknown'; label: string; content: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const safeTrim = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const extractSkillIds = (message: unknown): string[] => {
  if (!isRecord(message) || !isRecord(message.lobsterMessageMeta) || !Array.isArray(message.lobsterMessageMeta.skillIds)) {
    return [];
  }
  return message.lobsterMessageMeta.skillIds
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
};

const stringifyStructured = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const extractRole = (message: unknown): OpenClawRole => {
  if (!isRecord(message)) return 'unknown';
  const role = safeTrim(message.role).toLowerCase();
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role;
  }
  if (role === 'tooluse' || role === 'tool_use') {
    return 'tool_use';
  }
  if (role === 'toolresult' || role === 'tool_result') {
    return 'tool_result';
  }
  return 'unknown';
};

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

const sanitizeUserFacingText = (text: string): string => {
  if (!text) return '';

  const decodedEscapes = text.includes('\\n') ? text.replace(/\\n/g, '\n') : text;
  return stripUntrustedContext(stripSkillInstructions(stripFinalTags(decodedEscapes))).trim();
};

const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;

const summarizeUrls = (text: string): string => {
  const matches = text.match(URL_RE) ?? [];
  if (matches.length === 0) {
    return text;
  }

  let nextText = text.replace(URL_RE, '[link]');
  nextText = nextText
    .split('\n')
    .filter((line) => line.trim() !== '[link]')
    .join('\n')
    .trim();

  const summary = matches.length === 1
    ? '[1 link hidden]'
    : `[${matches.length} links hidden]`;

  if (!nextText) {
    return summary;
  }

  return `${nextText}\n${summary}`.trim();
};

const sanitizeToolDisplayText = (text: string): string => {
  return summarizeUrls(sanitizeUserFacingText(text));
};

const collectTextBlocks = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const text = sanitizeToolDisplayText(value);
    return text ? [text] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextBlocks(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  const texts: string[] = [];
  if (hasText(value.text)) {
    texts.push(value.text.trim());
  }
  if (value.content !== undefined) {
    texts.push(...collectTextBlocks(value.content));
  }
  if (value.parts !== undefined) {
    texts.push(...collectTextBlocks(value.parts));
  }

  return texts;
};

const extractTextContent = (message: unknown): string => {
  if (!isRecord(message)) {
    return stringifyStructured(message);
  }

  const content = message.content;
  if (typeof content === 'string') {
    return sanitizeUserFacingText(content);
  }
  if (content !== undefined) {
    const textBlocks = collectTextBlocks(content);
    if (textBlocks.length > 0) {
      return textBlocks.join('\n');
    }
  }
  if (hasText(message.text)) {
    return sanitizeUserFacingText(message.text);
  }
  return '';
};

const normalizeToolName = (toolName: string): string => {
  const trimmed = toolName.trim();
  return trimmed || 'Tool';
};

const shouldHideToolDetails = (toolName: string): boolean => {
  return toolName.trim().toLowerCase() === 'web_fetch';
};

const extractWebFetchPreview = (value: unknown): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return extractWebFetchPreview(JSON.parse(trimmed));
      } catch {
        const matched = trimmed.match(URL_RE);
        return matched?.[0] ?? '';
      }
    }

    const matched = trimmed.match(URL_RE);
    return matched?.[0] ?? '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const preview = extractWebFetchPreview(item);
      if (preview) {
        return preview;
      }
    }
    return '';
  }

  if (!isRecord(value)) {
    return '';
  }

  if (hasText(value.url)) {
    return safeTrim(value.url);
  }
  if (hasText(value.finalUrl)) {
    return safeTrim(value.finalUrl);
  }
  if (value.arguments !== undefined) {
    const preview = extractWebFetchPreview(value.arguments);
    if (preview) {
      return preview;
    }
  }
  if (value.input !== undefined) {
    const preview = extractWebFetchPreview(value.input);
    if (preview) {
      return preview;
    }
  }
  if (value.content !== undefined) {
    const preview = extractWebFetchPreview(value.content);
    if (preview) {
      return preview;
    }
  }
  if (value.text !== undefined) {
    const preview = extractWebFetchPreview(value.text);
    if (preview) {
      return preview;
    }
  }

  return '';
};

const extractExtraToolText = (value: unknown): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return extractExtraToolText(JSON.parse(trimmed));
      } catch {
        return sanitizeToolDisplayText(trimmed);
      }
    }

    return sanitizeToolDisplayText(trimmed);
  }
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => extractExtraToolText(item))
      .filter(Boolean)
      .join('\n');
  }
  if (!isRecord(value)) {
    return '';
  }

  if (hasText(value.text)) {
    return sanitizeToolDisplayText(value.text.trim());
  }
  if (hasText(value.message)) {
    return sanitizeToolDisplayText(String(value.message).trim());
  }
  if (value.content !== undefined) {
    const nested = extractExtraToolText(value.content);
    if (nested) {
      return nested;
    }
  }
  if (value.result !== undefined) {
    const nested = extractExtraToolText(value.result);
    if (nested) {
      return nested;
    }
  }
  if (value.partialResult !== undefined) {
    const nested = extractExtraToolText(value.partialResult);
    if (nested) {
      return nested;
    }
  }

  const textChunks = collectTextBlocks(value);
  if (textChunks.length > 0) {
    return textChunks.join('\n');
  }

  return '';
};

const normalizeContentBlock = (block: unknown): OpenClawContentBlock[] => {
  if (typeof block === 'string') {
    const text = block.trim();
    return text ? [{ kind: 'text', text }] : [];
  }

  if (Array.isArray(block)) {
    return block.flatMap((item) => normalizeContentBlock(item));
  }

  if (!isRecord(block)) {
    const content = stringifyStructured(block).trim();
    return content ? [{ kind: 'unknown', label: 'unknown', content }] : [];
  }

  const type = safeTrim(block.type);
  if (type === 'text' || type === 'output_text') {
    const text = sanitizeUserFacingText(safeTrim(block.text));
    return text ? [{ kind: 'text', text }] : [];
  }

  if (type === 'thinking') {
    const text = sanitizeUserFacingText(safeTrim(block.thinking) || safeTrim(block.text));
    return text ? [{ kind: 'thinking', text }] : [];
  }

  if (type === 'toolCall') {
    const toolName = normalizeToolName(safeTrim(block.name) || safeTrim(block.toolName));
    const hideDetails = shouldHideToolDetails(toolName);
    const argumentsText = hideDetails
      ? extractWebFetchPreview(block.arguments)
      : block.arguments !== undefined
        ? summarizeUrls(stringifyStructured(block.arguments))
        : '';
    const extraText = hideDetails ? '' : extractExtraToolText(block.extra_content);
    return [{
      kind: 'tool_call',
      toolName,
      argumentsText,
      extraText,
    }];
  }

  if (type) {
    const content = stringifyStructured(block).trim();
    return content ? [{ kind: 'unknown', label: type, content }] : [];
  }

  const textChunks = collectTextBlocks(block);
  if (textChunks.length > 0) {
    return textChunks.map<OpenClawContentBlock>((text) => ({ kind: 'text', text }));
  }

  const content = stringifyStructured(block).trim();
  return content ? [{ kind: 'unknown', label: 'object', content }] : [];
};

const normalizeMessageContent = (message: unknown, index: number): OpenClawRenderItem[] => {
  if (!isRecord(message)) {
    return [{
      kind: 'unknown',
      id: `msg-${index}-unknown`,
      label: 'message',
      content: stringifyStructured(message),
    }];
  }

  const role = extractRole(message);
  if (role === 'tool_use' || role === 'tool_result') {
    const toolName = normalizeToolName(safeTrim(message.toolName) || safeTrim(message.name));
    const hideDetails = shouldHideToolDetails(toolName);
    const argumentsText = hideDetails
      ? extractWebFetchPreview(message.arguments ?? message.input ?? message.content)
      : message.arguments !== undefined
        ? summarizeUrls(stringifyStructured(message.arguments))
        : message.input !== undefined
          ? summarizeUrls(stringifyStructured(message.input))
          : '';
    const extraText = hideDetails ? '' : extractExtraToolText(message.content);

    return [{
      kind: 'tool_call',
      id: `msg-${index}-tool-${role}`,
      toolName,
      argumentsText,
      extraText,
    }];
  }

  const content = message.content;
  const blocks: OpenClawContentBlock[] = content !== undefined
    ? normalizeContentBlock(content)
    : hasText(message.text)
      ? [{ kind: 'text', text: message.text }]
      : [];

  if (blocks.length === 0) {
    const fallbackText = extractTextContent(message).trim();
    if (fallbackText) {
      return [{
        kind: 'text',
        id: `msg-${index}-text-fallback`,
        role,
        text: fallbackText,
      }];
    }

    return [{
      kind: 'unknown',
      id: `msg-${index}-unknown-fallback`,
      label: role || 'message',
      content: stringifyStructured(message),
    }];
  }

  return blocks.map<OpenClawRenderItem>((block, blockIndex) => {
    const id = `msg-${index}-block-${blockIndex}`;
    switch (block.kind) {
      case 'text':
        return { kind: 'text', id, role, text: block.text };
      case 'thinking':
        return { kind: 'thinking', id, text: block.text };
      case 'tool_call':
        return {
          kind: 'tool_call',
          id,
          toolName: block.toolName,
          argumentsText: block.argumentsText,
          extraText: block.extraText,
        };
      case 'unknown':
      default:
        return {
          kind: 'unknown',
          id,
          label: block.label,
          content: block.content,
        };
    }
  });
};

const buildConversationTurns = (messages: unknown[]): OpenClawConversationTurn[] => {
  const turns: OpenClawConversationTurn[] = [];
  let currentTurn: OpenClawConversationTurn | null = null;
  let orphanIndex = 0;

  const ensureTurn = (index: number): OpenClawConversationTurn => {
    if (currentTurn) return currentTurn;
    currentTurn = {
      id: `orphan-${index}-${orphanIndex++}`,
      userMessage: null,
      assistantItems: [],
    };
    turns.push(currentTurn);
    return currentTurn;
  };

  messages.forEach((message, index) => {
    const role = extractRole(message);
    const normalizedItems = normalizeMessageContent(message, index);
    const textItems = normalizedItems.filter((entry): entry is OpenClawTextItem => entry.kind === 'text');

    if (role === 'user') {
      const userText = textItems.map((entry) => entry.text).filter(Boolean).join('\n\n').trim();
      currentTurn = {
        id: `turn-${index}`,
        userMessage: userText
          ? {
            kind: 'text',
            id: `turn-${index}-user`,
            role: 'user',
            text: userText,
            skillIds: extractSkillIds(message),
          }
          : null,
        assistantItems: [],
      };
      turns.push(currentTurn);
      return;
    }

    const turn = ensureTurn(index);
    if (role === 'system') {
      const systemText = textItems.map((entry) => entry.text).filter(Boolean).join('\n\n').trim();
      if (systemText) {
        turn.assistantItems.push({
          kind: 'text',
          id: `turn-${index}-system`,
          role: 'system',
          text: systemText,
        });
      }
      normalizedItems
        .filter((entry) => entry.kind !== 'text')
        .forEach((entry) => turn.assistantItems.push(entry));
      return;
    }

    normalizedItems.forEach((entry) => {
      if (entry.kind === 'text' && entry.role !== 'assistant') {
        turn.assistantItems.push({ ...entry, role: 'assistant' });
        return;
      }
      turn.assistantItems.push(entry);
    });
  });

  return turns;
};

const stripMarkdownForRailLabel = (value: string): string => {
  return value
    .replace(/^#+\s+/gm, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[*_~>]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
};

const getVisibleAssistantText = (items: OpenClawRenderItem[]): string => {
  return items
    .filter((item) => item.kind !== 'thinking')
    .map((item) => {
      if (item.kind === 'text') {
        return item.text;
      }
      if (item.kind === 'tool_call') {
        return item.toolName + (item.argumentsText ? ` ${item.argumentsText}` : '');
      }
      if (item.kind === 'unknown') {
        return item.content;
      }
      return '';
    })
    .filter(Boolean)
    .join(' ');
};

const normalizeAssistantItemsForRender = (
  items: OpenClawRenderItem[],
): Array<Exclude<OpenClawRenderItem, OpenClawThinkingItem>> => {
  const withoutThinking = items.filter(
    (item): item is Exclude<OpenClawRenderItem, OpenClawThinkingItem> => item.kind !== 'thinking',
  );
  const deduped: Array<Exclude<OpenClawRenderItem, OpenClawThinkingItem>> = [];

  withoutThinking.forEach((item) => {
    if (item.kind !== 'text') {
      deduped.push(item);
      return;
    }

    const nextText = item.text.trim();
    if (!nextText) {
      return;
    }

    const lastItem = deduped[deduped.length - 1];
    if (!lastItem || lastItem.kind !== 'text') {
      deduped.push({ ...item, text: nextText });
      return;
    }

    const previousText = lastItem.text.trim();
    if (previousText === nextText || previousText.includes(nextText)) {
      return;
    }
    if (nextText.includes(previousText)) {
      deduped[deduped.length - 1] = { ...item, text: nextText };
      return;
    }

    deduped.push({ ...item, text: nextText });
  });

  const hasToolCall = deduped.some((item) => item.kind === 'tool_call');
  if (!hasToolCall) {
    return deduped;
  }

  const toolItems = deduped.filter((item) => item.kind === 'tool_call');
  const nonToolItems = deduped.filter((item) => item.kind !== 'tool_call');
  const textItems = nonToolItems.filter((item): item is OpenClawTextItem => item.kind === 'text');
  const trailingText = textItems[textItems.length - 1] ?? null;
  const nonTextItems = nonToolItems.filter((item) => item.kind !== 'text');

  return [
    ...toolItems,
    ...nonTextItems,
    ...(trailingText ? [trailingText] : []),
  ];
};

const buildRailItems = (turns: OpenClawConversationTurn[]): OpenClawRailItem[] => {
  const items: OpenClawRailItem[] = [];

  turns.forEach((turn, turnIndex) => {
    if (turn.userMessage?.text) {
      const text = stripMarkdownForRailLabel(turn.userMessage.text);
      items.push({
        key: `${turn.id}-user`,
        turnIndex,
        label: text.slice(0, 50) || `Turn ${turnIndex + 1}`,
        contentLen: text.length || 1,
        isUser: true,
        railIndex: items.length,
      });
    }

    const assistantText = stripMarkdownForRailLabel(
      getVisibleAssistantText(normalizeAssistantItemsForRender(turn.assistantItems)),
    );
    if (assistantText) {
      items.push({
        key: `${turn.id}-assistant`,
        turnIndex,
        label: assistantText.slice(0, 50) || 'LobsterAI',
        contentLen: assistantText.length || 1,
        isUser: false,
        railIndex: items.length,
      });
    }
  });

  return items;
};

const extractWorkingDirectory = (item: OpenClawSessionListItem | null): string | null => {
  if (!item?.raw || typeof item.raw !== 'object') {
    return null;
  }

  const candidates = ['workingDirectory', 'cwd', 'workspace', 'path'];
  for (const key of candidates) {
    const value = item.raw[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return null;
};

const formatMeta = (item: OpenClawSessionListItem | null): string => {
  if (!item) return '';
  const segments = [];
  if (item.channel) segments.push(item.channel);
  if (item.modelProvider && item.model) {
    segments.push(`${item.modelProvider}/${item.model}`);
  } else {
    segments.push(i18nService.t('coworkOpenClawSessionDefaultModel'));
  }
  return segments.join(' · ');
};

const formatHeaderTime = (timestamp?: number): string => {
  if (!timestamp || Number.isNaN(timestamp)) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
};

const CopyButton: React.FC<{
  content: string;
  visible: boolean;
}> = ({ content, visible }) => {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(content);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (error) {
          console.error('[OpenClawSessionDetail] copy failed:', error);
        }
      }}
      className={`rounded-md p-1.5 transition-all duration-200 hover:bg-surface-raised ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      title={i18nService.t('copyToClipboard')}
    >
      {copied ? (
        <span className="text-xs text-green-500">OK</span>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 text-[var(--icon-secondary)]"
          aria-hidden="true"
        >
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      )}
    </button>
  );
};

const OpenClawUserMessageItem: React.FC<{ message: OpenClawTextItem }> = ({ message }) => {
  const [isHovered, setIsHovered] = useState(false);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const messageSkills = (message.skillIds ?? [])
    .map((id) => skills.find((skill) => skill.id === id))
    .filter((skill): skill is Skill => Boolean(skill));

  return (
    <div
      data-rail-role="user"
      className="px-4 py-2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="mx-auto max-w-3xl">
        <div className="pl-4 sm:pl-8 md:pl-12">
          <div className="flex flex-row-reverse items-start gap-3">
            <div className="flex min-w-0 w-full flex-col items-end">
              <div className="w-fit max-w-[42rem] rounded-2xl bg-surface px-4 py-2.5 text-foreground shadow-subtle">
                <MarkdownContent
                  content={message.text}
                  className="max-w-none whitespace-pre-wrap break-words"
                />
              </div>
              <div className="mt-1 flex items-center justify-end gap-1.5">
                {messageSkills.length > 0 && (
                  <div className="mr-1.5 flex items-center gap-1.5">
                    {messageSkills.map((skill) => (
                      <div
                        key={skill.id}
                        className="inline-flex items-center gap-0.5 rounded-md bg-primary-muted px-1.5 py-0.5"
                        title={skill.description}
                      >
                        <PuzzleIcon className="h-2.5 w-2.5 text-primary" />
                        <span className="max-w-[60px] truncate text-[10px] font-medium text-primary">
                          {skill.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <CopyButton content={message.text} visible={isHovered} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const OpenClawAssistantTextItem: React.FC<{ item: OpenClawTextItem }> = ({ item }) => {
  const [isHovered, setIsHovered] = useState(false);
  const isSystem = item.role === 'system';
  const content = getScheduledReminderDisplayText(item.text) ?? item.text;

  if (isSystem) {
    const isError = !content.trim();
    return (
      <div className="rounded-xl border border-border bg-background px-3 py-2">
        <div className="flex items-center gap-2">
          {isError ? (
            <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0 text-secondary" />
          ) : (
            <InformationCircleIcon className="h-4 w-4 flex-shrink-0 text-secondary" />
          )}
          <div className="text-xs whitespace-pre-wrap text-secondary">
            {content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="text-foreground">
        <MarkdownContent
          content={content}
          className="prose max-w-none overflow-x-hidden break-words dark:prose-invert"
        />
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <CopyButton content={content} visible={isHovered} />
      </div>
    </div>
  );
};

const OpenClawToolCallItemView: React.FC<{ item: OpenClawToolCallItem }> = ({ item }) => {
  const [expanded, setExpanded] = useState(false);
  const hideDetails = shouldHideToolDetails(item.toolName);
  const preview = hideDetails ? item.argumentsText : (item.extraText || item.argumentsText);
  const hasDetails = !hideDetails && Boolean(preview);

  return (
    <div className="relative py-1">
      <button
        type="button"
        onClick={() => {
          if (hasDetails) {
            setExpanded((current) => !current);
          }
        }}
        className="group flex w-full items-start gap-2 text-left"
      >
        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-secondary">
              {item.toolName}
            </span>
            {preview && (
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
                {preview.replace(/\s+/g, ' ')}
              </code>
            )}
          </div>
        </div>
      </button>
      {hasDetails && expanded && (
        <div className="ml-4 mt-2 space-y-2">
          {!hideDetails && item.argumentsText && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">
                {i18nService.t('coworkToolInput')}
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg bg-surface-raised px-3 py-2">
                <pre className="overflow-x-hidden whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                  {item.argumentsText}
                </pre>
              </div>
            </div>
          )}
          {!hideDetails && item.extraText && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">
                {i18nService.t('coworkToolResult')}
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg bg-surface-raised px-3 py-2">
                <pre className="overflow-x-hidden whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                  {item.extraText}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const OpenClawUnknownItemView: React.FC<{ item: OpenClawUnknownItem }> = ({ item }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-raised"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-secondary">
            {item.label}
          </div>
          <div className="truncate text-xs text-muted">
            {item.content.replace(/\s+/g, ' ')}
          </div>
        </div>
        <ChevronRightIcon
          className={`h-4 w-4 flex-shrink-0 text-secondary transition-transform duration-200 ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-3">
          <pre className="max-h-64 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground">
            {item.content}
          </pre>
        </div>
      )}
    </div>
  );
};

const OpenClawAssistantTurnBlock: React.FC<{ turn: OpenClawConversationTurn }> = ({ turn }) => {
  const visibleItems = normalizeAssistantItemsForRender(turn.assistantItems);
  if (visibleItems.length === 0) return null;

  return (
    <div data-rail-role="assistant" className="px-4 py-2">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-3 px-4 py-3">
            {visibleItems.map((entry) => {
              if (entry.kind === 'text') {
                return <OpenClawAssistantTextItem key={entry.id} item={entry} />;
              }
              if (entry.kind === 'tool_call') {
                return <OpenClawToolCallItemView key={entry.id} item={entry} />;
              }
              return <OpenClawUnknownItemView key={entry.id} item={entry} />;
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const OpenClawAssistantPendingBlock: React.FC = () => (
  <div className="px-4 py-2">
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 px-4 py-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-sm text-secondary shadow-subtle">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
            </span>
            <span>{i18nService.t('thinking')}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const OpenClawHistoryLoading: React.FC = () => (
  <div className="flex h-full items-center justify-center px-4 py-10">
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-secondary shadow-subtle">
      <svg className="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span>{i18nService.t('openclawSessionLoadingHistory')}</span>
    </div>
  </div>
);

const OpenClawEmptyConversation: React.FC<{ item: OpenClawSessionListItem }> = ({ item }) => (
  <div className="px-4 py-10">
    <div className="mx-auto max-w-3xl rounded-2xl border border-dashed border-border bg-surface px-6 py-10 text-center shadow-subtle">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-raised text-secondary">
        <svg
          className="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-foreground">
        {item.title || i18nService.t('coworkNewSession')}
      </h3>
      <p className="mt-2 text-sm leading-6 text-secondary">
        {i18nService.t('openclawSessionEmptyHint')}
      </p>
      <p className="mt-3 text-xs text-secondary/80">
        {formatMeta(item)}
      </p>
    </div>
  </div>
);

const OpenClawSessionDetail: React.FC<OpenClawSessionDetailProps> = ({
  item,
  history,
  loading,
  draft = false,
  draftSessionKey,
  draftModelRef,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  sending = false,
  onSend,
  onAbort,
  onRename,
  onTogglePinned,
  onSaveModel,
  onDelete,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const turnElsCacheRef = useRef<HTMLElement[]>([]);
  const railLinesRef = useRef<HTMLDivElement>(null);
  const isNavigatingRef = useRef(false);
  const navigatingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMac = window.electron.platform === 'darwin';
  const configuredWorkingDirectory = useSelector(
    (state: RootState) => state.cowork.config.workingDirectory || '',
  );
  const turns = useMemo(
    () => buildConversationTurns(history?.messages ?? []),
    [history?.messages],
  );
  const railItems = useMemo(() => buildRailItems(turns), [turns]);
  const [isScrollable, setIsScrollable] = useState(false);
  const [currentRailIndex, setCurrentRailIndex] = useState(-1);
  const [isRailHovered, setIsRailHovered] = useState(false);
  const [hoveredRailIndex, setHoveredRailIndex] = useState<number | null>(null);
  const [railTooltip, setRailTooltip] = useState<{
    label: string;
    top: number;
    right: number;
    isUser: boolean;
  } | null>(null);
  const showPendingAssistant = useMemo(() => {
    if (!sending || turns.length === 0) {
      return false;
    }
    const lastTurn = turns[turns.length - 1];
    return Boolean(lastTurn?.userMessage) && lastTurn.assistantItems.length === 0;
  }, [sending, turns]);
  const workingDirectory = useMemo(() => {
    if (draft) {
      return configuredWorkingDirectory || null;
    }
    return extractWorkingDirectory(item) ?? (configuredWorkingDirectory || null);
  }, [configuredWorkingDirectory, draft, item]);
  const modelRef = draft
    ? draftModelRef?.trim() || i18nService.t('coworkOpenClawSessionDefaultModel')
    : item?.modelProvider && item?.model
      ? `${item.modelProvider}/${item.model}`
      : i18nService.t('coworkOpenClawSessionDefaultModel');
  const headerTime = useMemo(() => formatHeaderTime(item?.updatedAt), [item?.updatedAt]);
  const displayTitle = draft
    ? i18nService.t('coworkNewSession')
    : item?.title ?? i18nService.t('coworkTitle');

  const handleOpenWorkingDirectory = async (): Promise<void> => {
    if (!workingDirectory) {
      return;
    }

    try {
      await window.electron.shell.openPath(workingDirectory);
    } catch (error) {
      console.error('Failed to open folder:', error);
    }
  };

  useEffect(() => {
    if ((!item && !draft) || loading) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [draft, history?.messages, item, loading]);

  useEffect(() => {
    return () => {
      if (navigatingTimerRef.current) {
        clearTimeout(navigatingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setCurrentRailIndex(railItems.length > 0 ? railItems.length - 1 : -1);
    isNavigatingRef.current = false;
  }, [item?.sessionKey, railItems.length]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      turnElsCacheRef.current = [];
      return;
    }
    turnElsCacheRef.current = Array.from(container.querySelectorAll<HTMLElement>('[data-turn-index]'));
  }, [turns]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const scrollable = container.scrollHeight > container.clientHeight;
    setIsScrollable(scrollable);
  }, [history?.messages, railItems.length, loading, sending]);

  useEffect(() => {
    const container = railLinesRef.current;
    if (!container || currentRailIndex < 0) return;
    const activeEl = container.children[currentRailIndex] as HTMLElement | undefined;
    if (!activeEl) return;
    const elTop = activeEl.offsetTop;
    const elBottom = elTop + activeEl.offsetHeight;
    if (elTop < container.scrollTop) {
      container.scrollTop = elTop;
    } else if (elBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = elBottom - container.clientHeight;
    }
  }, [currentRailIndex]);

  const navigateToRailItem = (railIndex: number) => {
    if (railIndex < 0 || railIndex >= railItems.length) return;

    const target = railItems[railIndex];
    const container = scrollContainerRef.current;
    if (!container) return;

    isNavigatingRef.current = true;
    if (navigatingTimerRef.current) {
      clearTimeout(navigatingTimerRef.current);
    }
    navigatingTimerRef.current = setTimeout(() => {
      isNavigatingRef.current = false;
    }, NAV_SCROLL_LOCK_DURATION);

    const exactEl = container.querySelector<HTMLElement>(`[data-rail-index="${railIndex}"]`);
    if (exactEl) {
      exactEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      const turnEl = turnElsCacheRef.current[target.turnIndex];
      if (turnEl) {
        turnEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    setCurrentRailIndex(railIndex);
  };

  const handleMessagesScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollable = container.scrollHeight > container.clientHeight;
    setIsScrollable((prev) => (prev === scrollable ? prev : scrollable));
    if (!scrollable || railItems.length === 0 || isNavigatingRef.current) {
      return;
    }

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceToBottom <= NAV_BOTTOM_SNAP_THRESHOLD) {
      const lastIndex = railItems.length - 1;
      setCurrentRailIndex((prev) => (prev === lastIndex ? prev : lastIndex));
      return;
    }

    const scrollTop = container.scrollTop;
    let resolvedIndex = 0;
    for (let index = 0; index < railItems.length; index += 1) {
      const el = container.querySelector<HTMLElement>(`[data-rail-index="${index}"]`);
      if (!el) continue;
      if (el.offsetTop <= scrollTop + 80) {
        resolvedIndex = index;
      } else {
        break;
      }
    }

    setCurrentRailIndex((prev) => (prev === resolvedIndex ? prev : resolvedIndex));
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="draggable flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <button
                type="button"
                onClick={onToggleSidebar}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised"
              >
                <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
              </button>
              <button
                type="button"
                onClick={onNewChat}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised"
              >
                <ComposeIcon className="h-4 w-4" />
              </button>
              {updateBadge}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium leading-none text-foreground">
              {displayTitle}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              {!draft && item?.channel && (
                <span className="max-w-[160px] truncate rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-secondary">
                  {item.channel}
                </span>
              )}
              {(item || draft) && (
                <span className="max-w-[220px] truncate text-xs text-secondary">
                  {modelRef}
                </span>
              )}
              {!draft && headerTime && (
                <span className="shrink-0 text-[11px] text-muted">
                  {headerTime}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="non-draggable flex items-center gap-2">
          {workingDirectory && (
            <button
              type="button"
              onClick={() => {
                void handleOpenWorkingDirectory();
              }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
              aria-label={i18nService.t('coworkOpenFolder')}
              title={workingDirectory}
            >
              <FolderIcon className="h-4 w-4" />
              <span className="max-w-[140px] truncate">
                {getCompactFolderName(workingDirectory, 28)}
              </span>
            </button>
          )}
          {!draft && item && (
            <OpenClawSessionToolbar
              item={item}
              onRename={onRename}
              onTogglePinned={onTogglePinned}
              onSaveModel={onSaveModel}
              onDelete={onDelete}
            />
          )}
          <WindowTitleBar inline className="ml-1" />
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {!draft && !item && (
          <div className="px-4 py-10">
            <div className="mx-auto max-w-3xl rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-secondary">
              {i18nService.t('openclawSessionSelectHint')}
            </div>
          </div>
        )}

        {(item || draft) && (
          <div
            ref={scrollContainerRef}
            onScroll={handleMessagesScroll}
            className={`h-full min-h-0 overflow-y-auto bg-gradient-to-b from-background via-background to-background/95 pt-3 ${
              railItems.length > 1 && isScrollable ? 'pr-8' : ''
            }`}
          >
            {loading && <OpenClawHistoryLoading />}
            {!loading && turns.length === 0 && item && <OpenClawEmptyConversation item={item} />}
            {!loading && turns.length === 0 && draft && (
              <div className="px-4 py-10">
                <div className="mx-auto max-w-3xl rounded-2xl border border-dashed border-border bg-surface px-6 py-10 text-center shadow-subtle">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-raised text-secondary">
                    <svg
                      className="h-6 w-6"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {i18nService.t('coworkNewSession')}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-secondary">
                    {i18nService.t('openclawSessionEmptyHint')}
                  </p>
                  <p className="mt-3 text-xs text-secondary/80">
                    {modelRef}
                  </p>
                </div>
              </div>
            )}
            {!loading && turns.length > 0 && (
              <div className="py-2">
                {turns.map((turn, index) => {
                  const alwaysRender = index >= turns.length - 3;
                  const turnRailItems = railItems.filter((railItem) => railItem.turnIndex === index);
                  const userRailIndex = turnRailItems.find((railItem) => railItem.isUser)?.railIndex;
                  const assistantRailIndex = turnRailItems.find((railItem) => !railItem.isUser)?.railIndex;
                  return (
                    <OpenClawLazyRenderTurn
                      key={turn.id}
                      turnId={turn.id}
                      alwaysRender={alwaysRender}
                      data-turn-index={index}
                    >
                      {turn.userMessage && (
                        <div data-rail-index={userRailIndex}>
                          <OpenClawUserMessageItem message={turn.userMessage} />
                        </div>
                      )}
                      <div data-rail-index={assistantRailIndex}>
                        <OpenClawAssistantTurnBlock turn={turn} />
                      </div>
                    </OpenClawLazyRenderTurn>
                  );
                })}
                {showPendingAssistant && <OpenClawAssistantPendingBlock />}
                <div className="h-20" />
              </div>
            )}
          </div>
        )}

        {railItems.length > 1 && isScrollable && (
          <div
            className="absolute right-[18px] top-1/2 z-10 flex w-5 -translate-y-1/2 flex-col items-end"
            style={{ maxHeight: 'calc(100% - 40px)' }}
            onMouseEnter={() => setIsRailHovered(true)}
            onMouseLeave={() => {
              setIsRailHovered(false);
              setHoveredRailIndex(null);
              setRailTooltip(null);
            }}
          >
            <button
              type="button"
              onClick={() => {
                const resolvedRail = currentRailIndex < 0 ? railItems.length - 1 : currentRailIndex;
                if (resolvedRail <= 0) return;
                navigateToRailItem(resolvedRail - 1);
              }}
              className={`-mr-[5px] mb-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-all dark:text-neutral-400 ${
                !isRailHovered
                  ? 'pointer-events-none opacity-0'
                  : (currentRailIndex < 0 ? railItems.length - 1 : currentRailIndex) <= 0
                    ? 'cursor-default opacity-30'
                    : 'cursor-pointer hover:bg-neutral-200/60 hover:text-neutral-800 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-200'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-3.5 w-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            </button>

            <div ref={railLinesRef} className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {(() => {
                const minWidth = 6;
                const maxWidth = 16;
                const maxLen = railItems.reduce((acc, current) => Math.max(acc, current.contentLen), 1);
                const resolvedRailIndex = currentRailIndex < 0 || currentRailIndex >= railItems.length
                  ? railItems.length - 1
                  : currentRailIndex;

                return railItems.map((railItem, index) => {
                  const ratio = railItem.contentLen / maxLen;
                  const lineWidth = Math.round(minWidth + ratio * (maxWidth - minWidth));
                  const isActive = index === resolvedRailIndex;
                  const isHovered = index === hoveredRailIndex;
                  return (
                    <button
                      key={railItem.key}
                      type="button"
                      onClick={() => navigateToRailItem(index)}
                      onMouseEnter={(event) => {
                        setHoveredRailIndex(index);
                        const rect = event.currentTarget.getBoundingClientRect();
                        setRailTooltip({
                          label: railItem.label,
                          top: Math.max(12, Math.min(rect.top + rect.height / 2, window.innerHeight - 12)),
                          right: Math.max(24, window.innerWidth - rect.left + 10),
                          isUser: railItem.isUser,
                        });
                      }}
                      onMouseLeave={() => {
                        setRailTooltip(null);
                      }}
                      className="flex w-5 cursor-pointer items-center justify-end py-[5px]"
                    >
                      <div
                        className={`h-[2px] rounded-full transition-all ${
                          isActive || isHovered
                            ? 'bg-neutral-800 dark:bg-neutral-200'
                            : 'bg-neutral-300 dark:bg-neutral-600'
                        }`}
                        style={{ width: isActive || isHovered ? maxWidth : lineWidth }}
                        title={railItem.label}
                      />
                    </button>
                  );
                });
              })()}
            </div>

            <button
              type="button"
              onClick={() => {
                const maxRail = railItems.length - 1;
                const resolvedRail = currentRailIndex < 0 ? maxRail : currentRailIndex;
                if (resolvedRail >= maxRail) return;
                navigateToRailItem(resolvedRail + 1);
              }}
              className={`-mr-[5px] mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-all dark:text-neutral-400 ${
                !isRailHovered
                  ? 'pointer-events-none opacity-0'
                  : (currentRailIndex < 0 ? railItems.length - 1 : currentRailIndex) >= railItems.length - 1
                    ? 'cursor-default opacity-30'
                    : 'cursor-pointer hover:bg-neutral-200/60 hover:text-neutral-800 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-200'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-3.5 w-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          </div>
        )}

        {railTooltip && (
          <div
            className="pointer-events-none absolute z-20 -translate-y-1/2"
            style={{ top: railTooltip.top, right: railTooltip.right }}
          >
            <div className="max-w-[240px] rounded-xl border border-border bg-surface/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
              <div className="mb-1 font-medium text-foreground">
                {railTooltip.isUser ? i18nService.t('you') : 'LobsterAI'}
              </div>
              <div className="line-clamp-2 text-secondary">
                {railTooltip.label}
              </div>
            </div>
          </div>
        )}
      </div>

      {(item || draft) && (
        <OpenClawSessionInput
          sessionKey={(draft ? draftSessionKey : item?.sessionKey) ?? ''}
          modelRef={draft ? draftModelRef : item?.modelProvider && item?.model ? `${item.modelProvider}/${item.model}` : null}
          showWorkingDirectorySelector={draft}
          sending={sending}
          onSubmit={onSend}
          onStop={() => {
            void onAbort?.();
          }}
          onModelChange={async (nextModelRef) => {
            await onSaveModel(nextModelRef ?? '');
          }}
        />
      )}
    </section>
  );
};

export default OpenClawSessionDetail;
