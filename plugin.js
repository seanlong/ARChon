// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Pepper plugin javascript code.


console.time('ARC JS Init');
var __page_begin_date = new Date();


/** @const */
var _NACL_HEARTBEAT_PERIOD = 30000;  // 30s
var _TRUSTED_HEARTBEAT_PERIOD = 10000;  // 10s.  See also crbug.com/333945.
// If we crash after this time has passed, restart the app.
var _CRASH_RESTART_THRESHOLD = 10000;  // 10s.


/** @const
 * These values correspond to UMA values, which is why they are constant
 * variables instead of literal constants in code.  Be very careful when
 * changing these.
 */
var _BOOT_STEP_NO_INIT = 0;
var _BOOT_STEP_JAVASCRIPT_INITIALIZED = 1;
var _BOOT_STEP_APP_INSTANCE_STARTED = 2;
var _BOOT_STEP_PACKAGE_DEXOPTED = 3;
var _BOOT_STEP_SYSTEM_SERVER_STARTED = 4;
var _BOOT_STEP_DONE = 5;
var _MAX_BOOT_STEP = 5;


/** @const
 *
 * The prefix used for perf log messages sent from ARC.
 *
 */
var _PERF_LOG_PREFIX = 'perf: ';

function basename(path) {
  return path.replace(/.*\//g, '');
}


function getUptime() {
  return new Date().getTime() - __page_begin_date.getTime();
}


/**
 * @constructor
 *
 * Sets up a component to track the state of the plugin.
 *
 * @param times dictionary containing performance statistics.
 */
/* TODO(kmixter): This Plugin class should be refactored into a Window class
 * (handling things related to the window itself), containing
 * factored out WindowDecorations, BootBar, Plugin, FileSystemPrefetcher class.
 * We probably also want to make each kind of message listener
 * (ie handleDisplayMessage_) its own class.
 */
function Plugin(times) {
  /** @private */
  this.shellCommands_ = [];

  /** @private */
  this.audioTrack_ = null;
  this.videoTrack_ = null;

  /**
   * True if we are loading APK from a URL.
   * @private
   */
  this.isLoadingApk_ = false;

  /** @private */
  this.backButtonEnabled_ = false;

  /** @private */
  this.backgroundPage_ = null;

  /** @private */
  this.currentBootStep_ = 0;

  /** @private */
  this.cachedRotation_ = 0;

  /** @private */
  this.crashExtraInformation_ = {};

  /** @private */
  this.crashReportReceived_ = false;

  /** @private */
  this.hasSeenOnResume_ = false;

  /** @private */
  this.initialized_ = false;

  /** @private */
  this.initializing_ = false;

  /** @private */
  this.isWindowInitialized_ = false;

  /** @private */
  this.isFocusedWindow_ = true;  // 'active' buttons are shown by default.

  /** @private */
  this.messageListeners_ = {};

  /** @private */
  this.metadata_ = {};

  /** @private */
  this.reportedShutdown_ = false;

  /** @private */
  this.rotation_ = 0;

  /** @private */
  this.previousZoom_ = 1.0;

  // These managers must be constructed after messageListeners_.

  /**
   * @private
   * @suppress {unusedPrivateMembers}
   */
  this.geoLocationManager_ = new GeoLocationManager(this);

  /**
   * @private
   * @suppress {unusedPrivateMembers}
   */
  this.memoryMapViewer_ = null;

  /**
   * @private
   * @suppress {unusedPrivateMembers}
   */
  this.fileSystemManager_ = new FileSystemManager(this, (function() {
    if (this.initialized_) {
      this.initializeWindow_();
    } else {
      // We do not initialize the app window until the plugin is initialized.
      this.onInitialized_ = self.initializeWindow_.bind(self);
    }
  }).bind(this));

  /**
   * @private
   * @suppress {unusedPrivateMembers}
   */
  this.notificationManager_ = new NotificationManager(this);

  /**
   * @private
   * @suppress {unusedPrivateMembers}
   */
  this.authManager_ = new AuthManager(this);

  /** @private */
  this.shellManager_ = new Shell(this);

  /** @private */
  this.appPlugin_ = null;

  /** @private */
  this.appPluginReady_ = false;

  /** @private */
  this.times_ = times;

  /** @private */
  this.pressedButton_ = null;

  /** @private */
  this.topbar_ = null;

  /** @private */
  this.waitingForHeartbeat_ = false;

  /** @private */
  this.heartbeatInterval_ = null;

  /** @private */
  this.pluginIsRemoved_ = false;

  /** @private */
  this.photoBooth_ = new PhotoBooth(this);

  // Note: Consider loading the following handlers lazily to improve
  // startup time. For now, they do not impact performance much.
  this.addMessageListener('jsChildplugin',
                          this.handleChildPluginMessage_.bind(this));
  this.addMessageListener('jsClipboard',
                          this.handleClipboardMessage_.bind(this));
  this.addMessageListener('jsDisplay', this.handleDisplayMessage_.bind(this));
  this.addMessageListener('jsHeartbeat',
                          this.handleHeartbeatMessage_.bind(this));
  this.addMessageListener('jsBrowser', this.handleBrowserMessage_.bind(this));
  this.addMessageListener('jsSystem', this.handleSystemMessage_.bind(this));
  this.addMessageListener('jsGcm', this.relayGcmMessage_.bind(this));
  this.addMessageListener('mediaStream',
                          this.handleMediaStreamMessage_.bind(this));

  this.photoBooth_.addMessageListeners();

  // Enable MemoryMapViewer if --disable-debug-code is not specified.
  // See also src/packaging/config.py.
  if (typeof(MemoryMapViewer) == 'function') {
    console.log('MemoryViewer is enabled.');
    /** @private @suppress {unusedPrivateMembers} */
    this.memoryMapViewer_ = new MemoryMapViewer(this);
  }

  this.constructFromMetadata_();
}


/** @public */
Plugin.prototype.init = function() {
  // Note: In init(), we should do only cheap initialization so that the
  // renderer can create a NaCl (or PPAPI) process as quickly as possible. For
  // example, we should call neither initializeTopBar_ nor doLayout_ here. We
  // should not change elements' style either. Note that loading arc.nexe
  // and its DT_NEEDED *.so files is the most expensive operation during boot
  // and we should start it as quickly as possible.
  if (this.initialized_)
    return;
  this.initializing_ = true;
  this.createAppPlugin_();
  if (chrome.app.window) {
    var currentWindow = chrome.app.window.current();
    // Listen for changes in the window dimensions. The 'resize' event is also
    // fired when the page zoom setting is changed.
    currentWindow.contentWindow.addEventListener('resize',
        this.onResized_.bind(this));
    // chrome.runtime.onLaunched is called multiple times for some context,
    // e.g. file handler calls onLaunched with chosen file entry. To notify
    // onLaunched to already opened window, add callback to notify it.
    // https://developer.chrome.com/apps/manifest/file_handlers
    window['arc'].onRelaunched = this.onRelaunched.bind(this);
  }
  /*
  getCwsInstalled().then(function(is_cws_installed) {
    if (is_cws_installed) {
      chrome.runtime.getPlatformInfo(function(info) {
      }.bind(this));
    }
  }.bind(this));
  */
  //this.backgroundPage_ = window['arc'].backgroundPage;
  this.initializing_ = false;
};


/**
 * @public
 *
 * Posts a message to the underlying plugin code.
 *
 * @param message Message to post to the plugin.
 */
Plugin.prototype.postMessage = function(message) {
  if (!this.appPluginReady_) {
    console.error('Plugin not ready');
    return;
  }
  this.appPlugin_.postMessage(message);
};

/**
 * @private
 *
 * Creates the main window.  This does late initialization of the window
 * contents.
 */

Plugin.prototype.initializeWindow_ = function() {
  if (this.isWindowInitialized_)
    return;
  this.doLayout_(true);
  this.showWindow();
  // Install handlers to the topbar buttons.
  this.initializeTopBar_(document.getElementById('topbar'));
  this.isWindowInitialized_ = true;
};


/**
 * @public
 *
 * Adds a message listener for handling requests from the underlying plugin
 * code.
 *
 * @param namespace Namespace to listen for messages from.
 * @param callback Callback to handle the message.
 */
Plugin.prototype.addMessageListener = function(namespace, callback) {
  if (this.messageListeners_[namespace]) {
    console.log('Message[' + namespace + '] already has listener.');
  } else {
    this.messageListeners_[namespace] = callback;
  }
  if (this.appPluginReady_) {
    // Registers JavaScript namespace to plugin to obtain messages.
    // If plugin is not ready to post message, the namespace will be sent just
    // after plugin initialization.
    this.postMessage({
      namespace: 'pluginJSMessageProxy',
      command: 'registerJsNamespaces',
      data: { namespaces: [namespace] }});
  }
};


/**
 * @public
 *
 * Create a shell session in plugin with given commandLine, outputs will be
 * delivered back via given callbacks. If callbacks are not provited, the output
 * will go to chromium console.
 *
 * @param commandLine a command line string.
 * @param onDataCallback callback to handle output from the shell.
 * @param onClosedCallback callback to handle session termination.
 * @return A session object representing the shell session.
 *
 * Calling close() on the returned object can be used to close the session.
 *
 * Example:
 *    session = plugin.shell('logcat'); // start a shell session to run logcat.
 *    session.close(); // close the shell session.
 *
 *    or:
 *    session = plugin.shell('ls', onDataCallback, onClosedCallback);
 *
 */
Plugin.prototype.shell = function(
    commandLine, onDataCallback, onClosedCallback) {
  return this.shellManager_.shell(
      commandLine, onDataCallback, onClosedCallback);
};


/**
 * @private
 *
 * Schedule UMA data on the background page.  This must be done via messages
 * because the app window may be closed immediately, but we can only find out if
 * this is a release version asynchronously.
 */
Plugin.prototype.scheduleUmaOnBackgroundPage_ = function(data, opt_immediate) {
  getCwsInstalled().then(function(is_cws_installed) {
    if (is_cws_installed) {
      var message = {
        namespace: 'jsUma',
        command: 'scheduleUma',
        data: {
          uma_data: data,
          immediate: opt_immediate
        }
      };
      chrome.runtime.sendMessage(message);
    }
  });
};


/**
 * @private
 *
 * Communicate to the background page some shutdown statistics to be reported
 * by a separate UMA reporter plugin.
 */
Plugin.prototype.reportAppShutdown_ = function(is_crash) {
  // The app has shut down, so stop sending heartbeat requests to avoid
  // triggering a heartbeat failure.
  if (this.heartbeatInterval_ != null) {
    clearInterval(this.heartbeatInterval_);
    this.heartbeatInterval_ = null;
  }

  if (this.backgroundPage_ && !this.reportedShutdown_) {
    // Only report the first shutdown message.  There could be multiple messages
    // because some come from crashes, and some come from the close button.
    this.reportedShutdown_ = true;
    var uptime = getUptime();
    var uma_data = [
      'bool', 'ArcRuntime.ShutdownIsCrash', is_crash,
      'longtime', 'ArcRuntime.Uptime', uptime,
      'enumeration', 'ArcRuntime.LastBootStep',
      // enumeration histograms take the max + 1 as the bounds
      this.currentBootStep_, _MAX_BOOT_STEP + 1];
    this.scheduleUmaOnBackgroundPage_(uma_data, true /* immediate */);
  }
};


/** @private */
Plugin.prototype.getApkList_ = function() {
  if (this.apkList_ == undefined) {
    this.apkList_ = [];

    // For drive-by mode
    if (this.metadata_.apkList.length == 0) {
      // Use the synchonous version of getBackgroundPage from chrome.extension
      // instead of relying on this.backgroundPage_ which is populated
      // asynchronously.
      var bgPage = chrome.extension && chrome.extension.getBackgroundPage();
      if (bgPage && bgPage.getStreamURL) {
        this.isLoadingApk_ = true;
        var url = bgPage.getStreamURL();
        // Apk is from a URL, we need copy it into pepper file system.
        var path = '/mnt/tmp/' + basename(url) + '.apk';
        var worker = new Worker('gen_fsworker.min.js');
        worker.onmessage = (function(msg) {
          if (msg.data == 'Done') {
            this.isLoadingApk_ = false;
            if (this.onLoadingApkCompleted_)
              this.onLoadingApkCompleted_();
          }
          console.log(msg.data);
        }).bind(this);
        worker.postMessage({quota: FS_QUOTA, src: url, dest: path});
        path = '\'' + path + '\'';
        this.apkList_.push(path);
      }
    }
  }
  return this.apkList_;
};


/** @private */
Plugin.prototype.constructFromMetadata_ = function() {
  // Cache a copy of the metadata, it should not change throughout the run of
  // this plugin.
  this.metadata_ = arcMetadata.get();
  this.shellCommands_ = [];

  console.log(this.metadata_);
  // Additional packages to install.  Normally, the app apks are installed by
  // PackageManagerService during booting as we put them in
  // /vendor/chromium/crx.
  var apkList = this.getApkList_();
  for (var i = 0; i < apkList.length; ++i) {
    this.shellCommands_.push('pm', 'install ', apkList[i], ';');
  }

  if (this.metadata_.packageName == 'org.chromium.arc.system') {
    this.shellCommands_.push('echo', 'Start system mode', ';');
  } else {
    if (this.metadata_.shell.length > 0) {
      this.shellCommands_.push.apply(this.shellCommands_, this.metadata_.shell);
    } else {
      this.shellCommands_.push('echo', 'Start running', ';');

      if (window['arc'].launchArgs.items) {
        // If ARC is launched from file handlers, launches helper activity
        // instead to start activity with SEND intent.
        this.shellCommands_.push('am', 'start', '-n',
            'org.chromium.arc/.FileHandlerLaunchHelperActivity', ';');
      } else {
        // Start the main activity of the APK.  By not using the '-n' argument
        // to specify a component, am will use ACTION_MAIN and CATEGORY_LAUNCH.
        // We manually add in the FLAG_ACTIVITY_RESET_TASK_IF_NEEDED for
        // compatibility with the Android launcher.
        this.shellCommands_.push('am', 'start', '$launch',
            '--activity-reset-task-if-needed', ';');
      }
    }
  }
};


/** @private */
Plugin.prototype.onResized_ = function() {
  this.doLayout_(false);
};


/**
 * @private
 *
 * Decodes and dispatches messages from the underlying plugin code, passing it
 * on into any components that registered for the messages for a namespace.
 *
 * Handles messages from the plugin, dispatching them to any registered message
 * listeners for the namespace they are targeting.
 *
 * @param message A JSON encoded string from the plugin.
 */
Plugin.prototype.handleAppPluginMessage_ = function(message) {
  // The message should be a JSON string.
  var callback = this.messageListeners_[message.namespace.valueOf()];
  if (callback != undefined) {
    callback(message);
  } else {
    console.log('Received an unknown message:');
    console.log(message);
  }
};


/**
 * @private
 *
 * Configures the plugin object embeded in the document based on the metadata
 * for the application to run.
 *
 * @param pluginObject plugin instance.
 */
Plugin.prototype.handleAppPluginLoadAttempt_ = function(pluginObject) {
  this.appPlugin_ = pluginObject;
  // TODO(crbug.com/390063): Factor out a function which copies data
  // from metadata to attributes
  pluginObject.setAttribute('width', this.metadata_.width);
  pluginObject.setAttribute('height', this.metadata_.height);
  pluginObject.setAttribute('appwidth', this.metadata_.width);
  pluginObject.setAttribute('appheight', this.metadata_.height);
  pluginObject.setAttribute('ndkabi', this.metadata_.ndkAbi);
  pluginObject.setAttribute('packagename', this.metadata_.packageName);
  pluginObject.setAttribute('enableadb', this.metadata_.enableAdb.toString());
  pluginObject.setAttribute('useremail', window['arc'].userEmail || '');
  pluginObject.setAttribute('enableglerrorcheck',
                            this.metadata_.enableGlErrorCheck.toString());
  pluginObject.setAttribute(
      'enablesynthesizetoucheventsonwheel',
      this.metadata_.enableSynthesizeTouchEventsOnWheel.toString());
  pluginObject.setAttribute('fpslimit',
                            this.metadata_.fpsLimit.toString());
  pluginObject.setAttribute('usegooglecontactssyncadapter',
                            this.metadata_.useGoogleContactsSyncAdapter);
  pluginObject.setAttribute('useplayservices',
                            this.metadata_.usePlayServices.join(' '));
  pluginObject.setAttribute('stderrlog', this.metadata_.stderrLog);
  pluginObject.setAttribute('enablearcstrace',
                            this.metadata_.enableArcStrace);
  pluginObject.setAttribute('logloadprogress',
                            this.metadata_.logLoadProgress.toString());
  pluginObject.setAttribute('shell',
                            this.shellCommands_.join(_STRING_DELIMITER));
  pluginObject.setAttribute('jdbport', this.metadata_.jdbPort);
  pluginObject.setAttribute('applaunchtime', this.times_['app_launch_time']);
  pluginObject.setAttribute('embedtime', (new Date()).getTime());
  // TODO(crbug.com/327980): Make it possible to set timezone dynamically
  // when Chrome changes timezone.
  pluginObject.setAttribute('timezone', getTimeZone());
  // TODO(crbug.com/248918): Use window.navigator.maxTouchPoints once that
  // is available to give us more information to distinguish between having
  // hardware support for 0, 2, 5+ distinct touch points.
  pluginObject.setAttribute('touchscreen',
                            'ontouchstart' in document.documentElement);
  pluginObject.setAttribute('enableexternaldirectory',
                            this.metadata_.enableExternalDirectory);
  pluginObject.setAttribute('androiddensitydpi',
                            this.metadata_.androidDensityDpi);
  pluginObject.setAttribute('sleepOnBlur', this.metadata_.sleepOnBlur);
  var locale = getLocale();
  pluginObject.setAttribute('language', locale.language);
  if (locale.country)  // Country code is optional.
    pluginObject.setAttribute('country', locale.country);

  // Note: Embedding arc.nmf here with "data:text/plain;base64" URI is not
  // allowed by Chrome CSP for 'object-src'.
  pluginObject.setAttribute('src', 'arc.nmf');
  pluginObject.setAttribute('type', 'application/x-nacl');
  // Do not call pluginObject.setAttribute again, or the attribute you set may
  // not show up in Instance::Init in plugin code.

  if (this.pluginIsRemoved_) {
    // TODO(crbug.com/310438): Stop special-casing driveby mode and remove the
    // code. appendChild is a relatively expensive operation which triggers
    // Blink's blocking operation called document::recalcStyle.
    document.getElementById('appdiv').appendChild(pluginObject);
    this.pluginIsRemoved_ = false;
  }
  console.timeEnd('ARC JS Init');
  // Indicate that the first boot step has completed.
  this.setBootStep_(_BOOT_STEP_JAVASCRIPT_INITIALIZED);

  this.initialized_ = true;
  if (this.onInitialized_)
    this.onInitialized_();
};


/** @private */
Plugin.prototype.handleAppPluginReady_ = function() {
  this.appPluginReady_ = true;  // We can call postMessage.

  // Registers JavaScript namespace to plugin to obtain messages.
  namespaces = Object.keys(this.messageListeners_);
  this.postMessage({
    namespace: 'pluginJSMessageProxy',
    command: 'registerJsNamespaces',
    data: { namespaces: namespaces }});
  /**
   * @private
   * @suppress {unusedPrivateMembers}
   */
  this.pluginFinishedInitTime_ = (new Date()).getTime();

  this.fileSystemManager_.postFileSystemReadyMessageIfNeeded();

  // Show the back button, but delay it a bit to give the system a chance to
  // start loading a bit so it does not look like a long delay.
  setTimeout(function() {
    this.setBackButtonEnabled_(this.metadata_.disableAutoBackButton);
  }.bind(this), 400);

  // Initialize the plugin crash detection, if enabled.
  if (!this.metadata_.isSlowDebugRun) {
    this.heartbeatInterval_ = setInterval(this.heartbeat_.bind(this),
                                          _NACL_HEARTBEAT_PERIOD);
  }

  // Focus the window so that you can start typing characters in the
  // window without clicking it.
  this.appPlugin_.focus();
};


/** @private */
Plugin.prototype.setBootStep_ = function(newStep) {
  if (newStep > _MAX_BOOT_STEP) {
    console.error('invalid boot step: ' + newStep);
    newStep = _MAX_BOOT_STEP;
  }
  this.currentBootStep_ = newStep;
};


/** @private */
Plugin.prototype.clearSplash_ = function() {
  document.getElementById('splash').className = 'hidden-splash';
};


/** @private */
Plugin.prototype.reportCrash_ = function(message, minidump) {
  this.reportAppShutdown_(true);

  var extraCrashData = {};
  /** @type {AppWindow} */
  var currentAppWindow = chrome.app.window.current();
  if (currentAppWindow) {
    extraCrashData = {
      width: currentAppWindow.getBounds().width,
      height: currentAppWindow.getBounds().height,
      is_minimized: currentAppWindow.isMinimized(),
      is_maximized: currentAppWindow.isMaximized(),
      is_fullscreen: currentAppWindow.isFullscreen()
    };
  }
  extraCrashData.runtime_updated_while_running =
      window['arc']['runtimeUpdatedWhileRunning'];

  for (var field in this.crashExtraInformation_) {
    if (!this.crashExtraInformation_.hasOwnProperty(field))
      continue;

    extraCrashData[field] = this.crashExtraInformation_[field];
  }
  // Clear the extra information in case another crash arrives.
  this.crashExtraInformation_ = {};
  this.backgroundPage_.crashReporter.reportCrash(
      message, minidump, extraCrashData);
  getCwsInstalled().then(function(is_cws_installed) {
    if (is_cws_installed) {
      this.closeWindow_();
      if (getUptime() > _CRASH_RESTART_THRESHOLD) {
        var message = {
          namespace: 'jsSystem',
          command: 'relaunchApp'
        };
        chrome.runtime.sendMessage(message);
      }
    }
  }.bind(this));
};


/** @private */
Plugin.prototype.createAppPlugin_ = function() {
  var pluginObject = document.getElementById('app-plugin');

  if (this.isLoadingApk_) {
    // The APK is not ready. We have to remove the plugin, and it will be added
    // back when the everything is ready.
    var appdiv = document.getElementById('appdiv');
    appdiv.removeChild(pluginObject);
    this.pluginIsRemoved_ = true;
    pluginObject = document.createElement('object');
    pluginObject.setAttribute('id', 'app-plugin');
    pluginObject.setAttribute('plugintype', 'app-plugin');
    // tabindex='-1' makes the <object> element focusable via element.focus().
    // See http://www.w3.org/TR/wai-aria-practices/#focus_tabindex for details.
    pluginObject.setAttribute('tabindex', '-1');
  }

  pluginObject.addEventListener('message', (function(messageEvent) {
    var message = messageEvent.data;
    if (message == null) {
      return;
    } else if (message.constructor == ArrayBuffer) {
      // For now assume all ArrayBuffers are minidumps.
      // If we ever send other messages as array buffers, check for the MDMP
      // prefix.
      // Minidumps are sent in the raw to avoid further allocation preventing
      // crash delivery. Looking for the minidump signature.
      // There is a similar handler in child_plugin.js.
      this.crashReportReceived_ = true;
      this.showCrash_('plugin crashed: captured minidump');
      this.reportCrash_('captured minidump', message);
      return;
    }

    if (message.namespace == 'jsPlugin') {
      if (message.command == 'loadResult') {
        if (message.data.result) {
          // TODO(elijahtaylor): There is a problem with the plugin's
          // onload.  It is not equivalent to being ready to accept
          // messages on ChromeOS.  For now, accept this 'loadsuccess'
          // from the plugin as a message that the plugin is ready to go.
          this.handleAppPluginReady_();
        } else {
          this.showCrash_('Plugin failed to load');
          this.reportCrash_('loadfailure', null);
        }
      } else if (message.command == 'logPerfMessage') {
        var perfMessage = message.data.message;
        // Emit the perf log message, unless requested to suppress.
        if (!message.data.suppression)
          console.log(perfMessage.valueOf());

        // Update the boot step based on the message.
        if (perfMessage.indexOf('App instance started') != -1) {
          this.setBootStep_(_BOOT_STEP_APP_INSTANCE_STARTED);
        } else if (perfMessage.indexOf('Package dexopted') != -1) {
          this.setBootStep_(_BOOT_STEP_PACKAGE_DEXOPTED);
        } else if (perfMessage.indexOf('System server started') != -1) {
          this.setBootStep_(_BOOT_STEP_SYSTEM_SERVER_STARTED);
        } else if (perfMessage.indexOf('Activity onResume') != -1) {
          if (!this.hasSeenOnResume_) {
            var uptime = getUptime();
            var uma_data = [
              'shorttime', 'ArcRuntime.App.OnResumeTime', uptime];
            this.scheduleUmaOnBackgroundPage_(uma_data);
            this.clearSplash_();
            this.setBootStep_(_BOOT_STEP_DONE);
            this.hasSeenOnResume_ = true;
          }
        }
      } else if (message.command == 'crashExtraInformation') {
        for (var field in message.data) {
          if (!message.data.hasOwnProperty(field))
            continue;

          // If a field is set more than once (for instance, two threads
          // crashing at the same time), concatenate them to avoid losing
          // information.
          if (this.crashExtraInformation_[field] === undefined) {
            this.crashExtraInformation_[field] = '';
          } else {
            this.crashExtraInformation_[field] += '\n';
          }
          this.crashExtraInformation_[field] += message.data[field];
        }
      } else if (message.command == 'reportCrash') {
        // Do not show crash. Android has its own dialog that does this.
        this.reportCrash_('Android unhandled exception', null);
      } else {
        console.log('Unknown plugin message:');
        console.log(message);
      }
      return;
    }

    this.handleAppPluginMessage_(message);
  }).bind(this), false);

  pluginObject.addEventListener('crash', (function(crashEvent) {
    this.showCrash_('plugin crashed');
    if (!this.crashReportReceived_) {
      this.reportCrash_('plugin crash without minidump', null);
    }
  }).bind(this), false);

  if (this.isLoadingApk_) {
    // We are still loading the APK, have to delay plugin loading.
    this.onLoadingApkCompleted_ = (function() {
      this.handleAppPluginLoadAttempt_(pluginObject);
    }).bind(this);
  } else {
    this.handleAppPluginLoadAttempt_(pluginObject);
  }
};


/**
 * @private
 *
 * When plugin is ready, we keep pinging it every few seconds to detect plugin
 * crash or VM hang.
 *
 * There is an edge case on a busy system, e.g. buildbot launches many broswers
 * at once for integration test.  In that case, first heartbeat can be missed
 * because the receiver has not started to listen yet, causing the second
 * hearbeat thought the plugin was dead.  We simply adjust the ping interval to
 * avoid the edge case.
 */
Plugin.prototype.heartbeat_ = function() {
  if (this.appPlugin_ == null)
    return;
  if (this.waitingForHeartbeat_) {
    console.error('PING TIMEOUT: ' +
        'The plugin has not responded to the previous ping request yet, ' +
        'assume it crashed.');
    this.showCrash_('heartbeat ping timeout');
    this.reportCrash_('heartbeat ping timeout', null);
  } else {
    this.waitingForHeartbeat_ = true;
    this.postMessage(
        {namespace: 'androidHeartbeat', command: 'ping', 'data': {}});
  }
};


/** @private */
Plugin.prototype.removePlugin_ = function() {
  if (this.appPlugin_ == null)
    return;
  // Clear heartbeart if any so we don't keep getting events.
  if (this.heartbeatInterval_ != null) {
    clearInterval(this.heartbeatInterval_);
    this.heartbeatInterval_ = null;
  }
  var appdiv = document.getElementById('appdiv');
  // Remove the plugin from the page because it will be stuck on whatever the
  // last frame it rendered was.
  appdiv.removeChild(this.appPlugin_);
  // Set to null so we don't try to send messages to it.
  this.appPlugin_ = null;
  this.appPluginReady_ = false;
};


/** @private */
Plugin.prototype.closeWindow_ = function() {
  this.reportAppShutdown_(false);
  /* NB. We remove the plugin to work around crbug.com/350625. The browser NaCl
     host interface can get open_resource() requests after the plugin's
     RenderViewHost has been removed.  Removing the plugin before closing
     the window seems to avoid the underlying race. */
  this.removePlugin_();
  this.notificationManager_.destroy();
  this.backgroundPage_.crashReporter.shutDown();
  window.close();
};


/** @private */
Plugin.prototype.showCrash_ = function(cause) {
  getCwsInstalled().then(function(is_cws_installed) {
    if (!is_cws_installed) {
      this.removePlugin_();
      // Simple CSS trick to get the sad plugin graphic centered in the div.
      document.getElementById('appdiv').style.background =
          'black url(sadplugin.png) center no-repeat';
      this.clearSplash_();
    }
  }.bind(this));
  console.error(cause);
};


/** @private */
Plugin.prototype.showNotSupported_ = function() {
  this.removePlugin_();
  this.initializeWindow_();
  this.clearSplash_();
  var errorText = document.getElementById('errortext');
  // Use the same text as the store displays when GPU support is not
  // detected.
  // TODO(crbug.com/335759): Once 335759 is fixed, replace 'appNotSupported'
  // with a message name in ARC runtime.
  var message = chrome.i18n.getMessage('appNotSupported');

  // TODO(yusukes): Remove this once all packages are updated.
  if (!message)
    message = 'This app is incompatible with your device.';

  errorText.appendChild(document.createTextNode(message));
  document.getElementById('errordiv').style.display = 'block';
};


/** @private */
Plugin.prototype.doLayout_ = function(initialLayout) {
  var layout =
      this.computeLayout_(initialLayout, this.getWindowBounds_(),
                          getCurrentZoom());
  this.applyLayout_(initialLayout, layout);
};


/** @private */
Plugin.prototype.computeLayout_ = function(initialLayout, windowBounds,
                                           currentZoom) {
  if (this.initializing_)
    throw 'doLayout_ should not be called during initialization!';

  var pluginBounds = {top: 0, left: 0, height: 0, width: 0};
  var resizeWindow = false;
  var rotated = (this.rotation_ == 90 || this.rotation_ == 270);
  var androidHeight = rotated ? this.metadata_.width : this.metadata_.height;
  var androidWidth = rotated ? this.metadata_.height : this.metadata_.width;
  var zoomChanged = this.previousZoom_ != currentZoom;
  this.previousZoom_ = currentZoom;

  var userWidth;
  var userHeight;
  /*
  if (zoomChanged || (initialLayout && !this.isWindowMaximized_())) {
    // Ignore window bounds on initial layout as the window sometimes does not
    // get resized by Chrome until after the plugin is initialized. Also take
    // the app's original width and height if the zoom has changed to correctly
    // resize the window.
    userWidth = androidWidth;
    userHeight = androidHeight;
  } else {
  */
  {
    // Window dimensions are not affected by the zoom level, but they are then
    // compared against DIPs. Scale them.
    userWidth = windowBounds.width / currentZoom;
    userHeight = windowBounds.height / currentZoom - _TOPBAR_HEIGHT;
  }

  var userAspectRatio = userWidth / userHeight;
  var androidAspectRatio = androidWidth / androidHeight;

  // Ensure the window gets resized to fit the new dimensions. This is
  // necessary when rotation changes and the user area is not square. This is
  // also necessary when the user attempts to shrink the window too small -
  // which we can not prevent via minWidth / minHeight due to orientation
  // changes.
  if (zoomChanged ||
      (!this.isWindowMaximized_() && !initialLayout &&
          (userWidth < androidWidth || userHeight < androidHeight))) {
    resizeWindow = true;
  }

  if (userWidth < androidWidth || userHeight < androidHeight) {
    pluginBounds.height = this.metadata_.height;
    pluginBounds.width = this.metadata_.width;
  } else if (userAspectRatio > androidAspectRatio) {
    // Pillarbox.
    pluginBounds.height = userHeight;
    pluginBounds.width = Math.floor(userHeight * androidAspectRatio);
    pluginBounds.left = Math.floor((userWidth - pluginBounds.width) / 2);
  } else {
    // Letterbox.
    pluginBounds.height = Math.floor(userWidth / androidAspectRatio);
    pluginBounds.width = userWidth;
    pluginBounds.top = Math.floor((userHeight - pluginBounds.height) / 2);
  }
  if (rotated) {
    // Offset the origin of the plugin to account for the rotation transform.
    pluginBounds.top += (pluginBounds.height - pluginBounds.width) / 2;
    pluginBounds.left += (pluginBounds.width - pluginBounds.height) / 2;
    // Also swap width and height.
    var tmp = pluginBounds.width;
    pluginBounds.width = pluginBounds.height;
    pluginBounds.height = tmp;
  }

  return {
    containerSize: {
      width: userWidth,
      height: userHeight
    },
    pluginBounds: pluginBounds,
    resizeWindow: resizeWindow,
    windowSize: {
      width: androidWidth * currentZoom,
      height: (androidHeight + _TOPBAR_HEIGHT) * currentZoom
    },
    zoomChanged: zoomChanged
  };
};


/** @private */
Plugin.prototype.applyLayout_ = function(initialLayout, layout) {
  var appdiv = document.getElementById('appdiv');
  var pluginElement = this.appPlugin_;

  if (this.rotation_ != this.cachedRotation_ && pluginElement) {
    // Hide the plugin for 400ms to make the rotation smoother.
    pluginElement.style.opacity = 0;
    setTimeout(function() {
      pluginElement.style.opacity = 1;
    }, 400);
    pluginElement.style.webkitTransform = 'rotate(-' + this.rotation_ + 'deg)';
    this.cachedRotation_ = this.rotation_;
  }
/*
  if (initialLayout || layout.zoomChanged) {
    chrome.app.window.current().innerBounds.setMinimumSize(
        Math.round(layout.windowSize.width),
        Math.round(layout.windowSize.height));
  }
  if (layout.resizeWindow) {
    window.resizeTo(layout.windowSize.width, layout.windowSize.height);
  }
*/
  appdiv.style.width = (layout.containerSize.width + 'px');
  appdiv.style.height = (layout.containerSize.height + 'px');
  if (pluginElement) {
    pluginElement.setAttribute('width', layout.pluginBounds.width);
    pluginElement.setAttribute('height', layout.pluginBounds.height);
    pluginElement.style.top = (layout.pluginBounds.top + 'px');
    pluginElement.style.left = (layout.pluginBounds.left + 'px');
    // Works around crbug.com/181327 by setting the position property the same
    // as what will be loaded in the CSS.
    pluginElement.style.position = 'absolute';
  }
};


/**
 * @private
 *
 * Sets the rotation to apply to the plugin canvas.
 *
 * @param rotation rotation in degrees. Only 90 degree increments are
 * allowed.
 */
Plugin.prototype.setRotation_ = function(rotation) {
  if (this.rotation_ == rotation)
    return;

  if (rotation != 0 && rotation != 90 && rotation != 180 && rotation != 270) {
    console.log('Rotation (' + rotation + 'deg) is not supported.');
    return;
  }

  var minWidth = (rotation == 0 || rotation == 180) ? this.metadata_.width :
                                                      this.metadata_.height;
  var minHeight = (rotation == 0 || rotation == 180) ? this.metadata_.height :
                                                       this.metadata_.width;
  minHeight += _TOPBAR_HEIGHT;
  var currentZoom = getCurrentZoom();
  minHeight *= currentZoom;
  minWidth *= currentZoom;
  chrome.app.window.current().innerBounds.setMinimumSize(minWidth, minHeight);
  this.rotation_ = rotation;
  this.doLayout_(false);
};


/**
 * @private
 *
 * Sets whether the back button UI is enabled or not, and optionally forces a
 * refresh of the UI.
 *
 * @param enabled If true, the back button is enabled.
 */
Plugin.prototype.setBackButtonEnabled_ = function(enabled) {
  this.backButtonEnabled_ = enabled;
  this.setTopbarImagesAndVisibility_(null);
};


/**
 * @private
 *
 * Handles request messages regarding the clipboard.
 *
 * @param message Clipboard message to handle.
 */
Plugin.prototype.handleClipboardMessage_ = function(message) {
  if (message.command != 'pushhost' && message.command != 'pullhost') {
    console.log('Received unknown clipboard message: ' +
                JSON.stringify(message));
    return;
  }

  // All operations to the clipboard can only be done from the background page
  // due to security. Send it as a message so it is processed there.
  chrome.runtime.sendMessage(message, (function(response) {
    this.postMessage(response);
  }).bind(this));
};


/**
 * @private
 *
 * Handles request messages configuring how the application is displayed.
 *
 * @param message Display message to handle.
 */
Plugin.prototype.handleDisplayMessage_ = function(message) {
  if (message.command == 'config') {
    this.setRotation_(message.data.rotation);
  } else if (message.command == 'setBackButtonUIEnabled') {
    if (!this.metadata_.disableAutoBackButton) {
      this.setBackButtonEnabled_(message.data.enable);
    }
  } else if (message.command == 'showNoGpu') {
    this.showNotSupported_();
    console.error('No GPU support.');
  } else {
    console.log('Received unknown display command: ' + message.command);
  }
};


/**
 * @private
 *
 * Handles request messages for browser actions.
 *
 * @param message Browser message to handle.
 */
Plugin.prototype.handleBrowserMessage_ = function(message) {
  if (message.command == 'openUrl') {
    var url = message.data.data;
    window.open(url);
  } else {
    console.log('Received unknown intent message: ');
    console.log(message);
  }
};


/**
 * @private
 *
 * Handles request message for special system events.
 *
 * @param message System message to handle.
 */
Plugin.prototype.handleSystemMessage_ = function(message) {
  if (message.command == 'reboot') {
    console.log('Reboot requested');
    this.closeWindow_();
    chrome.runtime.reload();
  } else if (message.command == 'shutDown') {
    console.log('Shut down requested');
    this.closeWindow_();
  } else if (message.command == 'activityStackEmpty') {
    if (!this.metadata_.allowEmptyActivityStack) {
      console.log('Activity stack is empty. Shutting down.');
      this.closeWindow_();
    }
  } else if (message.command == 'enableCrashReporting') {
    if (message.data.enabled)
      console.log('Crash reporting is enabled');
    this.backgroundPage_.crashReporter.setCrashReportingEnabled(
        message.data.enabled);
  } else {
    console.log('Received unknown system message: ' + message);
  }
};


/**
 * @private
 *
 * Relays GCM requests to GcmManager in background page.
 *
 * @param message message to handle.
 */
Plugin.prototype.relayGcmMessage_ = function(message) {
  var plugin = this;
  var gcm = this.backgroundPage_.gcm;
  if (!gcm) {
    console.error('Play Services is likely not enabled.');
    return;
  }
  gcm.handleGcmRequest(message, plugin);
};


/**
 * @private
 *
 * Handles request message for media stream.
 *
 * @param message chooseDialog message to handle.
 */
Plugin.prototype.handleMediaStreamMessage_ = function(message) {
  if (message.command == 'audioOpenCall') {
    if (this.audioTrack_ != null) {
      // Two audio track objects opened at the same time should not happen.
      // Returning null to let AudioManager know the request failed.
      console.error('Only one audio track may be opened at a time');
      var responseMessage = {
        namespace: 'mediaStream',
        command: 'audioOpenResponse',
        data: {
          requester: message.data.requester,
          requestid: message.data.requestid,
          result: null
        }
      };
      this.postMessage(responseMessage);
      return;
    }
    navigator.webkitGetUserMedia(
        {'audio': true},
        (function(stream) {
          this.audioTrack_ = stream.getAudioTracks()[0];
          var responseMessage = {
            namespace: 'mediaStream',
            command: 'audioOpenResponse',
            data: {
              requester: message.data.requester,
              requestid: message.data.requestid,
              result: this.audioTrack_
            }
          };
          this.postMessage(responseMessage);
        }).bind(this),
        (function(err) {
          console.error('Audio stream failed to open', err);
          var responseMessage = {
            namespace: 'mediaStream',
            command: 'audioOpenResponse',
            data: {
              requester: message.data.requester,
              requestid: message.data.requestid,
              result: null
            }
          };
          this.postMessage(responseMessage);
        }).bind(this));
  } else if (message.command == 'audioCloseCall') {
    if (this.audioTrack_ != null) {
      this.audioTrack_.stop();
      this.audioTrack_ = null;
    }
    var responseMessage = {
      namespace: 'mediaStream',
      command: 'audioCloseResponse',
      data: {
        requester: message.data.requester,
        requestid: message.data.requestid,
        result: true
      }
    };
    this.postMessage(responseMessage);
  } else if (message.command == 'videoOpenCall') {
    if (this.videoTrack_ != null) {
      // Two video track objects opened at the same time should not happen.
      // Returning null to let CameraManager know the request failed.
      console.error('Only one video track may be opened at a time');
      var responseMessage = {
        namespace: 'mediaStream',
        command: 'videoOpenResponse',
        data: {
          requester: message.data.requester,
          requestid: message.data.requestid,
          result: null
        }
      };
      this.postMessage(responseMessage);
      return;
    }
    navigator.webkitGetUserMedia(
        // TODO(mknowles): Parametrize the minHeight value
        {'video': {'optional': [{'minHeight': 640}]}},
        (function(stream) {
          this.videoTrack_ = stream.getVideoTracks()[0];
          var responseMessage = {
            namespace: 'mediaStream',
            command: 'videoOpenResponse',
            data: {
              requester: message.data.requester,
              requestid: message.data.requestid,
              result: this.videoTrack_
            }
          };
          this.postMessage(responseMessage);
        }).bind(this),
        (function(err) {
          console.error('Video stream failed to open', err);
          var responseMessage = {
            namespace: 'mediaStream',
            command: 'videoOpenResponse',
            data: {
              requester: message.data.requester,
              requestid: message.data.requestid,
              result: null
            }
          };
          this.postMessage(responseMessage);
        }).bind(this));
  } else if (message.command == 'videoCloseCall') {
    if (this.videoTrack_ != null) {
      this.videoTrack_.stop();
      this.videoTrack_ = null;
    }
    var responseMessage = {
      namespace: 'mediaStream',
      command: 'videoCloseResponse',
      data: {
        requester: message.data.requester,
        requestid: message.data.requestid,
        result: true
      }
    };
    this.postMessage(responseMessage);
  } else {
    console.log('Received unknown media stream message: ' + message);
  }
};


/** @private */
Plugin.prototype.handleHeartbeatMessage_ = function(message) {
  if (message.command == 'pong') {
    this.waitingForHeartbeat_ = false;
  } else {
    console.log('Received unknown heartbeat message: ' + message);
  }
};


/** @private */
Plugin.prototype.handleChildPluginMessage_ = function(message) {
  ChildPlugin.handleChildPluginMessage(message,
                                       this.postMessage.bind(this),
                                       this.postMessage.bind(this),
                                       this.postMessage.bind(this));
};


/** @private */
Plugin.prototype.setTopbarImagesAndVisibility_ = function(focused) {
  if (!this.topbar_) {
    this.initializeTopBar_(document.getElementById('topbar'));
  }

  var buttons = ['back', 'minimize', 'maximize', 'close'];
  var isFocusedOrig = this.isFocusedWindow_;
  if (focused != null)
    this.isFocusedWindow_ = focused;

  for (var i = 0; i < buttons.length; ++i) {
    var buttonDom = document.getElementById(buttons[i] + '-button');
    if (isFocusedOrig != this.isFocusedWindow_) {
      // Loading an external image is an expensive operation. Do it only when
      // it is necessary.
      buttonDom.src = (this.isFocusedWindow_ ? '' : 'in') + 'active_window_' +
          buttons[i] + '.png';
    }
    buttonDom.className = this.isFocusedWindow_ ? 'button' : 'inactbutton';
    if (buttons[i] == 'back') {
      buttonDom.className = this.backButtonEnabled_ ?
          'button' : 'hiddenbutton';
    } else if (buttons[i] == 'maximize' &&
               this.metadata_.resize == 'disabled') {
      buttonDom.className = 'hiddenbutton';
    } else if (buttons[i] == 'extdir-button') {
      // The visibility is changed by fileSystemManager.
    } else {
      buttonDom.className = 'button';
    }
  }

  this.topbar_.className = this.isFocusedWindow_ ? '' : 'inact';
};


/**
 * @private
 *
 * Handles mouse down events.
 *
 * @param e Event structure
 */
Plugin.prototype.handleMouseDown_ = function(e) {
  if (e.button != 0)
    return;
  this.pressedButton_ = e.currentTarget;
  // Avoid continuing event dispatching from buttons' handlers through to
  // the topbar behind them.
  e.cancelBubble = true;
};


/**
 * @private
 *
 * Handles mouse down events.
 *
 * @param e Event structure
 */
Plugin.prototype.handleMouseUp_ = function(e) {
  if (e.button != 0)
    return;
  var pressedButton = this.pressedButton_;
  this.pressedButton_ = null;
  if (pressedButton == e.currentTarget) {
    if (pressedButton.id == 'minimize-button')
      this.minimizeWindow_();
    if (pressedButton.id == 'maximize-button') {
      if (this.metadata_.resize != 'disabled') {
        if (this.isWindowMaximized_()) {
          this.restoreWindow_();
        } else {
          this.maximizeWindow_();
        }
      }
    } else if (pressedButton.id == 'close-button') {
      this.closeWindow_();
    } else if (pressedButton.id == 'back-button') {
      if (this.backButtonEnabled_) {
        this.postMessage({
          namespace: 'pluginInputManager',
          command: 'simulateButton',
          data: {
            button: 'backButton'
          }});
      }
    } else if (pressedButton.id == 'extdir-button') {
      this.fileSystemManager_.openAndMountExternalDirectory(
          true /* reset external file handler since it is already in use */);
    }
  }
  // Restore focus to the plugin, otherwise certain events like keyboard events
  // will not be seen by the application. See crbug.com/379176.
  var plugin_elem = document.getElementById('app-plugin');
  if (plugin_elem)
    plugin_elem.focus();
};


/**
 * @private
 *
 * Attaches event handlers to the Topbar UI component.
 *
 * @param topbar The document element to contain the topbar
 */
Plugin.prototype.initializeTopBar_ = function(topbar) {
  if (this.initializing_)
    throw 'initializeTopBar_ should not be called during initialization!';
  this.topbar_ = topbar;

  // Add a listener to mousedown on the title bar to know when the
  // window is being dragged by the title bar.
  topbar.addEventListener('mousedown', this.handleMouseDown_.bind(this));

  var buttons = ['back-button',
                 'extdir-button',
                 'minimize-button',
                 'maximize-button',
                 'close-button'];
  for (var i = 0; i < buttons.length; ++i) {
    var button = document.getElementById(buttons[i]);
    button.addEventListener('mousedown', this.handleMouseDown_.bind(this));
    button.addEventListener('mouseup', this.handleMouseUp_.bind(this));
  }

  // Add mouseup listener on the window, so we can realize any currently
  // pressed window control button is released even if it is released in
  // the app part of the window.
  window.addEventListener('mouseup', this.handleMouseUp_.bind(this));

  // Upon losing window focus, set the titlebar to inaactive state and
  // reset button pressed state.
  var onblur = function() {
    // Linux (at least) delivers two blur events as soon as you drag the window.
    // So detect this and avoid showing an inactive topbar.  Linux always
    // delivers a focus event when the mouse is released while dragging.
    // So ignore all blur events after the topbar was pressed until a focus.
    if (this.pressedButton_ != this.topbar_) {
      this.setTopbarImagesAndVisibility_(false);
      // Any other button that happened to be pressed is no longer pressed.
      this.pressedButton_ = null;
    }
  };
  window.onblur = onblur.bind(this);
  var onfocus = function() {
    // This handles the case of Linux where a focus even fires when you
    // let go of a draggable region (and mouseup does not).  It should always
    // be safe to assume no button is pressed upon focusing.
    this.pressedButton_ = null;
    this.setTopbarImagesAndVisibility_(true);
  };
  window.onfocus = onfocus.bind(this);
};


/**
 * @private
 * Get container window's bounds
 */
Plugin.prototype.getWindowBounds_ = function() {
  if (chrome.app.window)
    return chrome.app.window.current().innerBounds;
  return { width: 360, height: 640};
};


/**
 * @private
 * Return ture if the container window is maximized.
 */
Plugin.prototype.isWindowMaximized_ = function() {
  return chrome.app.window && chrome.app.window.current().isMaximized();
};


/**
 * @private
 * Maximize the container window
 */
Plugin.prototype.maximizeWindow_ = function() {
  if (chrome.app.window)
    chrome.app.window.current().maximize();
};


/**
 * @private
 * Restore the container window
 */
Plugin.prototype.restoreWindow_ = function() {
  if (chrome.app.window)
    chrome.app.window.current().restore();
};


/**
 * @public
 * Show the container window
 */
Plugin.prototype.showWindow = function() {
  if (chrome.app.window)
    chrome.app.window.current().show();
};


/**
 * @public
 * Called when the application is re-launched
 */
Plugin.prototype.onRelaunched = function(args) {
  // Update launch argument.
  window['arc'].launchArgs = args;
  if (args.items) {
    // If file entry is passed to launch argument, wake up helper activity.
    this.shell('am start -n ' +
               'org.chromium.arc/.FileHandlerLaunchHelperActivity;');
  }
  chrome.app.window.current().focus();
};


/**
 * @public
 */
Plugin.prototype.getMetadata = function() {
  return this.metadata_;
};


/**
 * @private
 * Minimize the container window
 */
Plugin.prototype.minimizeWindow_ = function() {
  /** @type {AppWindow} */
  var appWindow = chrome.app.window.current();
  appWindow.minimize();

  // TODO(crbug/383225): Remove the workaround for hover state when
  // the underlying chrome bug is fixed.
  var button = document.getElementById('minimize-button');
  // hover state does not get reset, work around by making it white
  // (non-hover).
  button.style.backgroundColor = '#FFF';

  // Try to restore the hover behavior the next time there is a
  // mousemove event.
  setTimeout(function() {
    button.addEventListener('mouseenter', function() {
      button.style.backgroundColor = '';
      button.removeEventListener('mouseenter', arguments.callee, false);
    }, false);
  }, 0);
};


// The background page creates window.arc object before this script loads.
//console.assert(window['arc']);
//console.assert(window['arc'].launchArgs);

var arcObj = {
  appLaunchTime: new Date().getTime(),
  launchArgs: {
    isKioskSession: false
  },
  runtimeUpdatedWhileRunning: null,
  userEmail: ""
};

window['arc'] = arcObj;

var plugin = null;
// Allow the tests to construct the plugin as necessary.
//if (!window['arc'].launchArgs.suppressPluginInit) {
  var times = {
    'app_launch_time': window['arc'].appLaunchTime
  };
  plugin = new Plugin(times);
  plugin.init();
//}
