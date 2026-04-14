import { PlatformRegistry } from '@shared/platform';

export const OpenClawBuiltinChannel = {
  Webchat: 'webchat',
} as const;

export type OpenClawBuiltinChannel =
  typeof OpenClawBuiltinChannel[keyof typeof OpenClawBuiltinChannel];

type OpenClawBuiltinChannelVisual = {
  src: string;
  label: string;
};

const BUILTIN_CHANNEL_VISUALS: Record<OpenClawBuiltinChannel, OpenClawBuiltinChannelVisual> = {
  [OpenClawBuiltinChannel.Webchat]: {
    src: '/logo.png',
    label: 'Webchat',
  },
};

export interface OpenClawChannelVisual {
  kind: 'icon' | 'text' | 'hidden';
  label: string;
  src?: string;
}

export const getOpenClawBuiltinChannelVisual = (
  channel: OpenClawBuiltinChannel,
): OpenClawChannelVisual => {
  const builtinVisual = BUILTIN_CHANNEL_VISUALS[channel];
  return {
    kind: 'icon',
    label: builtinVisual.label,
    src: builtinVisual.src,
  };
};

export const resolveOpenClawChannelVisual = (channel: string | null | undefined): OpenClawChannelVisual | null => {
  const normalizedChannel = channel?.trim().toLowerCase() ?? '';
  if (!normalizedChannel) {
    return null;
  }

  const platform = PlatformRegistry.platformOfChannel(normalizedChannel);
  if (platform) {
    return {
      kind: 'icon',
      label: PlatformRegistry.get(platform).label,
      src: `/${PlatformRegistry.logo(platform)}`,
    };
  }

  const builtinVisual = BUILTIN_CHANNEL_VISUALS[normalizedChannel as OpenClawBuiltinChannel];
  if (builtinVisual) {
    return getOpenClawBuiltinChannelVisual(normalizedChannel as OpenClawBuiltinChannel);
  }

  return {
    kind: 'text',
    label: normalizedChannel,
  };
};
