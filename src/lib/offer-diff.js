'use strict';

function offerKey(offer) {
  const providerKey = String(offer?.providerKey || '').trim();
  const countryIso2 = String(offer?.countryIso2 || '').trim().toUpperCase();
  return `${providerKey}:${countryIso2}`;
}

function parseSupplierIds(providerRef) {
  return String(providerRef || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function tierDiffKey(tier) {
  const ref = String(tier?.providerRef || '').trim();
  const price = Number(tier?.priceOriginal ?? tier?.priceUsd ?? 0);
  return `${ref}|${Number.isFinite(price) ? price : 0}`;
}

function offerUsesTierDiff(offer) {
  return (offer?.tiers || []).some((tier) => String(tier?.providerRef || '').trim());
}

function shouldUseTierDiff(previousOffer, newOffer) {
  return offerUsesTierDiff(previousOffer) || offerUsesTierDiff(newOffer);
}

function indexOffers(offers) {
  const map = new Map();
  for (const offer of offers || []) {
    if (!offer?.providerKey || !offer?.countryIso2) continue;
    map.set(offerKey(offer), offer);
  }
  return map;
}

function indexTiers(offer) {
  const map = new Map();
  for (const tier of offer?.tiers || []) {
    map.set(tierDiffKey(tier), tier);
  }
  return map;
}

function isInStock(offer) {
  if (!offer) return false;
  const stock = Number(offer.inventoryTotal || 0);
  if (stock > 0) return true;
  return String(offer.status || '').toLowerCase() === 'in_stock';
}

function tierInStock(tier) {
  return Number(tier?.stock || 0) > 0;
}

function buildTierEvent({
  type,
  offer,
  tier,
  previousStock,
  newStock,
  providerKey,
  providerName,
}) {
  const priceOriginal = Number(tier?.priceOriginal ?? tier?.priceUsd ?? 0);
  const priceUsd = Number(tier?.priceUsd ?? tier?.priceOriginal ?? 0);
  const providerRef = String(tier?.providerRef || '').trim();
  return {
    type,
    providerKey: offer.providerKey || providerKey,
    providerName: offer.providerName || providerName,
    countryIso2: offer.countryIso2,
    countryName: offer.countryDisplayName || offer.countryName,
    previousStock,
    newStock,
    minPriceUsd: Number.isFinite(priceUsd) ? priceUsd : priceOriginal,
    minPriceOriginal: Number.isFinite(priceOriginal) ? priceOriginal : priceUsd,
    currency: offer.currency || 'USD',
    providerRef,
    supplierIds: parseSupplierIds(providerRef),
    tierKey: tierDiffKey(tier),
  };
}

function diffCountryOfferTiers({
  previousOffer,
  newOffer,
  providerKey,
  providerName,
}) {
  const events = [];
  const prevMap = indexTiers(previousOffer);
  const newMap = indexTiers(newOffer);
  const allKeys = new Set([...prevMap.keys(), ...newMap.keys()]);

  for (const key of allKeys) {
    const prevTier = prevMap.get(key);
    const newTier = newMap.get(key);
    const prevStock = Number(prevTier?.stock || 0);
    const newStock = Number(newTier?.stock || 0);

    if (!prevTier && newTier && tierInStock(newTier)) {
      events.push(buildTierEvent({
        type: 'new_listing',
        offer: newOffer,
        tier: newTier,
        previousStock: 0,
        newStock,
        providerKey,
        providerName,
      }));
      continue;
    }

    if (!prevTier || !newTier) continue;

    const wasInStock = prevStock > 0;
    const newInStock = tierInStock(newTier);
    const restockedFromEmpty = !wasInStock && newInStock;
    const inventoryIncreased = newStock > prevStock;

    if (restockedFromEmpty || inventoryIncreased) {
      events.push(buildTierEvent({
        type: 'restock',
        offer: newOffer,
        tier: newTier,
        previousStock: prevStock,
        newStock,
        providerKey,
        providerName,
      }));
    }
  }

  return events;
}

function diffCountryOfferAggregate({
  previousOffer,
  newOffer,
  providerKey,
  providerName,
}) {
  const events = [];
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
        providerRef: '',
        supplierIds: [],
        tierKey: '',
      });
    }
    return events;
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
      providerRef: '',
      supplierIds: [],
      tierKey: '',
    });
  }

  return events;
}

/**
 * Compare provider offer snapshots for inventory alert events.
 * When tiers carry providerRef (SMSBower agent_ids, 5SIM virtual*, pools, etc.),
 * diff per supplier/price tier instead of country aggregate.
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
    const tierMode = shouldUseTierDiff(previousOffer, newOffer);

    if (tierMode) {
      events.push(...diffCountryOfferTiers({
        previousOffer,
        newOffer,
        providerKey,
        providerName,
      }));
      continue;
    }

    events.push(...diffCountryOfferAggregate({
      previousOffer,
      newOffer,
      providerKey,
      providerName,
    }));
  }

  return events;
}

module.exports = {
  diffProviderOffers,
  diffCountryOfferAggregate,
  diffCountryOfferTiers,
  offerKey,
  offerUsesTierDiff,
  parseSupplierIds,
  shouldUseTierDiff,
  tierDiffKey,
};
