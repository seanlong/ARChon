// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.



/**
 * @constructor
 *
 * Displays the current memory usage.
 *
 * @param plugin Plugin instance.
 */
function MemoryMapViewer(plugin) {
  /** @private */
  this.plugin_ = plugin;

  plugin.addMessageListener('memory-state', this.handleMessage_.bind(this));

  window.addEventListener('keydown', (function(e) {
    // Snapshot memory on Ctrl-Alt-M or Ctrl-Shift-M.
    if (e.ctrlKey && (e.altKey || e.shiftKey) && e.keyCode == 77) {
      this.requestSnapshot_();
      e.stopPropagation();
    }
  }).bind(this));
}


/** @private */
MemoryMapViewer.prototype.requestSnapshot_ = function() {
  this.plugin_.postMessage({
    namespace: 'pluginUtil',
    command: 'dumpMemoryState',
    data: {}
  });
};


/**
 * @private
 *
 * Converts a number to a hexidecimal value.
 *
 * @param n The input number.
 * @return The hexidecimal representation as a string.
 */
MemoryMapViewer.prototype.toHex_ = function(n) {
  var str = n.toString(16);
  while (str.length < 8) {
    str = '0' + str;
  }
  return str;
};


/**
 * @private
 *
 * Formats a number by adding commas every three digits (from the right).
 *
 * @param n The input number.
 * @return The formatted representation.
 */
MemoryMapViewer.prototype.withCommas_ = function(n) {
  var str = n.toString();
  var ret = '';
  for (var i = 0; i < str.length; i++) {
    ret = str[str.length - 1 - i] + ret;
    if (i % 3 == 2 && i < str.length - 1) {
      ret = ',' + ret;
    }
  }
  return ret;
};


/**
 * @private
 *
 * Processes the array of process map headers, generating a mapping of loaded
 * libraries to their array of memory sections.
 *
 * @param processMapHeaders Input array of process map headers.
 * @return A map of libaries to sections.
 */
MemoryMapViewer.prototype.prepareLibrariesMap_ = function(
    processMapHeaders) {
  // Collect together items from the same shared library.
  var librariesMap = {};
  for (var i = 0; i < processMapHeaders.length; i++) {
    var section = processMapHeaders[i];
    if (section.type == 'LOAD') {
      if (!(section.library in librariesMap)) {
        librariesMap[section.library] = [];
      }
      librariesMap[section.library].push(section);
    }
  }
  return librariesMap;
};


/**
 * @private
 *
 * Convert a mapping of all the loaded libraries into an list of them ordered by
 * the base address of the library.
 *
 * @param librariesMap Input map of the libraries
 * @return libraries Output ordered list of libraries.
 */
MemoryMapViewer.prototype.prepareLibraries_ = function(librariesMap) {
  // Sort libraries by lowest address.
  var libraries = [];
  for (var i in librariesMap) {
    libraries.push(librariesMap[i]);
  }
  libraries.sort(function(a, b) {
    function minAddr(x) {
      var minAddrRet = Math.pow(2, 32);
      for (var i = 0; i < x.length; i++) {
        var addr = x[i].baseAddress + x[i].objectAddress;
        if (addr < minAddrRet) {
          minAddrRet = addr;
        }
      }
      return minAddrRet;
    }
    return minAddr(a) - minAddr(b);
  });
  return libraries;
};


/**
 * @private
 *
 * Process a list of process section headers, looking for those that are for a
 * loaded library.
 *
 * @param rawProcessMapHeaders Input list of process headers
 * @return processMapHeaders Ordered list of loaded library sections.
 */
MemoryMapViewer.prototype.prepareSortedHeaders_ = function(
    rawProcessMapHeaders) {
  var processMapHeaders = [];
  for (var i = 0; i < rawProcessMapHeaders.length; i++) {
    var section = rawProcessMapHeaders[i];
    if (section.type == 'LOAD') {
      processMapHeaders.push(section);
    }
  }
  processMapHeaders.sort(function(a, b) {
    return (a.baseAddress + a.objectAddress) -
           (b.baseAddress + b.objectAddress);
  });
  return processMapHeaders;
};


