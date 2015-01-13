// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Pepper child_plugin plugin javascript code.

var childPlugins = [];



/**
 * @constructor
 *
 * Sets up a plugin component to emulate an Android process.
 *
 * @param container Containing document object.
 * @param data Requesting child process information.
 * @param handleExitMessage Callback to handle exit message.
 * @param handleStdoutMessage Callback to handle stdout message.
 * @param handleStderrMessage Callback to handle stdout message.
 */
function ChildPlugin(container,
                     data,
                     handleExitMessage,
                     handleStdoutMessage,
                     handleStderrMessage) {
  this.active = true;

  /** @private */
  this.args_ = data.args;

  /** @private */
  this.backgroundPage_ = null;

  /** @private */
  this.command_ = data.plugin;

  /** @private */
  this.container_ = container;

  /** @private */
  this.currentWorkingDirectory_ = data.currentworkingdirectory;

  /** @private */
  this.envs_ = data.envs;

  /** @private */
  this.handleExitMessage_ = handleExitMessage;

  /** @private */
  this.handleStderrMessage_ = handleStderrMessage;

  /** @private */
  this.handleStdoutMessage_ = handleStdoutMessage;

  /** @private */
  this.loaded_ = false;

  /** @private */
  this.plugin_ = null;

  // |preopened_fd_args_| and |preopened_fd_names_| are used to open
  // some files ahead of child process launch, and replace arguments
  // with opened descriptor numbers. This is to emulate what would have
  // happened if the plugin was forked from a parent process with these
  // files open.
  // 'data': {
  //   'preopened_fd_args': [ '$fd', null ],
  //   'preopened_fd_names': [ '/foo/bar.txt', null ],
  //   'plugin': 'dalvikvm',
  //   'args': [ '--baz', '$fd' ]
  //   'envs': [ 'FOO=foo', 'BAR=bar' ]
  // }
  // In this example, ChildPluginInstance open '/foo/bar.txt', and launch
  // 'dalvikvm' with argument '--baz' and '3'. The last number is the
  // file descriptor number which is bound to '/foo/bar.txt'.
  /** @private */
  this.preopened_fd_args_ = data.preopened_fd_args;

  /** @private */
  this.preopened_fd_names_ = data.preopened_fd_names;

  /** @private */
  this.requestId_ = data.requestid;

  /** @private */
  this.requester_ = data.requester;

  /** @private */
  this.timeoutId_ = null;

  /** @private */
  this.timeout_ = 2;

  this.create_();
}


/** @private */
ChildPlugin.prototype.create_ = function() {
  var metadata = arcMetadata.get();
  this.plugin_ = document.createElement('embed');
  this.plugin_.setAttribute('src', 'arc.nmf');
  this.plugin_.setAttribute('type', 'application/x-nacl');
  this.plugin_.setAttribute('plugintype', this.command_);
  if (this.currentWorkingDirectory_)
    this.plugin_.setAttribute('current_working_directory',
                              this.currentWorkingDirectory_);
  this.plugin_.setAttribute('args', this.args_.join(_STRING_DELIMITER));
  if (this.envs_) {
    this.plugin_.setAttribute('envs', this.envs_.join(_STRING_DELIMITER));
  }
  if (this.preopened_fd_args_ && this.preopened_fd_names_) {
    this.plugin_.setAttribute('preopened_fd_args',
                              this.preopened_fd_args_.join(_STRING_DELIMITER));
    this.plugin_.setAttribute('preopened_fd_names',
                              this.preopened_fd_names_.join(_STRING_DELIMITER));
  }
  this.plugin_.setAttribute('requestid', this.requestId_);
  this.plugin_.setAttribute('requester', this.requester_);

  // TODO(crbug.com/390063): Factor out a function which copies data
  // from metadata to attributes
  // Child plugin will run a command, e.g., dalvikvm, dexopt, and so on.
  // They never need a screen.
  this.plugin_.setAttribute('width', 0);
  this.plugin_.setAttribute('height', 0);
  this.plugin_.setAttribute('packagename', metadata.packageName);
  this.plugin_.setAttribute('stderrlog', metadata.stderrLog);
  this.plugin_.setAttribute('enablearcstrace', metadata.enableArcStrace);
  // TODO(crbug.com/327980): Make it possible to set timezone dynamically
  // when Chrome changes timezone.
  this.plugin_.setAttribute('timezone', getTimeZone());
  var locale = getLocale();
  this.plugin_.setAttribute('language', locale.language);
  if (locale.country)  // Country code is optional.
    this.plugin_.setAttribute('country', locale.country);

  // Enable stdio bridge only in system mode.
  if (metadata.packageName == 'org.chromium.arc.system')
    this.plugin_.setAttribute('enable_stdio_bridge', true);

  console.time('ChildPlugin ' + this.requester_ + ':' + this.requestId_ +
               ':' + this.args_[0] + '(' + this.command_ + ') Run');
  this.container_.appendChild(this.plugin_);

  this.plugin_.addEventListener(
      'message', this.handleMessageEvent_.bind(this), false);
  this.plugin_.addEventListener('crash', function(crashEvent) {
    this.postExitMessage_(this.createExitMessage_(-1),
                          'Plugin process crashed');
  }.bind(this), false);
  this.timeoutId_ = setTimeout(function() {
    this.timeoutId_ = null;
    if (this.loaded_)
      return;
    var container = this.container_;
    this.remove('timeout to spawn ChildPlugin process: ' + this.args_[0] + '(' +
                this.command_ + '), ' + this.args_.join(' '));
    if (this.timeout_ >= 32) {
      console.error('give up to spawn ChildPlugin process.');
      // Usually, src/plugin/child_plugin_instance.cc sends this message,
      // but when the child plugin is timed out, this code takes care of
      // sending the exit message.
      // Potentially, sending the message has a race issue since the
      // child plugin instance may start asynchronously. In that case,
      // the second message is just ignored. See also mods/android/
      // frameworks/base/arc/java/org/chromium/arc/shell/
      // ChildPluginProcess.java.
      this.postExitMessage_(this.createExitMessage_(-1));
      return;
    }
    this.timeout_ *= 2;
    console.log('retry to spawn with timeout ' + this.timeout_ + 'sec.');
    this.active = true;
    this.container_ = container;
    this.create_();
  }.bind(this), this.timeout_ * 1000);
  if (window['arc'])
    this.backgroundPage_ = window['arc'].backgroundPage;
  else
    this.backgroundPage_ = window;
};


