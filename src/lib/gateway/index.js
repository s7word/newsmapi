'use strict';

const gatewayService = require('./gateway-service');
const protocolRegistry = require('./protocol-registry');
const auth = require('./auth');
const activateBridge = require('./activate-bridge');

module.exports = {
  ...gatewayService,
  ...protocolRegistry,
  ...auth,
  ...activateBridge,
};
