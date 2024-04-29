/*
 * Copyright 2015, Gregg Tavares.
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

  function ListenerManager() {
    var listeners = {};
    var nextId = 1;

    // Returns an id for the listener. This is easier IMO than
    // the normal remove listener which requires the same arguments as addListener
    this.on = function(elem /*, event, listener, useCapture */) {
      var args = Array.prototype.slice.call(arguments, 1);
      elem.addEventListener.apply(elem, args);
      var id = nextId++;
      listeners[id] = {
        elem: elem,
        args: args,
      };
      return id;
    };

    this.remove = function(id) {
      var listener = listeners[id];
      if (listener) {
        delete listener[id];
        listener.elem.removeEventListener.apply(listener.elem, listener.args);
      }
    };

    this.removeAll = function() {
      var old = listeners;
      listeners = {};
      Object.keys(old).forEach(function(id) {
        var listener = old[id];
        listener.elem.removeEventListener.apply(listener.elem, listener.args);
      });
    };
  }

  return ListenerManager;
});

