// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// File system worker script for driveby mode.
// It initilizes the pepper file system and stores the APK into the pepper file
// system.


(function() {

  /** @const */
  var DEBUG = true;

  var fs;

  function log(msg, force) {
    if (DEBUG || force)
      postMessage('fsworker: ' + msg);
  }

  function resetFileSystem() {
    var entries = fs.root.createReader().readEntries();
    for (var i = 0; i < entries.length; ++i) {
      var entry = entries[i];
      log('Remove ' + entry.name);
      if (entry.removeRecursively) {
        entry.removeRecursively();
      } else {
        entry.remove();
      }
    }
  }

  function removeFile(path) {
    try {
      var entry = fs.root.getFile(path, {create: false});
      entry.remove();
    } catch (error) {
      log('removeFile(' + path + ') : ' + error.toString());
    }
  }

  function writeFile(path, blob) {
    // Remove the file if it already exists.
    removeFile(path);
    var writer = fs.root.getFile(path,
        {create: true, exclusive: true}).createWriter();
    writer.write(blob);
  }

  function initFileSystem(quota, src, dest) {
    fs = webkitRequestFileSystemSync(PERSISTENT, quota);

    if (DEBUG && false) {
      // Reset file system. It is for debugging only.
      resetFileSystem(fs.root);
    }

    fs.root.getDirectory('mnt', {create: true});
    fs.root.getDirectory('mnt/tmp', {create: true});
    var xhr = new XMLHttpRequest();
    xhr.open('GET', src, false);
    xhr.responseType = 'blob';
    xhr.send(null);
    // TODO(penghuang): remove temporary files when ARC is shut down.
    writeFile(dest, xhr.response);
    log('Copy ' + src + ' to ' + dest);
  }

  onmessage = function(msg) {
    var data = msg.data;
    try {
      initFileSystem(data.quota, data.src, data.dest);
      postMessage('Done');
    } catch (error) {
      log('Initializing HTML failed: ' + error, true);
      postMessage('Failed');
    }
  };

})();
