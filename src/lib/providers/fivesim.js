'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

async function fetchProviderOffers({ mapping, exchangeRateService }) {
  try {
    const payload = await getJson(buildUrl(`${mapping.baseUrl}/guest/prices`, {
      product: mapping.serviceCode,
    }), {
      headers: {
        Accept: 'application/json',
      },
    });

    const productNode = payload?.[mapping.serviceCode];
    if (!productNode || typeof productNode !== 'object') {
      throw new Error(`5SIM product not found: ${mapping.serviceCode}`);
    }

    const now = new Date().toISOString();
    const offers = [];
    for (const [countryName, providers] of Object.entries(productNode)) {
      const tiers = Object.entries(providers || {}).map(([providerRef, entry]) => ({
        priceOriginal: Number(entry?.cost || 0),
        stock: Number(entry?.count || 0),
        providerRef,
      }));

      offers.push(await makeOffer({
        providerKey: mapping.providerKey,
        providerName: mapping.displayName,
        countryValue: countryName,
        countryName,
        currency: 'USD',
        tiers,
        exchangeRateService,
        lastFetchedAt: now,
        metadata: {
          rate: Object.values(providers || {}).find((entry) => Number.isFinite(Number(entry?.rate)))?.rate || null,
        },
      }));
    }

    return {
      providerKey: mapping.providerKey,
      providerName: mapping.displayName,
      offers,
      error: '',
    };
  } catch (error) {
    return createProviderError(mapping.providerKey, mapping.displayName, error);
  }
}

module.exports = {
  fetchProviderOffers,
};
