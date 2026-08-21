'use strict';

const { listProviders } = require('./providers-catalog');

const DEFAULT_BIND_WHITELIST = [
  'AF', 'AM', 'CW', 'AO', 'AX', 'BD', 'BF', 'BG', 'BI', 'BL', 'BO', 'CA', 'CC', 'CF', 'CM', 'CX',
  'DZ', 'EC', 'EG', 'EH', 'ET', 'FK', 'FR', 'GH', 'GN', 'GW', 'HN', 'HT', 'ID', 'IO', 'JM', 'JO',
  'JP', 'KG', 'KH', 'KM', 'KR', 'LB', 'LK', 'LY', 'ME', 'MF', 'MG', 'ML', 'MN', 'MP', 'MU', 'MY',
  'MZ', 'NG', 'NU', 'PE', 'PK', 'PN', 'PS', 'SA', 'SD', 'SH', 'SI', 'SJ', 'SL', 'SM', 'SN', 'TG',
  'TH', 'TJ', 'TK', 'TL', 'TM', 'TW', 'UG', 'UM', 'US', 'UZ', 'VA', 'VN', 'VU', 'RS', 'ZM', 'ZW',
];

const DEFAULT_RECOMMENDED_WHITELIST = [
  'ID', 'PH', 'CO', 'UA', 'NL', 'BR', 'PL', 'GB', 'CA', 'MX', 'IL', 'FR', 'SE', 'TH', 'HK',
];

/**
 * Multi-service catalog.
 * `codes` maps providerKey → upstream service/product code.
 * Activate-compatible providers (Hero/Grizzly/SMSBower/SMS-Activate/...) share SMS-Activate style codes.
 */
