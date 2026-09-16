'use strict';

const { extractBearerToken, getSession } = require('../settings');

function readGatewayToken(req) {
  return String(
    req.get('x-gateway-token')
    || req.get('authorization')?.replace(/^Bearer\s+/i, '')
    || req.query?.api_key
    || '',
  ).trim();
}

/**
 * Gateway auth modes:
 * - admin: logged-in admin session
 * - gateway_token: GATEWAY_API_TOKEN matches (use stored provider keys)
 * - passthrough: caller supplies upstream api_key in query/body
 */
function authorizeGateway(req, db) {
  const sessionToken = extractBearerToken(req);
  const session = getSession(sessionToken);
  if (session) {
    return { ok: true, mode: 'admin' };
  }

  const configuredToken = String(process.env.GATEWAY_API_TOKEN || '').trim();
  const providedToken = readGatewayToken(req);
  if (configuredToken && providedToken === configuredToken) {
    return { ok: true, mode: 'gateway_token' };
  }

  const passThroughKey = String(req.query?.api_key || req.body?.api_key || '').trim();
  if (passThroughKey) {
    return { ok: true, mode: 'passthrough', apiKey: passThroughKey };
  }

  return { ok: false, reason: 'unauthorized' };
}

function requireGatewayAuth(req, res, db) {
  const auth = authorizeGateway(req, db);
  if (!auth.ok) {
    res.status(401).json({
      schema: 'smsbazaar.gateway.v1',
      status: 'error',
      code: 'unauthorized',
      message: '需要管理员登录、GATEWAY_API_TOKEN 或上游 api_key',
    });
    return null;
  }
  return auth;
}

module.exports = {
  authorizeGateway,
  requireGatewayAuth,
};
