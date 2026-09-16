'use strict';

function normalizeTier({ priceOriginal, priceUsd, stock, providerRef }) {
  return {
    priceOriginal: Number(priceOriginal || 0),
    priceUsd: Number(priceUsd || 0),
    stock: Number(stock || 0),
    providerRef: providerRef || '',
  };
}

function createProviderOffer(input) {
  return {
    providerKey: input.providerKey,
    providerName: input.providerName,
    countryIso2: String(input.countryIso2 || '').toUpperCase(),
    countryName: String(input.countryName || '').trim(),
    countryNameEn: String(input.countryNameEn || input.countryName || '').trim(),
    countryNameZh: String(input.countryNameZh || input.countryName || '').trim(),
    countryDisplayName: String(input.countryDisplayName || input.countryName || '').trim(),
    status: input.status || 'out_of_stock',
    currency: String(input.currency || 'USD').toUpperCase(),
    minPriceOriginal: Number(input.minPriceOriginal || 0),
    minPriceUsd: Number(input.minPriceUsd || 0),
    inventoryTotal: Number(input.inventoryTotal || 0),
    tiers: Array.isArray(input.tiers) ? input.tiers.map(normalizeTier) : [],
    lastFetchedAt: input.lastFetchedAt || new Date().toISOString(),
    errorMessage: input.errorMessage || '',
    metadata: input.metadata || {},
  };
}

module.exports = {
  createProviderOffer,
};
