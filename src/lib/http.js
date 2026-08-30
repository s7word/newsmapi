'use strict';

function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30000;
  const timeout = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      error.statusCode = response.status;
      error.body = text;
      throw error;
    }
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(url, options = {}) {
  const { text } = await request(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  try {
    return JSON.parse(text);
  } catch (error) {
    error.message = `Failed to parse JSON from ${url}: ${error.message}`;
    throw error;
  }
}

async function getText(url, options = {}) {
  const { text } = await request(url, options);
  return text;
}

module.exports = {
  buildUrl,
  getJson,
  getText,
  request,
};