const SERVICES = [
  {
    serviceKey: 'openai_chatgpt',
    displayName: 'OPENAI (ChatGPT)',
    category: 'ai',
    modes: ['register', 'bind', 'recommended', 'whatsapp'],
    bindWhitelistIso2: DEFAULT_BIND_WHITELIST,
    recommendedWhitelistIso2: DEFAULT_RECOMMENDED_WHITELIST,
    codes: {
      'hero-sms': process.env.HERO_SMS_SERVICE_CODE || 'dr',
      smsbower: process.env.SMSBOWER_SERVICE_CODE || 'dr',
      '5sim': process.env.FIVESIM_SERVICE_CODE || 'openai',
      nexsms: process.env.NEXSMS_SERVICE_CODE || 'dr',
      grizzlysms: process.env.GRIZZLYSMS_SERVICE_CODE || 'dr',
      'sms-verification-number': process.env.SMS_VERIFICATION_SERVICE_CODE || 'dr',
      smspool: process.env.SMSPOOL_SERVICE_CODE || '671',
      'sms-activate': process.env.SMS_ACTIVATE_SERVICE_CODE || 'dr',
    },
    nativeNames: {
      smspool: process.env.SMSPOOL_NATIVE_SERVICE_NAME || 'OpenAI / ChatGPT',
    },
  },
  {
    serviceKey: 'telegram',
    displayName: 'Telegram',
    category: 'messaging',
    modes: ['all'],
    codes: {
      'hero-sms': 'tg',
      smsbower: 'tg',
      '5sim': 'telegram',
      nexsms: 'tg',
      grizzlysms: 'tg',
      'sms-verification-number': 'tg',
      smspool: '903',
      'sms-activate': 'tg',
    },
    nativeNames: { smspool: 'Telegram' },
  },
  {
    serviceKey: 'whatsapp',
    displayName: 'WhatsApp',
    category: 'messaging',
    modes: ['all'],
    codes: {
      'hero-sms': 'wa',
      smsbower: 'wa',
      '5sim': 'whatsapp',
      nexsms: 'wa',
      grizzlysms: 'wa',
      'sms-verification-number': 'wa',
      smspool: '1012',
      'sms-activate': 'wa',
    },
    nativeNames: { smspool: 'WhatsApp' },
  },
  {
    serviceKey: 'google',
    displayName: 'Google',
    category: 'account',
    modes: ['all'],
    codes: {
      'hero-sms': 'go',
      smsbower: 'go',
      '5sim': 'google',
      nexsms: 'go',
      grizzlysms: 'go',
      'sms-verification-number': 'go',
      smspool: '142',
      'sms-activate': 'go',
    },
    nativeNames: { smspool: 'Google' },
  },
  {
    serviceKey: 'discord',
    displayName: 'Discord',
    category: 'messaging',
    modes: ['all'],
    codes: {
      'hero-sms': 'ds',
      smsbower: 'ds',
      '5sim': 'discord',
      nexsms: 'ds',
      grizzlysms: 'ds',
      'sms-verification-number': 'ds',
      smspool: '461',
      'sms-activate': 'ds',
    },
    nativeNames: { smspool: 'Discord' },
  },
  {
    serviceKey: 'microsoft',
    displayName: 'Microsoft',
    category: 'account',
    modes: ['all'],
    codes: {
      'hero-sms': 'mm',
      smsbower: 'mm',
      '5sim': 'microsoft',
      nexsms: 'mm',
      grizzlysms: 'mm',
      'sms-verification-number': 'mm',
      smspool: '465',
      'sms-activate': 'mm',
    },
    nativeNames: { smspool: 'Microsoft' },
  },
  {
    serviceKey: 'twitter',
    displayName: 'Twitter / X',
    category: 'social',
    modes: ['all'],
    codes: {
      'hero-sms': 'tw',
      smsbower: 'tw',
      '5sim': 'twitter',
      nexsms: 'tw',
      grizzlysms: 'tw',
      'sms-verification-number': 'tw',
      smspool: '6',
      'sms-activate': 'tw',
    },
    nativeNames: { smspool: 'Twitter' },
  },
  {
    serviceKey: 'instagram',
    displayName: 'Instagram',
    category: 'social',
    modes: ['all'],
    codes: {
      'hero-sms': 'ig',
      smsbower: 'ig',
      '5sim': 'instagram',
      nexsms: 'ig',
      grizzlysms: 'ig',
      'sms-verification-number': 'ig',
      smspool: '17',
      'sms-activate': 'ig',
    },
    nativeNames: { smspool: 'Instagram' },
  },
  {
    serviceKey: 'facebook',
    displayName: 'Facebook',
    category: 'social',
    modes: ['all'],
    codes: {
      'hero-sms': 'fb',
      smsbower: 'fb',
      '5sim': 'facebook',
      nexsms: 'fb',
      grizzlysms: 'fb',
      'sms-verification-number': 'fb',
      smspool: '7',
      'sms-activate': 'fb',
    },
    nativeNames: { smspool: 'Facebook' },
  },
  {
    serviceKey: 'tiktok',
    displayName: 'TikTok',
    category: 'social',
    modes: ['all'],
    codes: {
      'hero-sms': 'lf',
      smsbower: 'lf',
      '5sim': 'tiktok',
      nexsms: 'lf',
      grizzlysms: 'lf',
      'sms-verification-number': 'lf',
      smspool: '1070',
      'sms-activate': 'lf',
    },
    nativeNames: { smspool: 'TikTok' },
  },
  {
    serviceKey: 'amazon',
    displayName: 'Amazon',
    category: 'commerce',
    modes: ['all'],
    codes: {
      'hero-sms': 'am',
      smsbower: 'am',
      '5sim': 'amazon',
      nexsms: 'am',
      grizzlysms: 'am',
      'sms-verification-number': 'am',
      smspool: '44',
      'sms-activate': 'am',
    },
    nativeNames: { smspool: 'Amazon' },
  },
  {
    serviceKey: 'apple',
    displayName: 'Apple',
    category: 'account',
    modes: ['all'],
    codes: {
      'hero-sms': 'wx',
      smsbower: 'wx',
      '5sim': 'apple',
      nexsms: 'wx',
      grizzlysms: 'wx',
      'sms-verification-number': 'wx',
      smspool: '1438',
      'sms-activate': 'wx',
    },
    nativeNames: { smspool: 'Apple' },
  },
];

function listServices() {
  return SERVICES.map((service) => ({
    serviceKey: service.serviceKey,
    displayName: service.displayName,
    category: service.category,
    modes: service.modes || ['all'],
  }));
}

function getServiceDefinition(serviceKey) {
  return SERVICES.find((service) => service.serviceKey === serviceKey) || null;
}

function buildServiceConfig(serviceKey = 'openai_chatgpt') {
  const service = getServiceDefinition(serviceKey) || getServiceDefinition('openai_chatgpt');
  const providers = listProviders();

  return {
    serviceKey: service.serviceKey,
    displayName: service.displayName,
    category: service.category,
    modes: service.modes || ['all'],
    bindWhitelistIso2: service.bindWhitelistIso2 || [],
    recommendedWhitelistIso2: service.recommendedWhitelistIso2 || [],
    providerMappings: providers.map((provider) => ({
      ...provider,
      serviceCode: service.codes?.[provider.providerKey] || '',
      nativeServiceName: service.nativeNames?.[provider.providerKey] || '',
    })),
  };
}

/** Backward-compatible default export shape used by older call sites. */
const defaultConfig = buildServiceConfig('openai_chatgpt');

module.exports = {
  ...defaultConfig,
  SERVICES,
  buildServiceConfig,
  getServiceDefinition,
  listServices,
};
