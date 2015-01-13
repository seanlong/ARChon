// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.



/**
 * @constructor
 *
 * A simple class to create debug output documents.
 */
function DocumentGenerator(title, parent, node) {
  if (parent == undefined) {
    /** @private */
    this.window_ = openParentWindow();

    /** @private */
    this.document_ = this.window_.document;

    /** @private */
    this.node_ = this.document_.body;

    this.document_.title = title;

    var style = this.document_.createElement('style');
    style.appendChild(this.document_.createTextNode([
      'html {',
      '  overflow: auto;',
      '},',
      'table {',
      '  border-width: 0 0 1px 1px;',
      '  border-spacing: 0;',
      '  border-collapse: collapse;',
      '  border-style: solid;',
      '}',
      'td {',
      '  font-family: monospace;',
      '}',
      'div.tiny {',
      '  font-size: 9px;',
      '}',
      'td, th {',
      '  margin: 0;',
      '  padding: 4px;',
      '  border-width: 1px 1px 0 0;',
      '  border-style: solid;',
      '}'].join('\n')));
    this.document_.head.appendChild(style);
  } else {
    this.window_ = parent.window_;
    this.document_ = parent.document_;
    this.node_ = node;
  }
}


/** @private */
DocumentGenerator.prototype.SVG_NAMESPACE_ = 'http://www.w3.org/2000/svg';


/**
 * @public
 *
 * Adds a table to the document.
 */
DocumentGenerator.prototype.addTable = function() {
  var table = this.document_.createElement('table');
  this.node_.appendChild(table);
  return new DocumentGenerator('', this, table);
};


/**
 * @public
 *
 * Adds a row to a table.
 */
DocumentGenerator.prototype.addRow = function(columnType, items) {
  var row = this.document_.createElement('tr');
  for (var i = 0; i < items.length; i++) {
    var col = this.document_.createElement(columnType);
    if (items[i] instanceof Array) {
      var cell = this.document_.createElement('div');
      col.appendChild(cell);
      for (var j = 0; j < items[i].length; j++) {
        var div = this.document_.createElement('div');
        var text = items[i][j];
        if (text.length > 150) {
          div.className = 'tiny';
        }
        div.appendChild(this.document_.createTextNode(text));
        cell.appendChild(div);
      }
    } else {
      col.appendChild(this.document_.createTextNode(items[i]));
    }
    row.appendChild(col);
  }
  this.node_.appendChild(row);
};


/**
 * @public
 *
 * Adds a complete table to the document.
 */
DocumentGenerator.prototype.addCompleteTable = function(
    headings, extractRow, rows) {
  var table = this.addTable();
  table.addRow('th', headings);
  for (var i = 0; i < rows.length; i++) {
    table.addRow('td', extractRow(rows[i]));
  }
};


/**
 * @public
 *
 * Adds an SVG canvas to the document.
 */
DocumentGenerator.prototype.addSVG = function(width, height) {
  var svg = this.document_.createElementNS(this.SVG_NAMESPACE_, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  this.node_.appendChild(svg);
  return new DocumentGenerator('', this, svg);
};


/**
 * @public
 *
 * Adds an SVG rectangle to the document.
 */
DocumentGenerator.prototype.addRect = function(
    x, y, width, height, color) {
  var obj = this.document_.createElementNS(this.SVG_NAMESPACE_, 'rect');
  obj.setAttribute('x', x);
  obj.setAttribute('y', y);
  obj.setAttribute('width', width);
  obj.setAttribute('height', height);
  obj.style.fill = color;
  obj.style.strokeWidth = 0;
  obj.style.stroke = 'transparent';
  this.node_.appendChild(obj);
};


/**
 * @public
 *
 * Adds an SVG line to the document.
 */
DocumentGenerator.prototype.addLine = function(
    x1, y1, x2, y2, color, width) {
  var obj = this.document_.createElementNS(this.SVG_NAMESPACE_, 'line');
  obj.setAttribute('x1', x1);
  obj.setAttribute('y1', y1);
  obj.setAttribute('x2', x2);
  obj.setAttribute('y2', y2);
  obj.style.stroke = color;
  obj.style.strokeWidth = width;
  this.node_.appendChild(obj);
};


/**
 * @public
 *
 * Adds SVG text to the document.
 */
DocumentGenerator.prototype.addText = function(x, y, message, color, shadow) {
  if (shadow) {
    this.addText(x + 1, y + 1, message, 'black', false);
  }
  var obj = this.document_.createElementNS(this.SVG_NAMESPACE_, 'text');
  obj.setAttribute('x', x);
  obj.setAttribute('y', y);
  obj.style.fill = color;
  obj.setAttribute('font-family', 'monospace');
  obj.textContent = message;
  this.node_.appendChild(obj);
};


/**
 * @public
 *
 * Creates a CSS color string from a tuple of RGB integers.
 */
DocumentGenerator.prototype.rgb = function(r, g, b) {
  var rv = Math.max(0, Math.min(255, Math.floor(r * 255)));
  var gv = Math.max(0, Math.min(255, Math.floor(g * 255)));
  var bv = Math.max(0, Math.min(255, Math.floor(b * 255)));
  return 'rgb(' + rv + ',' + gv + ',' + bv + ')';
};


/**
 * @public
 *
 * Adds an SVG group to the document.
 */
DocumentGenerator.prototype.addGroup = function() {
  var obj = this.document_.createElementNS(this.SVG_NAMESPACE_, 'g');
  this.node_.appendChild(obj);
  return new DocumentGenerator('', this, obj);
};


/**
 * @public
 *
 * Adds an SVG title element to the document.
 *
 */
DocumentGenerator.prototype.addTitle = function(message) {
  var obj = this.document_.createElementNS(this.SVG_NAMESPACE_, 'title');
  obj.textContent = message;
  this.node_.appendChild(obj);
};
