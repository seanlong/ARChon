/**
 * @fileoverview
 *
 * GcmManager bridges chrome.gcm and Android GCM service.  The instance stays in
 * background page so that it can pass messages to the app even if the app is
 * not launched.
 *
 * "gcm" permission in manifest.json must be declared to access chrome.gcm API.
 * Also, if the user is not signed-in, the API will fail by putting error in
 * chrome.runtime.lastError.
 */


function gcmServicesEnabled() {
  var services = arcMetadata.data_.usePlayServices;
  return services && services.indexOf('gcm') >= 0;
}


function GcmManager() {
}


/** @public */
GcmManager.prototype.handleGcmRequest = function(message, plugin) {
  if (!gcmServicesEnabled() || chrome.gcm === undefined) {
    console.warn('Received GCM request while not supported');
    return;
  }

  if (message.command == 'register') {
    this.register_(message.data.senderIds, plugin);
  } else if (message.command == 'unregister') {
    this.unregister_(plugin);
  } else if (message.command == 'send') {
    this.send_(message);
  } else {
    console.warn('Received unknown GCM message: ' + message);
  }
};


/** @private */
GcmManager.prototype.getPlugin_ = function() {
  if (appWindow && appWindow.contentWindow)
    return appWindow.contentWindow.plugin;
  return null;
};


/**
 * @private
 * @param senderIds Array of string
 * @param appPlugin plugin instance
 */
GcmManager.prototype.register_ = function(senderIds, appPlugin) {
  if (!senderIds) {
    console.error('No senderIds', senderIds);
    return;
  }

  chrome.gcm.register(senderIds.split(','), (function(registrationId) {
    var json = {
      'namespace': 'androidGcm',
      'data': {}
    };

    if (chrome.runtime.lastError) {
      console.log('Failed to register gcm: ' +
          chrome.runtime.lastError.message);
      json.command = 'registerError';
      json.data.error =
          this.convertToAndroidError_(chrome.runtime.lastError.message);
    } else {
      json.command = 'registerSuccess';
      json.data.registrationId = registrationId;
    }
    appPlugin.postMessage(json);
  }).bind(this));
};


/**
 * @private
 * @param appPlugin plugin instance
 */
GcmManager.prototype.unregister_ = function(appPlugin) {
  chrome.gcm.unregister((function() {
    var json = {
      'namespace': 'androidGcm',
      'data': {}
    };
    if (chrome.runtime.lastError) {
      console.error('Error happened on unregister: ' +
          chrome.runtime.lastError.message);
      json.command = 'unregisterError';
      json.data.error =
          this.convertToAndroidError_(chrome.runtime.lastError.message);
    } else {
      json.command = 'unregisterCallback';
    }
    appPlugin.postMessage(json);
  }).bind(this));
};


/**
 * @private
 * @param message message to send
 */
GcmManager.prototype.send_ = function(message) {
  var data = message.data;
  var json = {
    'destinationId': data['google.to'],
    'messageId': data['google.message_id'],
    'timeToLive': data['google.ttl'],
    'data': {}
  };

  for (var key in data) {
    if (key.indexOf('google') == 0 || key.indexOf('goog.') == 0)
      continue;
    json.data[key] = data[key];
  }

  chrome.gcm.send(json, (function(messageId) {
    if (chrome.runtime.lastError) {
      var error = this.convertToAndroidError_(chrome.runtime.lastError.message);
      this.onMessageInternal_('sendError', {
        'errorMessage': error,
        'messageId': messageId
      });
    }
  }).bind(this));
};


/** @private */
GcmManager.prototype.onMessageInternal_ = function(message_type, opt_data) {
  var json = {
    'namespace': 'androidGcm',
    'command': message_type,
    'data': {}
  };
  if (opt_data)
    json.data = opt_data;

  try {
    var plugin = this.getPlugin_();
    if (!plugin) {
      // If the app is not launched, we need to launch it in a hidden window.
      // TODO(crbug.com/316727): implement this.
      console.log('Background mode is not yet supported');
    } else {
      plugin.postMessage(json);
    }
  } catch (e) {
    console.error('Error sending the message into plugin: ' + e);
  }
};


/** @private */
GcmManager.prototype.convertToAndroidError_ = function(error_str) {
  // Error strings for chrome.gcm are defined in
  //   https://developer.chrome.com/apps/cloudMessagingV2#error_reference
  // and chrome/browser/extensions/api/gcm/gcm_api.cc. Android's are defined in
  //   http://developer.android.com/reference/com/google/android/gcm/GCMConstants.html
  var converter = {
    'Function was called with invalid parameters.': 'INVALID_PARAMETERS',
    'Profile was not signed in.': 'ACCOUNT_MISSING',
    // Good mapping is not available. Return INVALID_PARAMETERS.
    'Manifest key was missing.': 'INVALID_PARAMETERS',
    // Same. Return SERVICE_NOT_AVAILABLE.
    'Asynchronous operation is pending.': 'SERVICE_NOT_AVAILABLE',
    'Network error occurred.': 'SERVICE_NOT_AVAILABLE',
    'Server error occurred.': 'SERVICE_NOT_AVAILABLE',
    // Same.
    'Time-to-live exceeded.': 'SERVICE_NOT_AVAILABLE',
    // Same.
    'Unknown error occurred.': 'SERVICE_NOT_AVAILABLE'
  };

  var converted = converter[error_str];
  if (converted)
    return converted;

  console.error('chrome.gcm: unexpected error string: ' + error_str);
  var default_error = 'SERVICE_NOT_AVAILABLE';
  return default_error;
};


/** @public */
GcmManager.prototype.onMessage = function(message) {
  this.onMessageInternal_('receive', message.data);
};


/** @public */
GcmManager.prototype.onMessagesDeleted = function() {
  this.onMessageInternal_('deletedMessages');
};


/** @public */
GcmManager.prototype.onSendError = function(error) {
  this.onMessageInternal_('sendError', error);
};


var gcm = null;

if (gcmServicesEnabled() && chrome.gcm) {
  gcm = new GcmManager();

  chrome.gcm.onMessage.addListener(gcm.onMessage.bind(gcm));
  chrome.gcm.onMessagesDeleted.addListener(gcm.onMessagesDeleted.bind(gcm));
  chrome.gcm.onSendError.addListener(gcm.onSendError.bind(gcm));
}
