// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.



/**
 * @constructor
 *
 * Sets up Geolocation manager component, which can poll the current location
 * and forward that on to the plugin as desired by the runtime code.
 *
 * @param plugin Plugin object reference.
 */
function GeoLocationManager(plugin) {
  /** @private */
  this.plugin_ = plugin;

  /** @private */
  this.interval_ = 0;

  /** @private */
  this.timer_ = 0;

  plugin.addMessageListener('jsGeolocation', this.handleMessage_.bind(this));
}


/**
 * @private
 *
 * Converts a position update from the Chrome API into a notification to the
 * plugin.
 *
 * @param position Geolocated position received from the API.
 */
GeoLocationManager.prototype.updatePosition_ = function(position) {
  // Geo location tracking is disabled.
  if (this.interval_ == 0)
    return;

  var message = {
    namespace: 'androidGeolocation',
    command: 'report',
    data: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp
    }
  };

  this.plugin_.postMessage(message);

  this.timer_ = setTimeout(
      this.requestPosition_.bind(this), this.interval_);
};


/**
 * @private
 *
 * Converts an error message from the Chrome API into a notification sent to the
 * plugin.
 *
 * @param error Error message received from the Chrome API.
 */
GeoLocationManager.prototype.reportError_ = function(error) {
  // Geo location tracking is disabled.
  if (this.interval_ == 0)
    return;

  var error_str;
  var permanent = 0;
  switch (error.code) {
    case error.PERMISSION_DENIED:
      error_str = 'Permission denied: ' + error.message;
      permanent = 1;
      break;
    case error.POSITION_UNAVAILABLE:
      error_str = 'Position unavailable: ' + error.message;
      break;
    case error.TIMEOUT:
      error_str = 'Request timed out: ' + error.message;
      break;
    default:
      error_str = 'Unknown error: ' + error + ' / ' + error.message;
      break;
  }

  var message = {
    namespace: 'androidGeolocation',
    command: 'error',
    data: {
      permanent: permanent,
      text: error_str
    }
  };

  this.plugin_.postMessage(message);

  // TODO(crbug.com/244546): Slow down the retries in case of errors.
  this.timer_ = setTimeout(
      this.requestPosition_.bind(this), this.interval_);
};


/**
 * @private
 *
 * Makes the call to get the current position from the Chrome geolocation API.
 *
 * @param position last known position (unused)
 */
GeoLocationManager.prototype.requestPosition_ = function(position) {
  navigator.geolocation.getCurrentPosition(
      this.updatePosition_.bind(this), this.reportError_.bind(this));
};


/**
 * @private
 *
 * Starts periodically requesting the current geolocation from the geolocation
 * API.
 *
 * @param interval Polling interval for position updates.
 */
GeoLocationManager.prototype.startTracking_ = function(interval) {
  var isRunning = (this.interval_ != 0);
  this.interval_ = interval > 0 ? interval : 5000;
  if (!isRunning) {
    this.requestPosition_();
  } else {
    if (this.timer_) {
      // Stop the previous timer and request position again.
      clearTimeout(this.timer_);
      this.timer_ = 0;
      this.requestPosition_();
    }
  }
};


/** @private */
GeoLocationManager.prototype.stopTracking_ = function() {
  this.interval_ = 0;
  if (this.timer_ != 0) {
    clearTimeout(this.timer_);
    this.timer_ = 0;
  }
};


/**
 * @private
 *
 * Receives a message from the plugin, and converts it into a request on the
 * geolocation API.
 *
 * @param message Message from the plugin to handle.
 */
GeoLocationManager.prototype.handleMessage_ = function(message) {
  if (message.command == 'start') {
    var interval =
        (message.data && message.data.interval) ? message.data.interval : 0;
    this.startTracking_(interval);
  } else if (message.command == 'stop') {
    this.stopTracking_();
  } else {
    console.log('Unknown geolocation command[' + message.command + ']');
  }
};
