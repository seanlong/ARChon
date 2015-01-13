// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Common classes for ARC
//
// For the getCurrentZoom() function:
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.


/** @const */
var _TOPBAR_HEIGHT = 32;


// The values in _ALLOWED_VALUES_MAP must be synchronized with _ALLOWED_* in
// src/build/launch_chrome_options.py.
/** @const */
var _ALLOWED_VALUES_MAP = {
  formFactor: ['phone', 'tablet'],
  fpsLimit: [10, 12, 15, 20, 30],
  ndkAbi: ['armeabi', 'armeabi-v7a'],
  orientation: ['landscape', 'portrait'],
  resize: ['disabled', 'scale'],
  stderrLog: ['D', 'V', 'I', 'W', 'E', 'F', 'S']
};


// Namespace
var _common = {
  cachedRuntimeManifestPromise: null
};


/**
 * We cannot use \0 because these attributes are passed as NULL
 * delimited strings.  We cannot use non-breaking space because it
 * gets converted to UTF8 and we do not want to treat all
 * attributes as UTF8.
 * @const
 */
var _STRING_DELIMITER = '\u0001';


/**
 * The window sizes in DPs for each form factor. For better app compatibility,
 * it is better to use the same window size as Nexus phones/tablets. "DP" is
 * the unit in Android. Do not confuse it with "DIP" which is the unit in
 * Chrome. See crbug.com/387881#c14 for more details.
 * @const
 */
var _TARGET_ANDROID_DP = {
  'phone': {
    // 640x360 in DPs is compatible with Nexus 5.
    'long': 640,
    'short': 360
  },
  'tablet': {
    // 1280x800 in DPs is compatible with Nexus 10.
    'long': 1280,
    'short': 800
  }
};


/**
 * @public
 *
 * Get the timezone string (e.g., GMT-05:00)
 *
 * @return timezone string.
 */
function getTimeZone() {
  var offset = -(new Date()).getTimezoneOffset();
  var sign = offset >= 0 ? '+' : '-';
  offset = Math.abs(offset);
  var offsetHours = String(Math.floor(offset / 60));
  var offsetMinutes = String(offset % 60);
  if (offsetHours.length == 1)
    offsetHours = '0' + offsetHours;
  if (offsetMinutes.length == 1)
    offsetMinutes = '0' + offsetMinutes;
  var timezone = 'GMT' + sign + offsetHours + ':' + offsetMinutes;
  return timezone;
}


/**
 * @public
 *
 * Get the language and country code string.
 *
 * @return Locale object.
 */
function getLocale() {
  var raw_locale = window.navigator.language;
  if (raw_locale == 'es-419') {
    // Chrome sets 'es-419' for Spanish in Latin America, but it is not
    // compatible with ISO 3166-1, so use 'es' instead.
    raw_locale = 'es';
  }
  // Chrome presents the ISO 639-1 compliant two-letter lower-case language
  // code and optional ISO 3166-1 compliant two-letter uppercase country code.
  // They are concatenated with hyphen.
  var locale = raw_locale.split('-');
  return {
    language: locale[0],
    country: locale[1]
  };
}


/**
 * @public
 *
 * Insert an svg element into the DOM. svg elements have the |currentScale|
 * property, that returns the document's zoom factor, regardless of the
 * device's physical display density. This value is also independent from
 * the global screen zoom present in Chrome OS.
 *
 * This was taken from the hterm source code:
 * https://github.com/libapps/libapps-mirror/blob/119c9fe7c3fa308de1a88789d06ba7dde062a00b/hterm/js/hterm_scrollport.js#L387
 */
function getCurrentZoom() {
  if (!document.body) {
    // This method might be called from the background page. Return the default
    // zoom in that case since the svg trick will fail.
    return 1.0;
  }
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = (
      'position: absolute;' +
      'visibility: hidden;');
  document.body.appendChild(svg);
  var currentZoom = svg.currentScale;
  document.body.removeChild(svg);

  return currentZoom;
}


var arcMetadata;

