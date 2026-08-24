'use strict';

/**
 * Provider (platform) catalog. Service-specific product codes live in services-catalog.js.
 */
const PORTAL_URL_OVERRIDES = {
  smsbower: 'https://smsbower.app',
};

function resolvePortalUrl(provider = {}) {
  if (provider.portalUrl) return String(provider.portalUrl).trim();
  const override = PORTAL_URL_OVERRIDES[provider.providerKey];
  if (override) return override;
  const baseUrl = String(provider.baseUrl || '').trim();
  if (!baseUrl) return '';
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

const PROVIDERS = [
  {
    providerKey: 'hero-sms',
    displayName: 'Hero SMS',
    baseUrl: 'https://hero-sms.com/stubs/handler_api.php',
    keyEnv: 'HERO_SMS_API_KEY',
    publicWithoutKey: false,
  },
  {
    providerKey: 'smsbower',
    displayName: 'SMSBower',
    baseUrl: 'https://smsbower.page/stubs/handler_api.php',
    publicPricesUrl: 'https://smsbower.app/activations/getPricesByService',
    keyEnv: 'SMSBOWER_API_KEY',
    publicWithoutKey: true,
  },
  {
    providerKey: '5sim',
    displayName: '5SIM',
    baseUrl: 'https://5sim.net/v1',
    keyEnv: 'FIVESIM_API_KEY',
    publicWithoutKey: true,
  },
  {
    providerKey: 'nexsms',
    displayName: 'NexSMS',
    baseUrl: 'https://api.nexsms.net/api',
    keyEnv: 'NEXSMS_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.NEXSMS_REFRESH_INTERVAL_MS || 300000),
    errorRetryIntervalMs: Number(process.env.NEXSMS_ERROR_RETRY_INTERVAL_MS || 1800000),
  },
  {
    providerKey: 'grizzlysms',
    displayName: 'Grizzly SMS',
    baseUrl: 'https://api.grizzlysms.com/stubs/handler_api.php',
    keyEnv: 'GRIZZLYSMS_API_KEY',
    publicWithoutKey: false,
  },
  {
    providerKey: 'sms-verification-number',
    displayName: 'SMS Verification Number',
    baseUrl: 'https://sms-verification-number.com/stubs/handler_api',
    keyEnv: 'SMS_VERIFICATION_API_KEY',
    publicWithoutKey: false,
  },
  {
    providerKey: 'smspool',
    displayName: 'SMSPool',
    baseUrl: 'https://api.smspool.net',
    keyEnv: 'SMSPOOL_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.SMSPOOL_REFRESH_INTERVAL_MS || 180000),
  },
  {
    providerKey: 'onlinesim',
    displayName: 'OnlineSim',
    baseUrl: 'https://onlinesim.io/api',
    keyEnv: 'ONLINESIM_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.ONLINESIM_REFRESH_INTERVAL_MS || 300000),
    errorRetryIntervalMs: Number(process.env.ONLINESIM_ERROR_RETRY_INTERVAL_MS || 180000),
  },
  {
    providerKey: 'smspva',
    displayName: 'SMSPVA',
    baseUrl: 'https://api.smspva.com',
    keyEnv: 'SMSPVA_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.SMSPVA_REFRESH_INTERVAL_MS || 180000),
  },
  {
    providerKey: 'codesverify',
    displayName: 'CodesVerify',
    baseUrl: 'https://api.codesverify.com',
    keyEnv: 'CODESVERIFY_API_KEY',
    publicWithoutKey: false,
  },
  {
    providerKey: 'smscode',
    displayName: 'SMSCode.net',
    baseUrl: 'https://smscode.net/api/user',
    keyEnv: 'SMSCODE_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.SMSCODE_REFRESH_INTERVAL_MS || 300000),
  },
  {
    providerKey: 'sms-rooms',
    displayName: 'SMS-Rooms',
    baseUrl: 'https://sms-rooms.com/stubs/handler_api.php',
    keyEnv: 'SMS_ROOMS_API_KEY',
    publicWithoutKey: false,
  },
  {
    providerKey: 'sms-bus',
    displayName: 'SMS-Bus',
    baseUrl: 'https://sms-bus.com/api/control',
    keyEnv: 'SMS_BUS_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.SMS_BUS_REFRESH_INTERVAL_MS || 180000),
  },
  {
    providerKey: 'vibe-sms',
    displayName: 'Vibe SMS',
    baseUrl: 'https://api.vibe-sms.net/api/v1',
    keyEnv: 'VIBE_SMS_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.VIBE_SMS_REFRESH_INTERVAL_MS || 180000),
  },
  {
    providerKey: 'cyberyozh',
    displayName: 'CyberYozh',
    baseUrl: 'https://app.cyberyozh.com/api/v1',
    keyEnv: 'CYBERYOZH_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.CYBERYOZH_REFRESH_INTERVAL_MS || 180000),
  },
  {
    providerKey: 'vak-sms',
    displayName: 'Vak SMS',
    baseUrl: 'https://vak-sms.com/stubs/handler_api.php',
    keyEnv: 'VAK_SMS_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.VAK_SMS_REFRESH_INTERVAL_MS || 180000),
  },
  {
    providerKey: 'give-sms',
    displayName: 'Give SMS',
    baseUrl: 'https://give-sms.com/api/v1',
    keyEnv: 'GIVE_SMS_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.GIVE_SMS_REFRESH_INTERVAL_MS || 180000),
  },
  {
    providerKey: '365sms',
    displayName: '365SMS',
    baseUrl: 'https://365sms.com/stubs/handler_api.php',
    keyEnv: 'SMS365_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.SMS365_REFRESH_INTERVAL_MS || 180000),
  },
  {
    providerKey: 'juicy-sms',
    displayName: 'JuicySMS',
    baseUrl: 'https://juicysms.com/api/v2',
    keyEnv: 'JUICYSMS_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.JUICYSMS_REFRESH_INTERVAL_MS || 180000),
  },
  {
    providerKey: 'pvapins',
    displayName: 'PVAPins',
    baseUrl: 'https://api.pvapins.com',
    keyEnv: 'PVAPINS_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.PVAPINS_REFRESH_INTERVAL_MS || 300000),
  },
  {
    providerKey: 'simsms',
    displayName: 'SimSMS',
    baseUrl: 'https://simsms.org/priemnik.php',
    keyEnv: 'SIMSMS_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.SIMSMS_REFRESH_INTERVAL_MS || 300000),
  },
  {
    providerKey: 'getsms',
    displayName: 'GetSMS',
    baseUrl: 'https://getsms.online/api_command.php',
    keyEnv: 'GETSMS_API_KEY',
    publicWithoutKey: false,
    settingsHint: '必须同时提供用户名/邮箱与 API Key：设置里填 user|api_key（例 you@mail.com|密钥），或环境变量 GETSMS_USER。只填 Key 会 Unauthorized，官网没有公开报价接口。',
    keyPlaceholder: 'you@mail.com|API密钥',
    minRefreshIntervalMs: Number(process.env.GETSMS_REFRESH_INTERVAL_MS || 300000),
  },
  {
    providerKey: 'tiger-sms',
    displayName: 'Tiger SMS',
    baseUrl: 'https://api.tiger-sms.com/stubs/handler_api.php',
    keyEnv: 'TIGER_SMS_API_KEY',
    publicWithoutKey: false,
    minRefreshIntervalMs: Number(process.env.TIGER_SMS_REFRESH_INTERVAL_MS || 180000),
  },
  {
    providerKey: 'smstg',
    displayName: 'SMSTG',
    baseUrl: 'https://smstg.org/api',
    keyEnv: 'SMSTG_API_KEY',
    publicWithoutKey: true,
    minRefreshIntervalMs: Number(process.env.SMSTG_REFRESH_INTERVAL_MS || 300000),
  },
];

function listProviders() {
  return PROVIDERS.map((provider) => ({ ...provider }));
}

function getProviderDefinition(providerKey) {
  return PROVIDERS.find((provider) => provider.providerKey === providerKey) || null;
}

module.exports = {
  PROVIDERS,
  getProviderDefinition,
  listProviders,
  resolvePortalUrl,
};
