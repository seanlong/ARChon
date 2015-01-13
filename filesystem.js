// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// HTML5 filesystem code.


/** @const */
var FS_QUOTA = 20 * 1024 * 1024 * 1024;  // 20GB


/** @const
 *
 * The total number of callbacks we need to wait for before HTML5 FS
 * initialization is done, which are:
 *  1) The callback for ensureFilesAndDirectoriesCreated_.
 *  2) The callback for prefetchFileMetadata_.
 *  3) handleAppPluginReady_.
 *
 * */
var _FS_INIT_CALLBACK_COUNT = 3;



/**
 * @constructor
 *
 * Sets up a component to handle fileSystem message from the runtime.
 *
 * @param plugin Plugin instance.
 */
function FileSystemManager(plugin, on_initialized_callback) {
  /** @private */
  this.plugin_ = plugin;

  /** @private */
  this.callbacks_ = [];

  /** @private */
  this.fileSystemInitCallbackCount_ = 0;

  /** @private */
  this.onInitializedCallback_ = on_initialized_callback;

  /** @private */
  this.retainedExternalFileSystemKey_ = 'retainedExternalFileSystemKey';

  /** @private */
  this.prefetchedMetadata_ = [];

  var self = this;

  plugin.addMessageListener('jsFileSystem', function(message) {
    self.handleMessage_(message);
  });

  if (document.readyState == 'loading') {
    // Start prefetching FS after DOMContentLoaded is fired so that plugin
    // initialization such as embedding arc.nexe starts earlier.
    document.addEventListener('DOMContentLoaded',
                              this.prefetchFileSystemMetadata_.bind(this));
  } else {
    // For tests the page is entirely loaded by the time we initialize
    // the filesystem, so if that is the case, prefetch on creation.
    this.prefetchFileSystemMetadata_();
  }
}


/**
 * See third_party/android/system/core/rootdir/init.rc for how Android setups
 * these directories.
 * @private
 */
