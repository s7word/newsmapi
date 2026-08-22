'use strict';

const heroSms = require('./hero-sms');
const smsbower = require('./smsbower');
const fivesim = require('./fivesim');
const nexsms = require('./nexsms');
const grizzlysms = require('./grizzlysms');
const smsVerificationNumber = require('./sms-verification-number');
const smspool = require('./smspool');

const providers = {
  'hero-sms': heroSms,
  smsbower,
  '5sim': fivesim,
  nexsms,
  grizzlysms,
  'sms-verification-number': smsVerificationNumber,
  smspool,
};

function getProvider(providerKey) {
  const provider = providers[providerKey];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerKey}`);
  }
  return provider;
}

module.exports = {
  getProvider,
  providers,
};
