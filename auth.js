// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Handler of authentication to Chrome.



/**
 * @constructor
 *
 * This class handles authentication related messages.
 *
 * @param plugin Plugin object reference.
 */
function AuthManager(plugin) {
  /** @private */
  this.plugin_ = plugin;

  plugin.addMessageListener('jsChromeIdentity',
                            this.handleAuthMessage_.bind(this));
}


/**
 * @private
 *
 * Parse scope string from the app.
 *
 * @param {string} tokenType The scope string requested by the app.
 * @return {Array.<string>} Parsed scopes.
 * @private
 */
AuthManager.prototype.parseScope_ = function(tokenType) {
  // Translate tokenType for chrome.identity.  There are several possible
  // format of tokenType.  For illustration purpose, OAuth2 scopes will be
  // referred as SCOPE-1, SCOPE-2, and client id will be CLIENT_ID.
  //
  // 1. Get token for app itself to use.  Example of tokenType:
  //      "oauth2:SCOPE-1 SCOPE-2"
  //
  // 2. Get token for server app to use offline.  Example of tokenType:
  //      "oauth2:server:client_id:CLIENT_ID:api_scope:SCOPE-1 SCOPE-2"
  //
  // 3. Get token for server app to use.  Example of tokenType:
  //      "audience:server:client_id:CLIENT_ID:api_scope:SCOPE-1 SCOPE-2"
  //
  // 4. Others.  There might be unrecognized/private scopes for com.google
  //    authenticator.  There is no public API support.
  //
  // Only case 1 is recognized now.  All other cases should fallback to scopes
  // declared in manifest.json.
  //
  // TODO(crbug.com/388368): implement case 2 and 3 when chrome.identity
  // supports them.
  var OAUTH2_PREFIX = 'oauth2:';
  if (tokenType && tokenType.indexOf(OAUTH2_PREFIX) == 0 &&
      tokenType.indexOf(':server:client_id:') < 0) {
    return tokenType.substring(OAUTH2_PREFIX.length).split(' ');
  }
  return [];
};


/** @private */
AuthManager.prototype.handleGetAuthToken_ = function(message) {
  console.log('Authentication requested', message);

  var reply = (function(data) {
    var responseMessage = {
      namespace: 'androidIdentity',
      command: 'getAuthTokenResponse',
      data: data
    };
    this.plugin_.postMessage(responseMessage);
  }).bind(this);

  var options = { 'interactive': true };
  var scopes = this.parseScope_(message.data.tokenType);
  if (scopes.length > 0) {
    options.scopes = scopes;
  }

  // This call will pop up a window to ask user for permission to grant
  // permissions of the given OAuth2 scopes, or declared scopes in
  // manifest.json as a fallback.
  //
  // For non-signed-in Chrome session, this will open up a window to ask the
  // user to sign in to Chrome first.
  PromiseWrap.getAuthToken(options).then(function(token) {
    console.log('Authentication successful');
    reply({token: token});
  }, function(error) {
    console.error('Authentication error', error);
    reply({error: error.message});
  });
};


/** @private */
AuthManager.prototype.handleInvalidateAuthToken_ = function(message) {
  var reply = (function(data) {
    var responseMessage = {
      namespace: 'androidAccountManagerService',
      command: 'invalidateAuthTokenResponse',
      data: data
    };
    this.plugin_.postMessage(responseMessage);
  }).bind(this);

  var token = message.data.token;
  PromiseWrap.removeCachedAuthToken({token: token}).then(function() {
    console.log('Removed cached auth token', token);
    reply({});
  }, function(error) {
    console.error('Error occurred when removing auth token', error);
    reply({error: error.message});
  });
};


/** @private */
AuthManager.prototype.handleAuthMessage_ = function(message) {
  if (message.command == 'getAuthToken') {
    this.handleGetAuthToken_(message);
  } else if (message.command == 'invalidateAuthToken') {
    this.handleInvalidateAuthToken_(message);
  }
};