FileSystemManager.prototype.ensureFilesAndDirectoriesCreated_ =
    function(fs) {
  // /data/data is the legacy directory before multi-login support.  In
  // third_party/android/frameworks/base/cmds/installd/installd.c,
  // it creates a symlink from /data/user/0 to /data/data for compatibility.
  // TODO(crbug.com/237185): In our case, since we don't have symlink
  // support for now, we just create two separated directories, assuming
  // that most apps won't use both directories.
  var directories = [
    '/cache',
    '/data',
    '/data/app',
    '/data/app-lib',
    '/data/dalvik-cache',
    '/data/data',
    '/data/data/org.chromium.arc',
    '/data/data/org.chromium.arc/lib',
    '/data/misc',
    '/data/misc/keystore',
    '/data/system',
    '/data/system/dropbox',
    '/data/system/ifw',
    '/data/system/inputmethod',
    '/data/system/netstats',
    '/data/system/procstats',
    '/data/system/sync',
    '/data/system/usagestats',
    '/data/system/users',
    '/data/system/users/0',
    '/dev',
    '/storage',
    '/storage/sdcard',
    '/sys'
  ];
  var directories_check_only = [
    // TODO(crbug.com/285588): Add a new chrome.extension API to check more
    // variety of files and directories with fewer IPCs.
    '/data/app-lib/arc',
    '/data/app-private',
    '/data/system/registered_services'
  ];
  var directories_for_default_packages = [
    '/storage/sdcard/Android/data/' + this.plugin_.getMetadata().packageName,
    '/storage/sdcard/Android/data/com.android.providers.contacts'
  ];
  if (this.plugin_.metadata_ &&
      this.plugin_.metadata_.useGoogleContactsSyncAdapter) {
    directories_for_default_packages.push('/storage/sdcard/Android/data' +
        '/com.google.android.syncadapters.contacts');
  }
  if (this.plugin_.metadata_ &&
      this.plugin_.metadata_.usePlayServices &&
      this.plugin_.metadata_.usePlayServices.length > 0) {
    directories_for_default_packages.push('/storage/sdcard/Android/data' +
        '/com.google.android.gms');
  }

  if (this.plugin_.metadata_ &&
      this.plugin_.metadata_.enableExternalDirectory) {
    // When enableExternalDirectory is true, directories_for_default_packages
    // are mount points. Mount points have to be created beforehand.
    directories = directories.concat(['/storage/sdcard/Android',
                                      '/storage/sdcard/Android/data'].concat(
        directories_for_default_packages));
  } else {
    directories_check_only =
        directories_check_only.concat(directories_for_default_packages);
  }

  var self = this;
  var onCreate = function(path, entry) {
    var result = { fullPath: path, exists: true, isFile: false,
                   // Use string for mtime and size. See prefetchFileMetadata_
                   // for more details. For directories, we do not have to
                   // provide mtime as posix_translation does not use it at all.
                   mtime_ms: '0', size: '4096' };
    self.prefetchedMetadata_.push(result);
  };

  var onCreateFail = function(path, err) {
    var result = { fullPath: path, exists: false };
    self.prefetchedMetadata_.push(result);
  };

  var promises = directories.map(function(path) {
    return PromiseWrap.getDirectory(fs.root, path,
                                    { create: true }).then(function(entry) {
      onCreate(path, entry);
      return Promise.resolve();
    }, function(error) {
      onCreateFail(path, error);

      // Some failure is expected, so to not to mask real errors, make
      // this a success.
      return Promise.resolve();
    });
  }).concat(directories_check_only.map(function(path) {
    return PromiseWrap.getDirectory(fs.root, path,
                                    { create: false }).then(function(entry) {
      onCreate(path, entry);
      return Promise.resolve();
    }, function(error) {
      onCreateFail(path, error);

      // Some failure is expected, so to not to mask real errors, make
      // this a success.
      return Promise.resolve();
    });
  }));
  return Promise.all(promises).then(function() {
  }, function(err) {
    // Should not come here usually unless there is some unexpected
    // error.
    console.error(err);
    throw err;
  });
};


