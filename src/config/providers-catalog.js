'use strict';

/**
 * Provider (platform) catalog. Service-specific product codes live in services-catalog.js.
 */
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
    providerKey: 'sms-activate',
    displayName: 'SMS-Activate',
    baseUrl: 'https://api.sms-activate.ae/stubs/handler_api.php',
    keyEnv: 'SMS_ACTIVATE_API_KEY',
    publicWithoutKey: false,
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
};
