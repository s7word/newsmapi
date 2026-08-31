'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

const API_ROOT = 'https://sms-bus.com/api/control';

async function mapWithConcurrency(items, limit, iteratee) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function apiGet(path, token, params = {}) {
  const payload = await getJson(buildUrl(`${API_ROOT}/${path}`, {
    token,
    ...params,
  }), { timeoutMs: 30000 });

  if (Number(payload?.code) !== 200) {
    throw new Error(payload?.message || `SMS-Bus API error (${payload?.code || 'unknown'})`);
  }
  return payload;
}

function normalizeProjectCode(value) {
  return String(value || '').trim().toLowerCase();
}

async function resolveProjectId(token, serviceCode) {
  const raw = String(serviceCode || '').trim();
  if (!raw) throw new Error('Missing service code mapping');

  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  const projectsPayload = await apiGet('list/projects', token);
  const projects = Object.values(projectsPayload.data || {});
  const normalized = normalizeProjectCode(raw);
  const matched = projects.find((project) => normalizeProjectCode(project?.code) === normalized);
  if (!matched?.id) {
    throw new Error(`SMS-Bus project not found: ${raw}`);
  }
  return Number(matched.id);
}

function entryMatchesProject(entry, serviceCode, projectId) {
  const normalizedCode = normalizeProjectCode(serviceCode);
  if (Number(entry?.project_id) === projectId) return true;
  return normalizeProjectCode(entry?.project_code) === normalizedCode;
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }
    if (!mapping.serviceCode) {
      throw new Error('Missing service code mapping');
    }

    const projectId = await resolveProjectId(apiKey, mapping.serviceCode);
    const countriesPayload = await apiGet('list/countries', apiKey);
    const countries = Object.values(countriesPayload.data || {})
      .filter((country) => country?.id != null)
      .map((country) => ({
        id: Number(country.id),
        title: country.title || country.code || String(country.id),
        code: country.code || '',
      }))
      .filter((country) => Number.isFinite(country.id));

    const now = new Date().toISOString();
    const offers = (await mapWithConcurrency(countries, 8, async (country) => {
      try {
        const pricesPayload = await apiGet('list/prices', apiKey, {
          country_id: country.id,
        });
        const entries = Object.values(pricesPayload.data || {});
        const matched = entries.find((entry) => entryMatchesProject(entry, mapping.serviceCode, projectId));
        if (!matched) return null;

        const stock = Number(matched.total_count || 0);
        const price = Number(matched.cost || 0);
        if (!Number.isFinite(price)) return null;

        return await makeOffer({
          providerKey: mapping.providerKey,
          providerName: mapping.displayName,
          countryValue: matched.title || country.title || country.code || String(country.id),
          countryName: matched.title || country.title || country.code || String(country.id),
          currency: 'USD',
          tiers: [{
            priceOriginal: price,
            stock: Number.isFinite(stock) ? stock : 0,
            providerRef: String(matched.project_id || projectId),
          }],
          exchangeRateService,
          lastFetchedAt: now,
        });
      } catch (error) {
        return null;
      }
    })).filter(Boolean);

    if (!offers.length) {
      throw new Error('SMS-Bus 未返回匹配项目的报价');
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
