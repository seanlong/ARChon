// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var appWindow;


/**
 * Whether the app window is launched or not.
 * @type {boolean}
 */
var appLaunched = false;


/**
 * embed tag holding dexopt child plugin.
 * @type {Element}
 */
var dexoptPlugin;
var pendingUma = [];


// We add 1 below because it is the minimum, so this is really 1-5 minutes.
/** @const */
var _ONINSTALL_MAX_DELAY_IN_MINUTES = 4;


// Embeds a dexopt plugin instance to the background page.
/** @private */
function addDexoptPlugin_() {
  if (dexoptPlugin) {
    // onInstalled is called twice quickly. This should not happen, but handle
    // it just in case.
    return;
  }
  if (appLaunched) {
    // An app instance, which might also do dexopt, is already running (or is
    // about to start). Since we do not implemented file locking functions
    // which dexopt uses to avoid file corruption, starting two dexopt plugin
    // instances at the same time, one in onLaunched and the other in
    // onInstalled, is not always safe.
    return;
  }

  var apkList = arcMetadata.get().apkList;
  var apk = apkList[apkList.length - 1];
  var path = '/vendor/chromium/crx/' + apk;
  var data = {
    'requestid': 0,
    'requester': 'jsInstaller',
    'plugin': 'so_executable',
    'args': ['dexopt', '--preopt', path, '$auto', 'v=r,o=v,m=y,u=n']
  };
  dexoptPlugin = new ChildPlugin(
      document.getElementById('childplugindiv'),
      data,
      function(message) {
        if (message.data.result != 0) {
          console.error('Failed to dexopt on installation.');
        }
        dexoptPlugin = null;
      },
      null,
      null);
}


function needEmailToLaunch_() {
  var permissions = chrome.runtime.getManifest().permissions;
  return permissions && permissions.indexOf('identity.email') >= 0;
}


/**
 * Kill dexopt running in the background if it is already running,
 * and allow app window to start up.
 */
function maybeKillDexopt_() {
  var dexopt_interrupted = false;
  if (dexoptPlugin && dexoptPlugin.active) {
    // Dexopt plugin is running. Terminate it and start the app instead.
    dexoptPlugin.remove('Dexopt plugin terminated');
    dexopt_interrupted = true;
  }
  var uma_data = ['bool',
                  'ArcRuntime.DexoptInterrupted',
                  dexopt_interrupted];
  scheduleUma(uma_data);
}


/**
 * @public
 *
 * Launch the app (create the app window). This is normally done in response to
 * an onLaunched event from the apps API, but can also be called by the test
 * framework independently.
 *
 * @param {Function=} opt_appWindowCreationCallback Optional callback after app
 * window is created.
 */
