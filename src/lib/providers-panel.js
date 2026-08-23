'use strict';

const { getProviderDefinition } = require('../config/providers-catalog');
const { buildServiceConfig } = require('../config/services-catalog');
const { getAllProviderStates, getAllProviderSnapshots } = require('./db');
const { getProviderConnectivityMap, listProviderKeySettings } = require('./settings');

function buildProvidersPanel(db, serviceKey) {
  const keySettings = listProviderKeySettings(db);
  const serviceConfig = buildServiceConfig(serviceKey);
  const serviceCodeMap = new Map(
    serviceConfig.providerMappings.map((mapping) => [mapping.providerKey, mapping.serviceCode || '']),
  );
  const states = getAllProviderStates(db, serviceKey);
  const snapshots = new Map(
    getAllProviderSnapshots(db, serviceKey).map((snapshot) => [snapshot.providerKey, snapshot]),
  );
  const connectivityMap = getProviderConnectivityMap(db);

  return keySettings.map((provider) => {
    const definition = getProviderDefinition(provider.providerKey);
    const state = states.get(provider.providerKey);
    const snapshot = snapshots.get(provider.providerKey);
    const offers = snapshot?.payload?.offers;
    const offerCount = Array.isArray(offers) ? offers.length : 0;

    return {
      ...provider,
      baseUrl: definition?.baseUrl || '',
      publicWithoutKey: Boolean(definition?.publicWithoutKey || provider.publicWithoutKey),
      serviceCode: serviceCodeMap.get(provider.providerKey) || '',
      supportsCurrentService: Boolean(serviceCodeMap.get(provider.providerKey)),
      refresh: {
        status: state?.status || 'idle',
        lastAttemptedAt: state?.last_attempted_at || '',
        lastSuccessAt: state?.last_success_at || '',
        errorMessage: state?.error_message || '',
        offerCount,
        snapshotFetchedAt: snapshot?.fetchedAt || '',
      },
      connectivity: connectivityMap[provider.providerKey] || null,
    };
  });
}

module.exports = {
  buildProvidersPanel,
};
