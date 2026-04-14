type SessionListRecord = Record<string, unknown>;
const MAIN_AGENT_SESSION_RE = /^agent:[^:]+:main$/;
type OpenClawSessionBindingState = 'current' | 'stale' | 'unknown';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const toNullableString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim() ? value : null;
};

const toNumber = (value: unknown): number => {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const toBoolean = (value: unknown): boolean => value === true;

const deriveTitle = (session: SessionListRecord): string => {
  return toNullableString(session.displayName)
    ?? toNullableString(session.label)
    ?? toNullableString(session.derivedTitle)
    ?? toNullableString(session.key)
    ?? 'Untitled Session';
};

const deriveChannel = (session: SessionListRecord): string | null => {
  return toNullableString(session.channel)
    ?? (isRecord(session.deliveryContext) ? toNullableString(session.deliveryContext.channel) : null)
    ?? toNullableString(session.lastChannel)
    ?? toNullableString(session.surface);
};

const deriveOrigin = (session: SessionListRecord): string | null => {
  if (toNullableString(session.origin)) {
    return toNullableString(session.origin);
  }

  if (!isRecord(session.origin)) {
    return toNullableString(session.provider)
      ?? toNullableString(session.surface)
      ?? null;
  }

  return toNullableString(session.origin.label)
    ?? toNullableString(session.origin.provider)
    ?? toNullableString(session.origin.surface)
    ?? toNullableString(session.origin.chatType)
    ?? null;
};

export const mapOpenClawSessionListItem = (
  session: SessionListRecord,
  bindingState: OpenClawSessionBindingState = 'unknown',
) => {
  const sessionKey = toNullableString(session.key) ?? '';
  const canDelete = !MAIN_AGENT_SESSION_RE.test(sessionKey);

  return {
    sessionKey,
    title: deriveTitle(session),
    canDelete,
    pinned: toBoolean(session.pinned),
    updatedAt: toNumber(session.updatedAt),
    createdAt: toNumber(session.createdAt),
    modelProvider: toNullableString(session.modelProvider),
    model: toNullableString(session.model),
    lastMessagePreview: toNullableString(session.lastMessagePreview),
    channel: deriveChannel(session),
    origin: deriveOrigin(session),
    bindingState,
    raw: session,
  };
};
