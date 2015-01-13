// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Make Chrome Apps API promise friendly.  We could get rid of these if they
// are officially supported (crbug.com/328932).

var PromiseWrap = {
  // The following entries are sorted by the original API name.

  // chrome.fileSystem.chooseEntry
  chooseEntry: function(options) {
    return new Promise(function(resolve, reject) {
      chrome.fileSystem.chooseEntry(options, function(entry) {
        if (entry) {
          resolve(entry);
        } else {
          reject(Error('User cancelled.'));
        }
      });
    });
  },

  // chrome.fileSystem.isRestorable
  isFilesystemRestorable: function(key) {
    return new Promise(function(resolve, reject) {
      chrome.fileSystem.isRestorable(key, function(isRestorable) {
        if (isRestorable) {
          resolve(key);
        } else {
          reject(Error('The filesystem is not restorable.'));
        }
      });
    });
  },

  // chrome.fileSystem.restoreEntry
  restoreFilesystem: function(key) {
    return new Promise(function(resolve, reject) {
      chrome.fileSystem.restoreEntry(key, function(entry) {
        if (entry) {
          resolve(entry);
        } else {
          reject(Error(chrome.runtime.lastError.message));
        }
      });
    });
  },

  // chrome.identity.getAuthToken
  getAuthToken: function(detail) {
    return new Promise(function(resolve, reject) {
      chrome.identity.getAuthToken(detail, function(token) {
        if (chrome.runtime.lastError) {
          reject(Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });
  },

  // chrome.runtime.getPlatformInfo
  getPlatformInfo: function() {
    return new Promise(function(resolve, reject) {
      chrome.runtime.getPlatformInfo(function(info) {
        resolve(info);
      });
    });
  },

  // chrome.identity.getProfileUserInfo
  getProfileUserInfo: function() {
    return new Promise(function(resolve, reject) {
      if (!chrome.identity || !chrome.identity.getProfileUserInfo) {
        reject(Error('chrome.identity.getProfileUserInfo is unavailable. ' +
                     'Please make sure your Chrome is at least M37.'));
        return;
      }
      chrome.identity.getProfileUserInfo(function(userinfo) {
        if (chrome.runtime.lastError) {
          reject(Error(chrome.runtime.lastError.message));
        } else {
          resolve(userinfo);
        }
      });
    });
  },

  // chrome.identity.removeCachedAuthToken
  removeCachedAuthToken: function(detail) {
    return new Promise(function(resolve, reject) {
      chrome.identity.removeCachedAuthToken(detail, function() {
        if (chrome.runtime.lastError) {
          reject(Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  },

  // chrome.storage.local.get
  getLocalStorageValue: function(key) {
    return new Promise(function(resolve, reject) {
      chrome.storage.local.get(key, function(items) {
        if (items.hasOwnProperty(key)) {
          resolve(items[key]);
        } else {
          if (chrome.runtime.lastError) {
            console.error('Error on reading local storage, continue anyway: ' +
                chrome.runtime.lastError.message);
          }
          reject(Error('There is no retained filesystem key.'));
        }
      });
    });
  },

  // chrome.storage.local.set
  setLocalStorageValue: function(items) {
    return new Promise(function(resolve, reject) {
      chrome.storage.local.set(items, function(items) {
        if (chrome.runtime.lastError) {
          reject(Error('Cannot save email to local storage: ' +
              chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  },

  // webkitRequestFileSystem
  webkitRequestFileSystem: function(type, quota) {
    return new Promise(function(resolve, reject) {
      window.webkitRequestFileSystem(type, quota, function(fs) {
        resolve(fs);
      }, function(error) {
        reject(Error(error));
      });
    });
  },

  // XMLHttpRequest
  xmlHttpRequest: function(method, url) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.onreadystatechange = function() {
        try {
          if (xhr.readyState == 4) {
            if (xhr.status == 200) {
              resolve(xhr.responseText);
            } else {
              reject(Error(xhr.responseText));
            }
          }
        } catch (e) {
          reject(Error(e));
        }
      };
      xhr.send();
    });
  },

  // The following promises wrap callbacks for the filesystem API.

  getDirectory: function(directoryEntry, path, options) {
    return new Promise(function(resolve, reject) {
      directoryEntry.getDirectory(path, options, function(entry) {
        resolve(entry);
      }, function(error) {
        reject(Error(error));
      });
    });
  },

  getFile: function(directoryEntry, path, options) {
    return new Promise(function(resolve, reject) {
      directoryEntry.getFile(
          path, options,
          function(entry) {
            resolve(entry);
          }, function(error) {
            reject(Error(error));
          });
    });
  },

  getMetadata: function(entry) {
    return new Promise(function(resolve, reject) {
      entry.getMetadata(function(entry) {
        resolve(entry);
      }, function(error) {
        reject(Error(error));
      });
    });
  },

  mountExternalFile: function(entry, fileSystem, isWritable) {
    return new Promise(function(resolve, reject) {
      fileSystem.postMessageAndReply_(
          'pluginFileSystemManager',
          'mountExternalFile',
          {
            fileSystem: entry.filesystem,
            fullPath: entry.fullPath,
            writable: isWritable
          },
          (function(replyData) {
            resolve(replyData);
          }));
    });
  },

  moveTo: function(sourceDirectory, targetDirectory, targetFilename) {
    return new Promise(function(resolve, reject) {
      sourceDirectory.moveTo(targetDirectory, targetFilename, function(entry) {
        resolve(entry);
      }, function(error) {
        reject(Error(error));
      });
    });
  }
};
