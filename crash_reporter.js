// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Crash reporting code.


/** @const */
var _CRASH_REPORT_SETTING_UNKNOWN = -1;
var _CRASH_REPORT_SETTING_DISABLED = 0;
var _CRASH_REPORT_SETTING_ENABLED = 1;
var _CRASH_REPORT_STORAGE_KEY = 'crashReports';
// How long to wait after launch to load crash reports from local storage. It is
// delayed because it interferes with filesystem access during boot.
var _CRASH_REPORT_STORAGE_BOOT_DELAY = 10000;
// How long before a stored crash report is too old to send. (5 days)
var _CRASH_REPORT_MAX_AGE = 1000 * 60 * 60 * 24 * 5;



/**
 * @constructor
 *
 * CrashReporter is a simple class to centralize crash reporting and manage
 * minidumps captured from crashes in our various NaCl instances.
 */
function CrashReporter() {
  /**
   * @private
   * This flag is set by a message from the main plugin, which requests
   * this user setting on startup.
   */
  this.crashReportingEnabled_ = _CRASH_REPORT_SETTING_UNKNOWN;

  /**
   * @private
   * Whether we read pending crash data from storage yet.
   */
  this.didReadFromStorage_ = false;

  /**
   * @public
   *
   * Flag that controls printing a debug message which is picked up by
   * the processes output_handler.  True by default, we suppress this mesasge
   * for jstests so we can test crash reporting.
   */
  this.logFinishReportingCrash = true;
  if (window['main'] && window['main'].underJavascriptTestRunner) {
    this.logFinishReportingCrash = false;
  }

  /**
   * @private
   * An array of pending crash reports Objects.
   */
  this.pendingCrashReports_ = [];

  /**
   * @private
   *
   * Start time used for reference in crashes.  This is set here (on install)
   * but is overridden on launch so app crashes are relative to launch.
   */
  this.startTime_ = new Date();
}


/** @private */
function showCrashInfo_(message, opt_id) {
  if (message)
    console.log(message);
  if (opt_id)
    console.log('crash id: ' + opt_id);
}


function crashIsTooOld_(crash_data) {
  if (!crash_data.hasOwnProperty('crash_time'))
    return true;

  var now = new Date();
  if (now - crash_data['crash_time'] > _CRASH_REPORT_MAX_AGE)
    return true;

  return false;
}


/**
 * @private
 *
 * Sends a crash report if enabled.
 */
CrashReporter.prototype.sendCrashReport_ = function(crash_data) {
  if (this.crashReportingEnabled_ == _CRASH_REPORT_SETTING_UNKNOWN) {
    this.pendingCrashReports_.push(crash_data);
    return;
  }

  if (this.crashReportingEnabled_ == _CRASH_REPORT_SETTING_DISABLED) {
    showCrashInfo_(
        'Crash reporting not enabled in Chrome.  Please enable it.');
    return;
  }

  if (crashIsTooOld_(crash_data))
    return;

  // For information on crash reporting see:
  // https://code.google.com/p/google-breakpad/wiki/GettingStartedWithBreakpad
  var params = new FormData();
  for (var item in crash_data) {
    if (item == 'upload_file_minidump')
      params.append(item, new Blob([crash_data[item]]));
    else
      params.append(item, crash_data[item]);
  }
  var request = new XMLHttpRequest();
  request.open('POST', 'http://localhost', true);
  request.onreadystatechange = function() {
    if (request.readyState == 4) {
      if (request.status == 200) {
        var id = request.responseText;
        showCrashInfo_('Successfully uploaded crash report', id);
      } else {
        var msg = 'Failed to report crash, status: ' + request.status;
        showCrashInfo_(msg);
      }
    }
  };
  console.log('Attempting to report crash...');
  request.send(params);
};


/** @private */
CrashReporter.prototype.sendPendingCrashReports_ = function() {
  if (this.crashReportingEnabled_ != _CRASH_REPORT_SETTING_UNKNOWN) {
    for (var i = 0; i < this.pendingCrashReports_.length; i++)
      this.sendCrashReport_(this.pendingCrashReports_[i]);
    this.pendingCrashReports_ = [];
  }
};


/** @public */
CrashReporter.prototype.setCrashReportingEnabled = function(value) {
  this.crashReportingEnabled_ = value;
  this.sendPendingCrashReports_();
};


function printMiniDump_(minidump) {
  if (minidump != null) {
    var data = '';
    var minidumpb = new Uint8Array(minidump);
    for (var i = 0; i < minidumpb.byteLength; i++) {
      data += String.fromCharCode(minidumpb[i]);
    }
    var base64Data = window.btoa(data);
    // The size of base64Data is around 10K bytes, which is not too huge
    // to be output to the log.
    console.error('@@@Minidump generated@@@' + base64Data + '@@@');
  }
}


/**
 * @public
 *
 * Report crash dump.
 *
 * @param message An error message on the crash dump
 * @param minidump Crash dump data.
 * @param {Object=} opt_windowCrashData Metadata to be merged to crash_data.
 */