/** @private */
ChildPlugin.prototype.handleMessageEvent_ = function(messageEvent) {
  if (!this.active) {
    // The plugin process had already been removed.
    return;
  }
  // Check primitive messages firstly.
  var message = messageEvent.data;
  console.log(message);

  if (message.constructor == ArrayBuffer) {
    // Assume all ArrayBuffers are minidumps.
    this.backgroundPage_.crashReporter.reportCrash(
        'minidump on ' + this.command_, message);
    return;
  }

  // Handle plugin message.
  if (message.namespace == 'jsPlugin') {
    if (message.command == 'loadResult') {
      if (message.data.result) {
        var command = this.command_;
        if (this.args_.length > 0) {
          command += '/' + this.args_[0];
        }
        console.log('the child process has been loaded: ' + command);
        this.loaded_ = true;
      } else {
        this.remove('Cannot load plugin process');
      }
      return;
    } else if (message.command == 'crashLogMessage') {
      // This is only handled by the main plugin. Ignore.
      return;
    }
  }

  if (message.namespace != 'jsChildplugin') {
    this.remove('Received invalid namespace message. ' +
                'Namespace: "' + message.namespace + '", ' +
                'Command: "' + message.command + '"');
    return;
  }

  if (message.command == 'spawn') {
    // ChildPlugin may spawn another ChildPlugin, e.g., dalvikvm may spawn
    // dexopt.
    ChildPlugin.handleChildPluginMessage(
        message,
        this.plugin_.postMessage.bind(this.plugin_),
        this.handleStdoutMessage_,
        this.handleStderrMessage_);
  } else if (message.command == 'stdout') {
    // Redirect stdout message to androidChildplugin.
    message.namespace = 'androidChildplugin';
    // Bypass stdout to the ChildPlugin owner process.
    if (this.handleStdoutMessage_)
      this.handleStdoutMessage_(message);
  } else if (message.command == 'stderr') {
    // Redirect stderr message to androidChildplugin.
    message.namespace = 'androidChildplugin';
    // Bypass stderr to the ChildPlugin owner process.
    if (this.handleStderrMessage_)
      this.handleStderrMessage_(message);
  } else if (message.command == 'exit') {
    // Notify the caller and shut down the ChildPlugin process.
    // Call remove() first to work around crbug.com/386312.
    message.namespace = this.requester_;
    this.postExitMessage_(message);
  } else {
    this.remove('Received unknown childplugin command: ' + message.command);
  }

};


/** @private */
ChildPlugin.prototype.postExitMessage_ = function(message, error) {
  if (this.remove(error))
    this.handleExitMessage_(message);
};


/** @private */
ChildPlugin.prototype.createExitMessage_ = function(exitCode) {
  return {
    namespace: 'androidChildplugin',
    command: 'exit',
    data: {
      requestid: this.requestId_,
      requester: this.requester_,
      result: exitCode
    }
  };
};


/**
 * Removes the child plugin process, and optionally displays an error message.
 *
 * @param errorString optional error message to display.
 * @return {boolean} False if the process is alread removed.
 */
ChildPlugin.prototype.remove = function(errorString) {
  if (!this.active) {
    // The plugin process had already been removed.
    return false;
  }
  this.active = false;
  if (this.timeoutId_) {
    clearTimeout(this.timeoutId_);
    this.timeoutId_ = null;
  }
  console.timeEnd('ChildPlugin ' + this.requester_ + ':' + this.requestId_ +
                  ':' + this.args_[0] + '(' + this.command_ + ') Run');
  if (errorString) {
    console.log(errorString);
  }
  this.container_.removeChild(this.plugin_);
  this.container_ = null;
  this.plugin_ = null;
  childPlugins = childPlugins.filter(function(instance) { instance != this; });
  return true;
};


/**
  * Handle childplugin spawn message to spawn a ChildPlugin instance.
  */
ChildPlugin.handleChildPluginMessage = function(message,
                                                handleExitMessage,
                                                handleStdoutMessage,
                                                handleStderrMessage) {
  if (message.command == 'spawn') {
    childPlugins.push(new ChildPlugin(
        document.getElementById('appdiv'),
        message.data,
        handleExitMessage,
        handleStdoutMessage,
        handleStderrMessage));
  } else {
    console.log('Received unknown childplugin message: ');
    console.log(message);
  }
};