/** @private */
FileSystemManager.prototype.prefetchFileMetadata_ = function(fs) {
  var files = [
    // TODO(crbug.com/285588): Add a new chrome.extension API to check more
    // variety of files and directories with fewer IPCs. We should definitely
    // remove the hand-made list of files to query once such a useful API is
    // ready.
    '/data/data/com.android.settings/files/wallpaper',
    '/data/local.prop',
    '/data/security/mac_permissions.xml',
    '/data/system/accounts.db',
    '/data/system/appops.xml',
    '/data/system/appops.xml.bak',
    '/data/system/called_pre_boots.dat',
    '/data/system/devices/idc/PPAPI_Keyboard.idc',
    '/data/system/devices/keychars/PPAPI_Keyboard.kcm',
    '/data/system/devices/keylayout/Virtual.kl',
    '/data/system/display_settings.xml',
    '/data/system/display_settings.xml.bak',
    '/data/system/inputmethod/subtypes.xml',
    '/data/system/inputmethod/subtypes.xml.bak',
    '/data/system/notification_policy.xml',
    '/data/system/notification_policy.xml.bak',
    '/data/system/packages-backup.xml',
    '/data/system/packages-compat.xml',
    '/data/system/packages-compat.xml.bak',
    '/data/system/packages-stopped-backup.xml',
    '/data/system/packages-stopped.xml',
    '/data/system/packages.list',
    '/data/system/packages.xml',
    '/data/system/registered_services/android.accounts.AccountAuthenticator.xml',
    '/data/system/registered_services/android.accounts.AccountAuthenticator.xml.bak',
    '/data/system/registered_services/android.content.SyncAdapter.xml',
    '/data/system/sync/accounts.xml',
    '/data/system/sync/accounts.xml.bak',
    '/data/system/sync/pending.bin',
    '/data/system/sync/pending.xml',
    '/data/system/sync/pending.xml.bak',
    '/data/system/sync/stats.bin',
    '/data/system/sync/stats.bin.bak',
    '/data/system/sync/status.bin',
    '/data/system/sync/status.bin.bak',
    '/data/system/syncmanager.db',
    '/data/system/urigrants.xml',
    '/data/system/urigrants.xml.bak',
    '/data/system/usagestats/usage-history.xml',
    '/data/system/users/0.xml',
    '/data/system/users/0.xml.bak',
    '/data/system/users/0/accounts.db',
    '/data/system/users/0/accounts.db-journal',
    '/data/system/users/0/accounts.db-wal',
    '/data/system/users/0/package-restrictions-backup.xml',
    '/data/system/users/0/package-restrictions.xml',
    '/data/system/users/0/wallpaper',
    '/data/system/users/0/wallpaper_info.xml',
    '/data/system/users/0/wallpaper_info.xml.tmp',
    '/data/system/users/userlist.xml',
    '/data/system/users/userlist.xml.bak',
    '/data/system/wallpaper_info.xml'
  ];

  var self = this;
  var onGetMetadata = function(entry, metadata) {
    var result = { fullPath: entry.fullPath, exists: true,
                   isFile: entry.isFile,
                   // Milliseconds since Unix epoch. Use string since the
                   // valid mtime in milliseconds as of today is more than
                   // INT_MAX. The JSON reader and base::Value class in
                   // Chromium base do not support 64bit integer.
                   mtime_ms: String(metadata.modificationTime.getTime()),
                   // The same as above. To support >2GB files, use string.
                   size: String(metadata.size) };
    self.prefetchedMetadata_.push(result);
  };
  var onGetFail = function(filename) {
    // TODO(crbug.com/285588): This path is also taken when the file name is
    // actually a directory. In that case, we should not update the
    // |prefetchedMetadata_| array.
    var result = { fullPath: filename, exists: false };
    self.prefetchedMetadata_.push(result);
  };
  var promises = files.map(function(filename) {
    var fileEntry;
    PromiseWrap.getFile(
        fs.root,
        filename,
        { create: false }).then(function(entry) {
      fileEntry = entry;
      return PromiseWrap.getMetadata(entry);
    }).then(function(metadata) {
      onGetMetadata(fileEntry, metadata);
      return Promise.resolve();
    }, function(error) {
      onGetFail(filename);
      return Promise.resolve();
    });
  });
  return Promise.all(promises).then(function() {
    return Promise.resolve();
  }, function(err) {
    // Should not come here usually.
    console.error(err);
    throw err;
  });
};


/** @private */
FileSystemManager.prototype.prefetchFileSystemMetadata_ =
    function(command, data) {
  /** @const */
  var FS_REQUEST_FS = 'ARC HTML5 FS: Request FileSystem';
  /** @const */
  var FS_MKDIR = 'ARC HTML5 FS: ensureFilesAndDirectoriesCreated_';
  /** @const */
  var FS_PREFETCH = 'ARC HTML5 FS: prefetchFileMetadata_';

  console.time(FS_REQUEST_FS);
  // Call fs.root.getFile() as soon as possible for faster plugin startup
  // (crbug.com/170265). Calling the method forces the storage manager to run
  // the initilization code in an asynchronous manner.

  /**
   * Holds the HTML5 FileSystem object.
   * @type {FileSystem|undefined}
   */
  var fs;
  var filesystemReadyPromise = PromiseWrap.webkitRequestFileSystem(
      // The second parameter is an indicator of how much storage space the
      // application expects to need (http://www.w3.org/TR/file-system-api/,
      // 4.4.1.1 Methods). We can actually pass an arbitrary non-zero number
      // since Chrome simply ignores the information.
      window.PERSISTENT, FS_QUOTA).then(function(filesystem) {
    console.timeEnd(FS_REQUEST_FS);
    fs = filesystem;
    return Promise.resolve();
  });

  var self = this;
  var promises = [
    filesystemReadyPromise.then(function() {
      console.time(FS_MKDIR);
      return self.ensureFilesAndDirectoriesCreated_(fs);
    }).then(function() {
      console.timeEnd(FS_MKDIR);
      self.postFileSystemReadyMessageIfNeeded();
      return Promise.resolve();
    }),
    filesystemReadyPromise.then(function() {
      console.time(FS_PREFETCH);
      return self.prefetchFileMetadata_(fs);
    }).then(function() {
      console.timeEnd(FS_PREFETCH);
      self.postFileSystemReadyMessageIfNeeded();
      return Promise.resolve();
    })];

  return Promise.all(promises).then(function() {
  }, function(err) {
    console.error(err);
    throw err;
  });
};


