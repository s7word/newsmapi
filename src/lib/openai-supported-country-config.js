'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadOpenAiSupportedCountries(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      filePath: resolvedPath,
      updatedAt: '',
      whitelist: [],
    };
  }

  const stat = fs.statSync(resolvedPath);
  const whitelist = fs.readFileSync(resolvedPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim().toUpperCase())
    .filter((line) => /^[A-Z]{2}$/.test(line));

  return {
    filePath: resolvedPath,
    updatedAt: stat.mtime.toISOString(),
    whitelist,
  };
}

module.exports = {
  loadOpenAiSupportedCountries,
};