CrashReporter.prototype.reportCrash = function(
    message, minidump, opt_windowCrashData) {
  var self = this;  // For closure.
  var crash_data = {};
  var version;

  console.log('Received a crash');
  return requestRuntimeManifest().then(function(manifest) {
    var build_tag = getBuildTagFromManifest(manifest);
    // Stripping arc-runtime off the build number as the crash server does not
    // seem to accept version strings over 32 characters.
    version = build_tag.replace(/^arc-runtime-/, '');

    crash_data = {
      prod: 'ARC',
      arc_app_name: arcMetadata.getValue('name'),
      ptime: new Date() - self.startTime_,
      crash_time: new Date(),
      ver: version,
      arc_build_tag: build_tag,
      message: message,
      chrome_version: navigator.appVersion.match(/Chrome\/(\S*)/)[1],
      app_id: chrome.runtime.id,
      app_version: chrome.runtime.getManifest()['version'] || '',
      app_package_name: arcMetadata.getValue('packageName'),
      runtime_name: getManifestItem(manifest, 'name', 'unknown'),
      runtime_update_url: getManifestItem(manifest, 'update_url', 'unknown')
    };
    if (!!opt_windowCrashData) {
      for (var i in opt_windowCrashData) {
        crash_data[i] = opt_windowCrashData[i];
      }
    }

    var cros_version = navigator.appVersion.match(/CrOS\s(\S*)\s([^)]*)/);
    if (cros_version) {
      crash_data['cros_version'] = cros_version[2];
    }

    if (minidump != null)
      crash_data['upload_file_minidump'] = minidump;

    return PromiseWrap.getPlatformInfo();
  }).then(function(info) {
    crash_data['arch'] = info.arch;
    crash_data['nacl_arch'] = info.nacl_arch;
    crash_data['os'] = info.os;
    return getCwsInstalled();
  }).then(function(is_cws_installed) {
    // Print out a copy of the crash data to the console for debugging.
    for (var item in crash_data) {
      if (item != 'upload_file_minidump')
        console.log(item + ': ' + crash_data[item]);
    }

    // Send crash report only when the app was installed via Chrome
    // Web Store. Otherwise, log crash report locally.
    if (is_cws_installed) {
      self.sendCrashReport_(crash_data);
    } else {
      showCrashInfo_('Not installed from CWS, not sending crash report.');
      printMiniDump_(minidump, version);
    }

    // Launch chrome scripts interpret this message as an indication of crash.
    // The message must be synchronized with _CRASH_RE in
    // src/build/util/output_handler.py.
    if (self.logFinishReportingCrash)
      console.log('FINISHED REPORTING CRASH');
  });
};


/**
 * @private
 */
CrashReporter.prototype.readFromStorage_ = function(onRead) {
  // Get any pending crash reports that have been stored from a previous run
  // which was unable to send them.
  chrome.storage.local.get(_CRASH_REPORT_STORAGE_KEY, function(result) {
    var parsed_array = result[_CRASH_REPORT_STORAGE_KEY] ?
        JSON.parse(result[_CRASH_REPORT_STORAGE_KEY]) : [];
    for (var i = 0; i < parsed_array.length; i++) {
      this.pendingCrashReports_.push(parsed_array[i]);
    }
    chrome.storage.local.remove(_CRASH_REPORT_STORAGE_KEY);
    if (onRead)
      onRead();
  }.bind(this));
};


/**
 * @private
 */
CrashReporter.prototype.writeToStorage_ = function(onWrite) {
  var dict = {};
  dict[_CRASH_REPORT_STORAGE_KEY] =
      JSON.stringify(this.pendingCrashReports_);
  chrome.storage.local.set(dict, function() {
    if (chrome.runtime.lastError) {
      console.error('Unable to set storage for pending crash reports');
      console.error('Reason: ' + runtime.lastError);
    }
    if (onWrite)
      onWrite();
  });
};


/**
 * @public
 */
CrashReporter.prototype.init = function(onInitComplete) {
  this.startTime_ = new Date();
  setTimeout(function() {
    this.readFromStorage_(function() {
      this.sendPendingCrashReports_();
      this.didReadFromStorage_ = true;
      if (onInitComplete)
        onInitComplete();
    }.bind(this));
  }.bind(this), _CRASH_REPORT_STORAGE_BOOT_DELAY);
};


/**
 * @public
 *
 * Called when everything is shutting down.  The crash reporter will store
 * pending crash reports to local storage for next launch.
 */
CrashReporter.prototype.shutDown = function(onShutdownComplete) {
  if (this.crashReportingEnabled_ == _CRASH_REPORT_SETTING_UNKNOWN &&
      this.pendingCrashReports_.length > 0) {
    if (!this.didReadFromStorage_) {
      this.readFromStorage_(function() {
        this.writeToStorage_(onShutdownComplete);
      }.bind(this));
    } else {
      this.writeToStorage_(onShutdownComplete);
    }
  }
};

// Global variable in the background page context.
var crashReporter = new CrashReporter();