/**
 * @private
 *
 * Posts a message to plugin.
 */
FileSystemManager.prototype.postMessage_ = function(namespace, command, data) {
  var message = {
    namespace: namespace,
    command: command,
    data: data
  };
  this.plugin_.postMessage(message);
};


/**
 * @private
 *
 * Posts a message to plugin, then calls the callback function when the plugin
 * sends the reply message.
 */
FileSystemManager.prototype.postMessageAndReply_ =
    function(namespace, command, data, cb) {
  this.postMessage_(namespace, command,
                    {messageId: this.callbacks_.length, info: data});
  this.callbacks_.push(cb);
};


/** @private */
FileSystemManager.prototype.updateExtDirButtonVisibility_ = function(visible) {
  document.getElementById('extdir-button').className =
      visible ? 'button' : 'hiddenbutton';
};


/** @private */
FileSystemManager.prototype.handleMessage_ = function(message) {
  // Call reply function if corresponding callback function is registerd.
  if (message.data.messageId != undefined &&
      message.data.messageId < this.callbacks_.length) {
    this.callbacks_[message.data.messageId](message.data);
    this.callbacks_[message.data.messageId] = null;
    return;
  }

  if (message.command == 'openExternalFile') {
    this.handleOpenExternalFileMessage_(message.data);
  } else if (message.command == 'openExternalDirectory') {
    this.handleOpenExternalDirectoryMessage_();
  } else if (message.command == 'requestFileFromFileHandler') {
    this.handleRequestFileFromFileHandler_();
  }
};


/** @private */
FileSystemManager.prototype.sendMountExtDirMessage_ =
    function(fileSystem, fullPath) {
  this.postMessageAndReply_(
      'pluginFileSystemManager',
      'mountExternalDirectory',
      {fileSystem: fileSystem, fullPath: fullPath, writable: true},
      function() {});
};


/** @private */
FileSystemManager.prototype.handleOpenExternalDirectoryMessage_ = function() {
  console.assert(this.plugin_.getMetadata().enableExternalDirectory);

  var self = this;
  PromiseWrap.getLocalStorageValue(
      self.retainedExternalFileSystemKey_).then(function(key) {
    return PromiseWrap.isFilesystemRestorable(key);
  }).then(function(key) {
    return PromiseWrap.restoreFilesystem(key);
  }).then(function(entry) {
    self.sendMountExtDirMessage_(entry.filesystem, entry.fullPath);
    self.updateExtDirButtonVisibility_(true);
  }, function(err) {
    // Reaching here is totally fine. The retained external directory may no
    // longer available or accessible. Just open dialog again to choose new
    // external directory.
    self.openAndMountExternalDirectory(
        false /* no need to reset external file handler*/);
  });
};