// Simple singleton pattern.
(function() {
  function ArcMetadata() {
    // NOTE: If you add metadata that is intended to be used by developers,
    // please update the external-developers.txt documentation for the new
    // keys.
    this.defaults_ = {
      allowEmptyActivityStack: false,
      apkList: [],
      canRotate: false,
      disableAutoBackButton: false,
      enableAdb: false,
      enableArcStrace: false,
      enableExternalDirectory: false,
      enableGlErrorCheck: false,
      enableSynthesizeTouchEventsOnWheel: true,
      formFactor: 'phone',
      fpsLimit: 60,
      isSlowDebugRun: false,
      jdbPort: 0,
      logLoadProgress: false,
      minimumLaunchDelay: 0,
      name: '',
      ndkAbi: '',
      orientation: 'portrait',
      packageName: 'org.chromium.arc',
      resize: 'disabled',
      shell: [],
      stderrLog: 'S',
      useGoogleContactsSyncAdapter: false,
      usePlayServices: [],
      sleepOnBlur: true
    };

    this.data_ = {};
    this.computedValues_ = {};

    if (chrome.runtime && chrome.runtime.getManifest) {
      var manifest = chrome.runtime.getManifest();
      this.data_ = manifest['arc_metadata'] || {};
      // TODO(crbug.com/381689): Remove conversion once apps are all updated.
      if (this.data_.enablePlayServices) {
        this.data_.usePlayServices = ['ALL'];
        delete this.data_.enablePlayServices;
      }
      this.validateData_();
      this.computeValues_(manifest);
    }
  }

  ArcMetadata.prototype.get = function() {
    var combined = {};
    for (var arg in this.defaults_) {
      if (this.defaults_.hasOwnProperty(arg)) {
        if (this.data_.hasOwnProperty(arg)) {
          combined[arg] = this.data_[arg];
        } else {
          combined[arg] = this.defaults_[arg];
        }
      }
    }
    return this.addComputedValues_(combined);
  };

  ArcMetadata.prototype.getValue = function(param) {
    if (this.data_.hasOwnProperty(param)) {
      return this.data_[param];
    }
    if (this.computedValues_.hasOwnProperty(param)) {
      return this.computedValues_[param];
    }
    if (this.defaults_.hasOwnProperty(param)) {
      return this.defaults_[param];
    }
    throw ('unknown arc_metadata param: ' + param);
  };

  /** @private */
  ArcMetadata.prototype.validateData_ = function() {
    for (var arg in this.data_) {
      if (this.data_.hasOwnProperty(arg)) {
        if (this.defaults_.hasOwnProperty(arg)) {
          if (!(typeof this.data_[arg] === typeof this.defaults_[arg])) {
            console.error('Type mismatch of "' + arg + '" in ARC metadata');
            console.group();
            console.error('Default type: ' + typeof this.defaults_[arg]);
            console.error('Current type: ' + typeof this.data_[arg]);
            console.groupEnd();
          }
        } else {
          console.error('Unknown property "' + arg + '" in ARC metadata');
        }
      }
      if (arg in _ALLOWED_VALUES_MAP) {
        var value = this.data_[arg];
        var allowedValues = _ALLOWED_VALUES_MAP[arg];
        if (allowedValues.indexOf(value) == -1) {
          console.group();
          console.error('Invalid value of ' + arg + ': ' + value);
          console.error('It must be one of: ' + allowedValues.join(', '));
          console.groupEnd();
        }
      }
    }
  };

  /** @private
   *
   * Gets the density DPI (aka ro.sf.lcd_density) setting ARC should use.
   *
   * @return A number between 120 and 640.
   */
  ArcMetadata.prototype.getAndroidDensityDpi_ =
      function(formFactor, chromeDevicePixelRatio) {
    // A list of supported ro.sf.lcd_density values in Android CDD.
    var _SUPPORTED_ANDROID_DENSITY_DPIS = [
      120, 160, 213, 240, 320, 400, 480, 640];

    // Match Android's scale factor (aka density) with Chrome's. In Android,
    // 160 DPI means 1.0x scale.
    var optimal_dpi = 160 * chromeDevicePixelRatio;
    if (formFactor == 'tablet') {
      // Use slightly smaller DPI for tabet ARC apps. See crbug.com/387881#c14.
      optimal_dpi *= 0.75;
    }

    // Return one of the supported DPI values that is nearest to |optimal_dpi|.
    var deltas = _SUPPORTED_ANDROID_DENSITY_DPIS.map(function(supported_dpi) {
      return Math.abs(supported_dpi - optimal_dpi);});
    var index = deltas.indexOf(Math.min.apply(Math, deltas));
    return _SUPPORTED_ANDROID_DENSITY_DPIS[index];
  };

  /** @private
   *
   * Computes the Chrome window size based on the app's form factor and the
   * current device pixel ratio.
   *
   * @return A dictionary.
   */
  ArcMetadata.prototype.computeWindowSizeInChromeDips_ =
      function(formFactor, chromeDevicePixelRatio) {
    function ConvertDpToDip(chromeDevicePixelRatio, androidDensityDpi, dp) {
      var androidScaleFactor = androidDensityDpi / 160;  // aka "density"
      // |px| is the number of physical pixels (either width or height) shared
      // by ARC (Chrome) and Android.
      var px = dp * androidScaleFactor;
      var dip = px / chromeDevicePixelRatio;
      return Math.ceil(dip);
    }
    var androidDensityDpi = this.getAndroidDensityDpi_(
        formFactor, chromeDevicePixelRatio);

    var shortAndroidDp = _TARGET_ANDROID_DP[formFactor].short;
    var shortChromeDip = ConvertDpToDip(
        chromeDevicePixelRatio, androidDensityDpi, shortAndroidDp);

    var longAndroidDp = _TARGET_ANDROID_DP[formFactor].long;
    var longChromeDip = ConvertDpToDip(
        chromeDevicePixelRatio, androidDensityDpi, longAndroidDp);

    return {
      'short': shortChromeDip,
      'long': longChromeDip,
      'androidDensityDpi': androidDensityDpi
    };
  };

  /** @private */
  ArcMetadata.prototype.computeValues_ = function(manifest) {
    var devicePixelRatio = window.devicePixelRatio / getCurrentZoom();
    var formFactor = this.getValue('formFactor');

    var size = this.computeWindowSizeInChromeDips_(
        formFactor, devicePixelRatio);
    // Both |width| and |height| are in Chrome DIPs.
    if (this.getValue('orientation') == 'landscape') {
      var width = size.long;
      var height = size.short;
    } else {
      var width = size.short;
      var height = size.long;
    }

    this.computedValues_['width'] = width;
    this.computedValues_['height'] = height;
    this.computedValues_['androidDensityDpi'] = size.androidDensityDpi;

    // TODO(crbug.com/401702): Remove this once all apps that use OAuth2 are
    // repackaged.
    if (manifest.oauth2 && manifest.oauth2.scopes &&
        manifest.oauth2.scopes.indexOf(
            'https://www.google.com/m8/feeds') != -1) {
      this.data_['useGoogleContactsSyncAdapter'] = true;
    }
  };

  /** @private */
  ArcMetadata.prototype.addComputedValues_ = function(dest) {
    for (var key in this.computedValues_) {
      if (this.computedValues_.hasOwnProperty(key))
        dest[key] = this.computedValues_[key];
    }
    return dest;
  };

  arcMetadata = new ArcMetadata;
})();


