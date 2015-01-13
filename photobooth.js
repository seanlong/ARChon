// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// A minimalist photobooth to fulfill CAMERA_CAPTURE Android Intents.



/**
 * @constructor
 *
 * Sets up a component to track the state of the plugin.
 */
function PhotoBooth(plugin) {
  /** @private */
  this.plugin_ = plugin;

  /** @private */
  this.backdrop_ = null;

  /** @private */
  this.video_ = null;

  /** @private */
  this.captureButton_ = null;

  /** @private */
  this.cancelButton_ = null;

  /** @private */
  this.videoTrack_ = null;

  /** @private */
  this.keyEventHandler_ = this.handleKeyEvent_.bind(this);
}


/**
 * Adds the message listener for the jsCamera namespace
 */
PhotoBooth.prototype.addMessageListeners = function() {
  this.plugin_.addMessageListener('jsCamera', this.handleMessage_.bind(this));
};


/** @private */
PhotoBooth.prototype.handleKeyEvent_ = function(e) {
  if (e.keyCode == 27) {  // ESC
    this.cancelCapture_();
  }
};


/** @private */
PhotoBooth.prototype.handleMessage_ = function(message) {
  if (message.command != 'captureImageRequest') {
    console.error('Received unknown camera message: ', message);
    return;
  }

  // Disable events in ARC.
  this.plugin_.postMessage({
    namespace: 'pluginInputManager',
    command: 'suspendInput',
    data: {}});

  this.createElements_();

  this.cancelButton_.addEventListener('click', this.cancelCapture_.bind(this));

  document.body.appendChild(this.backdrop_);
  document.addEventListener('keyup', this.keyEventHandler_);
  var self = this;
  this.video_.addEventListener('playing', function() {
    // The MediaStream object might be ready, but we actually need to wait
    // until the video object starts displaying frames in order to be able
    // to capture one.
    self.captureButton_.className = 'ready';
    self.captureButton_.addEventListener('click',
                                         self.finishCapture_.bind(self));
  });
  navigator.webkitGetUserMedia({video: true}, function(stream) {
    self.video_.src = window.URL.createObjectURL(stream);
    self.videoTrack_ = stream.getVideoTracks()[0];
  }, function(err) {
    console.error('Video stream failed to open', err);
    self.cancelCapture_();
  });
};


/** @private */
PhotoBooth.prototype.sendResponse_ = function(response) {
  var responseMessage = {
    namespace: 'androidCameraIntentHandler',
    command: 'captureImageResponse',
    data: {
      result: response
    }
  };
  this.plugin_.postMessage(responseMessage);
};


/**
 * @private
 *
 * Creates all UI elements and prepares them to be displayed.
 */
PhotoBooth.prototype.createElements_ = function() {
  // TODO(crbug.com/386817): Improve the UI.
  this.backdrop_ = document.createElement('div');
  this.video_ = document.createElement('video');
  this.cancelButton_ = document.createElement('a');
  this.captureButton_ = document.createElement('a');
  this.videoTrack_ = null;

  // Create an opaque backdrop covering the whole window to make the photobooth
  // modal.
  this.backdrop_.setAttribute('id', 'photo-booth');

  // Create an image preview pane.
  this.video_.setAttribute('autoplay', 'autoplay');
  this.video_.addEventListener('playing', this.handlePlaying_.bind(this));
  this.backdrop_.appendChild(this.video_);

  // Create a button that will capture the image when pressed.
  this.captureButton_.setAttribute('id', 'capture-button');
  this.backdrop_.appendChild(this.captureButton_);

  // Create a button that will capture the image when pressed.
  this.cancelButton_.setAttribute('id', 'cancel-button');
  this.backdrop_.appendChild(this.cancelButton_);
};


/**
 * @private
 *
 * Closes the video preview and remove all elements from the plugin window.
 */
PhotoBooth.prototype.close_ = function() {
  // Resume input processing in ARC.
  this.plugin_.postMessage({
    namespace: 'pluginInputManager',
    command: 'resumeInput',
    data: {}});

  if (this.videoTrack_ != null) {
    this.videoTrack_.stop();
    this.videoTrack_ = null;
  }
  document.body.removeChild(this.backdrop_);
  document.removeEventListener('keyup', this.keyEventHandler_);
  this.backdrop_ = null;
  this.video_ = null;
  this.cancelButton_ = null;
  this.captureButton_ = null;
};


/**
 * @private
 *
 * Sends back a data-uri representation of the image in JPEG format.
 */
PhotoBooth.prototype.finishCapture_ = function() {
  var canvas = document.createElement('canvas');
  canvas.setAttribute('width', this.video_.videoWidth);
  canvas.setAttribute('height', this.video_.videoHeight);
  var ctx = canvas.getContext('2d');
  ctx.drawImage(this.video_, 0, 0);

  // TODO(lhchavez): use toBlob to generate a binary version and plumb it
  // through Java to avoid the data-uri parsing.
  this.sendResponse_(canvas.toDataURL('image/jpeg'));
  this.close_();
};


/**
 * @private
 *
 * Sends an empty response and free all resources.
 */
PhotoBooth.prototype.cancelCapture_ = function() {
  this.sendResponse_();
  this.close_();
};


/**
 * @private
 *
 * Centers the video preview vertically in the window once the video dimensions
 * are known.
 */
PhotoBooth.prototype.handlePlaying_ = function() {
  // The video may have been removed by this point.
  if (!this.video_) return;
  this.video_.style.display = 'block';
  this.video_.style.top =
      ((window.innerHeight - this.video_.offsetHeight) / 2) + 'px';
};
