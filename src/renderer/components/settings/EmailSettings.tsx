import React, { useState, useEffect } from 'react';
import type {
  EmailMultiInstanceConfig,
  EmailInstanceConfig,
  EmailMultiInstanceStatus,
} from '../../../main/im/types';
import { DEFAULT_EMAIL_INSTANCE_CONFIG, MAX_EMAIL_INSTANCES } from '../../../main/im/types';
import { isValidEmail } from '../../utils/validation';
import { i18nService } from '../../services/i18n';

const t = (key: string) => i18nService.t(key);

interface EmailSettingsProps {}

export const EmailSettings: React.FC<EmailSettingsProps> = () => {
  // State management
  const [emailConfig, setEmailConfig] = useState<EmailMultiInstanceConfig>({ instances: [] });
  const [emailStatus, setEmailStatus] = useState<EmailMultiInstanceStatus>({ instances: [] });
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [availableAgents, setAvailableAgents] = useState<Array<{ id: string; name: string }>>([
    { id: 'main', name: 'Main Agent' },
  ]);

  // Derived state
  const selectedInstance = emailConfig.instances.find(i => i.instanceId === selectedInstanceId);

  // Load configuration on mount
  useEffect(() => {
    loadConfig();
    loadAvailableAgents();
  }, []);

  // Poll status every 5 seconds
  useEffect(() => {
    loadStatus();
    const timer = setInterval(loadStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  const loadConfig = async () => {
    try {
      const result = await window.electron.im.getConfig();
      if (result.success && result.config?.email) {
        setEmailConfig(result.config.email);
        if (result.config.email.instances.length > 0 && !selectedInstanceId) {
          setSelectedInstanceId(result.config.email.instances[0].instanceId);
        }
      }
    } catch (error) {
      console.error('[EmailSettings] Failed to load config:', error);
    }
  };

  const loadStatus = async () => {
    try {
      const result = await window.electron.im.getStatus();
      if (result.success && result.status?.email) {
        setEmailStatus(result.status.email);
      }
    } catch (error) {
      console.error('[EmailSettings] Failed to load status:', error);
    }
  };

  const loadAvailableAgents = async () => {
    try {
      // TODO: Implement cowork:listAgents IPC
      // For now, hardcode main agent
      setAvailableAgents([{ id: 'main', name: 'Main Agent' }]);
    } catch (error) {
      console.error('[EmailSettings] Failed to load agents:', error);
    }
  };

  const validateConfig = (): string[] => {
    const errors: string[] = [];

    if (emailConfig.instances.length > MAX_EMAIL_INSTANCES) {
      errors.push(t('emailMaxInstancesExceeded').replace('{count}', String(MAX_EMAIL_INSTANCES)));
    }

    const seenIds = new Set<string>();
    const seenEmails = new Set<string>();

    for (const inst of emailConfig.instances) {
      if (!inst.instanceId) {
        errors.push('Instance ID is required');
      }
      if (!inst.instanceName) {
        errors.push('Instance name is required');
      }
      if (!inst.email) {
        errors.push(t('emailInvalidEmail').replace('{email}', inst.instanceName || 'unnamed'));
        continue;
      }

      if (!isValidEmail(inst.email)) {
        errors.push(t('emailInvalidEmail').replace('{email}', inst.email));
      }

      if (seenIds.has(inst.instanceId)) {
        errors.push(t('emailDuplicateInstanceId').replace('{id}', inst.instanceId));
      }
      seenIds.add(inst.instanceId);

      if (seenEmails.has(inst.email)) {
        errors.push(t('emailDuplicateEmail').replace('{email}', inst.email));
      }
      seenEmails.add(inst.email);

      if (inst.transport === 'imap' && !inst.password) {
        errors.push(t('emailMissingPassword').replace('{name}', inst.instanceName));
      }

      if (inst.transport === 'ws') {
        if (!inst.apiKey) {
          errors.push(t('emailMissingApiKey').replace('{name}', inst.instanceName));
        } else if (!inst.apiKey.startsWith('ck_')) {
          errors.push(t('emailInvalidApiKey').replace('{name}', inst.instanceName));
        }
      }
    }

    return errors;
  };

  const handleAddInstance = () => {
    const newInstanceId = `email-${Date.now()}`;
    const newInstance: EmailInstanceConfig = {
      instanceId: newInstanceId,
      instanceName: `Email ${emailConfig.instances.length + 1}`,
      enabled: true,
      transport: 'imap',
      email: '',
      agentId: 'main',
      ...DEFAULT_EMAIL_INSTANCE_CONFIG,
    };

    setEmailConfig({
      instances: [...emailConfig.instances, newInstance],
    });
    setSelectedInstanceId(newInstanceId);
  };

  const handleDeleteInstance = (instanceId: string) => {
    const instance = emailConfig.instances.find(i => i.instanceId === instanceId);
    if (!instance) return;

    const confirmed = window.confirm(
      t('emailDeleteConfirm').replace('{name}', instance.instanceName),
    );

    if (confirmed) {
      const newInstances = emailConfig.instances.filter(i => i.instanceId !== instanceId);
      setEmailConfig({ instances: newInstances });

      if (selectedInstanceId === instanceId) {
        setSelectedInstanceId(newInstances.length > 0 ? newInstances[0].instanceId : null);
      }
    }
  };

  const handleUpdateInstance = (instanceId: string, updates: Partial<EmailInstanceConfig>) => {
    setEmailConfig({
      instances: emailConfig.instances.map(inst =>
        inst.instanceId === instanceId ? { ...inst, ...updates } : inst,
      ),
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const errors = validateConfig();
      if (errors.length > 0) {
        alert(
          t('emailValidationError') + ':\n\n' + errors.map((e, i) => `${i + 1}. ${e}`).join('\n'),
        );
        return;
      }

      const result = await window.electron.im.getConfig();
      if (!result.success) {
        throw new Error(result.error);
      }

      const fullConfig = {
        ...result.config,
        email: emailConfig,
      };

      const saveResult = await window.electron.im.setConfig(fullConfig);
      if (!saveResult.success) {
        throw new Error(saveResult.error);
      }

      alert(t('emailSaveSuccess'));
      await loadConfig();
    } catch (error) {
      alert(t('emailSaveError') + ': ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  };

  const handleGetApiKey = async () => {
    if (!selectedInstance) return;

    const email = selectedInstance.email?.trim();
    if (!email || !isValidEmail(email)) {
      alert(t('emailEnterValidEmailFirst'));
      return;
    }

    const apiKeyUrl = `https://claw.163.com/projects/dashboard/#/api-keys`;

    try {
      await window.electron.shell.openExternal(apiKeyUrl);
      alert(t('emailVerifyInBrowserAndPaste'));
    } catch (error) {
      alert('Failed to open browser. Please visit: ' + apiKeyUrl);
    }  };

  const handleTestConnection = async () => {
    if (!selectedInstance) return;

    try {
      setTesting(selectedInstance.instanceId);

      // TODO: Implement email:testConnection IPC handler in main process
      const result = await window.electron.im.testGateway('email');

      if (result.success) {
        alert(t('emailTestSuccess'));
      } else {
        alert(t('emailTestFailed').replace('{error}', result.error || 'Unknown error'));
      }
    } catch (error) {
      alert(
        t('emailTestFailed').replace(
          '{error}',
          error instanceof Error ? error.message : String(error),
        ),
      );
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="flex h-full bg-white dark:bg-gray-900">
      {/* Left: Instance list */}
      <div className="w-64 border-r border-gray-200 dark:border-gray-700 p-4 overflow-y-auto">
        <button
          type="button"
          onClick={handleAddInstance}
          disabled={emailConfig.instances.length >= MAX_EMAIL_INSTANCES}
          className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed mb-4"
        >
          + {t('addEmailInstance')}
        </button>

        <div className="space-y-2">
          {emailConfig.instances.map(inst => {
            const status = emailStatus.instances.find(s => s.instanceId === inst.instanceId);
            const isSelected = selectedInstanceId === inst.instanceId;

            return (
              <div
                key={inst.instanceId}
                onClick={() => setSelectedInstanceId(inst.instanceId)}
                className={`p-3 rounded cursor-pointer border ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium truncate">{inst.instanceName}</span>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      handleDeleteInstance(inst.instanceId);
                    }}
                    className="text-red-500 hover:text-red-700"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
                <div className="text-xs text-gray-500 truncate">{inst.email}</div>
                <div className="flex items-center gap-2 mt-1">
                  <div
                    className={`w-2 h-2 rounded-full ${status?.connected ? 'bg-green-500' : 'bg-gray-400'}`}
                  />
                  <span className="text-xs">
                    {status?.connected ? t('emailConnected') : t('emailDisconnected')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Instance detail form */}
      {selectedInstance ? (
        <div className="flex-1 p-6 overflow-y-auto">
          <h2 className="text-2xl font-bold mb-6">{selectedInstance.instanceName}</h2>

          <div className="space-y-4">
            {/* Instance Name */}
            <div>
              <label className="block text-sm font-medium mb-1">{t('emailInstanceName')}</label>
              <input
                type="text"
                value={selectedInstance.instanceName}
                onChange={e =>
                  handleUpdateInstance(selectedInstance.instanceId, {
                    instanceName: e.target.value,
                  })
                }
                placeholder={t('emailInstanceNamePlaceholder')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
              />
            </div>

            {/* Transport Mode */}
            <div>
              <label className="block text-sm font-medium mb-1">{t('emailTransportMode')}</label>
              <div className="flex gap-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={selectedInstance.transport === 'imap'}
                    onChange={() =>
                      handleUpdateInstance(selectedInstance.instanceId, { transport: 'imap' })
                    }
                    className="mr-2"
                  />
                  {t('emailTransportImap')}
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={selectedInstance.transport === 'ws'}
                    onChange={() =>
                      handleUpdateInstance(selectedInstance.instanceId, { transport: 'ws' })
                    }
                    className="mr-2"
                  />
                  {t('emailTransportWs')}
                </label>
              </div>
            </div>

            {/* Email Address */}
            <div>
              <label className="block text-sm font-medium mb-1">{t('emailAddress')}</label>
              <input
                type="email"
                value={selectedInstance.email}
                onChange={e =>
                  handleUpdateInstance(selectedInstance.instanceId, { email: e.target.value })
                }
                placeholder={t('emailAddressPlaceholder')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
              />
            </div>

            {/* IMAP Mode: Password */}
            {selectedInstance.transport === 'imap' && (
              <div>
                <label className="block text-sm font-medium mb-1">{t('emailPassword')}</label>
                <input
                  type="password"
                  value={selectedInstance.password || ''}
                  onChange={e =>
                    handleUpdateInstance(selectedInstance.instanceId, { password: e.target.value })
                  }
                  placeholder={t('emailPasswordPlaceholder')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
                />
              </div>
            )}

            {/* WebSocket Mode: API Key */}
            {selectedInstance.transport === 'ws' && (
              <div>
                <label className="block text-sm font-medium mb-1">{t('emailApiKey')}</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={selectedInstance.apiKey || ''}
                    onChange={e =>
                      handleUpdateInstance(selectedInstance.instanceId, { apiKey: e.target.value })
                    }
                    placeholder={t('emailApiKeyPlaceholder')}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
                  />
                  <button
                    type="button"
                    onClick={handleGetApiKey}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 whitespace-nowrap"
                  >
                    {t('getApiKey')}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">{t('apiKeyHint')}</p>
              </div>
            )}

            {/* Agent Binding */}
            <div>
              <label className="block text-sm font-medium mb-1">{t('emailAgentBinding')}</label>
              <select
                value={selectedInstance.agentId}
                onChange={e =>
                  handleUpdateInstance(selectedInstance.instanceId, { agentId: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
              >
                {availableAgents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">{t('emailAgentBindingHint')}</p>
            </div>

            {/* Whitelist */}
            <div>
              <label className="block text-sm font-medium mb-1">{t('emailAllowFrom')}</label>
              <textarea
                value={(selectedInstance.allowFrom || []).join('\n')}
                onChange={e =>
                  handleUpdateInstance(selectedInstance.instanceId, {
                    allowFrom: e.target.value.split('\n').filter(Boolean),
                  })
                }
                placeholder={t('emailAllowFromPlaceholder')}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">{t('emailAllowFromHint')}</p>
            </div>

            {/* Advanced Options */}
            <details className="mt-6">
              <summary className="cursor-pointer font-medium text-blue-500 hover:text-blue-600">
                {t('emailAdvancedOptions')}
              </summary>

              <div className="mt-4 space-y-4 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
                {/* IMAP/SMTP Config (IMAP mode only) */}
                {selectedInstance.transport === 'imap' && (
                  <div className="space-y-4">
                    <h4 className="font-medium">{t('emailImapSmtpConfig')}</h4>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm mb-1">{t('emailImapHost')}</label>
                        <input
                          type="text"
                          value={selectedInstance.imapHost || ''}
                          onChange={e =>
                            handleUpdateInstance(selectedInstance.instanceId, {
                              imapHost: e.target.value,
                            })
                          }
                          placeholder="imap.example.com"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
                        />
                      </div>
                      <div>
                        <label className="block text-sm mb-1">{t('emailImapPort')}</label>
                        <input
                          type="number"
                          value={selectedInstance.imapPort || ''}
                          onChange={e =>
                            handleUpdateInstance(selectedInstance.instanceId, {
                              imapPort: parseInt(e.target.value) || undefined,
                            })
                          }
                          placeholder="993"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
                        />
                      </div>
                      <div>
                        <label className="block text-sm mb-1">{t('emailSmtpHost')}</label>
                        <input
                          type="text"
                          value={selectedInstance.smtpHost || ''}
                          onChange={e =>
                            handleUpdateInstance(selectedInstance.instanceId, {
                              smtpHost: e.target.value,
                            })
                          }
                          placeholder="smtp.example.com"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
                        />
                      </div>
                      <div>
                        <label className="block text-sm mb-1">{t('emailSmtpPort')}</label>
                        <input
                          type="number"
                          value={selectedInstance.smtpPort || ''}
                          onChange={e =>
                            handleUpdateInstance(selectedInstance.instanceId, {
                              smtpPort: parseInt(e.target.value) || undefined,
                            })
                          }
                          placeholder="465"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500">{t('emailServerConfigHint')}</p>
                  </div>
                )}

                {/* Reply Strategy */}
                <div className="space-y-4">
                  <h4 className="font-medium">{t('emailReplyStrategy')}</h4>

                  <div>
                    <label className="block text-sm mb-1">{t('emailReplyMode')}</label>
                    <select
                      value={selectedInstance.replyMode || 'complete'}
                      onChange={e =>
                        handleUpdateInstance(selectedInstance.instanceId, {
                          replyMode: e.target.value as any,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
                    >
                      <option value="immediate">{t('emailReplyModeImmediate')}</option>
                      <option value="accumulated">{t('emailReplyModeAccumulated')}</option>
                      <option value="complete">{t('emailReplyModeComplete')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm mb-1">{t('emailReplyTo')}</label>
                    <div className="flex gap-4">
                      <label className="flex items-center">
                        <input
                          type="radio"
                          checked={selectedInstance.replyTo === 'sender'}
                          onChange={() =>
                            handleUpdateInstance(selectedInstance.instanceId, { replyTo: 'sender' })
                          }
                          className="mr-2"
                        />
                        {t('emailReplyToSender')}
                      </label>
                      <label className="flex items-center">
                        <input
                          type="radio"
                          checked={selectedInstance.replyTo === 'all'}
                          onChange={() =>
                            handleUpdateInstance(selectedInstance.instanceId, { replyTo: 'all' })
                          }
                          className="mr-2"
                        />
                        {t('emailReplyToAll')}
                      </label>
                    </div>
                  </div>
                </div>

                {/* A2A Config */}
                <div className="space-y-4">
                  <h4 className="font-medium">{t('emailA2aConfig')}</h4>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedInstance.a2aEnabled ?? false}
                      onChange={e =>
                        handleUpdateInstance(selectedInstance.instanceId, {
                          a2aEnabled: e.target.checked,
                        })
                      }
                      className="mr-2"
                    />
                    {t('emailA2aEnabled')}
                  </label>

                  {selectedInstance.a2aEnabled && (
                    <>
                      <div>
                        <label className="block text-sm mb-1">{t('emailA2aAgentDomains')}</label>
                        <textarea
                          value={(selectedInstance.a2aAgentDomains || []).join('\n')}
                          onChange={e =>
                            handleUpdateInstance(selectedInstance.instanceId, {
                              a2aAgentDomains: e.target.value.split('\n').filter(Boolean),
                            })
                          }
                          placeholder={t('emailA2aAgentDomainsPlaceholder')}
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 font-mono text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          {t('emailA2aAgentDomainsHint')}
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm mb-1">{t('emailA2aMaxTurns')}</label>
                        <input
                          type="number"
                          value={selectedInstance.a2aMaxPingPongTurns || 20}
                          onChange={e =>
                            handleUpdateInstance(selectedInstance.instanceId, {
                              a2aMaxPingPongTurns: parseInt(e.target.value) || 20,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </details>
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={!selectedInstance.email || testing === selectedInstance.instanceId}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing === selectedInstance.instanceId ? 'Testing...' : t('testConnection')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : t('save')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          {emailConfig.instances.length === 0
            ? t('addEmailInstance')
            : 'Select an account to configure'}
        </div>
      )}
    </div>
  );
};
