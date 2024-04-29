/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
define([], function() {
  "use strict";

  function removeCommentHeader(s) {
    return (s.substr(0, 2) === "//") ? s.substr(2) : s;
  }

  function removeComments(s) {
    var ndx = s.indexOf("//");
    return ndx >= 0 ? s.substr(0, ndx) : s;
  }

  var noCommaNeeded = {
    '{': true,
    '[': true,
    ',': true,
  };
  function addCommas(s) {
    var last = s.trim().substr(-1);
    return noCommaNeeded[last] ? s : (s + ",");
  }

  function isQuote(s) {
    return s === "'" || s === '"';
  }

  function addQuotesIfNoQuotes(s) {
    var first = s.substr(0, 1);
    if (isQuote(first)) {
      return s;
    }
    return '"' + s.replace(/"/g, "\\\"") + '"';
  }

  function addQuotes(s) {
    var colon = s.indexOf(":");
    if (colon < 0) {
      return s;
    }
    var before = addQuotesIfNoQuotes(s.substr(0, colon).trim());
    var after  = s.substr(colon + 1).trim();
    return before + ":" + after;
  }

  function trim(s) {
    return s.trim();
  }

  var settingsRE = /\/\/\s+settings\s*=\s*(\{\n[\s\S]*?\n\/\/\s+\})/m;
  function parseSettings(text) {
    var obj;
    var m = settingsRE.exec(text);
    if (m) {
      var str = m[1].split('\n')
        .map(removeCommentHeader)
        .map(removeComments)
        .map(addQuotes)
        .map(addCommas)
        .map(trim)
        .join("")
        .replace(/,\}/g, '}')
        .replace(/,\]/g, ']')
        .replace(/\},$/, '}');
      try {
        obj = JSON.parse(str);
      } catch (e) {
        console.error("could not parse settings:" + str);
      }
    }
    return obj;
  }

  /**
   * Returns a padding string large enough for the given size.
   * @param {string} padChar character for padding string
   * @param {number} len minimum length of padding.
   * @returns {string} string with len or more of padChar.
   */
  var getPadding = (function() {
    var paddingDb = {};

    return function(padChar, len) {
      var padStr = paddingDb[padChar];
      if (!padStr || padStr.length < len) {
        padStr = new Array(len + 1).join(padChar);
        paddingDb[padChar] = padStr;
      }
      return padStr;
    };
  }());

  /**
   * Turn an unknown object into a string if it's not already.
   * Do I really needs this? I could just always do .toString even
   * on a string.
   */
  var stringIt = function(str) {
    return (typeof str === 'string') ? str : str.toString();
  };

  /**
   * Pad string on right
   * @param {string} str string to pad
   * @param {number} len number of characters to pad to
   * @param {string} padChar character to pad with
   * @returns {string} padded string.
   * @memberOf module:Strings
   */
  var padRight = function(str, len, padChar) {
    str = stringIt(str);
    if (str.length >= len) {
      return str;
    }
    var padStr = getPadding(padChar, len);
    return str + padStr.substr(str.length - len);
  };

  /**
   * Pad string on left
   * @param {string} str string to pad
   * @param {number} len number of characters to pad to
   * @param {string} padChar character to pad with
   * @returns {string} padded string.
   * @memberOf module:Strings
   */
  var padLeft = function(str, len, padChar) {
    str = stringIt(str);
    if (str.length >= len) {
      return str;
    }
    var padStr = getPadding(padChar, len);
    return padStr.substr(str.length - len) + str;
  };

  /**
   * Replace %(id)s in strings with values in objects(s)
   *
   * Given a string like `"Hello %(name)s from $(user.country)s"`
   * and an object like `{name:"Joe",user:{country:"USA"}}` would
   * return `"Hello Joe from USA"`.
   *
   * @function
   * @param {string} str string to do replacements in
   * @param {Object|Object[]} params one or more objects.
   * @returns {string} string with replaced parts
   * @memberOf module:Strings
   */
  var replaceParams = (function() {
    var replaceParamsRE = /%\(([^)]+)\)s/g;

    return function(str, params) {
      if (!params.length) {
        params = [params];
      }

      return str.replace(replaceParamsRE, function(match, key) {
        var keys = key.split('.');
        for (var ii = 0; ii < params.length; ++ii) {
          var obj = params[ii];
          for (var jj = 0; jj < keys.length; ++jj) {
            var part = keys[jj];
            obj = obj[part];
            if (obj === undefined) {
              break;
            }
          }
          if (obj !== undefined) {
            return obj;
          }
        }
        console.error("unknown key: " + key);
        return "%(" + key + ")s";
      });
    };
  }());

  /**
   * True if string starts with prefix
   * @static
   * @param {String} str string to check for start
   * @param {String} prefix start value
   * @returns {Boolean} true if str starts with prefix
   * @memberOf module:Strings
   */
  var startsWith = function(str, start) {
    return (str.length >= start.length &&
            str.substr(0, start.length) === start);
  };

  /**
   * True if string ends with suffix
   * @param {String} str string to check for start
   * @param {String} suffix start value
   * @returns {Boolean} true if str starts with suffix
   * @memberOf module:Strings
   */
  var endsWith = function(str, end) {
    return (str.length >= end.length &&
            str.substring(str.length - end.length) === end);
  };

  /**
   * Make a string from unicode code points
   * @function
   * @param {Number} codePoint one or more code points
   * @returns {string} unicode string. Note a single code point
   *          can return a string with length > 1.
   * @memberOf module:Strings
   */
  var fromCodePoint = String.fromCodePoint ? String.fromCodePoint : (function() {
    var stringFromCharCode = String.fromCharCode;
    var floor = Math.floor;
    var fromCodePoint = function() {
      var MAX_SIZE = 0x4000;
      var codeUnits = [];
      var highSurrogate;
      var lowSurrogate;
      var index = -1;
      var length = arguments.length;
      if (!length) {
        return '';
      }
      var result = '';
      while (++index < length) {
        var codePoint = Number(arguments[index]);
        if (
          !isFinite(codePoint) || // `NaN`, `+Infinity`, or `-Infinity`
          codePoint < 0 || // not a valid Unicode code point
          codePoint > 0x10FFFF || // not a valid Unicode code point
          floor(codePoint) !== codePoint // not an integer
        ) {
          throw new RangeError('Invalid code point: ' + codePoint);
        }
        if (codePoint <= 0xFFFF) { // BMP code point
          codeUnits.push(codePoint);
        } else { // Astral code point; split in surrogate halves
          // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
          codePoint -= 0x10000;
          highSurrogate = (codePoint >> 10) + 0xD800;
          lowSurrogate = (codePoint % 0x400) + 0xDC00;
          codeUnits.push(highSurrogate, lowSurrogate);
        }
        if (index + 1 === length || codeUnits.length > MAX_SIZE) {
          result += stringFromCharCode.apply(null, codeUnits);
          codeUnits.length = 0;
        }
      }
      return result;
    };
    return fromCodePoint;
  }());

  return {
    endsWith: endsWith,
    fromCodePoint: fromCodePoint,
    padLeft: padLeft,
    padRight: padRight,
    replaceParams: replaceParams,
    startsWith: startsWith,
    removeComments: removeComments,
    isQuote: isQuote,
    trim: trim,
    parseSettings: parseSettings,
  };
});

