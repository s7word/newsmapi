'use strict';

function offerKey(offer) {
  const providerKey = String(offer?.providerKey || '').trim();
  const countryIso2 = String(offer?.countryIso2 || '').trim().toUpperCase();
  return `${providerKey}:${countryIso2}`;
}

function indexOffers(offers) {
  const map = new Map();
  for (const offer of offers || []) {
    if (!offer?.providerKey || !offer?.countryIso2) continue;
    map.set(offerKey(offer), offer);
  }
  return map;
}

function isInStock(offer) {
  if (!offer) return false;
  const stock = Number(offer.inventoryTotal || 0);
  if (stock > 0) return true;
  return String(offer.status || '').toLowerCase() === 'in_stock';
}

/**
 * Compare provider offer snapshots for inventory alert events.
 * Skips baseline when previous offers are empty (first successful catalog).
 */
function diffProviderOffers({
  providerKey,
  providerName,
  previousOffers,
  newOffers,
}) {
  const previousMap = indexOffers(previousOffers);
  const newMap = indexOffers(newOffers);
  const events = [];

  if (previousMap.size === 0) {
    return events;
  }

  for (const [key, newOffer] of newMap.entries()) {
    const previousOffer = previousMap.get(key);
    const newStock = Number(newOffer.inventoryTotal || 0);
    const newInStock = isInStock(newOffer);

    if (!previousOffer) {
      if (newInStock) {
        events.push({
          type: 'new_listing',
          providerKey: newOffer.providerKey || providerKey,
          providerName: newOffer.providerName || providerName,
          countryIso2: newOffer.countryIso2,
          countryName: newOffer.countryDisplayName || newOffer.countryName,
          previousStock: 0,
          newStock,
          minPriceUsd: Number(newOffer.minPriceUsd || 0),
          minPriceOriginal: Number(newOffer.minPriceOriginal || 0),
          currency: newOffer.currency || 'USD',
        });
      }
      continue;
    }

    const previousStock = Number(previousOffer.inventoryTotal || 0);
    const wasInStock = isInStock(previousOffer);
    const restockedFromEmpty = !wasInStock && newInStock;
    const inventoryIncreased = newStock > previousStock;

    if (restockedFromEmpty || inventoryIncreased) {
      events.push({
        type: 'restock',
        providerKey: newOffer.providerKey || providerKey,
        providerName: newOffer.providerName || providerName,
        countryIso2: newOffer.countryIso2,
        countryName: newOffer.countryDisplayName || newOffer.countryName,
        previousStock,
        newStock,
        minPriceUsd: Number(newOffer.minPriceUsd || 0),
        minPriceOriginal: Number(newOffer.minPriceOriginal || 0),
        currency: newOffer.currency || 'USD',
      });
    }
  }

  return events;
}

module.exports = {
  diffProviderOffers,
  offerKey,
};
