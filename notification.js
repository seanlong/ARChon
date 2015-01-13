// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Notification javascript code.


/** @const */
var notifications = chrome.notifications;



/**
 * @constructor
 *
 * Sets up a component to handle notification messages from the runtime,
 * translating them to Chrome notifications.
 *
 * @param plugin Plugin instance.
 */
function NotificationManager(plugin) {
  if (!notifications)
    return;

  /** @private */
  this.activeIds_ = {};

  /** @private */
  this.plugin_ = plugin;

  notifications.onClosed.addListener(this.postMessage_.bind(this, 'onClosed'));
  notifications.onClicked.addListener(this.onClicked_.bind(this));
  notifications.onButtonClicked.addListener(
      this.postMessage_.bind(this, 'onButtonClicked'));

  plugin.addMessageListener('jsNotification', this.handleMessage_.bind(this));
}

/**
 * @private
 *
 * Handles notification being clicked.
 *
 * @param id A string to identify this notification.
 */

NotificationManager.prototype.onClicked_ = function(id) {
  // Restore and raise the app window when a notification is clicked.
  this.plugin_.showWindow();
  this.postMessage_('onClicked', id, null);
};


/**
 * @private
 *
 * Posts a notification.
 *
 * @param command Notification command to post.
 * @param id A string to identify this notification.
 * @param extra Extra data for this notification.
 */
NotificationManager.prototype.postMessage_ = function(command, id, extra) {
  var message = {
    namespace: 'androidNotification',
    command: command,
    data: {
      id: id,
      extra: extra
    }
  };
  this.plugin_.postMessage(message);
};


/**
 * @private
 *
 * Determines the configuration of the Chrome notification from the request.
 *
 * @param message Source notification request message to use.
 * @return The equivalent Chrome notification options structure.
 */
NotificationManager.prototype.getOptionsFromMessage_ = function(message) {
  // TODO(crbug.com/350031): Just return the notification object once we
  // either are not getting String objects in it, or Chrome apps functions
  // take String objects.
  return JSON.parse(JSON.stringify(message.data.notification));
};


/**
 * @private
 *
 * Adds a Chrome notification based on a request message.
 *
 * @param message Source notification request message to use.
 */
NotificationManager.prototype.addNotification_ = function(message) {
  var id = message.data.id.valueOf();
  this.activeIds_[id] = true;
  var options = this.getOptionsFromMessage_(message);
  notifications.create(id, options, function() {});
};


/**
 * @private
 *
 * Updates a Chrome notification based on a request message.
 *
 * @param message Source notification request message to use.
 */
NotificationManager.prototype.updateNotification_ = function(message) {
  var id = message.data.id.valueOf();
  var options = this.getOptionsFromMessage_(message);
  notifications.update(id, options, function() {});
};


/**
 * @private
 *
 * Removes a Chrome notification based on a request message.
 *
 * @param id Notification id to remove.
 */
NotificationManager.prototype.removeNotification_ = function(id) {
  delete this.activeIds_[id];
  notifications.clear(id, function() {});
};


/**
 * @public
 *
 * Cleans up all active notifications upon destroying the notification manager.
 *
 */
NotificationManager.prototype.destroy = function() {
  var activeIds = [];
  // Make a copy of this.activeIds_ before iterating over it and calling
  // removeNotification which will remove items from this.activeIds_.
  for (var id in this.activeIds_) activeIds.push(id);
  for (var i = 0; i < activeIds.length; ++i) {
    this.removeNotification_(activeIds[i]);
  }
};


/**
 * @private
 *
 * Dispatcher for all requests to the notification component.
 *
 * @param {Message} message Notification message to handle.
 */
NotificationManager.prototype.handleMessage_ = function(message) {
  if (message.command == 'addNotification') {
    this.addNotification_(message);
  } else if (message.command == 'updateNotification') {
    this.updateNotification_(message);
  } else if (message.command == 'removeNotification') {
    this.removeNotification_(message.data.id.valueOf());
  } else {
    console.log('Unknown notification command[' + message.command + ']');
  }
};
