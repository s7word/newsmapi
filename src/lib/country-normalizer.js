'use strict';

const countries = require('i18n-iso-countries');
const enLocale = require('i18n-iso-countries/langs/en.json');
const zhLocale = require('i18n-iso-countries/langs/zh.json');

countries.registerLocale(enLocale);
countries.registerLocale(zhLocale);

const ALIASES = new Map([
  ['usa', 'US'],
  ['united states', 'US'],
  ['united states of america', 'US'],
  ['england', 'GB'],
  ['great britain', 'GB'],
  ['uk', 'GB'],
  ['united kingdom', 'GB'],
  ['hong kong (china)', 'HK'],
  ['hong kong', 'HK'],
  ['taiwan', 'TW'],
  ['viet nam', 'VN'],
  ['south korea', 'KR'],
  ['korea, republic of', 'KR'],
  ['russian federation', 'RU'],
  ['czech republic', 'CZ'],
  ['laos', 'LA'],
  ['ivory coast', 'CI'],
  ['côte d\'ivoire', 'CI'],
  ['dem. congo', 'CD'],
  ['democratic republic of the congo', 'CD'],
  ['curacao', 'CW'],
  ['curaçao', 'CW'],
]);

function normalizeCountryKey(value) {
  return String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function getIso2FromName(name) {
  const normalized = normalizeCountryKey(name);
  if (!normalized) return '';
  if (ALIASES.has(normalized)) return ALIASES.get(normalized);

  const direct = countries.getAlpha2Code(normalized, 'en');
  if (direct) return direct.toUpperCase();

  const names = countries.getNames('en', { select: 'official' });
  for (const [iso2, countryName] of Object.entries(names)) {
    if (normalizeCountryKey(countryName) === normalized) {
      return iso2.toUpperCase();
    }
  }
  return '';
}

function toCountryInfo(input, fallbackName = '') {
  const raw = String(input || fallbackName || '').trim();
  if (!raw) {
    return {
      iso2: '',
      name: fallbackName || '',
      englishName: fallbackName || '',
      chineseName: fallbackName || '',
      displayName: fallbackName || '',
    };
  }

  const isoCandidate = raw.length === 2 ? raw.toUpperCase() : '';
  if (isoCandidate && countries.isValid(isoCandidate)) {
    const englishName = countries.getName(isoCandidate, 'en') || fallbackName || raw;
    const chineseName = countries.getName(isoCandidate, 'zh') || englishName;
    return {
      iso2: isoCandidate,
      name: englishName,
      englishName,
      chineseName,
      displayName: `${chineseName} (${englishName})`,
    };
  }

  const iso2 = getIso2FromName(raw);
  const englishName = countries.getName(iso2, 'en') || fallbackName || raw;
  const chineseName = countries.getName(iso2, 'zh') || englishName;
  return {
    iso2,
    name: englishName,
    englishName,
    chineseName,
    displayName: `${chineseName} (${englishName})`,
  };
}

module.exports = {
  getIso2FromName,
  normalizeCountryKey,
  toCountryInfo,
};