/**
 * @private
 *
 * Enhances a backtrace, adding some useful information, and removing some
 * useless information.
 *
 * @param librariesMap Map of libraries to sections
 * @param arcTarget Current build target
 * @param backtrace Backtrace to process
 * @return Enhanced backtrace.
 */
MemoryMapViewer.prototype.enhanceBacktrace_ = function(
    librariesMap, arcTarget, backtrace) {
  // Determine local paths.
  var arcRuntime =
      'out/target/' + arcTarget + '/runtime/' + arcTarget;
  // Gather addr2line command.
  var anyScope = /^([^( ]+).*\[0x([0-9a-f]+)\]$/;
  var lastLib = null;
  var groups = [];
  for (var i = 0; i < backtrace.length; i++) {
    var m = anyScope.exec(backtrace[i]);
    if (m == null) {
      continue;
    }
    var lib = m[1];
    var addr = parseInt(m[2], 16);
    if (lib in librariesMap) {
      addr -= librariesMap[lib][0].baseAddress;
    }
    if (lib == '/lib/main.nexe') {
      lib = '/arc_' + arcTarget + '.nexe';
    } else if (lib.substr(0, '/lib/'.length) == '/lib/') {
      lib = '/' + lib.substr('/lib/'.length);
    }
    // TODO(crbug.com/257531): We cannot show correct commandlines for
    // libraries in subdirectories such as egl or hw.
    if (lastLib == lib) {
      groups[groups.length - 1] += ' ' + addr.toString(16);
    } else {
      groups.push('$AA' + lib + ' ' + addr.toString(16));
    }
    lastLib = lib;
  }
  for (var i = 0; i < groups.length; i++)
    groups[i] = 'eval "' + groups[i] + '"';
  if (groups.length > 0) {
    backtrace.push('AA=\'addr2line -C -f -e ' + arcRuntime + '\';' +
                   groups.join(';'));
  }
  // Condense the backtrace.
  var newBacktrace = [];
  var noSymScope = /^([^ ]+) \[0x([0-9a-f]+)\]$/;
  var lastNoSymLib = null;
  for (var i = 0; i < backtrace.length; i++) {
    var m = noSymScope.exec(backtrace[i]);
    if (m == null) {
      newBacktrace.push(backtrace[i]);
      lastNoSymLib = null;
    } else {
      var lib = m[1];
      var addr = parseInt(m[2], 16);
      if (lib == lastNoSymLib) {
        newBacktrace[newBacktrace.length - 1] +=
            ' [0x' + addr.toString(16) + ']';
      } else {
        newBacktrace.push(backtrace[i]);
      }
      lastNoSymLib = lib;
    }
  }
  return newBacktrace;
};


/**
 * @private
 *
 * Generates a view of the current memory map.
 *
 * @param data Memory map snapshot to display
 */
MemoryMapViewer.prototype.displaySnapshot_ = function(data) {
  var doc = new DocumentGenerator('MemoryViewer');

  var viewer = this;

  var kb = 1024;
  var mb = 1024 * kb;
  var pageSize = 64 * kb;
  var executeLimit = 256 * mb;

  var parts = 1024 * 2;

  // Decide if we're in a 1GB or 4GB sandbox.
  if (data.arcTarget == 'nacl_i686') {
    var addressLimit = 1 << 30;
  } else {
    var addressLimit = (1 << 30) * 4.0;
  }

  var memoryMapY = 20;  // Vertical start of memory map in pixels.
  var partSize = addressLimit / parts;
  var pages = Math.floor(addressLimit / pageSize);

  var addressLabelX = 0;
  var addressMarkerX = addressLabelX + 160;
  var markerSpacing = 64;
  var memoryMapX = addressMarkerX + 20;
  var memoryMapWidth = 60;
  var sharedLibStartX = memoryMapX + memoryMapWidth + 10;
  var sharedLibItemWidth = 11;
  var sharedLibItemThick = 9;
  var sharedLibItemThin = 0.2;
  var sharedLibHoverPadding = 5;
  var textRowHeight = 20;
  var memoryKeyX = memoryMapX + memoryMapWidth + 200;
  var memoryKeyY = memoryMapY + 10;
  var exeEndsY = Math.floor(executeLimit / partSize) + memoryMapY;
  var mallinfoX = memoryKeyX;
  var mallinfoY = exeEndsY + 500;

  // Gather the protection of each page.
  var memory = [];
  for (var i = 0; i < pages; i++) {
    memory.push(0);
  }
  for (var i = 0; i < data.memoryMappingInfo.length; i++) {
    var region = data.memoryMappingInfo[i];
    var regionStart = Math.floor(region.start / pageSize);
    var regionSize = Math.floor(region.size / pageSize);
    for (var j = 0; j < regionSize; j++) {
      memory[regionStart + j] = region.prot;
    }
  }

  // Generate a weighted map of the memory of size parts.
  var read = [];
  var write = [];
  var execute = [];
  for (var i = 0; i < parts; i++) {
    read.push(0);
    write.push(0);
    execute.push(0);
  }
  var readonlyPages = 0;
  var writablePages = 0;
  var executablePages = 0;
  for (var i = 0; i < memory.length; i++) {
    var prot = memory[i];
    var addr = Math.floor(i * pageSize / partSize);
    if (prot & 1) read[addr]++;
    if (prot & 2) write[addr]++;
    if (prot & 4) execute[addr]++;
    if (prot == 1) readonlyPages++;
    if (prot & 2) writablePages++;
    if (prot & 4) executablePages++;
  }

  // Draw each row of the memory map.
  var svg = doc.addSVG(1000, parts + 200);
  for (var i = 0; i < parts; i++) {
    r = read[i] * pageSize / partSize;
    g = write[i] * pageSize / partSize;
    b = execute[i] * pageSize / partSize;
    svg.addRect(memoryMapX, i + memoryMapY,
                memoryMapWidth, 1, svg.rgb(r, g, b));
  }

  // Label the addresses.
  for (var i = 0; i < Math.floor(parts / markerSpacing) + 1; i++) {
    var row = i * markerSpacing + memoryMapY;
    var addr = i * markerSpacing * partSize;
    var text = '0x' + this.toHex_(addr) +
               ' (' + Math.floor(addr / mb) + 'MB)';
    svg.addText(addressLabelX, row, text, 'black', false);
    svg.addLine(addressMarkerX, row, memoryMapX, row, 'black', 1);
  }

  // Collect together items from the same shared library.
  var librariesMap = this.prepareLibrariesMap_(data.processMapHeaders);
  var libraries = this.prepareLibraries_(librariesMap);

  // Mark each shared library.
  var colors = ['green', 'blue', 'purple', 'gray', 'brown'];
  var current = 0;
  for (var i = 0; i < libraries.length; i++) {
    var sharedLibX = sharedLibStartX + i * sharedLibItemWidth;
    var library = libraries[i];
    var group = svg.addGroup();

    // Find the extent of each library. Cover in white so its hoverable.
    var minStart = parts;
    var maxEnd = 0;
    for (var j = 0; j < library.length; j++) {
      var part = library[j];
      var start = part.baseAddress + part.objectAddress;
      var end = part.baseAddress + part.objectAddress + part.memorySize;
      start = Math.floor(start / partSize);
      end = Math.floor(end / partSize) + 1;
      if (start < minStart) minStart = start;
      if (end > maxEnd) maxEnd = end;
    }
    group.addLine(sharedLibX, memoryMapY + minStart - sharedLibHoverPadding,
                  sharedLibX, memoryMapY + maxEnd + sharedLibHoverPadding,
                  'white', 7);

    // Mark each section of each library.
    var lastEnd;
    for (var j = 0; j < library.length; j++) {
      var part = library[j];
      var start = part.baseAddress + part.objectAddress;
      var end = part.baseAddress + part.objectAddress + part.memorySize;
      start = Math.floor(start / partSize);
      end = Math.floor(end / partSize) + 1;

      if (j == 0) {
        group.addTitle(part.library);
      } else {
        group.addLine(sharedLibX, memoryMapY + start,
                      sharedLibX, memoryMapY + lastEnd,
                      colors[current], sharedLibItemThin);
      }
      group.addLine(sharedLibX, memoryMapY + start,
                    sharedLibX, memoryMapY + end,
                    colors[current], sharedLibItemThick);
      lastEnd = end;
    }
    current = (current + 1) % colors.length;
  }

  // Draw a simple key.
  var unusedText = executeLimit - executablePages * pageSize;
  var unusedData = addressLimit - executeLimit -
                   readonlyPages * pageSize - writablePages * pageSize;
  var unusedTextMb = Math.floor(unusedText / mb);
  var unusedDataMb = Math.floor(unusedData / mb);
  var readonlyMb = Math.floor(readonlyPages * pageSize / mb);
  var writableMb = Math.floor(writablePages * pageSize / mb);
  var executableMb = Math.floor(executablePages * pageSize / mb);
  var keyItems = [
    { label: ('Unused (text:' + unusedTextMb + 'MB, data:' + unusedDataMb +
              'MB)'),
      color: 'black'},
    { label: 'Read-only (' + readonlyMb + 'MB)', color: 'red' },
    { label: 'Writeable (' + writableMb + 'MB)', color: 'yellow'},
    { label: 'Executable (' + executableMb + 'MB)', color: 'magenta'}
  ];
  for (var i = 0; i < keyItems.length; i++) {
    svg.addText(memoryKeyX, memoryKeyY + i * textRowHeight,
                keyItems[i].label, keyItems[i].color,
                keyItems[i].color != 'black');
  }

  // Mark the end of the executable region.
  svg.addText(memoryKeyX, exeEndsY, 'Executable region ends', 'black', false);
  svg.addLine(memoryMapX + memoryMapWidth,
              exeEndsY, memoryKeyX, exeEndsY, 'black', 1);

  // Display mallinfo.
  var mallinfoItems = [
    'MALLINFO',
    'Total malloc memory from sbrk (arena): ' +
        viewer.withCommas_(data.mallinfo.arena),
    'Chunks not in use (ordblks): ' +
        viewer.withCommas_(data.mallinfo.ordblks),
    'Chunks allocated with mmap (hblks): ' +
        viewer.withCommas_(data.mallinfo.hblks),
    'Total memory from mmap (hblkhd): ' +
        viewer.withCommas_(data.mallinfo.hblkhd),
    'Memory with chunks from malloc (uordblks): ' +
        viewer.withCommas_(data.mallinfo.uordblks),
    'Memory with free chunks (fordblks): ' +
        viewer.withCommas_(data.mallinfo.fordblks),
    'Size of top most chunk (keepcost): ' +
        viewer.withCommas_(data.mallinfo.keepcost)
  ];
  for (var i = 0; i < mallinfoItems.length; i++) {
    svg.addText(mallinfoX, mallinfoY + i * textRowHeight,
                mallinfoItems[i], 'black', false);
  }

  // Add a raw table for memory mapping info.
  doc.addCompleteTable([
    'start',
    'end',
    'prot',
    'maxProt',
    'vmmapType',
    'backtrace'
  ], function(row) {
    return [
      viewer.toHex_(row.start),
      viewer.toHex_(row.start - 1 + row.size),
      row.prot,
      row.maxProt,
      row.vmmapType,
      viewer.enhanceBacktrace_(
          librariesMap, data.arcTarget, row.backtrace)
    ];
  }, data.memoryMappingInfo);

  // Add a row table for process headers sorted by start address.
  var processMapHeaders = this.prepareSortedHeaders_(
      data.processMapHeaders);
  doc.addCompleteTable([
    'start',
    'end',
    'type',
    'library',
    'flags'
  ], function(row) {
    return [
      viewer.toHex_(row.baseAddress + row.objectAddress),
      viewer.toHex_(row.baseAddress - 1 + row.objectAddress + row.memorySize),
      row.type,
      row.library,
      row.flags
    ];
  }, processMapHeaders);
};


/**
 * @private
 *
 * Handles a memory map view related message.
 *
 * @param message Message to handle.
 */
MemoryMapViewer.prototype.handleMessage_ = function(message) {
  if (message.command == 'snapshot') {
    this.displaySnapshot_(message.data);
  } else {
    console.log('Unknown memory command[' + message.command + ']');
  }
};