/**
 * @public
 *
 * Returns the URL to the ARC runtime manifest file.
 */
function getRuntimeManifestURL() {
  // Assume only one module (ARC) is being imported.
  var runtime_id = chrome.runtime.getManifest()['import'][0]['id'];
  var url = chrome.runtime.getURL('/_modules/' + runtime_id + '/manifest.json');
  return url;
}


/**
 * @public
 *
 * Returns a promise that resolves to the JSON parsed runtime manifest object.
 */
function requestRuntimeManifest() {
  if (_common.cachedRuntimeManifestPromise !== null) {
    return _common.cachedRuntimeManifestPromise;
  }
  // Fetch ARC manifest in the background.
  var url = getRuntimeManifestURL();
  _common.cachedRuntimeManifestPromise =
      PromiseWrap.xmlHttpRequest('GET', url).then(JSON.parse);
  return _common.cachedRuntimeManifestPromise;
}


/**
 * @public
 *
 * Returns the value for a given |key| in the |manifest| data provided.
 */
function getManifestItem(manifest, key, default_value) {
  if (manifest.hasOwnProperty(key)) {
    return manifest[key];
  } else {
    return default_value;
  }
}


/** @public */
function getBuildTagFromManifest(manifest) {
  return getManifestItem(manifest, 'arc_build_tag', 'unknown');
}


/**
 * @public
 *
 * Returns a promise that resolves to a boolean of whether the runtime is
 * installed from the Chrome Web Store.  This is useful for writing code that
 * runs only in production or development.
 */
function getCwsInstalled() {
  return new Promise(function(resolve, reject) {
    requestRuntimeManifest().then(function(manifest) {
      // Chrome Webstore automatically adds an update_url field to the manifest.
      if ('update_url' in manifest)
        resolve(true);
      else
        resolve(false);
    });
  });
}