function onLaunch(args, opt_appWindowCreationCallback) {
  /**
   * @param {Function=} opt_userEmail Optional email of account in the instance.
   */
  function launchAppWindow(opt_userEmail) {
    var time_0 = (new Date()).getTime();
    var abs_index_html = 'runtime/gen_index.min.html';
    var window_id = '';
    if (chrome.runtime.getManifest().hasOwnProperty('import')) {
      // Assume only one module (ARC) is being imported.
      var runtime_id = chrome.runtime.getManifest()['import'][0]['id'];
      // Workaround crbug.com/180039 by constructing the absolute path (within
      // the App CRX root) to index.html
      abs_index_html = '/_modules/' + runtime_id + '/gen_index.min.html';
      window_id = runtime_id;
    }
    // Override the window ID so App windows from tests will be distinct.
    if (args.hasOwnProperty('windowIdOverride')) {
      window_id = args['windowIdOverride'];
    }

    appWindow = chrome.app.window.get(window_id);
    if (appWindow != null && !args.forceWindowCreate) {
      var onRelaunched = appWindow.contentWindow.arc.onRelaunched;
      if (!onRelaunched) {
        console.error('onLaunched is called during initialization.');
        return;
      }
      onRelaunched(args);
      return;
    }

    // Note: The code above this point runs every time the App Launcher
    // icon is clicked, regardless of whether the App is currently launched.
    // Do not put one-time init code above this point.
    // TODO(crbug.com/417403): Refactor this whole function, there are clearly
    // two paths here, one for when the app is already launched and needs to
    // be relaunched, and when we need a new window to be created.  There
    // should not be the need for a comment like this about not putting one-time
    // init code in "launchAppWindow".

    console.time('ARC Window Popup');
    maybeKillDexopt_();
    crashReporter.init();
    var appWidth = arcMetadata.getValue('width');
    var appHeight = arcMetadata.getValue('height') + _TOPBAR_HEIGHT;

    var options = {
      // Specify an id for the window to make the window a singleton.
      id: window_id,
      // TODO(jhorwich) Switch to innerBounds when Chrome 36 is stable as this
      // bounds is deprecated in favor of innerBounds.
      width: appWidth,
      height: appHeight,
      resizable: arcMetadata.getValue('resize') != 'disabled',
      // Showing the app window is not a cheap operation for the browser
      // process. Not to slow down nexe loading, create the window with
      // 'hidden: true', and show it later in plugin.js when the process
      // is idle.
      hidden: true,
      frame: 'none'
    };

    chrome.app.window.create(abs_index_html, options, function(w) {
      console.timeEnd('ARC Window Popup');
      if (opt_appWindowCreationCallback)
        opt_appWindowCreationCallback(w);

      appWindow = w;
      appWindow.contentWindow['arc'] = {
        launchArgs: args,
        appLaunchTime: time_0,
        backgroundPage: window,
        runtimeUpdatedWhileRunning: null,
        userEmail: opt_userEmail
      };
      appWindow.setBounds({width: appWidth, height: appHeight});
      appWindow.contentWindow.openParentWindow = function(url) {
        return window.open(url);
      };
      appWindow.onClosed.addListener(function() {
        appWindow = null;
        // Reset |appLaunched| so that the onInstalled handler can dexopt
        // an apk when the app is auto-updated.
        appLaunched = false;
      });
    });
  }

  appLaunched = true;

  // Case 1: For testing
  var delay = arcMetadata.getValue('minimumLaunchDelay');
  if (delay > 0) {
    // For testboot.
    console.log('launchAppWindow delayed: ' + delay + ' ms');
    setTimeout(launchAppWindow, delay);
    return;
  }

  // Case 2: Launch with user's email if needed.
  if (needEmailToLaunch_()) {
    // Note that when user does not sign into Chrome, userInfo.email will be an
    // empty string.  The app will be launched with no user in the runtime.
    PromiseWrap.getProfileUserInfo().then(function(userInfo) {
      launchAppWindow(userInfo.email);
    }, function(error) {
      console.error('Failed to get profile user info, continuing anyway: ' +
          error.message);
      launchAppWindow();
    });
    return;
  }

  // Case 3: Launch without user's email.
  launchAppWindow();
}

chrome.app.runtime.onLaunched.addListener(onLaunch);


function installLogic() {
  console.time('ARC onInstalled HTML5 FS init');
  // First, create "/data/dalvik-cache" directory if it does not exist,
  // and then call addDexoptPlugin_().
  var quota = 20 * 1024 * 1024 * 1024;  // a dummy value. see plugin.js.
  window.webkitRequestFileSystem(window.PERSISTENT, quota, function(fs) {
    fs.root.getDirectory('data', {create: true}, function(root_data) {
      root_data.getDirectory('dalvik-cache', {create: true}, function(_) {
        console.timeEnd('ARC onInstalled HTML5 FS init');
        addDexoptPlugin_();
      });
    });
  });
}

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name == 'onInstallUpdate') {
    if (!appLaunched)
      installLogic();
  }
});

// Fired when the extension is first installed, when the extension is updated
// to a new version, and when Chrome is updated to a new version.
chrome.runtime.onInstalled.addListener(function(details) {
  if (details.reason == 'install') {
    installLogic();
    return;
  }
  // TODO(crbug.com/237273): We should prevent this from happening, but while
  // it is possible, we should make a note of it because it may be responsible
  // for crashes.
  if (details.reason == 'shared_module_update' && appWindow) {
    appWindow.contentWindow['arc']['runtimeUpdatedWhileRunning'] = new Date();
  }
  // Delay the onInstalled logic in case of an update.  This provides some
  // simple cooperative scheduling to keep too many dexopt plugins from being
  // run simultaneously.  Alarms can be run at most every minute, so stretch
  // update dexopting over a long period of time.
  var delay = Math.floor(
      Math.random() * _ONINSTALL_MAX_DELAY_IN_MINUTES) + 1;
  console.log('Delaying update install logic for ' + delay + ' minutes');
  chrome.alarms.create('onInstallUpdate', { delayInMinutes: delay });
});

