// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Shell javascript code.



/**
 * @constructor
 *
 * Sets up a component interface for interacting with a shell.
 *
 * @param plugin Plugin instance.
 */
function Shell(plugin) {
  /** @private */
  this.plugin_ = plugin;

  /** @private */
  this.nextId_ = 0;

  /** @private */
  this.sessions_ = {};

  plugin.addMessageListener('jsShell', this.handleMessage_.bind(this));
}


/**
 * @public
 *
 * Passes a command to the shell, and handles getting back the response/output.
 *
 * @param commandLine Commandline to run.
 * @param onDataCallback Called to handle data returned from the
 * shell.
 * @param onClosedCallback Called when the shell connection is
 * closed.
 * @return Session object.
 **/
Shell.prototype.shell = function(
    commandLine, onDataCallback, onClosedCallback) {
  var id = this.nextId_++;
  var session = {
    id_: id,
    onDataCallback_: onDataCallback,
    onClosedCallback_: onClosedCallback
  };
  session.close = this.close_.bind(this, session);

  this.sessions_[id] = session;

  var message = {
    namespace: 'androidShell',
    command: 'open',
    data: {
      id: id,
      commandLine: commandLine
    }
  };
  this.plugin_.postMessage(message);

  return session;
};


/**
 * @private
 *
 * Closes the shell session.
 *
 * @param session Session to close.
 **/
Shell.prototype.close_ = function(session) {
  var message = {
    namespace: 'androidShell',
    command: 'close',
    data: {
      id: session.id_
    }
  };
  this.plugin_.postMessage(message);
};


/**
 * @private
 *
 * Internal handler for shell output. Dispatches to the correct callback
 * registered for the specific command it was in response to.
 *
 * @param message Output from the shell.
 */
Shell.prototype.handleMessage_ = function(message) {
  console.assert(message.namespace == 'jsShell');
  var session = this.sessions_[message.data.id];
  console.assert(session);

  if (message.command == 'close') {
    delete this.sessions_[session.id_];
    if (session.onClosedCallback_ != undefined) {
      session.onClosedCallback_(session);
    }
  } else if (message.command == 'data') {
    if (session.onDataCallback_ != undefined) {
      session.onDataCallback_(session, message.data.data);
    } else {
      console.log(message.data.data.valueOf());
    }
  }

};
