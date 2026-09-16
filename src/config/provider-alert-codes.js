'use strict';

const { PROVIDERS, getProviderDefinition } = require('./providers-catalog');

function formatAlertCode(index) {
  return `P${String(index + 1).padStart(2, '0')}`;
}

function getProviderAlertCode(providerKey) {
  const index = PROVIDERS.findIndex((provider) => provider.providerKey === providerKey);
  if (index < 0) return '';
  return formatAlertCode(index);
}

function listProviderAlertCatalog() {
  return PROVIDERS.map((provider, index) => ({
    providerKey: provider.providerKey,
    displayName: provider.displayName,
    alertCode: formatAlertCode(index),
  }));
}

function resolveProviderAlertMeta(providerKey) {
  const definition = getProviderDefinition(providerKey);
  return {
    providerKey: definition?.providerKey || String(providerKey || ''),
    displayName: definition?.displayName || '',
    alertCode: getProviderAlertCode(providerKey),
  };
}

module.exports = {
  getProviderAlertCode,
  listProviderAlertCatalog,
  resolveProviderAlertMeta,
};