// Handles 'jsClipboard' message. Returns true if this function handled
// message, otherwise returns false.
function handleClipboardMessageBg_(message, sendResponse) {
  if (message.namespace != 'jsClipboard' ||
      (message.command != 'pushhost' && message.command != 'pullhost')) {
    return false;
  }

  var result = null;
  // Prepare a content editable DIV for clipboard sync.
  var div = document.createElement('div');
  div.id = 'clipboardHelperDiv';
  div.setAttribute('contentEditable', true);
  div.width = div.height = 0;
  div.style.position = 'absolute';
  var body = document.body;
  var previousActiveElement = document.activeElement;
  body.appendChild(div);
  div.focus();

  if (message.command == 'pushhost') {
    // Chrome does not support copying an empty value. We use a null character
    // as signal for an empty clipboard.
    div.innerHTML = message.data.value != '' ? message.data.value : '\0';
    result = document.execCommand('selectAll') && document.execCommand('cut');
  } else if (message.command == 'pullhost') {
    if (document.execCommand('paste')) {
      result = div.innerHTML;
      // Chrome does not support copying an empty value. We use a null character
      // as signal for an empty clipboard.
      if (result == '\0') {
        result = '';
      }
    }
  }

  sendResponse({
    namespace: 'androidClipboard',
    command: message.command + 'response',
    data: {
      result: result
    }
  });

  // Cleanup the previously added textarea.
  body.removeChild(div);
  if (previousActiveElement) {
    previousActiveElement.focus();
  }
  return true;
}

// Handles 'jsSystem' messages. Returns true if the message was handled.
function handleSystemMessageBg_(message) {
  if (message.namespace == 'jsSystem' && message.command == 'relaunchApp') {
    onLaunch({forceWindowCreate: true});
    return true;
  }
  return false;
}


/**
 * @private
 *
 * Handles jsUma messages to schedule UMA to be sent by a plugin on the
 * background page.
 */
function handleUmaMessageBg_(message) {
  if (message.namespace == 'jsUma' && message.command == 'scheduleUma') {
    getCwsInstalled().then(function(is_cws_installed) {
      if (is_cws_installed)
        scheduleUma(message.data.uma_data, message.data.immediate);
    });
    return true;
  }
  return false;
}

// Handles messages received from the plugin script. This handles all the
// priviliged operations that require to be in the background page, or
// operations like shutdown UMA reporting for which the app context is no
// longer viable for use.
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (handleClipboardMessageBg_(message, sendResponse)) {
    return;
  } else if (handleSystemMessageBg_(message)) {
    return;
  } else if (handleUmaMessageBg_(message)) {
    return;
  }
  console.error('Unhandled message: ');
  console.error(message);
});


chrome.runtime.onSuspend.addListener(function() {
  // If we are about to suspend, report outstanding UMA immediately.
  reportUma();
});


/**
 * Queues up UMA data and schedules a call to reportUma.
 *
 * @param {!Array} uma_data Args for umareporter.
 * @param {boolean=} opt_immediate To send data immediately instead of batching.
 */
function scheduleUma(uma_data, opt_immediate) {
  // Ensure |opt_immediate| is either true or false, even if undefined.
  opt_immediate = !!opt_immediate;
  pendingUma = pendingUma.concat(uma_data);
  if (opt_immediate) {
    reportUma();
  } else {
    // Schedule UMA reporting 20 seconds out so we do not interfere with init.
    setTimeout(reportUma, 20000);
  }
}

// Send any pending UMA stats to an UMA reporter plugin.
function reportUma() {
  if (pendingUma.length == 0)
    return;

  // Do not create an umareporter plugin if we have a debugger attached.
  if (arcMetadata.getValue('isSlowDebugRun'))
    return;

  var data = {
    'requestid': 0,
    'requester': 'backgroundpage',
    'plugin': 'so_executable',
    'args': ['umareporter'].concat(pendingUma)
  };
  new ChildPlugin(
      document.getElementById('childplugindiv'),
      data,
      function(message) {},
      null,
      null);
  pendingUma = [];
}