/** @public */
FileSystemManager.prototype.postFileSystemReadyMessageIfNeeded =
    function() {
  this.fileSystemInitCallbackCount_++;
  console.log('File system initialization ' +
              this.fileSystemInitCallbackCount_ + '/' +
              _FS_INIT_CALLBACK_COUNT);
  if (this.fileSystemInitCallbackCount_ == _FS_INIT_CALLBACK_COUNT) {
    this.postMessage_('pluginFileSystemManager', 'ready',
                      { value: this.prefetchedMetadata_ });
  } else if (this.fileSystemInitCallbackCount_ == _FS_INIT_CALLBACK_COUNT - 1) {
    // Now the browser process is likely idle. Show the app window.
    this.onInitializedCallback_();
  }
};


/**
 * @public
 *
 * Opens directory chooser and mount it to /stroage/sdcard as external storage.
 *
 * @param needResetBeforeMount Resets the external file handler to initial
 * state.
 **/
FileSystemManager.prototype.openAndMountExternalDirectory = function(
    needResetBeforeMount) {
  if (!this.plugin_.getMetadata().enableExternalDirectory)
    return;

  var self = this;
  PromiseWrap.chooseEntry({type: 'openDirectory'}).then(function(entry) {
    if (needResetBeforeMount) {
      self.postMessage_('pluginFileSystemManager', 'resetExternalDirectory',
                        {});
    }

    self.sendMountExtDirMessage_(entry.filesystem, entry.fullPath);
    self.updateExtDirButtonVisibility_(true);

    // Retains chosen entry to be able to use next time launch.
    var obj = {};
    obj[self.retainedExternalFileSystemKey_] =
        chrome.fileSystem.retainEntry(entry);
    chrome.storage.local.set(obj, function() {});
  }, function(err) {
    if (err.message == 'User cancelled.') {
      // If user cancels directory choosing do nothing,
      // TODO(crbug.com/317282): Need revisit UX for directory choosing and
      // reconfiguration.
      return;
    } else {
      throw err;
    }
  });
};


/**
 * @private
 *
 * Handles a "openExternalFile" command message.
 */
FileSystemManager.prototype.handleOpenExternalFileMessage_ = function(data) {
  var options = {
    type: data.type.valueOf()
  };

  if (data.type == 'openFile') {
    options.accepts = [{ mimeTypes: data.acceptTypes.valueOf() }];
  } else {
    options.suggestedName = data.suggestedName.valueOf();
  }

  var self = this;
  PromiseWrap.chooseEntry(options).then(function(entry) {
    // Succeeded choosing file with 'saveFile' means the passed file entry is
    // writable.
    var isWritable = (data.type == 'saveFile');
    return PromiseWrap.mountExternalFile(entry, self, isWritable);
  }).then(function(replyData) {
    self.postMessage_(data.requester,
                      'openExternalFileResponse',
                      { result: true, path: replyData.info.mountPoint });
  }, function(err) {
    if (err.message != 'User cancelled.') {
      console.error(err);
    }
    self.postMessage_(data.requester,
                      'openExternalFileResponse',
                      { result: false });
  });
};


/**
 * @private
 *
 * Mount file entry passed from file handlers and reply to
 * "requestFileFromFileHandler" message.
 */
FileSystemManager.prototype.handleRequestFileFromFileHandler_ = function() {
  // Check if chrome.app.window.current().launchArgs.items exists.
  var items = window['arc'].launchArgs.items;
  if (!items || !items.length) {
    return;
  }

  var entry = items[0].entry;
  var mimeType = items[0].type;

  var self = this;
  PromiseWrap.mountExternalFile(entry, self, true).then(function(data) {
    self.plugin_.postMessage({
      namespace: 'androidFileHandler',
      command: 'requestFileFromFileHandlerResponse',
      data: {result: true, path: data.info.mountPoint, mimeType: mimeType}});
  }, function(err) {
    console.error(err);
    self.plugin_.postMessage({
      namespace: 'androidFileHandler',
      command: 'requestFileFromFileHandlerResponse',
      data: {result: false }});
  });
};
