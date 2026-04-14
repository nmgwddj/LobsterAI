export const OpenClawSessionIpcChannel = {
  List: 'openclaw:sessions:list',
  GetHistory: 'openclaw:sessions:getHistory',
  Send: 'openclaw:sessions:send',
  Abort: 'openclaw:sessions:abort',
  Delete: 'openclaw:sessions:delete',
  Patch: 'openclaw:sessions:patch',
  StreamEvent: 'openclaw:sessions:streamEvent',
} as const;

export type OpenClawSessionIpcChannel =
  typeof OpenClawSessionIpcChannel[keyof typeof OpenClawSessionIpcChannel];
