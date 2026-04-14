export const CoworkSessionViewMode = {
  Legacy: 'legacy',
  OpenClaw: 'openclaw',
} as const;

export type CoworkSessionViewMode =
  typeof CoworkSessionViewMode[keyof typeof CoworkSessionViewMode];
