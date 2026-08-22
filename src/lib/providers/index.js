'use strict';

const heroSms = require('./hero-sms');
const smsbower = require('./smsbower');
const fivesim = require('./fivesim');
const nexsms = require('./nexsms');
const grizzlysms = require('./grizzlysms');
const smsVerificationNumber = require('./sms-verification-number');
const smspool = require('./smspool');
const onlinesim = require('./onlinesim');
const smspva = require('./smspva');
const codesverify = require('./codesverify');
const smscode = require('./smscode');
const smsRooms = require('./sms-rooms');
const smsBus = require('./sms-bus');
const vibeSms = require('./vibe-sms');

const providers = {
  'hero-sms': heroSms,
  smsbower,
  '5sim': fivesim,
  nexsms,
  grizzlysms,
  'sms-verification-number': smsVerificationNumber,
  smspool,
  onlinesim,
  smspva,
  codesverify,
  smscode,
  'sms-rooms': smsRooms,
  'sms-bus': smsBus,
  'vibe-sms': vibeSms,
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
