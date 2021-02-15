// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE

// This is CodeMirror (https://codemirror.net), a code editor
// implemented in JavaScript on top of the browser's DOM.
//
// You can find some technical background for some of the code below
// at http://marijnhaverbeke.nl/blog/#cm-internals .

(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
        typeof define === 'function' && define.amd ? define(factory) :
            (global = global || self, global.CodeMirror = factory());
}(this, (function () { 'use strict';

    // Kludges for bugs and behavior differences that can't be feature
    // detected are enabled based on userAgent etc sniffing.
    var userAgent = navigator.userAgent;
    var platform = navigator.platform;

    var gecko = /gecko\/\d/i.test(userAgent);
    var ie_upto10 = /MSIE \d/.test(userAgent);
    var ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(userAgent);
    var edge = /Edge\/(\d+)/.exec(userAgent);
    var ie = ie_upto10 || ie_11up || edge;
    var ie_version = ie && (ie_upto10 ? document.documentMode || 6 : +(edge || ie_11up)[1]);
    var webkit = !edge && /WebKit\//.test(userAgent);
    var qtwebkit = webkit && /Qt\/\d+\.\d+/.test(userAgent);
    var chrome = !edge && /Chrome\//.test(userAgent);
    var presto = /Opera\//.test(userAgent);
    var safari = /Apple Computer/.test(navigator.vendor);
    var mac_geMountainLion = /Mac OS X 1\d\D([8-9]|\d\d)\D/.test(userAgent);
    var phantom = /PhantomJS/.test(userAgent);

    var ios = safari && (/Mobile\/\w+/.test(userAgent) || navigator.maxTouchPoints > 2);
    var android = /Android/.test(userAgent);
    // This is woefully incomplete. Suggestions for alternative methods welcome.
    var mobile = ios || android || /webOS|BlackBerry|Opera Mini|Opera Mobi|IEMobile/i.test(userAgent);
    var mac = ios || /Mac/.test(platform);
    var chromeOS = /\bCrOS\b/.test(userAgent);
    var windows = /win/i.test(platform);

    var presto_version = presto && userAgent.match(/Version\/(\d*\.\d*)/);
    if (presto_version) { presto_version = Number(presto_version[1]); }
    if (presto_version && presto_version >= 15) { presto = false; webkit = true; }
    // Some browsers use the wrong event properties to signal cmd/ctrl on OS X
    var flipCtrlCmd = mac && (qtwebkit || presto && (presto_version == null || presto_version < 12.11));
    var captureRightClick = gecko || (ie && ie_version >= 9);

    function classTest(cls) { return new RegExp("(^|\\s)" + cls + "(?:$|\\s)\\s*") }

    var rmClass = function(node, cls) {
        var current = node.className;
        var match = classTest(cls).exec(current);
        if (match) {
            var after = current.slice(match.index + match[0].length);
            node.className = current.slice(0, match.index) + (after ? match[1] + after : "");
        }
    };

    function removeChildren(e) {
        for (var count = e.childNodes.length; count > 0; --count)
        { e.removeChild(e.firstChild); }
        return e
    }

    function removeChildrenAndAdd(parent, e) {
        return removeChildren(parent).appendChild(e)
    }

    function elt(tag, content, className, style) {
        var e = document.createElement(tag);
        if (className) { e.className = className; }
        if (style) { e.style.cssText = style; }
        if (typeof content == "string") { e.appendChild(document.createTextNode(content)); }
        else if (content) { for (var i = 0; i < content.length; ++i) { e.appendChild(content[i]); } }
        return e
    }
    // wrapper for elt, which removes the elt from the accessibility tree
    function eltP(tag, content, className, style) {
        var e = elt(tag, content, className, style);
        e.setAttribute("role", "presentation");
        return e
    }

    var range;
    if (document.createRange) { range = function(node, start, end, endNode) {
        var r = document.createRange();
        r.setEnd(endNode || node, end);
        r.setStart(node, start);
        return r
    }; }
    else { range = function(node, start, end) {
        var r = document.body.createTextRange();
        try { r.moveToElementText(node.parentNode); }
        catch(e) { return r }
        r.collapse(true);
        r.moveEnd("character", end);
        r.moveStart("character", start);
        return r
    }; }

    function contains(parent, child) {
        if (child.nodeType == 3) // Android browser always returns false when child is a textnode
        { child = child.parentNode; }
        if (parent.contains)
        { return parent.contains(child) }
        do {
            if (child.nodeType == 11) { child = child.host; }
            if (child == parent) { return true }
        } while (child = child.parentNode)
    }

    function activeElt() {
        // IE and Edge may throw an "Unspecified Error" when accessing document.activeElement.
        // IE < 10 will throw when accessed while the page is loading or in an iframe.
        // IE > 9 and Edge will throw when accessed in an iframe if document.body is unavailable.
        var activeElement;
        try {
            activeElement = document.activeElement;
        } catch(e) {
            activeElement = document.body || null;
        }
        while (activeElement && activeElement.shadowRoot && activeElement.shadowRoot.activeElement)
        { activeElement = activeElement.shadowRoot.activeElement; }
        return activeElement
    }

    function addClass(node, cls) {
        var current = node.className;
        if (!classTest(cls).test(current)) { node.className += (current ? " " : "") + cls; }
    }
    function joinClasses(a, b) {
        var as = a.split(" ");
        for (var i = 0; i < as.length; i++)
        { if (as[i] && !classTest(as[i]).test(b)) { b += " " + as[i]; } }
        return b
    }

    var selectInput = function(node) { node.select(); };
    if (ios) // Mobile Safari apparently has a bug where select() is broken.
    { selectInput = function(node) { node.selectionStart = 0; node.selectionEnd = node.value.length; }; }
    else if (ie) // Suppress mysterious IE10 errors
    { selectInput = function(node) { try { node.select(); } catch(_e) {} }; }

    function bind(f) {
        var args = Array.prototype.slice.call(arguments, 1);
        return function(){return f.apply(null, args)}
    }

    function copyObj(obj, target, overwrite) {
        if (!target) { target = {}; }
        for (var prop in obj)
        { if (obj.hasOwnProperty(prop) && (overwrite !== false || !target.hasOwnProperty(prop)))
        { target[prop] = obj[prop]; } }
        return target
    }

    // Counts the column offset in a string, taking tabs into account.
    // Used mostly to find indentation.
    function countColumn(string, end, tabSize, startIndex, startValue) {
        if (end == null) {
            end = string.search(/[^\s\u00a0]/);
            if (end == -1) { end = string.length; }
        }
        for (var i = startIndex || 0, n = startValue || 0;;) {
            var nextTab = string.indexOf("\t", i);
            if (nextTab < 0 || nextTab >= end)
            { return n + (end - i) }
            n += nextTab - i;
            n += tabSize - (n % tabSize);
            i = nextTab + 1;
        }
    }

    var Delayed = function() {
        this.id = null;
        this.f = null;
        this.time = 0;
        this.handler = bind(this.onTimeout, this);
    };
    Delayed.prototype.onTimeout = function (self) {
        self.id = 0;
        if (self.time <= +new Date) {
            self.f();
        } else {
            setTimeout(self.handler, self.time - +new Date);
        }
    };
    Delayed.prototype.set = function (ms, f) {
        this.f = f;
        var time = +new Date + ms;
        if (!this.id || time < this.time) {
            clearTimeout(this.id);
            this.id = setTimeout(this.handler, ms);
            this.time = time;
        }
    };

    function indexOf(array, elt) {
        for (var i = 0; i < array.length; ++i)
        { if (array[i] == elt) { return i } }
        return -1
    }

    // Number of pixels added to scroller and sizer to hide scrollbar
    var scrollerGap = 50;

    // Returned or thrown by various protocols to signal 'I'm not
    // handling this'.
    var Pass = {toString: function(){return "CodeMirror.Pass"}};

    // Reused option objects for setSelection & friends
    var sel_dontScroll = {scroll: false}, sel_mouse = {origin: "*mouse"}, sel_move = {origin: "+move"};

    // The inverse of countColumn -- find the offset that corresponds to
    // a particular column.
    function findColumn(string, goal, tabSize) {
        for (var pos = 0, col = 0;;) {
            var nextTab = string.indexOf("\t", pos);
            if (nextTab == -1) { nextTab = string.length; }
            var skipped = nextTab - pos;
            if (nextTab == string.length || col + skipped >= goal)
            { return pos + Math.min(skipped, goal - col) }
            col += nextTab - pos;
            col += tabSize - (col % tabSize);
            pos = nextTab + 1;
            if (col >= goal) { return pos }
        }
    }

    var spaceStrs = [""];
    function spaceStr(n) {
        while (spaceStrs.length <= n)
        { spaceStrs.push(lst(spaceStrs) + " "); }
        return spaceStrs[n]
    }

    function lst(arr) { return arr[arr.length-1] }

    function map(array, f) {
        var out = [];
        for (var i = 0; i < array.length; i++) { out[i] = f(array[i], i); }
        return out
    }

    function insertSorted(array, value, score) {
        var pos = 0, priority = score(value);
        while (pos < array.length && score(array[pos]) <= priority) { pos++; }
        array.splice(pos, 0, value);
    }

    function nothing() {}

    function createObj(base, props) {
        var inst;
        if (Object.create) {
            inst = Object.create(base);
        } else {
            nothing.prototype = base;
            inst = new nothing();
        }
        if (props) { copyObj(props, inst); }
        return inst
    }

    var nonASCIISingleCaseWordChar = /[\u00df\u0587\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
    function isWordCharBasic(ch) {
        return /\w/.test(ch) || ch > "\x80" &&
            (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch))
    }
    function isWordChar(ch, helper) {
        if (!helper) { return isWordCharBasic(ch) }
        if (helper.source.indexOf("\\w") > -1 && isWordCharBasic(ch)) { return true }
        return helper.test(ch)
    }

    function isEmpty(obj) {
        for (var n in obj) { if (obj.hasOwnProperty(n) && obj[n]) { return false } }
        return true
    }

    // Extending unicode characters. A series of a non-extending char +
    // any number of extending chars is treated as a single unit as far
    // as editing and measuring is concerned. This is not fully correct,
    // since some scripts/fonts/browsers also treat other configurations
    // of code points as a group.
    var extendingChars = /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065e\u0670\u06d6-\u06dc\u06de-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0900-\u0902\u093c\u0941-\u0948\u094d\u0951-\u0955\u0962\u0963\u0981\u09bc\u09be\u09c1-\u09c4\u09cd\u09d7\u09e2\u09e3\u0a01\u0a02\u0a3c\u0a41\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a70\u0a71\u0a75\u0a81\u0a82\u0abc\u0ac1-\u0ac5\u0ac7\u0ac8\u0acd\u0ae2\u0ae3\u0b01\u0b3c\u0b3e\u0b3f\u0b41-\u0b44\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b82\u0bbe\u0bc0\u0bcd\u0bd7\u0c3e-\u0c40\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0cbc\u0cbf\u0cc2\u0cc6\u0ccc\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0d3e\u0d41-\u0d44\u0d4d\u0d57\u0d62\u0d63\u0dca\u0dcf\u0dd2-\u0dd4\u0dd6\u0ddf\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0f18\u0f19\u0f35\u0f37\u0f39\u0f71-\u0f7e\u0f80-\u0f84\u0f86\u0f87\u0f90-\u0f97\u0f99-\u0fbc\u0fc6\u102d-\u1030\u1032-\u1037\u1039\u103a\u103d\u103e\u1058\u1059\u105e-\u1060\u1071-\u1074\u1082\u1085\u1086\u108d\u109d\u135f\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b7-\u17bd\u17c6\u17c9-\u17d3\u17dd\u180b-\u180d\u18a9\u1920-\u1922\u1927\u1928\u1932\u1939-\u193b\u1a17\u1a18\u1a56\u1a58-\u1a5e\u1a60\u1a62\u1a65-\u1a6c\u1a73-\u1a7c\u1a7f\u1b00-\u1b03\u1b34\u1b36-\u1b3a\u1b3c\u1b42\u1b6b-\u1b73\u1b80\u1b81\u1ba2-\u1ba5\u1ba8\u1ba9\u1c2c-\u1c33\u1c36\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce0\u1ce2-\u1ce8\u1ced\u1dc0-\u1de6\u1dfd-\u1dff\u200c\u200d\u20d0-\u20f0\u2cef-\u2cf1\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua66f-\ua672\ua67c\ua67d\ua6f0\ua6f1\ua802\ua806\ua80b\ua825\ua826\ua8c4\ua8e0-\ua8f1\ua926-\ua92d\ua947-\ua951\ua980-\ua982\ua9b3\ua9b6-\ua9b9\ua9bc\uaa29-\uaa2e\uaa31\uaa32\uaa35\uaa36\uaa43\uaa4c\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uabe5\uabe8\uabed\udc00-\udfff\ufb1e\ufe00-\ufe0f\ufe20-\ufe26\uff9e\uff9f]/;
    function isExtendingChar(ch) { return ch.charCodeAt(0) >= 768 && extendingChars.test(ch) }

    // Returns a number from the range [`0`; `str.length`] unless `pos` is outside that range.
    function skipExtendingChars(str, pos, dir) {
        while ((dir < 0 ? pos > 0 : pos < str.length) && isExtendingChar(str.charAt(pos))) { pos += dir; }
        return pos
    }

    // Returns the value from the range [`from`; `to`] that satisfies
    // `pred` and is closest to `from`. Assumes that at least `to`
    // satisfies `pred`. Supports `from` being greater than `to`.
    function findFirst(pred, from, to) {
        // At any point we are certain `to` satisfies `pred`, don't know
        // whether `from` does.
        var dir = from > to ? -1 : 1;
        for (;;) {
            if (from == to) { return from }
            var midF = (from + to) / 2, mid = dir < 0 ? Math.ceil(midF) : Math.floor(midF);
            if (mid == from) { return pred(mid) ? from : to }
            if (pred(mid)) { to = mid; }
            else { from = mid + dir; }
        }
    }

    // BIDI HELPERS

    function iterateBidiSections(order, from, to, f) {
        if (!order) { return f(from, to, "ltr", 0) }
        var found = false;
        for (var i = 0; i < order.length; ++i) {
            var part = order[i];
            if (part.from < to && part.to > from || from == to && part.to == from) {
                f(Math.max(part.from, from), Math.min(part.to, to), part.level == 1 ? "rtl" : "ltr", i);
                found = true;
            }
        }
        if (!found) { f(from, to, "ltr"); }
    }

    var bidiOther = null;
    function getBidiPartAt(order, ch, sticky) {
        var found;
        bidiOther = null;
        for (var i = 0; i < order.length; ++i) {
            var cur = order[i];
            if (cur.from < ch && cur.to > ch) { return i }
            if (cur.to == ch) {
                if (cur.from != cur.to && sticky == "before") { found = i; }
                else { bidiOther = i; }
            }
            if (cur.from == ch) {
                if (cur.from != cur.to && sticky != "before") { found = i; }
                else { bidiOther = i; }
            }
        }
        return found != null ? found : bidiOther
    }

    // Bidirectional ordering algorithm
    // See http://unicode.org/reports/tr9/tr9-13.html for the algorithm
    // that this (partially) implements.

    // One-char codes used for character types:
    // L (L):   Left-to-Right
    // R (R):   Right-to-Left
    // r (AL):  Right-to-Left Arabic
    // 1 (EN):  European Number
    // + (ES):  European Number Separator
    // % (ET):  European Number Terminator
    // n (AN):  Arabic Number
    // , (CS):  Common Number Separator
    // m (NSM): Non-Spacing Mark
    // b (BN):  Boundary Neutral
    // s (B):   Paragraph Separator
    // t (S):   Segment Separator
    // w (WS):  Whitespace
    // N (ON):  Other Neutrals

    // Returns null if characters are ordered as they appear
    // (left-to-right), or an array of sections ({from, to, level}
    // objects) in the order in which they occur visually.
    var bidiOrdering = (function() {
        // Character types for codepoints 0 to 0xff
        var lowTypes = "bbbbbbbbbtstwsbbbbbbbbbbbbbbssstwNN%%%NNNNNN,N,N1111111111NNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNbbbbbbsbbbbbbbbbbbbbbbbbbbbbbbbbb,N%%%%NNNNLNNNNN%%11NLNNN1LNNNNNLLLLLLLLLLLLLLLLLLLLLLLNLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLN";
        // Character types for codepoints 0x600 to 0x6f9
        var arabicTypes = "nnnnnnNNr%%r,rNNmmmmmmmmmmmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmmmmmmmmnnnnnnnnnn%nnrrrmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmnNmmmmmmrrmmNmmmmrr1111111111";
        function charType(code) {
            if (code <= 0xf7) { return lowTypes.charAt(code) }
            else if (0x590 <= code && code <= 0x5f4) { return "R" }
            else if (0x600 <= code && code <= 0x6f9) { return arabicTypes.charAt(code - 0x600) }
            else if (0x6ee <= code && code <= 0x8ac) { return "r" }
            else if (0x2000 <= code && code <= 0x200b) { return "w" }
            else if (code == 0x200c) { return "b" }
            else { return "L" }
        }

        var bidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac]/;
        var isNeutral = /[stwN]/, isStrong = /[LRr]/, countsAsLeft = /[Lb1n]/, countsAsNum = /[1n]/;

        function BidiSpan(level, from, to) {
            this.level = level;
            this.from = from; this.to = to;
        }

        return function(str, direction) {
            var outerType = direction == "ltr" ? "L" : "R";

            if (str.length == 0 || direction == "ltr" && !bidiRE.test(str)) { return false }
            var len = str.length, types = [];
            for (var i = 0; i < len; ++i)
            { types.push(charType(str.charCodeAt(i))); }

            // W1. Examine each non-spacing mark (NSM) in the level run, and
            // change the type of the NSM to the type of the previous
            // character. If the NSM is at the start of the level run, it will
            // get the type of sor.
            for (var i$1 = 0, prev = outerType; i$1 < len; ++i$1) {
                var type = types[i$1];
                if (type == "m") { types[i$1] = prev; }
                else { prev = type; }
            }

            // W2. Search backwards from each instance of a European number
            // until the first strong type (R, L, AL, or sor) is found. If an
            // AL is found, change the type of the European number to Arabic
            // number.
            // W3. Change all ALs to R.
            for (var i$2 = 0, cur = outerType; i$2 < len; ++i$2) {
                var type$1 = types[i$2];
                if (type$1 == "1" && cur == "r") { types[i$2] = "n"; }
                else if (isStrong.test(type$1)) { cur = type$1; if (type$1 == "r") { types[i$2] = "R"; } }
            }

            // W4. A single European separator between two European numbers
            // changes to a European number. A single common separator between
            // two numbers of the same type changes to that type.
            for (var i$3 = 1, prev$1 = types[0]; i$3 < len - 1; ++i$3) {
                var type$2 = types[i$3];
                if (type$2 == "+" && prev$1 == "1" && types[i$3+1] == "1") { types[i$3] = "1"; }
                else if (type$2 == "," && prev$1 == types[i$3+1] &&
                    (prev$1 == "1" || prev$1 == "n")) { types[i$3] = prev$1; }
                prev$1 = type$2;
            }

            // W5. A sequence of European terminators adjacent to European
            // numbers changes to all European numbers.
            // W6. Otherwise, separators and terminators change to Other
            // Neutral.
            for (var i$4 = 0; i$4 < len; ++i$4) {
                var type$3 = types[i$4];
                if (type$3 == ",") { types[i$4] = "N"; }
                else if (type$3 == "%") {
                    var end = (void 0);
                    for (end = i$4 + 1; end < len && types[end] == "%"; ++end) {}
                    var replace = (i$4 && types[i$4-1] == "!") || (end < len && types[end] == "1") ? "1" : "N";
                    for (var j = i$4; j < end; ++j) { types[j] = replace; }
                    i$4 = end - 1;
                }
            }

            // W7. Search backwards from each instance of a European number
            // until the first strong type (R, L, or sor) is found. If an L is
            // found, then change the type of the European number to L.
            for (var i$5 = 0, cur$1 = outerType; i$5 < len; ++i$5) {
                var type$4 = types[i$5];
                if (cur$1 == "L" && type$4 == "1") { types[i$5] = "L"; }
                else if (isStrong.test(type$4)) { cur$1 = type$4; }
            }

            // N1. A sequence of neutrals takes the direction of the
            // surrounding strong text if the text on both sides has the same
            // direction. European and Arabic numbers act as if they were R in
            // terms of their influence on neutrals. Start-of-level-run (sor)
            // and end-of-level-run (eor) are used at level run boundaries.
            // N2. Any remaining neutrals take the embedding direction.
            for (var i$6 = 0; i$6 < len; ++i$6) {
                if (isNeutral.test(types[i$6])) {
                    var end$1 = (void 0);
                    for (end$1 = i$6 + 1; end$1 < len && isNeutral.test(types[end$1]); ++end$1) {}
                    var before = (i$6 ? types[i$6-1] : outerType) == "L";
                    var after = (end$1 < len ? types[end$1] : outerType) == "L";
                    var replace$1 = before == after ? (before ? "L" : "R") : outerType;
                    for (var j$1 = i$6; j$1 < end$1; ++j$1) { types[j$1] = replace$1; }
                    i$6 = end$1 - 1;
                }
            }

            // Here we depart from the documented algorithm, in order to avoid
            // building up an actual levels array. Since there are only three
            // levels (0, 1, 2) in an implementation that doesn't take
            // explicit embedding into account, we can build up the order on
            // the fly, without following the level-based algorithm.
            var order = [], m;
            for (var i$7 = 0; i$7 < len;) {
                if (countsAsLeft.test(types[i$7])) {
                    var start = i$7;
                    for (++i$7; i$7 < len && countsAsLeft.test(types[i$7]); ++i$7) {}
                    order.push(new BidiSpan(0, start, i$7));
                } else {
                    var pos = i$7, at = order.length, isRTL = direction == "rtl" ? 1 : 0;
                    for (++i$7; i$7 < len && types[i$7] != "L"; ++i$7) {}
                    for (var j$2 = pos; j$2 < i$7;) {
                        if (countsAsNum.test(types[j$2])) {
                            if (pos < j$2) { order.splice(at, 0, new BidiSpan(1, pos, j$2)); at += isRTL; }
                            var nstart = j$2;
                            for (++j$2; j$2 < i$7 && countsAsNum.test(types[j$2]); ++j$2) {}
                            order.splice(at, 0, new BidiSpan(2, nstart, j$2));
                            at += isRTL;
                            pos = j$2;
                        } else { ++j$2; }
                    }
                    if (pos < i$7) { order.splice(at, 0, new BidiSpan(1, pos, i$7)); }
                }
            }
            if (direction == "ltr") {
                if (order[0].level == 1 && (m = str.match(/^\s+/))) {
                    order[0].from = m[0].length;
                    order.unshift(new BidiSpan(0, 0, m[0].length));
                }
                if (lst(order).level == 1 && (m = str.match(/\s+$/))) {
                    lst(order).to -= m[0].length;
                    order.push(new BidiSpan(0, len - m[0].length, len));
                }
            }

            return direction == "rtl" ? order.reverse() : order
        }
    })();

    // Get the bidi ordering for the given line (and cache it). Returns
    // false for lines that are fully left-to-right, and an array of
    // BidiSpan objects otherwise.
    function getOrder(line, direction) {
        var order = line.order;
        if (order == null) { order = line.order = bidiOrdering(line.text, direction); }
        return order
    }

    // EVENT HANDLING

    // Lightweight event framework. on/off also work on DOM nodes,
    // registering native DOM handlers.

    var noHandlers = [];

    var on = function(emitter, type, f) {
        if (emitter.addEventListener) {
            emitter.addEventListener(type, f, false);
        } else if (emitter.attachEvent) {
            emitter.attachEvent("on" + type, f);
        } else {
            var map = emitter._handlers || (emitter._handlers = {});
            map[type] = (map[type] || noHandlers).concat(f);
        }
    };

    function getHandlers(emitter, type) {
        return emitter._handlers && emitter._handlers[type] || noHandlers
    }

    function off(emitter, type, f) {
        if (emitter.removeEventListener) {
            emitter.removeEventListener(type, f, false);
        } else if (emitter.detachEvent) {
            emitter.detachEvent("on" + type, f);
        } else {
            var map = emitter._handlers, arr = map && map[type];
            if (arr) {
                var index = indexOf(arr, f);
                if (index > -1)
                { map[type] = arr.slice(0, index).concat(arr.slice(index + 1)); }
            }
        }
    }

    function signal(emitter, type /*, values...*/) {
        var handlers = getHandlers(emitter, type);
        if (!handlers.length) { return }
        var args = Array.prototype.slice.call(arguments, 2);
        for (var i = 0; i < handlers.length; ++i) { handlers[i].apply(null, args); }
    }

    // The DOM events that CodeMirror handles can be overridden by
    // registering a (non-DOM) handler on the editor for the event name,
    // and preventDefault-ing the event in that handler.
    function signalDOMEvent(cm, e, override) {
        if (typeof e == "string")
        { e = {type: e, preventDefault: function() { this.defaultPrevented = true; }}; }
        signal(cm, override || e.type, cm, e);
        return e_defaultPrevented(e) || e.codemirrorIgnore
    }

    function signalCursorActivity(cm) {
        var arr = cm._handlers && cm._handlers.cursorActivity;
        if (!arr) { return }
        var set = cm.curOp.cursorActivityHandlers || (cm.curOp.cursorActivityHandlers = []);
        for (var i = 0; i < arr.length; ++i) { if (indexOf(set, arr[i]) == -1)
        { set.push(arr[i]); } }
    }

    function hasHandler(emitter, type) {
        return getHandlers(emitter, type).length > 0
    }

    // Add on and off methods to a constructor's prototype, to make
    // registering events on such objects more convenient.
    function eventMixin(ctor) {
        ctor.prototype.on = function(type, f) {on(this, type, f);};
        ctor.prototype.off = function(type, f) {off(this, type, f);};
    }

    // Due to the fact that we still support jurassic IE versions, some
    // compatibility wrappers are needed.

    function e_preventDefault(e) {
        if (e.preventDefault) { e.preventDefault(); }
        else { e.returnValue = false; }
    }
    function e_stopPropagation(e) {
        if (e.stopPropagation) { e.stopPropagation(); }
        else { e.cancelBubble = true; }
    }
    function e_defaultPrevented(e) {
        return e.defaultPrevented != null ? e.defaultPrevented : e.returnValue == false
    }
    function e_stop(e) {e_preventDefault(e); e_stopPropagation(e);}

    function e_target(e) {return e.target || e.srcElement}
    function e_button(e) {
        var b = e.which;
        if (b == null) {
            if (e.button & 1) { b = 1; }
            else if (e.button & 2) { b = 3; }
            else if (e.button & 4) { b = 2; }
        }
        if (mac && e.ctrlKey && b == 1) { b = 3; }
        return b
    }

    // Detect drag-and-drop
    var dragAndDrop = function() {
        // There is *some* kind of drag-and-drop support in IE6-8, but I
        // couldn't get it to work yet.
        if (ie && ie_version < 9) { return false }
        var div = elt('div');
        return "draggable" in div || "dragDrop" in div
    }();

    var zwspSupported;
    function zeroWidthElement(measure) {
        if (zwspSupported == null) {
            var test = elt("span", "\u200b");
            removeChildrenAndAdd(measure, elt("span", [test, document.createTextNode("x")]));
            if (measure.firstChild.offsetHeight != 0)
            { zwspSupported = test.offsetWidth <= 1 && test.offsetHeight > 2 && !(ie && ie_version < 8); }
        }
        var node = zwspSupported ? elt("span", "\u200b") :
            elt("span", "\u00a0", null, "display: inline-block; width: 1px; margin-right: -1px");
        node.setAttribute("cm-text", "");
        return node
    }

    // Feature-detect IE's crummy client rect reporting for bidi text
    var badBidiRects;
    function hasBadBidiRects(measure) {
        if (badBidiRects != null) { return badBidiRects }
        var txt = removeChildrenAndAdd(measure, document.createTextNode("A\u062eA"));
        var r0 = range(txt, 0, 1).getBoundingClientRect();
        var r1 = range(txt, 1, 2).getBoundingClientRect();
        removeChildren(measure);
        if (!r0 || r0.left == r0.right) { return false } // Safari returns null in some cases (#2780)
        return badBidiRects = (r1.right - r0.right < 3)
    }

    // See if "".split is the broken IE version, if so, provide an
    // alternative way to split lines.
    var splitLinesAuto = "\n\nb".split(/\n/).length != 3 ? function (string) {
        var pos = 0, result = [], l = string.length;
        while (pos <= l) {
            var nl = string.indexOf("\n", pos);
            if (nl == -1) { nl = string.length; }
            var line = string.slice(pos, string.charAt(nl - 1) == "\r" ? nl - 1 : nl);
            var rt = line.indexOf("\r");
            if (rt != -1) {
                result.push(line.slice(0, rt));
                pos += rt + 1;
            } else {
                result.push(line);
                pos = nl + 1;
            }
        }
        return result
    } : function (string) { return string.split(/\r\n?|\n/); };

    var hasSelection = window.getSelection ? function (te) {
        try { return te.selectionStart != te.selectionEnd }
        catch(e) { return false }
    } : function (te) {
        var range;
        try {range = te.ownerDocument.selection.createRange();}
        catch(e) {}
        if (!range || range.parentElement() != te) { return false }
        return range.compareEndPoints("StartToEnd", range) != 0
    };

    var hasCopyEvent = (function () {
        var e = elt("div");
        if ("oncopy" in e) { return true }
        e.setAttribute("oncopy", "return;");
        return typeof e.oncopy == "function"
    })();

    var badZoomedRects = null;
    function hasBadZoomedRects(measure) {
        if (badZoomedRects != null) { return badZoomedRects }
        var node = removeChildrenAndAdd(measure, elt("span", "x"));
        var normal = node.getBoundingClientRect();
        var fromRange = range(node, 0, 1).getBoundingClientRect();
        return badZoomedRects = Math.abs(normal.left - fromRange.left) > 1
    }

    // Known modes, by name and by MIME
    var modes = {}, mimeModes = {};

    // Extra arguments are stored as the mode's dependencies, which is
    // used by (legacy) mechanisms like loadmode.js to automatically
    // load a mode. (Preferred mechanism is the require/define calls.)
    function defineMode(name, mode) {
        if (arguments.length > 2)
        { mode.dependencies = Array.prototype.slice.call(arguments, 2); }
        modes[name] = mode;
    }

    function defineMIME(mime, spec) {
        mimeModes[mime] = spec;
    }

    // Given a MIME type, a {name, ...options} config object, or a name
    // string, return a mode config object.
    function resolveMode(spec) {
        if (typeof spec == "string" && mimeModes.hasOwnProperty(spec)) {
            spec = mimeModes[spec];
        } else if (spec && typeof spec.name == "string" && mimeModes.hasOwnProperty(spec.name)) {
            var found = mimeModes[spec.name];
            if (typeof found == "string") { found = {name: found}; }
            spec = createObj(found, spec);
            spec.name = found.name;
        } else if (typeof spec == "string" && /^[\w\-]+\/[\w\-]+\+xml$/.test(spec)) {
            return resolveMode("application/xml")
        } else if (typeof spec == "string" && /^[\w\-]+\/[\w\-]+\+json$/.test(spec)) {
            return resolveMode("application/json")
        }
        if (typeof spec == "string") { return {name: spec} }
        else { return spec || {name: "null"} }
    }

    // Given a mode spec (anything that resolveMode accepts), find and
    // initialize an actual mode object.
    function getMode(options, spec) {
        spec = resolveMode(spec);
        var mfactory = modes[spec.name];
        if (!mfactory) { return getMode(options, "text/plain") }
        var modeObj = mfactory(options, spec);
        if (modeExtensions.hasOwnProperty(spec.name)) {
            var exts = modeExtensions[spec.name];
            for (var prop in exts) {
                if (!exts.hasOwnProperty(prop)) { continue }
                if (modeObj.hasOwnProperty(prop)) { modeObj["_" + prop] = modeObj[prop]; }
                modeObj[prop] = exts[prop];
            }
        }
        modeObj.name = spec.name;
        if (spec.helperType) { modeObj.helperType = spec.helperType; }
        if (spec.modeProps) { for (var prop$1 in spec.modeProps)
        { modeObj[prop$1] = spec.modeProps[prop$1]; } }

        return modeObj
    }

    // This can be used to attach properties to mode objects from
    // outside the actual mode definition.
    var modeExtensions = {};
    function extendMode(mode, properties) {
        var exts = modeExtensions.hasOwnProperty(mode) ? modeExtensions[mode] : (modeExtensions[mode] = {});
        copyObj(properties, exts);
    }

    function copyState(mode, state) {
        if (state === true) { return state }
        if (mode.copyState) { return mode.copyState(state) }
        var nstate = {};
        for (var n in state) {
            var val = state[n];
            if (val instanceof Array) { val = val.concat([]); }
            nstate[n] = val;
        }
        return nstate
    }

    // Given a mode and a state (for that mode), find the inner mode and
    // state at the position that the state refers to.
    function innerMode(mode, state) {
        var info;
        while (mode.innerMode) {
            info = mode.innerMode(state);
            if (!info || info.mode == mode) { break }
            state = info.state;
            mode = info.mode;
        }
        return info || {mode: mode, state: state}
    }

    function startState(mode, a1, a2) {
        return mode.startState ? mode.startState(a1, a2) : true
    }

    // STRING STREAM

    // Fed to the mode parsers, provides helper functions to make
    // parsers more succinct.

    var StringStream = function(string, tabSize, lineOracle) {
        this.pos = this.start = 0;
        this.string = string;
        this.tabSize = tabSize || 8;
        this.lastColumnPos = this.lastColumnValue = 0;
        this.lineStart = 0;
        this.lineOracle = lineOracle;
    };

    StringStream.prototype.eol = function () {return this.pos >= this.string.length};
    StringStream.prototype.sol = function () {return this.pos == this.lineStart};
    StringStream.prototype.peek = function () {return this.string.charAt(this.pos) || undefined};
    StringStream.prototype.next = function () {
        if (this.pos < this.string.length)
        { return this.string.charAt(this.pos++) }
    };
    StringStream.prototype.eat = function (match) {
        var ch = this.string.charAt(this.pos);
        var ok;
        if (typeof match == "string") { ok = ch == match; }
        else { ok = ch && (match.test ? match.test(ch) : match(ch)); }
        if (ok) {++this.pos; return ch}
    };
    StringStream.prototype.eatWhile = function (match) {
        var start = this.pos;
        while (this.eat(match)){}
        return this.pos > start
    };
    StringStream.prototype.eatSpace = function () {
        var start = this.pos;
        while (/[\s\u00a0]/.test(this.string.charAt(this.pos))) { ++this.pos; }
        return this.pos > start
    };
    StringStream.prototype.skipToEnd = function () {this.pos = this.string.length;};
    StringStream.prototype.skipTo = function (ch) {
        var found = this.string.indexOf(ch, this.pos);
        if (found > -1) {this.pos = found; return true}
    };
    StringStream.prototype.backUp = function (n) {this.pos -= n;};
    StringStream.prototype.column = function () {
        if (this.lastColumnPos < this.start) {
            this.lastColumnValue = countColumn(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue);
            this.lastColumnPos = this.start;
        }
        return this.lastColumnValue - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0)
    };
    StringStream.prototype.indentation = function () {
        return countColumn(this.string, null, this.tabSize) -
            (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0)
    };
    StringStream.prototype.match = function (pattern, consume, caseInsensitive) {
        if (typeof pattern == "string") {
            var cased = function (str) { return caseInsensitive ? str.toLowerCase() : str; };
            var substr = this.string.substr(this.pos, pattern.length);
            if (cased(substr) == cased(pattern)) {
                if (consume !== false) { this.pos += pattern.length; }
                return true
            }
        } else {
            var match = this.string.slice(this.pos).match(pattern);
            if (match && match.index > 0) { return null }
            if (match && consume !== false) { this.pos += match[0].length; }
            return match
        }
    };
    StringStream.prototype.current = function (){return this.string.slice(this.start, this.pos)};
    StringStream.prototype.hideFirstChars = function (n, inner) {
        this.lineStart += n;
        try { return inner() }
        finally { this.lineStart -= n; }
    };
    StringStream.prototype.lookAhead = function (n) {
        var oracle = this.lineOracle;
        return oracle && oracle.lookAhead(n)
    };
    StringStream.prototype.baseToken = function () {
        var oracle = this.lineOracle;
        return oracle && oracle.baseToken(this.pos)
    };

    // Find the line object corresponding to the given line number.
    function getLine(doc, n) {
        n -= doc.first;
        if (n < 0 || n >= doc.size) { throw new Error("There is no line " + (n + doc.first) + " in the document.") }
        var chunk = doc;
        while (!chunk.lines) {
            for (var i = 0;; ++i) {
                var child = chunk.children[i], sz = child.chunkSize();
                if (n < sz) { chunk = child; break }
                n -= sz;
            }
        }
        return chunk.lines[n]
    }

    // Get the part of a document between two positions, as an array of
    // strings.
    function getBetween(doc, start, end) {
        var out = [], n = start.line;
        doc.iter(start.line, end.line + 1, function (line) {
            var text = line.text;
            if (n == end.line) { text = text.slice(0, end.ch); }
            if (n == start.line) { text = text.slice(start.ch); }
            out.push(text);
            ++n;
        });
        return out
    }
    // Get the lines between from and to, as array of strings.
    function getLines(doc, from, to) {
        var out = [];
        doc.iter(from, to, function (line) { out.push(line.text); }); // iter aborts when callback returns truthy value
        return out
    }

    // Update the height of a line, propagating the height change
    // upwards to parent nodes.
    function updateLineHeight(line, height) {
        var diff = height - line.height;
        if (diff) { for (var n = line; n; n = n.parent) { n.height += diff; } }
    }

    // Given a line object, find its line number by walking up through
    // its parent links.
    function lineNo(line) {
        if (line.parent == null) { return null }
        var cur = line.parent, no = indexOf(cur.lines, line);
        for (var chunk = cur.parent; chunk; cur = chunk, chunk = chunk.parent) {
            for (var i = 0;; ++i) {
                if (chunk.children[i] == cur) { break }
                no += chunk.children[i].chunkSize();
            }
        }
        return no + cur.first
    }

    // Find the line at the given vertical position, using the height
    // information in the document tree.
    function lineAtHeight(chunk, h) {
        var n = chunk.first;
        outer: do {
            for (var i$1 = 0; i$1 < chunk.children.length; ++i$1) {
                var child = chunk.children[i$1], ch = child.height;
                if (h < ch) { chunk = child; continue outer }
                h -= ch;
                n += child.chunkSize();
            }
            return n
        } while (!chunk.lines)
        var i = 0;
        for (; i < chunk.lines.length; ++i) {
            var line = chunk.lines[i], lh = line.height;
            if (h < lh) { break }
            h -= lh;
        }
        return n + i
    }

    function isLine(doc, l) {return l >= doc.first && l < doc.first + doc.size}

    function lineNumberFor(options, i) {
        return String(options.lineNumberFormatter(i + options.firstLineNumber))
    }

    // A Pos instance represents a position within the text.
    function Pos(line, ch, sticky) {
        if ( sticky === void 0 ) sticky = null;

        if (!(this instanceof Pos)) { return new Pos(line, ch, sticky) }
        this.line = line;
        this.ch = ch;
        this.sticky = sticky;
    }

    // Compare two positions, return 0 if they are the same, a negative
    // number when a is less, and a positive number otherwise.
    function cmp(a, b) { return a.line - b.line || a.ch - b.ch }

    function equalCursorPos(a, b) { return a.sticky == b.sticky && cmp(a, b) == 0 }

    function copyPos(x) {return Pos(x.line, x.ch)}
    function maxPos(a, b) { return cmp(a, b) < 0 ? b : a }
    function minPos(a, b) { return cmp(a, b) < 0 ? a : b }

    // Most of the external API clips given positions to make sure they
    // actually exist within the document.
    function clipLine(doc, n) {return Math.max(doc.first, Math.min(n, doc.first + doc.size - 1))}
    function clipPos(doc, pos) {
        if (pos.line < doc.first) { return Pos(doc.first, 0) }
        var last = doc.first + doc.size - 1;
        if (pos.line > last) { return Pos(last, getLine(doc, last).text.length) }
        return clipToLen(pos, getLine(doc, pos.line).text.length)
    }
    function clipToLen(pos, linelen) {
        var ch = pos.ch;
        if (ch == null || ch > linelen) { return Pos(pos.line, linelen) }
        else if (ch < 0) { return Pos(pos.line, 0) }
        else { return pos }
    }
    function clipPosArray(doc, array) {
        var out = [];
        for (var i = 0; i < array.length; i++) { out[i] = clipPos(doc, array[i]); }
        return out
    }

    var SavedContext = function(state, lookAhead) {
        this.state = state;
        this.lookAhead = lookAhead;
    };

    var Context = function(doc, state, line, lookAhead) {
        this.state = state;
        this.doc = doc;
        this.line = line;
        this.maxLookAhead = lookAhead || 0;
        this.baseTokens = null;
        this.baseTokenPos = 1;
    };

    Context.prototype.lookAhead = function (n) {
        var line = this.doc.getLine(this.line + n);
        if (line != null && n > this.maxLookAhead) { this.maxLookAhead = n; }
        return line
    };

    Context.prototype.baseToken = function (n) {
        if (!this.baseTokens) { return null }
        while (this.baseTokens[this.baseTokenPos] <= n)
        { this.baseTokenPos += 2; }
        var type = this.baseTokens[this.baseTokenPos + 1];
        return {type: type && type.replace(/( |^)overlay .*/, ""),
            size: this.baseTokens[this.baseTokenPos] - n}
    };

    Context.prototype.nextLine = function () {
        this.line++;
        if (this.maxLookAhead > 0) { this.maxLookAhead--; }
    };

    Context.fromSaved = function (doc, saved, line) {
        if (saved instanceof SavedContext)
        { return new Context(doc, copyState(doc.mode, saved.state), line, saved.lookAhead) }
        else
        { return new Context(doc, copyState(doc.mode, saved), line) }
    };

    Context.prototype.save = function (copy) {
        var state = copy !== false ? copyState(this.doc.mode, this.state) : this.state;
        return this.maxLookAhead > 0 ? new SavedContext(state, this.maxLookAhead) : state
    };


    // Compute a style array (an array starting with a mode generation
    // -- for invalidation -- followed by pairs of end positions and
    // style strings), which is used to highlight the tokens on the
    // line.
    function highlightLine(cm, line, context, forceToEnd) {
        // A styles array always starts with a number identifying the
        // mode/overlays that it is based on (for easy invalidation).
        var st = [cm.state.modeGen], lineClasses = {};
        // Compute the base array of styles
        runMode(cm, line.text, cm.doc.mode, context, function (end, style) { return st.push(end, style); },
            lineClasses, forceToEnd);
        var state = context.state;

        // Run overlays, adjust style array.
        var loop = function ( o ) {
            context.baseTokens = st;
            var overlay = cm.state.overlays[o], i = 1, at = 0;
            context.state = true;
            runMode(cm, line.text, overlay.mode, context, function (end, style) {
                var start = i;
                // Ensure there's a token end at the current position, and that i points at it
                while (at < end) {
                    var i_end = st[i];
                    if (i_end > end)
                    { st.splice(i, 1, end, st[i+1], i_end); }
                    i += 2;
                    at = Math.min(end, i_end);
                }
                if (!style) { return }
                if (overlay.opaque) {
                    st.splice(start, i - start, end, "overlay " + style);
                    i = start + 2;
                } else {
                    for (; start < i; start += 2) {
                        var cur = st[start+1];
                        st[start+1] = (cur ? cur + " " : "") + "overlay " + style;
                    }
                }
            }, lineClasses);
            context.state = state;
            context.baseTokens = null;
            context.baseTokenPos = 1;
        };

        for (var o = 0; o < cm.state.overlays.length; ++o) loop( o );

        return {styles: st, classes: lineClasses.bgClass || lineClasses.textClass ? lineClasses : null}
    }

    function getLineStyles(cm, line, updateFrontier) {
        if (!line.styles || line.styles[0] != cm.state.modeGen) {
            var context = getContextBefore(cm, lineNo(line));
            var resetState = line.text.length > cm.options.maxHighlightLength && copyState(cm.doc.mode, context.state);
            var result = highlightLine(cm, line, context);
            if (resetState) { context.state = resetState; }
            line.stateAfter = context.save(!resetState);
            line.styles = result.styles;
            if (result.classes) { line.styleClasses = result.classes; }
            else if (line.styleClasses) { line.styleClasses = null; }
            if (updateFrontier === cm.doc.highlightFrontier)
            { cm.doc.modeFrontier = Math.max(cm.doc.modeFrontier, ++cm.doc.highlightFrontier); }
        }
        return line.styles
    }

    function getContextBefore(cm, n, precise) {
        var doc = cm.doc, display = cm.display;
        if (!doc.mode.startState) { return new Context(doc, true, n) }
        var start = findStartLine(cm, n, precise);
        var saved = start > doc.first && getLine(doc, start - 1).stateAfter;
        var context = saved ? Context.fromSaved(doc, saved, start) : new Context(doc, startState(doc.mode), start);

        doc.iter(start, n, function (line) {
            processLine(cm, line.text, context);
            var pos = context.line;
            line.stateAfter = pos == n - 1 || pos % 5 == 0 || pos >= display.viewFrom && pos < display.viewTo ? context.save() : null;
            context.nextLine();
        });
        if (precise) { doc.modeFrontier = context.line; }
        return context
    }

    // Lightweight form of highlight -- proceed over this line and
    // update state, but don't save a style array. Used for lines that
    // aren't currently visible.
    function processLine(cm, text, context, startAt) {
        var mode = cm.doc.mode;
        var stream = new StringStream(text, cm.options.tabSize, context);
        stream.start = stream.pos = startAt || 0;
        if (text == "") { callBlankLine(mode, context.state); }
        while (!stream.eol()) {
            readToken(mode, stream, context.state);
            stream.start = stream.pos;
        }
    }

    function callBlankLine(mode, state) {
        if (mode.blankLine) { return mode.blankLine(state) }
        if (!mode.innerMode) { return }
        var inner = innerMode(mode, state);
        if (inner.mode.blankLine) { return inner.mode.blankLine(inner.state) }
    }

    function readToken(mode, stream, state, inner) {
        for (var i = 0; i < 10; i++) {
            if (inner) { inner[0] = innerMode(mode, state).mode; }
            var style = mode.token(stream, state);
            if (stream.pos > stream.start) { return style }
        }
        throw new Error("Mode " + mode.name + " failed to advance stream.")
    }

    var Token = function(stream, type, state) {
        this.start = stream.start; this.end = stream.pos;
        this.string = stream.current();
        this.type = type || null;
        this.state = state;
    };

    // Utility for getTokenAt and getLineTokens
    function takeToken(cm, pos, precise, asArray) {
        var doc = cm.doc, mode = doc.mode, style;
        pos = clipPos(doc, pos);
        var line = getLine(doc, pos.line), context = getContextBefore(cm, pos.line, precise);
        var stream = new StringStream(line.text, cm.options.tabSize, context), tokens;
        if (asArray) { tokens = []; }
        while ((asArray || stream.pos < pos.ch) && !stream.eol()) {
            stream.start = stream.pos;
            style = readToken(mode, stream, context.state);
            if (asArray) { tokens.push(new Token(stream, style, copyState(doc.mode, context.state))); }
        }
        return asArray ? tokens : new Token(stream, style, context.state)
    }

    function extractLineClasses(type, output) {
        if (type) { for (;;) {
            var lineClass = type.match(/(?:^|\s+)line-(background-)?(\S+)/);
            if (!lineClass) { break }
            type = type.slice(0, lineClass.index) + type.slice(lineClass.index + lineClass[0].length);
            var prop = lineClass[1] ? "bgClass" : "textClass";
            if (output[prop] == null)
            { output[prop] = lineClass[2]; }
            else if (!(new RegExp("(?:^|\\s)" + lineClass[2] + "(?:$|\\s)")).test(output[prop]))
            { output[prop] += " " + lineClass[2]; }
        } }
        return type
    }

    // Run the given mode's parser over a line, calling f for each token.
    function runMode(cm, text, mode, context, f, lineClasses, forceToEnd) {
        var flattenSpans = mode.flattenSpans;
        if (flattenSpans == null) { flattenSpans = cm.options.flattenSpans; }
        var curStart = 0, curStyle = null;
        var stream = new StringStream(text, cm.options.tabSize, context), style;
        var inner = cm.options.addModeClass && [null];
        if (text == "") { extractLineClasses(callBlankLine(mode, context.state), lineClasses); }
        while (!stream.eol()) {
            if (stream.pos > cm.options.maxHighlightLength) {
                flattenSpans = false;
                if (forceToEnd) { processLine(cm, text, context, stream.pos); }
                stream.pos = text.length;
                style = null;
            } else {
                style = extractLineClasses(readToken(mode, stream, context.state, inner), lineClasses);
            }
            if (inner) {
                var mName = inner[0].name;
                if (mName) { style = "m-" + (style ? mName + " " + style : mName); }
            }
            if (!flattenSpans || curStyle != style) {
                while (curStart < stream.start) {
                    curStart = Math.min(stream.start, curStart + 5000);
                    f(curStart, curStyle);
                }
                curStyle = style;
            }
            stream.start = stream.pos;
        }
        while (curStart < stream.pos) {
            // Webkit seems to refuse to render text nodes longer than 57444
            // characters, and returns inaccurate measurements in nodes
            // starting around 5000 chars.
            var pos = Math.min(stream.pos, curStart + 5000);
            f(pos, curStyle);
            curStart = pos;
        }
    }

    // Finds the line to start with when starting a parse. Tries to
    // find a line with a stateAfter, so that it can start with a
    // valid state. If that fails, it returns the line with the
    // smallest indentation, which tends to need the least context to
    // parse correctly.
    function findStartLine(cm, n, precise) {
        var minindent, minline, doc = cm.doc;
        var lim = precise ? -1 : n - (cm.doc.mode.innerMode ? 1000 : 100);
        for (var search = n; search > lim; --search) {
            if (search <= doc.first) { return doc.first }
            var line = getLine(doc, search - 1), after = line.stateAfter;
            if (after && (!precise || search + (after instanceof SavedContext ? after.lookAhead : 0) <= doc.modeFrontier))
            { return search }
            var indented = countColumn(line.text, null, cm.options.tabSize);
            if (minline == null || minindent > indented) {
                minline = search - 1;
                minindent = indented;
            }
        }
        return minline
    }

    function retreatFrontier(doc, n) {
        doc.modeFrontier = Math.min(doc.modeFrontier, n);
        if (doc.highlightFrontier < n - 10) { return }
        var start = doc.first;
        for (var line = n - 1; line > start; line--) {
            var saved = getLine(doc, line).stateAfter;
            // change is on 3
            // state on line 1 looked ahead 2 -- so saw 3
            // test 1 + 2 < 3 should cover this
            if (saved && (!(saved instanceof SavedContext) || line + saved.lookAhead < n)) {
                start = line + 1;
                break
            }
        }
        doc.highlightFrontier = Math.min(doc.highlightFrontier, start);
    }

    // Optimize some code when these features are not used.
    var sawReadOnlySpans = false, sawCollapsedSpans = false;

    function seeReadOnlySpans() {
        sawReadOnlySpans = true;
    }

    function seeCollapsedSpans() {
        sawCollapsedSpans = true;
    }

    // TEXTMARKER SPANS

    function MarkedSpan(marker, from, to) {
        this.marker = marker;
        this.from = from; this.to = to;
    }

    // Search an array of spans for a span matching the given marker.
    function getMarkedSpanFor(spans, marker) {
        if (spans) { for (var i = 0; i < spans.length; ++i) {
            var span = spans[i];
            if (span.marker == marker) { return span }
        } }
    }
    // Remove a span from an array, returning undefined if no spans are
    // left (we don't store arrays for lines without spans).
    function removeMarkedSpan(spans, span) {
        var r;
        for (var i = 0; i < spans.length; ++i)
        { if (spans[i] != span) { (r || (r = [])).push(spans[i]); } }
        return r
    }
    // Add a span to a line.
    function addMarkedSpan(line, span) {
        line.markedSpans = line.markedSpans ? line.markedSpans.concat([span]) : [span];
        span.marker.attachLine(line);
    }

    // Used for the algorithm that adjusts markers for a change in the
    // document. These functions cut an array of spans at a given
    // character position, returning an array of remaining chunks (or
    // undefined if nothing remains).
    function markedSpansBefore(old, startCh, isInsert) {
        var nw;
        if (old) { for (var i = 0; i < old.length; ++i) {
            var span = old[i], marker = span.marker;
            var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= startCh : span.from < startCh);
            if (startsBefore || span.from == startCh && marker.type == "bookmark" && (!isInsert || !span.marker.insertLeft)) {
                var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= startCh : span.to > startCh)
                ;(nw || (nw = [])).push(new MarkedSpan(marker, span.from, endsAfter ? null : span.to));
            }
        } }
        return nw
    }
    function markedSpansAfter(old, endCh, isInsert) {
        var nw;
        if (old) { for (var i = 0; i < old.length; ++i) {
            var span = old[i], marker = span.marker;
            var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= endCh : span.to > endCh);
            if (endsAfter || span.from == endCh && marker.type == "bookmark" && (!isInsert || span.marker.insertLeft)) {
                var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= endCh : span.from < endCh)
                ;(nw || (nw = [])).push(new MarkedSpan(marker, startsBefore ? null : span.from - endCh,
                    span.to == null ? null : span.to - endCh));
            }
        } }
        return nw
    }

    // Given a change object, compute the new set of marker spans that
    // cover the line in which the change took place. Removes spans
    // entirely within the change, reconnects spans belonging to the
    // same marker that appear on both sides of the change, and cuts off
    // spans partially within the change. Returns an array of span
    // arrays with one element for each line in (after) the change.
    function stretchSpansOverChange(doc, change) {
        if (change.full) { return null }
        var oldFirst = isLine(doc, change.from.line) && getLine(doc, change.from.line).markedSpans;
        var oldLast = isLine(doc, change.to.line) && getLine(doc, change.to.line).markedSpans;
        if (!oldFirst && !oldLast) { return null }

        var startCh = change.from.ch, endCh = change.to.ch, isInsert = cmp(change.from, change.to) == 0;
        // Get the spans that 'stick out' on both sides
        var first = markedSpansBefore(oldFirst, startCh, isInsert);
        var last = markedSpansAfter(oldLast, endCh, isInsert);

        // Next, merge those two ends
        var sameLine = change.text.length == 1, offset = lst(change.text).length + (sameLine ? startCh : 0);
        if (first) {
            // Fix up .to properties of first
            for (var i = 0; i < first.length; ++i) {
                var span = first[i];
                if (span.to == null) {
                    var found = getMarkedSpanFor(last, span.marker);
                    if (!found) { span.to = startCh; }
                    else if (sameLine) { span.to = found.to == null ? null : found.to + offset; }
                }
            }
        }
        if (last) {
            // Fix up .from in last (or move them into first in case of sameLine)
            for (var i$1 = 0; i$1 < last.length; ++i$1) {
                var span$1 = last[i$1];
                if (span$1.to != null) { span$1.to += offset; }
                if (span$1.from == null) {
                    var found$1 = getMarkedSpanFor(first, span$1.marker);
                    if (!found$1) {
                        span$1.from = offset;
                        if (sameLine) { (first || (first = [])).push(span$1); }
                    }
                } else {
                    span$1.from += offset;
                    if (sameLine) { (first || (first = [])).push(span$1); }
                }
            }
        }
        // Make sure we didn't create any zero-length spans
        if (first) { first = clearEmptySpans(first); }
        if (last && last != first) { last = clearEmptySpans(last); }

        var newMarkers = [first];
        if (!sameLine) {
            // Fill gap with whole-line-spans
            var gap = change.text.length - 2, gapMarkers;
            if (gap > 0 && first)
            { for (var i$2 = 0; i$2 < first.length; ++i$2)
            { if (first[i$2].to == null)
            { (gapMarkers || (gapMarkers = [])).push(new MarkedSpan(first[i$2].marker, null, null)); } } }
            for (var i$3 = 0; i$3 < gap; ++i$3)
            { newMarkers.push(gapMarkers); }
            newMarkers.push(last);
        }
        return newMarkers
    }

    // Remove spans that are empty and don't have a clearWhenEmpty
    // option of false.
    function clearEmptySpans(spans) {
        for (var i = 0; i < spans.length; ++i) {
            var span = spans[i];
            if (span.from != null && span.from == span.to && span.marker.clearWhenEmpty !== false)
            { spans.splice(i--, 1); }
        }
        if (!spans.length) { return null }
        return spans
    }

    // Used to 'clip' out readOnly ranges when making a change.
    function removeReadOnlyRanges(doc, from, to) {
        var markers = null;
        doc.iter(from.line, to.line + 1, function (line) {
            if (line.markedSpans) { for (var i = 0; i < line.markedSpans.length; ++i) {
                var mark = line.markedSpans[i].marker;
                if (mark.readOnly && (!markers || indexOf(markers, mark) == -1))
                { (markers || (markers = [])).push(mark); }
            } }
        });
        if (!markers) { return null }
        var parts = [{from: from, to: to}];
        for (var i = 0; i < markers.length; ++i) {
            var mk = markers[i], m = mk.find(0);
            for (var j = 0; j < parts.length; ++j) {
                var p = parts[j];
                if (cmp(p.to, m.from) < 0 || cmp(p.from, m.to) > 0) { continue }
                var newParts = [j, 1], dfrom = cmp(p.from, m.from), dto = cmp(p.to, m.to);
                if (dfrom < 0 || !mk.inclusiveLeft && !dfrom)
                { newParts.push({from: p.from, to: m.from}); }
                if (dto > 0 || !mk.inclusiveRight && !dto)
                { newParts.push({from: m.to, to: p.to}); }
                parts.splice.apply(parts, newParts);
                j += newParts.length - 3;
            }
        }
        return parts
    }

    // Connect or disconnect spans from a line.
    function detachMarkedSpans(line) {
        var spans = line.markedSpans;
        if (!spans) { return }
        for (var i = 0; i < spans.length; ++i)
        { spans[i].marker.detachLine(line); }
        line.markedSpans = null;
    }
    function attachMarkedSpans(line, spans) {
        if (!spans) { return }
        for (var i = 0; i < spans.length; ++i)
        { spans[i].marker.attachLine(line); }
        line.markedSpans = spans;
    }

    // Helpers used when computing which overlapping collapsed span
    // counts as the larger one.
    function extraLeft(marker) { return marker.inclusiveLeft ? -1 : 0 }
    function extraRight(marker) { return marker.inclusiveRight ? 1 : 0 }

    // Returns a number indicating which of two overlapping collapsed
    // spans is larger (and thus includes the other). Falls back to
    // comparing ids when the spans cover exactly the same range.
    function compareCollapsedMarkers(a, b) {
        var lenDiff = a.lines.length - b.lines.length;
        if (lenDiff != 0) { return lenDiff }
        var aPos = a.find(), bPos = b.find();
        var fromCmp = cmp(aPos.from, bPos.from) || extraLeft(a) - extraLeft(b);
        if (fromCmp) { return -fromCmp }
        var toCmp = cmp(aPos.to, bPos.to) || extraRight(a) - extraRight(b);
        if (toCmp) { return toCmp }
        return b.id - a.id
    }

    // Find out whether a line ends or starts in a collapsed span. If
    // so, return the marker for that span.
    function collapsedSpanAtSide(line, start) {
        var sps = sawCollapsedSpans && line.markedSpans, found;
        if (sps) { for (var sp = (void 0), i = 0; i < sps.length; ++i) {
            sp = sps[i];
            if (sp.marker.collapsed && (start ? sp.from : sp.to) == null &&
                (!found || compareCollapsedMarkers(found, sp.marker) < 0))
            { found = sp.marker; }
        } }
        return found
    }
    function collapsedSpanAtStart(line) { return collapsedSpanAtSide(line, true) }
    function collapsedSpanAtEnd(line) { return collapsedSpanAtSide(line, false) }

    function collapsedSpanAround(line, ch) {
        var sps = sawCollapsedSpans && line.markedSpans, found;
        if (sps) { for (var i = 0; i < sps.length; ++i) {
            var sp = sps[i];
            if (sp.marker.collapsed && (sp.from == null || sp.from < ch) && (sp.to == null || sp.to > ch) &&
                (!found || compareCollapsedMarkers(found, sp.marker) < 0)) { found = sp.marker; }
        } }
        return found
    }

    // Test whether there exists a collapsed span that partially
    // overlaps (covers the start or end, but not both) of a new span.
    // Such overlap is not allowed.
    function conflictingCollapsedRange(doc, lineNo, from, to, marker) {
        var line = getLine(doc, lineNo);
        var sps = sawCollapsedSpans && line.markedSpans;
        if (sps) { for (var i = 0; i < sps.length; ++i) {
            var sp = sps[i];
            if (!sp.marker.collapsed) { continue }
            var found = sp.marker.find(0);
            var fromCmp = cmp(found.from, from) || extraLeft(sp.marker) - extraLeft(marker);
            var toCmp = cmp(found.to, to) || extraRight(sp.marker) - extraRight(marker);
            if (fromCmp >= 0 && toCmp <= 0 || fromCmp <= 0 && toCmp >= 0) { continue }
            if (fromCmp <= 0 && (sp.marker.inclusiveRight && marker.inclusiveLeft ? cmp(found.to, from) >= 0 : cmp(found.to, from) > 0) ||
                fromCmp >= 0 && (sp.marker.inclusiveRight && marker.inclusiveLeft ? cmp(found.from, to) <= 0 : cmp(found.from, to) < 0))
            { return true }
        } }
    }

    // A visual line is a line as drawn on the screen. Folding, for
    // example, can cause multiple logical lines to appear on the same
    // visual line. This finds the start of the visual line that the
    // given line is part of (usually that is the line itself).
    function visualLine(line) {
        var merged;
        while (merged = collapsedSpanAtStart(line))
        { line = merged.find(-1, true).line; }
        return line
    }

    function visualLineEnd(line) {
        var merged;
        while (merged = collapsedSpanAtEnd(line))
        { line = merged.find(1, true).line; }
        return line
    }

    // Returns an array of logical lines that continue the visual line
    // started by the argument, or undefined if there are no such lines.
    function visualLineContinued(line) {
        var merged, lines;
        while (merged = collapsedSpanAtEnd(line)) {
            line = merged.find(1, true).line
            ;(lines || (lines = [])).push(line);
        }
        return lines
    }

    // Get the line number of the start of the visual line that the
    // given line number is part of.
    function visualLineNo(doc, lineN) {
        var line = getLine(doc, lineN), vis = visualLine(line);
        if (line == vis) { return lineN }
        return lineNo(vis)
    }

    // Get the line number of the start of the next visual line after
    // the given line.
    function visualLineEndNo(doc, lineN) {
        if (lineN > doc.lastLine()) { return lineN }
        var line = getLine(doc, lineN), merged;
        if (!lineIsHidden(doc, line)) { return lineN }
        while (merged = collapsedSpanAtEnd(line))
        { line = merged.find(1, true).line; }
        return lineNo(line) + 1
    }

    // Compute whether a line is hidden. Lines count as hidden when they
    // are part of a visual line that starts with another line, or when
    // they are entirely covered by collapsed, non-widget span.
    function lineIsHidden(doc, line) {
        var sps = sawCollapsedSpans && line.markedSpans;
        if (sps) { for (var sp = (void 0), i = 0; i < sps.length; ++i) {
            sp = sps[i];
            if (!sp.marker.collapsed) { continue }
            if (sp.from == null) { return true }
            if (sp.marker.widgetNode) { continue }
            if (sp.from == 0 && sp.marker.inclusiveLeft && lineIsHiddenInner(doc, line, sp))
            { return true }
        } }
    }
    function lineIsHiddenInner(doc, line, span) {
        if (span.to == null) {
            var end = span.marker.find(1, true);
            return lineIsHiddenInner(doc, end.line, getMarkedSpanFor(end.line.markedSpans, span.marker))
        }
        if (span.marker.inclusiveRight && span.to == line.text.length)
        { return true }
        for (var sp = (void 0), i = 0; i < line.markedSpans.length; ++i) {
            sp = line.markedSpans[i];
            if (sp.marker.collapsed && !sp.marker.widgetNode && sp.from == span.to &&
                (sp.to == null || sp.to != span.from) &&
                (sp.marker.inclusiveLeft || span.marker.inclusiveRight) &&
                lineIsHiddenInner(doc, line, sp)) { return true }
        }
    }

    // Find the height above the given line.
    function heightAtLine(lineObj) {
        lineObj = visualLine(lineObj);

        var h = 0, chunk = lineObj.parent;
        for (var i = 0; i < chunk.lines.length; ++i) {
            var line = chunk.lines[i];
            if (line == lineObj) { break }
            else { h += line.height; }
        }
        for (var p = chunk.parent; p; chunk = p, p = chunk.parent) {
            for (var i$1 = 0; i$1 < p.children.length; ++i$1) {
                var cur = p.children[i$1];
                if (cur == chunk) { break }
                else { h += cur.height; }
            }
        }
        return h
    }

    // Compute the character length of a line, taking into account
    // collapsed ranges (see markText) that might hide parts, and join
    // other lines onto it.
    function lineLength(line) {
        if (line.height == 0) { return 0 }
        var len = line.text.length, merged, cur = line;
        while (merged = collapsedSpanAtStart(cur)) {
            var found = merged.find(0, true);
            cur = found.from.line;
            len += found.from.ch - found.to.ch;
        }
        cur = line;
        while (merged = collapsedSpanAtEnd(cur)) {
            var found$1 = merged.find(0, true);
            len -= cur.text.length - found$1.from.ch;
            cur = found$1.to.line;
            len += cur.text.length - found$1.to.ch;
        }
        return len
    }

    // Find the longest line in the document.
    function findMaxLine(cm) {
        var d = cm.display, doc = cm.doc;
        d.maxLine = getLine(doc, doc.first);
        d.maxLineLength = lineLength(d.maxLine);
        d.maxLineChanged = true;
        doc.iter(function (line) {
            var len = lineLength(line);
            if (len > d.maxLineLength) {
                d.maxLineLength = len;
                d.maxLine = line;
            }
        });
    }

    // LINE DATA STRUCTURE

    // Line objects. These hold state related to a line, including
    // highlighting info (the styles array).
    var Line = function(text, markedSpans, estimateHeight) {
        this.text = text;
        attachMarkedSpans(this, markedSpans);
        this.height = estimateHeight ? estimateHeight(this) : 1;
    };

    Line.prototype.lineNo = function () { return lineNo(this) };
    eventMixin(Line);

    // Change the content (text, markers) of a line. Automatically
    // invalidates cached information and tries to re-estimate the
    // line's height.
    function updateLine(line, text, markedSpans, estimateHeight) {
        line.text = text;
        if (line.stateAfter) { line.stateAfter = null; }
        if (line.styles) { line.styles = null; }
        if (line.order != null) { line.order = null; }
        detachMarkedSpans(line);
        attachMarkedSpans(line, markedSpans);
        var estHeight = estimateHeight ? estimateHeight(line) : 1;
        if (estHeight != line.height) { updateLineHeight(line, estHeight); }
    }

    // Detach a line from the document tree and its markers.
    function cleanUpLine(line) {
        line.parent = null;
        detachMarkedSpans(line);
    }

    // Convert a style as returned by a mode (either null, or a string
    // containing one or more styles) to a CSS style. This is cached,
    // and also looks for line-wide styles.
    var styleToClassCache = {}, styleToClassCacheWithMode = {};
    function interpretTokenStyle(style, options) {
        if (!style || /^\s*$/.test(style)) { return null }
        var cache = options.addModeClass ? styleToClassCacheWithMode : styleToClassCache;
        return cache[style] ||
            (cache[style] = style.replace(/\S+/g, "cm-$&"))
    }

    // Render the DOM representation of the text of a line. Also builds
    // up a 'line map', which points at the DOM nodes that represent
    // specific stretches of text, and is used by the measuring code.
    // The returned object contains the DOM node, this map, and
    // information about line-wide styles that were set by the mode.
    function buildLineContent(cm, lineView) {
        // The padding-right forces the element to have a 'border', which
        // is needed on Webkit to be able to get line-level bounding
        // rectangles for it (in measureChar).
        var content = eltP("span", null, null, webkit ? "padding-right: .1px" : null);
        var builder = {pre: eltP("pre", [content], "CodeMirror-line"), content: content,
            col: 0, pos: 0, cm: cm,
            trailingSpace: false,
            splitSpaces: cm.getOption("lineWrapping")};
        lineView.measure = {};

        // Iterate over the logical lines that make up this visual line.
        for (var i = 0; i <= (lineView.rest ? lineView.rest.length : 0); i++) {
            var line = i ? lineView.rest[i - 1] : lineView.line, order = (void 0);
            builder.pos = 0;
            builder.addToken = buildToken;
            // Optionally wire in some hacks into the token-rendering
            // algorithm, to deal with browser quirks.
            if (hasBadBidiRects(cm.display.measure) && (order = getOrder(line, cm.doc.direction)))
            { builder.addToken = buildTokenBadBidi(builder.addToken, order); }
            builder.map = [];
            var allowFrontierUpdate = lineView != cm.display.externalMeasured && lineNo(line);
            insertLineContent(line, builder, getLineStyles(cm, line, allowFrontierUpdate));
            if (line.styleClasses) {
                if (line.styleClasses.bgClass)
                { builder.bgClass = joinClasses(line.styleClasses.bgClass, builder.bgClass || ""); }
                if (line.styleClasses.textClass)
                { builder.textClass = joinClasses(line.styleClasses.textClass, builder.textClass || ""); }
            }

            // Ensure at least a single node is present, for measuring.
            if (builder.map.length == 0)
            { builder.map.push(0, 0, builder.content.appendChild(zeroWidthElement(cm.display.measure))); }

            // Store the map and a cache object for the current logical line
            if (i == 0) {
                lineView.measure.map = builder.map;
                lineView.measure.cache = {};
            } else {
                (lineView.measure.maps || (lineView.measure.maps = [])).push(builder.map)
                ;(lineView.measure.caches || (lineView.measure.caches = [])).push({});
            }
        }

        // See issue #2901
        if (webkit) {
            var last = builder.content.lastChild;
            if (/\bcm-tab\b/.test(last.className) || (last.querySelector && last.querySelector(".cm-tab")))
            { builder.content.className = "cm-tab-wrap-hack"; }
        }

        signal(cm, "renderLine", cm, lineView.line, builder.pre);
        if (builder.pre.className)
        { builder.textClass = joinClasses(builder.pre.className, builder.textClass || ""); }

        return builder
    }

    function defaultSpecialCharPlaceholder(ch) {
        var token = elt("span", "\u2022", "cm-invalidchar");
        token.title = "\\u" + ch.charCodeAt(0).toString(16);
        token.setAttribute("aria-label", token.title);
        return token
    }

    // Build up the DOM representation for a single token, and add it to
    // the line map. Takes care to render special characters separately.
    function buildToken(builder, text, style, startStyle, endStyle, css, attributes) {
        if (!text) { return }
        var displayText = builder.splitSpaces ? splitSpaces(text, builder.trailingSpace) : text;
        var special = builder.cm.state.specialChars, mustWrap = false;
        var content;
        if (!special.test(text)) {
            builder.col += text.length;
            content = document.createTextNode(displayText);
            builder.map.push(builder.pos, builder.pos + text.length, content);
            if (ie && ie_version < 9) { mustWrap = true; }
            builder.pos += text.length;
        } else {
            content = document.createDocumentFragment();
            var pos = 0;
            while (true) {
                special.lastIndex = pos;
                var m = special.exec(text);
                var skipped = m ? m.index - pos : text.length - pos;
                if (skipped) {
                    var txt = document.createTextNode(displayText.slice(pos, pos + skipped));
                    if (ie && ie_version < 9) { content.appendChild(elt("span", [txt])); }
                    else { content.appendChild(txt); }
                    builder.map.push(builder.pos, builder.pos + skipped, txt);
                    builder.col += skipped;
                    builder.pos += skipped;
                }
                if (!m) { break }
                pos += skipped + 1;
                var txt$1 = (void 0);
                if (m[0] == "\t") {
                    var tabSize = builder.cm.options.tabSize, tabWidth = tabSize - builder.col % tabSize;
                    txt$1 = content.appendChild(elt("span", spaceStr(tabWidth), "cm-tab"));
                    txt$1.setAttribute("role", "presentation");
                    txt$1.setAttribute("cm-text", "\t");
                    builder.col += tabWidth;
                } else if (m[0] == "\r" || m[0] == "\n") {
                    txt$1 = content.appendChild(elt("span", m[0] == "\r" ? "\u240d" : "\u2424", "cm-invalidchar"));
                    txt$1.setAttribute("cm-text", m[0]);
                    builder.col += 1;
                } else {
                    txt$1 = builder.cm.options.specialCharPlaceholder(m[0]);
                    txt$1.setAttribute("cm-text", m[0]);
                    if (ie && ie_version < 9) { content.appendChild(elt("span", [txt$1])); }
                    else { content.appendChild(txt$1); }
                    builder.col += 1;
                }
                builder.map.push(builder.pos, builder.pos + 1, txt$1);
                builder.pos++;
            }
        }
        builder.trailingSpace = displayText.charCodeAt(text.length - 1) == 32;
        if (style || startStyle || endStyle || mustWrap || css || attributes) {
            var fullStyle = style || "";
            if (startStyle) { fullStyle += startStyle; }
            if (endStyle) { fullStyle += endStyle; }
            var token = elt("span", [content], fullStyle, css);
            if (attributes) {
                for (var attr in attributes) { if (attributes.hasOwnProperty(attr) && attr != "style" && attr != "class")
                { token.setAttribute(attr, attributes[attr]); } }
            }
            return builder.content.appendChild(token)
        }
        builder.content.appendChild(content);
    }

    // Change some spaces to NBSP to prevent the browser from collapsing
    // trailing spaces at the end of a line when rendering text (issue #1362).
    function splitSpaces(text, trailingBefore) {
        if (text.length > 1 && !/  /.test(text)) { return text }
        var spaceBefore = trailingBefore, result = "";
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            if (ch == " " && spaceBefore && (i == text.length - 1 || text.charCodeAt(i + 1) == 32))
            { ch = "\u00a0"; }
            result += ch;
            spaceBefore = ch == " ";
        }
        return result
    }

    // Work around nonsense dimensions being reported for stretches of
    // right-to-left text.
    function buildTokenBadBidi(inner, order) {
        return function (builder, text, style, startStyle, endStyle, css, attributes) {
            style = style ? style + " cm-force-border" : "cm-force-border";
            var start = builder.pos, end = start + text.length;
            for (;;) {
                // Find the part that overlaps with the start of this text
                var part = (void 0);
                for (var i = 0; i < order.length; i++) {
                    part = order[i];
                    if (part.to > start && part.from <= start) { break }
                }
                if (part.to >= end) { return inner(builder, text, style, startStyle, endStyle, css, attributes) }
                inner(builder, text.slice(0, part.to - start), style, startStyle, null, css, attributes);
                startStyle = null;
                text = text.slice(part.to - start);
                start = part.to;
            }
        }
    }

    function buildCollapsedSpan(builder, size, marker, ignoreWidget) {
        var widget = !ignoreWidget && marker.widgetNode;
        if (widget) { builder.map.push(builder.pos, builder.pos + size, widget); }
        if (!ignoreWidget && builder.cm.display.input.needsContentAttribute) {
            if (!widget)
            { widget = builder.content.appendChild(document.createElement("span")); }
            widget.setAttribute("cm-marker", marker.id);
        }
        if (widget) {
            builder.cm.display.input.setUneditable(widget);
            builder.content.appendChild(widget);
        }
        builder.pos += size;
        builder.trailingSpace = false;
    }

    // Outputs a number of spans to make up a line, taking highlighting
    // and marked text into account.
    function insertLineContent(line, builder, styles) {
        var spans = line.markedSpans, allText = line.text, at = 0;
        if (!spans) {
            for (var i$1 = 1; i$1 < styles.length; i$1+=2)
            { builder.addToken(builder, allText.slice(at, at = styles[i$1]), interpretTokenStyle(styles[i$1+1], builder.cm.options)); }
            return
        }

        var len = allText.length, pos = 0, i = 1, text = "", style, css;
        var nextChange = 0, spanStyle, spanEndStyle, spanStartStyle, collapsed, attributes;
        for (;;) {
            if (nextChange == pos) { // Update current marker set
                spanStyle = spanEndStyle = spanStartStyle = css = "";
                attributes = null;
                collapsed = null; nextChange = Infinity;
                var foundBookmarks = [], endStyles = (void 0);
                for (var j = 0; j < spans.length; ++j) {
                    var sp = spans[j], m = sp.marker;
                    if (m.type == "bookmark" && sp.from == pos && m.widgetNode) {
                        foundBookmarks.push(m);
                    } else if (sp.from <= pos && (sp.to == null || sp.to > pos || m.collapsed && sp.to == pos && sp.from == pos)) {
                        if (sp.to != null && sp.to != pos && nextChange > sp.to) {
                            nextChange = sp.to;
                            spanEndStyle = "";
                        }
                        if (m.className) { spanStyle += " " + m.className; }
                        if (m.css) { css = (css ? css + ";" : "") + m.css; }
                        if (m.startStyle && sp.from == pos) { spanStartStyle += " " + m.startStyle; }
                        if (m.endStyle && sp.to == nextChange) { (endStyles || (endStyles = [])).push(m.endStyle, sp.to); }
                        // support for the old title property
                        // https://github.com/codemirror/CodeMirror/pull/5673
                        if (m.title) { (attributes || (attributes = {})).title = m.title; }
                        if (m.attributes) {
                            for (var attr in m.attributes)
                            { (attributes || (attributes = {}))[attr] = m.attributes[attr]; }
                        }
                        if (m.collapsed && (!collapsed || compareCollapsedMarkers(collapsed.marker, m) < 0))
                        { collapsed = sp; }
                    } else if (sp.from > pos && nextChange > sp.from) {
                        nextChange = sp.from;
                    }
                }
                if (endStyles) { for (var j$1 = 0; j$1 < endStyles.length; j$1 += 2)
                { if (endStyles[j$1 + 1] == nextChange) { spanEndStyle += " " + endStyles[j$1]; } } }

                if (!collapsed || collapsed.from == pos) { for (var j$2 = 0; j$2 < foundBookmarks.length; ++j$2)
                { buildCollapsedSpan(builder, 0, foundBookmarks[j$2]); } }
                if (collapsed && (collapsed.from || 0) == pos) {
                    buildCollapsedSpan(builder, (collapsed.to == null ? len + 1 : collapsed.to) - pos,
                        collapsed.marker, collapsed.from == null);
                    if (collapsed.to == null) { return }
                    if (collapsed.to == pos) { collapsed = false; }
                }
            }
            if (pos >= len) { break }

            var upto = Math.min(len, nextChange);
            while (true) {
                if (text) {
                    var end = pos + text.length;
                    if (!collapsed) {
                        var tokenText = end > upto ? text.slice(0, upto - pos) : text;
                        builder.addToken(builder, tokenText, style ? style + spanStyle : spanStyle,
                            spanStartStyle, pos + tokenText.length == nextChange ? spanEndStyle : "", css, attributes);
                    }
                    if (end >= upto) {text = text.slice(upto - pos); pos = upto; break}
                    pos = end;
                    spanStartStyle = "";
                }
                text = allText.slice(at, at = styles[i++]);
                style = interpretTokenStyle(styles[i++], builder.cm.options);
            }
        }
    }


    // These objects are used to represent the visible (currently drawn)
    // part of the document. A LineView may correspond to multiple
    // logical lines, if those are connected by collapsed ranges.
    function LineView(doc, line, lineN) {
        // The starting line
        this.line = line;
        // Continuing lines, if any
        this.rest = visualLineContinued(line);
        // Number of logical lines in this visual line
        this.size = this.rest ? lineNo(lst(this.rest)) - lineN + 1 : 1;
        this.node = this.text = null;
        this.hidden = lineIsHidden(doc, line);
    }

    // Create a range of LineView objects for the given lines.
    function buildViewArray(cm, from, to) {
        var array = [], nextPos;
        for (var pos = from; pos < to; pos = nextPos) {
            var view = new LineView(cm.doc, getLine(cm.doc, pos), pos);
            nextPos = pos + view.size;
            array.push(view);
        }
        return array
    }

    var operationGroup = null;

    function pushOperation(op) {
        if (operationGroup) {
            operationGroup.ops.push(op);
        } else {
            op.ownsGroup = operationGroup = {
                ops: [op],
                delayedCallbacks: []
            };
        }
    }

    function fireCallbacksForOps(group) {
        // Calls delayed callbacks and cursorActivity handlers until no
        // new ones appear
        var callbacks = group.delayedCallbacks, i = 0;
        do {
            for (; i < callbacks.length; i++)
            { callbacks[i].call(null); }
            for (var j = 0; j < group.ops.length; j++) {
                var op = group.ops[j];
                if (op.cursorActivityHandlers)
                { while (op.cursorActivityCalled < op.cursorActivityHandlers.length)
                { op.cursorActivityHandlers[op.cursorActivityCalled++].call(null, op.cm); } }
            }
        } while (i < callbacks.length)
    }

    function finishOperation(op, endCb) {
        var group = op.ownsGroup;
        if (!group) { return }

        try { fireCallbacksForOps(group); }
        finally {
            operationGroup = null;
            endCb(group);
        }
    }

    var orphanDelayedCallbacks = null;

    // Often, we want to signal events at a point where we are in the
    // middle of some work, but don't want the handler to start calling
    // other methods on the editor, which might be in an inconsistent
    // state or simply not expect any other events to happen.
    // signalLater looks whether there are any handlers, and schedules
    // them to be executed when the last operation ends, or, if no
    // operation is active, when a timeout fires.
    function signalLater(emitter, type /*, values...*/) {
        var arr = getHandlers(emitter, type);
        if (!arr.length) { return }
        var args = Array.prototype.slice.call(arguments, 2), list;
        if (operationGroup) {
            list = operationGroup.delayedCallbacks;
        } else if (orphanDelayedCallbacks) {
            list = orphanDelayedCallbacks;
        } else {
            list = orphanDelayedCallbacks = [];
            setTimeout(fireOrphanDelayed, 0);
        }
        var loop = function ( i ) {
            list.push(function () { return arr[i].apply(null, args); });
        };

        for (var i = 0; i < arr.length; ++i)
            loop( i );
    }

    function fireOrphanDelayed() {
        var delayed = orphanDelayedCallbacks;
        orphanDelayedCallbacks = null;
        for (var i = 0; i < delayed.length; ++i) { delayed[i](); }
    }

    // When an aspect of a line changes, a string is added to
    // lineView.changes. This updates the relevant part of the line's
    // DOM structure.
    function updateLineForChanges(cm, lineView, lineN, dims) {
        for (var j = 0; j < lineView.changes.length; j++) {
            var type = lineView.changes[j];
            if (type == "text") { updateLineText(cm, lineView); }
            else if (type == "gutter") { updateLineGutter(cm, lineView, lineN, dims); }
            else if (type == "class") { updateLineClasses(cm, lineView); }
            else if (type == "widget") { updateLineWidgets(cm, lineView, dims); }
        }
        lineView.changes = null;
    }

    // Lines with gutter elements, widgets or a background class need to
    // be wrapped, and have the extra elements added to the wrapper div
    function ensureLineWrapped(lineView) {
        if (lineView.node == lineView.text) {
            lineView.node = elt("div", null, null, "position: relative");
            if (lineView.text.parentNode)
            { lineView.text.parentNode.replaceChild(lineView.node, lineView.text); }
            lineView.node.appendChild(lineView.text);
            if (ie && ie_version < 8) { lineView.node.style.zIndex = 2; }
        }
        return lineView.node
    }

    function updateLineBackground(cm, lineView) {
        var cls = lineView.bgClass ? lineView.bgClass + " " + (lineView.line.bgClass || "") : lineView.line.bgClass;
        if (cls) { cls += " CodeMirror-linebackground"; }
        if (lineView.background) {
            if (cls) { lineView.background.className = cls; }
            else { lineView.background.parentNode.removeChild(lineView.background); lineView.background = null; }
        } else if (cls) {
            var wrap = ensureLineWrapped(lineView);
            lineView.background = wrap.insertBefore(elt("div", null, cls), wrap.firstChild);
            cm.display.input.setUneditable(lineView.background);
        }
    }

    // Wrapper around buildLineContent which will reuse the structure
    // in display.externalMeasured when possible.
    function getLineContent(cm, lineView) {
        var ext = cm.display.externalMeasured;
        if (ext && ext.line == lineView.line) {
            cm.display.externalMeasured = null;
            lineView.measure = ext.measure;
            return ext.built
        }
        return buildLineContent(cm, lineView)
    }

    // Redraw the line's text. Interacts with the background and text
    // classes because the mode may output tokens that influence these
    // classes.
    function updateLineText(cm, lineView) {
        var cls = lineView.text.className;
        var built = getLineContent(cm, lineView);
        if (lineView.text == lineView.node) { lineView.node = built.pre; }
        lineView.text.parentNode.replaceChild(built.pre, lineView.text);
        lineView.text = built.pre;
        if (built.bgClass != lineView.bgClass || built.textClass != lineView.textClass) {
            lineView.bgClass = built.bgClass;
            lineView.textClass = built.textClass;
            updateLineClasses(cm, lineView);
        } else if (cls) {
            lineView.text.className = cls;
        }
    }

    function updateLineClasses(cm, lineView) {
        updateLineBackground(cm, lineView);
        if (lineView.line.wrapClass)
        { ensureLineWrapped(lineView).className = lineView.line.wrapClass; }
        else if (lineView.node != lineView.text)
        { lineView.node.className = ""; }
        var textClass = lineView.textClass ? lineView.textClass + " " + (lineView.line.textClass || "") : lineView.line.textClass;
        lineView.text.className = textClass || "";
    }

    function updateLineGutter(cm, lineView, lineN, dims) {
        if (lineView.gutter) {
            lineView.node.removeChild(lineView.gutter);
            lineView.gutter = null;
        }
        if (lineView.gutterBackground) {
            lineView.node.removeChild(lineView.gutterBackground);
            lineView.gutterBackground = null;
        }
        if (lineView.line.gutterClass) {
            var wrap = ensureLineWrapped(lineView);
            lineView.gutterBackground = elt("div", null, "CodeMirror-gutter-background " + lineView.line.gutterClass,
                ("left: " + (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) + "px; width: " + (dims.gutterTotalWidth) + "px"));
            cm.display.input.setUneditable(lineView.gutterBackground);
            wrap.insertBefore(lineView.gutterBackground, lineView.text);
        }
        var markers = lineView.line.gutterMarkers;
        if (cm.options.lineNumbers || markers) {
            var wrap$1 = ensureLineWrapped(lineView);
            var gutterWrap = lineView.gutter = elt("div", null, "CodeMirror-gutter-wrapper", ("left: " + (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) + "px"));
            cm.display.input.setUneditable(gutterWrap);
            wrap$1.insertBefore(gutterWrap, lineView.text);
            if (lineView.line.gutterClass)
            { gutterWrap.className += " " + lineView.line.gutterClass; }
            if (cm.options.lineNumbers && (!markers || !markers["CodeMirror-linenumbers"]))
            { lineView.lineNumber = gutterWrap.appendChild(
                elt("div", lineNumberFor(cm.options, lineN),
                    "CodeMirror-linenumber CodeMirror-gutter-elt",
                    ("left: " + (dims.gutterLeft["CodeMirror-linenumbers"]) + "px; width: " + (cm.display.lineNumInnerWidth) + "px"))); }
            if (markers) { for (var k = 0; k < cm.display.gutterSpecs.length; ++k) {
                var id = cm.display.gutterSpecs[k].className, found = markers.hasOwnProperty(id) && markers[id];
                if (found)
                { gutterWrap.appendChild(elt("div", [found], "CodeMirror-gutter-elt",
                    ("left: " + (dims.gutterLeft[id]) + "px; width: " + (dims.gutterWidth[id]) + "px"))); }
            } }
        }
    }

    function updateLineWidgets(cm, lineView, dims) {
        if (lineView.alignable) { lineView.alignable = null; }
        var isWidget = classTest("CodeMirror-linewidget");
        for (var node = lineView.node.firstChild, next = (void 0); node; node = next) {
            next = node.nextSibling;
            if (isWidget.test(node.className)) { lineView.node.removeChild(node); }
        }
        insertLineWidgets(cm, lineView, dims);
    }

    // Build a line's DOM representation from scratch
    function buildLineElement(cm, lineView, lineN, dims) {
        var built = getLineContent(cm, lineView);
        lineView.text = lineView.node = built.pre;
        if (built.bgClass) { lineView.bgClass = built.bgClass; }
        if (built.textClass) { lineView.textClass = built.textClass; }

        updateLineClasses(cm, lineView);
        updateLineGutter(cm, lineView, lineN, dims);
        insertLineWidgets(cm, lineView, dims);
        return lineView.node
    }

    // A lineView may contain multiple logical lines (when merged by
    // collapsed spans). The widgets for all of them need to be drawn.
    function insertLineWidgets(cm, lineView, dims) {
        insertLineWidgetsFor(cm, lineView.line, lineView, dims, true);
        if (lineView.rest) { for (var i = 0; i < lineView.rest.length; i++)
        { insertLineWidgetsFor(cm, lineView.rest[i], lineView, dims, false); } }
    }

    function insertLineWidgetsFor(cm, line, lineView, dims, allowAbove) {
        if (!line.widgets) { return }
        var wrap = ensureLineWrapped(lineView);
        for (var i = 0, ws = line.widgets; i < ws.length; ++i) {
            var widget = ws[i], node = elt("div", [widget.node], "CodeMirror-linewidget" + (widget.className ? " " + widget.className : ""));
            if (!widget.handleMouseEvents) { node.setAttribute("cm-ignore-events", "true"); }
            positionLineWidget(widget, node, lineView, dims);
            cm.display.input.setUneditable(node);
            if (allowAbove && widget.above)
            { wrap.insertBefore(node, lineView.gutter || lineView.text); }
            else
            { wrap.appendChild(node); }
            signalLater(widget, "redraw");
        }
    }

    function positionLineWidget(widget, node, lineView, dims) {
        if (widget.noHScroll) {
            (lineView.alignable || (lineView.alignable = [])).push(node);
            var width = dims.wrapperWidth;
            node.style.left = dims.fixedPos + "px";
            if (!widget.coverGutter) {
                width -= dims.gutterTotalWidth;
                node.style.paddingLeft = dims.gutterTotalWidth + "px";
            }
            node.style.width = width + "px";
        }
        if (widget.coverGutter) {
            node.style.zIndex = 5;
            node.style.position = "relative";
            if (!widget.noHScroll) { node.style.marginLeft = -dims.gutterTotalWidth + "px"; }
        }
    }

    function widgetHeight(widget) {
        if (widget.height != null) { return widget.height }
        var cm = widget.doc.cm;
        if (!cm) { return 0 }
        if (!contains(document.body, widget.node)) {
            var parentStyle = "position: relative;";
            if (widget.coverGutter)
            { parentStyle += "margin-left: -" + cm.display.gutters.offsetWidth + "px;"; }
            if (widget.noHScroll)
            { parentStyle += "width: " + cm.display.wrapper.clientWidth + "px;"; }
            removeChildrenAndAdd(cm.display.measure, elt("div", [widget.node], null, parentStyle));
        }
        return widget.height = widget.node.parentNode.offsetHeight
    }

    // Return true when the given mouse event happened in a widget
    function eventInWidget(display, e) {
        for (var n = e_target(e); n != display.wrapper; n = n.parentNode) {
            if (!n || (n.nodeType == 1 && n.getAttribute("cm-ignore-events") == "true") ||
                (n.parentNode == display.sizer && n != display.mover))
            { return true }
        }
    }

    // POSITION MEASUREMENT

    function paddingTop(display) {return display.lineSpace.offsetTop}
    function paddingVert(display) {return display.mover.offsetHeight - display.lineSpace.offsetHeight}
    function paddingH(display) {
        if (display.cachedPaddingH) { return display.cachedPaddingH }
        var e = removeChildrenAndAdd(display.measure, elt("pre", "x", "CodeMirror-line-like"));
        var style = window.getComputedStyle ? window.getComputedStyle(e) : e.currentStyle;
        var data = {left: parseInt(style.paddingLeft), right: parseInt(style.paddingRight)};
        if (!isNaN(data.left) && !isNaN(data.right)) { display.cachedPaddingH = data; }
        return data
    }

    function scrollGap(cm) { return scrollerGap - cm.display.nativeBarWidth }
    function displayWidth(cm) {
        return cm.display.scroller.clientWidth - scrollGap(cm) - cm.display.barWidth
    }
    function displayHeight(cm) {
        return cm.display.scroller.clientHeight - scrollGap(cm) - cm.display.barHeight
    }

    // Ensure the lineView.wrapping.heights array is populated. This is
    // an array of bottom offsets for the lines that make up a drawn
    // line. When lineWrapping is on, there might be more than one
    // height.
    function ensureLineHeights(cm, lineView, rect) {
        var wrapping = cm.options.lineWrapping;
        var curWidth = wrapping && displayWidth(cm);
        if (!lineView.measure.heights || wrapping && lineView.measure.width != curWidth) {
            var heights = lineView.measure.heights = [];
            if (wrapping) {
                lineView.measure.width = curWidth;
                var rects = lineView.text.firstChild.getClientRects();
                for (var i = 0; i < rects.length - 1; i++) {
                    var cur = rects[i], next = rects[i + 1];
                    if (Math.abs(cur.bottom - next.bottom) > 2)
                    { heights.push((cur.bottom + next.top) / 2 - rect.top); }
                }
            }
            heights.push(rect.bottom - rect.top);
        }
    }

    // Find a line map (mapping character offsets to text nodes) and a
    // measurement cache for the given line number. (A line view might
    // contain multiple lines when collapsed ranges are present.)
    function mapFromLineView(lineView, line, lineN) {
        if (lineView.line == line)
        { return {map: lineView.measure.map, cache: lineView.measure.cache} }
        for (var i = 0; i < lineView.rest.length; i++)
        { if (lineView.rest[i] == line)
        { return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i]} } }
        for (var i$1 = 0; i$1 < lineView.rest.length; i$1++)
        { if (lineNo(lineView.rest[i$1]) > lineN)
        { return {map: lineView.measure.maps[i$1], cache: lineView.measure.caches[i$1], before: true} } }
    }

    // Render a line into the hidden node display.externalMeasured. Used
    // when measurement is needed for a line that's not in the viewport.
    function updateExternalMeasurement(cm, line) {
        line = visualLine(line);
        var lineN = lineNo(line);
        var view = cm.display.externalMeasured = new LineView(cm.doc, line, lineN);
        view.lineN = lineN;
        var built = view.built = buildLineContent(cm, view);
        view.text = built.pre;
        removeChildrenAndAdd(cm.display.lineMeasure, built.pre);
        return view
    }

    // Get a {top, bottom, left, right} box (in line-local coordinates)
    // for a given character.
    function measureChar(cm, line, ch, bias) {
        return measureCharPrepared(cm, prepareMeasureForLine(cm, line), ch, bias)
    }

    // Find a line view that corresponds to the given line number.
    function findViewForLine(cm, lineN) {
        if (lineN >= cm.display.viewFrom && lineN < cm.display.viewTo)
        { return cm.display.view[findViewIndex(cm, lineN)] }
        var ext = cm.display.externalMeasured;
        if (ext && lineN >= ext.lineN && lineN < ext.lineN + ext.size)
        { return ext }
    }

    // Measurement can be split in two steps, the set-up work that
    // applies to the whole line, and the measurement of the actual
    // character. Functions like coordsChar, that need to do a lot of
    // measurements in a row, can thus ensure that the set-up work is
    // only done once.
    function prepareMeasureForLine(cm, line) {
        var lineN = lineNo(line);
        var view = findViewForLine(cm, lineN);
        if (view && !view.text) {
            view = null;
        } else if (view && view.changes) {
            updateLineForChanges(cm, view, lineN, getDimensions(cm));
            cm.curOp.forceUpdate = true;
        }
        if (!view)
        { view = updateExternalMeasurement(cm, line); }

        var info = mapFromLineView(view, line, lineN);
        return {
            line: line, view: view, rect: null,
            map: info.map, cache: info.cache, before: info.before,
            hasHeights: false
        }
    }

    // Given a prepared measurement object, measures the position of an
    // actual character (or fetches it from the cache).
    function measureCharPrepared(cm, prepared, ch, bias, varHeight) {
        if (prepared.before) { ch = -1; }
        var key = ch + (bias || ""), found;
        if (prepared.cache.hasOwnProperty(key)) {
            found = prepared.cache[key];
        } else {
            if (!prepared.rect)
            { prepared.rect = prepared.view.text.getBoundingClientRect(); }
            if (!prepared.hasHeights) {
                ensureLineHeights(cm, prepared.view, prepared.rect);
                prepared.hasHeights = true;
            }
            found = measureCharInner(cm, prepared, ch, bias);
            if (!found.bogus) { prepared.cache[key] = found; }
        }
        return {left: found.left, right: found.right,
            top: varHeight ? found.rtop : found.top,
            bottom: varHeight ? found.rbottom : found.bottom}
    }

    var nullRect = {left: 0, right: 0, top: 0, bottom: 0};

    function nodeAndOffsetInLineMap(map, ch, bias) {
        var node, start, end, collapse, mStart, mEnd;
        // First, search the line map for the text node corresponding to,
        // or closest to, the target character.
        for (var i = 0; i < map.length; i += 3) {
            mStart = map[i];
            mEnd = map[i + 1];
            if (ch < mStart) {
                start = 0; end = 1;
                collapse = "left";
            } else if (ch < mEnd) {
                start = ch - mStart;
                end = start + 1;
            } else if (i == map.length - 3 || ch == mEnd && map[i + 3] > ch) {
                end = mEnd - mStart;
                start = end - 1;
                if (ch >= mEnd) { collapse = "right"; }
            }
            if (start != null) {
                node = map[i + 2];
                if (mStart == mEnd && bias == (node.insertLeft ? "left" : "right"))
                { collapse = bias; }
                if (bias == "left" && start == 0)
                { while (i && map[i - 2] == map[i - 3] && map[i - 1].insertLeft) {
                    node = map[(i -= 3) + 2];
                    collapse = "left";
                } }
                if (bias == "right" && start == mEnd - mStart)
                { while (i < map.length - 3 && map[i + 3] == map[i + 4] && !map[i + 5].insertLeft) {
                    node = map[(i += 3) + 2];
                    collapse = "right";
                } }
                break
            }
        }
        return {node: node, start: start, end: end, collapse: collapse, coverStart: mStart, coverEnd: mEnd}
    }

    function getUsefulRect(rects, bias) {
        var rect = nullRect;
        if (bias == "left") { for (var i = 0; i < rects.length; i++) {
            if ((rect = rects[i]).left != rect.right) { break }
        } } else { for (var i$1 = rects.length - 1; i$1 >= 0; i$1--) {
            if ((rect = rects[i$1]).left != rect.right) { break }
        } }
        return rect
    }

    function measureCharInner(cm, prepared, ch, bias) {
        var place = nodeAndOffsetInLineMap(prepared.map, ch, bias);
        var node = place.node, start = place.start, end = place.end, collapse = place.collapse;

        var rect;
        if (node.nodeType == 3) { // If it is a text node, use a range to retrieve the coordinates.
            for (var i$1 = 0; i$1 < 4; i$1++) { // Retry a maximum of 4 times when nonsense rectangles are returned
                while (start && isExtendingChar(prepared.line.text.charAt(place.coverStart + start))) { --start; }
                while (place.coverStart + end < place.coverEnd && isExtendingChar(prepared.line.text.charAt(place.coverStart + end))) { ++end; }
                if (ie && ie_version < 9 && start == 0 && end == place.coverEnd - place.coverStart)
                { rect = node.parentNode.getBoundingClientRect(); }
                else
                { rect = getUsefulRect(range(node, start, end).getClientRects(), bias); }
                if (rect.left || rect.right || start == 0) { break }
                end = start;
                start = start - 1;
                collapse = "right";
            }
            if (ie && ie_version < 11) { rect = maybeUpdateRectForZooming(cm.display.measure, rect); }
        } else { // If it is a widget, simply get the box for the whole widget.
            if (start > 0) { collapse = bias = "right"; }
            var rects;
            if (cm.options.lineWrapping && (rects = node.getClientRects()).length > 1)
            { rect = rects[bias == "right" ? rects.length - 1 : 0]; }
            else
            { rect = node.getBoundingClientRect(); }
        }
        if (ie && ie_version < 9 && !start && (!rect || !rect.left && !rect.right)) {
            var rSpan = node.parentNode.getClientRects()[0];
            if (rSpan)
            { rect = {left: rSpan.left, right: rSpan.left + charWidth(cm.display), top: rSpan.top, bottom: rSpan.bottom}; }
            else
            { rect = nullRect; }
        }

        var rtop = rect.top - prepared.rect.top, rbot = rect.bottom - prepared.rect.top;
        var mid = (rtop + rbot) / 2;
        var heights = prepared.view.measure.heights;
        var i = 0;
        for (; i < heights.length - 1; i++)
        { if (mid < heights[i]) { break } }
        var top = i ? heights[i - 1] : 0, bot = heights[i];
        var result = {left: (collapse == "right" ? rect.right : rect.left) - prepared.rect.left,
            right: (collapse == "left" ? rect.left : rect.right) - prepared.rect.left,
            top: top, bottom: bot};
        if (!rect.left && !rect.right) { result.bogus = true; }
        if (!cm.options.singleCursorHeightPerLine) { result.rtop = rtop; result.rbottom = rbot; }

        return result
    }

    // Work around problem with bounding client rects on ranges being
    // returned incorrectly when zoomed on IE10 and below.
    function maybeUpdateRectForZooming(measure, rect) {
        if (!window.screen || screen.logicalXDPI == null ||
            screen.logicalXDPI == screen.deviceXDPI || !hasBadZoomedRects(measure))
        { return rect }
        var scaleX = screen.logicalXDPI / screen.deviceXDPI;
        var scaleY = screen.logicalYDPI / screen.deviceYDPI;
        return {left: rect.left * scaleX, right: rect.right * scaleX,
            top: rect.top * scaleY, bottom: rect.bottom * scaleY}
    }

    function clearLineMeasurementCacheFor(lineView) {
        if (lineView.measure) {
            lineView.measure.cache = {};
            lineView.measure.heights = null;
            if (lineView.rest) { for (var i = 0; i < lineView.rest.length; i++)
            { lineView.measure.caches[i] = {}; } }
        }
    }

    function clearLineMeasurementCache(cm) {
        cm.display.externalMeasure = null;
        removeChildren(cm.display.lineMeasure);
        for (var i = 0; i < cm.display.view.length; i++)
        { clearLineMeasurementCacheFor(cm.display.view[i]); }
    }

    function clearCaches(cm) {
        clearLineMeasurementCache(cm);
        cm.display.cachedCharWidth = cm.display.cachedTextHeight = cm.display.cachedPaddingH = null;
        if (!cm.options.lineWrapping) { cm.display.maxLineChanged = true; }
        cm.display.lineNumChars = null;
    }

    function pageScrollX() {
        // Work around https://bugs.chromium.org/p/chromium/issues/detail?id=489206
        // which causes page_Offset and bounding client rects to use
        // different reference viewports and invalidate our calculations.
        if (chrome && android) { return -(document.body.getBoundingClientRect().left - parseInt(getComputedStyle(document.body).marginLeft)) }
        return window.pageXOffset || (document.documentElement || document.body).scrollLeft
    }
    function pageScrollY() {
        if (chrome && android) { return -(document.body.getBoundingClientRect().top - parseInt(getComputedStyle(document.body).marginTop)) }
        return window.pageYOffset || (document.documentElement || document.body).scrollTop
    }

    function widgetTopHeight(lineObj) {
        var height = 0;
        if (lineObj.widgets) { for (var i = 0; i < lineObj.widgets.length; ++i) { if (lineObj.widgets[i].above)
        { height += widgetHeight(lineObj.widgets[i]); } } }
        return height
    }

    // Converts a {top, bottom, left, right} box from line-local
    // coordinates into another coordinate system. Context may be one of
    // "line", "div" (display.lineDiv), "local"./null (editor), "window",
    // or "page".
    function intoCoordSystem(cm, lineObj, rect, context, includeWidgets) {
        if (!includeWidgets) {
            var height = widgetTopHeight(lineObj);
            rect.top += height; rect.bottom += height;
        }
        if (context == "line") { return rect }
        if (!context) { context = "local"; }
        var yOff = heightAtLine(lineObj);
        if (context == "local") { yOff += paddingTop(cm.display); }
        else { yOff -= cm.display.viewOffset; }
        if (context == "page" || context == "window") {
            var lOff = cm.display.lineSpace.getBoundingClientRect();
            yOff += lOff.top + (context == "window" ? 0 : pageScrollY());
            var xOff = lOff.left + (context == "window" ? 0 : pageScrollX());
            rect.left += xOff; rect.right += xOff;
        }
        rect.top += yOff; rect.bottom += yOff;
        return rect
    }

    // Coverts a box from "div" coords to another coordinate system.
    // Context may be "window", "page", "div", or "local"./null.
    function fromCoordSystem(cm, coords, context) {
        if (context == "div") { return coords }
        var left = coords.left, top = coords.top;
        // First move into "page" coordinate system
        if (context == "page") {
            left -= pageScrollX();
            top -= pageScrollY();
        } else if (context == "local" || !context) {
            var localBox = cm.display.sizer.getBoundingClientRect();
            left += localBox.left;
            top += localBox.top;
        }

        var lineSpaceBox = cm.display.lineSpace.getBoundingClientRect();
        return {left: left - lineSpaceBox.left, top: top - lineSpaceBox.top}
    }

    function charCoords(cm, pos, context, lineObj, bias) {
        if (!lineObj) { lineObj = getLine(cm.doc, pos.line); }
        return intoCoordSystem(cm, lineObj, measureChar(cm, lineObj, pos.ch, bias), context)
    }

    // Returns a box for a given cursor position, which may have an
    // 'other' property containing the position of the secondary cursor
    // on a bidi boundary.
    // A cursor Pos(line, char, "before") is on the same visual line as `char - 1`
    // and after `char - 1` in writing order of `char - 1`
    // A cursor Pos(line, char, "after") is on the same visual line as `char`
    // and before `char` in writing order of `char`
    // Examples (upper-case letters are RTL, lower-case are LTR):
    //     Pos(0, 1, ...)
    //     before   after
    // ab     a|b     a|b
    // aB     a|B     aB|
    // Ab     |Ab     A|b
    // AB     B|A     B|A
    // Every position after the last character on a line is considered to stick
    // to the last character on the line.
    function cursorCoords(cm, pos, context, lineObj, preparedMeasure, varHeight) {
        lineObj = lineObj || getLine(cm.doc, pos.line);
        if (!preparedMeasure) { preparedMeasure = prepareMeasureForLine(cm, lineObj); }
        function get(ch, right) {
            var m = measureCharPrepared(cm, preparedMeasure, ch, right ? "right" : "left", varHeight);
            if (right) { m.left = m.right; } else { m.right = m.left; }
            return intoCoordSystem(cm, lineObj, m, context)
        }
        var order = getOrder(lineObj, cm.doc.direction), ch = pos.ch, sticky = pos.sticky;
        if (ch >= lineObj.text.length) {
            ch = lineObj.text.length;
            sticky = "before";
        } else if (ch <= 0) {
            ch = 0;
            sticky = "after";
        }
        if (!order) { return get(sticky == "before" ? ch - 1 : ch, sticky == "before") }

        function getBidi(ch, partPos, invert) {
            var part = order[partPos], right = part.level == 1;
            return get(invert ? ch - 1 : ch, right != invert)
        }
        var partPos = getBidiPartAt(order, ch, sticky);
        var other = bidiOther;
        var val = getBidi(ch, partPos, sticky == "before");
        if (other != null) { val.other = getBidi(ch, other, sticky != "before"); }
        return val
    }

    // Used to cheaply estimate the coordinates for a position. Used for
    // intermediate scroll updates.
    function estimateCoords(cm, pos) {
        var left = 0;
        pos = clipPos(cm.doc, pos);
        if (!cm.options.lineWrapping) { left = charWidth(cm.display) * pos.ch; }
        var lineObj = getLine(cm.doc, pos.line);
        var top = heightAtLine(lineObj) + paddingTop(cm.display);
        return {left: left, right: left, top: top, bottom: top + lineObj.height}
    }

    // Positions returned by coordsChar contain some extra information.
    // xRel is the relative x position of the input coordinates compared
    // to the found position (so xRel > 0 means the coordinates are to
    // the right of the character position, for example). When outside
    // is true, that means the coordinates lie outside the line's
    // vertical range.
    function PosWithInfo(line, ch, sticky, outside, xRel) {
        var pos = Pos(line, ch, sticky);
        pos.xRel = xRel;
        if (outside) { pos.outside = outside; }
        return pos
    }

    // Compute the character position closest to the given coordinates.
    // Input must be lineSpace-local ("div" coordinate system).
    function coordsChar(cm, x, y) {
        var doc = cm.doc;
        y += cm.display.viewOffset;
        if (y < 0) { return PosWithInfo(doc.first, 0, null, -1, -1) }
        var lineN = lineAtHeight(doc, y), last = doc.first + doc.size - 1;
        if (lineN > last)
        { return PosWithInfo(doc.first + doc.size - 1, getLine(doc, last).text.length, null, 1, 1) }
        if (x < 0) { x = 0; }

        var lineObj = getLine(doc, lineN);
        for (;;) {
            var found = coordsCharInner(cm, lineObj, lineN, x, y);
            var collapsed = collapsedSpanAround(lineObj, found.ch + (found.xRel > 0 || found.outside > 0 ? 1 : 0));
            if (!collapsed) { return found }
            var rangeEnd = collapsed.find(1);
            if (rangeEnd.line == lineN) { return rangeEnd }
            lineObj = getLine(doc, lineN = rangeEnd.line);
        }
    }

    function wrappedLineExtent(cm, lineObj, preparedMeasure, y) {
        y -= widgetTopHeight(lineObj);
        var end = lineObj.text.length;
        var begin = findFirst(function (ch) { return measureCharPrepared(cm, preparedMeasure, ch - 1).bottom <= y; }, end, 0);
        end = findFirst(function (ch) { return measureCharPrepared(cm, preparedMeasure, ch).top > y; }, begin, end);
        return {begin: begin, end: end}
    }

    function wrappedLineExtentChar(cm, lineObj, preparedMeasure, target) {
        if (!preparedMeasure) { preparedMeasure = prepareMeasureForLine(cm, lineObj); }
        var targetTop = intoCoordSystem(cm, lineObj, measureCharPrepared(cm, preparedMeasure, target), "line").top;
        return wrappedLineExtent(cm, lineObj, preparedMeasure, targetTop)
    }

    // Returns true if the given side of a box is after the given
    // coordinates, in top-to-bottom, left-to-right order.
    function boxIsAfter(box, x, y, left) {
        return box.bottom <= y ? false : box.top > y ? true : (left ? box.left : box.right) > x
    }

    function coordsCharInner(cm, lineObj, lineNo, x, y) {
        // Move y into line-local coordinate space
        y -= heightAtLine(lineObj);
        var preparedMeasure = prepareMeasureForLine(cm, lineObj);
        // When directly calling `measureCharPrepared`, we have to adjust
        // for the widgets at this line.
        var widgetHeight = widgetTopHeight(lineObj);
        var begin = 0, end = lineObj.text.length, ltr = true;

        var order = getOrder(lineObj, cm.doc.direction);
        // If the line isn't plain left-to-right text, first figure out
        // which bidi section the coordinates fall into.
        if (order) {
            var part = (cm.options.lineWrapping ? coordsBidiPartWrapped : coordsBidiPart)
            (cm, lineObj, lineNo, preparedMeasure, order, x, y);
            ltr = part.level != 1;
            // The awkward -1 offsets are needed because findFirst (called
            // on these below) will treat its first bound as inclusive,
            // second as exclusive, but we want to actually address the
            // characters in the part's range
            begin = ltr ? part.from : part.to - 1;
            end = ltr ? part.to : part.from - 1;
        }

        // A binary search to find the first character whose bounding box
        // starts after the coordinates. If we run across any whose box wrap
        // the coordinates, store that.
        var chAround = null, boxAround = null;
        var ch = findFirst(function (ch) {
            var box = measureCharPrepared(cm, preparedMeasure, ch);
            box.top += widgetHeight; box.bottom += widgetHeight;
            if (!boxIsAfter(box, x, y, false)) { return false }
            if (box.top <= y && box.left <= x) {
                chAround = ch;
                boxAround = box;
            }
            return true
        }, begin, end);

        var baseX, sticky, outside = false;
        // If a box around the coordinates was found, use that
        if (boxAround) {
            // Distinguish coordinates nearer to the left or right side of the box
            var atLeft = x - boxAround.left < boxAround.right - x, atStart = atLeft == ltr;
            ch = chAround + (atStart ? 0 : 1);
            sticky = atStart ? "after" : "before";
            baseX = atLeft ? boxAround.left : boxAround.right;
        } else {
            // (Adjust for extended bound, if necessary.)
            if (!ltr && (ch == end || ch == begin)) { ch++; }
            // To determine which side to associate with, get the box to the
            // left of the character and compare it's vertical position to the
            // coordinates
            sticky = ch == 0 ? "after" : ch == lineObj.text.length ? "before" :
                (measureCharPrepared(cm, preparedMeasure, ch - (ltr ? 1 : 0)).bottom + widgetHeight <= y) == ltr ?
                    "after" : "before";
            // Now get accurate coordinates for this place, in order to get a
            // base X position
            var coords = cursorCoords(cm, Pos(lineNo, ch, sticky), "line", lineObj, preparedMeasure);
            baseX = coords.left;
            outside = y < coords.top ? -1 : y >= coords.bottom ? 1 : 0;
        }

        ch = skipExtendingChars(lineObj.text, ch, 1);
        return PosWithInfo(lineNo, ch, sticky, outside, x - baseX)
    }

    function coordsBidiPart(cm, lineObj, lineNo, preparedMeasure, order, x, y) {
        // Bidi parts are sorted left-to-right, and in a non-line-wrapping
        // situation, we can take this ordering to correspond to the visual
        // ordering. This finds the first part whose end is after the given
        // coordinates.
        var index = findFirst(function (i) {
            var part = order[i], ltr = part.level != 1;
            return boxIsAfter(cursorCoords(cm, Pos(lineNo, ltr ? part.to : part.from, ltr ? "before" : "after"),
                "line", lineObj, preparedMeasure), x, y, true)
        }, 0, order.length - 1);
        var part = order[index];
        // If this isn't the first part, the part's start is also after
        // the coordinates, and the coordinates aren't on the same line as
        // that start, move one part back.
        if (index > 0) {
            var ltr = part.level != 1;
            var start = cursorCoords(cm, Pos(lineNo, ltr ? part.from : part.to, ltr ? "after" : "before"),
                "line", lineObj, preparedMeasure);
            if (boxIsAfter(start, x, y, true) && start.top > y)
            { part = order[index - 1]; }
        }
        return part
    }

    function coordsBidiPartWrapped(cm, lineObj, _lineNo, preparedMeasure, order, x, y) {
        // In a wrapped line, rtl text on wrapping boundaries can do things
        // that don't correspond to the ordering in our `order` array at
        // all, so a binary search doesn't work, and we want to return a
        // part that only spans one line so that the binary search in
        // coordsCharInner is safe. As such, we first find the extent of the
        // wrapped line, and then do a flat search in which we discard any
        // spans that aren't on the line.
        var ref = wrappedLineExtent(cm, lineObj, preparedMeasure, y);
        var begin = ref.begin;
        var end = ref.end;
        if (/\s/.test(lineObj.text.charAt(end - 1))) { end--; }
        var part = null, closestDist = null;
        for (var i = 0; i < order.length; i++) {
            var p = order[i];
            if (p.from >= end || p.to <= begin) { continue }
            var ltr = p.level != 1;
            var endX = measureCharPrepared(cm, preparedMeasure, ltr ? Math.min(end, p.to) - 1 : Math.max(begin, p.from)).right;
            // Weigh against spans ending before this, so that they are only
            // picked if nothing ends after
            var dist = endX < x ? x - endX + 1e9 : endX - x;
            if (!part || closestDist > dist) {
                part = p;
                closestDist = dist;
            }
        }
        if (!part) { part = order[order.length - 1]; }
        // Clip the part to the wrapped line.
        if (part.from < begin) { part = {from: begin, to: part.to, level: part.level}; }
        if (part.to > end) { part = {from: part.from, to: end, level: part.level}; }
        return part
    }

    var measureText;
    // Compute the default text height.
    function textHeight(display) {
        if (display.cachedTextHeight != null) { return display.cachedTextHeight }
        if (measureText == null) {
            measureText = elt("pre", null, "CodeMirror-line-like");
            // Measure a bunch of lines, for browsers that compute
            // fractional heights.
            for (var i = 0; i < 49; ++i) {
                measureText.appendChild(document.createTextNode("x"));
                measureText.appendChild(elt("br"));
            }
            measureText.appendChild(document.createTextNode("x"));
        }
        removeChildrenAndAdd(display.measure, measureText);
        var height = measureText.offsetHeight / 50;
        if (height > 3) { display.cachedTextHeight = height; }
        removeChildren(display.measure);
        return height || 1
    }

    // Compute the default character width.
    function charWidth(display) {
        if (display.cachedCharWidth != null) { return display.cachedCharWidth }
        var anchor = elt("span", "xxxxxxxxxx");
        var pre = elt("pre", [anchor], "CodeMirror-line-like");
        removeChildrenAndAdd(display.measure, pre);
        var rect = anchor.getBoundingClientRect(), width = (rect.right - rect.left) / 10;
        if (width > 2) { display.cachedCharWidth = width; }
        return width || 10
    }

    // Do a bulk-read of the DOM positions and sizes needed to draw the
    // view, so that we don't interleave reading and writing to the DOM.
    function getDimensions(cm) {
        var d = cm.display, left = {}, width = {};
        var gutterLeft = d.gutters.clientLeft;
        for (var n = d.gutters.firstChild, i = 0; n; n = n.nextSibling, ++i) {
            var id = cm.display.gutterSpecs[i].className;
            left[id] = n.offsetLeft + n.clientLeft + gutterLeft;
            width[id] = n.clientWidth;
        }
        return {fixedPos: compensateForHScroll(d),
            gutterTotalWidth: d.gutters.offsetWidth,
            gutterLeft: left,
            gutterWidth: width,
            wrapperWidth: d.wrapper.clientWidth}
    }

    // Computes display.scroller.scrollLeft + display.gutters.offsetWidth,
    // but using getBoundingClientRect to get a sub-pixel-accurate
    // result.
    function compensateForHScroll(display) {
        return display.scroller.getBoundingClientRect().left - display.sizer.getBoundingClientRect().left
    }

    // Returns a function that estimates the height of a line, to use as
    // first approximation until the line becomes visible (and is thus
    // properly measurable).
    function estimateHeight(cm) {
        var th = textHeight(cm.display), wrapping = cm.options.lineWrapping;
        var perLine = wrapping && Math.max(5, cm.display.scroller.clientWidth / charWidth(cm.display) - 3);
        return function (line) {
            if (lineIsHidden(cm.doc, line)) { return 0 }

            var widgetsHeight = 0;
            if (line.widgets) { for (var i = 0; i < line.widgets.length; i++) {
                if (line.widgets[i].height) { widgetsHeight += line.widgets[i].height; }
            } }

            if (wrapping)
            { return widgetsHeight + (Math.ceil(line.text.length / perLine) || 1) * th }
            else
            { return widgetsHeight + th }
        }
    }

    function estimateLineHeights(cm) {
        var doc = cm.doc, est = estimateHeight(cm);
        doc.iter(function (line) {
            var estHeight = est(line);
            if (estHeight != line.height) { updateLineHeight(line, estHeight); }
        });
    }

    // Given a mouse event, find the corresponding position. If liberal
    // is false, it checks whether a gutter or scrollbar was clicked,
    // and returns null if it was. forRect is used by rectangular
    // selections, and tries to estimate a character position even for
    // coordinates beyond the right of the text.
    function posFromMouse(cm, e, liberal, forRect) {
        var display = cm.display;
        if (!liberal && e_target(e).getAttribute("cm-not-content") == "true") { return null }

        var x, y, space = display.lineSpace.getBoundingClientRect();
        // Fails unpredictably on IE[67] when mouse is dragged around quickly.
        try { x = e.clientX - space.left; y = e.clientY - space.top; }
        catch (e$1) { return null }
        var coords = coordsChar(cm, x, y), line;
        if (forRect && coords.xRel > 0 && (line = getLine(cm.doc, coords.line).text).length == coords.ch) {
            var colDiff = countColumn(line, line.length, cm.options.tabSize) - line.length;
            coords = Pos(coords.line, Math.max(0, Math.round((x - paddingH(cm.display).left) / charWidth(cm.display)) - colDiff));
        }
        return coords
    }

    // Find the view element corresponding to a given line. Return null
    // when the line isn't visible.
    function findViewIndex(cm, n) {
        if (n >= cm.display.viewTo) { return null }
        n -= cm.display.viewFrom;
        if (n < 0) { return null }
        var view = cm.display.view;
        for (var i = 0; i < view.length; i++) {
            n -= view[i].size;
            if (n < 0) { return i }
        }
    }

    // Updates the display.view data structure for a given change to the
    // document. From and to are in pre-change coordinates. Lendiff is
    // the amount of lines added or subtracted by the change. This is
    // used for changes that span multiple lines, or change the way
    // lines are divided into visual lines. regLineChange (below)
    // registers single-line changes.
    function regChange(cm, from, to, lendiff) {
        if (from == null) { from = cm.doc.first; }
        if (to == null) { to = cm.doc.first + cm.doc.size; }
        if (!lendiff) { lendiff = 0; }

        var display = cm.display;
        if (lendiff && to < display.viewTo &&
            (display.updateLineNumbers == null || display.updateLineNumbers > from))
        { display.updateLineNumbers = from; }

        cm.curOp.viewChanged = true;

        if (from >= display.viewTo) { // Change after
            if (sawCollapsedSpans && visualLineNo(cm.doc, from) < display.viewTo)
            { resetView(cm); }
        } else if (to <= display.viewFrom) { // Change before
            if (sawCollapsedSpans && visualLineEndNo(cm.doc, to + lendiff) > display.viewFrom) {
                resetView(cm);
            } else {
                display.viewFrom += lendiff;
                display.viewTo += lendiff;
            }
        } else if (from <= display.viewFrom && to >= display.viewTo) { // Full overlap
            resetView(cm);
        } else if (from <= display.viewFrom) { // Top overlap
            var cut = viewCuttingPoint(cm, to, to + lendiff, 1);
            if (cut) {
                display.view = display.view.slice(cut.index);
                display.viewFrom = cut.lineN;
                display.viewTo += lendiff;
            } else {
                resetView(cm);
            }
        } else if (to >= display.viewTo) { // Bottom overlap
            var cut$1 = viewCuttingPoint(cm, from, from, -1);
            if (cut$1) {
                display.view = display.view.slice(0, cut$1.index);
                display.viewTo = cut$1.lineN;
            } else {
                resetView(cm);
            }
        } else { // Gap in the middle
            var cutTop = viewCuttingPoint(cm, from, from, -1);
            var cutBot = viewCuttingPoint(cm, to, to + lendiff, 1);
            if (cutTop && cutBot) {
                display.view = display.view.slice(0, cutTop.index)
                    .concat(buildViewArray(cm, cutTop.lineN, cutBot.lineN))
                    .concat(display.view.slice(cutBot.index));
                display.viewTo += lendiff;
            } else {
                resetView(cm);
            }
        }

        var ext = display.externalMeasured;
        if (ext) {
            if (to < ext.lineN)
            { ext.lineN += lendiff; }
            else if (from < ext.lineN + ext.size)
            { display.externalMeasured = null; }
        }
    }

    // Register a change to a single line. Type must be one of "text",
    // "gutter", "class", "widget"
    function regLineChange(cm, line, type) {
        cm.curOp.viewChanged = true;
        var display = cm.display, ext = cm.display.externalMeasured;
        if (ext && line >= ext.lineN && line < ext.lineN + ext.size)
        { display.externalMeasured = null; }

        if (line < display.viewFrom || line >= display.viewTo) { return }
        var lineView = display.view[findViewIndex(cm, line)];
        if (lineView.node == null) { return }
        var arr = lineView.changes || (lineView.changes = []);
        if (indexOf(arr, type) == -1) { arr.push(type); }
    }

    // Clear the view.
    function resetView(cm) {
        cm.display.viewFrom = cm.display.viewTo = cm.doc.first;
        cm.display.view = [];
        cm.display.viewOffset = 0;
    }

    function viewCuttingPoint(cm, oldN, newN, dir) {
        var index = findViewIndex(cm, oldN), diff, view = cm.display.view;
        if (!sawCollapsedSpans || newN == cm.doc.first + cm.doc.size)
        { return {index: index, lineN: newN} }
        var n = cm.display.viewFrom;
        for (var i = 0; i < index; i++)
        { n += view[i].size; }
        if (n != oldN) {
            if (dir > 0) {
                if (index == view.length - 1) { return null }
                diff = (n + view[index].size) - oldN;
                index++;
            } else {
                diff = n - oldN;
            }
            oldN += diff; newN += diff;
        }
        while (visualLineNo(cm.doc, newN) != newN) {
            if (index == (dir < 0 ? 0 : view.length - 1)) { return null }
            newN += dir * view[index - (dir < 0 ? 1 : 0)].size;
            index += dir;
        }
        return {index: index, lineN: newN}
    }

    // Force the view to cover a given range, adding empty view element
    // or clipping off existing ones as needed.
    function adjustView(cm, from, to) {
        var display = cm.display, view = display.view;
        if (view.length == 0 || from >= display.viewTo || to <= display.viewFrom) {
            display.view = buildViewArray(cm, from, to);
            display.viewFrom = from;
        } else {
            if (display.viewFrom > from)
            { display.view = buildViewArray(cm, from, display.viewFrom).concat(display.view); }
            else if (display.viewFrom < from)
            { display.view = display.view.slice(findViewIndex(cm, from)); }
            display.viewFrom = from;
            if (display.viewTo < to)
            { display.view = display.view.concat(buildViewArray(cm, display.viewTo, to)); }
            else if (display.viewTo > to)
            { display.view = display.view.slice(0, findViewIndex(cm, to)); }
        }
        display.viewTo = to;
    }

    // Count the number of lines in the view whose DOM representation is
    // out of date (or nonexistent).
    function countDirtyView(cm) {
        var view = cm.display.view, dirty = 0;
        for (var i = 0; i < view.length; i++) {
            var lineView = view[i];
            if (!lineView.hidden && (!lineView.node || lineView.changes)) { ++dirty; }
        }
        return dirty
    }

    function updateSelection(cm) {
        cm.display.input.showSelection(cm.display.input.prepareSelection());
    }

    function prepareSelection(cm, primary) {
        if ( primary === void 0 ) primary = true;

        var doc = cm.doc, result = {};
        var curFragment = result.cursors = document.createDocumentFragment();
        var selFragment = result.selection = document.createDocumentFragment();

        for (var i = 0; i < doc.sel.ranges.length; i++) {
            if (!primary && i == doc.sel.primIndex) { continue }
            var range = doc.sel.ranges[i];
            if (range.from().line >= cm.display.viewTo || range.to().line < cm.display.viewFrom) { continue }
            var collapsed = range.empty();
            if (collapsed || cm.options.showCursorWhenSelecting)
            { drawSelectionCursor(cm, range.head, curFragment); }
            if (!collapsed)
            { drawSelectionRange(cm, range, selFragment); }
        }
        return result
    }

    // Draws a cursor for the given range
    function drawSelectionCursor(cm, head, output) {
        var pos = cursorCoords(cm, head, "div", null, null, !cm.options.singleCursorHeightPerLine);

        var cursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor"));
        cursor.style.left = pos.left + "px";
        cursor.style.top = pos.top + "px";
        cursor.style.height = Math.max(0, pos.bottom - pos.top) * cm.options.cursorHeight + "px";

        if (pos.other) {
            // Secondary cursor, shown when on a 'jump' in bi-directional text
            var otherCursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor CodeMirror-secondarycursor"));
            otherCursor.style.display = "";
            otherCursor.style.left = pos.other.left + "px";
            otherCursor.style.top = pos.other.top + "px";
            otherCursor.style.height = (pos.other.bottom - pos.other.top) * .85 + "px";
        }
    }

    function cmpCoords(a, b) { return a.top - b.top || a.left - b.left }

    // Draws the given range as a highlighted selection
    function drawSelectionRange(cm, range, output) {
        var display = cm.display, doc = cm.doc;
        var fragment = document.createDocumentFragment();
        var padding = paddingH(cm.display), leftSide = padding.left;
        var rightSide = Math.max(display.sizerWidth, displayWidth(cm) - display.sizer.offsetLeft) - padding.right;
        var docLTR = doc.direction == "ltr";

        function add(left, top, width, bottom) {
            if (top < 0) { top = 0; }
            top = Math.round(top);
            bottom = Math.round(bottom);
            fragment.appendChild(elt("div", null, "CodeMirror-selected", ("position: absolute; left: " + left + "px;\n                             top: " + top + "px; width: " + (width == null ? rightSide - left : width) + "px;\n                             height: " + (bottom - top) + "px")));
        }

        function drawForLine(line, fromArg, toArg) {
            var lineObj = getLine(doc, line);
            var lineLen = lineObj.text.length;
            var start, end;
            function coords(ch, bias) {
                return charCoords(cm, Pos(line, ch), "div", lineObj, bias)
            }

            function wrapX(pos, dir, side) {
                var extent = wrappedLineExtentChar(cm, lineObj, null, pos);
                var prop = (dir == "ltr") == (side == "after") ? "left" : "right";
                var ch = side == "after" ? extent.begin : extent.end - (/\s/.test(lineObj.text.charAt(extent.end - 1)) ? 2 : 1);
                return coords(ch, prop)[prop]
            }

            var order = getOrder(lineObj, doc.direction);
            iterateBidiSections(order, fromArg || 0, toArg == null ? lineLen : toArg, function (from, to, dir, i) {
                var ltr = dir == "ltr";
                var fromPos = coords(from, ltr ? "left" : "right");
                var toPos = coords(to - 1, ltr ? "right" : "left");

                var openStart = fromArg == null && from == 0, openEnd = toArg == null && to == lineLen;
                var first = i == 0, last = !order || i == order.length - 1;
                if (toPos.top - fromPos.top <= 3) { // Single line
                    var openLeft = (docLTR ? openStart : openEnd) && first;
                    var openRight = (docLTR ? openEnd : openStart) && last;
                    var left = openLeft ? leftSide : (ltr ? fromPos : toPos).left;
                    var right = openRight ? rightSide : (ltr ? toPos : fromPos).right;
                    add(left, fromPos.top, right - left, fromPos.bottom);
                } else { // Multiple lines
                    var topLeft, topRight, botLeft, botRight;
                    if (ltr) {
                        topLeft = docLTR && openStart && first ? leftSide : fromPos.left;
                        topRight = docLTR ? rightSide : wrapX(from, dir, "before");
                        botLeft = docLTR ? leftSide : wrapX(to, dir, "after");
                        botRight = docLTR && openEnd && last ? rightSide : toPos.right;
                    } else {
                        topLeft = !docLTR ? leftSide : wrapX(from, dir, "before");
                        topRight = !docLTR && openStart && first ? rightSide : fromPos.right;
                        botLeft = !docLTR && openEnd && last ? leftSide : toPos.left;
                        botRight = !docLTR ? rightSide : wrapX(to, dir, "after");
                    }
                    add(topLeft, fromPos.top, topRight - topLeft, fromPos.bottom);
                    if (fromPos.bottom < toPos.top) { add(leftSide, fromPos.bottom, null, toPos.top); }
                    add(botLeft, toPos.top, botRight - botLeft, toPos.bottom);
                }

                if (!start || cmpCoords(fromPos, start) < 0) { start = fromPos; }
                if (cmpCoords(toPos, start) < 0) { start = toPos; }
                if (!end || cmpCoords(fromPos, end) < 0) { end = fromPos; }
                if (cmpCoords(toPos, end) < 0) { end = toPos; }
            });
            return {start: start, end: end}
        }

        var sFrom = range.from(), sTo = range.to();
        if (sFrom.line == sTo.line) {
            drawForLine(sFrom.line, sFrom.ch, sTo.ch);
        } else {
            var fromLine = getLine(doc, sFrom.line), toLine = getLine(doc, sTo.line);
            var singleVLine = visualLine(fromLine) == visualLine(toLine);
            var leftEnd = drawForLine(sFrom.line, sFrom.ch, singleVLine ? fromLine.text.length + 1 : null).end;
            var rightStart = drawForLine(sTo.line, singleVLine ? 0 : null, sTo.ch).start;
            if (singleVLine) {
                if (leftEnd.top < rightStart.top - 2) {
                    add(leftEnd.right, leftEnd.top, null, leftEnd.bottom);
                    add(leftSide, rightStart.top, rightStart.left, rightStart.bottom);
                } else {
                    add(leftEnd.right, leftEnd.top, rightStart.left - leftEnd.right, leftEnd.bottom);
                }
            }
            if (leftEnd.bottom < rightStart.top)
            { add(leftSide, leftEnd.bottom, null, rightStart.top); }
        }

        output.appendChild(fragment);
    }

    // Cursor-blinking
    function restartBlink(cm) {
        if (!cm.state.focused) { return }
        var display = cm.display;
        clearInterval(display.blinker);
        var on = true;
        display.cursorDiv.style.visibility = "";
        if (cm.options.cursorBlinkRate > 0)
        { display.blinker = setInterval(function () {
            if (!cm.hasFocus()) { onBlur(cm); }
            display.cursorDiv.style.visibility = (on = !on) ? "" : "hidden";
        }, cm.options.cursorBlinkRate); }
        else if (cm.options.cursorBlinkRate < 0)
        { display.cursorDiv.style.visibility = "hidden"; }
    }

    function ensureFocus(cm) {
        if (!cm.hasFocus()) {
            cm.display.input.focus();
            if (!cm.state.focused) { onFocus(cm); }
        }
    }

    function delayBlurEvent(cm) {
        cm.state.delayingBlurEvent = true;
        setTimeout(function () { if (cm.state.delayingBlurEvent) {
            cm.state.delayingBlurEvent = false;
            if (cm.state.focused) { onBlur(cm); }
        } }, 100);
    }

    function onFocus(cm, e) {
        if (cm.state.delayingBlurEvent && !cm.state.draggingText) { cm.state.delayingBlurEvent = false; }

        if (cm.options.readOnly == "nocursor") { return }
        if (!cm.state.focused) {
            signal(cm, "focus", cm, e);
            cm.state.focused = true;
            addClass(cm.display.wrapper, "CodeMirror-focused");
            // This test prevents this from firing when a context
            // menu is closed (since the input reset would kill the
            // select-all detection hack)
            if (!cm.curOp && cm.display.selForContextMenu != cm.doc.sel) {
                cm.display.input.reset();
                if (webkit) { setTimeout(function () { return cm.display.input.reset(true); }, 20); } // Issue #1730
            }
            cm.display.input.receivedFocus();
        }
        restartBlink(cm);
    }
    function onBlur(cm, e) {
        if (cm.state.delayingBlurEvent) { return }

        if (cm.state.focused) {
            signal(cm, "blur", cm, e);
            cm.state.focused = false;
            rmClass(cm.display.wrapper, "CodeMirror-focused");
        }
        clearInterval(cm.display.blinker);
        setTimeout(function () { if (!cm.state.focused) { cm.display.shift = false; } }, 150);
    }

    // Read the actual heights of the rendered lines, and update their
    // stored heights to match.
    function updateHeightsInViewport(cm) {
        var display = cm.display;
        var prevBottom = display.lineDiv.offsetTop;
        for (var i = 0; i < display.view.length; i++) {
            var cur = display.view[i], wrapping = cm.options.lineWrapping;
            var height = (void 0), width = 0;
            if (cur.hidden) { continue }
            if (ie && ie_version < 8) {
                var bot = cur.node.offsetTop + cur.node.offsetHeight;
                height = bot - prevBottom;
                prevBottom = bot;
            } else {
                var box = cur.node.getBoundingClientRect();
                height = box.bottom - box.top;
                // Check that lines don't extend past the right of the current
                // editor width
                if (!wrapping && cur.text.firstChild)
                { width = cur.text.firstChild.getBoundingClientRect().right - box.left - 1; }
            }
            var diff = cur.line.height - height;
            if (diff > .005 || diff < -.005) {
                updateLineHeight(cur.line, height);
                updateWidgetHeight(cur.line);
                if (cur.rest) { for (var j = 0; j < cur.rest.length; j++)
                { updateWidgetHeight(cur.rest[j]); } }
            }
            if (width > cm.display.sizerWidth) {
                var chWidth = Math.ceil(width / charWidth(cm.display));
                if (chWidth > cm.display.maxLineLength) {
                    cm.display.maxLineLength = chWidth;
                    cm.display.maxLine = cur.line;
                    cm.display.maxLineChanged = true;
                }
            }
        }
    }

    // Read and store the height of line widgets associated with the
    // given line.
    function updateWidgetHeight(line) {
        if (line.widgets) { for (var i = 0; i < line.widgets.length; ++i) {
            var w = line.widgets[i], parent = w.node.parentNode;
            if (parent) { w.height = parent.offsetHeight; }
        } }
    }

    // Compute the lines that are visible in a given viewport (defaults
    // the the current scroll position). viewport may contain top,
    // height, and ensure (see op.scrollToPos) properties.
    function visibleLines(display, doc, viewport) {
        var top = viewport && viewport.top != null ? Math.max(0, viewport.top) : display.scroller.scrollTop;
        top = Math.floor(top - paddingTop(display));
        var bottom = viewport && viewport.bottom != null ? viewport.bottom : top + display.wrapper.clientHeight;

        var from = lineAtHeight(doc, top), to = lineAtHeight(doc, bottom);
        // Ensure is a {from: {line, ch}, to: {line, ch}} object, and
        // forces those lines into the viewport (if possible).
        if (viewport && viewport.ensure) {
            var ensureFrom = viewport.ensure.from.line, ensureTo = viewport.ensure.to.line;
            if (ensureFrom < from) {
                from = ensureFrom;
                to = lineAtHeight(doc, heightAtLine(getLine(doc, ensureFrom)) + display.wrapper.clientHeight);
            } else if (Math.min(ensureTo, doc.lastLine()) >= to) {
                from = lineAtHeight(doc, heightAtLine(getLine(doc, ensureTo)) - display.wrapper.clientHeight);
                to = ensureTo;
            }
        }
        return {from: from, to: Math.max(to, from + 1)}
    }

    // SCROLLING THINGS INTO VIEW

    // If an editor sits on the top or bottom of the window, partially
    // scrolled out of view, this ensures that the cursor is visible.
    function maybeScrollWindow(cm, rect) {
        if (signalDOMEvent(cm, "scrollCursorIntoView")) { return }

        var display = cm.display, box = display.sizer.getBoundingClientRect(), doScroll = null;
        if (rect.top + box.top < 0) { doScroll = true; }
        else if (rect.bottom + box.top > (window.innerHeight || document.documentElement.clientHeight)) { doScroll = false; }
        if (doScroll != null && !phantom) {
            var scrollNode = elt("div", "\u200b", null, ("position: absolute;\n                         top: " + (rect.top - display.viewOffset - paddingTop(cm.display)) + "px;\n                         height: " + (rect.bottom - rect.top + scrollGap(cm) + display.barHeight) + "px;\n                         left: " + (rect.left) + "px; width: " + (Math.max(2, rect.right - rect.left)) + "px;"));
            cm.display.lineSpace.appendChild(scrollNode);
            scrollNode.scrollIntoView(doScroll);
            cm.display.lineSpace.removeChild(scrollNode);
        }
    }

    // Scroll a given position into view (immediately), verifying that
    // it actually became visible (as line heights are accurately
    // measured, the position of something may 'drift' during drawing).
    function scrollPosIntoView(cm, pos, end, margin) {
        if (margin == null) { margin = 0; }
        var rect;
        if (!cm.options.lineWrapping && pos == end) {
            // Set pos and end to the cursor positions around the character pos sticks to
            // If pos.sticky == "before", that is around pos.ch - 1, otherwise around pos.ch
            // If pos == Pos(_, 0, "before"), pos and end are unchanged
            pos = pos.ch ? Pos(pos.line, pos.sticky == "before" ? pos.ch - 1 : pos.ch, "after") : pos;
            end = pos.sticky == "before" ? Pos(pos.line, pos.ch + 1, "before") : pos;
        }
        for (var limit = 0; limit < 5; limit++) {
            var changed = false;
            var coords = cursorCoords(cm, pos);
            var endCoords = !end || end == pos ? coords : cursorCoords(cm, end);
            rect = {left: Math.min(coords.left, endCoords.left),
                top: Math.min(coords.top, endCoords.top) - margin,
                right: Math.max(coords.left, endCoords.left),
                bottom: Math.max(coords.bottom, endCoords.bottom) + margin};
            var scrollPos = calculateScrollPos(cm, rect);
            var startTop = cm.doc.scrollTop, startLeft = cm.doc.scrollLeft;
            if (scrollPos.scrollTop != null) {
                updateScrollTop(cm, scrollPos.scrollTop);
                if (Math.abs(cm.doc.scrollTop - startTop) > 1) { changed = true; }
            }
            if (scrollPos.scrollLeft != null) {
                setScrollLeft(cm, scrollPos.scrollLeft);
                if (Math.abs(cm.doc.scrollLeft - startLeft) > 1) { changed = true; }
            }
            if (!changed) { break }
        }
        return rect
    }

    // Scroll a given set of coordinates into view (immediately).
    function scrollIntoView(cm, rect) {
        var scrollPos = calculateScrollPos(cm, rect);
        if (scrollPos.scrollTop != null) { updateScrollTop(cm, scrollPos.scrollTop); }
        if (scrollPos.scrollLeft != null) { setScrollLeft(cm, scrollPos.scrollLeft); }
    }

    // Calculate a new scroll position needed to scroll the given
    // rectangle into view. Returns an object with scrollTop and
    // scrollLeft properties. When these are undefined, the
    // vertical/horizontal position does not need to be adjusted.
    function calculateScrollPos(cm, rect) {
        var display = cm.display, snapMargin = textHeight(cm.display);
        if (rect.top < 0) { rect.top = 0; }
        var screentop = cm.curOp && cm.curOp.scrollTop != null ? cm.curOp.scrollTop : display.scroller.scrollTop;
        var screen = displayHeight(cm), result = {};
        if (rect.bottom - rect.top > screen) { rect.bottom = rect.top + screen; }
        var docBottom = cm.doc.height + paddingVert(display);
        var atTop = rect.top < snapMargin, atBottom = rect.bottom > docBottom - snapMargin;
        if (rect.top < screentop) {
            result.scrollTop = atTop ? 0 : rect.top;
        } else if (rect.bottom > screentop + screen) {
            var newTop = Math.min(rect.top, (atBottom ? docBottom : rect.bottom) - screen);
            if (newTop != screentop) { result.scrollTop = newTop; }
        }

        var gutterSpace = cm.options.fixedGutter ? 0 : display.gutters.offsetWidth;
        var screenleft = cm.curOp && cm.curOp.scrollLeft != null ? cm.curOp.scrollLeft : display.scroller.scrollLeft - gutterSpace;
        var screenw = displayWidth(cm) - display.gutters.offsetWidth;
        var tooWide = rect.right - rect.left > screenw;
        if (tooWide) { rect.right = rect.left + screenw; }
        if (rect.left < 10)
        { result.scrollLeft = 0; }
        else if (rect.left < screenleft)
        { result.scrollLeft = Math.max(0, rect.left + gutterSpace - (tooWide ? 0 : 10)); }
        else if (rect.right > screenw + screenleft - 3)
        { result.scrollLeft = rect.right + (tooWide ? 0 : 10) - screenw; }
        return result
    }

    // Store a relative adjustment to the scroll position in the current
    // operation (to be applied when the operation finishes).
    function addToScrollTop(cm, top) {
        if (top == null) { return }
        resolveScrollToPos(cm);
        cm.curOp.scrollTop = (cm.curOp.scrollTop == null ? cm.doc.scrollTop : cm.curOp.scrollTop) + top;
    }

    // Make sure that at the end of the operation the current cursor is
    // shown.
    function ensureCursorVisible(cm) {
        resolveScrollToPos(cm);
        var cur = cm.getCursor();
        cm.curOp.scrollToPos = {from: cur, to: cur, margin: cm.options.cursorScrollMargin};
    }

    function scrollToCoords(cm, x, y) {
        if (x != null || y != null) { resolveScrollToPos(cm); }
        if (x != null) { cm.curOp.scrollLeft = x; }
        if (y != null) { cm.curOp.scrollTop = y; }
    }

    function scrollToRange(cm, range) {
        resolveScrollToPos(cm);
        cm.curOp.scrollToPos = range;
    }

    // When an operation has its scrollToPos property set, and another
    // scroll action is applied before the end of the operation, this
    // 'simulates' scrolling that position into view in a cheap way, so
    // that the effect of intermediate scroll commands is not ignored.
    function resolveScrollToPos(cm) {
        var range = cm.curOp.scrollToPos;
        if (range) {
            cm.curOp.scrollToPos = null;
            var from = estimateCoords(cm, range.from), to = estimateCoords(cm, range.to);
            scrollToCoordsRange(cm, from, to, range.margin);
        }
    }

    function scrollToCoordsRange(cm, from, to, margin) {
        var sPos = calculateScrollPos(cm, {
            left: Math.min(from.left, to.left),
            top: Math.min(from.top, to.top) - margin,
            right: Math.max(from.right, to.right),
            bottom: Math.max(from.bottom, to.bottom) + margin
        });
        scrollToCoords(cm, sPos.scrollLeft, sPos.scrollTop);
    }

    // Sync the scrollable area and scrollbars, ensure the viewport
    // covers the visible area.
    function updateScrollTop(cm, val) {
        if (Math.abs(cm.doc.scrollTop - val) < 2) { return }
        if (!gecko) { updateDisplaySimple(cm, {top: val}); }
        setScrollTop(cm, val, true);
        if (gecko) { updateDisplaySimple(cm); }
        startWorker(cm, 100);
    }

    function setScrollTop(cm, val, forceScroll) {
        val = Math.max(0, Math.min(cm.display.scroller.scrollHeight - cm.display.scroller.clientHeight, val));
        if (cm.display.scroller.scrollTop == val && !forceScroll) { return }
        cm.doc.scrollTop = val;
        cm.display.scrollbars.setScrollTop(val);
        if (cm.display.scroller.scrollTop != val) { cm.display.scroller.scrollTop = val; }
    }

    // Sync scroller and scrollbar, ensure the gutter elements are
    // aligned.
    function setScrollLeft(cm, val, isScroller, forceScroll) {
        val = Math.max(0, Math.min(val, cm.display.scroller.scrollWidth - cm.display.scroller.clientWidth));
        if ((isScroller ? val == cm.doc.scrollLeft : Math.abs(cm.doc.scrollLeft - val) < 2) && !forceScroll) { return }
        cm.doc.scrollLeft = val;
        alignHorizontally(cm);
        if (cm.display.scroller.scrollLeft != val) { cm.display.scroller.scrollLeft = val; }
        cm.display.scrollbars.setScrollLeft(val);
    }

    // SCROLLBARS

    // Prepare DOM reads needed to update the scrollbars. Done in one
    // shot to minimize update/measure roundtrips.
    function measureForScrollbars(cm) {
        var d = cm.display, gutterW = d.gutters.offsetWidth;
        var docH = Math.round(cm.doc.height + paddingVert(cm.display));
        return {
            clientHeight: d.scroller.clientHeight,
            viewHeight: d.wrapper.clientHeight,
            scrollWidth: d.scroller.scrollWidth, clientWidth: d.scroller.clientWidth,
            viewWidth: d.wrapper.clientWidth,
            barLeft: cm.options.fixedGutter ? gutterW : 0,
            docHeight: docH,
            scrollHeight: docH + scrollGap(cm) + d.barHeight,
            nativeBarWidth: d.nativeBarWidth,
            gutterWidth: gutterW
        }
    }

    var NativeScrollbars = function(place, scroll, cm) {
        this.cm = cm;
        var vert = this.vert = elt("div", [elt("div", null, null, "min-width: 1px")], "CodeMirror-vscrollbar");
        var horiz = this.horiz = elt("div", [elt("div", null, null, "height: 100%; min-height: 1px")], "CodeMirror-hscrollbar");
        vert.tabIndex = horiz.tabIndex = -1;
        place(vert); place(horiz);

        on(vert, "scroll", function () {
            if (vert.clientHeight) { scroll(vert.scrollTop, "vertical"); }
        });
        on(horiz, "scroll", function () {
            if (horiz.clientWidth) { scroll(horiz.scrollLeft, "horizontal"); }
        });

        this.checkedZeroWidth = false;
        // Need to set a minimum width to see the scrollbar on IE7 (but must not set it on IE8).
        if (ie && ie_version < 8) { this.horiz.style.minHeight = this.vert.style.minWidth = "18px"; }
    };

    NativeScrollbars.prototype.update = function (measure) {
        var needsH = measure.scrollWidth > measure.clientWidth + 1;
        var needsV = measure.scrollHeight > measure.clientHeight + 1;
        var sWidth = measure.nativeBarWidth;

        if (needsV) {
            this.vert.style.display = "block";
            this.vert.style.bottom = needsH ? sWidth + "px" : "0";
            var totalHeight = measure.viewHeight - (needsH ? sWidth : 0);
            // A bug in IE8 can cause this value to be negative, so guard it.
            this.vert.firstChild.style.height =
                Math.max(0, measure.scrollHeight - measure.clientHeight + totalHeight) + "px";
        } else {
            this.vert.style.display = "";
            this.vert.firstChild.style.height = "0";
        }

        if (needsH) {
            this.horiz.style.display = "block";
            this.horiz.style.right = needsV ? sWidth + "px" : "0";
            this.horiz.style.left = measure.barLeft + "px";
            var totalWidth = measure.viewWidth - measure.barLeft - (needsV ? sWidth : 0);
            this.horiz.firstChild.style.width =
                Math.max(0, measure.scrollWidth - measure.clientWidth + totalWidth) + "px";
        } else {
            this.horiz.style.display = "";
            this.horiz.firstChild.style.width = "0";
        }

        if (!this.checkedZeroWidth && measure.clientHeight > 0) {
            if (sWidth == 0) { this.zeroWidthHack(); }
            this.checkedZeroWidth = true;
        }

        return {right: needsV ? sWidth : 0, bottom: needsH ? sWidth : 0}
    };

    NativeScrollbars.prototype.setScrollLeft = function (pos) {
        if (this.horiz.scrollLeft != pos) { this.horiz.scrollLeft = pos; }
        if (this.disableHoriz) { this.enableZeroWidthBar(this.horiz, this.disableHoriz, "horiz"); }
    };

    NativeScrollbars.prototype.setScrollTop = function (pos) {
        if (this.vert.scrollTop != pos) { this.vert.scrollTop = pos; }
        if (this.disableVert) { this.enableZeroWidthBar(this.vert, this.disableVert, "vert"); }
    };

    NativeScrollbars.prototype.zeroWidthHack = function () {
        var w = mac && !mac_geMountainLion ? "12px" : "18px";
        this.horiz.style.height = this.vert.style.width = w;
        this.horiz.style.pointerEvents = this.vert.style.pointerEvents = "none";
        this.disableHoriz = new Delayed;
        this.disableVert = new Delayed;
    };

    NativeScrollbars.prototype.enableZeroWidthBar = function (bar, delay, type) {
        bar.style.pointerEvents = "auto";
        function maybeDisable() {
            // To find out whether the scrollbar is still visible, we
            // check whether the element under the pixel in the bottom
            // right corner of the scrollbar box is the scrollbar box
            // itself (when the bar is still visible) or its filler child
            // (when the bar is hidden). If it is still visible, we keep
            // it enabled, if it's hidden, we disable pointer events.
            var box = bar.getBoundingClientRect();
            var elt = type == "vert" ? document.elementFromPoint(box.right - 1, (box.top + box.bottom) / 2)
                : document.elementFromPoint((box.right + box.left) / 2, box.bottom - 1);
            if (elt != bar) { bar.style.pointerEvents = "none"; }
            else { delay.set(1000, maybeDisable); }
        }
        delay.set(1000, maybeDisable);
    };

    NativeScrollbars.prototype.clear = function () {
        var parent = this.horiz.parentNode;
        parent.removeChild(this.horiz);
        parent.removeChild(this.vert);
    };

    var NullScrollbars = function () {};

    NullScrollbars.prototype.update = function () { return {bottom: 0, right: 0} };
    NullScrollbars.prototype.setScrollLeft = function () {};
    NullScrollbars.prototype.setScrollTop = function () {};
    NullScrollbars.prototype.clear = function () {};

    function updateScrollbars(cm, measure) {
        if (!measure) { measure = measureForScrollbars(cm); }
        var startWidth = cm.display.barWidth, startHeight = cm.display.barHeight;
        updateScrollbarsInner(cm, measure);
        for (var i = 0; i < 4 && startWidth != cm.display.barWidth || startHeight != cm.display.barHeight; i++) {
            if (startWidth != cm.display.barWidth && cm.options.lineWrapping)
            { updateHeightsInViewport(cm); }
            updateScrollbarsInner(cm, measureForScrollbars(cm));
            startWidth = cm.display.barWidth; startHeight = cm.display.barHeight;
        }
    }

    // Re-synchronize the fake scrollbars with the actual size of the
    // content.
    function updateScrollbarsInner(cm, measure) {
        var d = cm.display;
        var sizes = d.scrollbars.update(measure);

        d.sizer.style.paddingRight = (d.barWidth = sizes.right) + "px";
        d.sizer.style.paddingBottom = (d.barHeight = sizes.bottom) + "px";
        d.heightForcer.style.borderBottom = sizes.bottom + "px solid transparent";

        if (sizes.right && sizes.bottom) {
            d.scrollbarFiller.style.display = "block";
            d.scrollbarFiller.style.height = sizes.bottom + "px";
            d.scrollbarFiller.style.width = sizes.right + "px";
        } else { d.scrollbarFiller.style.display = ""; }
        if (sizes.bottom && cm.options.coverGutterNextToScrollbar && cm.options.fixedGutter) {
            d.gutterFiller.style.display = "block";
            d.gutterFiller.style.height = sizes.bottom + "px";
            d.gutterFiller.style.width = measure.gutterWidth + "px";
        } else { d.gutterFiller.style.display = ""; }
    }

    var scrollbarModel = {"native": NativeScrollbars, "null": NullScrollbars};

    function initScrollbars(cm) {
        if (cm.display.scrollbars) {
            cm.display.scrollbars.clear();
            if (cm.display.scrollbars.addClass)
            { rmClass(cm.display.wrapper, cm.display.scrollbars.addClass); }
        }

        cm.display.scrollbars = new scrollbarModel[cm.options.scrollbarStyle](function (node) {
            cm.display.wrapper.insertBefore(node, cm.display.scrollbarFiller);
            // Prevent clicks in the scrollbars from killing focus
            on(node, "mousedown", function () {
                if (cm.state.focused) { setTimeout(function () { return cm.display.input.focus(); }, 0); }
            });
            node.setAttribute("cm-not-content", "true");
        }, function (pos, axis) {
            if (axis == "horizontal") { setScrollLeft(cm, pos); }
            else { updateScrollTop(cm, pos); }
        }, cm);
        if (cm.display.scrollbars.addClass)
        { addClass(cm.display.wrapper, cm.display.scrollbars.addClass); }
    }

    // Operations are used to wrap a series of changes to the editor
    // state in such a way that each change won't have to update the
    // cursor and display (which would be awkward, slow, and
    // error-prone). Instead, display updates are batched and then all
    // combined and executed at once.

    var nextOpId = 0;
    // Start a new operation.
    function startOperation(cm) {
        cm.curOp = {
            cm: cm,
            viewChanged: false,      // Flag that indicates that lines might need to be redrawn
            startHeight: cm.doc.height, // Used to detect need to update scrollbar
            forceUpdate: false,      // Used to force a redraw
            updateInput: 0,       // Whether to reset the input textarea
            typing: false,           // Whether this reset should be careful to leave existing text (for compositing)
            changeObjs: null,        // Accumulated changes, for firing change events
            cursorActivityHandlers: null, // Set of handlers to fire cursorActivity on
            cursorActivityCalled: 0, // Tracks which cursorActivity handlers have been called already
            selectionChanged: false, // Whether the selection needs to be redrawn
            updateMaxLine: false,    // Set when the widest line needs to be determined anew
            scrollLeft: null, scrollTop: null, // Intermediate scroll position, not pushed to DOM yet
            scrollToPos: null,       // Used to scroll to a specific position
            focus: false,
            id: ++nextOpId           // Unique ID
        };
        pushOperation(cm.curOp);
    }

    // Finish an operation, updating the display and signalling delayed events
    function endOperation(cm) {
        var op = cm.curOp;
        if (op) { finishOperation(op, function (group) {
            for (var i = 0; i < group.ops.length; i++)
            { group.ops[i].cm.curOp = null; }
            endOperations(group);
        }); }
    }

    // The DOM updates done when an operation finishes are batched so
    // that the minimum number of relayouts are required.
    function endOperations(group) {
        var ops = group.ops;
        for (var i = 0; i < ops.length; i++) // Read DOM
        { endOperation_R1(ops[i]); }
        for (var i$1 = 0; i$1 < ops.length; i$1++) // Write DOM (maybe)
        { endOperation_W1(ops[i$1]); }
        for (var i$2 = 0; i$2 < ops.length; i$2++) // Read DOM
        { endOperation_R2(ops[i$2]); }
        for (var i$3 = 0; i$3 < ops.length; i$3++) // Write DOM (maybe)
        { endOperation_W2(ops[i$3]); }
        for (var i$4 = 0; i$4 < ops.length; i$4++) // Read DOM
        { endOperation_finish(ops[i$4]); }
    }

    function endOperation_R1(op) {
        var cm = op.cm, display = cm.display;
        maybeClipScrollbars(cm);
        if (op.updateMaxLine) { findMaxLine(cm); }

        op.mustUpdate = op.viewChanged || op.forceUpdate || op.scrollTop != null ||
            op.scrollToPos && (op.scrollToPos.from.line < display.viewFrom ||
                op.scrollToPos.to.line >= display.viewTo) ||
            display.maxLineChanged && cm.options.lineWrapping;
        op.update = op.mustUpdate &&
            new DisplayUpdate(cm, op.mustUpdate && {top: op.scrollTop, ensure: op.scrollToPos}, op.forceUpdate);
    }

    function endOperation_W1(op) {
        op.updatedDisplay = op.mustUpdate && updateDisplayIfNeeded(op.cm, op.update);
    }

    function endOperation_R2(op) {
        var cm = op.cm, display = cm.display;
        if (op.updatedDisplay) { updateHeightsInViewport(cm); }

        op.barMeasure = measureForScrollbars(cm);

        // If the max line changed since it was last measured, measure it,
        // and ensure the document's width matches it.
        // updateDisplay_W2 will use these properties to do the actual resizing
        if (display.maxLineChanged && !cm.options.lineWrapping) {
            op.adjustWidthTo = measureChar(cm, display.maxLine, display.maxLine.text.length).left + 3;
            cm.display.sizerWidth = op.adjustWidthTo;
            op.barMeasure.scrollWidth =
                Math.max(display.scroller.clientWidth, display.sizer.offsetLeft + op.adjustWidthTo + scrollGap(cm) + cm.display.barWidth);
            op.maxScrollLeft = Math.max(0, display.sizer.offsetLeft + op.adjustWidthTo - displayWidth(cm));
        }

        if (op.updatedDisplay || op.selectionChanged)
        { op.preparedSelection = display.input.prepareSelection(); }
    }

    function endOperation_W2(op) {
        var cm = op.cm;

        if (op.adjustWidthTo != null) {
            cm.display.sizer.style.minWidth = op.adjustWidthTo + "px";
            if (op.maxScrollLeft < cm.doc.scrollLeft)
            { setScrollLeft(cm, Math.min(cm.display.scroller.scrollLeft, op.maxScrollLeft), true); }
            cm.display.maxLineChanged = false;
        }

        var takeFocus = op.focus && op.focus == activeElt();
        if (op.preparedSelection)
        { cm.display.input.showSelection(op.preparedSelection, takeFocus); }
        if (op.updatedDisplay || op.startHeight != cm.doc.height)
        { updateScrollbars(cm, op.barMeasure); }
        if (op.updatedDisplay)
        { setDocumentHeight(cm, op.barMeasure); }

        if (op.selectionChanged) { restartBlink(cm); }

        if (cm.state.focused && op.updateInput)
        { cm.display.input.reset(op.typing); }
        if (takeFocus) { ensureFocus(op.cm); }
    }

    function endOperation_finish(op) {
        var cm = op.cm, display = cm.display, doc = cm.doc;

        if (op.updatedDisplay) { postUpdateDisplay(cm, op.update); }

        // Abort mouse wheel delta measurement, when scrolling explicitly
        if (display.wheelStartX != null && (op.scrollTop != null || op.scrollLeft != null || op.scrollToPos))
        { display.wheelStartX = display.wheelStartY = null; }

        // Propagate the scroll position to the actual DOM scroller
        if (op.scrollTop != null) { setScrollTop(cm, op.scrollTop, op.forceScroll); }

        if (op.scrollLeft != null) { setScrollLeft(cm, op.scrollLeft, true, true); }
        // If we need to scroll a specific position into view, do so.
        if (op.scrollToPos) {
            var rect = scrollPosIntoView(cm, clipPos(doc, op.scrollToPos.from),
                clipPos(doc, op.scrollToPos.to), op.scrollToPos.margin);
            maybeScrollWindow(cm, rect);
        }

        // Fire events for markers that are hidden/unidden by editing or
        // undoing
        var hidden = op.maybeHiddenMarkers, unhidden = op.maybeUnhiddenMarkers;
        if (hidden) { for (var i = 0; i < hidden.length; ++i)
        { if (!hidden[i].lines.length) { signal(hidden[i], "hide"); } } }
        if (unhidden) { for (var i$1 = 0; i$1 < unhidden.length; ++i$1)
        { if (unhidden[i$1].lines.length) { signal(unhidden[i$1], "unhide"); } } }

        if (display.wrapper.offsetHeight)
        { doc.scrollTop = cm.display.scroller.scrollTop; }

        // Fire change events, and delayed event handlers
        if (op.changeObjs)
        { signal(cm, "changes", cm, op.changeObjs); }
        if (op.update)
        { op.update.finish(); }
    }

    // Run the given function in an operation
    function runInOp(cm, f) {
        if (cm.curOp) { return f() }
        startOperation(cm);
        try { return f() }
        finally { endOperation(cm); }
    }
    // Wraps a function in an operation. Returns the wrapped function.
    function operation(cm, f) {
        return function() {
            if (cm.curOp) { return f.apply(cm, arguments) }
            startOperation(cm);
            try { return f.apply(cm, arguments) }
            finally { endOperation(cm); }
        }
    }
    // Used to add methods to editor and doc instances, wrapping them in
    // operations.
    function methodOp(f) {
        return function() {
            if (this.curOp) { return f.apply(this, arguments) }
            startOperation(this);
            try { return f.apply(this, arguments) }
            finally { endOperation(this); }
        }
    }
    function docMethodOp(f) {
        return function() {
            var cm = this.cm;
            if (!cm || cm.curOp) { return f.apply(this, arguments) }
            startOperation(cm);
            try { return f.apply(this, arguments) }
            finally { endOperation(cm); }
        }
    }

    // HIGHLIGHT WORKER

    function startWorker(cm, time) {
        if (cm.doc.highlightFrontier < cm.display.viewTo)
        { cm.state.highlight.set(time, bind(highlightWorker, cm)); }
    }

    function highlightWorker(cm) {
        var doc = cm.doc;
        if (doc.highlightFrontier >= cm.display.viewTo) { return }
        var end = +new Date + cm.options.workTime;
        var context = getContextBefore(cm, doc.highlightFrontier);
        var changedLines = [];

        doc.iter(context.line, Math.min(doc.first + doc.size, cm.display.viewTo + 500), function (line) {
            if (context.line >= cm.display.viewFrom) { // Visible
                var oldStyles = line.styles;
                var resetState = line.text.length > cm.options.maxHighlightLength ? copyState(doc.mode, context.state) : null;
                var highlighted = highlightLine(cm, line, context, true);
                if (resetState) { context.state = resetState; }
                line.styles = highlighted.styles;
                var oldCls = line.styleClasses, newCls = highlighted.classes;
                if (newCls) { line.styleClasses = newCls; }
                else if (oldCls) { line.styleClasses = null; }
                var ischange = !oldStyles || oldStyles.length != line.styles.length ||
                    oldCls != newCls && (!oldCls || !newCls || oldCls.bgClass != newCls.bgClass || oldCls.textClass != newCls.textClass);
                for (var i = 0; !ischange && i < oldStyles.length; ++i) { ischange = oldStyles[i] != line.styles[i]; }
                if (ischange) { changedLines.push(context.line); }
                line.stateAfter = context.save();
                context.nextLine();
            } else {
                if (line.text.length <= cm.options.maxHighlightLength)
                { processLine(cm, line.text, context); }
                line.stateAfter = context.line % 5 == 0 ? context.save() : null;
                context.nextLine();
            }
            if (+new Date > end) {
                startWorker(cm, cm.options.workDelay);
                return true
            }
        });
        doc.highlightFrontier = context.line;
        doc.modeFrontier = Math.max(doc.modeFrontier, context.line);
        if (changedLines.length) { runInOp(cm, function () {
            for (var i = 0; i < changedLines.length; i++)
            { regLineChange(cm, changedLines[i], "text"); }
        }); }
    }

    // DISPLAY DRAWING

    var DisplayUpdate = function(cm, viewport, force) {
        var display = cm.display;

        this.viewport = viewport;
        // Store some values that we'll need later (but don't want to force a relayout for)
        this.visible = visibleLines(display, cm.doc, viewport);
        this.editorIsHidden = !display.wrapper.offsetWidth;
        this.wrapperHeight = display.wrapper.clientHeight;
        this.wrapperWidth = display.wrapper.clientWidth;
        this.oldDisplayWidth = displayWidth(cm);
        this.force = force;
        this.dims = getDimensions(cm);
        this.events = [];
    };

    DisplayUpdate.prototype.signal = function (emitter, type) {
        if (hasHandler(emitter, type))
        { this.events.push(arguments); }
    };
    DisplayUpdate.prototype.finish = function () {
        for (var i = 0; i < this.events.length; i++)
        { signal.apply(null, this.events[i]); }
    };

    function maybeClipScrollbars(cm) {
        var display = cm.display;
        if (!display.scrollbarsClipped && display.scroller.offsetWidth) {
            display.nativeBarWidth = display.scroller.offsetWidth - display.scroller.clientWidth;
            display.heightForcer.style.height = scrollGap(cm) + "px";
            display.sizer.style.marginBottom = -display.nativeBarWidth + "px";
            display.sizer.style.borderRightWidth = scrollGap(cm) + "px";
            display.scrollbarsClipped = true;
        }
    }

    function selectionSnapshot(cm) {
        if (cm.hasFocus()) { return null }
        var active = activeElt();
        if (!active || !contains(cm.display.lineDiv, active)) { return null }
        var result = {activeElt: active};
        if (window.getSelection) {
            var sel = window.getSelection();
            if (sel.anchorNode && sel.extend && contains(cm.display.lineDiv, sel.anchorNode)) {
                result.anchorNode = sel.anchorNode;
                result.anchorOffset = sel.anchorOffset;
                result.focusNode = sel.focusNode;
                result.focusOffset = sel.focusOffset;
            }
        }
        return result
    }

    function restoreSelection(snapshot) {
        if (!snapshot || !snapshot.activeElt || snapshot.activeElt == activeElt()) { return }
        snapshot.activeElt.focus();
        if (!/^(INPUT|TEXTAREA)$/.test(snapshot.activeElt.nodeName) &&
            snapshot.anchorNode && contains(document.body, snapshot.anchorNode) && contains(document.body, snapshot.focusNode)) {
            var sel = window.getSelection(), range = document.createRange();
            range.setEnd(snapshot.anchorNode, snapshot.anchorOffset);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            sel.extend(snapshot.focusNode, snapshot.focusOffset);
        }
    }

    // Does the actual updating of the line display. Bails out
    // (returning false) when there is nothing to be done and forced is
    // false.
    function updateDisplayIfNeeded(cm, update) {
        var display = cm.display, doc = cm.doc;

        if (update.editorIsHidden) {
            resetView(cm);
            return false
        }

        // Bail out if the visible area is already rendered and nothing changed.
        if (!update.force &&
            update.visible.from >= display.viewFrom && update.visible.to <= display.viewTo &&
            (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo) &&
            display.renderedView == display.view && countDirtyView(cm) == 0)
        { return false }

        if (maybeUpdateLineNumberWidth(cm)) {
            resetView(cm);
            update.dims = getDimensions(cm);
        }

        // Compute a suitable new viewport (from & to)
        var end = doc.first + doc.size;
        var from = Math.max(update.visible.from - cm.options.viewportMargin, doc.first);
        var to = Math.min(end, update.visible.to + cm.options.viewportMargin);
        if (display.viewFrom < from && from - display.viewFrom < 20) { from = Math.max(doc.first, display.viewFrom); }
        if (display.viewTo > to && display.viewTo - to < 20) { to = Math.min(end, display.viewTo); }
        if (sawCollapsedSpans) {
            from = visualLineNo(cm.doc, from);
            to = visualLineEndNo(cm.doc, to);
        }

        var different = from != display.viewFrom || to != display.viewTo ||
            display.lastWrapHeight != update.wrapperHeight || display.lastWrapWidth != update.wrapperWidth;
        adjustView(cm, from, to);

        display.viewOffset = heightAtLine(getLine(cm.doc, display.viewFrom));
        // Position the mover div to align with the current scroll position
        cm.display.mover.style.top = display.viewOffset + "px";

        var toUpdate = countDirtyView(cm);
        if (!different && toUpdate == 0 && !update.force && display.renderedView == display.view &&
            (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo))
        { return false }

        // For big changes, we hide the enclosing element during the
        // update, since that speeds up the operations on most browsers.
        var selSnapshot = selectionSnapshot(cm);
        if (toUpdate > 4) { display.lineDiv.style.display = "none"; }
        patchDisplay(cm, display.updateLineNumbers, update.dims);
        if (toUpdate > 4) { display.lineDiv.style.display = ""; }
        display.renderedView = display.view;
        // There might have been a widget with a focused element that got
        // hidden or updated, if so re-focus it.
        restoreSelection(selSnapshot);

        // Prevent selection and cursors from interfering with the scroll
        // width and height.
        removeChildren(display.cursorDiv);
        removeChildren(display.selectionDiv);
        display.gutters.style.height = display.sizer.style.minHeight = 0;

        if (different) {
            display.lastWrapHeight = update.wrapperHeight;
            display.lastWrapWidth = update.wrapperWidth;
            startWorker(cm, 400);
        }

        display.updateLineNumbers = null;

        return true
    }

    function postUpdateDisplay(cm, update) {
        var viewport = update.viewport;

        for (var first = true;; first = false) {
            if (!first || !cm.options.lineWrapping || update.oldDisplayWidth == displayWidth(cm)) {
                // Clip forced viewport to actual scrollable area.
                if (viewport && viewport.top != null)
                { viewport = {top: Math.min(cm.doc.height + paddingVert(cm.display) - displayHeight(cm), viewport.top)}; }
                // Updated line heights might result in the drawn area not
                // actually covering the viewport. Keep looping until it does.
                update.visible = visibleLines(cm.display, cm.doc, viewport);
                if (update.visible.from >= cm.display.viewFrom && update.visible.to <= cm.display.viewTo)
                { break }
            } else if (first) {
                update.visible = visibleLines(cm.display, cm.doc, viewport);
            }
            if (!updateDisplayIfNeeded(cm, update)) { break }
            updateHeightsInViewport(cm);
            var barMeasure = measureForScrollbars(cm);
            updateSelection(cm);
            updateScrollbars(cm, barMeasure);
            setDocumentHeight(cm, barMeasure);
            update.force = false;
        }

        update.signal(cm, "update", cm);
        if (cm.display.viewFrom != cm.display.reportedViewFrom || cm.display.viewTo != cm.display.reportedViewTo) {
            update.signal(cm, "viewportChange", cm, cm.display.viewFrom, cm.display.viewTo);
            cm.display.reportedViewFrom = cm.display.viewFrom; cm.display.reportedViewTo = cm.display.viewTo;
        }
    }

    function updateDisplaySimple(cm, viewport) {
        var update = new DisplayUpdate(cm, viewport);
        if (updateDisplayIfNeeded(cm, update)) {
            updateHeightsInViewport(cm);
            postUpdateDisplay(cm, update);
            var barMeasure = measureForScrollbars(cm);
            updateSelection(cm);
            updateScrollbars(cm, barMeasure);
            setDocumentHeight(cm, barMeasure);
            update.finish();
        }
    }

    // Sync the actual display DOM structure with display.view, removing
    // nodes for lines that are no longer in view, and creating the ones
    // that are not there yet, and updating the ones that are out of
    // date.
    function patchDisplay(cm, updateNumbersFrom, dims) {
        var display = cm.display, lineNumbers = cm.options.lineNumbers;
        var container = display.lineDiv, cur = container.firstChild;

        function rm(node) {
            var next = node.nextSibling;
            // Works around a throw-scroll bug in OS X Webkit
            if (webkit && mac && cm.display.currentWheelTarget == node)
            { node.style.display = "none"; }
            else
            { node.parentNode.removeChild(node); }
            return next
        }

        var view = display.view, lineN = display.viewFrom;
        // Loop over the elements in the view, syncing cur (the DOM nodes
        // in display.lineDiv) with the view as we go.
        for (var i = 0; i < view.length; i++) {
            var lineView = view[i];
            if (lineView.hidden) ; else if (!lineView.node || lineView.node.parentNode != container) { // Not drawn yet
                var node = buildLineElement(cm, lineView, lineN, dims);
                container.insertBefore(node, cur);
            } else { // Already drawn
                while (cur != lineView.node) { cur = rm(cur); }
                var updateNumber = lineNumbers && updateNumbersFrom != null &&
                    updateNumbersFrom <= lineN && lineView.lineNumber;
                if (lineView.changes) {
                    if (indexOf(lineView.changes, "gutter") > -1) { updateNumber = false; }
                    updateLineForChanges(cm, lineView, lineN, dims);
                }
                if (updateNumber) {
                    removeChildren(lineView.lineNumber);
                    lineView.lineNumber.appendChild(document.createTextNode(lineNumberFor(cm.options, lineN)));
                }
                cur = lineView.node.nextSibling;
            }
            lineN += lineView.size;
        }
        while (cur) { cur = rm(cur); }
    }

    function updateGutterSpace(display) {
        var width = display.gutters.offsetWidth;
        display.sizer.style.marginLeft = width + "px";
    }

    function setDocumentHeight(cm, measure) {
        cm.display.sizer.style.minHeight = measure.docHeight + "px";
        cm.display.heightForcer.style.top = measure.docHeight + "px";
        cm.display.gutters.style.height = (measure.docHeight + cm.display.barHeight + scrollGap(cm)) + "px";
    }

    // Re-align line numbers and gutter marks to compensate for
    // horizontal scrolling.
    function alignHorizontally(cm) {
        var display = cm.display, view = display.view;
        if (!display.alignWidgets && (!display.gutters.firstChild || !cm.options.fixedGutter)) { return }
        var comp = compensateForHScroll(display) - display.scroller.scrollLeft + cm.doc.scrollLeft;
        var gutterW = display.gutters.offsetWidth, left = comp + "px";
        for (var i = 0; i < view.length; i++) { if (!view[i].hidden) {
            if (cm.options.fixedGutter) {
                if (view[i].gutter)
                { view[i].gutter.style.left = left; }
                if (view[i].gutterBackground)
                { view[i].gutterBackground.style.left = left; }
            }
            var align = view[i].alignable;
            if (align) { for (var j = 0; j < align.length; j++)
            { align[j].style.left = left; } }
        } }
        if (cm.options.fixedGutter)
        { display.gutters.style.left = (comp + gutterW) + "px"; }
    }

    // Used to ensure that the line number gutter is still the right
    // size for the current document size. Returns true when an update
    // is needed.
    function maybeUpdateLineNumberWidth(cm) {
        if (!cm.options.lineNumbers) { return false }
        var doc = cm.doc, last = lineNumberFor(cm.options, doc.first + doc.size - 1), display = cm.display;
        if (last.length != display.lineNumChars) {
            var test = display.measure.appendChild(elt("div", [elt("div", last)],
                "CodeMirror-linenumber CodeMirror-gutter-elt"));
            var innerW = test.firstChild.offsetWidth, padding = test.offsetWidth - innerW;
            display.lineGutter.style.width = "";
            display.lineNumInnerWidth = Math.max(innerW, display.lineGutter.offsetWidth - padding) + 1;
            display.lineNumWidth = display.lineNumInnerWidth + padding;
            display.lineNumChars = display.lineNumInnerWidth ? last.length : -1;
            display.lineGutter.style.width = display.lineNumWidth + "px";
            updateGutterSpace(cm.display);
            return true
        }
        return false
    }

    function getGutters(gutters, lineNumbers) {
        var result = [], sawLineNumbers = false;
        for (var i = 0; i < gutters.length; i++) {
            var name = gutters[i], style = null;
            if (typeof name != "string") { style = name.style; name = name.className; }
            if (name == "CodeMirror-linenumbers") {
                if (!lineNumbers) { continue }
                else { sawLineNumbers = true; }
            }
            result.push({className: name, style: style});
        }
        if (lineNumbers && !sawLineNumbers) { result.push({className: "CodeMirror-linenumbers", style: null}); }
        return result
    }

    // Rebuild the gutter elements, ensure the margin to the left of the
    // code matches their width.
    function renderGutters(display) {
        var gutters = display.gutters, specs = display.gutterSpecs;
        removeChildren(gutters);
        display.lineGutter = null;
        for (var i = 0; i < specs.length; ++i) {
            var ref = specs[i];
            var className = ref.className;
            var style = ref.style;
            var gElt = gutters.appendChild(elt("div", null, "CodeMirror-gutter " + className));
            if (style) { gElt.style.cssText = style; }
            if (className == "CodeMirror-linenumbers") {
                display.lineGutter = gElt;
                gElt.style.width = (display.lineNumWidth || 1) + "px";
            }
        }
        gutters.style.display = specs.length ? "" : "none";
        updateGutterSpace(display);
    }

    function updateGutters(cm) {
        renderGutters(cm.display);
        regChange(cm);
        alignHorizontally(cm);
    }

    // The display handles the DOM integration, both for input reading
    // and content drawing. It holds references to DOM nodes and
    // display-related state.

    function Display(place, doc, input, options) {
        var d = this;
        this.input = input;

        // Covers bottom-right square when both scrollbars are present.
        d.scrollbarFiller = elt("div", null, "CodeMirror-scrollbar-filler");
        d.scrollbarFiller.setAttribute("cm-not-content", "true");
        // Covers bottom of gutter when coverGutterNextToScrollbar is on
        // and h scrollbar is present.
        d.gutterFiller = elt("div", null, "CodeMirror-gutter-filler");
        d.gutterFiller.setAttribute("cm-not-content", "true");
        // Will contain the actual code, positioned to cover the viewport.
        d.lineDiv = eltP("div", null, "CodeMirror-code");
        // Elements are added to these to represent selection and cursors.
        d.selectionDiv = elt("div", null, null, "position: relative; z-index: 1");
        d.cursorDiv = elt("div", null, "CodeMirror-cursors");
        // A visibility: hidden element used to find the size of things.
        d.measure = elt("div", null, "CodeMirror-measure");
        // When lines outside of the viewport are measured, they are drawn in this.
        d.lineMeasure = elt("div", null, "CodeMirror-measure");
        // Wraps everything that needs to exist inside the vertically-padded coordinate system
        d.lineSpace = eltP("div", [d.measure, d.lineMeasure, d.selectionDiv, d.cursorDiv, d.lineDiv],
            null, "position: relative; outline: none");
        var lines = eltP("div", [d.lineSpace], "CodeMirror-lines");
        // Moved around its parent to cover visible view.
        d.mover = elt("div", [lines], null, "position: relative");
        // Set to the height of the document, allowing scrolling.
        d.sizer = elt("div", [d.mover], "CodeMirror-sizer");
        d.sizerWidth = null;
        // Behavior of elts with overflow: auto and padding is
        // inconsistent across browsers. This is used to ensure the
        // scrollable area is big enough.
        d.heightForcer = elt("div", null, null, "position: absolute; height: " + scrollerGap + "px; width: 1px;");
        // Will contain the gutters, if any.
        d.gutters = elt("div", null, "CodeMirror-gutters");
        d.lineGutter = null;
        // Actual scrollable element.
        d.scroller = elt("div", [d.sizer, d.heightForcer, d.gutters], "CodeMirror-scroll");
        d.scroller.setAttribute("tabIndex", "-1");
        // The element in which the editor lives.
        d.wrapper = elt("div", [d.scrollbarFiller, d.gutterFiller, d.scroller], "CodeMirror");

        // Work around IE7 z-index bug (not perfect, hence IE7 not really being supported)
        if (ie && ie_version < 8) { d.gutters.style.zIndex = -1; d.scroller.style.paddingRight = 0; }
        if (!webkit && !(gecko && mobile)) { d.scroller.draggable = true; }

        if (place) {
            if (place.appendChild) { place.appendChild(d.wrapper); }
            else { place(d.wrapper); }
        }

        // Current rendered range (may be bigger than the view window).
        d.viewFrom = d.viewTo = doc.first;
        d.reportedViewFrom = d.reportedViewTo = doc.first;
        // Information about the rendered lines.
        d.view = [];
        d.renderedView = null;
        // Holds info about a single rendered line when it was rendered
        // for measurement, while not in view.
        d.externalMeasured = null;
        // Empty space (in pixels) above the view
        d.viewOffset = 0;
        d.lastWrapHeight = d.lastWrapWidth = 0;
        d.updateLineNumbers = null;

        d.nativeBarWidth = d.barHeight = d.barWidth = 0;
        d.scrollbarsClipped = false;

        // Used to only resize the line number gutter when necessary (when
        // the amount of lines crosses a boundary that makes its width change)
        d.lineNumWidth = d.lineNumInnerWidth = d.lineNumChars = null;
        // Set to true when a non-horizontal-scrolling line widget is
        // added. As an optimization, line widget aligning is skipped when
        // this is false.
        d.alignWidgets = false;

        d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;

        // Tracks the maximum line length so that the horizontal scrollbar
        // can be kept static when scrolling.
        d.maxLine = null;
        d.maxLineLength = 0;
        d.maxLineChanged = false;

        // Used for measuring wheel scrolling granularity
        d.wheelDX = d.wheelDY = d.wheelStartX = d.wheelStartY = null;

        // True when shift is held down.
        d.shift = false;

        // Used to track whether anything happened since the context menu
        // was opened.
        d.selForContextMenu = null;

        d.activeTouch = null;

        d.gutterSpecs = getGutters(options.gutters, options.lineNumbers);
        renderGutters(d);

        input.init(d);
    }

    // Since the delta values reported on mouse wheel events are
    // unstandardized between browsers and even browser versions, and
    // generally horribly unpredictable, this code starts by measuring
    // the scroll effect that the first few mouse wheel events have,
    // and, from that, detects the way it can convert deltas to pixel
    // offsets afterwards.
    //
    // The reason we want to know the amount a wheel event will scroll
    // is that it gives us a chance to update the display before the
    // actual scrolling happens, reducing flickering.

    var wheelSamples = 0, wheelPixelsPerUnit = null;
    // Fill in a browser-detected starting value on browsers where we
    // know one. These don't have to be accurate -- the result of them
    // being wrong would just be a slight flicker on the first wheel
    // scroll (if it is large enough).
    if (ie) { wheelPixelsPerUnit = -.53; }
    else if (gecko) { wheelPixelsPerUnit = 15; }
    else if (chrome) { wheelPixelsPerUnit = -.7; }
    else if (safari) { wheelPixelsPerUnit = -1/3; }

    function wheelEventDelta(e) {
        var dx = e.wheelDeltaX, dy = e.wheelDeltaY;
        if (dx == null && e.detail && e.axis == e.HORIZONTAL_AXIS) { dx = e.detail; }
        if (dy == null && e.detail && e.axis == e.VERTICAL_AXIS) { dy = e.detail; }
        else if (dy == null) { dy = e.wheelDelta; }
        return {x: dx, y: dy}
    }
    function wheelEventPixels(e) {
        var delta = wheelEventDelta(e);
        delta.x *= wheelPixelsPerUnit;
        delta.y *= wheelPixelsPerUnit;
        return delta
    }

    function onScrollWheel(cm, e) {
        var delta = wheelEventDelta(e), dx = delta.x, dy = delta.y;

        var display = cm.display, scroll = display.scroller;
        // Quit if there's nothing to scroll here
        var canScrollX = scroll.scrollWidth > scroll.clientWidth;
        var canScrollY = scroll.scrollHeight > scroll.clientHeight;
        if (!(dx && canScrollX || dy && canScrollY)) { return }

        // Webkit browsers on OS X abort momentum scrolls when the target
        // of the scroll event is removed from the scrollable element.
        // This hack (see related code in patchDisplay) makes sure the
        // element is kept around.
        if (dy && mac && webkit) {
            outer: for (var cur = e.target, view = display.view; cur != scroll; cur = cur.parentNode) {
                for (var i = 0; i < view.length; i++) {
                    if (view[i].node == cur) {
                        cm.display.currentWheelTarget = cur;
                        break outer
                    }
                }
            }
        }

        // On some browsers, horizontal scrolling will cause redraws to
        // happen before the gutter has been realigned, causing it to
        // wriggle around in a most unseemly way. When we have an
        // estimated pixels/delta value, we just handle horizontal
        // scrolling entirely here. It'll be slightly off from native, but
        // better than glitching out.
        if (dx && !gecko && !presto && wheelPixelsPerUnit != null) {
            if (dy && canScrollY)
            { updateScrollTop(cm, Math.max(0, scroll.scrollTop + dy * wheelPixelsPerUnit)); }
            setScrollLeft(cm, Math.max(0, scroll.scrollLeft + dx * wheelPixelsPerUnit));
            // Only prevent default scrolling if vertical scrolling is
            // actually possible. Otherwise, it causes vertical scroll
            // jitter on OSX trackpads when deltaX is small and deltaY
            // is large (issue #3579)
            if (!dy || (dy && canScrollY))
            { e_preventDefault(e); }
            display.wheelStartX = null; // Abort measurement, if in progress
            return
        }

        // 'Project' the visible viewport to cover the area that is being
        // scrolled into view (if we know enough to estimate it).
        if (dy && wheelPixelsPerUnit != null) {
            var pixels = dy * wheelPixelsPerUnit;
            var top = cm.doc.scrollTop, bot = top + display.wrapper.clientHeight;
            if (pixels < 0) { top = Math.max(0, top + pixels - 50); }
            else { bot = Math.min(cm.doc.height, bot + pixels + 50); }
            updateDisplaySimple(cm, {top: top, bottom: bot});
        }

        if (wheelSamples < 20) {
            if (display.wheelStartX == null) {
                display.wheelStartX = scroll.scrollLeft; display.wheelStartY = scroll.scrollTop;
                display.wheelDX = dx; display.wheelDY = dy;
                setTimeout(function () {
                    if (display.wheelStartX == null) { return }
                    var movedX = scroll.scrollLeft - display.wheelStartX;
                    var movedY = scroll.scrollTop - display.wheelStartY;
                    var sample = (movedY && display.wheelDY && movedY / display.wheelDY) ||
                        (movedX && display.wheelDX && movedX / display.wheelDX);
                    display.wheelStartX = display.wheelStartY = null;
                    if (!sample) { return }
                    wheelPixelsPerUnit = (wheelPixelsPerUnit * wheelSamples + sample) / (wheelSamples + 1);
                    ++wheelSamples;
                }, 200);
            } else {
                display.wheelDX += dx; display.wheelDY += dy;
            }
        }
    }

    // Selection objects are immutable. A new one is created every time
    // the selection changes. A selection is one or more non-overlapping
    // (and non-touching) ranges, sorted, and an integer that indicates
    // which one is the primary selection (the one that's scrolled into
    // view, that getCursor returns, etc).
    var Selection = function(ranges, primIndex) {
        this.ranges = ranges;
        this.primIndex = primIndex;
    };

    Selection.prototype.primary = function () { return this.ranges[this.primIndex] };

    Selection.prototype.equals = function (other) {
        if (other == this) { return true }
        if (other.primIndex != this.primIndex || other.ranges.length != this.ranges.length) { return false }
        for (var i = 0; i < this.ranges.length; i++) {
            var here = this.ranges[i], there = other.ranges[i];
            if (!equalCursorPos(here.anchor, there.anchor) || !equalCursorPos(here.head, there.head)) { return false }
        }
        return true
    };

    Selection.prototype.deepCopy = function () {
        var out = [];
        for (var i = 0; i < this.ranges.length; i++)
        { out[i] = new Range(copyPos(this.ranges[i].anchor), copyPos(this.ranges[i].head)); }
        return new Selection(out, this.primIndex)
    };

    Selection.prototype.somethingSelected = function () {
        for (var i = 0; i < this.ranges.length; i++)
        { if (!this.ranges[i].empty()) { return true } }
        return false
    };

    Selection.prototype.contains = function (pos, end) {
        if (!end) { end = pos; }
        for (var i = 0; i < this.ranges.length; i++) {
            var range = this.ranges[i];
            if (cmp(end, range.from()) >= 0 && cmp(pos, range.to()) <= 0)
            { return i }
        }
        return -1
    };

    var Range = function(anchor, head) {
        this.anchor = anchor; this.head = head;
    };

    Range.prototype.from = function () { return minPos(this.anchor, this.head) };
    Range.prototype.to = function () { return maxPos(this.anchor, this.head) };
    Range.prototype.empty = function () { return this.head.line == this.anchor.line && this.head.ch == this.anchor.ch };

    // Take an unsorted, potentially overlapping set of ranges, and
    // build a selection out of it. 'Consumes' ranges array (modifying
    // it).
    function normalizeSelection(cm, ranges, primIndex) {
        var mayTouch = cm && cm.options.selectionsMayTouch;
        var prim = ranges[primIndex];
        ranges.sort(function (a, b) { return cmp(a.from(), b.from()); });
        primIndex = indexOf(ranges, prim);
        for (var i = 1; i < ranges.length; i++) {
            var cur = ranges[i], prev = ranges[i - 1];
            var diff = cmp(prev.to(), cur.from());
            if (mayTouch && !cur.empty() ? diff > 0 : diff >= 0) {
                var from = minPos(prev.from(), cur.from()), to = maxPos(prev.to(), cur.to());
                var inv = prev.empty() ? cur.from() == cur.head : prev.from() == prev.head;
                if (i <= primIndex) { --primIndex; }
                ranges.splice(--i, 2, new Range(inv ? to : from, inv ? from : to));
            }
        }
        return new Selection(ranges, primIndex)
    }

    function simpleSelection(anchor, head) {
        return new Selection([new Range(anchor, head || anchor)], 0)
    }

    // Compute the position of the end of a change (its 'to' property
    // refers to the pre-change end).
    function changeEnd(change) {
        if (!change.text) { return change.to }
        return Pos(change.from.line + change.text.length - 1,
            lst(change.text).length + (change.text.length == 1 ? change.from.ch : 0))
    }

    // Adjust a position to refer to the post-change position of the
    // same text, or the end of the change if the change covers it.
    function adjustForChange(pos, change) {
        if (cmp(pos, change.from) < 0) { return pos }
        if (cmp(pos, change.to) <= 0) { return changeEnd(change) }

        var line = pos.line + change.text.length - (change.to.line - change.from.line) - 1, ch = pos.ch;
        if (pos.line == change.to.line) { ch += changeEnd(change).ch - change.to.ch; }
        return Pos(line, ch)
    }

    function computeSelAfterChange(doc, change) {
        var out = [];
        for (var i = 0; i < doc.sel.ranges.length; i++) {
            var range = doc.sel.ranges[i];
            out.push(new Range(adjustForChange(range.anchor, change),
                adjustForChange(range.head, change)));
        }
        return normalizeSelection(doc.cm, out, doc.sel.primIndex)
    }

    function offsetPos(pos, old, nw) {
        if (pos.line == old.line)
        { return Pos(nw.line, pos.ch - old.ch + nw.ch) }
        else
        { return Pos(nw.line + (pos.line - old.line), pos.ch) }
    }

    // Used by replaceSelections to allow moving the selection to the
    // start or around the replaced test. Hint may be "start" or "around".
    function computeReplacedSel(doc, changes, hint) {
        var out = [];
        var oldPrev = Pos(doc.first, 0), newPrev = oldPrev;
        for (var i = 0; i < changes.length; i++) {
            var change = changes[i];
            var from = offsetPos(change.from, oldPrev, newPrev);
            var to = offsetPos(changeEnd(change), oldPrev, newPrev);
            oldPrev = change.to;
            newPrev = to;
            if (hint == "around") {
                var range = doc.sel.ranges[i], inv = cmp(range.head, range.anchor) < 0;
                out[i] = new Range(inv ? to : from, inv ? from : to);
            } else {
                out[i] = new Range(from, from);
            }
        }
        return new Selection(out, doc.sel.primIndex)
    }

    // Used to get the editor into a consistent state again when options change.

    function loadMode(cm) {
        cm.doc.mode = getMode(cm.options, cm.doc.modeOption);
        resetModeState(cm);
    }

    function resetModeState(cm) {
        cm.doc.iter(function (line) {
            if (line.stateAfter) { line.stateAfter = null; }
            if (line.styles) { line.styles = null; }
        });
        cm.doc.modeFrontier = cm.doc.highlightFrontier = cm.doc.first;
        startWorker(cm, 100);
        cm.state.modeGen++;
        if (cm.curOp) { regChange(cm); }
    }

    // DOCUMENT DATA STRUCTURE

    // By default, updates that start and end at the beginning of a line
    // are treated specially, in order to make the association of line
    // widgets and marker elements with the text behave more intuitive.
    function isWholeLineUpdate(doc, change) {
        return change.from.ch == 0 && change.to.ch == 0 && lst(change.text) == "" &&
            (!doc.cm || doc.cm.options.wholeLineUpdateBefore)
    }

    // Perform a change on the document data structure.
    function updateDoc(doc, change, markedSpans, estimateHeight) {
        function spansFor(n) {return markedSpans ? markedSpans[n] : null}
        function update(line, text, spans) {
            updateLine(line, text, spans, estimateHeight);
            signalLater(line, "change", line, change);
        }
        function linesFor(start, end) {
            var result = [];
            for (var i = start; i < end; ++i)
            { result.push(new Line(text[i], spansFor(i), estimateHeight)); }
            return result
        }

        var from = change.from, to = change.to, text = change.text;
        var firstLine = getLine(doc, from.line), lastLine = getLine(doc, to.line);
        var lastText = lst(text), lastSpans = spansFor(text.length - 1), nlines = to.line - from.line;

        // Adjust the line structure
        if (change.full) {
            doc.insert(0, linesFor(0, text.length));
            doc.remove(text.length, doc.size - text.length);
        } else if (isWholeLineUpdate(doc, change)) {
            // This is a whole-line replace. Treated specially to make
            // sure line objects move the way they are supposed to.
            var added = linesFor(0, text.length - 1);
            update(lastLine, lastLine.text, lastSpans);
            if (nlines) { doc.remove(from.line, nlines); }
            if (added.length) { doc.insert(from.line, added); }
        } else if (firstLine == lastLine) {
            if (text.length == 1) {
                update(firstLine, firstLine.text.slice(0, from.ch) + lastText + firstLine.text.slice(to.ch), lastSpans);
            } else {
                var added$1 = linesFor(1, text.length - 1);
                added$1.push(new Line(lastText + firstLine.text.slice(to.ch), lastSpans, estimateHeight));
                update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
                doc.insert(from.line + 1, added$1);
            }
        } else if (text.length == 1) {
            update(firstLine, firstLine.text.slice(0, from.ch) + text[0] + lastLine.text.slice(to.ch), spansFor(0));
            doc.remove(from.line + 1, nlines);
        } else {
            update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
            update(lastLine, lastText + lastLine.text.slice(to.ch), lastSpans);
            var added$2 = linesFor(1, text.length - 1);
            if (nlines > 1) { doc.remove(from.line + 1, nlines - 1); }
            doc.insert(from.line + 1, added$2);
        }

        signalLater(doc, "change", doc, change);
    }

    // Call f for all linked documents.
    function linkedDocs(doc, f, sharedHistOnly) {
        function propagate(doc, skip, sharedHist) {
            if (doc.linked) { for (var i = 0; i < doc.linked.length; ++i) {
                var rel = doc.linked[i];
                if (rel.doc == skip) { continue }
                var shared = sharedHist && rel.sharedHist;
                if (sharedHistOnly && !shared) { continue }
                f(rel.doc, shared);
                propagate(rel.doc, doc, shared);
            } }
        }
        propagate(doc, null, true);
    }

    // Attach a document to an editor.
    function attachDoc(cm, doc) {
        if (doc.cm) { throw new Error("This document is already in use.") }
        cm.doc = doc;
        doc.cm = cm;
        estimateLineHeights(cm);
        loadMode(cm);
        setDirectionClass(cm);
        if (!cm.options.lineWrapping) { findMaxLine(cm); }
        cm.options.mode = doc.modeOption;
        regChange(cm);
    }

    function setDirectionClass(cm) {
        (cm.doc.direction == "rtl" ? addClass : rmClass)(cm.display.lineDiv, "CodeMirror-rtl");
    }

    function directionChanged(cm) {
        runInOp(cm, function () {
            setDirectionClass(cm);
            regChange(cm);
        });
    }

    function History(prev) {
        // Arrays of change events and selections. Doing something adds an
        // event to done and clears undo. Undoing moves events from done
        // to undone, redoing moves them in the other direction.
        this.done = []; this.undone = [];
        this.undoDepth = prev ? prev.undoDepth : Infinity;
        // Used to track when changes can be merged into a single undo
        // event
        this.lastModTime = this.lastSelTime = 0;
        this.lastOp = this.lastSelOp = null;
        this.lastOrigin = this.lastSelOrigin = null;
        // Used by the isClean() method
        this.generation = this.maxGeneration = prev ? prev.maxGeneration : 1;
    }

    // Create a history change event from an updateDoc-style change
    // object.
    function historyChangeFromChange(doc, change) {
        var histChange = {from: copyPos(change.from), to: changeEnd(change), text: getBetween(doc, change.from, change.to)};
        attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);
        linkedDocs(doc, function (doc) { return attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1); }, true);
        return histChange
    }

    // Pop all selection events off the end of a history array. Stop at
    // a change event.
    function clearSelectionEvents(array) {
        while (array.length) {
            var last = lst(array);
            if (last.ranges) { array.pop(); }
            else { break }
        }
    }

    // Find the top change event in the history. Pop off selection
    // events that are in the way.
    function lastChangeEvent(hist, force) {
        if (force) {
            clearSelectionEvents(hist.done);
            return lst(hist.done)
        } else if (hist.done.length && !lst(hist.done).ranges) {
            return lst(hist.done)
        } else if (hist.done.length > 1 && !hist.done[hist.done.length - 2].ranges) {
            hist.done.pop();
            return lst(hist.done)
        }
    }

    // Register a change in the history. Merges changes that are within
    // a single operation, or are close together with an origin that
    // allows merging (starting with "+") into a single event.
    function addChangeToHistory(doc, change, selAfter, opId) {
        var hist = doc.history;
        hist.undone.length = 0;
        var time = +new Date, cur;
        var last;

        if ((hist.lastOp == opId ||
            hist.lastOrigin == change.origin && change.origin &&
            ((change.origin.charAt(0) == "+" && hist.lastModTime > time - (doc.cm ? doc.cm.options.historyEventDelay : 500)) ||
                change.origin.charAt(0) == "*")) &&
            (cur = lastChangeEvent(hist, hist.lastOp == opId))) {
            // Merge this change into the last event
            last = lst(cur.changes);
            if (cmp(change.from, change.to) == 0 && cmp(change.from, last.to) == 0) {
                // Optimized case for simple insertion -- don't want to add
                // new changesets for every character typed
                last.to = changeEnd(change);
            } else {
                // Add new sub-event
                cur.changes.push(historyChangeFromChange(doc, change));
            }
        } else {
            // Can not be merged, start a new event.
            var before = lst(hist.done);
            if (!before || !before.ranges)
            { pushSelectionToHistory(doc.sel, hist.done); }
            cur = {changes: [historyChangeFromChange(doc, change)],
                generation: hist.generation};
            hist.done.push(cur);
            while (hist.done.length > hist.undoDepth) {
                hist.done.shift();
                if (!hist.done[0].ranges) { hist.done.shift(); }
            }
        }
        hist.done.push(selAfter);
        hist.generation = ++hist.maxGeneration;
        hist.lastModTime = hist.lastSelTime = time;
        hist.lastOp = hist.lastSelOp = opId;
        hist.lastOrigin = hist.lastSelOrigin = change.origin;

        if (!last) { signal(doc, "historyAdded"); }
    }

    function selectionEventCanBeMerged(doc, origin, prev, sel) {
        var ch = origin.charAt(0);
        return ch == "*" ||
            ch == "+" &&
            prev.ranges.length == sel.ranges.length &&
            prev.somethingSelected() == sel.somethingSelected() &&
            new Date - doc.history.lastSelTime <= (doc.cm ? doc.cm.options.historyEventDelay : 500)
    }

    // Called whenever the selection changes, sets the new selection as
    // the pending selection in the history, and pushes the old pending
    // selection into the 'done' array when it was significantly
    // different (in number of selected ranges, emptiness, or time).
    function addSelectionToHistory(doc, sel, opId, options) {
        var hist = doc.history, origin = options && options.origin;

        // A new event is started when the previous origin does not match
        // the current, or the origins don't allow matching. Origins
        // starting with * are always merged, those starting with + are
        // merged when similar and close together in time.
        if (opId == hist.lastSelOp ||
            (origin && hist.lastSelOrigin == origin &&
                (hist.lastModTime == hist.lastSelTime && hist.lastOrigin == origin ||
                    selectionEventCanBeMerged(doc, origin, lst(hist.done), sel))))
        { hist.done[hist.done.length - 1] = sel; }
        else
        { pushSelectionToHistory(sel, hist.done); }

        hist.lastSelTime = +new Date;
        hist.lastSelOrigin = origin;
        hist.lastSelOp = opId;
        if (options && options.clearRedo !== false)
        { clearSelectionEvents(hist.undone); }
    }

    function pushSelectionToHistory(sel, dest) {
        var top = lst(dest);
        if (!(top && top.ranges && top.equals(sel)))
        { dest.push(sel); }
    }

    // Used to store marked span information in the history.
    function attachLocalSpans(doc, change, from, to) {
        var existing = change["spans_" + doc.id], n = 0;
        doc.iter(Math.max(doc.first, from), Math.min(doc.first + doc.size, to), function (line) {
            if (line.markedSpans)
            { (existing || (existing = change["spans_" + doc.id] = {}))[n] = line.markedSpans; }
            ++n;
        });
    }

    // When un/re-doing restores text containing marked spans, those
    // that have been explicitly cleared should not be restored.
    function removeClearedSpans(spans) {
        if (!spans) { return null }
        var out;
        for (var i = 0; i < spans.length; ++i) {
            if (spans[i].marker.explicitlyCleared) { if (!out) { out = spans.slice(0, i); } }
            else if (out) { out.push(spans[i]); }
        }
        return !out ? spans : out.length ? out : null
    }

    // Retrieve and filter the old marked spans stored in a change event.
    function getOldSpans(doc, change) {
        var found = change["spans_" + doc.id];
        if (!found) { return null }
        var nw = [];
        for (var i = 0; i < change.text.length; ++i)
        { nw.push(removeClearedSpans(found[i])); }
        return nw
    }

    // Used for un/re-doing changes from the history. Combines the
    // result of computing the existing spans with the set of spans that
    // existed in the history (so that deleting around a span and then
    // undoing brings back the span).
    function mergeOldSpans(doc, change) {
        var old = getOldSpans(doc, change);
        var stretched = stretchSpansOverChange(doc, change);
        if (!old) { return stretched }
        if (!stretched) { return old }

        for (var i = 0; i < old.length; ++i) {
            var oldCur = old[i], stretchCur = stretched[i];
            if (oldCur && stretchCur) {
                spans: for (var j = 0; j < stretchCur.length; ++j) {
                    var span = stretchCur[j];
                    for (var k = 0; k < oldCur.length; ++k)
                    { if (oldCur[k].marker == span.marker) { continue spans } }
                    oldCur.push(span);
                }
            } else if (stretchCur) {
                old[i] = stretchCur;
            }
        }
        return old
    }

    // Used both to provide a JSON-safe object in .getHistory, and, when
    // detaching a document, to split the history in two
    function copyHistoryArray(events, newGroup, instantiateSel) {
        var copy = [];
        for (var i = 0; i < events.length; ++i) {
            var event = events[i];
            if (event.ranges) {
                copy.push(instantiateSel ? Selection.prototype.deepCopy.call(event) : event);
                continue
            }
            var changes = event.changes, newChanges = [];
            copy.push({changes: newChanges});
            for (var j = 0; j < changes.length; ++j) {
                var change = changes[j], m = (void 0);
                newChanges.push({from: change.from, to: change.to, text: change.text});
                if (newGroup) { for (var prop in change) { if (m = prop.match(/^spans_(\d+)$/)) {
                    if (indexOf(newGroup, Number(m[1])) > -1) {
                        lst(newChanges)[prop] = change[prop];
                        delete change[prop];
                    }
                } } }
            }
        }
        return copy
    }

    // The 'scroll' parameter given to many of these indicated whether
    // the new cursor position should be scrolled into view after
    // modifying the selection.

    // If shift is held or the extend flag is set, extends a range to
    // include a given position (and optionally a second position).
    // Otherwise, simply returns the range between the given positions.
    // Used for cursor motion and such.
    function extendRange(range, head, other, extend) {
        if (extend) {
            var anchor = range.anchor;
            if (other) {
                var posBefore = cmp(head, anchor) < 0;
                if (posBefore != (cmp(other, anchor) < 0)) {
                    anchor = head;
                    head = other;
                } else if (posBefore != (cmp(head, other) < 0)) {
                    head = other;
                }
            }
            return new Range(anchor, head)
        } else {
            return new Range(other || head, head)
        }
    }

    // Extend the primary selection range, discard the rest.
    function extendSelection(doc, head, other, options, extend) {
        if (extend == null) { extend = doc.cm && (doc.cm.display.shift || doc.extend); }
        setSelection(doc, new Selection([extendRange(doc.sel.primary(), head, other, extend)], 0), options);
    }

    // Extend all selections (pos is an array of selections with length
    // equal the number of selections)
    function extendSelections(doc, heads, options) {
        var out = [];
        var extend = doc.cm && (doc.cm.display.shift || doc.extend);
        for (var i = 0; i < doc.sel.ranges.length; i++)
        { out[i] = extendRange(doc.sel.ranges[i], heads[i], null, extend); }
        var newSel = normalizeSelection(doc.cm, out, doc.sel.primIndex);
        setSelection(doc, newSel, options);
    }

    // Updates a single range in the selection.
    function replaceOneSelection(doc, i, range, options) {
        var ranges = doc.sel.ranges.slice(0);
        ranges[i] = range;
        setSelection(doc, normalizeSelection(doc.cm, ranges, doc.sel.primIndex), options);
    }

    // Reset the selection to a single range.
    function setSimpleSelection(doc, anchor, head, options) {
        setSelection(doc, simpleSelection(anchor, head), options);
    }

    // Give beforeSelectionChange handlers a change to influence a
    // selection update.
    function filterSelectionChange(doc, sel, options) {
        var obj = {
            ranges: sel.ranges,
            update: function(ranges) {
                this.ranges = [];
                for (var i = 0; i < ranges.length; i++)
                { this.ranges[i] = new Range(clipPos(doc, ranges[i].anchor),
                    clipPos(doc, ranges[i].head)); }
            },
            origin: options && options.origin
        };
        signal(doc, "beforeSelectionChange", doc, obj);
        if (doc.cm) { signal(doc.cm, "beforeSelectionChange", doc.cm, obj); }
        if (obj.ranges != sel.ranges) { return normalizeSelection(doc.cm, obj.ranges, obj.ranges.length - 1) }
        else { return sel }
    }

    function setSelectionReplaceHistory(doc, sel, options) {
        var done = doc.history.done, last = lst(done);
        if (last && last.ranges) {
            done[done.length - 1] = sel;
            setSelectionNoUndo(doc, sel, options);
        } else {
            setSelection(doc, sel, options);
        }
    }

    // Set a new selection.
    function setSelection(doc, sel, options) {
        setSelectionNoUndo(doc, sel, options);
        addSelectionToHistory(doc, doc.sel, doc.cm ? doc.cm.curOp.id : NaN, options);
    }

    function setSelectionNoUndo(doc, sel, options) {
        if (hasHandler(doc, "beforeSelectionChange") || doc.cm && hasHandler(doc.cm, "beforeSelectionChange"))
        { sel = filterSelectionChange(doc, sel, options); }

        var bias = options && options.bias ||
            (cmp(sel.primary().head, doc.sel.primary().head) < 0 ? -1 : 1);
        setSelectionInner(doc, skipAtomicInSelection(doc, sel, bias, true));

        if (!(options && options.scroll === false) && doc.cm && doc.cm.getOption("readOnly") != "nocursor")
        { ensureCursorVisible(doc.cm); }
    }

    function setSelectionInner(doc, sel) {
        if (sel.equals(doc.sel)) { return }

        doc.sel = sel;

        if (doc.cm) {
            doc.cm.curOp.updateInput = 1;
            doc.cm.curOp.selectionChanged = true;
            signalCursorActivity(doc.cm);
        }
        signalLater(doc, "cursorActivity", doc);
    }

    // Verify that the selection does not partially select any atomic
    // marked ranges.
    function reCheckSelection(doc) {
        setSelectionInner(doc, skipAtomicInSelection(doc, doc.sel, null, false));
    }

    // Return a selection that does not partially select any atomic
    // ranges.
    function skipAtomicInSelection(doc, sel, bias, mayClear) {
        var out;
        for (var i = 0; i < sel.ranges.length; i++) {
            var range = sel.ranges[i];
            var old = sel.ranges.length == doc.sel.ranges.length && doc.sel.ranges[i];
            var newAnchor = skipAtomic(doc, range.anchor, old && old.anchor, bias, mayClear);
            var newHead = skipAtomic(doc, range.head, old && old.head, bias, mayClear);
            if (out || newAnchor != range.anchor || newHead != range.head) {
                if (!out) { out = sel.ranges.slice(0, i); }
                out[i] = new Range(newAnchor, newHead);
            }
        }
        return out ? normalizeSelection(doc.cm, out, sel.primIndex) : sel
    }

    function skipAtomicInner(doc, pos, oldPos, dir, mayClear) {
        var line = getLine(doc, pos.line);
        if (line.markedSpans) { for (var i = 0; i < line.markedSpans.length; ++i) {
            var sp = line.markedSpans[i], m = sp.marker;

            // Determine if we should prevent the cursor being placed to the left/right of an atomic marker
            // Historically this was determined using the inclusiveLeft/Right option, but the new way to control it
            // is with selectLeft/Right
            var preventCursorLeft = ("selectLeft" in m) ? !m.selectLeft : m.inclusiveLeft;
            var preventCursorRight = ("selectRight" in m) ? !m.selectRight : m.inclusiveRight;

            if ((sp.from == null || (preventCursorLeft ? sp.from <= pos.ch : sp.from < pos.ch)) &&
                (sp.to == null || (preventCursorRight ? sp.to >= pos.ch : sp.to > pos.ch))) {
                if (mayClear) {
                    signal(m, "beforeCursorEnter");
                    if (m.explicitlyCleared) {
                        if (!line.markedSpans) { break }
                        else {--i; continue}
                    }
                }
                if (!m.atomic) { continue }

                if (oldPos) {
                    var near = m.find(dir < 0 ? 1 : -1), diff = (void 0);
                    if (dir < 0 ? preventCursorRight : preventCursorLeft)
                    { near = movePos(doc, near, -dir, near && near.line == pos.line ? line : null); }
                    if (near && near.line == pos.line && (diff = cmp(near, oldPos)) && (dir < 0 ? diff < 0 : diff > 0))
                    { return skipAtomicInner(doc, near, pos, dir, mayClear) }
                }

                var far = m.find(dir < 0 ? -1 : 1);
                if (dir < 0 ? preventCursorLeft : preventCursorRight)
                { far = movePos(doc, far, dir, far.line == pos.line ? line : null); }
                return far ? skipAtomicInner(doc, far, pos, dir, mayClear) : null
            }
        } }
        return pos
    }

    // Ensure a given position is not inside an atomic range.
    function skipAtomic(doc, pos, oldPos, bias, mayClear) {
        var dir = bias || 1;
        var found = skipAtomicInner(doc, pos, oldPos, dir, mayClear) ||
            (!mayClear && skipAtomicInner(doc, pos, oldPos, dir, true)) ||
            skipAtomicInner(doc, pos, oldPos, -dir, mayClear) ||
            (!mayClear && skipAtomicInner(doc, pos, oldPos, -dir, true));
        if (!found) {
            doc.cantEdit = true;
            return Pos(doc.first, 0)
        }
        return found
    }

    function movePos(doc, pos, dir, line) {
        if (dir < 0 && pos.ch == 0) {
            if (pos.line > doc.first) { return clipPos(doc, Pos(pos.line - 1)) }
            else { return null }
        } else if (dir > 0 && pos.ch == (line || getLine(doc, pos.line)).text.length) {
            if (pos.line < doc.first + doc.size - 1) { return Pos(pos.line + 1, 0) }
            else { return null }
        } else {
            return new Pos(pos.line, pos.ch + dir)
        }
    }

    function selectAll(cm) {
        cm.setSelection(Pos(cm.firstLine(), 0), Pos(cm.lastLine()), sel_dontScroll);
    }

    // UPDATING

    // Allow "beforeChange" event handlers to influence a change
    function filterChange(doc, change, update) {
        var obj = {
            canceled: false,
            from: change.from,
            to: change.to,
            text: change.text,
            origin: change.origin,
            cancel: function () { return obj.canceled = true; }
        };
        if (update) { obj.update = function (from, to, text, origin) {
            if (from) { obj.from = clipPos(doc, from); }
            if (to) { obj.to = clipPos(doc, to); }
            if (text) { obj.text = text; }
            if (origin !== undefined) { obj.origin = origin; }
        }; }
        signal(doc, "beforeChange", doc, obj);
        if (doc.cm) { signal(doc.cm, "beforeChange", doc.cm, obj); }

        if (obj.canceled) {
            if (doc.cm) { doc.cm.curOp.updateInput = 2; }
            return null
        }
        return {from: obj.from, to: obj.to, text: obj.text, origin: obj.origin}
    }

    // Apply a change to a document, and add it to the document's
    // history, and propagating it to all linked documents.
    function makeChange(doc, change, ignoreReadOnly) {
        if (doc.cm) {
            if (!doc.cm.curOp) { return operation(doc.cm, makeChange)(doc, change, ignoreReadOnly) }
            if (doc.cm.state.suppressEdits) { return }
        }

        if (hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange")) {
            change = filterChange(doc, change, true);
            if (!change) { return }
        }

        // Possibly split or suppress the update based on the presence
        // of read-only spans in its range.
        var split = sawReadOnlySpans && !ignoreReadOnly && removeReadOnlyRanges(doc, change.from, change.to);
        if (split) {
            for (var i = split.length - 1; i >= 0; --i)
            { makeChangeInner(doc, {from: split[i].from, to: split[i].to, text: i ? [""] : change.text, origin: change.origin}); }
        } else {
            makeChangeInner(doc, change);
        }
    }

    function makeChangeInner(doc, change) {
        if (change.text.length == 1 && change.text[0] == "" && cmp(change.from, change.to) == 0) { return }
        var selAfter = computeSelAfterChange(doc, change);
        addChangeToHistory(doc, change, selAfter, doc.cm ? doc.cm.curOp.id : NaN);

        makeChangeSingleDoc(doc, change, selAfter, stretchSpansOverChange(doc, change));
        var rebased = [];

        linkedDocs(doc, function (doc, sharedHist) {
            if (!sharedHist && indexOf(rebased, doc.history) == -1) {
                rebaseHist(doc.history, change);
                rebased.push(doc.history);
            }
            makeChangeSingleDoc(doc, change, null, stretchSpansOverChange(doc, change));
        });
    }

    // Revert a change stored in a document's history.
    function makeChangeFromHistory(doc, type, allowSelectionOnly) {
        var suppress = doc.cm && doc.cm.state.suppressEdits;
        if (suppress && !allowSelectionOnly) { return }

        var hist = doc.history, event, selAfter = doc.sel;
        var source = type == "undo" ? hist.done : hist.undone, dest = type == "undo" ? hist.undone : hist.done;

        // Verify that there is a useable event (so that ctrl-z won't
        // needlessly clear selection events)
        var i = 0;
        for (; i < source.length; i++) {
            event = source[i];
            if (allowSelectionOnly ? event.ranges && !event.equals(doc.sel) : !event.ranges)
            { break }
        }
        if (i == source.length) { return }
        hist.lastOrigin = hist.lastSelOrigin = null;

        for (;;) {
            event = source.pop();
            if (event.ranges) {
                pushSelectionToHistory(event, dest);
                if (allowSelectionOnly && !event.equals(doc.sel)) {
                    setSelection(doc, event, {clearRedo: false});
                    return
                }
                selAfter = event;
            } else if (suppress) {
                source.push(event);
                return
            } else { break }
        }

        // Build up a reverse change object to add to the opposite history
        // stack (redo when undoing, and vice versa).
        var antiChanges = [];
        pushSelectionToHistory(selAfter, dest);
        dest.push({changes: antiChanges, generation: hist.generation});
        hist.generation = event.generation || ++hist.maxGeneration;

        var filter = hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange");

        var loop = function ( i ) {
            var change = event.changes[i];
            change.origin = type;
            if (filter && !filterChange(doc, change, false)) {
                source.length = 0;
                return {}
            }

            antiChanges.push(historyChangeFromChange(doc, change));

            var after = i ? computeSelAfterChange(doc, change) : lst(source);
            makeChangeSingleDoc(doc, change, after, mergeOldSpans(doc, change));
            if (!i && doc.cm) { doc.cm.scrollIntoView({from: change.from, to: changeEnd(change)}); }
            var rebased = [];

            // Propagate to the linked documents
            linkedDocs(doc, function (doc, sharedHist) {
                if (!sharedHist && indexOf(rebased, doc.history) == -1) {
                    rebaseHist(doc.history, change);
                    rebased.push(doc.history);
                }
                makeChangeSingleDoc(doc, change, null, mergeOldSpans(doc, change));
            });
        };

        for (var i$1 = event.changes.length - 1; i$1 >= 0; --i$1) {
            var returned = loop( i$1 );

            if ( returned ) return returned.v;
        }
    }

    // Sub-views need their line numbers shifted when text is added
    // above or below them in the parent document.
    function shiftDoc(doc, distance) {
        if (distance == 0) { return }
        doc.first += distance;
        doc.sel = new Selection(map(doc.sel.ranges, function (range) { return new Range(
            Pos(range.anchor.line + distance, range.anchor.ch),
            Pos(range.head.line + distance, range.head.ch)
        ); }), doc.sel.primIndex);
        if (doc.cm) {
            regChange(doc.cm, doc.first, doc.first - distance, distance);
            for (var d = doc.cm.display, l = d.viewFrom; l < d.viewTo; l++)
            { regLineChange(doc.cm, l, "gutter"); }
        }
    }

    // More lower-level change function, handling only a single document
    // (not linked ones).
    function makeChangeSingleDoc(doc, change, selAfter, spans) {
        if (doc.cm && !doc.cm.curOp)
        { return operation(doc.cm, makeChangeSingleDoc)(doc, change, selAfter, spans) }

        if (change.to.line < doc.first) {
            shiftDoc(doc, change.text.length - 1 - (change.to.line - change.from.line));
            return
        }
        if (change.from.line > doc.lastLine()) { return }

        // Clip the change to the size of this doc
        if (change.from.line < doc.first) {
            var shift = change.text.length - 1 - (doc.first - change.from.line);
            shiftDoc(doc, shift);
            change = {from: Pos(doc.first, 0), to: Pos(change.to.line + shift, change.to.ch),
                text: [lst(change.text)], origin: change.origin};
        }
        var last = doc.lastLine();
        if (change.to.line > last) {
            change = {from: change.from, to: Pos(last, getLine(doc, last).text.length),
                text: [change.text[0]], origin: change.origin};
        }

        change.removed = getBetween(doc, change.from, change.to);

        if (!selAfter) { selAfter = computeSelAfterChange(doc, change); }
        if (doc.cm) { makeChangeSingleDocInEditor(doc.cm, change, spans); }
        else { updateDoc(doc, change, spans); }
        setSelectionNoUndo(doc, selAfter, sel_dontScroll);

        if (doc.cantEdit && skipAtomic(doc, Pos(doc.firstLine(), 0)))
        { doc.cantEdit = false; }
    }

    // Handle the interaction of a change to a document with the editor
    // that this document is part of.
    function makeChangeSingleDocInEditor(cm, change, spans) {
        var doc = cm.doc, display = cm.display, from = change.from, to = change.to;

        var recomputeMaxLength = false, checkWidthStart = from.line;
        if (!cm.options.lineWrapping) {
            checkWidthStart = lineNo(visualLine(getLine(doc, from.line)));
            doc.iter(checkWidthStart, to.line + 1, function (line) {
                if (line == display.maxLine) {
                    recomputeMaxLength = true;
                    return true
                }
            });
        }

        if (doc.sel.contains(change.from, change.to) > -1)
        { signalCursorActivity(cm); }

        updateDoc(doc, change, spans, estimateHeight(cm));

        if (!cm.options.lineWrapping) {
            doc.iter(checkWidthStart, from.line + change.text.length, function (line) {
                var len = lineLength(line);
                if (len > display.maxLineLength) {
                    display.maxLine = line;
                    display.maxLineLength = len;
                    display.maxLineChanged = true;
                    recomputeMaxLength = false;
                }
            });
            if (recomputeMaxLength) { cm.curOp.updateMaxLine = true; }
        }

        retreatFrontier(doc, from.line);
        startWorker(cm, 400);

        var lendiff = change.text.length - (to.line - from.line) - 1;
        // Remember that these lines changed, for updating the display
        if (change.full)
        { regChange(cm); }
        else if (from.line == to.line && change.text.length == 1 && !isWholeLineUpdate(cm.doc, change))
        { regLineChange(cm, from.line, "text"); }
        else
        { regChange(cm, from.line, to.line + 1, lendiff); }

        var changesHandler = hasHandler(cm, "changes"), changeHandler = hasHandler(cm, "change");
        if (changeHandler || changesHandler) {
            var obj = {
                from: from, to: to,
                text: change.text,
                removed: change.removed,
                origin: change.origin
            };
            if (changeHandler) { signalLater(cm, "change", cm, obj); }
            if (changesHandler) { (cm.curOp.changeObjs || (cm.curOp.changeObjs = [])).push(obj); }
        }
        cm.display.selForContextMenu = null;
    }

    function replaceRange(doc, code, from, to, origin) {
        var assign;

        if (!to) { to = from; }
        if (cmp(to, from) < 0) { (assign = [to, from], from = assign[0], to = assign[1]); }
        if (typeof code == "string") { code = doc.splitLines(code); }
        makeChange(doc, {from: from, to: to, text: code, origin: origin});
    }

    // Rebasing/resetting history to deal with externally-sourced changes

    function rebaseHistSelSingle(pos, from, to, diff) {
        if (to < pos.line) {
            pos.line += diff;
        } else if (from < pos.line) {
            pos.line = from;
            pos.ch = 0;
        }
    }

    // Tries to rebase an array of history events given a change in the
    // document. If the change touches the same lines as the event, the
    // event, and everything 'behind' it, is discarded. If the change is
    // before the event, the event's positions are updated. Uses a
    // copy-on-write scheme for the positions, to avoid having to
    // reallocate them all on every rebase, but also avoid problems with
    // shared position objects being unsafely updated.
    function rebaseHistArray(array, from, to, diff) {
        for (var i = 0; i < array.length; ++i) {
            var sub = array[i], ok = true;
            if (sub.ranges) {
                if (!sub.copied) { sub = array[i] = sub.deepCopy(); sub.copied = true; }
                for (var j = 0; j < sub.ranges.length; j++) {
                    rebaseHistSelSingle(sub.ranges[j].anchor, from, to, diff);
                    rebaseHistSelSingle(sub.ranges[j].head, from, to, diff);
                }
                continue
            }
            for (var j$1 = 0; j$1 < sub.changes.length; ++j$1) {
                var cur = sub.changes[j$1];
                if (to < cur.from.line) {
                    cur.from = Pos(cur.from.line + diff, cur.from.ch);
                    cur.to = Pos(cur.to.line + diff, cur.to.ch);
                } else if (from <= cur.to.line) {
                    ok = false;
                    break
                }
            }
            if (!ok) {
                array.splice(0, i + 1);
                i = 0;
            }
        }
    }

    function rebaseHist(hist, change) {
        var from = change.from.line, to = change.to.line, diff = change.text.length - (to - from) - 1;
        rebaseHistArray(hist.done, from, to, diff);
        rebaseHistArray(hist.undone, from, to, diff);
    }

    // Utility for applying a change to a line by handle or number,
    // returning the number and optionally registering the line as
    // changed.
    function changeLine(doc, handle, changeType, op) {
        var no = handle, line = handle;
        if (typeof handle == "number") { line = getLine(doc, clipLine(doc, handle)); }
        else { no = lineNo(handle); }
        if (no == null) { return null }
        if (op(line, no) && doc.cm) { regLineChange(doc.cm, no, changeType); }
        return line
    }

    // The document is represented as a BTree consisting of leaves, with
    // chunk of lines in them, and branches, with up to ten leaves or
    // other branch nodes below them. The top node is always a branch
    // node, and is the document object itself (meaning it has
    // additional methods and properties).
    //
    // All nodes have parent links. The tree is used both to go from
    // line numbers to line objects, and to go from objects to numbers.
    // It also indexes by height, and is used to convert between height
    // and line object, and to find the total height of the document.
    //
    // See also http://marijnhaverbeke.nl/blog/codemirror-line-tree.html

    function LeafChunk(lines) {
        this.lines = lines;
        this.parent = null;
        var height = 0;
        for (var i = 0; i < lines.length; ++i) {
            lines[i].parent = this;
            height += lines[i].height;
        }
        this.height = height;
    }

    LeafChunk.prototype = {
        chunkSize: function() { return this.lines.length },

        // Remove the n lines at offset 'at'.
        removeInner: function(at, n) {
            for (var i = at, e = at + n; i < e; ++i) {
                var line = this.lines[i];
                this.height -= line.height;
                cleanUpLine(line);
                signalLater(line, "delete");
            }
            this.lines.splice(at, n);
        },

        // Helper used to collapse a small branch into a single leaf.
        collapse: function(lines) {
            lines.push.apply(lines, this.lines);
        },

        // Insert the given array of lines at offset 'at', count them as
        // having the given height.
        insertInner: function(at, lines, height) {
            this.height += height;
            this.lines = this.lines.slice(0, at).concat(lines).concat(this.lines.slice(at));
            for (var i = 0; i < lines.length; ++i) { lines[i].parent = this; }
        },

        // Used to iterate over a part of the tree.
        iterN: function(at, n, op) {
            for (var e = at + n; at < e; ++at)
            { if (op(this.lines[at])) { return true } }
        }
    };

    function BranchChunk(children) {
        this.children = children;
        var size = 0, height = 0;
        for (var i = 0; i < children.length; ++i) {
            var ch = children[i];
            size += ch.chunkSize(); height += ch.height;
            ch.parent = this;
        }
        this.size = size;
        this.height = height;
        this.parent = null;
    }

    BranchChunk.prototype = {
        chunkSize: function() { return this.size },

        removeInner: function(at, n) {
            this.size -= n;
            for (var i = 0; i < this.children.length; ++i) {
                var child = this.children[i], sz = child.chunkSize();
                if (at < sz) {
                    var rm = Math.min(n, sz - at), oldHeight = child.height;
                    child.removeInner(at, rm);
                    this.height -= oldHeight - child.height;
                    if (sz == rm) { this.children.splice(i--, 1); child.parent = null; }
                    if ((n -= rm) == 0) { break }
                    at = 0;
                } else { at -= sz; }
            }
            // If the result is smaller than 25 lines, ensure that it is a
            // single leaf node.
            if (this.size - n < 25 &&
                (this.children.length > 1 || !(this.children[0] instanceof LeafChunk))) {
                var lines = [];
                this.collapse(lines);
                this.children = [new LeafChunk(lines)];
                this.children[0].parent = this;
            }
        },

        collapse: function(lines) {
            for (var i = 0; i < this.children.length; ++i) { this.children[i].collapse(lines); }
        },

        insertInner: function(at, lines, height) {
            this.size += lines.length;
            this.height += height;
            for (var i = 0; i < this.children.length; ++i) {
                var child = this.children[i], sz = child.chunkSize();
                if (at <= sz) {
                    child.insertInner(at, lines, height);
                    if (child.lines && child.lines.length > 50) {
                        // To avoid memory thrashing when child.lines is huge (e.g. first view of a large file), it's never spliced.
                        // Instead, small slices are taken. They're taken in order because sequential memory accesses are fastest.
                        var remaining = child.lines.length % 25 + 25;
                        for (var pos = remaining; pos < child.lines.length;) {
                            var leaf = new LeafChunk(child.lines.slice(pos, pos += 25));
                            child.height -= leaf.height;
                            this.children.splice(++i, 0, leaf);
                            leaf.parent = this;
                        }
                        child.lines = child.lines.slice(0, remaining);
                        this.maybeSpill();
                    }
                    break
                }
                at -= sz;
            }
        },

        // When a node has grown, check whether it should be split.
        maybeSpill: function() {
            if (this.children.length <= 10) { return }
            var me = this;
            do {
                var spilled = me.children.splice(me.children.length - 5, 5);
                var sibling = new BranchChunk(spilled);
                if (!me.parent) { // Become the parent node
                    var copy = new BranchChunk(me.children);
                    copy.parent = me;
                    me.children = [copy, sibling];
                    me = copy;
                } else {
                    me.size -= sibling.size;
                    me.height -= sibling.height;
                    var myIndex = indexOf(me.parent.children, me);
                    me.parent.children.splice(myIndex + 1, 0, sibling);
                }
                sibling.parent = me.parent;
            } while (me.children.length > 10)
            me.parent.maybeSpill();
        },

        iterN: function(at, n, op) {
            for (var i = 0; i < this.children.length; ++i) {
                var child = this.children[i], sz = child.chunkSize();
                if (at < sz) {
                    var used = Math.min(n, sz - at);
                    if (child.iterN(at, used, op)) { return true }
                    if ((n -= used) == 0) { break }
                    at = 0;
                } else { at -= sz; }
            }
        }
    };

    // Line widgets are block elements displayed above or below a line.

    var LineWidget = function(doc, node, options) {
        if (options) { for (var opt in options) { if (options.hasOwnProperty(opt))
        { this[opt] = options[opt]; } } }
        this.doc = doc;
        this.node = node;
    };

    LineWidget.prototype.clear = function () {
        var cm = this.doc.cm, ws = this.line.widgets, line = this.line, no = lineNo(line);
        if (no == null || !ws) { return }
        for (var i = 0; i < ws.length; ++i) { if (ws[i] == this) { ws.splice(i--, 1); } }
        if (!ws.length) { line.widgets = null; }
        var height = widgetHeight(this);
        updateLineHeight(line, Math.max(0, line.height - height));
        if (cm) {
            runInOp(cm, function () {
                adjustScrollWhenAboveVisible(cm, line, -height);
                regLineChange(cm, no, "widget");
            });
            signalLater(cm, "lineWidgetCleared", cm, this, no);
        }
    };

    LineWidget.prototype.changed = function () {
        var this$1 = this;

        var oldH = this.height, cm = this.doc.cm, line = this.line;
        this.height = null;
        var diff = widgetHeight(this) - oldH;
        if (!diff) { return }
        if (!lineIsHidden(this.doc, line)) { updateLineHeight(line, line.height + diff); }
        if (cm) {
            runInOp(cm, function () {
                cm.curOp.forceUpdate = true;
                adjustScrollWhenAboveVisible(cm, line, diff);
                signalLater(cm, "lineWidgetChanged", cm, this$1, lineNo(line));
            });
        }
    };
    eventMixin(LineWidget);

    function adjustScrollWhenAboveVisible(cm, line, diff) {
        if (heightAtLine(line) < ((cm.curOp && cm.curOp.scrollTop) || cm.doc.scrollTop))
        { addToScrollTop(cm, diff); }
    }

    function addLineWidget(doc, handle, node, options) {
        var widget = new LineWidget(doc, node, options);
        var cm = doc.cm;
        if (cm && widget.noHScroll) { cm.display.alignWidgets = true; }
        changeLine(doc, handle, "widget", function (line) {
            var widgets = line.widgets || (line.widgets = []);
            if (widget.insertAt == null) { widgets.push(widget); }
            else { widgets.splice(Math.min(widgets.length, Math.max(0, widget.insertAt)), 0, widget); }
            widget.line = line;
            if (cm && !lineIsHidden(doc, line)) {
                var aboveVisible = heightAtLine(line) < doc.scrollTop;
                updateLineHeight(line, line.height + widgetHeight(widget));
                if (aboveVisible) { addToScrollTop(cm, widget.height); }
                cm.curOp.forceUpdate = true;
            }
            return true
        });
        if (cm) { signalLater(cm, "lineWidgetAdded", cm, widget, typeof handle == "number" ? handle : lineNo(handle)); }
        return widget
    }

    // TEXTMARKERS

    // Created with markText and setBookmark methods. A TextMarker is a
    // handle that can be used to clear or find a marked position in the
    // document. Line objects hold arrays (markedSpans) containing
    // {from, to, marker} object pointing to such marker objects, and
    // indicating that such a marker is present on that line. Multiple
    // lines may point to the same marker when it spans across lines.
    // The spans will have null for their from/to properties when the
    // marker continues beyond the start/end of the line. Markers have
    // links back to the lines they currently touch.

    // Collapsed markers have unique ids, in order to be able to order
    // them, which is needed for uniquely determining an outer marker
    // when they overlap (they may nest, but not partially overlap).
    var nextMarkerId = 0;

    var TextMarker = function(doc, type) {
        this.lines = [];
        this.type = type;
        this.doc = doc;
        this.id = ++nextMarkerId;
    };

    // Clear the marker.
    TextMarker.prototype.clear = function () {
        if (this.explicitlyCleared) { return }
        var cm = this.doc.cm, withOp = cm && !cm.curOp;
        if (withOp) { startOperation(cm); }
        if (hasHandler(this, "clear")) {
            var found = this.find();
            if (found) { signalLater(this, "clear", found.from, found.to); }
        }
        var min = null, max = null;
        for (var i = 0; i < this.lines.length; ++i) {
            var line = this.lines[i];
            var span = getMarkedSpanFor(line.markedSpans, this);
            if (cm && !this.collapsed) { regLineChange(cm, lineNo(line), "text"); }
            else if (cm) {
                if (span.to != null) { max = lineNo(line); }
                if (span.from != null) { min = lineNo(line); }
            }
            line.markedSpans = removeMarkedSpan(line.markedSpans, span);
            if (span.from == null && this.collapsed && !lineIsHidden(this.doc, line) && cm)
            { updateLineHeight(line, textHeight(cm.display)); }
        }
        if (cm && this.collapsed && !cm.options.lineWrapping) { for (var i$1 = 0; i$1 < this.lines.length; ++i$1) {
            var visual = visualLine(this.lines[i$1]), len = lineLength(visual);
            if (len > cm.display.maxLineLength) {
                cm.display.maxLine = visual;
                cm.display.maxLineLength = len;
                cm.display.maxLineChanged = true;
            }
        } }

        if (min != null && cm && this.collapsed) { regChange(cm, min, max + 1); }
        this.lines.length = 0;
        this.explicitlyCleared = true;
        if (this.atomic && this.doc.cantEdit) {
            this.doc.cantEdit = false;
            if (cm) { reCheckSelection(cm.doc); }
        }
        if (cm) { signalLater(cm, "markerCleared", cm, this, min, max); }
        if (withOp) { endOperation(cm); }
        if (this.parent) { this.parent.clear(); }
    };

    // Find the position of the marker in the document. Returns a {from,
    // to} object by default. Side can be passed to get a specific side
    // -- 0 (both), -1 (left), or 1 (right). When lineObj is true, the
    // Pos objects returned contain a line object, rather than a line
    // number (used to prevent looking up the same line twice).
    TextMarker.prototype.find = function (side, lineObj) {
        if (side == null && this.type == "bookmark") { side = 1; }
        var from, to;
        for (var i = 0; i < this.lines.length; ++i) {
            var line = this.lines[i];
            var span = getMarkedSpanFor(line.markedSpans, this);
            if (span.from != null) {
                from = Pos(lineObj ? line : lineNo(line), span.from);
                if (side == -1) { return from }
            }
            if (span.to != null) {
                to = Pos(lineObj ? line : lineNo(line), span.to);
                if (side == 1) { return to }
            }
        }
        return from && {from: from, to: to}
    };

    // Signals that the marker's widget changed, and surrounding layout
    // should be recomputed.
    TextMarker.prototype.changed = function () {
        var this$1 = this;

        var pos = this.find(-1, true), widget = this, cm = this.doc.cm;
        if (!pos || !cm) { return }
        runInOp(cm, function () {
            var line = pos.line, lineN = lineNo(pos.line);
            var view = findViewForLine(cm, lineN);
            if (view) {
                clearLineMeasurementCacheFor(view);
                cm.curOp.selectionChanged = cm.curOp.forceUpdate = true;
            }
            cm.curOp.updateMaxLine = true;
            if (!lineIsHidden(widget.doc, line) && widget.height != null) {
                var oldHeight = widget.height;
                widget.height = null;
                var dHeight = widgetHeight(widget) - oldHeight;
                if (dHeight)
                { updateLineHeight(line, line.height + dHeight); }
            }
            signalLater(cm, "markerChanged", cm, this$1);
        });
    };

    TextMarker.prototype.attachLine = function (line) {
        if (!this.lines.length && this.doc.cm) {
            var op = this.doc.cm.curOp;
            if (!op.maybeHiddenMarkers || indexOf(op.maybeHiddenMarkers, this) == -1)
            { (op.maybeUnhiddenMarkers || (op.maybeUnhiddenMarkers = [])).push(this); }
        }
        this.lines.push(line);
    };

    TextMarker.prototype.detachLine = function (line) {
        this.lines.splice(indexOf(this.lines, line), 1);
        if (!this.lines.length && this.doc.cm) {
            var op = this.doc.cm.curOp
            ;(op.maybeHiddenMarkers || (op.maybeHiddenMarkers = [])).push(this);
        }
    };
    eventMixin(TextMarker);

    // Create a marker, wire it up to the right lines, and
    function markText(doc, from, to, options, type) {
        // Shared markers (across linked documents) are handled separately
        // (markTextShared will call out to this again, once per
        // document).
        if (options && options.shared) { return markTextShared(doc, from, to, options, type) }
        // Ensure we are in an operation.
        if (doc.cm && !doc.cm.curOp) { return operation(doc.cm, markText)(doc, from, to, options, type) }

        var marker = new TextMarker(doc, type), diff = cmp(from, to);
        if (options) { copyObj(options, marker, false); }
        // Don't connect empty markers unless clearWhenEmpty is false
        if (diff > 0 || diff == 0 && marker.clearWhenEmpty !== false)
        { return marker }
        if (marker.replacedWith) {
            // Showing up as a widget implies collapsed (widget replaces text)
            marker.collapsed = true;
            marker.widgetNode = eltP("span", [marker.replacedWith], "CodeMirror-widget");
            if (!options.handleMouseEvents) { marker.widgetNode.setAttribute("cm-ignore-events", "true"); }
            if (options.insertLeft) { marker.widgetNode.insertLeft = true; }
        }
        if (marker.collapsed) {
            if (conflictingCollapsedRange(doc, from.line, from, to, marker) ||
                from.line != to.line && conflictingCollapsedRange(doc, to.line, from, to, marker))
            { throw new Error("Inserting collapsed marker partially overlapping an existing one") }
            seeCollapsedSpans();
        }

        if (marker.addToHistory)
        { addChangeToHistory(doc, {from: from, to: to, origin: "markText"}, doc.sel, NaN); }

        var curLine = from.line, cm = doc.cm, updateMaxLine;
        doc.iter(curLine, to.line + 1, function (line) {
            if (cm && marker.collapsed && !cm.options.lineWrapping && visualLine(line) == cm.display.maxLine)
            { updateMaxLine = true; }
            if (marker.collapsed && curLine != from.line) { updateLineHeight(line, 0); }
            addMarkedSpan(line, new MarkedSpan(marker,
                curLine == from.line ? from.ch : null,
                curLine == to.line ? to.ch : null));
            ++curLine;
        });
        // lineIsHidden depends on the presence of the spans, so needs a second pass
        if (marker.collapsed) { doc.iter(from.line, to.line + 1, function (line) {
            if (lineIsHidden(doc, line)) { updateLineHeight(line, 0); }
        }); }

        if (marker.clearOnEnter) { on(marker, "beforeCursorEnter", function () { return marker.clear(); }); }

        if (marker.readOnly) {
            seeReadOnlySpans();
            if (doc.history.done.length || doc.history.undone.length)
            { doc.clearHistory(); }
        }
        if (marker.collapsed) {
            marker.id = ++nextMarkerId;
            marker.atomic = true;
        }
        if (cm) {
            // Sync editor state
            if (updateMaxLine) { cm.curOp.updateMaxLine = true; }
            if (marker.collapsed)
            { regChange(cm, from.line, to.line + 1); }
            else if (marker.className || marker.startStyle || marker.endStyle || marker.css ||
                marker.attributes || marker.title)
            { for (var i = from.line; i <= to.line; i++) { regLineChange(cm, i, "text"); } }
            if (marker.atomic) { reCheckSelection(cm.doc); }
            signalLater(cm, "markerAdded", cm, marker);
        }
        return marker
    }

    // SHARED TEXTMARKERS

    // A shared marker spans multiple linked documents. It is
    // implemented as a meta-marker-object controlling multiple normal
    // markers.
    var SharedTextMarker = function(markers, primary) {
        this.markers = markers;
        this.primary = primary;
        for (var i = 0; i < markers.length; ++i)
        { markers[i].parent = this; }
    };

    SharedTextMarker.prototype.clear = function () {
        if (this.explicitlyCleared) { return }
        this.explicitlyCleared = true;
        for (var i = 0; i < this.markers.length; ++i)
        { this.markers[i].clear(); }
        signalLater(this, "clear");
    };

    SharedTextMarker.prototype.find = function (side, lineObj) {
        return this.primary.find(side, lineObj)
    };
    eventMixin(SharedTextMarker);

    function markTextShared(doc, from, to, options, type) {
        options = copyObj(options);
        options.shared = false;
        var markers = [markText(doc, from, to, options, type)], primary = markers[0];
        var widget = options.widgetNode;
        linkedDocs(doc, function (doc) {
            if (widget) { options.widgetNode = widget.cloneNode(true); }
            markers.push(markText(doc, clipPos(doc, from), clipPos(doc, to), options, type));
            for (var i = 0; i < doc.linked.length; ++i)
            { if (doc.linked[i].isParent) { return } }
            primary = lst(markers);
        });
        return new SharedTextMarker(markers, primary)
    }

    function findSharedMarkers(doc) {
        return doc.findMarks(Pos(doc.first, 0), doc.clipPos(Pos(doc.lastLine())), function (m) { return m.parent; })
    }

    function copySharedMarkers(doc, markers) {
        for (var i = 0; i < markers.length; i++) {
            var marker = markers[i], pos = marker.find();
            var mFrom = doc.clipPos(pos.from), mTo = doc.clipPos(pos.to);
            if (cmp(mFrom, mTo)) {
                var subMark = markText(doc, mFrom, mTo, marker.primary, marker.primary.type);
                marker.markers.push(subMark);
                subMark.parent = marker;
            }
        }
    }

    function detachSharedMarkers(markers) {
        var loop = function ( i ) {
            var marker = markers[i], linked = [marker.primary.doc];
            linkedDocs(marker.primary.doc, function (d) { return linked.push(d); });
            for (var j = 0; j < marker.markers.length; j++) {
                var subMarker = marker.markers[j];
                if (indexOf(linked, subMarker.doc) == -1) {
                    subMarker.parent = null;
                    marker.markers.splice(j--, 1);
                }
            }
        };

        for (var i = 0; i < markers.length; i++) loop( i );
    }

    var nextDocId = 0;
    var Doc = function(text, mode, firstLine, lineSep, direction) {
        if (!(this instanceof Doc)) { return new Doc(text, mode, firstLine, lineSep, direction) }
        if (firstLine == null) { firstLine = 0; }

        BranchChunk.call(this, [new LeafChunk([new Line("", null)])]);
        this.first = firstLine;
        this.scrollTop = this.scrollLeft = 0;
        this.cantEdit = false;
        this.cleanGeneration = 1;
        this.modeFrontier = this.highlightFrontier = firstLine;
        var start = Pos(firstLine, 0);
        this.sel = simpleSelection(start);
        this.history = new History(null);
        this.id = ++nextDocId;
        this.modeOption = mode;
        this.lineSep = lineSep;
        this.direction = (direction == "rtl") ? "rtl" : "ltr";
        this.extend = false;

        if (typeof text == "string") { text = this.splitLines(text); }
        updateDoc(this, {from: start, to: start, text: text});
        setSelection(this, simpleSelection(start), sel_dontScroll);
    };

    Doc.prototype = createObj(BranchChunk.prototype, {
        constructor: Doc,
        // Iterate over the document. Supports two forms -- with only one
        // argument, it calls that for each line in the document. With
        // three, it iterates over the range given by the first two (with
        // the second being non-inclusive).
        iter: function(from, to, op) {
            if (op) { this.iterN(from - this.first, to - from, op); }
            else { this.iterN(this.first, this.first + this.size, from); }
        },

        // Non-public interface for adding and removing lines.
        insert: function(at, lines) {
            var height = 0;
            for (var i = 0; i < lines.length; ++i) { height += lines[i].height; }
            this.insertInner(at - this.first, lines, height);
        },
        remove: function(at, n) { this.removeInner(at - this.first, n); },

        // From here, the methods are part of the public interface. Most
        // are also available from CodeMirror (editor) instances.

        getValue: function(lineSep) {
            var lines = getLines(this, this.first, this.first + this.size);
            if (lineSep === false) { return lines }
            return lines.join(lineSep || this.lineSeparator())
        },
        setValue: docMethodOp(function(code) {
            var top = Pos(this.first, 0), last = this.first + this.size - 1;
            makeChange(this, {from: top, to: Pos(last, getLine(this, last).text.length),
                text: this.splitLines(code), origin: "setValue", full: true}, true);
            if (this.cm) { scrollToCoords(this.cm, 0, 0); }
            setSelection(this, simpleSelection(top), sel_dontScroll);
        }),
        replaceRange: function(code, from, to, origin) {
            from = clipPos(this, from);
            to = to ? clipPos(this, to) : from;
            replaceRange(this, code, from, to, origin);
        },
        getRange: function(from, to, lineSep) {
            var lines = getBetween(this, clipPos(this, from), clipPos(this, to));
            if (lineSep === false) { return lines }
            return lines.join(lineSep || this.lineSeparator())
        },

        getLine: function(line) {var l = this.getLineHandle(line); return l && l.text},

        getLineHandle: function(line) {if (isLine(this, line)) { return getLine(this, line) }},
        getLineNumber: function(line) {return lineNo(line)},

        getLineHandleVisualStart: function(line) {
            if (typeof line == "number") { line = getLine(this, line); }
            return visualLine(line)
        },

        lineCount: function() {return this.size},
        firstLine: function() {return this.first},
        lastLine: function() {return this.first + this.size - 1},

        clipPos: function(pos) {return clipPos(this, pos)},

        getCursor: function(start) {
            var range = this.sel.primary(), pos;
            if (start == null || start == "head") { pos = range.head; }
            else if (start == "anchor") { pos = range.anchor; }
            else if (start == "end" || start == "to" || start === false) { pos = range.to(); }
            else { pos = range.from(); }
            return pos
        },
        listSelections: function() { return this.sel.ranges },
        somethingSelected: function() {return this.sel.somethingSelected()},

        setCursor: docMethodOp(function(line, ch, options) {
            setSimpleSelection(this, clipPos(this, typeof line == "number" ? Pos(line, ch || 0) : line), null, options);
        }),
        setSelection: docMethodOp(function(anchor, head, options) {
            setSimpleSelection(this, clipPos(this, anchor), clipPos(this, head || anchor), options);
        }),
        extendSelection: docMethodOp(function(head, other, options) {
            extendSelection(this, clipPos(this, head), other && clipPos(this, other), options);
        }),
        extendSelections: docMethodOp(function(heads, options) {
            extendSelections(this, clipPosArray(this, heads), options);
        }),
        extendSelectionsBy: docMethodOp(function(f, options) {
            var heads = map(this.sel.ranges, f);
            extendSelections(this, clipPosArray(this, heads), options);
        }),
        setSelections: docMethodOp(function(ranges, primary, options) {
            if (!ranges.length) { return }
            var out = [];
            for (var i = 0; i < ranges.length; i++)
            { out[i] = new Range(clipPos(this, ranges[i].anchor),
                clipPos(this, ranges[i].head)); }
            if (primary == null) { primary = Math.min(ranges.length - 1, this.sel.primIndex); }
            setSelection(this, normalizeSelection(this.cm, out, primary), options);
        }),
        addSelection: docMethodOp(function(anchor, head, options) {
            var ranges = this.sel.ranges.slice(0);
            ranges.push(new Range(clipPos(this, anchor), clipPos(this, head || anchor)));
            setSelection(this, normalizeSelection(this.cm, ranges, ranges.length - 1), options);
        }),

        getSelection: function(lineSep) {
            var ranges = this.sel.ranges, lines;
            for (var i = 0; i < ranges.length; i++) {
                var sel = getBetween(this, ranges[i].from(), ranges[i].to());
                lines = lines ? lines.concat(sel) : sel;
            }
            if (lineSep === false) { return lines }
            else { return lines.join(lineSep || this.lineSeparator()) }
        },
        getSelections: function(lineSep) {
            var parts = [], ranges = this.sel.ranges;
            for (var i = 0; i < ranges.length; i++) {
                var sel = getBetween(this, ranges[i].from(), ranges[i].to());
                if (lineSep !== false) { sel = sel.join(lineSep || this.lineSeparator()); }
                parts[i] = sel;
            }
            return parts
        },
        replaceSelection: function(code, collapse, origin) {
            var dup = [];
            for (var i = 0; i < this.sel.ranges.length; i++)
            { dup[i] = code; }
            this.replaceSelections(dup, collapse, origin || "+input");
        },
        replaceSelections: docMethodOp(function(code, collapse, origin) {
            var changes = [], sel = this.sel;
            for (var i = 0; i < sel.ranges.length; i++) {
                var range = sel.ranges[i];
                changes[i] = {from: range.from(), to: range.to(), text: this.splitLines(code[i]), origin: origin};
            }
            var newSel = collapse && collapse != "end" && computeReplacedSel(this, changes, collapse);
            for (var i$1 = changes.length - 1; i$1 >= 0; i$1--)
            { makeChange(this, changes[i$1]); }
            if (newSel) { setSelectionReplaceHistory(this, newSel); }
            else if (this.cm) { ensureCursorVisible(this.cm); }
        }),
        undo: docMethodOp(function() {makeChangeFromHistory(this, "undo");}),
        redo: docMethodOp(function() {makeChangeFromHistory(this, "redo");}),
        undoSelection: docMethodOp(function() {makeChangeFromHistory(this, "undo", true);}),
        redoSelection: docMethodOp(function() {makeChangeFromHistory(this, "redo", true);}),

        setExtending: function(val) {this.extend = val;},
        getExtending: function() {return this.extend},

        historySize: function() {
            var hist = this.history, done = 0, undone = 0;
            for (var i = 0; i < hist.done.length; i++) { if (!hist.done[i].ranges) { ++done; } }
            for (var i$1 = 0; i$1 < hist.undone.length; i$1++) { if (!hist.undone[i$1].ranges) { ++undone; } }
            return {undo: done, redo: undone}
        },
        clearHistory: function() {
            var this$1 = this;

            this.history = new History(this.history);
            linkedDocs(this, function (doc) { return doc.history = this$1.history; }, true);
        },

        markClean: function() {
            this.cleanGeneration = this.changeGeneration(true);
        },
        changeGeneration: function(forceSplit) {
            if (forceSplit)
            { this.history.lastOp = this.history.lastSelOp = this.history.lastOrigin = null; }
            return this.history.generation
        },
        isClean: function (gen) {
            return this.history.generation == (gen || this.cleanGeneration)
        },

        getHistory: function() {
            return {done: copyHistoryArray(this.history.done),
                undone: copyHistoryArray(this.history.undone)}
        },
        setHistory: function(histData) {
            var hist = this.history = new History(this.history);
            hist.done = copyHistoryArray(histData.done.slice(0), null, true);
            hist.undone = copyHistoryArray(histData.undone.slice(0), null, true);
        },

        setGutterMarker: docMethodOp(function(line, gutterID, value) {
            return changeLine(this, line, "gutter", function (line) {
                var markers = line.gutterMarkers || (line.gutterMarkers = {});
                markers[gutterID] = value;
                if (!value && isEmpty(markers)) { line.gutterMarkers = null; }
                return true
            })
        }),

        clearGutter: docMethodOp(function(gutterID) {
            var this$1 = this;

            this.iter(function (line) {
                if (line.gutterMarkers && line.gutterMarkers[gutterID]) {
                    changeLine(this$1, line, "gutter", function () {
                        line.gutterMarkers[gutterID] = null;
                        if (isEmpty(line.gutterMarkers)) { line.gutterMarkers = null; }
                        return true
                    });
                }
            });
        }),

        lineInfo: function(line) {
            var n;
            if (typeof line == "number") {
                if (!isLine(this, line)) { return null }
                n = line;
                line = getLine(this, line);
                if (!line) { return null }
            } else {
                n = lineNo(line);
                if (n == null) { return null }
            }
            return {line: n, handle: line, text: line.text, gutterMarkers: line.gutterMarkers,
                textClass: line.textClass, bgClass: line.bgClass, wrapClass: line.wrapClass,
                widgets: line.widgets}
        },

        addLineClass: docMethodOp(function(handle, where, cls) {
            return changeLine(this, handle, where == "gutter" ? "gutter" : "class", function (line) {
                var prop = where == "text" ? "textClass"
                    : where == "background" ? "bgClass"
                        : where == "gutter" ? "gutterClass" : "wrapClass";
                if (!line[prop]) { line[prop] = cls; }
                else if (classTest(cls).test(line[prop])) { return false }
                else { line[prop] += " " + cls; }
                return true
            })
        }),
        removeLineClass: docMethodOp(function(handle, where, cls) {
            return changeLine(this, handle, where == "gutter" ? "gutter" : "class", function (line) {
                var prop = where == "text" ? "textClass"
                    : where == "background" ? "bgClass"
                        : where == "gutter" ? "gutterClass" : "wrapClass";
                var cur = line[prop];
                if (!cur) { return false }
                else if (cls == null) { line[prop] = null; }
                else {
                    var found = cur.match(classTest(cls));
                    if (!found) { return false }
                    var end = found.index + found[0].length;
                    line[prop] = cur.slice(0, found.index) + (!found.index || end == cur.length ? "" : " ") + cur.slice(end) || null;
                }
                return true
            })
        }),

        addLineWidget: docMethodOp(function(handle, node, options) {
            return addLineWidget(this, handle, node, options)
        }),
        removeLineWidget: function(widget) { widget.clear(); },

        markText: function(from, to, options) {
            return markText(this, clipPos(this, from), clipPos(this, to), options, options && options.type || "range")
        },
        setBookmark: function(pos, options) {
            var realOpts = {replacedWith: options && (options.nodeType == null ? options.widget : options),
                insertLeft: options && options.insertLeft,
                clearWhenEmpty: false, shared: options && options.shared,
                handleMouseEvents: options && options.handleMouseEvents};
            pos = clipPos(this, pos);
            return markText(this, pos, pos, realOpts, "bookmark")
        },
        findMarksAt: function(pos) {
            pos = clipPos(this, pos);
            var markers = [], spans = getLine(this, pos.line).markedSpans;
            if (spans) { for (var i = 0; i < spans.length; ++i) {
                var span = spans[i];
                if ((span.from == null || span.from <= pos.ch) &&
                    (span.to == null || span.to >= pos.ch))
                { markers.push(span.marker.parent || span.marker); }
            } }
            return markers
        },
        findMarks: function(from, to, filter) {
            from = clipPos(this, from); to = clipPos(this, to);
            var found = [], lineNo = from.line;
            this.iter(from.line, to.line + 1, function (line) {
                var spans = line.markedSpans;
                if (spans) { for (var i = 0; i < spans.length; i++) {
                    var span = spans[i];
                    if (!(span.to != null && lineNo == from.line && from.ch >= span.to ||
                        span.from == null && lineNo != from.line ||
                        span.from != null && lineNo == to.line && span.from >= to.ch) &&
                        (!filter || filter(span.marker)))
                    { found.push(span.marker.parent || span.marker); }
                } }
                ++lineNo;
            });
            return found
        },
        getAllMarks: function() {
            var markers = [];
            this.iter(function (line) {
                var sps = line.markedSpans;
                if (sps) { for (var i = 0; i < sps.length; ++i)
                { if (sps[i].from != null) { markers.push(sps[i].marker); } } }
            });
            return markers
        },

        posFromIndex: function(off) {
            var ch, lineNo = this.first, sepSize = this.lineSeparator().length;
            this.iter(function (line) {
                var sz = line.text.length + sepSize;
                if (sz > off) { ch = off; return true }
                off -= sz;
                ++lineNo;
            });
            return clipPos(this, Pos(lineNo, ch))
        },
        indexFromPos: function (coords) {
            coords = clipPos(this, coords);
            var index = coords.ch;
            if (coords.line < this.first || coords.ch < 0) { return 0 }
            var sepSize = this.lineSeparator().length;
            this.iter(this.first, coords.line, function (line) { // iter aborts when callback returns a truthy value
                index += line.text.length + sepSize;
            });
            return index
        },

        copy: function(copyHistory) {
            var doc = new Doc(getLines(this, this.first, this.first + this.size),
                this.modeOption, this.first, this.lineSep, this.direction);
            doc.scrollTop = this.scrollTop; doc.scrollLeft = this.scrollLeft;
            doc.sel = this.sel;
            doc.extend = false;
            if (copyHistory) {
                doc.history.undoDepth = this.history.undoDepth;
                doc.setHistory(this.getHistory());
            }
            return doc
        },

        linkedDoc: function(options) {
            if (!options) { options = {}; }
            var from = this.first, to = this.first + this.size;
            if (options.from != null && options.from > from) { from = options.from; }
            if (options.to != null && options.to < to) { to = options.to; }
            var copy = new Doc(getLines(this, from, to), options.mode || this.modeOption, from, this.lineSep, this.direction);
            if (options.sharedHist) { copy.history = this.history
            ; }(this.linked || (this.linked = [])).push({doc: copy, sharedHist: options.sharedHist});
            copy.linked = [{doc: this, isParent: true, sharedHist: options.sharedHist}];
            copySharedMarkers(copy, findSharedMarkers(this));
            return copy
        },
        unlinkDoc: function(other) {
            if (other instanceof CodeMirror) { other = other.doc; }
            if (this.linked) { for (var i = 0; i < this.linked.length; ++i) {
                var link = this.linked[i];
                if (link.doc != other) { continue }
                this.linked.splice(i, 1);
                other.unlinkDoc(this);
                detachSharedMarkers(findSharedMarkers(this));
                break
            } }
            // If the histories were shared, split them again
            if (other.history == this.history) {
                var splitIds = [other.id];
                linkedDocs(other, function (doc) { return splitIds.push(doc.id); }, true);
                other.history = new History(null);
                other.history.done = copyHistoryArray(this.history.done, splitIds);
                other.history.undone = copyHistoryArray(this.history.undone, splitIds);
            }
        },
        iterLinkedDocs: function(f) {linkedDocs(this, f);},

        getMode: function() {return this.mode},
        getEditor: function() {return this.cm},

        splitLines: function(str) {
            if (this.lineSep) { return str.split(this.lineSep) }
            return splitLinesAuto(str)
        },
        lineSeparator: function() { return this.lineSep || "\n" },

        setDirection: docMethodOp(function (dir) {
            if (dir != "rtl") { dir = "ltr"; }
            if (dir == this.direction) { return }
            this.direction = dir;
            this.iter(function (line) { return line.order = null; });
            if (this.cm) { directionChanged(this.cm); }
        })
    });

    // Public alias.
    Doc.prototype.eachLine = Doc.prototype.iter;

    // Kludge to work around strange IE behavior where it'll sometimes
    // re-fire a series of drag-related events right after the drop (#1551)
    var lastDrop = 0;

    function onDrop(e) {
        var cm = this;
        clearDragCursor(cm);
        if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e))
        { return }
        e_preventDefault(e);
        if (ie) { lastDrop = +new Date; }
        var pos = posFromMouse(cm, e, true), files = e.dataTransfer.files;
        if (!pos || cm.isReadOnly()) { return }
        // Might be a file drop, in which case we simply extract the text
        // and insert it.
        if (files && files.length && window.FileReader && window.File) {
            var n = files.length, text = Array(n), read = 0;
            var markAsReadAndPasteIfAllFilesAreRead = function () {
                if (++read == n) {
                    operation(cm, function () {
                        pos = clipPos(cm.doc, pos);
                        var change = {from: pos, to: pos,
                            text: cm.doc.splitLines(
                                text.filter(function (t) { return t != null; }).join(cm.doc.lineSeparator())),
                            origin: "paste"};
                        makeChange(cm.doc, change);
                        setSelectionReplaceHistory(cm.doc, simpleSelection(clipPos(cm.doc, pos), clipPos(cm.doc, changeEnd(change))));
                    })();
                }
            };
            var readTextFromFile = function (file, i) {
                if (cm.options.allowDropFileTypes &&
                    indexOf(cm.options.allowDropFileTypes, file.type) == -1) {
                    markAsReadAndPasteIfAllFilesAreRead();
                    return
                }
                var reader = new FileReader;
                reader.onerror = function () { return markAsReadAndPasteIfAllFilesAreRead(); };
                reader.onload = function () {
                    var content = reader.result;
                    if (/[\x00-\x08\x0e-\x1f]{2}/.test(content)) {
                        markAsReadAndPasteIfAllFilesAreRead();
                        return
                    }
                    text[i] = content;
                    markAsReadAndPasteIfAllFilesAreRead();
                };
                reader.readAsText(file);
            };
            for (var i = 0; i < files.length; i++) { readTextFromFile(files[i], i); }
        } else { // Normal drop
            // Don't do a replace if the drop happened inside of the selected text.
            if (cm.state.draggingText && cm.doc.sel.contains(pos) > -1) {
                cm.state.draggingText(e);
                // Ensure the editor is re-focused
                setTimeout(function () { return cm.display.input.focus(); }, 20);
                return
            }
            try {
                var text$1 = e.dataTransfer.getData("Text");
                if (text$1) {
                    var selected;
                    if (cm.state.draggingText && !cm.state.draggingText.copy)
                    { selected = cm.listSelections(); }
                    setSelectionNoUndo(cm.doc, simpleSelection(pos, pos));
                    if (selected) { for (var i$1 = 0; i$1 < selected.length; ++i$1)
                    { replaceRange(cm.doc, "", selected[i$1].anchor, selected[i$1].head, "drag"); } }
                    cm.replaceSelection(text$1, "around", "paste");
                    cm.display.input.focus();
                }
            }
            catch(e$1){}
        }
    }

    function onDragStart(cm, e) {
        if (ie && (!cm.state.draggingText || +new Date - lastDrop < 100)) { e_stop(e); return }
        if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e)) { return }

        e.dataTransfer.setData("Text", cm.getSelection());
        e.dataTransfer.effectAllowed = "copyMove";

        // Use dummy image instead of default browsers image.
        // Recent Safari (~6.0.2) have a tendency to segfault when this happens, so we don't do it there.
        if (e.dataTransfer.setDragImage && !safari) {
            var img = elt("img", null, null, "position: fixed; left: 0; top: 0;");
            img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
            if (presto) {
                img.width = img.height = 1;
                cm.display.wrapper.appendChild(img);
                // Force a relayout, or Opera won't use our image for some obscure reason
                img._top = img.offsetTop;
            }
            e.dataTransfer.setDragImage(img, 0, 0);
            if (presto) { img.parentNode.removeChild(img); }
        }
    }

    function onDragOver(cm, e) {
        var pos = posFromMouse(cm, e);
        if (!pos) { return }
        var frag = document.createDocumentFragment();
        drawSelectionCursor(cm, pos, frag);
        if (!cm.display.dragCursor) {
            cm.display.dragCursor = elt("div", null, "CodeMirror-cursors CodeMirror-dragcursors");
            cm.display.lineSpace.insertBefore(cm.display.dragCursor, cm.display.cursorDiv);
        }
        removeChildrenAndAdd(cm.display.dragCursor, frag);
    }

    function clearDragCursor(cm) {
        if (cm.display.dragCursor) {
            cm.display.lineSpace.removeChild(cm.display.dragCursor);
            cm.display.dragCursor = null;
        }
    }

    // These must be handled carefully, because naively registering a
    // handler for each editor will cause the editors to never be
    // garbage collected.

    function forEachCodeMirror(f) {
        if (!document.getElementsByClassName) { return }
        var byClass = document.getElementsByClassName("CodeMirror"), editors = [];
        for (var i = 0; i < byClass.length; i++) {
            var cm = byClass[i].CodeMirror;
            if (cm) { editors.push(cm); }
        }
        if (editors.length) { editors[0].operation(function () {
            for (var i = 0; i < editors.length; i++) { f(editors[i]); }
        }); }
    }

    var globalsRegistered = false;
    function ensureGlobalHandlers() {
        if (globalsRegistered) { return }
        registerGlobalHandlers();
        globalsRegistered = true;
    }
    function registerGlobalHandlers() {
        // When the window resizes, we need to refresh active editors.
        var resizeTimer;
        on(window, "resize", function () {
            if (resizeTimer == null) { resizeTimer = setTimeout(function () {
                resizeTimer = null;
                forEachCodeMirror(onResize);
            }, 100); }
        });
        // When the window loses focus, we want to show the editor as blurred
        on(window, "blur", function () { return forEachCodeMirror(onBlur); });
    }
    // Called when the window resizes
    function onResize(cm) {
        var d = cm.display;
        // Might be a text scaling operation, clear size caches.
        d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;
        d.scrollbarsClipped = false;
        cm.setSize();
    }

    var keyNames = {
        3: "Pause", 8: "Backspace", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt",
        19: "Pause", 20: "CapsLock", 27: "Esc", 32: "Space", 33: "PageUp", 34: "PageDown", 35: "End",
        36: "Home", 37: "Left", 38: "Up", 39: "Right", 40: "Down", 44: "PrintScrn", 45: "Insert",
        46: "Delete", 59: ";", 61: "=", 91: "Mod", 92: "Mod", 93: "Mod",
        106: "*", 107: "=", 109: "-", 110: ".", 111: "/", 145: "ScrollLock",
        173: "-", 186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\",
        221: "]", 222: "'", 224: "Mod", 63232: "Up", 63233: "Down", 63234: "Left", 63235: "Right", 63272: "Delete",
        63273: "Home", 63275: "End", 63276: "PageUp", 63277: "PageDown", 63302: "Insert"
    };

    // Number keys
    for (var i = 0; i < 10; i++) { keyNames[i + 48] = keyNames[i + 96] = String(i); }
    // Alphabetic keys
    for (var i$1 = 65; i$1 <= 90; i$1++) { keyNames[i$1] = String.fromCharCode(i$1); }
    // Function keys
    for (var i$2 = 1; i$2 <= 12; i$2++) { keyNames[i$2 + 111] = keyNames[i$2 + 63235] = "F" + i$2; }

    var keyMap = {};

    keyMap.basic = {
        "Left": "goCharLeft", "Right": "goCharRight", "Up": "goLineUp", "Down": "goLineDown",
        "End": "goLineEnd", "Home": "goLineStartSmart", "PageUp": "goPageUp", "PageDown": "goPageDown",
        "Delete": "delCharAfter", "Backspace": "delCharBefore", "Shift-Backspace": "delCharBefore",
        "Tab": "defaultTab", "Shift-Tab": "indentAuto",
        "Enter": "newlineAndIndent", "Insert": "toggleOverwrite",
        "Esc": "singleSelection"
    };
    // Note that the save and find-related commands aren't defined by
    // default. User code or addons can define them. Unknown commands
    // are simply ignored.
    keyMap.pcDefault = {
        "Ctrl-A": "selectAll", "Ctrl-D": "deleteLine", "Ctrl-Z": "undo", "Shift-Ctrl-Z": "redo", "Ctrl-Y": "redo",
        "Ctrl-Home": "goDocStart", "Ctrl-End": "goDocEnd", "Ctrl-Up": "goLineUp", "Ctrl-Down": "goLineDown",
        "Ctrl-Left": "goGroupLeft", "Ctrl-Right": "goGroupRight", "Alt-Left": "goLineStart", "Alt-Right": "goLineEnd",
        "Ctrl-Backspace": "delGroupBefore", "Ctrl-Delete": "delGroupAfter", "Ctrl-S": "save", "Ctrl-F": "find",
        "Ctrl-G": "findNext", "Shift-Ctrl-G": "findPrev", "Shift-Ctrl-F": "replace", "Shift-Ctrl-R": "replaceAll",
        "Ctrl-[": "indentLess", "Ctrl-]": "indentMore",
        "Ctrl-U": "undoSelection", "Shift-Ctrl-U": "redoSelection", "Alt-U": "redoSelection",
        "fallthrough": "basic"
    };
    // Very basic readline/emacs-style bindings, which are standard on Mac.
    keyMap.emacsy = {
        "Ctrl-F": "goCharRight", "Ctrl-B": "goCharLeft", "Ctrl-P": "goLineUp", "Ctrl-N": "goLineDown",
        "Alt-F": "goWordRight", "Alt-B": "goWordLeft", "Ctrl-A": "goLineStart", "Ctrl-E": "goLineEnd",
        "Ctrl-V": "goPageDown", "Shift-Ctrl-V": "goPageUp", "Ctrl-D": "delCharAfter", "Ctrl-H": "delCharBefore",
        "Alt-D": "delWordAfter", "Alt-Backspace": "delWordBefore", "Ctrl-K": "killLine", "Ctrl-T": "transposeChars",
        "Ctrl-O": "openLine"
    };
    keyMap.macDefault = {
        "Cmd-A": "selectAll", "Cmd-D": "deleteLine", "Cmd-Z": "undo", "Shift-Cmd-Z": "redo", "Cmd-Y": "redo",
        "Cmd-Home": "goDocStart", "Cmd-Up": "goDocStart", "Cmd-End": "goDocEnd", "Cmd-Down": "goDocEnd", "Alt-Left": "goGroupLeft",
        "Alt-Right": "goGroupRight", "Cmd-Left": "goLineLeft", "Cmd-Right": "goLineRight", "Alt-Backspace": "delGroupBefore",
        "Ctrl-Alt-Backspace": "delGroupAfter", "Alt-Delete": "delGroupAfter", "Cmd-S": "save", "Cmd-F": "find",
        "Cmd-G": "findNext", "Shift-Cmd-G": "findPrev", "Cmd-Alt-F": "replace", "Shift-Cmd-Alt-F": "replaceAll",
        "Cmd-[": "indentLess", "Cmd-]": "indentMore", "Cmd-Backspace": "delWrappedLineLeft", "Cmd-Delete": "delWrappedLineRight",
        "Cmd-U": "undoSelection", "Shift-Cmd-U": "redoSelection", "Ctrl-Up": "goDocStart", "Ctrl-Down": "goDocEnd",
        "fallthrough": ["basic", "emacsy"]
    };
    keyMap["default"] = mac ? keyMap.macDefault : keyMap.pcDefault;

    // KEYMAP DISPATCH

    function normalizeKeyName(name) {
        var parts = name.split(/-(?!$)/);
        name = parts[parts.length - 1];
        var alt, ctrl, shift, cmd;
        for (var i = 0; i < parts.length - 1; i++) {
            var mod = parts[i];
            if (/^(cmd|meta|m)$/i.test(mod)) { cmd = true; }
            else if (/^a(lt)?$/i.test(mod)) { alt = true; }
            else if (/^(c|ctrl|control)$/i.test(mod)) { ctrl = true; }
            else if (/^s(hift)?$/i.test(mod)) { shift = true; }
            else { throw new Error("Unrecognized modifier name: " + mod) }
        }
        if (alt) { name = "Alt-" + name; }
        if (ctrl) { name = "Ctrl-" + name; }
        if (cmd) { name = "Cmd-" + name; }
        if (shift) { name = "Shift-" + name; }
        return name
    }

    // This is a kludge to keep keymaps mostly working as raw objects
    // (backwards compatibility) while at the same time support features
    // like normalization and multi-stroke key bindings. It compiles a
    // new normalized keymap, and then updates the old object to reflect
    // this.
    function normalizeKeyMap(keymap) {
        var copy = {};
        for (var keyname in keymap) { if (keymap.hasOwnProperty(keyname)) {
            var value = keymap[keyname];
            if (/^(name|fallthrough|(de|at)tach)$/.test(keyname)) { continue }
            if (value == "...") { delete keymap[keyname]; continue }

            var keys = map(keyname.split(" "), normalizeKeyName);
            for (var i = 0; i < keys.length; i++) {
                var val = (void 0), name = (void 0);
                if (i == keys.length - 1) {
                    name = keys.join(" ");
                    val = value;
                } else {
                    name = keys.slice(0, i + 1).join(" ");
                    val = "...";
                }
                var prev = copy[name];
                if (!prev) { copy[name] = val; }
                else if (prev != val) { throw new Error("Inconsistent bindings for " + name) }
            }
            delete keymap[keyname];
        } }
        for (var prop in copy) { keymap[prop] = copy[prop]; }
        return keymap
    }

    function lookupKey(key, map, handle, context) {
        map = getKeyMap(map);
        var found = map.call ? map.call(key, context) : map[key];
        if (found === false) { return "nothing" }
        if (found === "...") { return "multi" }
        if (found != null && handle(found)) { return "handled" }

        if (map.fallthrough) {
            if (Object.prototype.toString.call(map.fallthrough) != "[object Array]")
            { return lookupKey(key, map.fallthrough, handle, context) }
            for (var i = 0; i < map.fallthrough.length; i++) {
                var result = lookupKey(key, map.fallthrough[i], handle, context);
                if (result) { return result }
            }
        }
    }

    // Modifier key presses don't count as 'real' key presses for the
    // purpose of keymap fallthrough.
    function isModifierKey(value) {
        var name = typeof value == "string" ? value : keyNames[value.keyCode];
        return name == "Ctrl" || name == "Alt" || name == "Shift" || name == "Mod"
    }

    function addModifierNames(name, event, noShift) {
        var base = name;
        if (event.altKey && base != "Alt") { name = "Alt-" + name; }
        if ((flipCtrlCmd ? event.metaKey : event.ctrlKey) && base != "Ctrl") { name = "Ctrl-" + name; }
        if ((flipCtrlCmd ? event.ctrlKey : event.metaKey) && base != "Mod") { name = "Cmd-" + name; }
        if (!noShift && event.shiftKey && base != "Shift") { name = "Shift-" + name; }
        return name
    }

    // Look up the name of a key as indicated by an event object.
    function keyName(event, noShift) {
        if (presto && event.keyCode == 34 && event["char"]) { return false }
        var name = keyNames[event.keyCode];
        if (name == null || event.altGraphKey) { return false }
        // Ctrl-ScrollLock has keyCode 3, same as Ctrl-Pause,
        // so we'll use event.code when available (Chrome 48+, FF 38+, Safari 10.1+)
        if (event.keyCode == 3 && event.code) { name = event.code; }
        return addModifierNames(name, event, noShift)
    }

    function getKeyMap(val) {
        return typeof val == "string" ? keyMap[val] : val
    }

    // Helper for deleting text near the selection(s), used to implement
    // backspace, delete, and similar functionality.
    function deleteNearSelection(cm, compute) {
        var ranges = cm.doc.sel.ranges, kill = [];
        // Build up a set of ranges to kill first, merging overlapping
        // ranges.
        for (var i = 0; i < ranges.length; i++) {
            var toKill = compute(ranges[i]);
            while (kill.length && cmp(toKill.from, lst(kill).to) <= 0) {
                var replaced = kill.pop();
                if (cmp(replaced.from, toKill.from) < 0) {
                    toKill.from = replaced.from;
                    break
                }
            }
            kill.push(toKill);
        }
        // Next, remove those actual ranges.
        runInOp(cm, function () {
            for (var i = kill.length - 1; i >= 0; i--)
            { replaceRange(cm.doc, "", kill[i].from, kill[i].to, "+delete"); }
            ensureCursorVisible(cm);
        });
    }

    function moveCharLogically(line, ch, dir) {
        var target = skipExtendingChars(line.text, ch + dir, dir);
        return target < 0 || target > line.text.length ? null : target
    }

    function moveLogically(line, start, dir) {
        var ch = moveCharLogically(line, start.ch, dir);
        return ch == null ? null : new Pos(start.line, ch, dir < 0 ? "after" : "before")
    }

    function endOfLine(visually, cm, lineObj, lineNo, dir) {
        if (visually) {
            if (cm.doc.direction == "rtl") { dir = -dir; }
            var order = getOrder(lineObj, cm.doc.direction);
            if (order) {
                var part = dir < 0 ? lst(order) : order[0];
                var moveInStorageOrder = (dir < 0) == (part.level == 1);
                var sticky = moveInStorageOrder ? "after" : "before";
                var ch;
                // With a wrapped rtl chunk (possibly spanning multiple bidi parts),
                // it could be that the last bidi part is not on the last visual line,
                // since visual lines contain content order-consecutive chunks.
                // Thus, in rtl, we are looking for the first (content-order) character
                // in the rtl chunk that is on the last line (that is, the same line
                // as the last (content-order) character).
                if (part.level > 0 || cm.doc.direction == "rtl") {
                    var prep = prepareMeasureForLine(cm, lineObj);
                    ch = dir < 0 ? lineObj.text.length - 1 : 0;
                    var targetTop = measureCharPrepared(cm, prep, ch).top;
                    ch = findFirst(function (ch) { return measureCharPrepared(cm, prep, ch).top == targetTop; }, (dir < 0) == (part.level == 1) ? part.from : part.to - 1, ch);
                    if (sticky == "before") { ch = moveCharLogically(lineObj, ch, 1); }
                } else { ch = dir < 0 ? part.to : part.from; }
                return new Pos(lineNo, ch, sticky)
            }
        }
        return new Pos(lineNo, dir < 0 ? lineObj.text.length : 0, dir < 0 ? "before" : "after")
    }

    function moveVisually(cm, line, start, dir) {
        var bidi = getOrder(line, cm.doc.direction);
        if (!bidi) { return moveLogically(line, start, dir) }
        if (start.ch >= line.text.length) {
            start.ch = line.text.length;
            start.sticky = "before";
        } else if (start.ch <= 0) {
            start.ch = 0;
            start.sticky = "after";
        }
        var partPos = getBidiPartAt(bidi, start.ch, start.sticky), part = bidi[partPos];
        if (cm.doc.direction == "ltr" && part.level % 2 == 0 && (dir > 0 ? part.to > start.ch : part.from < start.ch)) {
            // Case 1: We move within an ltr part in an ltr editor. Even with wrapped lines,
            // nothing interesting happens.
            return moveLogically(line, start, dir)
        }

        var mv = function (pos, dir) { return moveCharLogically(line, pos instanceof Pos ? pos.ch : pos, dir); };
        var prep;
        var getWrappedLineExtent = function (ch) {
            if (!cm.options.lineWrapping) { return {begin: 0, end: line.text.length} }
            prep = prep || prepareMeasureForLine(cm, line);
            return wrappedLineExtentChar(cm, line, prep, ch)
        };
        var wrappedLineExtent = getWrappedLineExtent(start.sticky == "before" ? mv(start, -1) : start.ch);

        if (cm.doc.direction == "rtl" || part.level == 1) {
            var moveInStorageOrder = (part.level == 1) == (dir < 0);
            var ch = mv(start, moveInStorageOrder ? 1 : -1);
            if (ch != null && (!moveInStorageOrder ? ch >= part.from && ch >= wrappedLineExtent.begin : ch <= part.to && ch <= wrappedLineExtent.end)) {
                // Case 2: We move within an rtl part or in an rtl editor on the same visual line
                var sticky = moveInStorageOrder ? "before" : "after";
                return new Pos(start.line, ch, sticky)
            }
        }

        // Case 3: Could not move within this bidi part in this visual line, so leave
        // the current bidi part

        var searchInVisualLine = function (partPos, dir, wrappedLineExtent) {
            var getRes = function (ch, moveInStorageOrder) { return moveInStorageOrder
                ? new Pos(start.line, mv(ch, 1), "before")
                : new Pos(start.line, ch, "after"); };

            for (; partPos >= 0 && partPos < bidi.length; partPos += dir) {
                var part = bidi[partPos];
                var moveInStorageOrder = (dir > 0) == (part.level != 1);
                var ch = moveInStorageOrder ? wrappedLineExtent.begin : mv(wrappedLineExtent.end, -1);
                if (part.from <= ch && ch < part.to) { return getRes(ch, moveInStorageOrder) }
                ch = moveInStorageOrder ? part.from : mv(part.to, -1);
                if (wrappedLineExtent.begin <= ch && ch < wrappedLineExtent.end) { return getRes(ch, moveInStorageOrder) }
            }
        };

        // Case 3a: Look for other bidi parts on the same visual line
        var res = searchInVisualLine(partPos + dir, dir, wrappedLineExtent);
        if (res) { return res }

        // Case 3b: Look for other bidi parts on the next visual line
        var nextCh = dir > 0 ? wrappedLineExtent.end : mv(wrappedLineExtent.begin, -1);
        if (nextCh != null && !(dir > 0 && nextCh == line.text.length)) {
            res = searchInVisualLine(dir > 0 ? 0 : bidi.length - 1, dir, getWrappedLineExtent(nextCh));
            if (res) { return res }
        }

        // Case 4: Nowhere to move
        return null
    }

    // Commands are parameter-less actions that can be performed on an
    // editor, mostly used for keybindings.
    var commands = {
        selectAll: selectAll,
        singleSelection: function (cm) { return cm.setSelection(cm.getCursor("anchor"), cm.getCursor("head"), sel_dontScroll); },
        killLine: function (cm) { return deleteNearSelection(cm, function (range) {
            if (range.empty()) {
                var len = getLine(cm.doc, range.head.line).text.length;
                if (range.head.ch == len && range.head.line < cm.lastLine())
                { return {from: range.head, to: Pos(range.head.line + 1, 0)} }
                else
                { return {from: range.head, to: Pos(range.head.line, len)} }
            } else {
                return {from: range.from(), to: range.to()}
            }
        }); },
        deleteLine: function (cm) { return deleteNearSelection(cm, function (range) { return ({
            from: Pos(range.from().line, 0),
            to: clipPos(cm.doc, Pos(range.to().line + 1, 0))
        }); }); },
        delLineLeft: function (cm) { return deleteNearSelection(cm, function (range) { return ({
            from: Pos(range.from().line, 0), to: range.from()
        }); }); },
        delWrappedLineLeft: function (cm) { return deleteNearSelection(cm, function (range) {
            var top = cm.charCoords(range.head, "div").top + 5;
            var leftPos = cm.coordsChar({left: 0, top: top}, "div");
            return {from: leftPos, to: range.from()}
        }); },
        delWrappedLineRight: function (cm) { return deleteNearSelection(cm, function (range) {
            var top = cm.charCoords(range.head, "div").top + 5;
            var rightPos = cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div");
            return {from: range.from(), to: rightPos }
        }); },
        undo: function (cm) { return cm.undo(); },
        redo: function (cm) { return cm.redo(); },
        undoSelection: function (cm) { return cm.undoSelection(); },
        redoSelection: function (cm) { return cm.redoSelection(); },
        goDocStart: function (cm) { return cm.extendSelection(Pos(cm.firstLine(), 0)); },
        goDocEnd: function (cm) { return cm.extendSelection(Pos(cm.lastLine())); },
        goLineStart: function (cm) { return cm.extendSelectionsBy(function (range) { return lineStart(cm, range.head.line); },
            {origin: "+move", bias: 1}
        ); },
        goLineStartSmart: function (cm) { return cm.extendSelectionsBy(function (range) { return lineStartSmart(cm, range.head); },
            {origin: "+move", bias: 1}
        ); },
        goLineEnd: function (cm) { return cm.extendSelectionsBy(function (range) { return lineEnd(cm, range.head.line); },
            {origin: "+move", bias: -1}
        ); },
        goLineRight: function (cm) { return cm.extendSelectionsBy(function (range) {
            var top = cm.cursorCoords(range.head, "div").top + 5;
            return cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div")
        }, sel_move); },
        goLineLeft: function (cm) { return cm.extendSelectionsBy(function (range) {
            var top = cm.cursorCoords(range.head, "div").top + 5;
            return cm.coordsChar({left: 0, top: top}, "div")
        }, sel_move); },
        goLineLeftSmart: function (cm) { return cm.extendSelectionsBy(function (range) {
            var top = cm.cursorCoords(range.head, "div").top + 5;
            var pos = cm.coordsChar({left: 0, top: top}, "div");
            if (pos.ch < cm.getLine(pos.line).search(/\S/)) { return lineStartSmart(cm, range.head) }
            return pos
        }, sel_move); },
        goLineUp: function (cm) { return cm.moveV(-1, "line"); },
        goLineDown: function (cm) { return cm.moveV(1, "line"); },
        goPageUp: function (cm) { return cm.moveV(-1, "page"); },
        goPageDown: function (cm) { return cm.moveV(1, "page"); },
        goCharLeft: function (cm) { return cm.moveH(-1, "char"); },
        goCharRight: function (cm) { return cm.moveH(1, "char"); },
        goColumnLeft: function (cm) { return cm.moveH(-1, "column"); },
        goColumnRight: function (cm) { return cm.moveH(1, "column"); },
        goWordLeft: function (cm) { return cm.moveH(-1, "word"); },
        goGroupRight: function (cm) { return cm.moveH(1, "group"); },
        goGroupLeft: function (cm) { return cm.moveH(-1, "group"); },
        goWordRight: function (cm) { return cm.moveH(1, "word"); },
        delCharBefore: function (cm) { return cm.deleteH(-1, "codepoint"); },
        delCharAfter: function (cm) { return cm.deleteH(1, "char"); },
        delWordBefore: function (cm) { return cm.deleteH(-1, "word"); },
        delWordAfter: function (cm) { return cm.deleteH(1, "word"); },
        delGroupBefore: function (cm) { return cm.deleteH(-1, "group"); },
        delGroupAfter: function (cm) { return cm.deleteH(1, "group"); },
        indentAuto: function (cm) { return cm.indentSelection("smart"); },
        indentMore: function (cm) { return cm.indentSelection("add"); },
        indentLess: function (cm) { return cm.indentSelection("subtract"); },
        insertTab: function (cm) { return cm.replaceSelection("\t"); },
        insertSoftTab: function (cm) {
            var spaces = [], ranges = cm.listSelections(), tabSize = cm.options.tabSize;
            for (var i = 0; i < ranges.length; i++) {
                var pos = ranges[i].from();
                var col = countColumn(cm.getLine(pos.line), pos.ch, tabSize);
                spaces.push(spaceStr(tabSize - col % tabSize));
            }
            cm.replaceSelections(spaces);
        },
        defaultTab: function (cm) {
            if (cm.somethingSelected()) { cm.indentSelection("add"); }
            else { cm.execCommand("insertTab"); }
        },
        // Swap the two chars left and right of each selection's head.
        // Move cursor behind the two swapped characters afterwards.
        //
        // Doesn't consider line feeds a character.
        // Doesn't scan more than one line above to find a character.
        // Doesn't do anything on an empty line.
        // Doesn't do anything with non-empty selections.
        transposeChars: function (cm) { return runInOp(cm, function () {
            var ranges = cm.listSelections(), newSel = [];
            for (var i = 0; i < ranges.length; i++) {
                if (!ranges[i].empty()) { continue }
                var cur = ranges[i].head, line = getLine(cm.doc, cur.line).text;
                if (line) {
                    if (cur.ch == line.length) { cur = new Pos(cur.line, cur.ch - 1); }
                    if (cur.ch > 0) {
                        cur = new Pos(cur.line, cur.ch + 1);
                        cm.replaceRange(line.charAt(cur.ch - 1) + line.charAt(cur.ch - 2),
                            Pos(cur.line, cur.ch - 2), cur, "+transpose");
                    } else if (cur.line > cm.doc.first) {
                        var prev = getLine(cm.doc, cur.line - 1).text;
                        if (prev) {
                            cur = new Pos(cur.line, 1);
                            cm.replaceRange(line.charAt(0) + cm.doc.lineSeparator() +
                                prev.charAt(prev.length - 1),
                                Pos(cur.line - 1, prev.length - 1), cur, "+transpose");
                        }
                    }
                }
                newSel.push(new Range(cur, cur));
            }
            cm.setSelections(newSel);
        }); },
        newlineAndIndent: function (cm) { return runInOp(cm, function () {
            var sels = cm.listSelections();
            for (var i = sels.length - 1; i >= 0; i--)
            { cm.replaceRange(cm.doc.lineSeparator(), sels[i].anchor, sels[i].head, "+input"); }
            sels = cm.listSelections();
            for (var i$1 = 0; i$1 < sels.length; i$1++)
            { cm.indentLine(sels[i$1].from().line, null, true); }
            ensureCursorVisible(cm);
        }); },
        openLine: function (cm) { return cm.replaceSelection("\n", "start"); },
        toggleOverwrite: function (cm) { return cm.toggleOverwrite(); }
    };


    function lineStart(cm, lineN) {
        var line = getLine(cm.doc, lineN);
        var visual = visualLine(line);
        if (visual != line) { lineN = lineNo(visual); }
        return endOfLine(true, cm, visual, lineN, 1)
    }
    function lineEnd(cm, lineN) {
        var line = getLine(cm.doc, lineN);
        var visual = visualLineEnd(line);
        if (visual != line) { lineN = lineNo(visual); }
        return endOfLine(true, cm, line, lineN, -1)
    }
    function lineStartSmart(cm, pos) {
        var start = lineStart(cm, pos.line);
        var line = getLine(cm.doc, start.line);
        var order = getOrder(line, cm.doc.direction);
        if (!order || order[0].level == 0) {
            var firstNonWS = Math.max(start.ch, line.text.search(/\S/));
            var inWS = pos.line == start.line && pos.ch <= firstNonWS && pos.ch;
            return Pos(start.line, inWS ? 0 : firstNonWS, start.sticky)
        }
        return start
    }

    // Run a handler that was bound to a key.
    function doHandleBinding(cm, bound, dropShift) {
        if (typeof bound == "string") {
            bound = commands[bound];
            if (!bound) { return false }
        }
        // Ensure previous input has been read, so that the handler sees a
        // consistent view of the document
        cm.display.input.ensurePolled();
        var prevShift = cm.display.shift, done = false;
        try {
            if (cm.isReadOnly()) { cm.state.suppressEdits = true; }
            if (dropShift) { cm.display.shift = false; }
            done = bound(cm) != Pass;
        } finally {
            cm.display.shift = prevShift;
            cm.state.suppressEdits = false;
        }
        return done
    }

    function lookupKeyForEditor(cm, name, handle) {
        for (var i = 0; i < cm.state.keyMaps.length; i++) {
            var result = lookupKey(name, cm.state.keyMaps[i], handle, cm);
            if (result) { return result }
        }
        return (cm.options.extraKeys && lookupKey(name, cm.options.extraKeys, handle, cm))
            || lookupKey(name, cm.options.keyMap, handle, cm)
    }

    // Note that, despite the name, this function is also used to check
    // for bound mouse clicks.

    var stopSeq = new Delayed;

    function dispatchKey(cm, name, e, handle) {
        var seq = cm.state.keySeq;
        if (seq) {
            if (isModifierKey(name)) { return "handled" }
            if (/\'$/.test(name))
            { cm.state.keySeq = null; }
            else
            { stopSeq.set(50, function () {
                if (cm.state.keySeq == seq) {
                    cm.state.keySeq = null;
                    cm.display.input.reset();
                }
            }); }
            if (dispatchKeyInner(cm, seq + " " + name, e, handle)) { return true }
        }
        return dispatchKeyInner(cm, name, e, handle)
    }

    function dispatchKeyInner(cm, name, e, handle) {
        var result = lookupKeyForEditor(cm, name, handle);

        if (result == "multi")
        { cm.state.keySeq = name; }
        if (result == "handled")
        { signalLater(cm, "keyHandled", cm, name, e); }

        if (result == "handled" || result == "multi") {
            e_preventDefault(e);
            restartBlink(cm);
        }

        return !!result
    }

    // Handle a key from the keydown event.
    function handleKeyBinding(cm, e) {
        var name = keyName(e, true);
        if (!name) { return false }

        if (e.shiftKey && !cm.state.keySeq) {
            // First try to resolve full name (including 'Shift-'). Failing
            // that, see if there is a cursor-motion command (starting with
            // 'go') bound to the keyname without 'Shift-'.
            return dispatchKey(cm, "Shift-" + name, e, function (b) { return doHandleBinding(cm, b, true); })
                || dispatchKey(cm, name, e, function (b) {
                    if (typeof b == "string" ? /^go[A-Z]/.test(b) : b.motion)
                    { return doHandleBinding(cm, b) }
                })
        } else {
            return dispatchKey(cm, name, e, function (b) { return doHandleBinding(cm, b); })
        }
    }

    // Handle a key from the keypress event
    function handleCharBinding(cm, e, ch) {
        return dispatchKey(cm, "'" + ch + "'", e, function (b) { return doHandleBinding(cm, b, true); })
    }

    var lastStoppedKey = null;
    function onKeyDown(e) {
        var cm = this;
        if (e.target && e.target != cm.display.input.getField()) { return }
        cm.curOp.focus = activeElt();
        if (signalDOMEvent(cm, e)) { return }
        // IE does strange things with escape.
        if (ie && ie_version < 11 && e.keyCode == 27) { e.returnValue = false; }
        var code = e.keyCode;
        cm.display.shift = code == 16 || e.shiftKey;
        var handled = handleKeyBinding(cm, e);
        if (presto) {
            lastStoppedKey = handled ? code : null;
            // Opera has no cut event... we try to at least catch the key combo
            if (!handled && code == 88 && !hasCopyEvent && (mac ? e.metaKey : e.ctrlKey))
            { cm.replaceSelection("", null, "cut"); }
        }
        if (gecko && !mac && !handled && code == 46 && e.shiftKey && !e.ctrlKey && document.execCommand)
        { document.execCommand("cut"); }

        // Turn mouse into crosshair when Alt is held on Mac.
        if (code == 18 && !/\bCodeMirror-crosshair\b/.test(cm.display.lineDiv.className))
        { showCrossHair(cm); }
    }

    function showCrossHair(cm) {
        var lineDiv = cm.display.lineDiv;
        addClass(lineDiv, "CodeMirror-crosshair");

        function up(e) {
            if (e.keyCode == 18 || !e.altKey) {
                rmClass(lineDiv, "CodeMirror-crosshair");
                off(document, "keyup", up);
                off(document, "mouseover", up);
            }
        }
        on(document, "keyup", up);
        on(document, "mouseover", up);
    }

    function onKeyUp(e) {
        if (e.keyCode == 16) { this.doc.sel.shift = false; }
        signalDOMEvent(this, e);
    }

    function onKeyPress(e) {
        var cm = this;
        if (e.target && e.target != cm.display.input.getField()) { return }
        if (eventInWidget(cm.display, e) || signalDOMEvent(cm, e) || e.ctrlKey && !e.altKey || mac && e.metaKey) { return }
        var keyCode = e.keyCode, charCode = e.charCode;
        if (presto && keyCode == lastStoppedKey) {lastStoppedKey = null; e_preventDefault(e); return}
        if ((presto && (!e.which || e.which < 10)) && handleKeyBinding(cm, e)) { return }
        var ch = String.fromCharCode(charCode == null ? keyCode : charCode);
        // Some browsers fire keypress events for backspace
        if (ch == "\x08") { return }
        if (handleCharBinding(cm, e, ch)) { return }
        cm.display.input.onKeyPress(e);
    }

    var DOUBLECLICK_DELAY = 400;

    var PastClick = function(time, pos, button) {
        this.time = time;
        this.pos = pos;
        this.button = button;
    };

    PastClick.prototype.compare = function (time, pos, button) {
        return this.time + DOUBLECLICK_DELAY > time &&
            cmp(pos, this.pos) == 0 && button == this.button
    };

    var lastClick, lastDoubleClick;
    function clickRepeat(pos, button) {
        var now = +new Date;
        if (lastDoubleClick && lastDoubleClick.compare(now, pos, button)) {
            lastClick = lastDoubleClick = null;
            return "triple"
        } else if (lastClick && lastClick.compare(now, pos, button)) {
            lastDoubleClick = new PastClick(now, pos, button);
            lastClick = null;
            return "double"
        } else {
            lastClick = new PastClick(now, pos, button);
            lastDoubleClick = null;
            return "single"
        }
    }

    // A mouse down can be a single click, double click, triple click,
    // start of selection drag, start of text drag, new cursor
    // (ctrl-click), rectangle drag (alt-drag), or xwin
    // middle-click-paste. Or it might be a click on something we should
    // not interfere with, such as a scrollbar or widget.
    function onMouseDown(e) {
        var cm = this, display = cm.display;
        if (signalDOMEvent(cm, e) || display.activeTouch && display.input.supportsTouch()) { return }
        display.input.ensurePolled();
        display.shift = e.shiftKey;

        if (eventInWidget(display, e)) {
            if (!webkit) {
                // Briefly turn off draggability, to allow widgets to do
                // normal dragging things.
                display.scroller.draggable = false;
                setTimeout(function () { return display.scroller.draggable = true; }, 100);
            }
            return
        }
        if (clickInGutter(cm, e)) { return }
        var pos = posFromMouse(cm, e), button = e_button(e), repeat = pos ? clickRepeat(pos, button) : "single";
        window.focus();

        // #3261: make sure, that we're not starting a second selection
        if (button == 1 && cm.state.selectingText)
        { cm.state.selectingText(e); }

        if (pos && handleMappedButton(cm, button, pos, repeat, e)) { return }

        if (button == 1) {
            if (pos) { leftButtonDown(cm, pos, repeat, e); }
            else if (e_target(e) == display.scroller) { e_preventDefault(e); }
        } else if (button == 2) {
            if (pos) { extendSelection(cm.doc, pos); }
            setTimeout(function () { return display.input.focus(); }, 20);
        } else if (button == 3) {
            if (captureRightClick) { cm.display.input.onContextMenu(e); }
            else { delayBlurEvent(cm); }
        }
    }

    function handleMappedButton(cm, button, pos, repeat, event) {
        var name = "Click";
        if (repeat == "double") { name = "Double" + name; }
        else if (repeat == "triple") { name = "Triple" + name; }
        name = (button == 1 ? "Left" : button == 2 ? "Middle" : "Right") + name;

        return dispatchKey(cm,  addModifierNames(name, event), event, function (bound) {
            if (typeof bound == "string") { bound = commands[bound]; }
            if (!bound) { return false }
            var done = false;
            try {
                if (cm.isReadOnly()) { cm.state.suppressEdits = true; }
                done = bound(cm, pos) != Pass;
            } finally {
                cm.state.suppressEdits = false;
            }
            return done
        })
    }

    function configureMouse(cm, repeat, event) {
        var option = cm.getOption("configureMouse");
        var value = option ? option(cm, repeat, event) : {};
        if (value.unit == null) {
            var rect = chromeOS ? event.shiftKey && event.metaKey : event.altKey;
            value.unit = rect ? "rectangle" : repeat == "single" ? "char" : repeat == "double" ? "word" : "line";
        }
        if (value.extend == null || cm.doc.extend) { value.extend = cm.doc.extend || event.shiftKey; }
        if (value.addNew == null) { value.addNew = mac ? event.metaKey : event.ctrlKey; }
        if (value.moveOnDrag == null) { value.moveOnDrag = !(mac ? event.altKey : event.ctrlKey); }
        return value
    }

    function leftButtonDown(cm, pos, repeat, event) {
        if (ie) { setTimeout(bind(ensureFocus, cm), 0); }
        else { cm.curOp.focus = activeElt(); }

        var behavior = configureMouse(cm, repeat, event);

        var sel = cm.doc.sel, contained;
        if (cm.options.dragDrop && dragAndDrop && !cm.isReadOnly() &&
            repeat == "single" && (contained = sel.contains(pos)) > -1 &&
            (cmp((contained = sel.ranges[contained]).from(), pos) < 0 || pos.xRel > 0) &&
            (cmp(contained.to(), pos) > 0 || pos.xRel < 0))
        { leftButtonStartDrag(cm, event, pos, behavior); }
        else
        { leftButtonSelect(cm, event, pos, behavior); }
    }

    // Start a text drag. When it ends, see if any dragging actually
    // happen, and treat as a click if it didn't.
    function leftButtonStartDrag(cm, event, pos, behavior) {
        var display = cm.display, moved = false;
        var dragEnd = operation(cm, function (e) {
            if (webkit) { display.scroller.draggable = false; }
            cm.state.draggingText = false;
            if (cm.state.delayingBlurEvent) {
                if (cm.hasFocus()) { cm.state.delayingBlurEvent = false; }
                else { delayBlurEvent(cm); }
            }
            off(display.wrapper.ownerDocument, "mouseup", dragEnd);
            off(display.wrapper.ownerDocument, "mousemove", mouseMove);
            off(display.scroller, "dragstart", dragStart);
            off(display.scroller, "drop", dragEnd);
            if (!moved) {
                e_preventDefault(e);
                if (!behavior.addNew)
                { extendSelection(cm.doc, pos, null, null, behavior.extend); }
                // Work around unexplainable focus problem in IE9 (#2127) and Chrome (#3081)
                if ((webkit && !safari) || ie && ie_version == 9)
                { setTimeout(function () {display.wrapper.ownerDocument.body.focus({preventScroll: true}); display.input.focus();}, 20); }
                else
                { display.input.focus(); }
            }
        });
        var mouseMove = function(e2) {
            moved = moved || Math.abs(event.clientX - e2.clientX) + Math.abs(event.clientY - e2.clientY) >= 10;
        };
        var dragStart = function () { return moved = true; };
        // Let the drag handler handle this.
        if (webkit) { display.scroller.draggable = true; }
        cm.state.draggingText = dragEnd;
        dragEnd.copy = !behavior.moveOnDrag;
        on(display.wrapper.ownerDocument, "mouseup", dragEnd);
        on(display.wrapper.ownerDocument, "mousemove", mouseMove);
        on(display.scroller, "dragstart", dragStart);
        on(display.scroller, "drop", dragEnd);

        cm.state.delayingBlurEvent = true;
        setTimeout(function () { return display.input.focus(); }, 20);
        // IE's approach to draggable
        if (display.scroller.dragDrop) { display.scroller.dragDrop(); }
    }

    function rangeForUnit(cm, pos, unit) {
        if (unit == "char") { return new Range(pos, pos) }
        if (unit == "word") { return cm.findWordAt(pos) }
        if (unit == "line") { return new Range(Pos(pos.line, 0), clipPos(cm.doc, Pos(pos.line + 1, 0))) }
        var result = unit(cm, pos);
        return new Range(result.from, result.to)
    }

    // Normal selection, as opposed to text dragging.
    function leftButtonSelect(cm, event, start, behavior) {
        if (ie) { delayBlurEvent(cm); }
        var display = cm.display, doc = cm.doc;
        e_preventDefault(event);

        var ourRange, ourIndex, startSel = doc.sel, ranges = startSel.ranges;
        if (behavior.addNew && !behavior.extend) {
            ourIndex = doc.sel.contains(start);
            if (ourIndex > -1)
            { ourRange = ranges[ourIndex]; }
            else
            { ourRange = new Range(start, start); }
        } else {
            ourRange = doc.sel.primary();
            ourIndex = doc.sel.primIndex;
        }

        if (behavior.unit == "rectangle") {
            if (!behavior.addNew) { ourRange = new Range(start, start); }
            start = posFromMouse(cm, event, true, true);
            ourIndex = -1;
        } else {
            var range = rangeForUnit(cm, start, behavior.unit);
            if (behavior.extend)
            { ourRange = extendRange(ourRange, range.anchor, range.head, behavior.extend); }
            else
            { ourRange = range; }
        }

        if (!behavior.addNew) {
            ourIndex = 0;
            setSelection(doc, new Selection([ourRange], 0), sel_mouse);
            startSel = doc.sel;
        } else if (ourIndex == -1) {
            ourIndex = ranges.length;
            setSelection(doc, normalizeSelection(cm, ranges.concat([ourRange]), ourIndex),
                {scroll: false, origin: "*mouse"});
        } else if (ranges.length > 1 && ranges[ourIndex].empty() && behavior.unit == "char" && !behavior.extend) {
            setSelection(doc, normalizeSelection(cm, ranges.slice(0, ourIndex).concat(ranges.slice(ourIndex + 1)), 0),
                {scroll: false, origin: "*mouse"});
            startSel = doc.sel;
        } else {
            replaceOneSelection(doc, ourIndex, ourRange, sel_mouse);
        }

        var lastPos = start;
        function extendTo(pos) {
            if (cmp(lastPos, pos) == 0) { return }
            lastPos = pos;

            if (behavior.unit == "rectangle") {
                var ranges = [], tabSize = cm.options.tabSize;
                var startCol = countColumn(getLine(doc, start.line).text, start.ch, tabSize);
                var posCol = countColumn(getLine(doc, pos.line).text, pos.ch, tabSize);
                var left = Math.min(startCol, posCol), right = Math.max(startCol, posCol);
                for (var line = Math.min(start.line, pos.line), end = Math.min(cm.lastLine(), Math.max(start.line, pos.line));
                     line <= end; line++) {
                    var text = getLine(doc, line).text, leftPos = findColumn(text, left, tabSize);
                    if (left == right)
                    { ranges.push(new Range(Pos(line, leftPos), Pos(line, leftPos))); }
                    else if (text.length > leftPos)
                    { ranges.push(new Range(Pos(line, leftPos), Pos(line, findColumn(text, right, tabSize)))); }
                }
                if (!ranges.length) { ranges.push(new Range(start, start)); }
                setSelection(doc, normalizeSelection(cm, startSel.ranges.slice(0, ourIndex).concat(ranges), ourIndex),
                    {origin: "*mouse", scroll: false});
                cm.scrollIntoView(pos);
            } else {
                var oldRange = ourRange;
                var range = rangeForUnit(cm, pos, behavior.unit);
                var anchor = oldRange.anchor, head;
                if (cmp(range.anchor, anchor) > 0) {
                    head = range.head;
                    anchor = minPos(oldRange.from(), range.anchor);
                } else {
                    head = range.anchor;
                    anchor = maxPos(oldRange.to(), range.head);
                }
                var ranges$1 = startSel.ranges.slice(0);
                ranges$1[ourIndex] = bidiSimplify(cm, new Range(clipPos(doc, anchor), head));
                setSelection(doc, normalizeSelection(cm, ranges$1, ourIndex), sel_mouse);
            }
        }

        var editorSize = display.wrapper.getBoundingClientRect();
        // Used to ensure timeout re-tries don't fire when another extend
        // happened in the meantime (clearTimeout isn't reliable -- at
        // least on Chrome, the timeouts still happen even when cleared,
        // if the clear happens after their scheduled firing time).
        var counter = 0;

        function extend(e) {
            var curCount = ++counter;
            var cur = posFromMouse(cm, e, true, behavior.unit == "rectangle");
            if (!cur) { return }
            if (cmp(cur, lastPos) != 0) {
                cm.curOp.focus = activeElt();
                extendTo(cur);
                var visible = visibleLines(display, doc);
                if (cur.line >= visible.to || cur.line < visible.from)
                { setTimeout(operation(cm, function () {if (counter == curCount) { extend(e); }}), 150); }
            } else {
                var outside = e.clientY < editorSize.top ? -20 : e.clientY > editorSize.bottom ? 20 : 0;
                if (outside) { setTimeout(operation(cm, function () {
                    if (counter != curCount) { return }
                    display.scroller.scrollTop += outside;
                    extend(e);
                }), 50); }
            }
        }

        function done(e) {
            cm.state.selectingText = false;
            counter = Infinity;
            // If e is null or undefined we interpret this as someone trying
            // to explicitly cancel the selection rather than the user
            // letting go of the mouse button.
            if (e) {
                e_preventDefault(e);
                display.input.focus();
            }
            off(display.wrapper.ownerDocument, "mousemove", move);
            off(display.wrapper.ownerDocument, "mouseup", up);
            doc.history.lastSelOrigin = null;
        }

        var move = operation(cm, function (e) {
            if (e.buttons === 0 || !e_button(e)) { done(e); }
            else { extend(e); }
        });
        var up = operation(cm, done);
        cm.state.selectingText = up;
        on(display.wrapper.ownerDocument, "mousemove", move);
        on(display.wrapper.ownerDocument, "mouseup", up);
    }

    // Used when mouse-selecting to adjust the anchor to the proper side
    // of a bidi jump depending on the visual position of the head.
    function bidiSimplify(cm, range) {
        var anchor = range.anchor;
        var head = range.head;
        var anchorLine = getLine(cm.doc, anchor.line);
        if (cmp(anchor, head) == 0 && anchor.sticky == head.sticky) { return range }
        var order = getOrder(anchorLine);
        if (!order) { return range }
        var index = getBidiPartAt(order, anchor.ch, anchor.sticky), part = order[index];
        if (part.from != anchor.ch && part.to != anchor.ch) { return range }
        var boundary = index + ((part.from == anchor.ch) == (part.level != 1) ? 0 : 1);
        if (boundary == 0 || boundary == order.length) { return range }

        // Compute the relative visual position of the head compared to the
        // anchor (<0 is to the left, >0 to the right)
        var leftSide;
        if (head.line != anchor.line) {
            leftSide = (head.line - anchor.line) * (cm.doc.direction == "ltr" ? 1 : -1) > 0;
        } else {
            var headIndex = getBidiPartAt(order, head.ch, head.sticky);
            var dir = headIndex - index || (head.ch - anchor.ch) * (part.level == 1 ? -1 : 1);
            if (headIndex == boundary - 1 || headIndex == boundary)
            { leftSide = dir < 0; }
            else
            { leftSide = dir > 0; }
        }

        var usePart = order[boundary + (leftSide ? -1 : 0)];
        var from = leftSide == (usePart.level == 1);
        var ch = from ? usePart.from : usePart.to, sticky = from ? "after" : "before";
        return anchor.ch == ch && anchor.sticky == sticky ? range : new Range(new Pos(anchor.line, ch, sticky), head)
    }


    // Determines whether an event happened in the gutter, and fires the
    // handlers for the corresponding event.
    function gutterEvent(cm, e, type, prevent) {
        var mX, mY;
        if (e.touches) {
            mX = e.touches[0].clientX;
            mY = e.touches[0].clientY;
        } else {
            try { mX = e.clientX; mY = e.clientY; }
            catch(e$1) { return false }
        }
        if (mX >= Math.floor(cm.display.gutters.getBoundingClientRect().right)) { return false }
        if (prevent) { e_preventDefault(e); }

        var display = cm.display;
        var lineBox = display.lineDiv.getBoundingClientRect();

        if (mY > lineBox.bottom || !hasHandler(cm, type)) { return e_defaultPrevented(e) }
        mY -= lineBox.top - display.viewOffset;

        for (var i = 0; i < cm.display.gutterSpecs.length; ++i) {
            var g = display.gutters.childNodes[i];
            if (g && g.getBoundingClientRect().right >= mX) {
                var line = lineAtHeight(cm.doc, mY);
                var gutter = cm.display.gutterSpecs[i];
                signal(cm, type, cm, line, gutter.className, e);
                return e_defaultPrevented(e)
            }
        }
    }

    function clickInGutter(cm, e) {
        return gutterEvent(cm, e, "gutterClick", true)
    }

    // CONTEXT MENU HANDLING

    // To make the context menu work, we need to briefly unhide the
    // textarea (making it as unobtrusive as possible) to let the
    // right-click take effect on it.
    function onContextMenu(cm, e) {
        if (eventInWidget(cm.display, e) || contextMenuInGutter(cm, e)) { return }
        if (signalDOMEvent(cm, e, "contextmenu")) { return }
        if (!captureRightClick) { cm.display.input.onContextMenu(e); }
    }

    function contextMenuInGutter(cm, e) {
        if (!hasHandler(cm, "gutterContextMenu")) { return false }
        return gutterEvent(cm, e, "gutterContextMenu", false)
    }

    function themeChanged(cm) {
        cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-s-\S+/g, "") +
            cm.options.theme.replace(/(^|\s)\s*/g, " cm-s-");
        clearCaches(cm);
    }

    var Init = {toString: function(){return "CodeMirror.Init"}};

    var defaults = {};
    var optionHandlers = {};

    function defineOptions(CodeMirror) {
        var optionHandlers = CodeMirror.optionHandlers;

        function option(name, deflt, handle, notOnInit) {
            CodeMirror.defaults[name] = deflt;
            if (handle) { optionHandlers[name] =
                notOnInit ? function (cm, val, old) {if (old != Init) { handle(cm, val, old); }} : handle; }
        }

        CodeMirror.defineOption = option;

        // Passed to option handlers when there is no old value.
        CodeMirror.Init = Init;

        // These two are, on init, called from the constructor because they
        // have to be initialized before the editor can start at all.
        option("value", "", function (cm, val) { return cm.setValue(val); }, true);
        option("mode", null, function (cm, val) {
            cm.doc.modeOption = val;
            loadMode(cm);
        }, true);

        option("indentUnit", 2, loadMode, true);
        option("indentWithTabs", false);
        option("smartIndent", true);
        option("tabSize", 4, function (cm) {
            resetModeState(cm);
            clearCaches(cm);
            regChange(cm);
        }, true);

        option("lineSeparator", null, function (cm, val) {
            cm.doc.lineSep = val;
            if (!val) { return }
            var newBreaks = [], lineNo = cm.doc.first;
            cm.doc.iter(function (line) {
                for (var pos = 0;;) {
                    var found = line.text.indexOf(val, pos);
                    if (found == -1) { break }
                    pos = found + val.length;
                    newBreaks.push(Pos(lineNo, found));
                }
                lineNo++;
            });
            for (var i = newBreaks.length - 1; i >= 0; i--)
            { replaceRange(cm.doc, val, newBreaks[i], Pos(newBreaks[i].line, newBreaks[i].ch + val.length)); }
        });
        option("specialChars", /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u2028\u2029\ufeff\ufff9-\ufffc]/g, function (cm, val, old) {
            cm.state.specialChars = new RegExp(val.source + (val.test("\t") ? "" : "|\t"), "g");
            if (old != Init) { cm.refresh(); }
        });
        option("specialCharPlaceholder", defaultSpecialCharPlaceholder, function (cm) { return cm.refresh(); }, true);
        option("electricChars", true);
        option("inputStyle", mobile ? "contenteditable" : "textarea", function () {
            throw new Error("inputStyle can not (yet) be changed in a running editor") // FIXME
        }, true);
        option("spellcheck", false, function (cm, val) { return cm.getInputField().spellcheck = val; }, true);
        option("autocorrect", false, function (cm, val) { return cm.getInputField().autocorrect = val; }, true);
        option("autocapitalize", false, function (cm, val) { return cm.getInputField().autocapitalize = val; }, true);
        option("rtlMoveVisually", !windows);
        option("wholeLineUpdateBefore", true);

        option("theme", "default", function (cm) {
            themeChanged(cm);
            updateGutters(cm);
        }, true);
        option("keyMap", "default", function (cm, val, old) {
            var next = getKeyMap(val);
            var prev = old != Init && getKeyMap(old);
            if (prev && prev.detach) { prev.detach(cm, next); }
            if (next.attach) { next.attach(cm, prev || null); }
        });
        option("extraKeys", null);
        option("configureMouse", null);

        option("lineWrapping", false, wrappingChanged, true);
        option("gutters", [], function (cm, val) {
            cm.display.gutterSpecs = getGutters(val, cm.options.lineNumbers);
            updateGutters(cm);
        }, true);
        option("fixedGutter", true, function (cm, val) {
            cm.display.gutters.style.left = val ? compensateForHScroll(cm.display) + "px" : "0";
            cm.refresh();
        }, true);
        option("coverGutterNextToScrollbar", false, function (cm) { return updateScrollbars(cm); }, true);
        option("scrollbarStyle", "native", function (cm) {
            initScrollbars(cm);
            updateScrollbars(cm);
            cm.display.scrollbars.setScrollTop(cm.doc.scrollTop);
            cm.display.scrollbars.setScrollLeft(cm.doc.scrollLeft);
        }, true);
        option("lineNumbers", false, function (cm, val) {
            cm.display.gutterSpecs = getGutters(cm.options.gutters, val);
            updateGutters(cm);
        }, true);
        option("firstLineNumber", 1, updateGutters, true);
        option("lineNumberFormatter", function (integer) { return integer; }, updateGutters, true);
        option("showCursorWhenSelecting", false, updateSelection, true);

        option("resetSelectionOnContextMenu", true);
        option("lineWiseCopyCut", true);
        option("pasteLinesPerSelection", true);
        option("selectionsMayTouch", false);

        option("readOnly", false, function (cm, val) {
            if (val == "nocursor") {
                onBlur(cm);
                cm.display.input.blur();
            }
            cm.display.input.readOnlyChanged(val);
        });

        option("screenReaderLabel", null, function (cm, val) {
            val = (val === '') ? null : val;
            cm.display.input.screenReaderLabelChanged(val);
        });

        option("disableInput", false, function (cm, val) {if (!val) { cm.display.input.reset(); }}, true);
        option("dragDrop", true, dragDropChanged);
        option("allowDropFileTypes", null);

        option("cursorBlinkRate", 530);
        option("cursorScrollMargin", 0);
        option("cursorHeight", 1, updateSelection, true);
        option("singleCursorHeightPerLine", true, updateSelection, true);
        option("workTime", 100);
        option("workDelay", 100);
        option("flattenSpans", true, resetModeState, true);
        option("addModeClass", false, resetModeState, true);
        option("pollInterval", 100);
        option("undoDepth", 200, function (cm, val) { return cm.doc.history.undoDepth = val; });
        option("historyEventDelay", 1250);
        option("viewportMargin", 10, function (cm) { return cm.refresh(); }, true);
        option("maxHighlightLength", 10000, resetModeState, true);
        option("moveInputWithCursor", true, function (cm, val) {
            if (!val) { cm.display.input.resetPosition(); }
        });

        option("tabindex", null, function (cm, val) { return cm.display.input.getField().tabIndex = val || ""; });
        option("autofocus", null);
        option("direction", "ltr", function (cm, val) { return cm.doc.setDirection(val); }, true);
        option("phrases", null);
    }

    function dragDropChanged(cm, value, old) {
        var wasOn = old && old != Init;
        if (!value != !wasOn) {
            var funcs = cm.display.dragFunctions;
            var toggle = value ? on : off;
            toggle(cm.display.scroller, "dragstart", funcs.start);
            toggle(cm.display.scroller, "dragenter", funcs.enter);
            toggle(cm.display.scroller, "dragover", funcs.over);
            toggle(cm.display.scroller, "dragleave", funcs.leave);
            toggle(cm.display.scroller, "drop", funcs.drop);
        }
    }

    function wrappingChanged(cm) {
        if (cm.options.lineWrapping) {
            addClass(cm.display.wrapper, "CodeMirror-wrap");
            cm.display.sizer.style.minWidth = "";
            cm.display.sizerWidth = null;
        } else {
            rmClass(cm.display.wrapper, "CodeMirror-wrap");
            findMaxLine(cm);
        }
        estimateLineHeights(cm);
        regChange(cm);
        clearCaches(cm);
        setTimeout(function () { return updateScrollbars(cm); }, 100);
    }

    // A CodeMirror instance represents an editor. This is the object
    // that user code is usually dealing with.

    function CodeMirror(place, options) {
        var this$1 = this;

        if (!(this instanceof CodeMirror)) { return new CodeMirror(place, options) }

        this.options = options = options ? copyObj(options) : {};
        // Determine effective options based on given values and defaults.
        copyObj(defaults, options, false);

        var doc = options.value;
        if (typeof doc == "string") { doc = new Doc(doc, options.mode, null, options.lineSeparator, options.direction); }
        else if (options.mode) { doc.modeOption = options.mode; }
        this.doc = doc;

        var input = new CodeMirror.inputStyles[options.inputStyle](this);
        var display = this.display = new Display(place, doc, input, options);
        display.wrapper.CodeMirror = this;
        themeChanged(this);
        if (options.lineWrapping)
        { this.display.wrapper.className += " CodeMirror-wrap"; }
        initScrollbars(this);

        this.state = {
            keyMaps: [],  // stores maps added by addKeyMap
            overlays: [], // highlighting overlays, as added by addOverlay
            modeGen: 0,   // bumped when mode/overlay changes, used to invalidate highlighting info
            overwrite: false,
            delayingBlurEvent: false,
            focused: false,
            suppressEdits: false, // used to disable editing during key handlers when in readOnly mode
            pasteIncoming: -1, cutIncoming: -1, // help recognize paste/cut edits in input.poll
            selectingText: false,
            draggingText: false,
            highlight: new Delayed(), // stores highlight worker timeout
            keySeq: null,  // Unfinished key sequence
            specialChars: null
        };

        if (options.autofocus && !mobile) { display.input.focus(); }

        // Override magic textarea content restore that IE sometimes does
        // on our hidden textarea on reload
        if (ie && ie_version < 11) { setTimeout(function () { return this$1.display.input.reset(true); }, 20); }

        registerEventHandlers(this);
        ensureGlobalHandlers();

        startOperation(this);
        this.curOp.forceUpdate = true;
        attachDoc(this, doc);

        if ((options.autofocus && !mobile) || this.hasFocus())
        { setTimeout(function () {
            if (this$1.hasFocus() && !this$1.state.focused) { onFocus(this$1); }
        }, 20); }
        else
        { onBlur(this); }

        for (var opt in optionHandlers) { if (optionHandlers.hasOwnProperty(opt))
        { optionHandlers[opt](this, options[opt], Init); } }
        maybeUpdateLineNumberWidth(this);
        if (options.finishInit) { options.finishInit(this); }
        for (var i = 0; i < initHooks.length; ++i) { initHooks[i](this); }
        endOperation(this);
        // Suppress optimizelegibility in Webkit, since it breaks text
        // measuring on line wrapping boundaries.
        if (webkit && options.lineWrapping &&
            getComputedStyle(display.lineDiv).textRendering == "optimizelegibility")
        { display.lineDiv.style.textRendering = "auto"; }
    }

    // The default configuration options.
    CodeMirror.defaults = defaults;
    // Functions to run when options are changed.
    CodeMirror.optionHandlers = optionHandlers;

    // Attach the necessary event handlers when initializing the editor
    function registerEventHandlers(cm) {
        var d = cm.display;
        on(d.scroller, "mousedown", operation(cm, onMouseDown));
        // Older IE's will not fire a second mousedown for a double click
        if (ie && ie_version < 11)
        { on(d.scroller, "dblclick", operation(cm, function (e) {
            if (signalDOMEvent(cm, e)) { return }
            var pos = posFromMouse(cm, e);
            if (!pos || clickInGutter(cm, e) || eventInWidget(cm.display, e)) { return }
            e_preventDefault(e);
            var word = cm.findWordAt(pos);
            extendSelection(cm.doc, word.anchor, word.head);
        })); }
        else
        { on(d.scroller, "dblclick", function (e) { return signalDOMEvent(cm, e) || e_preventDefault(e); }); }
        // Some browsers fire contextmenu *after* opening the menu, at
        // which point we can't mess with it anymore. Context menu is
        // handled in onMouseDown for these browsers.
        on(d.scroller, "contextmenu", function (e) { return onContextMenu(cm, e); });
        on(d.input.getField(), "contextmenu", function (e) {
            if (!d.scroller.contains(e.target)) { onContextMenu(cm, e); }
        });

        // Used to suppress mouse event handling when a touch happens
        var touchFinished, prevTouch = {end: 0};
        function finishTouch() {
            if (d.activeTouch) {
                touchFinished = setTimeout(function () { return d.activeTouch = null; }, 1000);
                prevTouch = d.activeTouch;
                prevTouch.end = +new Date;
            }
        }
        function isMouseLikeTouchEvent(e) {
            if (e.touches.length != 1) { return false }
            var touch = e.touches[0];
            return touch.radiusX <= 1 && touch.radiusY <= 1
        }
        function farAway(touch, other) {
            if (other.left == null) { return true }
            var dx = other.left - touch.left, dy = other.top - touch.top;
            return dx * dx + dy * dy > 20 * 20
        }
        on(d.scroller, "touchstart", function (e) {
            if (!signalDOMEvent(cm, e) && !isMouseLikeTouchEvent(e) && !clickInGutter(cm, e)) {
                d.input.ensurePolled();
                clearTimeout(touchFinished);
                var now = +new Date;
                d.activeTouch = {start: now, moved: false,
                    prev: now - prevTouch.end <= 300 ? prevTouch : null};
                if (e.touches.length == 1) {
                    d.activeTouch.left = e.touches[0].pageX;
                    d.activeTouch.top = e.touches[0].pageY;
                }
            }
        });
        on(d.scroller, "touchmove", function () {
            if (d.activeTouch) { d.activeTouch.moved = true; }
        });
        on(d.scroller, "touchend", function (e) {
            var touch = d.activeTouch;
            if (touch && !eventInWidget(d, e) && touch.left != null &&
                !touch.moved && new Date - touch.start < 300) {
                var pos = cm.coordsChar(d.activeTouch, "page"), range;
                if (!touch.prev || farAway(touch, touch.prev)) // Single tap
                { range = new Range(pos, pos); }
                else if (!touch.prev.prev || farAway(touch, touch.prev.prev)) // Double tap
                { range = cm.findWordAt(pos); }
                else // Triple tap
                { range = new Range(Pos(pos.line, 0), clipPos(cm.doc, Pos(pos.line + 1, 0))); }
                cm.setSelection(range.anchor, range.head);
                cm.focus();
                e_preventDefault(e);
            }
            finishTouch();
        });
        on(d.scroller, "touchcancel", finishTouch);

        // Sync scrolling between fake scrollbars and real scrollable
        // area, ensure viewport is updated when scrolling.
        on(d.scroller, "scroll", function () {
            if (d.scroller.clientHeight) {
                updateScrollTop(cm, d.scroller.scrollTop);
                setScrollLeft(cm, d.scroller.scrollLeft, true);
                signal(cm, "scroll", cm);
            }
        });

        // Listen to wheel events in order to try and update the viewport on time.
        on(d.scroller, "mousewheel", function (e) { return onScrollWheel(cm, e); });
        on(d.scroller, "DOMMouseScroll", function (e) { return onScrollWheel(cm, e); });

        // Prevent wrapper from ever scrolling
        on(d.wrapper, "scroll", function () { return d.wrapper.scrollTop = d.wrapper.scrollLeft = 0; });

        d.dragFunctions = {
            enter: function (e) {if (!signalDOMEvent(cm, e)) { e_stop(e); }},
            over: function (e) {if (!signalDOMEvent(cm, e)) { onDragOver(cm, e); e_stop(e); }},
            start: function (e) { return onDragStart(cm, e); },
            drop: operation(cm, onDrop),
            leave: function (e) {if (!signalDOMEvent(cm, e)) { clearDragCursor(cm); }}
        };

        var inp = d.input.getField();
        on(inp, "keyup", function (e) { return onKeyUp.call(cm, e); });
        on(inp, "keydown", operation(cm, onKeyDown));
        on(inp, "keypress", operation(cm, onKeyPress));
        on(inp, "focus", function (e) { return onFocus(cm, e); });
        on(inp, "blur", function (e) { return onBlur(cm, e); });
    }

    var initHooks = [];
    CodeMirror.defineInitHook = function (f) { return initHooks.push(f); };

    // Indent the given line. The how parameter can be "smart",
    // "add"/null, "subtract", or "prev". When aggressive is false
    // (typically set to true for forced single-line indents), empty
    // lines are not indented, and places where the mode returns Pass
    // are left alone.
    function indentLine(cm, n, how, aggressive) {
        var doc = cm.doc, state;
        if (how == null) { how = "add"; }
        if (how == "smart") {
            // Fall back to "prev" when the mode doesn't have an indentation
            // method.
            if (!doc.mode.indent) { how = "prev"; }
            else { state = getContextBefore(cm, n).state; }
        }

        var tabSize = cm.options.tabSize;
        var line = getLine(doc, n), curSpace = countColumn(line.text, null, tabSize);
        if (line.stateAfter) { line.stateAfter = null; }
        var curSpaceString = line.text.match(/^\s*/)[0], indentation;
        if (!aggressive && !/\S/.test(line.text)) {
            indentation = 0;
            how = "not";
        } else if (how == "smart") {
            indentation = doc.mode.indent(state, line.text.slice(curSpaceString.length), line.text);
            if (indentation == Pass || indentation > 150) {
                if (!aggressive) { return }
                how = "prev";
            }
        }
        if (how == "prev") {
            if (n > doc.first) { indentation = countColumn(getLine(doc, n-1).text, null, tabSize); }
            else { indentation = 0; }
        } else if (how == "add") {
            indentation = curSpace + cm.options.indentUnit;
        } else if (how == "subtract") {
            indentation = curSpace - cm.options.indentUnit;
        } else if (typeof how == "number") {
            indentation = curSpace + how;
        }
        indentation = Math.max(0, indentation);

        var indentString = "", pos = 0;
        if (cm.options.indentWithTabs)
        { for (var i = Math.floor(indentation / tabSize); i; --i) {pos += tabSize; indentString += "\t";} }
        if (pos < indentation) { indentString += spaceStr(indentation - pos); }

        if (indentString != curSpaceString) {
            replaceRange(doc, indentString, Pos(n, 0), Pos(n, curSpaceString.length), "+input");
            line.stateAfter = null;
            return true
        } else {
            // Ensure that, if the cursor was in the whitespace at the start
            // of the line, it is moved to the end of that space.
            for (var i$1 = 0; i$1 < doc.sel.ranges.length; i$1++) {
                var range = doc.sel.ranges[i$1];
                if (range.head.line == n && range.head.ch < curSpaceString.length) {
                    var pos$1 = Pos(n, curSpaceString.length);
                    replaceOneSelection(doc, i$1, new Range(pos$1, pos$1));
                    break
                }
            }
        }
    }

    // This will be set to a {lineWise: bool, text: [string]} object, so
    // that, when pasting, we know what kind of selections the copied
    // text was made out of.
    var lastCopied = null;

    function setLastCopied(newLastCopied) {
        lastCopied = newLastCopied;
    }

    function applyTextInput(cm, inserted, deleted, sel, origin) {
        var doc = cm.doc;
        cm.display.shift = false;
        if (!sel) { sel = doc.sel; }

        var recent = +new Date - 200;
        var paste = origin == "paste" || cm.state.pasteIncoming > recent;
        var textLines = splitLinesAuto(inserted), multiPaste = null;
        // When pasting N lines into N selections, insert one line per selection
        if (paste && sel.ranges.length > 1) {
            if (lastCopied && lastCopied.text.join("\n") == inserted) {
                if (sel.ranges.length % lastCopied.text.length == 0) {
                    multiPaste = [];
                    for (var i = 0; i < lastCopied.text.length; i++)
                    { multiPaste.push(doc.splitLines(lastCopied.text[i])); }
                }
            } else if (textLines.length == sel.ranges.length && cm.options.pasteLinesPerSelection) {
                multiPaste = map(textLines, function (l) { return [l]; });
            }
        }

        var updateInput = cm.curOp.updateInput;
        // Normal behavior is to insert the new text into every selection
        for (var i$1 = sel.ranges.length - 1; i$1 >= 0; i$1--) {
            var range = sel.ranges[i$1];
            var from = range.from(), to = range.to();
            if (range.empty()) {
                if (deleted && deleted > 0) // Handle deletion
                { from = Pos(from.line, from.ch - deleted); }
                else if (cm.state.overwrite && !paste) // Handle overwrite
                { to = Pos(to.line, Math.min(getLine(doc, to.line).text.length, to.ch + lst(textLines).length)); }
                else if (paste && lastCopied && lastCopied.lineWise && lastCopied.text.join("\n") == textLines.join("\n"))
                { from = to = Pos(from.line, 0); }
            }
            var changeEvent = {from: from, to: to, text: multiPaste ? multiPaste[i$1 % multiPaste.length] : textLines,
                origin: origin || (paste ? "paste" : cm.state.cutIncoming > recent ? "cut" : "+input")};
            makeChange(cm.doc, changeEvent);
            signalLater(cm, "inputRead", cm, changeEvent);
        }
        if (inserted && !paste)
        { triggerElectric(cm, inserted); }

        ensureCursorVisible(cm);
        if (cm.curOp.updateInput < 2) { cm.curOp.updateInput = updateInput; }
        cm.curOp.typing = true;
        cm.state.pasteIncoming = cm.state.cutIncoming = -1;
    }

    function handlePaste(e, cm) {
        var pasted = e.clipboardData && e.clipboardData.getData("Text");
        if (pasted) {
            e.preventDefault();
            if (!cm.isReadOnly() && !cm.options.disableInput)
            { runInOp(cm, function () { return applyTextInput(cm, pasted, 0, null, "paste"); }); }
            return true
        }
    }

    function triggerElectric(cm, inserted) {
        // When an 'electric' character is inserted, immediately trigger a reindent
        if (!cm.options.electricChars || !cm.options.smartIndent) { return }
        var sel = cm.doc.sel;

        for (var i = sel.ranges.length - 1; i >= 0; i--) {
            var range = sel.ranges[i];
            if (range.head.ch > 100 || (i && sel.ranges[i - 1].head.line == range.head.line)) { continue }
            var mode = cm.getModeAt(range.head);
            var indented = false;
            if (mode.electricChars) {
                for (var j = 0; j < mode.electricChars.length; j++)
                { if (inserted.indexOf(mode.electricChars.charAt(j)) > -1) {
                    indented = indentLine(cm, range.head.line, "smart");
                    break
                } }
            } else if (mode.electricInput) {
                if (mode.electricInput.test(getLine(cm.doc, range.head.line).text.slice(0, range.head.ch)))
                { indented = indentLine(cm, range.head.line, "smart"); }
            }
            if (indented) { signalLater(cm, "electricInput", cm, range.head.line); }
        }
    }

    function copyableRanges(cm) {
        var text = [], ranges = [];
        for (var i = 0; i < cm.doc.sel.ranges.length; i++) {
            var line = cm.doc.sel.ranges[i].head.line;
            var lineRange = {anchor: Pos(line, 0), head: Pos(line + 1, 0)};
            ranges.push(lineRange);
            text.push(cm.getRange(lineRange.anchor, lineRange.head));
        }
        return {text: text, ranges: ranges}
    }

    function disableBrowserMagic(field, spellcheck, autocorrect, autocapitalize) {
        field.setAttribute("autocorrect", autocorrect ? "" : "off");
        field.setAttribute("autocapitalize", autocapitalize ? "" : "off");
        field.setAttribute("spellcheck", !!spellcheck);
    }

    function hiddenTextarea() {
        var te = elt("textarea", null, null, "position: absolute; bottom: -1em; padding: 0; width: 1px; height: 1em; outline: none");
        var div = elt("div", [te], null, "overflow: hidden; position: relative; width: 3px; height: 0px;");
        // The textarea is kept positioned near the cursor to prevent the
        // fact that it'll be scrolled into view on input from scrolling
        // our fake cursor out of view. On webkit, when wrap=off, paste is
        // very slow. So make the area wide instead.
        if (webkit) { te.style.width = "1000px"; }
        else { te.setAttribute("wrap", "off"); }
        // If border: 0; -- iOS fails to open keyboard (issue #1287)
        if (ios) { te.style.border = "1px solid black"; }
        disableBrowserMagic(te);
        return div
    }

    // The publicly visible API. Note that methodOp(f) means
    // 'wrap f in an operation, performed on its `this` parameter'.

    // This is not the complete set of editor methods. Most of the
    // methods defined on the Doc type are also injected into
    // CodeMirror.prototype, for backwards compatibility and
    // convenience.

    function addEditorMethods(CodeMirror) {
        var optionHandlers = CodeMirror.optionHandlers;

        var helpers = CodeMirror.helpers = {};

        CodeMirror.prototype = {
            constructor: CodeMirror,
            focus: function(){window.focus(); this.display.input.focus();},

            setOption: function(option, value) {
                var options = this.options, old = options[option];
                if (options[option] == value && option != "mode") { return }
                options[option] = value;
                if (optionHandlers.hasOwnProperty(option))
                { operation(this, optionHandlers[option])(this, value, old); }
                signal(this, "optionChange", this, option);
            },

            getOption: function(option) {return this.options[option]},
            getDoc: function() {return this.doc},

            addKeyMap: function(map, bottom) {
                this.state.keyMaps[bottom ? "push" : "unshift"](getKeyMap(map));
            },
            removeKeyMap: function(map) {
                var maps = this.state.keyMaps;
                for (var i = 0; i < maps.length; ++i)
                { if (maps[i] == map || maps[i].name == map) {
                    maps.splice(i, 1);
                    return true
                } }
            },

            addOverlay: methodOp(function(spec, options) {
                var mode = spec.token ? spec : CodeMirror.getMode(this.options, spec);
                if (mode.startState) { throw new Error("Overlays may not be stateful.") }
                insertSorted(this.state.overlays,
                    {mode: mode, modeSpec: spec, opaque: options && options.opaque,
                        priority: (options && options.priority) || 0},
                    function (overlay) { return overlay.priority; });
                this.state.modeGen++;
                regChange(this);
            }),
            removeOverlay: methodOp(function(spec) {
                var overlays = this.state.overlays;
                for (var i = 0; i < overlays.length; ++i) {
                    var cur = overlays[i].modeSpec;
                    if (cur == spec || typeof spec == "string" && cur.name == spec) {
                        overlays.splice(i, 1);
                        this.state.modeGen++;
                        regChange(this);
                        return
                    }
                }
            }),

            indentLine: methodOp(function(n, dir, aggressive) {
                if (typeof dir != "string" && typeof dir != "number") {
                    if (dir == null) { dir = this.options.smartIndent ? "smart" : "prev"; }
                    else { dir = dir ? "add" : "subtract"; }
                }
                if (isLine(this.doc, n)) { indentLine(this, n, dir, aggressive); }
            }),
            indentSelection: methodOp(function(how) {
                var ranges = this.doc.sel.ranges, end = -1;
                for (var i = 0; i < ranges.length; i++) {
                    var range = ranges[i];
                    if (!range.empty()) {
                        var from = range.from(), to = range.to();
                        var start = Math.max(end, from.line);
                        end = Math.min(this.lastLine(), to.line - (to.ch ? 0 : 1)) + 1;
                        for (var j = start; j < end; ++j)
                        { indentLine(this, j, how); }
                        var newRanges = this.doc.sel.ranges;
                        if (from.ch == 0 && ranges.length == newRanges.length && newRanges[i].from().ch > 0)
                        { replaceOneSelection(this.doc, i, new Range(from, newRanges[i].to()), sel_dontScroll); }
                    } else if (range.head.line > end) {
                        indentLine(this, range.head.line, how, true);
                        end = range.head.line;
                        if (i == this.doc.sel.primIndex) { ensureCursorVisible(this); }
                    }
                }
            }),

            // Fetch the parser token for a given character. Useful for hacks
            // that want to inspect the mode state (say, for completion).
            getTokenAt: function(pos, precise) {
                return takeToken(this, pos, precise)
            },

            getLineTokens: function(line, precise) {
                return takeToken(this, Pos(line), precise, true)
            },

            getTokenTypeAt: function(pos) {
                pos = clipPos(this.doc, pos);
                var styles = getLineStyles(this, getLine(this.doc, pos.line));
                var before = 0, after = (styles.length - 1) / 2, ch = pos.ch;
                var type;
                if (ch == 0) { type = styles[2]; }
                else { for (;;) {
                    var mid = (before + after) >> 1;
                    if ((mid ? styles[mid * 2 - 1] : 0) >= ch) { after = mid; }
                    else if (styles[mid * 2 + 1] < ch) { before = mid + 1; }
                    else { type = styles[mid * 2 + 2]; break }
                } }
                var cut = type ? type.indexOf("overlay ") : -1;
                return cut < 0 ? type : cut == 0 ? null : type.slice(0, cut - 1)
            },

            getModeAt: function(pos) {
                var mode = this.doc.mode;
                if (!mode.innerMode) { return mode }
                return CodeMirror.innerMode(mode, this.getTokenAt(pos).state).mode
            },

            getHelper: function(pos, type) {
                return this.getHelpers(pos, type)[0]
            },

            getHelpers: function(pos, type) {
                var found = [];
                if (!helpers.hasOwnProperty(type)) { return found }
                var help = helpers[type], mode = this.getModeAt(pos);
                if (typeof mode[type] == "string") {
                    if (help[mode[type]]) { found.push(help[mode[type]]); }
                } else if (mode[type]) {
                    for (var i = 0; i < mode[type].length; i++) {
                        var val = help[mode[type][i]];
                        if (val) { found.push(val); }
                    }
                } else if (mode.helperType && help[mode.helperType]) {
                    found.push(help[mode.helperType]);
                } else if (help[mode.name]) {
                    found.push(help[mode.name]);
                }
                for (var i$1 = 0; i$1 < help._global.length; i$1++) {
                    var cur = help._global[i$1];
                    if (cur.pred(mode, this) && indexOf(found, cur.val) == -1)
                    { found.push(cur.val); }
                }
                return found
            },

            getStateAfter: function(line, precise) {
                var doc = this.doc;
                line = clipLine(doc, line == null ? doc.first + doc.size - 1: line);
                return getContextBefore(this, line + 1, precise).state
            },

            cursorCoords: function(start, mode) {
                var pos, range = this.doc.sel.primary();
                if (start == null) { pos = range.head; }
                else if (typeof start == "object") { pos = clipPos(this.doc, start); }
                else { pos = start ? range.from() : range.to(); }
                return cursorCoords(this, pos, mode || "page")
            },

            charCoords: function(pos, mode) {
                return charCoords(this, clipPos(this.doc, pos), mode || "page")
            },

            coordsChar: function(coords, mode) {
                coords = fromCoordSystem(this, coords, mode || "page");
                return coordsChar(this, coords.left, coords.top)
            },

            lineAtHeight: function(height, mode) {
                height = fromCoordSystem(this, {top: height, left: 0}, mode || "page").top;
                return lineAtHeight(this.doc, height + this.display.viewOffset)
            },
            heightAtLine: function(line, mode, includeWidgets) {
                var end = false, lineObj;
                if (typeof line == "number") {
                    var last = this.doc.first + this.doc.size - 1;
                    if (line < this.doc.first) { line = this.doc.first; }
                    else if (line > last) { line = last; end = true; }
                    lineObj = getLine(this.doc, line);
                } else {
                    lineObj = line;
                }
                return intoCoordSystem(this, lineObj, {top: 0, left: 0}, mode || "page", includeWidgets || end).top +
                    (end ? this.doc.height - heightAtLine(lineObj) : 0)
            },

            defaultTextHeight: function() { return textHeight(this.display) },
            defaultCharWidth: function() { return charWidth(this.display) },

            getViewport: function() { return {from: this.display.viewFrom, to: this.display.viewTo}},

            addWidget: function(pos, node, scroll, vert, horiz) {
                var display = this.display;
                pos = cursorCoords(this, clipPos(this.doc, pos));
                var top = pos.bottom, left = pos.left;
                node.style.position = "absolute";
                node.setAttribute("cm-ignore-events", "true");
                this.display.input.setUneditable(node);
                display.sizer.appendChild(node);
                if (vert == "over") {
                    top = pos.top;
                } else if (vert == "above" || vert == "near") {
                    var vspace = Math.max(display.wrapper.clientHeight, this.doc.height),
                        hspace = Math.max(display.sizer.clientWidth, display.lineSpace.clientWidth);
                    // Default to positioning above (if specified and possible); otherwise default to positioning below
                    if ((vert == 'above' || pos.bottom + node.offsetHeight > vspace) && pos.top > node.offsetHeight)
                    { top = pos.top - node.offsetHeight; }
                    else if (pos.bottom + node.offsetHeight <= vspace)
                    { top = pos.bottom; }
                    if (left + node.offsetWidth > hspace)
                    { left = hspace - node.offsetWidth; }
                }
                node.style.top = top + "px";
                node.style.left = node.style.right = "";
                if (horiz == "right") {
                    left = display.sizer.clientWidth - node.offsetWidth;
                    node.style.right = "0px";
                } else {
                    if (horiz == "left") { left = 0; }
                    else if (horiz == "middle") { left = (display.sizer.clientWidth - node.offsetWidth) / 2; }
                    node.style.left = left + "px";
                }
                if (scroll)
                { scrollIntoView(this, {left: left, top: top, right: left + node.offsetWidth, bottom: top + node.offsetHeight}); }
            },

            triggerOnKeyDown: methodOp(onKeyDown),
            triggerOnKeyPress: methodOp(onKeyPress),
            triggerOnKeyUp: onKeyUp,
            triggerOnMouseDown: methodOp(onMouseDown),

            execCommand: function(cmd) {
                if (commands.hasOwnProperty(cmd))
                { return commands[cmd].call(null, this) }
            },

            triggerElectric: methodOp(function(text) { triggerElectric(this, text); }),

            findPosH: function(from, amount, unit, visually) {
                var dir = 1;
                if (amount < 0) { dir = -1; amount = -amount; }
                var cur = clipPos(this.doc, from);
                for (var i = 0; i < amount; ++i) {
                    cur = findPosH(this.doc, cur, dir, unit, visually);
                    if (cur.hitSide) { break }
                }
                return cur
            },

            moveH: methodOp(function(dir, unit) {
                var this$1 = this;

                this.extendSelectionsBy(function (range) {
                    if (this$1.display.shift || this$1.doc.extend || range.empty())
                    { return findPosH(this$1.doc, range.head, dir, unit, this$1.options.rtlMoveVisually) }
                    else
                    { return dir < 0 ? range.from() : range.to() }
                }, sel_move);
            }),

            deleteH: methodOp(function(dir, unit) {
                var sel = this.doc.sel, doc = this.doc;
                if (sel.somethingSelected())
                { doc.replaceSelection("", null, "+delete"); }
                else
                { deleteNearSelection(this, function (range) {
                    var other = findPosH(doc, range.head, dir, unit, false);
                    return dir < 0 ? {from: other, to: range.head} : {from: range.head, to: other}
                }); }
            }),

            findPosV: function(from, amount, unit, goalColumn) {
                var dir = 1, x = goalColumn;
                if (amount < 0) { dir = -1; amount = -amount; }
                var cur = clipPos(this.doc, from);
                for (var i = 0; i < amount; ++i) {
                    var coords = cursorCoords(this, cur, "div");
                    if (x == null) { x = coords.left; }
                    else { coords.left = x; }
                    cur = findPosV(this, coords, dir, unit);
                    if (cur.hitSide) { break }
                }
                return cur
            },

            moveV: methodOp(function(dir, unit) {
                var this$1 = this;

                var doc = this.doc, goals = [];
                var collapse = !this.display.shift && !doc.extend && doc.sel.somethingSelected();
                doc.extendSelectionsBy(function (range) {
                    if (collapse)
                    { return dir < 0 ? range.from() : range.to() }
                    var headPos = cursorCoords(this$1, range.head, "div");
                    if (range.goalColumn != null) { headPos.left = range.goalColumn; }
                    goals.push(headPos.left);
                    var pos = findPosV(this$1, headPos, dir, unit);
                    if (unit == "page" && range == doc.sel.primary())
                    { addToScrollTop(this$1, charCoords(this$1, pos, "div").top - headPos.top); }
                    return pos
                }, sel_move);
                if (goals.length) { for (var i = 0; i < doc.sel.ranges.length; i++)
                { doc.sel.ranges[i].goalColumn = goals[i]; } }
            }),

            // Find the word at the given position (as returned by coordsChar).
            findWordAt: function(pos) {
                var doc = this.doc, line = getLine(doc, pos.line).text;
                var start = pos.ch, end = pos.ch;
                if (line) {
                    var helper = this.getHelper(pos, "wordChars");
                    if ((pos.sticky == "before" || end == line.length) && start) { --start; } else { ++end; }
                    var startChar = line.charAt(start);
                    var check = isWordChar(startChar, helper)
                        ? function (ch) { return isWordChar(ch, helper); }
                        : /\s/.test(startChar) ? function (ch) { return /\s/.test(ch); }
                            : function (ch) { return (!/\s/.test(ch) && !isWordChar(ch)); };
                    while (start > 0 && check(line.charAt(start - 1))) { --start; }
                    while (end < line.length && check(line.charAt(end))) { ++end; }
                }
                return new Range(Pos(pos.line, start), Pos(pos.line, end))
            },

            toggleOverwrite: function(value) {
                if (value != null && value == this.state.overwrite) { return }
                if (this.state.overwrite = !this.state.overwrite)
                { addClass(this.display.cursorDiv, "CodeMirror-overwrite"); }
                else
                { rmClass(this.display.cursorDiv, "CodeMirror-overwrite"); }

                signal(this, "overwriteToggle", this, this.state.overwrite);
            },
            hasFocus: function() { return this.display.input.getField() == activeElt() },
            isReadOnly: function() { return !!(this.options.readOnly || this.doc.cantEdit) },

            scrollTo: methodOp(function (x, y) { scrollToCoords(this, x, y); }),
            getScrollInfo: function() {
                var scroller = this.display.scroller;
                return {left: scroller.scrollLeft, top: scroller.scrollTop,
                    height: scroller.scrollHeight - scrollGap(this) - this.display.barHeight,
                    width: scroller.scrollWidth - scrollGap(this) - this.display.barWidth,
                    clientHeight: displayHeight(this), clientWidth: displayWidth(this)}
            },

            scrollIntoView: methodOp(function(range, margin) {
                if (range == null) {
                    range = {from: this.doc.sel.primary().head, to: null};
                    if (margin == null) { margin = this.options.cursorScrollMargin; }
                } else if (typeof range == "number") {
                    range = {from: Pos(range, 0), to: null};
                } else if (range.from == null) {
                    range = {from: range, to: null};
                }
                if (!range.to) { range.to = range.from; }
                range.margin = margin || 0;

                if (range.from.line != null) {
                    scrollToRange(this, range);
                } else {
                    scrollToCoordsRange(this, range.from, range.to, range.margin);
                }
            }),

            setSize: methodOp(function(width, height) {
                var this$1 = this;

                var interpret = function (val) { return typeof val == "number" || /^\d+$/.test(String(val)) ? val + "px" : val; };
                if (width != null) { this.display.wrapper.style.width = interpret(width); }
                if (height != null) { this.display.wrapper.style.height = interpret(height); }
                if (this.options.lineWrapping) { clearLineMeasurementCache(this); }
                var lineNo = this.display.viewFrom;
                this.doc.iter(lineNo, this.display.viewTo, function (line) {
                    if (line.widgets) { for (var i = 0; i < line.widgets.length; i++)
                    { if (line.widgets[i].noHScroll) { regLineChange(this$1, lineNo, "widget"); break } } }
                    ++lineNo;
                });
                this.curOp.forceUpdate = true;
                signal(this, "refresh", this);
            }),

            operation: function(f){return runInOp(this, f)},
            startOperation: function(){return startOperation(this)},
            endOperation: function(){return endOperation(this)},

            refresh: methodOp(function() {
                var oldHeight = this.display.cachedTextHeight;
                regChange(this);
                this.curOp.forceUpdate = true;
                clearCaches(this);
                scrollToCoords(this, this.doc.scrollLeft, this.doc.scrollTop);
                updateGutterSpace(this.display);
                if (oldHeight == null || Math.abs(oldHeight - textHeight(this.display)) > .5 || this.options.lineWrapping)
                { estimateLineHeights(this); }
                signal(this, "refresh", this);
            }),

            swapDoc: methodOp(function(doc) {
                var old = this.doc;
                old.cm = null;
                // Cancel the current text selection if any (#5821)
                if (this.state.selectingText) { this.state.selectingText(); }
                attachDoc(this, doc);
                clearCaches(this);
                this.display.input.reset();
                scrollToCoords(this, doc.scrollLeft, doc.scrollTop);
                this.curOp.forceScroll = true;
                signalLater(this, "swapDoc", this, old);
                return old
            }),

            phrase: function(phraseText) {
                var phrases = this.options.phrases;
                return phrases && Object.prototype.hasOwnProperty.call(phrases, phraseText) ? phrases[phraseText] : phraseText
            },

            getInputField: function(){return this.display.input.getField()},
            getWrapperElement: function(){return this.display.wrapper},
            getScrollerElement: function(){return this.display.scroller},
            getGutterElement: function(){return this.display.gutters}
        };
        eventMixin(CodeMirror);

        CodeMirror.registerHelper = function(type, name, value) {
            if (!helpers.hasOwnProperty(type)) { helpers[type] = CodeMirror[type] = {_global: []}; }
            helpers[type][name] = value;
        };
        CodeMirror.registerGlobalHelper = function(type, name, predicate, value) {
            CodeMirror.registerHelper(type, name, value);
            helpers[type]._global.push({pred: predicate, val: value});
        };
    }

    // Used for horizontal relative motion. Dir is -1 or 1 (left or
    // right), unit can be "codepoint", "char", "column" (like char, but
    // doesn't cross line boundaries), "word" (across next word), or
    // "group" (to the start of next group of word or
    // non-word-non-whitespace chars). The visually param controls
    // whether, in right-to-left text, direction 1 means to move towards
    // the next index in the string, or towards the character to the right
    // of the current position. The resulting position will have a
    // hitSide=true property if it reached the end of the document.
    function findPosH(doc, pos, dir, unit, visually) {
        var oldPos = pos;
        var origDir = dir;
        var lineObj = getLine(doc, pos.line);
        var lineDir = visually && doc.direction == "rtl" ? -dir : dir;
        function findNextLine() {
            var l = pos.line + lineDir;
            if (l < doc.first || l >= doc.first + doc.size) { return false }
            pos = new Pos(l, pos.ch, pos.sticky);
            return lineObj = getLine(doc, l)
        }
        function moveOnce(boundToLine) {
            var next;
            if (unit == "codepoint") {
                var ch = lineObj.text.charCodeAt(pos.ch + (dir > 0 ? 0 : -1));
                if (isNaN(ch)) {
                    next = null;
                } else {
                    var astral = dir > 0 ? ch >= 0xD800 && ch < 0xDC00 : ch >= 0xDC00 && ch < 0xDFFF;
                    next = new Pos(pos.line, Math.max(0, Math.min(lineObj.text.length, pos.ch + dir * (astral ? 2 : 1))), -dir);
                }
            } else if (visually) {
                next = moveVisually(doc.cm, lineObj, pos, dir);
            } else {
                next = moveLogically(lineObj, pos, dir);
            }
            if (next == null) {
                if (!boundToLine && findNextLine())
                { pos = endOfLine(visually, doc.cm, lineObj, pos.line, lineDir); }
                else
                { return false }
            } else {
                pos = next;
            }
            return true
        }

        if (unit == "char" || unit == "codepoint") {
            moveOnce();
        } else if (unit == "column") {
            moveOnce(true);
        } else if (unit == "word" || unit == "group") {
            var sawType = null, group = unit == "group";
            var helper = doc.cm && doc.cm.getHelper(pos, "wordChars");
            for (var first = true;; first = false) {
                if (dir < 0 && !moveOnce(!first)) { break }
                var cur = lineObj.text.charAt(pos.ch) || "\n";
                var type = isWordChar(cur, helper) ? "w"
                    : group && cur == "\n" ? "n"
                        : !group || /\s/.test(cur) ? null
                            : "p";
                if (group && !first && !type) { type = "s"; }
                if (sawType && sawType != type) {
                    if (dir < 0) {dir = 1; moveOnce(); pos.sticky = "after";}
                    break
                }

                if (type) { sawType = type; }
                if (dir > 0 && !moveOnce(!first)) { break }
            }
        }
        var result = skipAtomic(doc, pos, oldPos, origDir, true);
        if (equalCursorPos(oldPos, result)) { result.hitSide = true; }
        return result
    }

    // For relative vertical movement. Dir may be -1 or 1. Unit can be
    // "page" or "line". The resulting position will have a hitSide=true
    // property if it reached the end of the document.
    function findPosV(cm, pos, dir, unit) {
        var doc = cm.doc, x = pos.left, y;
        if (unit == "page") {
            var pageSize = Math.min(cm.display.wrapper.clientHeight, window.innerHeight || document.documentElement.clientHeight);
            var moveAmount = Math.max(pageSize - .5 * textHeight(cm.display), 3);
            y = (dir > 0 ? pos.bottom : pos.top) + dir * moveAmount;

        } else if (unit == "line") {
            y = dir > 0 ? pos.bottom + 3 : pos.top - 3;
        }
        var target;
        for (;;) {
            target = coordsChar(cm, x, y);
            if (!target.outside) { break }
            if (dir < 0 ? y <= 0 : y >= doc.height) { target.hitSide = true; break }
            y += dir * 5;
        }
        return target
    }

    // CONTENTEDITABLE INPUT STYLE

    var ContentEditableInput = function(cm) {
        this.cm = cm;
        this.lastAnchorNode = this.lastAnchorOffset = this.lastFocusNode = this.lastFocusOffset = null;
        this.polling = new Delayed();
        this.composing = null;
        this.gracePeriod = false;
        this.readDOMTimeout = null;
    };

    ContentEditableInput.prototype.init = function (display) {
        var this$1 = this;

        var input = this, cm = input.cm;
        var div = input.div = display.lineDiv;
        disableBrowserMagic(div, cm.options.spellcheck, cm.options.autocorrect, cm.options.autocapitalize);

        function belongsToInput(e) {
            for (var t = e.target; t; t = t.parentNode) {
                if (t == div) { return true }
                if (/\bCodeMirror-(?:line)?widget\b/.test(t.className)) { break }
            }
            return false
        }

        on(div, "paste", function (e) {
            if (!belongsToInput(e) || signalDOMEvent(cm, e) || handlePaste(e, cm)) { return }
            // IE doesn't fire input events, so we schedule a read for the pasted content in this way
            if (ie_version <= 11) { setTimeout(operation(cm, function () { return this$1.updateFromDOM(); }), 20); }
        });

        on(div, "compositionstart", function (e) {
            this$1.composing = {data: e.data, done: false};
        });
        on(div, "compositionupdate", function (e) {
            if (!this$1.composing) { this$1.composing = {data: e.data, done: false}; }
        });
        on(div, "compositionend", function (e) {
            if (this$1.composing) {
                if (e.data != this$1.composing.data) { this$1.readFromDOMSoon(); }
                this$1.composing.done = true;
            }
        });

        on(div, "touchstart", function () { return input.forceCompositionEnd(); });

        on(div, "input", function () {
            if (!this$1.composing) { this$1.readFromDOMSoon(); }
        });

        function onCopyCut(e) {
            if (!belongsToInput(e) || signalDOMEvent(cm, e)) { return }
            if (cm.somethingSelected()) {
                setLastCopied({lineWise: false, text: cm.getSelections()});
                if (e.type == "cut") { cm.replaceSelection("", null, "cut"); }
            } else if (!cm.options.lineWiseCopyCut) {
                return
            } else {
                var ranges = copyableRanges(cm);
                setLastCopied({lineWise: true, text: ranges.text});
                if (e.type == "cut") {
                    cm.operation(function () {
                        cm.setSelections(ranges.ranges, 0, sel_dontScroll);
                        cm.replaceSelection("", null, "cut");
                    });
                }
            }
            if (e.clipboardData) {
                e.clipboardData.clearData();
                var content = lastCopied.text.join("\n");
                // iOS exposes the clipboard API, but seems to discard content inserted into it
                e.clipboardData.setData("Text", content);
                if (e.clipboardData.getData("Text") == content) {
                    e.preventDefault();
                    return
                }
            }
            // Old-fashioned briefly-focus-a-textarea hack
            var kludge = hiddenTextarea(), te = kludge.firstChild;
            cm.display.lineSpace.insertBefore(kludge, cm.display.lineSpace.firstChild);
            te.value = lastCopied.text.join("\n");
            var hadFocus = document.activeElement;
            selectInput(te);
            setTimeout(function () {
                cm.display.lineSpace.removeChild(kludge);
                hadFocus.focus();
                if (hadFocus == div) { input.showPrimarySelection(); }
            }, 50);
        }
        on(div, "copy", onCopyCut);
        on(div, "cut", onCopyCut);
    };

    ContentEditableInput.prototype.screenReaderLabelChanged = function (label) {
        // Label for screenreaders, accessibility
        if(label) {
            this.div.setAttribute('aria-label', label);
        } else {
            this.div.removeAttribute('aria-label');
        }
    };

    ContentEditableInput.prototype.prepareSelection = function () {
        var result = prepareSelection(this.cm, false);
        result.focus = document.activeElement == this.div;
        return result
    };

    ContentEditableInput.prototype.showSelection = function (info, takeFocus) {
        if (!info || !this.cm.display.view.length) { return }
        if (info.focus || takeFocus) { this.showPrimarySelection(); }
        this.showMultipleSelections(info);
    };

    ContentEditableInput.prototype.getSelection = function () {
        return this.cm.display.wrapper.ownerDocument.getSelection()
    };

    ContentEditableInput.prototype.showPrimarySelection = function () {
        var sel = this.getSelection(), cm = this.cm, prim = cm.doc.sel.primary();
        var from = prim.from(), to = prim.to();

        if (cm.display.viewTo == cm.display.viewFrom || from.line >= cm.display.viewTo || to.line < cm.display.viewFrom) {
            sel.removeAllRanges();
            return
        }

        var curAnchor = domToPos(cm, sel.anchorNode, sel.anchorOffset);
        var curFocus = domToPos(cm, sel.focusNode, sel.focusOffset);
        if (curAnchor && !curAnchor.bad && curFocus && !curFocus.bad &&
            cmp(minPos(curAnchor, curFocus), from) == 0 &&
            cmp(maxPos(curAnchor, curFocus), to) == 0)
        { return }

        var view = cm.display.view;
        var start = (from.line >= cm.display.viewFrom && posToDOM(cm, from)) ||
            {node: view[0].measure.map[2], offset: 0};
        var end = to.line < cm.display.viewTo && posToDOM(cm, to);
        if (!end) {
            var measure = view[view.length - 1].measure;
            var map = measure.maps ? measure.maps[measure.maps.length - 1] : measure.map;
            end = {node: map[map.length - 1], offset: map[map.length - 2] - map[map.length - 3]};
        }

        if (!start || !end) {
            sel.removeAllRanges();
            return
        }

        var old = sel.rangeCount && sel.getRangeAt(0), rng;
        try { rng = range(start.node, start.offset, end.offset, end.node); }
        catch(e) {} // Our model of the DOM might be outdated, in which case the range we try to set can be impossible
        if (rng) {
            if (!gecko && cm.state.focused) {
                sel.collapse(start.node, start.offset);
                if (!rng.collapsed) {
                    sel.removeAllRanges();
                    sel.addRange(rng);
                }
            } else {
                sel.removeAllRanges();
                sel.addRange(rng);
            }
            if (old && sel.anchorNode == null) { sel.addRange(old); }
            else if (gecko) { this.startGracePeriod(); }
        }
        this.rememberSelection();
    };

    ContentEditableInput.prototype.startGracePeriod = function () {
        var this$1 = this;

        clearTimeout(this.gracePeriod);
        this.gracePeriod = setTimeout(function () {
            this$1.gracePeriod = false;
            if (this$1.selectionChanged())
            { this$1.cm.operation(function () { return this$1.cm.curOp.selectionChanged = true; }); }
        }, 20);
    };

    ContentEditableInput.prototype.showMultipleSelections = function (info) {
        removeChildrenAndAdd(this.cm.display.cursorDiv, info.cursors);
        removeChildrenAndAdd(this.cm.display.selectionDiv, info.selection);
    };

    ContentEditableInput.prototype.rememberSelection = function () {
        var sel = this.getSelection();
        this.lastAnchorNode = sel.anchorNode; this.lastAnchorOffset = sel.anchorOffset;
        this.lastFocusNode = sel.focusNode; this.lastFocusOffset = sel.focusOffset;
    };

    ContentEditableInput.prototype.selectionInEditor = function () {
        var sel = this.getSelection();
        if (!sel.rangeCount) { return false }
        var node = sel.getRangeAt(0).commonAncestorContainer;
        return contains(this.div, node)
    };

    ContentEditableInput.prototype.focus = function () {
        if (this.cm.options.readOnly != "nocursor") {
            if (!this.selectionInEditor() || document.activeElement != this.div)
            { this.showSelection(this.prepareSelection(), true); }
            this.div.focus();
        }
    };
    ContentEditableInput.prototype.blur = function () { this.div.blur(); };
    ContentEditableInput.prototype.getField = function () { return this.div };

    ContentEditableInput.prototype.supportsTouch = function () { return true };

    ContentEditableInput.prototype.receivedFocus = function () {
        var input = this;
        if (this.selectionInEditor())
        { this.pollSelection(); }
        else
        { runInOp(this.cm, function () { return input.cm.curOp.selectionChanged = true; }); }

        function poll() {
            if (input.cm.state.focused) {
                input.pollSelection();
                input.polling.set(input.cm.options.pollInterval, poll);
            }
        }
        this.polling.set(this.cm.options.pollInterval, poll);
    };

    ContentEditableInput.prototype.selectionChanged = function () {
        var sel = this.getSelection();
        return sel.anchorNode != this.lastAnchorNode || sel.anchorOffset != this.lastAnchorOffset ||
            sel.focusNode != this.lastFocusNode || sel.focusOffset != this.lastFocusOffset
    };

    ContentEditableInput.prototype.pollSelection = function () {
        if (this.readDOMTimeout != null || this.gracePeriod || !this.selectionChanged()) { return }
        var sel = this.getSelection(), cm = this.cm;
        // On Android Chrome (version 56, at least), backspacing into an
        // uneditable block element will put the cursor in that element,
        // and then, because it's not editable, hide the virtual keyboard.
        // Because Android doesn't allow us to actually detect backspace
        // presses in a sane way, this code checks for when that happens
        // and simulates a backspace press in this case.
        if (android && chrome && this.cm.display.gutterSpecs.length && isInGutter(sel.anchorNode)) {
            this.cm.triggerOnKeyDown({type: "keydown", keyCode: 8, preventDefault: Math.abs});
            this.blur();
            this.focus();
            return
        }
        if (this.composing) { return }
        this.rememberSelection();
        var anchor = domToPos(cm, sel.anchorNode, sel.anchorOffset);
        var head = domToPos(cm, sel.focusNode, sel.focusOffset);
        if (anchor && head) { runInOp(cm, function () {
            setSelection(cm.doc, simpleSelection(anchor, head), sel_dontScroll);
            if (anchor.bad || head.bad) { cm.curOp.selectionChanged = true; }
        }); }
    };

    ContentEditableInput.prototype.pollContent = function () {
        if (this.readDOMTimeout != null) {
            clearTimeout(this.readDOMTimeout);
            this.readDOMTimeout = null;
        }

        var cm = this.cm, display = cm.display, sel = cm.doc.sel.primary();
        var from = sel.from(), to = sel.to();
        if (from.ch == 0 && from.line > cm.firstLine())
        { from = Pos(from.line - 1, getLine(cm.doc, from.line - 1).length); }
        if (to.ch == getLine(cm.doc, to.line).text.length && to.line < cm.lastLine())
        { to = Pos(to.line + 1, 0); }
        if (from.line < display.viewFrom || to.line > display.viewTo - 1) { return false }

        var fromIndex, fromLine, fromNode;
        if (from.line == display.viewFrom || (fromIndex = findViewIndex(cm, from.line)) == 0) {
            fromLine = lineNo(display.view[0].line);
            fromNode = display.view[0].node;
        } else {
            fromLine = lineNo(display.view[fromIndex].line);
            fromNode = display.view[fromIndex - 1].node.nextSibling;
        }
        var toIndex = findViewIndex(cm, to.line);
        var toLine, toNode;
        if (toIndex == display.view.length - 1) {
            toLine = display.viewTo - 1;
            toNode = display.lineDiv.lastChild;
        } else {
            toLine = lineNo(display.view[toIndex + 1].line) - 1;
            toNode = display.view[toIndex + 1].node.previousSibling;
        }

        if (!fromNode) { return false }
        var newText = cm.doc.splitLines(domTextBetween(cm, fromNode, toNode, fromLine, toLine));
        var oldText = getBetween(cm.doc, Pos(fromLine, 0), Pos(toLine, getLine(cm.doc, toLine).text.length));
        while (newText.length > 1 && oldText.length > 1) {
            if (lst(newText) == lst(oldText)) { newText.pop(); oldText.pop(); toLine--; }
            else if (newText[0] == oldText[0]) { newText.shift(); oldText.shift(); fromLine++; }
            else { break }
        }

        var cutFront = 0, cutEnd = 0;
        var newTop = newText[0], oldTop = oldText[0], maxCutFront = Math.min(newTop.length, oldTop.length);
        while (cutFront < maxCutFront && newTop.charCodeAt(cutFront) == oldTop.charCodeAt(cutFront))
        { ++cutFront; }
        var newBot = lst(newText), oldBot = lst(oldText);
        var maxCutEnd = Math.min(newBot.length - (newText.length == 1 ? cutFront : 0),
            oldBot.length - (oldText.length == 1 ? cutFront : 0));
        while (cutEnd < maxCutEnd &&
        newBot.charCodeAt(newBot.length - cutEnd - 1) == oldBot.charCodeAt(oldBot.length - cutEnd - 1))
        { ++cutEnd; }
        // Try to move start of change to start of selection if ambiguous
        if (newText.length == 1 && oldText.length == 1 && fromLine == from.line) {
            while (cutFront && cutFront > from.ch &&
            newBot.charCodeAt(newBot.length - cutEnd - 1) == oldBot.charCodeAt(oldBot.length - cutEnd - 1)) {
                cutFront--;
                cutEnd++;
            }
        }

        newText[newText.length - 1] = newBot.slice(0, newBot.length - cutEnd).replace(/^\u200b+/, "");
        newText[0] = newText[0].slice(cutFront).replace(/\u200b+$/, "");

        var chFrom = Pos(fromLine, cutFront);
        var chTo = Pos(toLine, oldText.length ? lst(oldText).length - cutEnd : 0);
        if (newText.length > 1 || newText[0] || cmp(chFrom, chTo)) {
            replaceRange(cm.doc, newText, chFrom, chTo, "+input");
            return true
        }
    };

    ContentEditableInput.prototype.ensurePolled = function () {
        this.forceCompositionEnd();
    };
    ContentEditableInput.prototype.reset = function () {
        this.forceCompositionEnd();
    };
    ContentEditableInput.prototype.forceCompositionEnd = function () {
        if (!this.composing) { return }
        clearTimeout(this.readDOMTimeout);
        this.composing = null;
        this.updateFromDOM();
        this.div.blur();
        this.div.focus();
    };
    ContentEditableInput.prototype.readFromDOMSoon = function () {
        var this$1 = this;

        if (this.readDOMTimeout != null) { return }
        this.readDOMTimeout = setTimeout(function () {
            this$1.readDOMTimeout = null;
            if (this$1.composing) {
                if (this$1.composing.done) { this$1.composing = null; }
                else { return }
            }
            this$1.updateFromDOM();
        }, 80);
    };

    ContentEditableInput.prototype.updateFromDOM = function () {
        var this$1 = this;

        if (this.cm.isReadOnly() || !this.pollContent())
        { runInOp(this.cm, function () { return regChange(this$1.cm); }); }
    };

    ContentEditableInput.prototype.setUneditable = function (node) {
        node.contentEditable = "false";
    };

    ContentEditableInput.prototype.onKeyPress = function (e) {
        if (e.charCode == 0 || this.composing) { return }
        e.preventDefault();
        if (!this.cm.isReadOnly())
        { operation(this.cm, applyTextInput)(this.cm, String.fromCharCode(e.charCode == null ? e.keyCode : e.charCode), 0); }
    };

    ContentEditableInput.prototype.readOnlyChanged = function (val) {
        this.div.contentEditable = String(val != "nocursor");
    };

    ContentEditableInput.prototype.onContextMenu = function () {};
    ContentEditableInput.prototype.resetPosition = function () {};

    ContentEditableInput.prototype.needsContentAttribute = true;

    function posToDOM(cm, pos) {
        var view = findViewForLine(cm, pos.line);
        if (!view || view.hidden) { return null }
        var line = getLine(cm.doc, pos.line);
        var info = mapFromLineView(view, line, pos.line);

        var order = getOrder(line, cm.doc.direction), side = "left";
        if (order) {
            var partPos = getBidiPartAt(order, pos.ch);
            side = partPos % 2 ? "right" : "left";
        }
        var result = nodeAndOffsetInLineMap(info.map, pos.ch, side);
        result.offset = result.collapse == "right" ? result.end : result.start;
        return result
    }

    function isInGutter(node) {
        for (var scan = node; scan; scan = scan.parentNode)
        { if (/CodeMirror-gutter-wrapper/.test(scan.className)) { return true } }
        return false
    }

    function badPos(pos, bad) { if (bad) { pos.bad = true; } return pos }

    function domTextBetween(cm, from, to, fromLine, toLine) {
        var text = "", closing = false, lineSep = cm.doc.lineSeparator(), extraLinebreak = false;
        function recognizeMarker(id) { return function (marker) { return marker.id == id; } }
        function close() {
            if (closing) {
                text += lineSep;
                if (extraLinebreak) { text += lineSep; }
                closing = extraLinebreak = false;
            }
        }
        function addText(str) {
            if (str) {
                close();
                text += str;
            }
        }
        function walk(node) {
            if (node.nodeType == 1) {
                var cmText = node.getAttribute("cm-text");
                if (cmText) {
                    addText(cmText);
                    return
                }
                var markerID = node.getAttribute("cm-marker"), range;
                if (markerID) {
                    var found = cm.findMarks(Pos(fromLine, 0), Pos(toLine + 1, 0), recognizeMarker(+markerID));
                    if (found.length && (range = found[0].find(0)))
                    { addText(getBetween(cm.doc, range.from, range.to).join(lineSep)); }
                    return
                }
                if (node.getAttribute("contenteditable") == "false") { return }
                var isBlock = /^(pre|div|p|li|table|br)$/i.test(node.nodeName);
                if (!/^br$/i.test(node.nodeName) && node.textContent.length == 0) { return }

                if (isBlock) { close(); }
                for (var i = 0; i < node.childNodes.length; i++)
                { walk(node.childNodes[i]); }

                if (/^(pre|p)$/i.test(node.nodeName)) { extraLinebreak = true; }
                if (isBlock) { closing = true; }
            } else if (node.nodeType == 3) {
                addText(node.nodeValue.replace(/\u200b/g, "").replace(/\u00a0/g, " "));
            }
        }
        for (;;) {
            walk(from);
            if (from == to) { break }
            from = from.nextSibling;
            extraLinebreak = false;
        }
        return text
    }

    function domToPos(cm, node, offset) {
        var lineNode;
        if (node == cm.display.lineDiv) {
            lineNode = cm.display.lineDiv.childNodes[offset];
            if (!lineNode) { return badPos(cm.clipPos(Pos(cm.display.viewTo - 1)), true) }
            node = null; offset = 0;
        } else {
            for (lineNode = node;; lineNode = lineNode.parentNode) {
                if (!lineNode || lineNode == cm.display.lineDiv) { return null }
                if (lineNode.parentNode && lineNode.parentNode == cm.display.lineDiv) { break }
            }
        }
        for (var i = 0; i < cm.display.view.length; i++) {
            var lineView = cm.display.view[i];
            if (lineView.node == lineNode)
            { return locateNodeInLineView(lineView, node, offset) }
        }
    }

    function locateNodeInLineView(lineView, node, offset) {
        var wrapper = lineView.text.firstChild, bad = false;
        if (!node || !contains(wrapper, node)) { return badPos(Pos(lineNo(lineView.line), 0), true) }
        if (node == wrapper) {
            bad = true;
            node = wrapper.childNodes[offset];
            offset = 0;
            if (!node) {
                var line = lineView.rest ? lst(lineView.rest) : lineView.line;
                return badPos(Pos(lineNo(line), line.text.length), bad)
            }
        }

        var textNode = node.nodeType == 3 ? node : null, topNode = node;
        if (!textNode && node.childNodes.length == 1 && node.firstChild.nodeType == 3) {
            textNode = node.firstChild;
            if (offset) { offset = textNode.nodeValue.length; }
        }
        while (topNode.parentNode != wrapper) { topNode = topNode.parentNode; }
        var measure = lineView.measure, maps = measure.maps;

        function find(textNode, topNode, offset) {
            for (var i = -1; i < (maps ? maps.length : 0); i++) {
                var map = i < 0 ? measure.map : maps[i];
                for (var j = 0; j < map.length; j += 3) {
                    var curNode = map[j + 2];
                    if (curNode == textNode || curNode == topNode) {
                        var line = lineNo(i < 0 ? lineView.line : lineView.rest[i]);
                        var ch = map[j] + offset;
                        if (offset < 0 || curNode != textNode) { ch = map[j + (offset ? 1 : 0)]; }
                        return Pos(line, ch)
                    }
                }
            }
        }
        var found = find(textNode, topNode, offset);
        if (found) { return badPos(found, bad) }

        // FIXME this is all really shaky. might handle the few cases it needs to handle, but likely to cause problems
        for (var after = topNode.nextSibling, dist = textNode ? textNode.nodeValue.length - offset : 0; after; after = after.nextSibling) {
            found = find(after, after.firstChild, 0);
            if (found)
            { return badPos(Pos(found.line, found.ch - dist), bad) }
            else
            { dist += after.textContent.length; }
        }
        for (var before = topNode.previousSibling, dist$1 = offset; before; before = before.previousSibling) {
            found = find(before, before.firstChild, -1);
            if (found)
            { return badPos(Pos(found.line, found.ch + dist$1), bad) }
            else
            { dist$1 += before.textContent.length; }
        }
    }

    // TEXTAREA INPUT STYLE

    var TextareaInput = function(cm) {
        this.cm = cm;
        // See input.poll and input.reset
        this.prevInput = "";

        // Flag that indicates whether we expect input to appear real soon
        // now (after some event like 'keypress' or 'input') and are
        // polling intensively.
        this.pollingFast = false;
        // Self-resetting timeout for the poller
        this.polling = new Delayed();
        // Used to work around IE issue with selection being forgotten when focus moves away from textarea
        this.hasSelection = false;
        this.composing = null;
    };

    TextareaInput.prototype.init = function (display) {
        var this$1 = this;

        var input = this, cm = this.cm;
        this.createField(display);
        var te = this.textarea;

        display.wrapper.insertBefore(this.wrapper, display.wrapper.firstChild);

        // Needed to hide big blue blinking cursor on Mobile Safari (doesn't seem to work in iOS 8 anymore)
        if (ios) { te.style.width = "0px"; }

        on(te, "input", function () {
            if (ie && ie_version >= 9 && this$1.hasSelection) { this$1.hasSelection = null; }
            input.poll();
        });

        on(te, "paste", function (e) {
            if (signalDOMEvent(cm, e) || handlePaste(e, cm)) { return }

            cm.state.pasteIncoming = +new Date;
            input.fastPoll();
        });

        function prepareCopyCut(e) {
            if (signalDOMEvent(cm, e)) { return }
            if (cm.somethingSelected()) {
                setLastCopied({lineWise: false, text: cm.getSelections()});
            } else if (!cm.options.lineWiseCopyCut) {
                return
            } else {
                var ranges = copyableRanges(cm);
                setLastCopied({lineWise: true, text: ranges.text});
                if (e.type == "cut") {
                    cm.setSelections(ranges.ranges, null, sel_dontScroll);
                } else {
                    input.prevInput = "";
                    te.value = ranges.text.join("\n");
                    selectInput(te);
                }
            }
            if (e.type == "cut") { cm.state.cutIncoming = +new Date; }
        }
        on(te, "cut", prepareCopyCut);
        on(te, "copy", prepareCopyCut);

        on(display.scroller, "paste", function (e) {
            if (eventInWidget(display, e) || signalDOMEvent(cm, e)) { return }
            if (!te.dispatchEvent) {
                cm.state.pasteIncoming = +new Date;
                input.focus();
                return
            }

            // Pass the `paste` event to the textarea so it's handled by its event listener.
            var event = new Event("paste");
            event.clipboardData = e.clipboardData;
            te.dispatchEvent(event);
        });

        // Prevent normal selection in the editor (we handle our own)
        on(display.lineSpace, "selectstart", function (e) {
            if (!eventInWidget(display, e)) { e_preventDefault(e); }
        });

        on(te, "compositionstart", function () {
            var start = cm.getCursor("from");
            if (input.composing) { input.composing.range.clear(); }
            input.composing = {
                start: start,
                range: cm.markText(start, cm.getCursor("to"), {className: "CodeMirror-composing"})
            };
        });
        on(te, "compositionend", function () {
            if (input.composing) {
                input.poll();
                input.composing.range.clear();
                input.composing = null;
            }
        });
    };

    TextareaInput.prototype.createField = function (_display) {
        // Wraps and hides input textarea
        this.wrapper = hiddenTextarea();
        // The semihidden textarea that is focused when the editor is
        // focused, and receives input.
        this.textarea = this.wrapper.firstChild;
    };

    TextareaInput.prototype.screenReaderLabelChanged = function (label) {
        // Label for screenreaders, accessibility
        if(label) {
            this.textarea.setAttribute('aria-label', label);
        } else {
            this.textarea.removeAttribute('aria-label');
        }
    };

    TextareaInput.prototype.prepareSelection = function () {
        // Redraw the selection and/or cursor
        var cm = this.cm, display = cm.display, doc = cm.doc;
        var result = prepareSelection(cm);

        // Move the hidden textarea near the cursor to prevent scrolling artifacts
        if (cm.options.moveInputWithCursor) {
            var headPos = cursorCoords(cm, doc.sel.primary().head, "div");
            var wrapOff = display.wrapper.getBoundingClientRect(), lineOff = display.lineDiv.getBoundingClientRect();
            result.teTop = Math.max(0, Math.min(display.wrapper.clientHeight - 10,
                headPos.top + lineOff.top - wrapOff.top));
            result.teLeft = Math.max(0, Math.min(display.wrapper.clientWidth - 10,
                headPos.left + lineOff.left - wrapOff.left));
        }

        return result
    };

    TextareaInput.prototype.showSelection = function (drawn) {
        var cm = this.cm, display = cm.display;
        removeChildrenAndAdd(display.cursorDiv, drawn.cursors);
        removeChildrenAndAdd(display.selectionDiv, drawn.selection);
        if (drawn.teTop != null) {
            this.wrapper.style.top = drawn.teTop + "px";
            this.wrapper.style.left = drawn.teLeft + "px";
        }
    };

    // Reset the input to correspond to the selection (or to be empty,
    // when not typing and nothing is selected)
    TextareaInput.prototype.reset = function (typing) {
        if (this.contextMenuPending || this.composing) { return }
        var cm = this.cm;
        if (cm.somethingSelected()) {
            this.prevInput = "";
            var content = cm.getSelection();
            this.textarea.value = content;
            if (cm.state.focused) { selectInput(this.textarea); }
            if (ie && ie_version >= 9) { this.hasSelection = content; }
        } else if (!typing) {
            this.prevInput = this.textarea.value = "";
            if (ie && ie_version >= 9) { this.hasSelection = null; }
        }
    };

    TextareaInput.prototype.getField = function () { return this.textarea };

    TextareaInput.prototype.supportsTouch = function () { return false };

    TextareaInput.prototype.focus = function () {
        if (this.cm.options.readOnly != "nocursor" && (!mobile || activeElt() != this.textarea)) {
            try { this.textarea.focus(); }
            catch (e) {} // IE8 will throw if the textarea is display: none or not in DOM
        }
    };

    TextareaInput.prototype.blur = function () { this.textarea.blur(); };

    TextareaInput.prototype.resetPosition = function () {
        this.wrapper.style.top = this.wrapper.style.left = 0;
    };

    TextareaInput.prototype.receivedFocus = function () { this.slowPoll(); };

    // Poll for input changes, using the normal rate of polling. This
    // runs as long as the editor is focused.
    TextareaInput.prototype.slowPoll = function () {
        var this$1 = this;

        if (this.pollingFast) { return }
        this.polling.set(this.cm.options.pollInterval, function () {
            this$1.poll();
            if (this$1.cm.state.focused) { this$1.slowPoll(); }
        });
    };

    // When an event has just come in that is likely to add or change
    // something in the input textarea, we poll faster, to ensure that
    // the change appears on the screen quickly.
    TextareaInput.prototype.fastPoll = function () {
        var missed = false, input = this;
        input.pollingFast = true;
        function p() {
            var changed = input.poll();
            if (!changed && !missed) {missed = true; input.polling.set(60, p);}
            else {input.pollingFast = false; input.slowPoll();}
        }
        input.polling.set(20, p);
    };

    // Read input from the textarea, and update the document to match.
    // When something is selected, it is present in the textarea, and
    // selected (unless it is huge, in which case a placeholder is
    // used). When nothing is selected, the cursor sits after previously
    // seen text (can be empty), which is stored in prevInput (we must
    // not reset the textarea when typing, because that breaks IME).
    TextareaInput.prototype.poll = function () {
        var this$1 = this;

        var cm = this.cm, input = this.textarea, prevInput = this.prevInput;
        // Since this is called a *lot*, try to bail out as cheaply as
        // possible when it is clear that nothing happened. hasSelection
        // will be the case when there is a lot of text in the textarea,
        // in which case reading its value would be expensive.
        if (this.contextMenuPending || !cm.state.focused ||
            (hasSelection(input) && !prevInput && !this.composing) ||
            cm.isReadOnly() || cm.options.disableInput || cm.state.keySeq)
        { return false }

        var text = input.value;
        // If nothing changed, bail.
        if (text == prevInput && !cm.somethingSelected()) { return false }
        // Work around nonsensical selection resetting in IE9/10, and
        // inexplicable appearance of private area unicode characters on
        // some key combos in Mac (#2689).
        if (ie && ie_version >= 9 && this.hasSelection === text ||
            mac && /[\uf700-\uf7ff]/.test(text)) {
            cm.display.input.reset();
            return false
        }

        if (cm.doc.sel == cm.display.selForContextMenu) {
            var first = text.charCodeAt(0);
            if (first == 0x200b && !prevInput) { prevInput = "\u200b"; }
            if (first == 0x21da) { this.reset(); return this.cm.execCommand("undo") }
        }
        // Find the part of the input that is actually new
        var same = 0, l = Math.min(prevInput.length, text.length);
        while (same < l && prevInput.charCodeAt(same) == text.charCodeAt(same)) { ++same; }

        runInOp(cm, function () {
            applyTextInput(cm, text.slice(same), prevInput.length - same,
                null, this$1.composing ? "*compose" : null);

            // Don't leave long text in the textarea, since it makes further polling slow
            if (text.length > 1000 || text.indexOf("\n") > -1) { input.value = this$1.prevInput = ""; }
            else { this$1.prevInput = text; }

            if (this$1.composing) {
                this$1.composing.range.clear();
                this$1.composing.range = cm.markText(this$1.composing.start, cm.getCursor("to"),
                    {className: "CodeMirror-composing"});
            }
        });
        return true
    };

    TextareaInput.prototype.ensurePolled = function () {
        if (this.pollingFast && this.poll()) { this.pollingFast = false; }
    };

    TextareaInput.prototype.onKeyPress = function () {
        if (ie && ie_version >= 9) { this.hasSelection = null; }
        this.fastPoll();
    };

    TextareaInput.prototype.onContextMenu = function (e) {
        var input = this, cm = input.cm, display = cm.display, te = input.textarea;
        if (input.contextMenuPending) { input.contextMenuPending(); }
        var pos = posFromMouse(cm, e), scrollPos = display.scroller.scrollTop;
        if (!pos || presto) { return } // Opera is difficult.

        // Reset the current text selection only if the click is done outside of the selection
        // and 'resetSelectionOnContextMenu' option is true.
        var reset = cm.options.resetSelectionOnContextMenu;
        if (reset && cm.doc.sel.contains(pos) == -1)
        { operation(cm, setSelection)(cm.doc, simpleSelection(pos), sel_dontScroll); }

        var oldCSS = te.style.cssText, oldWrapperCSS = input.wrapper.style.cssText;
        var wrapperBox = input.wrapper.offsetParent.getBoundingClientRect();
        input.wrapper.style.cssText = "position: static";
        te.style.cssText = "position: absolute; width: 30px; height: 30px;\n      top: " + (e.clientY - wrapperBox.top - 5) + "px; left: " + (e.clientX - wrapperBox.left - 5) + "px;\n      z-index: 1000; background: " + (ie ? "rgba(255, 255, 255, .05)" : "transparent") + ";\n      outline: none; border-width: 0; outline: none; overflow: hidden; opacity: .05; filter: alpha(opacity=5);";
        var oldScrollY;
        if (webkit) { oldScrollY = window.scrollY; } // Work around Chrome issue (#2712)
        display.input.focus();
        if (webkit) { window.scrollTo(null, oldScrollY); }
        display.input.reset();
        // Adds "Select all" to context menu in FF
        if (!cm.somethingSelected()) { te.value = input.prevInput = " "; }
        input.contextMenuPending = rehide;
        display.selForContextMenu = cm.doc.sel;
        clearTimeout(display.detectingSelectAll);

        // Select-all will be greyed out if there's nothing to select, so
        // this adds a zero-width space so that we can later check whether
        // it got selected.
        function prepareSelectAllHack() {
            if (te.selectionStart != null) {
                var selected = cm.somethingSelected();
                var extval = "\u200b" + (selected ? te.value : "");
                te.value = "\u21da"; // Used to catch context-menu undo
                te.value = extval;
                input.prevInput = selected ? "" : "\u200b";
                te.selectionStart = 1; te.selectionEnd = extval.length;
                // Re-set this, in case some other handler touched the
                // selection in the meantime.
                display.selForContextMenu = cm.doc.sel;
            }
        }
        function rehide() {
            if (input.contextMenuPending != rehide) { return }
            input.contextMenuPending = false;
            input.wrapper.style.cssText = oldWrapperCSS;
            te.style.cssText = oldCSS;
            if (ie && ie_version < 9) { display.scrollbars.setScrollTop(display.scroller.scrollTop = scrollPos); }

            // Try to detect the user choosing select-all
            if (te.selectionStart != null) {
                if (!ie || (ie && ie_version < 9)) { prepareSelectAllHack(); }
                var i = 0, poll = function () {
                    if (display.selForContextMenu == cm.doc.sel && te.selectionStart == 0 &&
                        te.selectionEnd > 0 && input.prevInput == "\u200b") {
                        operation(cm, selectAll)(cm);
                    } else if (i++ < 10) {
                        display.detectingSelectAll = setTimeout(poll, 500);
                    } else {
                        display.selForContextMenu = null;
                        display.input.reset();
                    }
                };
                display.detectingSelectAll = setTimeout(poll, 200);
            }
        }

        if (ie && ie_version >= 9) { prepareSelectAllHack(); }
        if (captureRightClick) {
            e_stop(e);
            var mouseup = function () {
                off(window, "mouseup", mouseup);
                setTimeout(rehide, 20);
            };
            on(window, "mouseup", mouseup);
        } else {
            setTimeout(rehide, 50);
        }
    };

    TextareaInput.prototype.readOnlyChanged = function (val) {
        if (!val) { this.reset(); }
        this.textarea.disabled = val == "nocursor";
        this.textarea.readOnly = !!val;
    };

    TextareaInput.prototype.setUneditable = function () {};

    TextareaInput.prototype.needsContentAttribute = false;

    function fromTextArea(textarea, options) {
        options = options ? copyObj(options) : {};
        options.value = textarea.value;
        if (!options.tabindex && textarea.tabIndex)
        { options.tabindex = textarea.tabIndex; }
        if (!options.placeholder && textarea.placeholder)
        { options.placeholder = textarea.placeholder; }
        // Set autofocus to true if this textarea is focused, or if it has
        // autofocus and no other element is focused.
        if (options.autofocus == null) {
            var hasFocus = activeElt();
            options.autofocus = hasFocus == textarea ||
                textarea.getAttribute("autofocus") != null && hasFocus == document.body;
        }

        function save() {textarea.value = cm.getValue();}

        var realSubmit;
        if (textarea.form) {
            on(textarea.form, "submit", save);
            // Deplorable hack to make the submit method do the right thing.
            if (!options.leaveSubmitMethodAlone) {
                var form = textarea.form;
                realSubmit = form.submit;
                try {
                    var wrappedSubmit = form.submit = function () {
                        save();
                        form.submit = realSubmit;
                        form.submit();
                        form.submit = wrappedSubmit;
                    };
                } catch(e) {}
            }
        }

        options.finishInit = function (cm) {
            cm.save = save;
            cm.getTextArea = function () { return textarea; };
            cm.toTextArea = function () {
                cm.toTextArea = isNaN; // Prevent this from being ran twice
                save();
                textarea.parentNode.removeChild(cm.getWrapperElement());
                textarea.style.display = "";
                if (textarea.form) {
                    off(textarea.form, "submit", save);
                    if (!options.leaveSubmitMethodAlone && typeof textarea.form.submit == "function")
                    { textarea.form.submit = realSubmit; }
                }
            };
        };

        textarea.style.display = "none";
        var cm = CodeMirror(function (node) { return textarea.parentNode.insertBefore(node, textarea.nextSibling); },
            options);
        return cm
    }

    function addLegacyProps(CodeMirror) {
        CodeMirror.off = off;
        CodeMirror.on = on;
        CodeMirror.wheelEventPixels = wheelEventPixels;
        CodeMirror.Doc = Doc;
        CodeMirror.splitLines = splitLinesAuto;
        CodeMirror.countColumn = countColumn;
        CodeMirror.findColumn = findColumn;
        CodeMirror.isWordChar = isWordCharBasic;
        CodeMirror.Pass = Pass;
        CodeMirror.signal = signal;
        CodeMirror.Line = Line;
        CodeMirror.changeEnd = changeEnd;
        CodeMirror.scrollbarModel = scrollbarModel;
        CodeMirror.Pos = Pos;
        CodeMirror.cmpPos = cmp;
        CodeMirror.modes = modes;
        CodeMirror.mimeModes = mimeModes;
        CodeMirror.resolveMode = resolveMode;
        CodeMirror.getMode = getMode;
        CodeMirror.modeExtensions = modeExtensions;
        CodeMirror.extendMode = extendMode;
        CodeMirror.copyState = copyState;
        CodeMirror.startState = startState;
        CodeMirror.innerMode = innerMode;
        CodeMirror.commands = commands;
        CodeMirror.keyMap = keyMap;
        CodeMirror.keyName = keyName;
        CodeMirror.isModifierKey = isModifierKey;
        CodeMirror.lookupKey = lookupKey;
        CodeMirror.normalizeKeyMap = normalizeKeyMap;
        CodeMirror.StringStream = StringStream;
        CodeMirror.SharedTextMarker = SharedTextMarker;
        CodeMirror.TextMarker = TextMarker;
        CodeMirror.LineWidget = LineWidget;
        CodeMirror.e_preventDefault = e_preventDefault;
        CodeMirror.e_stopPropagation = e_stopPropagation;
        CodeMirror.e_stop = e_stop;
        CodeMirror.addClass = addClass;
        CodeMirror.contains = contains;
        CodeMirror.rmClass = rmClass;
        CodeMirror.keyNames = keyNames;
    }

    // EDITOR CONSTRUCTOR

    defineOptions(CodeMirror);

    addEditorMethods(CodeMirror);

    // Set up methods on CodeMirror's prototype to redirect to the editor's document.
    var dontDelegate = "iter insert remove copy getEditor constructor".split(" ");
    for (var prop in Doc.prototype) { if (Doc.prototype.hasOwnProperty(prop) && indexOf(dontDelegate, prop) < 0)
    { CodeMirror.prototype[prop] = (function(method) {
        return function() {return method.apply(this.doc, arguments)}
    })(Doc.prototype[prop]); } }

    eventMixin(Doc);
    CodeMirror.inputStyles = {"textarea": TextareaInput, "contenteditable": ContentEditableInput};

    // Extra arguments are stored as the mode's dependencies, which is
    // used by (legacy) mechanisms like loadmode.js to automatically
    // load a mode. (Preferred mechanism is the require/define calls.)
    CodeMirror.defineMode = function(name/*, mode, …*/) {
        if (!CodeMirror.defaults.mode && name != "null") { CodeMirror.defaults.mode = name; }
        defineMode.apply(this, arguments);
    };

    CodeMirror.defineMIME = defineMIME;

    // Minimal default mode.
    CodeMirror.defineMode("null", function () { return ({token: function (stream) { return stream.skipToEnd(); }}); });
    CodeMirror.defineMIME("text/plain", "null");

    // EXTENSIONS

    CodeMirror.defineExtension = function (name, func) {
        CodeMirror.prototype[name] = func;
    };
    CodeMirror.defineDocExtension = function (name, func) {
        Doc.prototype[name] = func;
    };

    CodeMirror.fromTextArea = fromTextArea;

    addLegacyProps(CodeMirror);

    CodeMirror.version = "5.59.2";

    return CodeMirror;

})));
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/LICENSE

(function(mod) {
    if (typeof exports == "object" && typeof module == "object") // CommonJS
        mod(require("../../lib/codemirror"), require("../xml/xml"), require("../javascript/javascript"), require("../css/css"));
    else if (typeof define == "function" && define.amd) // AMD
        define(["../../lib/codemirror", "../xml/xml", "../javascript/javascript", "../css/css"], mod);
    else // Plain browser env
        mod(CodeMirror);
})(function(CodeMirror) {
    "use strict";

    var defaultTags = {
        script: [
            ["lang", /(javascript|babel)/i, "javascript"],
            ["type", /^(?:text|application)\/(?:x-)?(?:java|ecma)script$|^module$|^$/i, "javascript"],
            ["type", /./, "text/plain"],
            [null, null, "javascript"]
        ],
        style:  [
            ["lang", /^css$/i, "css"],
            ["type", /^(text\/)?(x-)?(stylesheet|css)$/i, "css"],
            ["type", /./, "text/plain"],
            [null, null, "css"]
        ]
    };

    function maybeBackup(stream, pat, style) {
        var cur = stream.current(), close = cur.search(pat);
        if (close > -1) {
            stream.backUp(cur.length - close);
        } else if (cur.match(/<\/?$/)) {
            stream.backUp(cur.length);
            if (!stream.match(pat, false)) stream.match(cur);
        }
        return style;
    }

    var attrRegexpCache = {};
    function getAttrRegexp(attr) {
        var regexp = attrRegexpCache[attr];
        if (regexp) return regexp;
        return attrRegexpCache[attr] = new RegExp("\\s+" + attr + "\\s*=\\s*('|\")?([^'\"]+)('|\")?\\s*");
    }

    function getAttrValue(text, attr) {
        var match = text.match(getAttrRegexp(attr))
        return match ? /^\s*(.*?)\s*$/.exec(match[2])[1] : ""
    }

    function getTagRegexp(tagName, anchored) {
        return new RegExp((anchored ? "^" : "") + "<\/\s*" + tagName + "\s*>", "i");
    }

    function addTags(from, to) {
        for (var tag in from) {
            var dest = to[tag] || (to[tag] = []);
            var source = from[tag];
            for (var i = source.length - 1; i >= 0; i--)
                dest.unshift(source[i])
        }
    }

    function findMatchingMode(tagInfo, tagText) {
        for (var i = 0; i < tagInfo.length; i++) {
            var spec = tagInfo[i];
            if (!spec[0] || spec[1].test(getAttrValue(tagText, spec[0]))) return spec[2];
        }
    }

    CodeMirror.defineMode("htmlmixed", function (config, parserConfig) {
        var htmlMode = CodeMirror.getMode(config, {
            name: "xml",
            htmlMode: true,
            multilineTagIndentFactor: parserConfig.multilineTagIndentFactor,
            multilineTagIndentPastTag: parserConfig.multilineTagIndentPastTag,
            allowMissingTagName: parserConfig.allowMissingTagName,
        });

        var tags = {};
        var configTags = parserConfig && parserConfig.tags, configScript = parserConfig && parserConfig.scriptTypes;
        addTags(defaultTags, tags);
        if (configTags) addTags(configTags, tags);
        if (configScript) for (var i = configScript.length - 1; i >= 0; i--)
            tags.script.unshift(["type", configScript[i].matches, configScript[i].mode])

        function html(stream, state) {
            var style = htmlMode.token(stream, state.htmlState), tag = /\btag\b/.test(style), tagName
            if (tag && !/[<>\s\/]/.test(stream.current()) &&
                (tagName = state.htmlState.tagName && state.htmlState.tagName.toLowerCase()) &&
                tags.hasOwnProperty(tagName)) {
                state.inTag = tagName + " "
            } else if (state.inTag && tag && />$/.test(stream.current())) {
                var inTag = /^([\S]+) (.*)/.exec(state.inTag)
                state.inTag = null
                var modeSpec = stream.current() == ">" && findMatchingMode(tags[inTag[1]], inTag[2])
                var mode = CodeMirror.getMode(config, modeSpec)
                var endTagA = getTagRegexp(inTag[1], true), endTag = getTagRegexp(inTag[1], false);
                state.token = function (stream, state) {
                    if (stream.match(endTagA, false)) {
                        state.token = html;
                        state.localState = state.localMode = null;
                        return null;
                    }
                    return maybeBackup(stream, endTag, state.localMode.token(stream, state.localState));
                };
                state.localMode = mode;
                state.localState = CodeMirror.startState(mode, htmlMode.indent(state.htmlState, "", ""));
            } else if (state.inTag) {
                state.inTag += stream.current()
                if (stream.eol()) state.inTag += " "
            }
            return style;
        };

        return {
            startState: function () {
                var state = CodeMirror.startState(htmlMode);
                return {token: html, inTag: null, localMode: null, localState: null, htmlState: state};
            },

            copyState: function (state) {
                var local;
                if (state.localState) {
                    local = CodeMirror.copyState(state.localMode, state.localState);
                }
                return {token: state.token, inTag: state.inTag,
                    localMode: state.localMode, localState: local,
                    htmlState: CodeMirror.copyState(htmlMode, state.htmlState)};
            },

            token: function (stream, state) {
                return state.token(stream, state);
            },

            indent: function (state, textAfter, line) {
                if (!state.localMode || /^\s*<\//.test(textAfter))
                    return htmlMode.indent(state.htmlState, textAfter, line);
                else if (state.localMode.indent)
                    return state.localMode.indent(state.localState, textAfter, line);
                else
                    return CodeMirror.Pass;
            },

            innerMode: function (state) {
                return {state: state.localState || state.htmlState, mode: state.localMode || htmlMode};
            }
        };
    }, "xml", "javascript", "css");

    CodeMirror.defineMIME("text/html", "htmlmixed");
});
/*!
 * Chart.js v2.9.4
 * https://www.chartjs.org
 * (c) 2020 Chart.js Contributors
 * Released under the MIT License
 */
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t=t||self).Chart=e()}(this,(function(){"use strict";"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self&&self;function t(){throw new Error("Dynamic requires are not currently supported by rollup-plugin-commonjs")}function e(t,e){return t(e={exports:{}},e.exports),e.exports}var n={aliceblue:[240,248,255],antiquewhite:[250,235,215],aqua:[0,255,255],aquamarine:[127,255,212],azure:[240,255,255],beige:[245,245,220],bisque:[255,228,196],black:[0,0,0],blanchedalmond:[255,235,205],blue:[0,0,255],blueviolet:[138,43,226],brown:[165,42,42],burlywood:[222,184,135],cadetblue:[95,158,160],chartreuse:[127,255,0],chocolate:[210,105,30],coral:[255,127,80],cornflowerblue:[100,149,237],cornsilk:[255,248,220],crimson:[220,20,60],cyan:[0,255,255],darkblue:[0,0,139],darkcyan:[0,139,139],darkgoldenrod:[184,134,11],darkgray:[169,169,169],darkgreen:[0,100,0],darkgrey:[169,169,169],darkkhaki:[189,183,107],darkmagenta:[139,0,139],darkolivegreen:[85,107,47],darkorange:[255,140,0],darkorchid:[153,50,204],darkred:[139,0,0],darksalmon:[233,150,122],darkseagreen:[143,188,143],darkslateblue:[72,61,139],darkslategray:[47,79,79],darkslategrey:[47,79,79],darkturquoise:[0,206,209],darkviolet:[148,0,211],deeppink:[255,20,147],deepskyblue:[0,191,255],dimgray:[105,105,105],dimgrey:[105,105,105],dodgerblue:[30,144,255],firebrick:[178,34,34],floralwhite:[255,250,240],forestgreen:[34,139,34],fuchsia:[255,0,255],gainsboro:[220,220,220],ghostwhite:[248,248,255],gold:[255,215,0],goldenrod:[218,165,32],gray:[128,128,128],green:[0,128,0],greenyellow:[173,255,47],grey:[128,128,128],honeydew:[240,255,240],hotpink:[255,105,180],indianred:[205,92,92],indigo:[75,0,130],ivory:[255,255,240],khaki:[240,230,140],lavender:[230,230,250],lavenderblush:[255,240,245],lawngreen:[124,252,0],lemonchiffon:[255,250,205],lightblue:[173,216,230],lightcoral:[240,128,128],lightcyan:[224,255,255],lightgoldenrodyellow:[250,250,210],lightgray:[211,211,211],lightgreen:[144,238,144],lightgrey:[211,211,211],lightpink:[255,182,193],lightsalmon:[255,160,122],lightseagreen:[32,178,170],lightskyblue:[135,206,250],lightslategray:[119,136,153],lightslategrey:[119,136,153],lightsteelblue:[176,196,222],lightyellow:[255,255,224],lime:[0,255,0],limegreen:[50,205,50],linen:[250,240,230],magenta:[255,0,255],maroon:[128,0,0],mediumaquamarine:[102,205,170],mediumblue:[0,0,205],mediumorchid:[186,85,211],mediumpurple:[147,112,219],mediumseagreen:[60,179,113],mediumslateblue:[123,104,238],mediumspringgreen:[0,250,154],mediumturquoise:[72,209,204],mediumvioletred:[199,21,133],midnightblue:[25,25,112],mintcream:[245,255,250],mistyrose:[255,228,225],moccasin:[255,228,181],navajowhite:[255,222,173],navy:[0,0,128],oldlace:[253,245,230],olive:[128,128,0],olivedrab:[107,142,35],orange:[255,165,0],orangered:[255,69,0],orchid:[218,112,214],palegoldenrod:[238,232,170],palegreen:[152,251,152],paleturquoise:[175,238,238],palevioletred:[219,112,147],papayawhip:[255,239,213],peachpuff:[255,218,185],peru:[205,133,63],pink:[255,192,203],plum:[221,160,221],powderblue:[176,224,230],purple:[128,0,128],rebeccapurple:[102,51,153],red:[255,0,0],rosybrown:[188,143,143],royalblue:[65,105,225],saddlebrown:[139,69,19],salmon:[250,128,114],sandybrown:[244,164,96],seagreen:[46,139,87],seashell:[255,245,238],sienna:[160,82,45],silver:[192,192,192],skyblue:[135,206,235],slateblue:[106,90,205],slategray:[112,128,144],slategrey:[112,128,144],snow:[255,250,250],springgreen:[0,255,127],steelblue:[70,130,180],tan:[210,180,140],teal:[0,128,128],thistle:[216,191,216],tomato:[255,99,71],turquoise:[64,224,208],violet:[238,130,238],wheat:[245,222,179],white:[255,255,255],whitesmoke:[245,245,245],yellow:[255,255,0],yellowgreen:[154,205,50]},i=e((function(t){var e={};for(var i in n)n.hasOwnProperty(i)&&(e[n[i]]=i);var a=t.exports={rgb:{channels:3,labels:"rgb"},hsl:{channels:3,labels:"hsl"},hsv:{channels:3,labels:"hsv"},hwb:{channels:3,labels:"hwb"},cmyk:{channels:4,labels:"cmyk"},xyz:{channels:3,labels:"xyz"},lab:{channels:3,labels:"lab"},lch:{channels:3,labels:"lch"},hex:{channels:1,labels:["hex"]},keyword:{channels:1,labels:["keyword"]},ansi16:{channels:1,labels:["ansi16"]},ansi256:{channels:1,labels:["ansi256"]},hcg:{channels:3,labels:["h","c","g"]},apple:{channels:3,labels:["r16","g16","b16"]},gray:{channels:1,labels:["gray"]}};for(var r in a)if(a.hasOwnProperty(r)){if(!("channels"in a[r]))throw new Error("missing channels property: "+r);if(!("labels"in a[r]))throw new Error("missing channel labels property: "+r);if(a[r].labels.length!==a[r].channels)throw new Error("channel and label counts mismatch: "+r);var o=a[r].channels,s=a[r].labels;delete a[r].channels,delete a[r].labels,Object.defineProperty(a[r],"channels",{value:o}),Object.defineProperty(a[r],"labels",{value:s})}a.rgb.hsl=function(t){var e,n,i=t[0]/255,a=t[1]/255,r=t[2]/255,o=Math.min(i,a,r),s=Math.max(i,a,r),l=s-o;return s===o?e=0:i===s?e=(a-r)/l:a===s?e=2+(r-i)/l:r===s&&(e=4+(i-a)/l),(e=Math.min(60*e,360))<0&&(e+=360),n=(o+s)/2,[e,100*(s===o?0:n<=.5?l/(s+o):l/(2-s-o)),100*n]},a.rgb.hsv=function(t){var e,n,i,a,r,o=t[0]/255,s=t[1]/255,l=t[2]/255,u=Math.max(o,s,l),d=u-Math.min(o,s,l),h=function(t){return(u-t)/6/d+.5};return 0===d?a=r=0:(r=d/u,e=h(o),n=h(s),i=h(l),o===u?a=i-n:s===u?a=1/3+e-i:l===u&&(a=2/3+n-e),a<0?a+=1:a>1&&(a-=1)),[360*a,100*r,100*u]},a.rgb.hwb=function(t){var e=t[0],n=t[1],i=t[2];return[a.rgb.hsl(t)[0],100*(1/255*Math.min(e,Math.min(n,i))),100*(i=1-1/255*Math.max(e,Math.max(n,i)))]},a.rgb.cmyk=function(t){var e,n=t[0]/255,i=t[1]/255,a=t[2]/255;return[100*((1-n-(e=Math.min(1-n,1-i,1-a)))/(1-e)||0),100*((1-i-e)/(1-e)||0),100*((1-a-e)/(1-e)||0),100*e]},a.rgb.keyword=function(t){var i=e[t];if(i)return i;var a,r,o,s=1/0;for(var l in n)if(n.hasOwnProperty(l)){var u=n[l],d=(r=t,o=u,Math.pow(r[0]-o[0],2)+Math.pow(r[1]-o[1],2)+Math.pow(r[2]-o[2],2));d<s&&(s=d,a=l)}return a},a.keyword.rgb=function(t){return n[t]},a.rgb.xyz=function(t){var e=t[0]/255,n=t[1]/255,i=t[2]/255;return[100*(.4124*(e=e>.04045?Math.pow((e+.055)/1.055,2.4):e/12.92)+.3576*(n=n>.04045?Math.pow((n+.055)/1.055,2.4):n/12.92)+.1805*(i=i>.04045?Math.pow((i+.055)/1.055,2.4):i/12.92)),100*(.2126*e+.7152*n+.0722*i),100*(.0193*e+.1192*n+.9505*i)]},a.rgb.lab=function(t){var e=a.rgb.xyz(t),n=e[0],i=e[1],r=e[2];return i/=100,r/=108.883,n=(n/=95.047)>.008856?Math.pow(n,1/3):7.787*n+16/116,[116*(i=i>.008856?Math.pow(i,1/3):7.787*i+16/116)-16,500*(n-i),200*(i-(r=r>.008856?Math.pow(r,1/3):7.787*r+16/116))]},a.hsl.rgb=function(t){var e,n,i,a,r,o=t[0]/360,s=t[1]/100,l=t[2]/100;if(0===s)return[r=255*l,r,r];e=2*l-(n=l<.5?l*(1+s):l+s-l*s),a=[0,0,0];for(var u=0;u<3;u++)(i=o+1/3*-(u-1))<0&&i++,i>1&&i--,r=6*i<1?e+6*(n-e)*i:2*i<1?n:3*i<2?e+(n-e)*(2/3-i)*6:e,a[u]=255*r;return a},a.hsl.hsv=function(t){var e=t[0],n=t[1]/100,i=t[2]/100,a=n,r=Math.max(i,.01);return n*=(i*=2)<=1?i:2-i,a*=r<=1?r:2-r,[e,100*(0===i?2*a/(r+a):2*n/(i+n)),100*((i+n)/2)]},a.hsv.rgb=function(t){var e=t[0]/60,n=t[1]/100,i=t[2]/100,a=Math.floor(e)%6,r=e-Math.floor(e),o=255*i*(1-n),s=255*i*(1-n*r),l=255*i*(1-n*(1-r));switch(i*=255,a){case 0:return[i,l,o];case 1:return[s,i,o];case 2:return[o,i,l];case 3:return[o,s,i];case 4:return[l,o,i];case 5:return[i,o,s]}},a.hsv.hsl=function(t){var e,n,i,a=t[0],r=t[1]/100,o=t[2]/100,s=Math.max(o,.01);return i=(2-r)*o,n=r*s,[a,100*(n=(n/=(e=(2-r)*s)<=1?e:2-e)||0),100*(i/=2)]},a.hwb.rgb=function(t){var e,n,i,a,r,o,s,l=t[0]/360,u=t[1]/100,d=t[2]/100,h=u+d;switch(h>1&&(u/=h,d/=h),i=6*l-(e=Math.floor(6*l)),0!=(1&e)&&(i=1-i),a=u+i*((n=1-d)-u),e){default:case 6:case 0:r=n,o=a,s=u;break;case 1:r=a,o=n,s=u;break;case 2:r=u,o=n,s=a;break;case 3:r=u,o=a,s=n;break;case 4:r=a,o=u,s=n;break;case 5:r=n,o=u,s=a}return[255*r,255*o,255*s]},a.cmyk.rgb=function(t){var e=t[0]/100,n=t[1]/100,i=t[2]/100,a=t[3]/100;return[255*(1-Math.min(1,e*(1-a)+a)),255*(1-Math.min(1,n*(1-a)+a)),255*(1-Math.min(1,i*(1-a)+a))]},a.xyz.rgb=function(t){var e,n,i,a=t[0]/100,r=t[1]/100,o=t[2]/100;return n=-.9689*a+1.8758*r+.0415*o,i=.0557*a+-.204*r+1.057*o,e=(e=3.2406*a+-1.5372*r+-.4986*o)>.0031308?1.055*Math.pow(e,1/2.4)-.055:12.92*e,n=n>.0031308?1.055*Math.pow(n,1/2.4)-.055:12.92*n,i=i>.0031308?1.055*Math.pow(i,1/2.4)-.055:12.92*i,[255*(e=Math.min(Math.max(0,e),1)),255*(n=Math.min(Math.max(0,n),1)),255*(i=Math.min(Math.max(0,i),1))]},a.xyz.lab=function(t){var e=t[0],n=t[1],i=t[2];return n/=100,i/=108.883,e=(e/=95.047)>.008856?Math.pow(e,1/3):7.787*e+16/116,[116*(n=n>.008856?Math.pow(n,1/3):7.787*n+16/116)-16,500*(e-n),200*(n-(i=i>.008856?Math.pow(i,1/3):7.787*i+16/116))]},a.lab.xyz=function(t){var e,n,i,a=t[0];e=t[1]/500+(n=(a+16)/116),i=n-t[2]/200;var r=Math.pow(n,3),o=Math.pow(e,3),s=Math.pow(i,3);return n=r>.008856?r:(n-16/116)/7.787,e=o>.008856?o:(e-16/116)/7.787,i=s>.008856?s:(i-16/116)/7.787,[e*=95.047,n*=100,i*=108.883]},a.lab.lch=function(t){var e,n=t[0],i=t[1],a=t[2];return(e=360*Math.atan2(a,i)/2/Math.PI)<0&&(e+=360),[n,Math.sqrt(i*i+a*a),e]},a.lch.lab=function(t){var e,n=t[0],i=t[1];return e=t[2]/360*2*Math.PI,[n,i*Math.cos(e),i*Math.sin(e)]},a.rgb.ansi16=function(t){var e=t[0],n=t[1],i=t[2],r=1 in arguments?arguments[1]:a.rgb.hsv(t)[2];if(0===(r=Math.round(r/50)))return 30;var o=30+(Math.round(i/255)<<2|Math.round(n/255)<<1|Math.round(e/255));return 2===r&&(o+=60),o},a.hsv.ansi16=function(t){return a.rgb.ansi16(a.hsv.rgb(t),t[2])},a.rgb.ansi256=function(t){var e=t[0],n=t[1],i=t[2];return e===n&&n===i?e<8?16:e>248?231:Math.round((e-8)/247*24)+232:16+36*Math.round(e/255*5)+6*Math.round(n/255*5)+Math.round(i/255*5)},a.ansi16.rgb=function(t){var e=t%10;if(0===e||7===e)return t>50&&(e+=3.5),[e=e/10.5*255,e,e];var n=.5*(1+~~(t>50));return[(1&e)*n*255,(e>>1&1)*n*255,(e>>2&1)*n*255]},a.ansi256.rgb=function(t){if(t>=232){var e=10*(t-232)+8;return[e,e,e]}var n;return t-=16,[Math.floor(t/36)/5*255,Math.floor((n=t%36)/6)/5*255,n%6/5*255]},a.rgb.hex=function(t){var e=(((255&Math.round(t[0]))<<16)+((255&Math.round(t[1]))<<8)+(255&Math.round(t[2]))).toString(16).toUpperCase();return"000000".substring(e.length)+e},a.hex.rgb=function(t){var e=t.toString(16).match(/[a-f0-9]{6}|[a-f0-9]{3}/i);if(!e)return[0,0,0];var n=e[0];3===e[0].length&&(n=n.split("").map((function(t){return t+t})).join(""));var i=parseInt(n,16);return[i>>16&255,i>>8&255,255&i]},a.rgb.hcg=function(t){var e,n=t[0]/255,i=t[1]/255,a=t[2]/255,r=Math.max(Math.max(n,i),a),o=Math.min(Math.min(n,i),a),s=r-o;return e=s<=0?0:r===n?(i-a)/s%6:r===i?2+(a-n)/s:4+(n-i)/s+4,e/=6,[360*(e%=1),100*s,100*(s<1?o/(1-s):0)]},a.hsl.hcg=function(t){var e=t[1]/100,n=t[2]/100,i=1,a=0;return(i=n<.5?2*e*n:2*e*(1-n))<1&&(a=(n-.5*i)/(1-i)),[t[0],100*i,100*a]},a.hsv.hcg=function(t){var e=t[1]/100,n=t[2]/100,i=e*n,a=0;return i<1&&(a=(n-i)/(1-i)),[t[0],100*i,100*a]},a.hcg.rgb=function(t){var e=t[0]/360,n=t[1]/100,i=t[2]/100;if(0===n)return[255*i,255*i,255*i];var a,r=[0,0,0],o=e%1*6,s=o%1,l=1-s;switch(Math.floor(o)){case 0:r[0]=1,r[1]=s,r[2]=0;break;case 1:r[0]=l,r[1]=1,r[2]=0;break;case 2:r[0]=0,r[1]=1,r[2]=s;break;case 3:r[0]=0,r[1]=l,r[2]=1;break;case 4:r[0]=s,r[1]=0,r[2]=1;break;default:r[0]=1,r[1]=0,r[2]=l}return a=(1-n)*i,[255*(n*r[0]+a),255*(n*r[1]+a),255*(n*r[2]+a)]},a.hcg.hsv=function(t){var e=t[1]/100,n=e+t[2]/100*(1-e),i=0;return n>0&&(i=e/n),[t[0],100*i,100*n]},a.hcg.hsl=function(t){var e=t[1]/100,n=t[2]/100*(1-e)+.5*e,i=0;return n>0&&n<.5?i=e/(2*n):n>=.5&&n<1&&(i=e/(2*(1-n))),[t[0],100*i,100*n]},a.hcg.hwb=function(t){var e=t[1]/100,n=e+t[2]/100*(1-e);return[t[0],100*(n-e),100*(1-n)]},a.hwb.hcg=function(t){var e=t[1]/100,n=1-t[2]/100,i=n-e,a=0;return i<1&&(a=(n-i)/(1-i)),[t[0],100*i,100*a]},a.apple.rgb=function(t){return[t[0]/65535*255,t[1]/65535*255,t[2]/65535*255]},a.rgb.apple=function(t){return[t[0]/255*65535,t[1]/255*65535,t[2]/255*65535]},a.gray.rgb=function(t){return[t[0]/100*255,t[0]/100*255,t[0]/100*255]},a.gray.hsl=a.gray.hsv=function(t){return[0,0,t[0]]},a.gray.hwb=function(t){return[0,100,t[0]]},a.gray.cmyk=function(t){return[0,0,0,t[0]]},a.gray.lab=function(t){return[t[0],0,0]},a.gray.hex=function(t){var e=255&Math.round(t[0]/100*255),n=((e<<16)+(e<<8)+e).toString(16).toUpperCase();return"000000".substring(n.length)+n},a.rgb.gray=function(t){return[(t[0]+t[1]+t[2])/3/255*100]}}));i.rgb,i.hsl,i.hsv,i.hwb,i.cmyk,i.xyz,i.lab,i.lch,i.hex,i.keyword,i.ansi16,i.ansi256,i.hcg,i.apple,i.gray;function a(t){var e=function(){for(var t={},e=Object.keys(i),n=e.length,a=0;a<n;a++)t[e[a]]={distance:-1,parent:null};return t}(),n=[t];for(e[t].distance=0;n.length;)for(var a=n.pop(),r=Object.keys(i[a]),o=r.length,s=0;s<o;s++){var l=r[s],u=e[l];-1===u.distance&&(u.distance=e[a].distance+1,u.parent=a,n.unshift(l))}return e}function r(t,e){return function(n){return e(t(n))}}function o(t,e){for(var n=[e[t].parent,t],a=i[e[t].parent][t],o=e[t].parent;e[o].parent;)n.unshift(e[o].parent),a=r(i[e[o].parent][o],a),o=e[o].parent;return a.conversion=n,a}var s={};Object.keys(i).forEach((function(t){s[t]={},Object.defineProperty(s[t],"channels",{value:i[t].channels}),Object.defineProperty(s[t],"labels",{value:i[t].labels});var e=function(t){for(var e=a(t),n={},i=Object.keys(e),r=i.length,s=0;s<r;s++){var l=i[s];null!==e[l].parent&&(n[l]=o(l,e))}return n}(t);Object.keys(e).forEach((function(n){var i=e[n];s[t][n]=function(t){var e=function(e){if(null==e)return e;arguments.length>1&&(e=Array.prototype.slice.call(arguments));var n=t(e);if("object"==typeof n)for(var i=n.length,a=0;a<i;a++)n[a]=Math.round(n[a]);return n};return"conversion"in t&&(e.conversion=t.conversion),e}(i),s[t][n].raw=function(t){var e=function(e){return null==e?e:(arguments.length>1&&(e=Array.prototype.slice.call(arguments)),t(e))};return"conversion"in t&&(e.conversion=t.conversion),e}(i)}))}));var l=s,u={aliceblue:[240,248,255],antiquewhite:[250,235,215],aqua:[0,255,255],aquamarine:[127,255,212],azure:[240,255,255],beige:[245,245,220],bisque:[255,228,196],black:[0,0,0],blanchedalmond:[255,235,205],blue:[0,0,255],blueviolet:[138,43,226],brown:[165,42,42],burlywood:[222,184,135],cadetblue:[95,158,160],chartreuse:[127,255,0],chocolate:[210,105,30],coral:[255,127,80],cornflowerblue:[100,149,237],cornsilk:[255,248,220],crimson:[220,20,60],cyan:[0,255,255],darkblue:[0,0,139],darkcyan:[0,139,139],darkgoldenrod:[184,134,11],darkgray:[169,169,169],darkgreen:[0,100,0],darkgrey:[169,169,169],darkkhaki:[189,183,107],darkmagenta:[139,0,139],darkolivegreen:[85,107,47],darkorange:[255,140,0],darkorchid:[153,50,204],darkred:[139,0,0],darksalmon:[233,150,122],darkseagreen:[143,188,143],darkslateblue:[72,61,139],darkslategray:[47,79,79],darkslategrey:[47,79,79],darkturquoise:[0,206,209],darkviolet:[148,0,211],deeppink:[255,20,147],deepskyblue:[0,191,255],dimgray:[105,105,105],dimgrey:[105,105,105],dodgerblue:[30,144,255],firebrick:[178,34,34],floralwhite:[255,250,240],forestgreen:[34,139,34],fuchsia:[255,0,255],gainsboro:[220,220,220],ghostwhite:[248,248,255],gold:[255,215,0],goldenrod:[218,165,32],gray:[128,128,128],green:[0,128,0],greenyellow:[173,255,47],grey:[128,128,128],honeydew:[240,255,240],hotpink:[255,105,180],indianred:[205,92,92],indigo:[75,0,130],ivory:[255,255,240],khaki:[240,230,140],lavender:[230,230,250],lavenderblush:[255,240,245],lawngreen:[124,252,0],lemonchiffon:[255,250,205],lightblue:[173,216,230],lightcoral:[240,128,128],lightcyan:[224,255,255],lightgoldenrodyellow:[250,250,210],lightgray:[211,211,211],lightgreen:[144,238,144],lightgrey:[211,211,211],lightpink:[255,182,193],lightsalmon:[255,160,122],lightseagreen:[32,178,170],lightskyblue:[135,206,250],lightslategray:[119,136,153],lightslategrey:[119,136,153],lightsteelblue:[176,196,222],lightyellow:[255,255,224],lime:[0,255,0],limegreen:[50,205,50],linen:[250,240,230],magenta:[255,0,255],maroon:[128,0,0],mediumaquamarine:[102,205,170],mediumblue:[0,0,205],mediumorchid:[186,85,211],mediumpurple:[147,112,219],mediumseagreen:[60,179,113],mediumslateblue:[123,104,238],mediumspringgreen:[0,250,154],mediumturquoise:[72,209,204],mediumvioletred:[199,21,133],midnightblue:[25,25,112],mintcream:[245,255,250],mistyrose:[255,228,225],moccasin:[255,228,181],navajowhite:[255,222,173],navy:[0,0,128],oldlace:[253,245,230],olive:[128,128,0],olivedrab:[107,142,35],orange:[255,165,0],orangered:[255,69,0],orchid:[218,112,214],palegoldenrod:[238,232,170],palegreen:[152,251,152],paleturquoise:[175,238,238],palevioletred:[219,112,147],papayawhip:[255,239,213],peachpuff:[255,218,185],peru:[205,133,63],pink:[255,192,203],plum:[221,160,221],powderblue:[176,224,230],purple:[128,0,128],rebeccapurple:[102,51,153],red:[255,0,0],rosybrown:[188,143,143],royalblue:[65,105,225],saddlebrown:[139,69,19],salmon:[250,128,114],sandybrown:[244,164,96],seagreen:[46,139,87],seashell:[255,245,238],sienna:[160,82,45],silver:[192,192,192],skyblue:[135,206,235],slateblue:[106,90,205],slategray:[112,128,144],slategrey:[112,128,144],snow:[255,250,250],springgreen:[0,255,127],steelblue:[70,130,180],tan:[210,180,140],teal:[0,128,128],thistle:[216,191,216],tomato:[255,99,71],turquoise:[64,224,208],violet:[238,130,238],wheat:[245,222,179],white:[255,255,255],whitesmoke:[245,245,245],yellow:[255,255,0],yellowgreen:[154,205,50]},d={getRgba:h,getHsla:c,getRgb:function(t){var e=h(t);return e&&e.slice(0,3)},getHsl:function(t){var e=c(t);return e&&e.slice(0,3)},getHwb:f,getAlpha:function(t){var e=h(t);if(e)return e[3];if(e=c(t))return e[3];if(e=f(t))return e[3]},hexString:function(t,e){e=void 0!==e&&3===t.length?e:t[3];return"#"+b(t[0])+b(t[1])+b(t[2])+(e>=0&&e<1?b(Math.round(255*e)):"")},rgbString:function(t,e){if(e<1||t[3]&&t[3]<1)return g(t,e);return"rgb("+t[0]+", "+t[1]+", "+t[2]+")"},rgbaString:g,percentString:function(t,e){if(e<1||t[3]&&t[3]<1)return m(t,e);var n=Math.round(t[0]/255*100),i=Math.round(t[1]/255*100),a=Math.round(t[2]/255*100);return"rgb("+n+"%, "+i+"%, "+a+"%)"},percentaString:m,hslString:function(t,e){if(e<1||t[3]&&t[3]<1)return p(t,e);return"hsl("+t[0]+", "+t[1]+"%, "+t[2]+"%)"},hslaString:p,hwbString:function(t,e){void 0===e&&(e=void 0!==t[3]?t[3]:1);return"hwb("+t[0]+", "+t[1]+"%, "+t[2]+"%"+(void 0!==e&&1!==e?", "+e:"")+")"},keyword:function(t){return y[t.slice(0,3)]}};function h(t){if(t){var e=[0,0,0],n=1,i=t.match(/^#([a-fA-F0-9]{3,4})$/i),a="";if(i){a=(i=i[1])[3];for(var r=0;r<e.length;r++)e[r]=parseInt(i[r]+i[r],16);a&&(n=Math.round(parseInt(a+a,16)/255*100)/100)}else if(i=t.match(/^#([a-fA-F0-9]{6}([a-fA-F0-9]{2})?)$/i)){a=i[2],i=i[1];for(r=0;r<e.length;r++)e[r]=parseInt(i.slice(2*r,2*r+2),16);a&&(n=Math.round(parseInt(a,16)/255*100)/100)}else if(i=t.match(/^rgba?\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*(?:,\s*([+-]?[\d\.]+)\s*)?\)$/i)){for(r=0;r<e.length;r++)e[r]=parseInt(i[r+1]);n=parseFloat(i[4])}else if(i=t.match(/^rgba?\(\s*([+-]?[\d\.]+)\%\s*,\s*([+-]?[\d\.]+)\%\s*,\s*([+-]?[\d\.]+)\%\s*(?:,\s*([+-]?[\d\.]+)\s*)?\)$/i)){for(r=0;r<e.length;r++)e[r]=Math.round(2.55*parseFloat(i[r+1]));n=parseFloat(i[4])}else if(i=t.match(/(\w+)/)){if("transparent"==i[1])return[0,0,0,0];if(!(e=u[i[1]]))return}for(r=0;r<e.length;r++)e[r]=v(e[r],0,255);return n=n||0==n?v(n,0,1):1,e[3]=n,e}}function c(t){if(t){var e=t.match(/^hsla?\(\s*([+-]?\d+)(?:deg)?\s*,\s*([+-]?[\d\.]+)%\s*,\s*([+-]?[\d\.]+)%\s*(?:,\s*([+-]?[\d\.]+)\s*)?\)/);if(e){var n=parseFloat(e[4]);return[v(parseInt(e[1]),0,360),v(parseFloat(e[2]),0,100),v(parseFloat(e[3]),0,100),v(isNaN(n)?1:n,0,1)]}}}function f(t){if(t){var e=t.match(/^hwb\(\s*([+-]?\d+)(?:deg)?\s*,\s*([+-]?[\d\.]+)%\s*,\s*([+-]?[\d\.]+)%\s*(?:,\s*([+-]?[\d\.]+)\s*)?\)/);if(e){var n=parseFloat(e[4]);return[v(parseInt(e[1]),0,360),v(parseFloat(e[2]),0,100),v(parseFloat(e[3]),0,100),v(isNaN(n)?1:n,0,1)]}}}function g(t,e){return void 0===e&&(e=void 0!==t[3]?t[3]:1),"rgba("+t[0]+", "+t[1]+", "+t[2]+", "+e+")"}function m(t,e){return"rgba("+Math.round(t[0]/255*100)+"%, "+Math.round(t[1]/255*100)+"%, "+Math.round(t[2]/255*100)+"%, "+(e||t[3]||1)+")"}function p(t,e){return void 0===e&&(e=void 0!==t[3]?t[3]:1),"hsla("+t[0]+", "+t[1]+"%, "+t[2]+"%, "+e+")"}function v(t,e,n){return Math.min(Math.max(e,t),n)}function b(t){var e=t.toString(16).toUpperCase();return e.length<2?"0"+e:e}var y={};for(var x in u)y[u[x]]=x;var _=function(t){return t instanceof _?t:this instanceof _?(this.valid=!1,this.values={rgb:[0,0,0],hsl:[0,0,0],hsv:[0,0,0],hwb:[0,0,0],cmyk:[0,0,0,0],alpha:1},void("string"==typeof t?(e=d.getRgba(t))?this.setValues("rgb",e):(e=d.getHsla(t))?this.setValues("hsl",e):(e=d.getHwb(t))&&this.setValues("hwb",e):"object"==typeof t&&(void 0!==(e=t).r||void 0!==e.red?this.setValues("rgb",e):void 0!==e.l||void 0!==e.lightness?this.setValues("hsl",e):void 0!==e.v||void 0!==e.value?this.setValues("hsv",e):void 0!==e.w||void 0!==e.whiteness?this.setValues("hwb",e):void 0===e.c&&void 0===e.cyan||this.setValues("cmyk",e)))):new _(t);var e};_.prototype={isValid:function(){return this.valid},rgb:function(){return this.setSpace("rgb",arguments)},hsl:function(){return this.setSpace("hsl",arguments)},hsv:function(){return this.setSpace("hsv",arguments)},hwb:function(){return this.setSpace("hwb",arguments)},cmyk:function(){return this.setSpace("cmyk",arguments)},rgbArray:function(){return this.values.rgb},hslArray:function(){return this.values.hsl},hsvArray:function(){return this.values.hsv},hwbArray:function(){var t=this.values;return 1!==t.alpha?t.hwb.concat([t.alpha]):t.hwb},cmykArray:function(){return this.values.cmyk},rgbaArray:function(){var t=this.values;return t.rgb.concat([t.alpha])},hslaArray:function(){var t=this.values;return t.hsl.concat([t.alpha])},alpha:function(t){return void 0===t?this.values.alpha:(this.setValues("alpha",t),this)},red:function(t){return this.setChannel("rgb",0,t)},green:function(t){return this.setChannel("rgb",1,t)},blue:function(t){return this.setChannel("rgb",2,t)},hue:function(t){return t&&(t=(t%=360)<0?360+t:t),this.setChannel("hsl",0,t)},saturation:function(t){return this.setChannel("hsl",1,t)},lightness:function(t){return this.setChannel("hsl",2,t)},saturationv:function(t){return this.setChannel("hsv",1,t)},whiteness:function(t){return this.setChannel("hwb",1,t)},blackness:function(t){return this.setChannel("hwb",2,t)},value:function(t){return this.setChannel("hsv",2,t)},cyan:function(t){return this.setChannel("cmyk",0,t)},magenta:function(t){return this.setChannel("cmyk",1,t)},yellow:function(t){return this.setChannel("cmyk",2,t)},black:function(t){return this.setChannel("cmyk",3,t)},hexString:function(){return d.hexString(this.values.rgb)},rgbString:function(){return d.rgbString(this.values.rgb,this.values.alpha)},rgbaString:function(){return d.rgbaString(this.values.rgb,this.values.alpha)},percentString:function(){return d.percentString(this.values.rgb,this.values.alpha)},hslString:function(){return d.hslString(this.values.hsl,this.values.alpha)},hslaString:function(){return d.hslaString(this.values.hsl,this.values.alpha)},hwbString:function(){return d.hwbString(this.values.hwb,this.values.alpha)},keyword:function(){return d.keyword(this.values.rgb,this.values.alpha)},rgbNumber:function(){var t=this.values.rgb;return t[0]<<16|t[1]<<8|t[2]},luminosity:function(){for(var t=this.values.rgb,e=[],n=0;n<t.length;n++){var i=t[n]/255;e[n]=i<=.03928?i/12.92:Math.pow((i+.055)/1.055,2.4)}return.2126*e[0]+.7152*e[1]+.0722*e[2]},contrast:function(t){var e=this.luminosity(),n=t.luminosity();return e>n?(e+.05)/(n+.05):(n+.05)/(e+.05)},level:function(t){var e=this.contrast(t);return e>=7.1?"AAA":e>=4.5?"AA":""},dark:function(){var t=this.values.rgb;return(299*t[0]+587*t[1]+114*t[2])/1e3<128},light:function(){return!this.dark()},negate:function(){for(var t=[],e=0;e<3;e++)t[e]=255-this.values.rgb[e];return this.setValues("rgb",t),this},lighten:function(t){var e=this.values.hsl;return e[2]+=e[2]*t,this.setValues("hsl",e),this},darken:function(t){var e=this.values.hsl;return e[2]-=e[2]*t,this.setValues("hsl",e),this},saturate:function(t){var e=this.values.hsl;return e[1]+=e[1]*t,this.setValues("hsl",e),this},desaturate:function(t){var e=this.values.hsl;return e[1]-=e[1]*t,this.setValues("hsl",e),this},whiten:function(t){var e=this.values.hwb;return e[1]+=e[1]*t,this.setValues("hwb",e),this},blacken:function(t){var e=this.values.hwb;return e[2]+=e[2]*t,this.setValues("hwb",e),this},greyscale:function(){var t=this.values.rgb,e=.3*t[0]+.59*t[1]+.11*t[2];return this.setValues("rgb",[e,e,e]),this},clearer:function(t){var e=this.values.alpha;return this.setValues("alpha",e-e*t),this},opaquer:function(t){var e=this.values.alpha;return this.setValues("alpha",e+e*t),this},rotate:function(t){var e=this.values.hsl,n=(e[0]+t)%360;return e[0]=n<0?360+n:n,this.setValues("hsl",e),this},mix:function(t,e){var n=t,i=void 0===e?.5:e,a=2*i-1,r=this.alpha()-n.alpha(),o=((a*r==-1?a:(a+r)/(1+a*r))+1)/2,s=1-o;return this.rgb(o*this.red()+s*n.red(),o*this.green()+s*n.green(),o*this.blue()+s*n.blue()).alpha(this.alpha()*i+n.alpha()*(1-i))},toJSON:function(){return this.rgb()},clone:function(){var t,e,n=new _,i=this.values,a=n.values;for(var r in i)i.hasOwnProperty(r)&&(t=i[r],"[object Array]"===(e={}.toString.call(t))?a[r]=t.slice(0):"[object Number]"===e?a[r]=t:console.error("unexpected color value:",t));return n}},_.prototype.spaces={rgb:["red","green","blue"],hsl:["hue","saturation","lightness"],hsv:["hue","saturation","value"],hwb:["hue","whiteness","blackness"],cmyk:["cyan","magenta","yellow","black"]},_.prototype.maxes={rgb:[255,255,255],hsl:[360,100,100],hsv:[360,100,100],hwb:[360,100,100],cmyk:[100,100,100,100]},_.prototype.getValues=function(t){for(var e=this.values,n={},i=0;i<t.length;i++)n[t.charAt(i)]=e[t][i];return 1!==e.alpha&&(n.a=e.alpha),n},_.prototype.setValues=function(t,e){var n,i,a=this.values,r=this.spaces,o=this.maxes,s=1;if(this.valid=!0,"alpha"===t)s=e;else if(e.length)a[t]=e.slice(0,t.length),s=e[t.length];else if(void 0!==e[t.charAt(0)]){for(n=0;n<t.length;n++)a[t][n]=e[t.charAt(n)];s=e.a}else if(void 0!==e[r[t][0]]){var u=r[t];for(n=0;n<t.length;n++)a[t][n]=e[u[n]];s=e.alpha}if(a.alpha=Math.max(0,Math.min(1,void 0===s?a.alpha:s)),"alpha"===t)return!1;for(n=0;n<t.length;n++)i=Math.max(0,Math.min(o[t][n],a[t][n])),a[t][n]=Math.round(i);for(var d in r)d!==t&&(a[d]=l[t][d](a[t]));return!0},_.prototype.setSpace=function(t,e){var n=e[0];return void 0===n?this.getValues(t):("number"==typeof n&&(n=Array.prototype.slice.call(e)),this.setValues(t,n),this)},_.prototype.setChannel=function(t,e,n){var i=this.values[t];return void 0===n?i[e]:n===i[e]?this:(i[e]=n,this.setValues(t,i),this)},"undefined"!=typeof window&&(window.Color=_);var w=_;function k(t){return-1===["__proto__","prototype","constructor"].indexOf(t)}var M,S={noop:function(){},uid:(M=0,function(){return M++}),isNullOrUndef:function(t){return null==t},isArray:function(t){if(Array.isArray&&Array.isArray(t))return!0;var e=Object.prototype.toString.call(t);return"[object"===e.substr(0,7)&&"Array]"===e.substr(-6)},isObject:function(t){return null!==t&&"[object Object]"===Object.prototype.toString.call(t)},isFinite:function(t){return("number"==typeof t||t instanceof Number)&&isFinite(t)},valueOrDefault:function(t,e){return void 0===t?e:t},valueAtIndexOrDefault:function(t,e,n){return S.valueOrDefault(S.isArray(t)?t[e]:t,n)},callback:function(t,e,n){if(t&&"function"==typeof t.call)return t.apply(n,e)},each:function(t,e,n,i){var a,r,o;if(S.isArray(t))if(r=t.length,i)for(a=r-1;a>=0;a--)e.call(n,t[a],a);else for(a=0;a<r;a++)e.call(n,t[a],a);else if(S.isObject(t))for(r=(o=Object.keys(t)).length,a=0;a<r;a++)e.call(n,t[o[a]],o[a])},arrayEquals:function(t,e){var n,i,a,r;if(!t||!e||t.length!==e.length)return!1;for(n=0,i=t.length;n<i;++n)if(a=t[n],r=e[n],a instanceof Array&&r instanceof Array){if(!S.arrayEquals(a,r))return!1}else if(a!==r)return!1;return!0},clone:function(t){if(S.isArray(t))return t.map(S.clone);if(S.isObject(t)){for(var e=Object.create(t),n=Object.keys(t),i=n.length,a=0;a<i;++a)e[n[a]]=S.clone(t[n[a]]);return e}return t},_merger:function(t,e,n,i){if(k(t)){var a=e[t],r=n[t];S.isObject(a)&&S.isObject(r)?S.merge(a,r,i):e[t]=S.clone(r)}},_mergerIf:function(t,e,n){if(k(t)){var i=e[t],a=n[t];S.isObject(i)&&S.isObject(a)?S.mergeIf(i,a):e.hasOwnProperty(t)||(e[t]=S.clone(a))}},merge:function(t,e,n){var i,a,r,o,s,l=S.isArray(e)?e:[e],u=l.length;if(!S.isObject(t))return t;for(i=(n=n||{}).merger||S._merger,a=0;a<u;++a)if(e=l[a],S.isObject(e))for(s=0,o=(r=Object.keys(e)).length;s<o;++s)i(r[s],t,e,n);return t},mergeIf:function(t,e){return S.merge(t,e,{merger:S._mergerIf})},extend:Object.assign||function(t){return S.merge(t,[].slice.call(arguments,1),{merger:function(t,e,n){e[t]=n[t]}})},inherits:function(t){var e=this,n=t&&t.hasOwnProperty("constructor")?t.constructor:function(){return e.apply(this,arguments)},i=function(){this.constructor=n};return i.prototype=e.prototype,n.prototype=new i,n.extend=S.inherits,t&&S.extend(n.prototype,t),n.__super__=e.prototype,n},_deprecated:function(t,e,n,i){void 0!==e&&console.warn(t+': "'+n+'" is deprecated. Please use "'+i+'" instead')}},D=S;S.callCallback=S.callback,S.indexOf=function(t,e,n){return Array.prototype.indexOf.call(t,e,n)},S.getValueOrDefault=S.valueOrDefault,S.getValueAtIndexOrDefault=S.valueAtIndexOrDefault;var C={linear:function(t){return t},easeInQuad:function(t){return t*t},easeOutQuad:function(t){return-t*(t-2)},easeInOutQuad:function(t){return(t/=.5)<1?.5*t*t:-.5*(--t*(t-2)-1)},easeInCubic:function(t){return t*t*t},easeOutCubic:function(t){return(t-=1)*t*t+1},easeInOutCubic:function(t){return(t/=.5)<1?.5*t*t*t:.5*((t-=2)*t*t+2)},easeInQuart:function(t){return t*t*t*t},easeOutQuart:function(t){return-((t-=1)*t*t*t-1)},easeInOutQuart:function(t){return(t/=.5)<1?.5*t*t*t*t:-.5*((t-=2)*t*t*t-2)},easeInQuint:function(t){return t*t*t*t*t},easeOutQuint:function(t){return(t-=1)*t*t*t*t+1},easeInOutQuint:function(t){return(t/=.5)<1?.5*t*t*t*t*t:.5*((t-=2)*t*t*t*t+2)},easeInSine:function(t){return 1-Math.cos(t*(Math.PI/2))},easeOutSine:function(t){return Math.sin(t*(Math.PI/2))},easeInOutSine:function(t){return-.5*(Math.cos(Math.PI*t)-1)},easeInExpo:function(t){return 0===t?0:Math.pow(2,10*(t-1))},easeOutExpo:function(t){return 1===t?1:1-Math.pow(2,-10*t)},easeInOutExpo:function(t){return 0===t?0:1===t?1:(t/=.5)<1?.5*Math.pow(2,10*(t-1)):.5*(2-Math.pow(2,-10*--t))},easeInCirc:function(t){return t>=1?t:-(Math.sqrt(1-t*t)-1)},easeOutCirc:function(t){return Math.sqrt(1-(t-=1)*t)},easeInOutCirc:function(t){return(t/=.5)<1?-.5*(Math.sqrt(1-t*t)-1):.5*(Math.sqrt(1-(t-=2)*t)+1)},easeInElastic:function(t){var e=1.70158,n=0,i=1;return 0===t?0:1===t?1:(n||(n=.3),i<1?(i=1,e=n/4):e=n/(2*Math.PI)*Math.asin(1/i),-i*Math.pow(2,10*(t-=1))*Math.sin((t-e)*(2*Math.PI)/n))},easeOutElastic:function(t){var e=1.70158,n=0,i=1;return 0===t?0:1===t?1:(n||(n=.3),i<1?(i=1,e=n/4):e=n/(2*Math.PI)*Math.asin(1/i),i*Math.pow(2,-10*t)*Math.sin((t-e)*(2*Math.PI)/n)+1)},easeInOutElastic:function(t){var e=1.70158,n=0,i=1;return 0===t?0:2==(t/=.5)?1:(n||(n=.45),i<1?(i=1,e=n/4):e=n/(2*Math.PI)*Math.asin(1/i),t<1?i*Math.pow(2,10*(t-=1))*Math.sin((t-e)*(2*Math.PI)/n)*-.5:i*Math.pow(2,-10*(t-=1))*Math.sin((t-e)*(2*Math.PI)/n)*.5+1)},easeInBack:function(t){var e=1.70158;return t*t*((e+1)*t-e)},easeOutBack:function(t){var e=1.70158;return(t-=1)*t*((e+1)*t+e)+1},easeInOutBack:function(t){var e=1.70158;return(t/=.5)<1?t*t*((1+(e*=1.525))*t-e)*.5:.5*((t-=2)*t*((1+(e*=1.525))*t+e)+2)},easeInBounce:function(t){return 1-C.easeOutBounce(1-t)},easeOutBounce:function(t){return t<1/2.75?7.5625*t*t:t<2/2.75?7.5625*(t-=1.5/2.75)*t+.75:t<2.5/2.75?7.5625*(t-=2.25/2.75)*t+.9375:7.5625*(t-=2.625/2.75)*t+.984375},easeInOutBounce:function(t){return t<.5?.5*C.easeInBounce(2*t):.5*C.easeOutBounce(2*t-1)+.5}},P={effects:C};D.easingEffects=C;var T=Math.PI,O=T/180,A=2*T,F=T/2,I=T/4,L=2*T/3,R={clear:function(t){t.ctx.clearRect(0,0,t.width,t.height)},roundedRect:function(t,e,n,i,a,r){if(r){var o=Math.min(r,a/2,i/2),s=e+o,l=n+o,u=e+i-o,d=n+a-o;t.moveTo(e,l),s<u&&l<d?(t.arc(s,l,o,-T,-F),t.arc(u,l,o,-F,0),t.arc(u,d,o,0,F),t.arc(s,d,o,F,T)):s<u?(t.moveTo(s,n),t.arc(u,l,o,-F,F),t.arc(s,l,o,F,T+F)):l<d?(t.arc(s,l,o,-T,0),t.arc(s,d,o,0,T)):t.arc(s,l,o,-T,T),t.closePath(),t.moveTo(e,n)}else t.rect(e,n,i,a)},drawPoint:function(t,e,n,i,a,r){var o,s,l,u,d,h=(r||0)*O;if(e&&"object"==typeof e&&("[object HTMLImageElement]"===(o=e.toString())||"[object HTMLCanvasElement]"===o))return t.save(),t.translate(i,a),t.rotate(h),t.drawImage(e,-e.width/2,-e.height/2,e.width,e.height),void t.restore();if(!(isNaN(n)||n<=0)){switch(t.beginPath(),e){default:t.arc(i,a,n,0,A),t.closePath();break;case"triangle":t.moveTo(i+Math.sin(h)*n,a-Math.cos(h)*n),h+=L,t.lineTo(i+Math.sin(h)*n,a-Math.cos(h)*n),h+=L,t.lineTo(i+Math.sin(h)*n,a-Math.cos(h)*n),t.closePath();break;case"rectRounded":u=n-(d=.516*n),s=Math.cos(h+I)*u,l=Math.sin(h+I)*u,t.arc(i-s,a-l,d,h-T,h-F),t.arc(i+l,a-s,d,h-F,h),t.arc(i+s,a+l,d,h,h+F),t.arc(i-l,a+s,d,h+F,h+T),t.closePath();break;case"rect":if(!r){u=Math.SQRT1_2*n,t.rect(i-u,a-u,2*u,2*u);break}h+=I;case"rectRot":s=Math.cos(h)*n,l=Math.sin(h)*n,t.moveTo(i-s,a-l),t.lineTo(i+l,a-s),t.lineTo(i+s,a+l),t.lineTo(i-l,a+s),t.closePath();break;case"crossRot":h+=I;case"cross":s=Math.cos(h)*n,l=Math.sin(h)*n,t.moveTo(i-s,a-l),t.lineTo(i+s,a+l),t.moveTo(i+l,a-s),t.lineTo(i-l,a+s);break;case"star":s=Math.cos(h)*n,l=Math.sin(h)*n,t.moveTo(i-s,a-l),t.lineTo(i+s,a+l),t.moveTo(i+l,a-s),t.lineTo(i-l,a+s),h+=I,s=Math.cos(h)*n,l=Math.sin(h)*n,t.moveTo(i-s,a-l),t.lineTo(i+s,a+l),t.moveTo(i+l,a-s),t.lineTo(i-l,a+s);break;case"line":s=Math.cos(h)*n,l=Math.sin(h)*n,t.moveTo(i-s,a-l),t.lineTo(i+s,a+l);break;case"dash":t.moveTo(i,a),t.lineTo(i+Math.cos(h)*n,a+Math.sin(h)*n)}t.fill(),t.stroke()}},_isPointInArea:function(t,e){return t.x>e.left-1e-6&&t.x<e.right+1e-6&&t.y>e.top-1e-6&&t.y<e.bottom+1e-6},clipArea:function(t,e){t.save(),t.beginPath(),t.rect(e.left,e.top,e.right-e.left,e.bottom-e.top),t.clip()},unclipArea:function(t){t.restore()},lineTo:function(t,e,n,i){var a=n.steppedLine;if(a){if("middle"===a){var r=(e.x+n.x)/2;t.lineTo(r,i?n.y:e.y),t.lineTo(r,i?e.y:n.y)}else"after"===a&&!i||"after"!==a&&i?t.lineTo(e.x,n.y):t.lineTo(n.x,e.y);t.lineTo(n.x,n.y)}else n.tension?t.bezierCurveTo(i?e.controlPointPreviousX:e.controlPointNextX,i?e.controlPointPreviousY:e.controlPointNextY,i?n.controlPointNextX:n.controlPointPreviousX,i?n.controlPointNextY:n.controlPointPreviousY,n.x,n.y):t.lineTo(n.x,n.y)}},N=R;D.clear=R.clear,D.drawRoundedRectangle=function(t){t.beginPath(),R.roundedRect.apply(R,arguments)};var W={_set:function(t,e){return D.merge(this[t]||(this[t]={}),e)}};W._set("global",{defaultColor:"rgba(0,0,0,0.1)",defaultFontColor:"#666",defaultFontFamily:"'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",defaultFontSize:12,defaultFontStyle:"normal",defaultLineHeight:1.2,showLines:!0});var Y=W,z=D.valueOrDefault;var E={toLineHeight:function(t,e){var n=(""+t).match(/^(normal|(\d+(?:\.\d+)?)(px|em|%)?)$/);if(!n||"normal"===n[1])return 1.2*e;switch(t=+n[2],n[3]){case"px":return t;case"%":t/=100}return e*t},toPadding:function(t){var e,n,i,a;return D.isObject(t)?(e=+t.top||0,n=+t.right||0,i=+t.bottom||0,a=+t.left||0):e=n=i=a=+t||0,{top:e,right:n,bottom:i,left:a,height:e+i,width:a+n}},_parseFont:function(t){var e=Y.global,n=z(t.fontSize,e.defaultFontSize),i={family:z(t.fontFamily,e.defaultFontFamily),lineHeight:D.options.toLineHeight(z(t.lineHeight,e.defaultLineHeight),n),size:n,style:z(t.fontStyle,e.defaultFontStyle),weight:null,string:""};return i.string=function(t){return!t||D.isNullOrUndef(t.size)||D.isNullOrUndef(t.family)?null:(t.style?t.style+" ":"")+(t.weight?t.weight+" ":"")+t.size+"px "+t.family}(i),i},resolve:function(t,e,n,i){var a,r,o,s=!0;for(a=0,r=t.length;a<r;++a)if(void 0!==(o=t[a])&&(void 0!==e&&"function"==typeof o&&(o=o(e),s=!1),void 0!==n&&D.isArray(o)&&(o=o[n],s=!1),void 0!==o))return i&&!s&&(i.cacheable=!1),o}},V={_factorize:function(t){var e,n=[],i=Math.sqrt(t);for(e=1;e<i;e++)t%e==0&&(n.push(e),n.push(t/e));return i===(0|i)&&n.push(i),n.sort((function(t,e){return t-e})).pop(),n},log10:Math.log10||function(t){var e=Math.log(t)*Math.LOG10E,n=Math.round(e);return t===Math.pow(10,n)?n:e}},H=V;D.log10=V.log10;var B=D,j=P,U=N,G=E,q=H,Z={getRtlAdapter:function(t,e,n){return t?function(t,e){return{x:function(n){return t+t+e-n},setWidth:function(t){e=t},textAlign:function(t){return"center"===t?t:"right"===t?"left":"right"},xPlus:function(t,e){return t-e},leftForLtr:function(t,e){return t-e}}}(e,n):{x:function(t){return t},setWidth:function(t){},textAlign:function(t){return t},xPlus:function(t,e){return t+e},leftForLtr:function(t,e){return t}}},overrideTextDirection:function(t,e){var n,i;"ltr"!==e&&"rtl"!==e||(i=[(n=t.canvas.style).getPropertyValue("direction"),n.getPropertyPriority("direction")],n.setProperty("direction",e,"important"),t.prevTextDirection=i)},restoreTextDirection:function(t){var e=t.prevTextDirection;void 0!==e&&(delete t.prevTextDirection,t.canvas.style.setProperty("direction",e[0],e[1]))}};B.easing=j,B.canvas=U,B.options=G,B.math=q,B.rtl=Z;var $=function(t){B.extend(this,t),this.initialize.apply(this,arguments)};B.extend($.prototype,{_type:void 0,initialize:function(){this.hidden=!1},pivot:function(){var t=this;return t._view||(t._view=B.extend({},t._model)),t._start={},t},transition:function(t){var e=this,n=e._model,i=e._start,a=e._view;return n&&1!==t?(a||(a=e._view={}),i||(i=e._start={}),function(t,e,n,i){var a,r,o,s,l,u,d,h,c,f=Object.keys(n);for(a=0,r=f.length;a<r;++a)if(u=n[o=f[a]],e.hasOwnProperty(o)||(e[o]=u),(s=e[o])!==u&&"_"!==o[0]){if(t.hasOwnProperty(o)||(t[o]=s),(d=typeof u)===typeof(l=t[o]))if("string"===d){if((h=w(l)).valid&&(c=w(u)).valid){e[o]=c.mix(h,i).rgbString();continue}}else if(B.isFinite(l)&&B.isFinite(u)){e[o]=l+(u-l)*i;continue}e[o]=u}}(i,a,n,t),e):(e._view=B.extend({},n),e._start=null,e)},tooltipPosition:function(){return{x:this._model.x,y:this._model.y}},hasValue:function(){return B.isNumber(this._model.x)&&B.isNumber(this._model.y)}}),$.extend=B.inherits;var X=$,K=X.extend({chart:null,currentStep:0,numSteps:60,easing:"",render:null,onAnimationProgress:null,onAnimationComplete:null}),J=K;Object.defineProperty(K.prototype,"animationObject",{get:function(){return this}}),Object.defineProperty(K.prototype,"chartInstance",{get:function(){return this.chart},set:function(t){this.chart=t}}),Y._set("global",{animation:{duration:1e3,easing:"easeOutQuart",onProgress:B.noop,onComplete:B.noop}});var Q={animations:[],request:null,addAnimation:function(t,e,n,i){var a,r,o=this.animations;for(e.chart=t,e.startTime=Date.now(),e.duration=n,i||(t.animating=!0),a=0,r=o.length;a<r;++a)if(o[a].chart===t)return void(o[a]=e);o.push(e),1===o.length&&this.requestAnimationFrame()},cancelAnimation:function(t){var e=B.findIndex(this.animations,(function(e){return e.chart===t}));-1!==e&&(this.animations.splice(e,1),t.animating=!1)},requestAnimationFrame:function(){var t=this;null===t.request&&(t.request=B.requestAnimFrame.call(window,(function(){t.request=null,t.startDigest()})))},startDigest:function(){this.advance(),this.animations.length>0&&this.requestAnimationFrame()},advance:function(){for(var t,e,n,i,a=this.animations,r=0;r<a.length;)e=(t=a[r]).chart,n=t.numSteps,i=Math.floor((Date.now()-t.startTime)/t.duration*n)+1,t.currentStep=Math.min(i,n),B.callback(t.render,[e,t],e),B.callback(t.onAnimationProgress,[t],e),t.currentStep>=n?(B.callback(t.onAnimationComplete,[t],e),e.animating=!1,a.splice(r,1)):++r}},tt=B.options.resolve,et=["push","pop","shift","splice","unshift"];function nt(t,e){var n=t._chartjs;if(n){var i=n.listeners,a=i.indexOf(e);-1!==a&&i.splice(a,1),i.length>0||(et.forEach((function(e){delete t[e]})),delete t._chartjs)}}var it=function(t,e){this.initialize(t,e)};B.extend(it.prototype,{datasetElementType:null,dataElementType:null,_datasetElementOptions:["backgroundColor","borderCapStyle","borderColor","borderDash","borderDashOffset","borderJoinStyle","borderWidth"],_dataElementOptions:["backgroundColor","borderColor","borderWidth","pointStyle"],initialize:function(t,e){var n=this;n.chart=t,n.index=e,n.linkScales(),n.addElements(),n._type=n.getMeta().type},updateIndex:function(t){this.index=t},linkScales:function(){var t=this.getMeta(),e=this.chart,n=e.scales,i=this.getDataset(),a=e.options.scales;null!==t.xAxisID&&t.xAxisID in n&&!i.xAxisID||(t.xAxisID=i.xAxisID||a.xAxes[0].id),null!==t.yAxisID&&t.yAxisID in n&&!i.yAxisID||(t.yAxisID=i.yAxisID||a.yAxes[0].id)},getDataset:function(){return this.chart.data.datasets[this.index]},getMeta:function(){return this.chart.getDatasetMeta(this.index)},getScaleForId:function(t){return this.chart.scales[t]},_getValueScaleId:function(){return this.getMeta().yAxisID},_getIndexScaleId:function(){return this.getMeta().xAxisID},_getValueScale:function(){return this.getScaleForId(this._getValueScaleId())},_getIndexScale:function(){return this.getScaleForId(this._getIndexScaleId())},reset:function(){this._update(!0)},destroy:function(){this._data&&nt(this._data,this)},createMetaDataset:function(){var t=this.datasetElementType;return t&&new t({_chart:this.chart,_datasetIndex:this.index})},createMetaData:function(t){var e=this.dataElementType;return e&&new e({_chart:this.chart,_datasetIndex:this.index,_index:t})},addElements:function(){var t,e,n=this.getMeta(),i=this.getDataset().data||[],a=n.data;for(t=0,e=i.length;t<e;++t)a[t]=a[t]||this.createMetaData(t);n.dataset=n.dataset||this.createMetaDataset()},addElementAndReset:function(t){var e=this.createMetaData(t);this.getMeta().data.splice(t,0,e),this.updateElement(e,t,!0)},buildOrUpdateElements:function(){var t,e,n=this,i=n.getDataset(),a=i.data||(i.data=[]);n._data!==a&&(n._data&&nt(n._data,n),a&&Object.isExtensible(a)&&(e=n,(t=a)._chartjs?t._chartjs.listeners.push(e):(Object.defineProperty(t,"_chartjs",{configurable:!0,enumerable:!1,value:{listeners:[e]}}),et.forEach((function(e){var n="onData"+e.charAt(0).toUpperCase()+e.slice(1),i=t[e];Object.defineProperty(t,e,{configurable:!0,enumerable:!1,value:function(){var e=Array.prototype.slice.call(arguments),a=i.apply(this,e);return B.each(t._chartjs.listeners,(function(t){"function"==typeof t[n]&&t[n].apply(t,e)})),a}})})))),n._data=a),n.resyncElements()},_configure:function(){this._config=B.merge(Object.create(null),[this.chart.options.datasets[this._type],this.getDataset()],{merger:function(t,e,n){"_meta"!==t&&"data"!==t&&B._merger(t,e,n)}})},_update:function(t){this._configure(),this._cachedDataOpts=null,this.update(t)},update:B.noop,transition:function(t){for(var e=this.getMeta(),n=e.data||[],i=n.length,a=0;a<i;++a)n[a].transition(t);e.dataset&&e.dataset.transition(t)},draw:function(){var t=this.getMeta(),e=t.data||[],n=e.length,i=0;for(t.dataset&&t.dataset.draw();i<n;++i)e[i].draw()},getStyle:function(t){var e,n=this.getMeta(),i=n.dataset;return this._configure(),i&&void 0===t?e=this._resolveDatasetElementOptions(i||{}):(t=t||0,e=this._resolveDataElementOptions(n.data[t]||{},t)),!1!==e.fill&&null!==e.fill||(e.backgroundColor=e.borderColor),e},_resolveDatasetElementOptions:function(t,e){var n,i,a,r,o=this,s=o.chart,l=o._config,u=t.custom||{},d=s.options.elements[o.datasetElementType.prototype._type]||{},h=o._datasetElementOptions,c={},f={chart:s,dataset:o.getDataset(),datasetIndex:o.index,hover:e};for(n=0,i=h.length;n<i;++n)a=h[n],r=e?"hover"+a.charAt(0).toUpperCase()+a.slice(1):a,c[a]=tt([u[r],l[r],d[r]],f);return c},_resolveDataElementOptions:function(t,e){var n=this,i=t&&t.custom,a=n._cachedDataOpts;if(a&&!i)return a;var r,o,s,l,u=n.chart,d=n._config,h=u.options.elements[n.dataElementType.prototype._type]||{},c=n._dataElementOptions,f={},g={chart:u,dataIndex:e,dataset:n.getDataset(),datasetIndex:n.index},m={cacheable:!i};if(i=i||{},B.isArray(c))for(o=0,s=c.length;o<s;++o)f[l=c[o]]=tt([i[l],d[l],h[l]],g,e,m);else for(o=0,s=(r=Object.keys(c)).length;o<s;++o)f[l=r[o]]=tt([i[l],d[c[l]],d[l],h[l]],g,e,m);return m.cacheable&&(n._cachedDataOpts=Object.freeze(f)),f},removeHoverStyle:function(t){B.merge(t._model,t.$previousStyle||{}),delete t.$previousStyle},setHoverStyle:function(t){var e=this.chart.data.datasets[t._datasetIndex],n=t._index,i=t.custom||{},a=t._model,r=B.getHoverColor;t.$previousStyle={backgroundColor:a.backgroundColor,borderColor:a.borderColor,borderWidth:a.borderWidth},a.backgroundColor=tt([i.hoverBackgroundColor,e.hoverBackgroundColor,r(a.backgroundColor)],void 0,n),a.borderColor=tt([i.hoverBorderColor,e.hoverBorderColor,r(a.borderColor)],void 0,n),a.borderWidth=tt([i.hoverBorderWidth,e.hoverBorderWidth,a.borderWidth],void 0,n)},_removeDatasetHoverStyle:function(){var t=this.getMeta().dataset;t&&this.removeHoverStyle(t)},_setDatasetHoverStyle:function(){var t,e,n,i,a,r,o=this.getMeta().dataset,s={};if(o){for(r=o._model,a=this._resolveDatasetElementOptions(o,!0),t=0,e=(i=Object.keys(a)).length;t<e;++t)s[n=i[t]]=r[n],r[n]=a[n];o.$previousStyle=s}},resyncElements:function(){var t=this.getMeta(),e=this.getDataset().data,n=t.data.length,i=e.length;i<n?t.data.splice(i,n-i):i>n&&this.insertElements(n,i-n)},insertElements:function(t,e){for(var n=0;n<e;++n)this.addElementAndReset(t+n)},onDataPush:function(){var t=arguments.length;this.insertElements(this.getDataset().data.length-t,t)},onDataPop:function(){this.getMeta().data.pop()},onDataShift:function(){this.getMeta().data.shift()},onDataSplice:function(t,e){this.getMeta().data.splice(t,e),this.insertElements(t,arguments.length-2)},onDataUnshift:function(){this.insertElements(0,arguments.length)}}),it.extend=B.inherits;var at=it,rt=2*Math.PI;function ot(t,e){var n=e.startAngle,i=e.endAngle,a=e.pixelMargin,r=a/e.outerRadius,o=e.x,s=e.y;t.beginPath(),t.arc(o,s,e.outerRadius,n-r,i+r),e.innerRadius>a?(r=a/e.innerRadius,t.arc(o,s,e.innerRadius-a,i+r,n-r,!0)):t.arc(o,s,a,i+Math.PI/2,n-Math.PI/2),t.closePath(),t.clip()}function st(t,e,n){var i="inner"===e.borderAlign;i?(t.lineWidth=2*e.borderWidth,t.lineJoin="round"):(t.lineWidth=e.borderWidth,t.lineJoin="bevel"),n.fullCircles&&function(t,e,n,i){var a,r=n.endAngle;for(i&&(n.endAngle=n.startAngle+rt,ot(t,n),n.endAngle=r,n.endAngle===n.startAngle&&n.fullCircles&&(n.endAngle+=rt,n.fullCircles--)),t.beginPath(),t.arc(n.x,n.y,n.innerRadius,n.startAngle+rt,n.startAngle,!0),a=0;a<n.fullCircles;++a)t.stroke();for(t.beginPath(),t.arc(n.x,n.y,e.outerRadius,n.startAngle,n.startAngle+rt),a=0;a<n.fullCircles;++a)t.stroke()}(t,e,n,i),i&&ot(t,n),t.beginPath(),t.arc(n.x,n.y,e.outerRadius,n.startAngle,n.endAngle),t.arc(n.x,n.y,n.innerRadius,n.endAngle,n.startAngle,!0),t.closePath(),t.stroke()}Y._set("global",{elements:{arc:{backgroundColor:Y.global.defaultColor,borderColor:"#fff",borderWidth:2,borderAlign:"center"}}});var lt=X.extend({_type:"arc",inLabelRange:function(t){var e=this._view;return!!e&&Math.pow(t-e.x,2)<Math.pow(e.radius+e.hoverRadius,2)},inRange:function(t,e){var n=this._view;if(n){for(var i=B.getAngleFromPoint(n,{x:t,y:e}),a=i.angle,r=i.distance,o=n.startAngle,s=n.endAngle;s<o;)s+=rt;for(;a>s;)a-=rt;for(;a<o;)a+=rt;var l=a>=o&&a<=s,u=r>=n.innerRadius&&r<=n.outerRadius;return l&&u}return!1},getCenterPoint:function(){var t=this._view,e=(t.startAngle+t.endAngle)/2,n=(t.innerRadius+t.outerRadius)/2;return{x:t.x+Math.cos(e)*n,y:t.y+Math.sin(e)*n}},getArea:function(){var t=this._view;return Math.PI*((t.endAngle-t.startAngle)/(2*Math.PI))*(Math.pow(t.outerRadius,2)-Math.pow(t.innerRadius,2))},tooltipPosition:function(){var t=this._view,e=t.startAngle+(t.endAngle-t.startAngle)/2,n=(t.outerRadius-t.innerRadius)/2+t.innerRadius;return{x:t.x+Math.cos(e)*n,y:t.y+Math.sin(e)*n}},draw:function(){var t,e=this._chart.ctx,n=this._view,i="inner"===n.borderAlign?.33:0,a={x:n.x,y:n.y,innerRadius:n.innerRadius,outerRadius:Math.max(n.outerRadius-i,0),pixelMargin:i,startAngle:n.startAngle,endAngle:n.endAngle,fullCircles:Math.floor(n.circumference/rt)};if(e.save(),e.fillStyle=n.backgroundColor,e.strokeStyle=n.borderColor,a.fullCircles){for(a.endAngle=a.startAngle+rt,e.beginPath(),e.arc(a.x,a.y,a.outerRadius,a.startAngle,a.endAngle),e.arc(a.x,a.y,a.innerRadius,a.endAngle,a.startAngle,!0),e.closePath(),t=0;t<a.fullCircles;++t)e.fill();a.endAngle=a.startAngle+n.circumference%rt}e.beginPath(),e.arc(a.x,a.y,a.outerRadius,a.startAngle,a.endAngle),e.arc(a.x,a.y,a.innerRadius,a.endAngle,a.startAngle,!0),e.closePath(),e.fill(),n.borderWidth&&st(e,n,a),e.restore()}}),ut=B.valueOrDefault,dt=Y.global.defaultColor;Y._set("global",{elements:{line:{tension:.4,backgroundColor:dt,borderWidth:3,borderColor:dt,borderCapStyle:"butt",borderDash:[],borderDashOffset:0,borderJoinStyle:"miter",capBezierPoints:!0,fill:!0}}});var ht=X.extend({_type:"line",draw:function(){var t,e,n,i=this,a=i._view,r=i._chart.ctx,o=a.spanGaps,s=i._children.slice(),l=Y.global,u=l.elements.line,d=-1,h=i._loop;if(s.length){if(i._loop){for(t=0;t<s.length;++t)if(e=B.previousItem(s,t),!s[t]._view.skip&&e._view.skip){s=s.slice(t).concat(s.slice(0,t)),h=o;break}h&&s.push(s[0])}for(r.save(),r.lineCap=a.borderCapStyle||u.borderCapStyle,r.setLineDash&&r.setLineDash(a.borderDash||u.borderDash),r.lineDashOffset=ut(a.borderDashOffset,u.borderDashOffset),r.lineJoin=a.borderJoinStyle||u.borderJoinStyle,r.lineWidth=ut(a.borderWidth,u.borderWidth),r.strokeStyle=a.borderColor||l.defaultColor,r.beginPath(),(n=s[0]._view).skip||(r.moveTo(n.x,n.y),d=0),t=1;t<s.length;++t)n=s[t]._view,e=-1===d?B.previousItem(s,t):s[d],n.skip||(d!==t-1&&!o||-1===d?r.moveTo(n.x,n.y):B.canvas.lineTo(r,e._view,n),d=t);h&&r.closePath(),r.stroke(),r.restore()}}}),ct=B.valueOrDefault,ft=Y.global.defaultColor;function gt(t){var e=this._view;return!!e&&Math.abs(t-e.x)<e.radius+e.hitRadius}Y._set("global",{elements:{point:{radius:3,pointStyle:"circle",backgroundColor:ft,borderColor:ft,borderWidth:1,hitRadius:1,hoverRadius:4,hoverBorderWidth:1}}});var mt=X.extend({_type:"point",inRange:function(t,e){var n=this._view;return!!n&&Math.pow(t-n.x,2)+Math.pow(e-n.y,2)<Math.pow(n.hitRadius+n.radius,2)},inLabelRange:gt,inXRange:gt,inYRange:function(t){var e=this._view;return!!e&&Math.abs(t-e.y)<e.radius+e.hitRadius},getCenterPoint:function(){var t=this._view;return{x:t.x,y:t.y}},getArea:function(){return Math.PI*Math.pow(this._view.radius,2)},tooltipPosition:function(){var t=this._view;return{x:t.x,y:t.y,padding:t.radius+t.borderWidth}},draw:function(t){var e=this._view,n=this._chart.ctx,i=e.pointStyle,a=e.rotation,r=e.radius,o=e.x,s=e.y,l=Y.global,u=l.defaultColor;e.skip||(void 0===t||B.canvas._isPointInArea(e,t))&&(n.strokeStyle=e.borderColor||u,n.lineWidth=ct(e.borderWidth,l.elements.point.borderWidth),n.fillStyle=e.backgroundColor||u,B.canvas.drawPoint(n,i,r,o,s,a))}}),pt=Y.global.defaultColor;function vt(t){return t&&void 0!==t.width}function bt(t){var e,n,i,a,r;return vt(t)?(r=t.width/2,e=t.x-r,n=t.x+r,i=Math.min(t.y,t.base),a=Math.max(t.y,t.base)):(r=t.height/2,e=Math.min(t.x,t.base),n=Math.max(t.x,t.base),i=t.y-r,a=t.y+r),{left:e,top:i,right:n,bottom:a}}function yt(t,e,n){return t===e?n:t===n?e:t}function xt(t,e,n){var i,a,r,o,s=t.borderWidth,l=function(t){var e=t.borderSkipped,n={};return e?(t.horizontal?t.base>t.x&&(e=yt(e,"left","right")):t.base<t.y&&(e=yt(e,"bottom","top")),n[e]=!0,n):n}(t);return B.isObject(s)?(i=+s.top||0,a=+s.right||0,r=+s.bottom||0,o=+s.left||0):i=a=r=o=+s||0,{t:l.top||i<0?0:i>n?n:i,r:l.right||a<0?0:a>e?e:a,b:l.bottom||r<0?0:r>n?n:r,l:l.left||o<0?0:o>e?e:o}}function _t(t,e,n){var i=null===e,a=null===n,r=!(!t||i&&a)&&bt(t);return r&&(i||e>=r.left&&e<=r.right)&&(a||n>=r.top&&n<=r.bottom)}Y._set("global",{elements:{rectangle:{backgroundColor:pt,borderColor:pt,borderSkipped:"bottom",borderWidth:0}}});var wt=X.extend({_type:"rectangle",draw:function(){var t=this._chart.ctx,e=this._view,n=function(t){var e=bt(t),n=e.right-e.left,i=e.bottom-e.top,a=xt(t,n/2,i/2);return{outer:{x:e.left,y:e.top,w:n,h:i},inner:{x:e.left+a.l,y:e.top+a.t,w:n-a.l-a.r,h:i-a.t-a.b}}}(e),i=n.outer,a=n.inner;t.fillStyle=e.backgroundColor,t.fillRect(i.x,i.y,i.w,i.h),i.w===a.w&&i.h===a.h||(t.save(),t.beginPath(),t.rect(i.x,i.y,i.w,i.h),t.clip(),t.fillStyle=e.borderColor,t.rect(a.x,a.y,a.w,a.h),t.fill("evenodd"),t.restore())},height:function(){var t=this._view;return t.base-t.y},inRange:function(t,e){return _t(this._view,t,e)},inLabelRange:function(t,e){var n=this._view;return vt(n)?_t(n,t,null):_t(n,null,e)},inXRange:function(t){return _t(this._view,t,null)},inYRange:function(t){return _t(this._view,null,t)},getCenterPoint:function(){var t,e,n=this._view;return vt(n)?(t=n.x,e=(n.y+n.base)/2):(t=(n.x+n.base)/2,e=n.y),{x:t,y:e}},getArea:function(){var t=this._view;return vt(t)?t.width*Math.abs(t.y-t.base):t.height*Math.abs(t.x-t.base)},tooltipPosition:function(){var t=this._view;return{x:t.x,y:t.y}}}),kt={},Mt=lt,St=ht,Dt=mt,Ct=wt;kt.Arc=Mt,kt.Line=St,kt.Point=Dt,kt.Rectangle=Ct;var Pt=B._deprecated,Tt=B.valueOrDefault;function Ot(t,e,n){var i,a,r=n.barThickness,o=e.stackCount,s=e.pixels[t],l=B.isNullOrUndef(r)?function(t,e){var n,i,a,r,o=t._length;for(a=1,r=e.length;a<r;++a)o=Math.min(o,Math.abs(e[a]-e[a-1]));for(a=0,r=t.getTicks().length;a<r;++a)i=t.getPixelForTick(a),o=a>0?Math.min(o,Math.abs(i-n)):o,n=i;return o}(e.scale,e.pixels):-1;return B.isNullOrUndef(r)?(i=l*n.categoryPercentage,a=n.barPercentage):(i=r*o,a=1),{chunk:i/o,ratio:a,start:s-i/2}}Y._set("bar",{hover:{mode:"label"},scales:{xAxes:[{type:"category",offset:!0,gridLines:{offsetGridLines:!0}}],yAxes:[{type:"linear"}]}}),Y._set("global",{datasets:{bar:{categoryPercentage:.8,barPercentage:.9}}});var At=at.extend({dataElementType:kt.Rectangle,_dataElementOptions:["backgroundColor","borderColor","borderSkipped","borderWidth","barPercentage","barThickness","categoryPercentage","maxBarThickness","minBarLength"],initialize:function(){var t,e,n=this;at.prototype.initialize.apply(n,arguments),(t=n.getMeta()).stack=n.getDataset().stack,t.bar=!0,e=n._getIndexScale().options,Pt("bar chart",e.barPercentage,"scales.[x/y]Axes.barPercentage","dataset.barPercentage"),Pt("bar chart",e.barThickness,"scales.[x/y]Axes.barThickness","dataset.barThickness"),Pt("bar chart",e.categoryPercentage,"scales.[x/y]Axes.categoryPercentage","dataset.categoryPercentage"),Pt("bar chart",n._getValueScale().options.minBarLength,"scales.[x/y]Axes.minBarLength","dataset.minBarLength"),Pt("bar chart",e.maxBarThickness,"scales.[x/y]Axes.maxBarThickness","dataset.maxBarThickness")},update:function(t){var e,n,i=this.getMeta().data;for(this._ruler=this.getRuler(),e=0,n=i.length;e<n;++e)this.updateElement(i[e],e,t)},updateElement:function(t,e,n){var i=this,a=i.getMeta(),r=i.getDataset(),o=i._resolveDataElementOptions(t,e);t._xScale=i.getScaleForId(a.xAxisID),t._yScale=i.getScaleForId(a.yAxisID),t._datasetIndex=i.index,t._index=e,t._model={backgroundColor:o.backgroundColor,borderColor:o.borderColor,borderSkipped:o.borderSkipped,borderWidth:o.borderWidth,datasetLabel:r.label,label:i.chart.data.labels[e]},B.isArray(r.data[e])&&(t._model.borderSkipped=null),i._updateElementGeometry(t,e,n,o),t.pivot()},_updateElementGeometry:function(t,e,n,i){var a=this,r=t._model,o=a._getValueScale(),s=o.getBasePixel(),l=o.isHorizontal(),u=a._ruler||a.getRuler(),d=a.calculateBarValuePixels(a.index,e,i),h=a.calculateBarIndexPixels(a.index,e,u,i);r.horizontal=l,r.base=n?s:d.base,r.x=l?n?s:d.head:h.center,r.y=l?h.center:n?s:d.head,r.height=l?h.size:void 0,r.width=l?void 0:h.size},_getStacks:function(t){var e,n,i=this._getIndexScale(),a=i._getMatchingVisibleMetas(this._type),r=i.options.stacked,o=a.length,s=[];for(e=0;e<o&&(n=a[e],(!1===r||-1===s.indexOf(n.stack)||void 0===r&&void 0===n.stack)&&s.push(n.stack),n.index!==t);++e);return s},getStackCount:function(){return this._getStacks().length},getStackIndex:function(t,e){var n=this._getStacks(t),i=void 0!==e?n.indexOf(e):-1;return-1===i?n.length-1:i},getRuler:function(){var t,e,n=this._getIndexScale(),i=[];for(t=0,e=this.getMeta().data.length;t<e;++t)i.push(n.getPixelForValue(null,t,this.index));return{pixels:i,start:n._startPixel,end:n._endPixel,stackCount:this.getStackCount(),scale:n}},calculateBarValuePixels:function(t,e,n){var i,a,r,o,s,l,u,d=this.chart,h=this._getValueScale(),c=h.isHorizontal(),f=d.data.datasets,g=h._getMatchingVisibleMetas(this._type),m=h._parseValue(f[t].data[e]),p=n.minBarLength,v=h.options.stacked,b=this.getMeta().stack,y=void 0===m.start?0:m.max>=0&&m.min>=0?m.min:m.max,x=void 0===m.start?m.end:m.max>=0&&m.min>=0?m.max-m.min:m.min-m.max,_=g.length;if(v||void 0===v&&void 0!==b)for(i=0;i<_&&(a=g[i]).index!==t;++i)a.stack===b&&(r=void 0===(u=h._parseValue(f[a.index].data[e])).start?u.end:u.min>=0&&u.max>=0?u.max:u.min,(m.min<0&&r<0||m.max>=0&&r>0)&&(y+=r));return o=h.getPixelForValue(y),l=(s=h.getPixelForValue(y+x))-o,void 0!==p&&Math.abs(l)<p&&(l=p,s=x>=0&&!c||x<0&&c?o-p:o+p),{size:l,base:o,head:s,center:s+l/2}},calculateBarIndexPixels:function(t,e,n,i){var a="flex"===i.barThickness?function(t,e,n){var i,a=e.pixels,r=a[t],o=t>0?a[t-1]:null,s=t<a.length-1?a[t+1]:null,l=n.categoryPercentage;return null===o&&(o=r-(null===s?e.end-e.start:s-r)),null===s&&(s=r+r-o),i=r-(r-Math.min(o,s))/2*l,{chunk:Math.abs(s-o)/2*l/e.stackCount,ratio:n.barPercentage,start:i}}(e,n,i):Ot(e,n,i),r=this.getStackIndex(t,this.getMeta().stack),o=a.start+a.chunk*r+a.chunk/2,s=Math.min(Tt(i.maxBarThickness,1/0),a.chunk*a.ratio);return{base:o-s/2,head:o+s/2,center:o,size:s}},draw:function(){var t=this.chart,e=this._getValueScale(),n=this.getMeta().data,i=this.getDataset(),a=n.length,r=0;for(B.canvas.clipArea(t.ctx,t.chartArea);r<a;++r){var o=e._parseValue(i.data[r]);isNaN(o.min)||isNaN(o.max)||n[r].draw()}B.canvas.unclipArea(t.ctx)},_resolveDataElementOptions:function(){var t=this,e=B.extend({},at.prototype._resolveDataElementOptions.apply(t,arguments)),n=t._getIndexScale().options,i=t._getValueScale().options;return e.barPercentage=Tt(n.barPercentage,e.barPercentage),e.barThickness=Tt(n.barThickness,e.barThickness),e.categoryPercentage=Tt(n.categoryPercentage,e.categoryPercentage),e.maxBarThickness=Tt(n.maxBarThickness,e.maxBarThickness),e.minBarLength=Tt(i.minBarLength,e.minBarLength),e}}),Ft=B.valueOrDefault,It=B.options.resolve;Y._set("bubble",{hover:{mode:"single"},scales:{xAxes:[{type:"linear",position:"bottom",id:"x-axis-0"}],yAxes:[{type:"linear",position:"left",id:"y-axis-0"}]},tooltips:{callbacks:{title:function(){return""},label:function(t,e){var n=e.datasets[t.datasetIndex].label||"",i=e.datasets[t.datasetIndex].data[t.index];return n+": ("+t.xLabel+", "+t.yLabel+", "+i.r+")"}}}});var Lt=at.extend({dataElementType:kt.Point,_dataElementOptions:["backgroundColor","borderColor","borderWidth","hoverBackgroundColor","hoverBorderColor","hoverBorderWidth","hoverRadius","hitRadius","pointStyle","rotation"],update:function(t){var e=this,n=e.getMeta().data;B.each(n,(function(n,i){e.updateElement(n,i,t)}))},updateElement:function(t,e,n){var i=this,a=i.getMeta(),r=t.custom||{},o=i.getScaleForId(a.xAxisID),s=i.getScaleForId(a.yAxisID),l=i._resolveDataElementOptions(t,e),u=i.getDataset().data[e],d=i.index,h=n?o.getPixelForDecimal(.5):o.getPixelForValue("object"==typeof u?u:NaN,e,d),c=n?s.getBasePixel():s.getPixelForValue(u,e,d);t._xScale=o,t._yScale=s,t._options=l,t._datasetIndex=d,t._index=e,t._model={backgroundColor:l.backgroundColor,borderColor:l.borderColor,borderWidth:l.borderWidth,hitRadius:l.hitRadius,pointStyle:l.pointStyle,rotation:l.rotation,radius:n?0:l.radius,skip:r.skip||isNaN(h)||isNaN(c),x:h,y:c},t.pivot()},setHoverStyle:function(t){var e=t._model,n=t._options,i=B.getHoverColor;t.$previousStyle={backgroundColor:e.backgroundColor,borderColor:e.borderColor,borderWidth:e.borderWidth,radius:e.radius},e.backgroundColor=Ft(n.hoverBackgroundColor,i(n.backgroundColor)),e.borderColor=Ft(n.hoverBorderColor,i(n.borderColor)),e.borderWidth=Ft(n.hoverBorderWidth,n.borderWidth),e.radius=n.radius+n.hoverRadius},_resolveDataElementOptions:function(t,e){var n=this,i=n.chart,a=n.getDataset(),r=t.custom||{},o=a.data[e]||{},s=at.prototype._resolveDataElementOptions.apply(n,arguments),l={chart:i,dataIndex:e,dataset:a,datasetIndex:n.index};return n._cachedDataOpts===s&&(s=B.extend({},s)),s.radius=It([r.radius,o.r,n._config.radius,i.options.elements.point.radius],l,e),s}}),Rt=B.valueOrDefault,Nt=Math.PI,Wt=2*Nt,Yt=Nt/2;Y._set("doughnut",{animation:{animateRotate:!0,animateScale:!1},hover:{mode:"single"},legendCallback:function(t){var e,n,i,a=document.createElement("ul"),r=t.data,o=r.datasets,s=r.labels;if(a.setAttribute("class",t.id+"-legend"),o.length)for(e=0,n=o[0].data.length;e<n;++e)(i=a.appendChild(document.createElement("li"))).appendChild(document.createElement("span")).style.backgroundColor=o[0].backgroundColor[e],s[e]&&i.appendChild(document.createTextNode(s[e]));return a.outerHTML},legend:{labels:{generateLabels:function(t){var e=t.data;return e.labels.length&&e.datasets.length?e.labels.map((function(n,i){var a=t.getDatasetMeta(0),r=a.controller.getStyle(i);return{text:n,fillStyle:r.backgroundColor,strokeStyle:r.borderColor,lineWidth:r.borderWidth,hidden:isNaN(e.datasets[0].data[i])||a.data[i].hidden,index:i}})):[]}},onClick:function(t,e){var n,i,a,r=e.index,o=this.chart;for(n=0,i=(o.data.datasets||[]).length;n<i;++n)(a=o.getDatasetMeta(n)).data[r]&&(a.data[r].hidden=!a.data[r].hidden);o.update()}},cutoutPercentage:50,rotation:-Yt,circumference:Wt,tooltips:{callbacks:{title:function(){return""},label:function(t,e){var n=e.labels[t.index],i=": "+e.datasets[t.datasetIndex].data[t.index];return B.isArray(n)?(n=n.slice())[0]+=i:n+=i,n}}}});var zt=at.extend({dataElementType:kt.Arc,linkScales:B.noop,_dataElementOptions:["backgroundColor","borderColor","borderWidth","borderAlign","hoverBackgroundColor","hoverBorderColor","hoverBorderWidth"],getRingIndex:function(t){for(var e=0,n=0;n<t;++n)this.chart.isDatasetVisible(n)&&++e;return e},update:function(t){var e,n,i,a,r=this,o=r.chart,s=o.chartArea,l=o.options,u=1,d=1,h=0,c=0,f=r.getMeta(),g=f.data,m=l.cutoutPercentage/100||0,p=l.circumference,v=r._getRingWeight(r.index);if(p<Wt){var b=l.rotation%Wt,y=(b+=b>=Nt?-Wt:b<-Nt?Wt:0)+p,x=Math.cos(b),_=Math.sin(b),w=Math.cos(y),k=Math.sin(y),M=b<=0&&y>=0||y>=Wt,S=b<=Yt&&y>=Yt||y>=Wt+Yt,D=b<=-Yt&&y>=-Yt||y>=Nt+Yt,C=b===-Nt||y>=Nt?-1:Math.min(x,x*m,w,w*m),P=D?-1:Math.min(_,_*m,k,k*m),T=M?1:Math.max(x,x*m,w,w*m),O=S?1:Math.max(_,_*m,k,k*m);u=(T-C)/2,d=(O-P)/2,h=-(T+C)/2,c=-(O+P)/2}for(i=0,a=g.length;i<a;++i)g[i]._options=r._resolveDataElementOptions(g[i],i);for(o.borderWidth=r.getMaxBorderWidth(),e=(s.right-s.left-o.borderWidth)/u,n=(s.bottom-s.top-o.borderWidth)/d,o.outerRadius=Math.max(Math.min(e,n)/2,0),o.innerRadius=Math.max(o.outerRadius*m,0),o.radiusLength=(o.outerRadius-o.innerRadius)/(r._getVisibleDatasetWeightTotal()||1),o.offsetX=h*o.outerRadius,o.offsetY=c*o.outerRadius,f.total=r.calculateTotal(),r.outerRadius=o.outerRadius-o.radiusLength*r._getRingWeightOffset(r.index),r.innerRadius=Math.max(r.outerRadius-o.radiusLength*v,0),i=0,a=g.length;i<a;++i)r.updateElement(g[i],i,t)},updateElement:function(t,e,n){var i=this,a=i.chart,r=a.chartArea,o=a.options,s=o.animation,l=(r.left+r.right)/2,u=(r.top+r.bottom)/2,d=o.rotation,h=o.rotation,c=i.getDataset(),f=n&&s.animateRotate?0:t.hidden?0:i.calculateCircumference(c.data[e])*(o.circumference/Wt),g=n&&s.animateScale?0:i.innerRadius,m=n&&s.animateScale?0:i.outerRadius,p=t._options||{};B.extend(t,{_datasetIndex:i.index,_index:e,_model:{backgroundColor:p.backgroundColor,borderColor:p.borderColor,borderWidth:p.borderWidth,borderAlign:p.borderAlign,x:l+a.offsetX,y:u+a.offsetY,startAngle:d,endAngle:h,circumference:f,outerRadius:m,innerRadius:g,label:B.valueAtIndexOrDefault(c.label,e,a.data.labels[e])}});var v=t._model;n&&s.animateRotate||(v.startAngle=0===e?o.rotation:i.getMeta().data[e-1]._model.endAngle,v.endAngle=v.startAngle+v.circumference),t.pivot()},calculateTotal:function(){var t,e=this.getDataset(),n=this.getMeta(),i=0;return B.each(n.data,(function(n,a){t=e.data[a],isNaN(t)||n.hidden||(i+=Math.abs(t))})),i},calculateCircumference:function(t){var e=this.getMeta().total;return e>0&&!isNaN(t)?Wt*(Math.abs(t)/e):0},getMaxBorderWidth:function(t){var e,n,i,a,r,o,s,l,u=0,d=this.chart;if(!t)for(e=0,n=d.data.datasets.length;e<n;++e)if(d.isDatasetVisible(e)){t=(i=d.getDatasetMeta(e)).data,e!==this.index&&(r=i.controller);break}if(!t)return 0;for(e=0,n=t.length;e<n;++e)a=t[e],r?(r._configure(),o=r._resolveDataElementOptions(a,e)):o=a._options,"inner"!==o.borderAlign&&(s=o.borderWidth,u=(l=o.hoverBorderWidth)>(u=s>u?s:u)?l:u);return u},setHoverStyle:function(t){var e=t._model,n=t._options,i=B.getHoverColor;t.$previousStyle={backgroundColor:e.backgroundColor,borderColor:e.borderColor,borderWidth:e.borderWidth},e.backgroundColor=Rt(n.hoverBackgroundColor,i(n.backgroundColor)),e.borderColor=Rt(n.hoverBorderColor,i(n.borderColor)),e.borderWidth=Rt(n.hoverBorderWidth,n.borderWidth)},_getRingWeightOffset:function(t){for(var e=0,n=0;n<t;++n)this.chart.isDatasetVisible(n)&&(e+=this._getRingWeight(n));return e},_getRingWeight:function(t){return Math.max(Rt(this.chart.data.datasets[t].weight,1),0)},_getVisibleDatasetWeightTotal:function(){return this._getRingWeightOffset(this.chart.data.datasets.length)}});Y._set("horizontalBar",{hover:{mode:"index",axis:"y"},scales:{xAxes:[{type:"linear",position:"bottom"}],yAxes:[{type:"category",position:"left",offset:!0,gridLines:{offsetGridLines:!0}}]},elements:{rectangle:{borderSkipped:"left"}},tooltips:{mode:"index",axis:"y"}}),Y._set("global",{datasets:{horizontalBar:{categoryPercentage:.8,barPercentage:.9}}});var Et=At.extend({_getValueScaleId:function(){return this.getMeta().xAxisID},_getIndexScaleId:function(){return this.getMeta().yAxisID}}),Vt=B.valueOrDefault,Ht=B.options.resolve,Bt=B.canvas._isPointInArea;function jt(t,e){var n=t&&t.options.ticks||{},i=n.reverse,a=void 0===n.min?e:0,r=void 0===n.max?e:0;return{start:i?r:a,end:i?a:r}}function Ut(t,e,n){var i=n/2,a=jt(t,i),r=jt(e,i);return{top:r.end,right:a.end,bottom:r.start,left:a.start}}function Gt(t){var e,n,i,a;return B.isObject(t)?(e=t.top,n=t.right,i=t.bottom,a=t.left):e=n=i=a=t,{top:e,right:n,bottom:i,left:a}}Y._set("line",{showLines:!0,spanGaps:!1,hover:{mode:"label"},scales:{xAxes:[{type:"category",id:"x-axis-0"}],yAxes:[{type:"linear",id:"y-axis-0"}]}});var qt=at.extend({datasetElementType:kt.Line,dataElementType:kt.Point,_datasetElementOptions:["backgroundColor","borderCapStyle","borderColor","borderDash","borderDashOffset","borderJoinStyle","borderWidth","cubicInterpolationMode","fill"],_dataElementOptions:{backgroundColor:"pointBackgroundColor",borderColor:"pointBorderColor",borderWidth:"pointBorderWidth",hitRadius:"pointHitRadius",hoverBackgroundColor:"pointHoverBackgroundColor",hoverBorderColor:"pointHoverBorderColor",hoverBorderWidth:"pointHoverBorderWidth",hoverRadius:"pointHoverRadius",pointStyle:"pointStyle",radius:"pointRadius",rotation:"pointRotation"},update:function(t){var e,n,i=this,a=i.getMeta(),r=a.dataset,o=a.data||[],s=i.chart.options,l=i._config,u=i._showLine=Vt(l.showLine,s.showLines);for(i._xScale=i.getScaleForId(a.xAxisID),i._yScale=i.getScaleForId(a.yAxisID),u&&(void 0!==l.tension&&void 0===l.lineTension&&(l.lineTension=l.tension),r._scale=i._yScale,r._datasetIndex=i.index,r._children=o,r._model=i._resolveDatasetElementOptions(r),r.pivot()),e=0,n=o.length;e<n;++e)i.updateElement(o[e],e,t);for(u&&0!==r._model.tension&&i.updateBezierControlPoints(),e=0,n=o.length;e<n;++e)o[e].pivot()},updateElement:function(t,e,n){var i,a,r=this,o=r.getMeta(),s=t.custom||{},l=r.getDataset(),u=r.index,d=l.data[e],h=r._xScale,c=r._yScale,f=o.dataset._model,g=r._resolveDataElementOptions(t,e);i=h.getPixelForValue("object"==typeof d?d:NaN,e,u),a=n?c.getBasePixel():r.calculatePointY(d,e,u),t._xScale=h,t._yScale=c,t._options=g,t._datasetIndex=u,t._index=e,t._model={x:i,y:a,skip:s.skip||isNaN(i)||isNaN(a),radius:g.radius,pointStyle:g.pointStyle,rotation:g.rotation,backgroundColor:g.backgroundColor,borderColor:g.borderColor,borderWidth:g.borderWidth,tension:Vt(s.tension,f?f.tension:0),steppedLine:!!f&&f.steppedLine,hitRadius:g.hitRadius}},_resolveDatasetElementOptions:function(t){var e=this,n=e._config,i=t.custom||{},a=e.chart.options,r=a.elements.line,o=at.prototype._resolveDatasetElementOptions.apply(e,arguments);return o.spanGaps=Vt(n.spanGaps,a.spanGaps),o.tension=Vt(n.lineTension,r.tension),o.steppedLine=Ht([i.steppedLine,n.steppedLine,r.stepped]),o.clip=Gt(Vt(n.clip,Ut(e._xScale,e._yScale,o.borderWidth))),o},calculatePointY:function(t,e,n){var i,a,r,o,s,l,u,d=this.chart,h=this._yScale,c=0,f=0;if(h.options.stacked){for(s=+h.getRightValue(t),u=(l=d._getSortedVisibleDatasetMetas()).length,i=0;i<u&&(r=l[i]).index!==n;++i)a=d.data.datasets[r.index],"line"===r.type&&r.yAxisID===h.id&&((o=+h.getRightValue(a.data[e]))<0?f+=o||0:c+=o||0);return s<0?h.getPixelForValue(f+s):h.getPixelForValue(c+s)}return h.getPixelForValue(t)},updateBezierControlPoints:function(){var t,e,n,i,a=this.chart,r=this.getMeta(),o=r.dataset._model,s=a.chartArea,l=r.data||[];function u(t,e,n){return Math.max(Math.min(t,n),e)}if(o.spanGaps&&(l=l.filter((function(t){return!t._model.skip}))),"monotone"===o.cubicInterpolationMode)B.splineCurveMonotone(l);else for(t=0,e=l.length;t<e;++t)n=l[t]._model,i=B.splineCurve(B.previousItem(l,t)._model,n,B.nextItem(l,t)._model,o.tension),n.controlPointPreviousX=i.previous.x,n.controlPointPreviousY=i.previous.y,n.controlPointNextX=i.next.x,n.controlPointNextY=i.next.y;if(a.options.elements.line.capBezierPoints)for(t=0,e=l.length;t<e;++t)n=l[t]._model,Bt(n,s)&&(t>0&&Bt(l[t-1]._model,s)&&(n.controlPointPreviousX=u(n.controlPointPreviousX,s.left,s.right),n.controlPointPreviousY=u(n.controlPointPreviousY,s.top,s.bottom)),t<l.length-1&&Bt(l[t+1]._model,s)&&(n.controlPointNextX=u(n.controlPointNextX,s.left,s.right),n.controlPointNextY=u(n.controlPointNextY,s.top,s.bottom)))},draw:function(){var t,e=this.chart,n=this.getMeta(),i=n.data||[],a=e.chartArea,r=e.canvas,o=0,s=i.length;for(this._showLine&&(t=n.dataset._model.clip,B.canvas.clipArea(e.ctx,{left:!1===t.left?0:a.left-t.left,right:!1===t.right?r.width:a.right+t.right,top:!1===t.top?0:a.top-t.top,bottom:!1===t.bottom?r.height:a.bottom+t.bottom}),n.dataset.draw(),B.canvas.unclipArea(e.ctx));o<s;++o)i[o].draw(a)},setHoverStyle:function(t){var e=t._model,n=t._options,i=B.getHoverColor;t.$previousStyle={backgroundColor:e.backgroundColor,borderColor:e.borderColor,borderWidth:e.borderWidth,radius:e.radius},e.backgroundColor=Vt(n.hoverBackgroundColor,i(n.backgroundColor)),e.borderColor=Vt(n.hoverBorderColor,i(n.borderColor)),e.borderWidth=Vt(n.hoverBorderWidth,n.borderWidth),e.radius=Vt(n.hoverRadius,n.radius)}}),Zt=B.options.resolve;Y._set("polarArea",{scale:{type:"radialLinear",angleLines:{display:!1},gridLines:{circular:!0},pointLabels:{display:!1},ticks:{beginAtZero:!0}},animation:{animateRotate:!0,animateScale:!0},startAngle:-.5*Math.PI,legendCallback:function(t){var e,n,i,a=document.createElement("ul"),r=t.data,o=r.datasets,s=r.labels;if(a.setAttribute("class",t.id+"-legend"),o.length)for(e=0,n=o[0].data.length;e<n;++e)(i=a.appendChild(document.createElement("li"))).appendChild(document.createElement("span")).style.backgroundColor=o[0].backgroundColor[e],s[e]&&i.appendChild(document.createTextNode(s[e]));return a.outerHTML},legend:{labels:{generateLabels:function(t){var e=t.data;return e.labels.length&&e.datasets.length?e.labels.map((function(n,i){var a=t.getDatasetMeta(0),r=a.controller.getStyle(i);return{text:n,fillStyle:r.backgroundColor,strokeStyle:r.borderColor,lineWidth:r.borderWidth,hidden:isNaN(e.datasets[0].data[i])||a.data[i].hidden,index:i}})):[]}},onClick:function(t,e){var n,i,a,r=e.index,o=this.chart;for(n=0,i=(o.data.datasets||[]).length;n<i;++n)(a=o.getDatasetMeta(n)).data[r].hidden=!a.data[r].hidden;o.update()}},tooltips:{callbacks:{title:function(){return""},label:function(t,e){return e.labels[t.index]+": "+t.yLabel}}}});var $t=at.extend({dataElementType:kt.Arc,linkScales:B.noop,_dataElementOptions:["backgroundColor","borderColor","borderWidth","borderAlign","hoverBackgroundColor","hoverBorderColor","hoverBorderWidth"],_getIndexScaleId:function(){return this.chart.scale.id},_getValueScaleId:function(){return this.chart.scale.id},update:function(t){var e,n,i,a=this,r=a.getDataset(),o=a.getMeta(),s=a.chart.options.startAngle||0,l=a._starts=[],u=a._angles=[],d=o.data;for(a._updateRadius(),o.count=a.countVisibleElements(),e=0,n=r.data.length;e<n;e++)l[e]=s,i=a._computeAngle(e),u[e]=i,s+=i;for(e=0,n=d.length;e<n;++e)d[e]._options=a._resolveDataElementOptions(d[e],e),a.updateElement(d[e],e,t)},_updateRadius:function(){var t=this,e=t.chart,n=e.chartArea,i=e.options,a=Math.min(n.right-n.left,n.bottom-n.top);e.outerRadius=Math.max(a/2,0),e.innerRadius=Math.max(i.cutoutPercentage?e.outerRadius/100*i.cutoutPercentage:1,0),e.radiusLength=(e.outerRadius-e.innerRadius)/e.getVisibleDatasetCount(),t.outerRadius=e.outerRadius-e.radiusLength*t.index,t.innerRadius=t.outerRadius-e.radiusLength},updateElement:function(t,e,n){var i=this,a=i.chart,r=i.getDataset(),o=a.options,s=o.animation,l=a.scale,u=a.data.labels,d=l.xCenter,h=l.yCenter,c=o.startAngle,f=t.hidden?0:l.getDistanceFromCenterForValue(r.data[e]),g=i._starts[e],m=g+(t.hidden?0:i._angles[e]),p=s.animateScale?0:l.getDistanceFromCenterForValue(r.data[e]),v=t._options||{};B.extend(t,{_datasetIndex:i.index,_index:e,_scale:l,_model:{backgroundColor:v.backgroundColor,borderColor:v.borderColor,borderWidth:v.borderWidth,borderAlign:v.borderAlign,x:d,y:h,innerRadius:0,outerRadius:n?p:f,startAngle:n&&s.animateRotate?c:g,endAngle:n&&s.animateRotate?c:m,label:B.valueAtIndexOrDefault(u,e,u[e])}}),t.pivot()},countVisibleElements:function(){var t=this.getDataset(),e=this.getMeta(),n=0;return B.each(e.data,(function(e,i){isNaN(t.data[i])||e.hidden||n++})),n},setHoverStyle:function(t){var e=t._model,n=t._options,i=B.getHoverColor,a=B.valueOrDefault;t.$previousStyle={backgroundColor:e.backgroundColor,borderColor:e.borderColor,borderWidth:e.borderWidth},e.backgroundColor=a(n.hoverBackgroundColor,i(n.backgroundColor)),e.borderColor=a(n.hoverBorderColor,i(n.borderColor)),e.borderWidth=a(n.hoverBorderWidth,n.borderWidth)},_computeAngle:function(t){var e=this,n=this.getMeta().count,i=e.getDataset(),a=e.getMeta();if(isNaN(i.data[t])||a.data[t].hidden)return 0;var r={chart:e.chart,dataIndex:t,dataset:i,datasetIndex:e.index};return Zt([e.chart.options.elements.arc.angle,2*Math.PI/n],r,t)}});Y._set("pie",B.clone(Y.doughnut)),Y._set("pie",{cutoutPercentage:0});var Xt=zt,Kt=B.valueOrDefault;Y._set("radar",{spanGaps:!1,scale:{type:"radialLinear"},elements:{line:{fill:"start",tension:0}}});var Jt=at.extend({datasetElementType:kt.Line,dataElementType:kt.Point,linkScales:B.noop,_datasetElementOptions:["backgroundColor","borderWidth","borderColor","borderCapStyle","borderDash","borderDashOffset","borderJoinStyle","fill"],_dataElementOptions:{backgroundColor:"pointBackgroundColor",borderColor:"pointBorderColor",borderWidth:"pointBorderWidth",hitRadius:"pointHitRadius",hoverBackgroundColor:"pointHoverBackgroundColor",hoverBorderColor:"pointHoverBorderColor",hoverBorderWidth:"pointHoverBorderWidth",hoverRadius:"pointHoverRadius",pointStyle:"pointStyle",radius:"pointRadius",rotation:"pointRotation"},_getIndexScaleId:function(){return this.chart.scale.id},_getValueScaleId:function(){return this.chart.scale.id},update:function(t){var e,n,i=this,a=i.getMeta(),r=a.dataset,o=a.data||[],s=i.chart.scale,l=i._config;for(void 0!==l.tension&&void 0===l.lineTension&&(l.lineTension=l.tension),r._scale=s,r._datasetIndex=i.index,r._children=o,r._loop=!0,r._model=i._resolveDatasetElementOptions(r),r.pivot(),e=0,n=o.length;e<n;++e)i.updateElement(o[e],e,t);for(i.updateBezierControlPoints(),e=0,n=o.length;e<n;++e)o[e].pivot()},updateElement:function(t,e,n){var i=this,a=t.custom||{},r=i.getDataset(),o=i.chart.scale,s=o.getPointPositionForValue(e,r.data[e]),l=i._resolveDataElementOptions(t,e),u=i.getMeta().dataset._model,d=n?o.xCenter:s.x,h=n?o.yCenter:s.y;t._scale=o,t._options=l,t._datasetIndex=i.index,t._index=e,t._model={x:d,y:h,skip:a.skip||isNaN(d)||isNaN(h),radius:l.radius,pointStyle:l.pointStyle,rotation:l.rotation,backgroundColor:l.backgroundColor,borderColor:l.borderColor,borderWidth:l.borderWidth,tension:Kt(a.tension,u?u.tension:0),hitRadius:l.hitRadius}},_resolveDatasetElementOptions:function(){var t=this,e=t._config,n=t.chart.options,i=at.prototype._resolveDatasetElementOptions.apply(t,arguments);return i.spanGaps=Kt(e.spanGaps,n.spanGaps),i.tension=Kt(e.lineTension,n.elements.line.tension),i},updateBezierControlPoints:function(){var t,e,n,i,a=this.getMeta(),r=this.chart.chartArea,o=a.data||[];function s(t,e,n){return Math.max(Math.min(t,n),e)}for(a.dataset._model.spanGaps&&(o=o.filter((function(t){return!t._model.skip}))),t=0,e=o.length;t<e;++t)n=o[t]._model,i=B.splineCurve(B.previousItem(o,t,!0)._model,n,B.nextItem(o,t,!0)._model,n.tension),n.controlPointPreviousX=s(i.previous.x,r.left,r.right),n.controlPointPreviousY=s(i.previous.y,r.top,r.bottom),n.controlPointNextX=s(i.next.x,r.left,r.right),n.controlPointNextY=s(i.next.y,r.top,r.bottom)},setHoverStyle:function(t){var e=t._model,n=t._options,i=B.getHoverColor;t.$previousStyle={backgroundColor:e.backgroundColor,borderColor:e.borderColor,borderWidth:e.borderWidth,radius:e.radius},e.backgroundColor=Kt(n.hoverBackgroundColor,i(n.backgroundColor)),e.borderColor=Kt(n.hoverBorderColor,i(n.borderColor)),e.borderWidth=Kt(n.hoverBorderWidth,n.borderWidth),e.radius=Kt(n.hoverRadius,n.radius)}});Y._set("scatter",{hover:{mode:"single"},scales:{xAxes:[{id:"x-axis-1",type:"linear",position:"bottom"}],yAxes:[{id:"y-axis-1",type:"linear",position:"left"}]},tooltips:{callbacks:{title:function(){return""},label:function(t){return"("+t.xLabel+", "+t.yLabel+")"}}}}),Y._set("global",{datasets:{scatter:{showLine:!1}}});var Qt={bar:At,bubble:Lt,doughnut:zt,horizontalBar:Et,line:qt,polarArea:$t,pie:Xt,radar:Jt,scatter:qt};function te(t,e){return t.native?{x:t.x,y:t.y}:B.getRelativePosition(t,e)}function ee(t,e){var n,i,a,r,o,s,l=t._getSortedVisibleDatasetMetas();for(i=0,r=l.length;i<r;++i)for(a=0,o=(n=l[i].data).length;a<o;++a)(s=n[a])._view.skip||e(s)}function ne(t,e){var n=[];return ee(t,(function(t){t.inRange(e.x,e.y)&&n.push(t)})),n}function ie(t,e,n,i){var a=Number.POSITIVE_INFINITY,r=[];return ee(t,(function(t){if(!n||t.inRange(e.x,e.y)){var o=t.getCenterPoint(),s=i(e,o);s<a?(r=[t],a=s):s===a&&r.push(t)}})),r}function ae(t){var e=-1!==t.indexOf("x"),n=-1!==t.indexOf("y");return function(t,i){var a=e?Math.abs(t.x-i.x):0,r=n?Math.abs(t.y-i.y):0;return Math.sqrt(Math.pow(a,2)+Math.pow(r,2))}}function re(t,e,n){var i=te(e,t);n.axis=n.axis||"x";var a=ae(n.axis),r=n.intersect?ne(t,i):ie(t,i,!1,a),o=[];return r.length?(t._getSortedVisibleDatasetMetas().forEach((function(t){var e=t.data[r[0]._index];e&&!e._view.skip&&o.push(e)})),o):[]}var oe={modes:{single:function(t,e){var n=te(e,t),i=[];return ee(t,(function(t){if(t.inRange(n.x,n.y))return i.push(t),i})),i.slice(0,1)},label:re,index:re,dataset:function(t,e,n){var i=te(e,t);n.axis=n.axis||"xy";var a=ae(n.axis),r=n.intersect?ne(t,i):ie(t,i,!1,a);return r.length>0&&(r=t.getDatasetMeta(r[0]._datasetIndex).data),r},"x-axis":function(t,e){return re(t,e,{intersect:!1})},point:function(t,e){return ne(t,te(e,t))},nearest:function(t,e,n){var i=te(e,t);n.axis=n.axis||"xy";var a=ae(n.axis);return ie(t,i,n.intersect,a)},x:function(t,e,n){var i=te(e,t),a=[],r=!1;return ee(t,(function(t){t.inXRange(i.x)&&a.push(t),t.inRange(i.x,i.y)&&(r=!0)})),n.intersect&&!r&&(a=[]),a},y:function(t,e,n){var i=te(e,t),a=[],r=!1;return ee(t,(function(t){t.inYRange(i.y)&&a.push(t),t.inRange(i.x,i.y)&&(r=!0)})),n.intersect&&!r&&(a=[]),a}}},se=B.extend;function le(t,e){return B.where(t,(function(t){return t.pos===e}))}function ue(t,e){return t.sort((function(t,n){var i=e?n:t,a=e?t:n;return i.weight===a.weight?i.index-a.index:i.weight-a.weight}))}function de(t,e,n,i){return Math.max(t[n],e[n])+Math.max(t[i],e[i])}function he(t,e,n){var i,a,r=n.box,o=t.maxPadding;if(n.size&&(t[n.pos]-=n.size),n.size=n.horizontal?r.height:r.width,t[n.pos]+=n.size,r.getPadding){var s=r.getPadding();o.top=Math.max(o.top,s.top),o.left=Math.max(o.left,s.left),o.bottom=Math.max(o.bottom,s.bottom),o.right=Math.max(o.right,s.right)}if(i=e.outerWidth-de(o,t,"left","right"),a=e.outerHeight-de(o,t,"top","bottom"),i!==t.w||a!==t.h){t.w=i,t.h=a;var l=n.horizontal?[i,t.w]:[a,t.h];return!(l[0]===l[1]||isNaN(l[0])&&isNaN(l[1]))}}function ce(t,e){var n=e.maxPadding;function i(t){var i={left:0,top:0,right:0,bottom:0};return t.forEach((function(t){i[t]=Math.max(e[t],n[t])})),i}return i(t?["left","right"]:["top","bottom"])}function fe(t,e,n){var i,a,r,o,s,l,u=[];for(i=0,a=t.length;i<a;++i)(o=(r=t[i]).box).update(r.width||e.w,r.height||e.h,ce(r.horizontal,e)),he(e,n,r)&&(l=!0,u.length&&(s=!0)),o.fullWidth||u.push(r);return s&&fe(u,e,n)||l}function ge(t,e,n){var i,a,r,o,s=n.padding,l=e.x,u=e.y;for(i=0,a=t.length;i<a;++i)o=(r=t[i]).box,r.horizontal?(o.left=o.fullWidth?s.left:e.left,o.right=o.fullWidth?n.outerWidth-s.right:e.left+e.w,o.top=u,o.bottom=u+o.height,o.width=o.right-o.left,u=o.bottom):(o.left=l,o.right=l+o.width,o.top=e.top,o.bottom=e.top+e.h,o.height=o.bottom-o.top,l=o.right);e.x=l,e.y=u}Y._set("global",{layout:{padding:{top:0,right:0,bottom:0,left:0}}});var me,pe={defaults:{},addBox:function(t,e){t.boxes||(t.boxes=[]),e.fullWidth=e.fullWidth||!1,e.position=e.position||"top",e.weight=e.weight||0,e._layers=e._layers||function(){return[{z:0,draw:function(){e.draw.apply(e,arguments)}}]},t.boxes.push(e)},removeBox:function(t,e){var n=t.boxes?t.boxes.indexOf(e):-1;-1!==n&&t.boxes.splice(n,1)},configure:function(t,e,n){for(var i,a=["fullWidth","position","weight"],r=a.length,o=0;o<r;++o)i=a[o],n.hasOwnProperty(i)&&(e[i]=n[i])},update:function(t,e,n){if(t){var i=t.options.layout||{},a=B.options.toPadding(i.padding),r=e-a.width,o=n-a.height,s=function(t){var e=function(t){var e,n,i,a=[];for(e=0,n=(t||[]).length;e<n;++e)i=t[e],a.push({index:e,box:i,pos:i.position,horizontal:i.isHorizontal(),weight:i.weight});return a}(t),n=ue(le(e,"left"),!0),i=ue(le(e,"right")),a=ue(le(e,"top"),!0),r=ue(le(e,"bottom"));return{leftAndTop:n.concat(a),rightAndBottom:i.concat(r),chartArea:le(e,"chartArea"),vertical:n.concat(i),horizontal:a.concat(r)}}(t.boxes),l=s.vertical,u=s.horizontal,d=Object.freeze({outerWidth:e,outerHeight:n,padding:a,availableWidth:r,vBoxMaxWidth:r/2/l.length,hBoxMaxHeight:o/2}),h=se({maxPadding:se({},a),w:r,h:o,x:a.left,y:a.top},a);!function(t,e){var n,i,a;for(n=0,i=t.length;n<i;++n)(a=t[n]).width=a.horizontal?a.box.fullWidth&&e.availableWidth:e.vBoxMaxWidth,a.height=a.horizontal&&e.hBoxMaxHeight}(l.concat(u),d),fe(l,h,d),fe(u,h,d)&&fe(l,h,d),function(t){var e=t.maxPadding;function n(n){var i=Math.max(e[n]-t[n],0);return t[n]+=i,i}t.y+=n("top"),t.x+=n("left"),n("right"),n("bottom")}(h),ge(s.leftAndTop,h,d),h.x+=h.w,h.y+=h.h,ge(s.rightAndBottom,h,d),t.chartArea={left:h.left,top:h.top,right:h.left+h.w,bottom:h.top+h.h},B.each(s.chartArea,(function(e){var n=e.box;se(n,t.chartArea),n.update(h.w,h.h)}))}}},ve=(me=Object.freeze({__proto__:null,default:"@keyframes chartjs-render-animation{from{opacity:.99}to{opacity:1}}.chartjs-render-monitor{animation:chartjs-render-animation 1ms}.chartjs-size-monitor,.chartjs-size-monitor-expand,.chartjs-size-monitor-shrink{position:absolute;direction:ltr;left:0;top:0;right:0;bottom:0;overflow:hidden;pointer-events:none;visibility:hidden;z-index:-1}.chartjs-size-monitor-expand>div{position:absolute;width:1000000px;height:1000000px;left:0;top:0}.chartjs-size-monitor-shrink>div{position:absolute;width:200%;height:200%;left:0;top:0}"}))&&me.default||me,be="$chartjs",ye="chartjs-size-monitor",xe="chartjs-render-monitor",_e="chartjs-render-animation",we=["animationstart","webkitAnimationStart"],ke={touchstart:"mousedown",touchmove:"mousemove",touchend:"mouseup",pointerenter:"mouseenter",pointerdown:"mousedown",pointermove:"mousemove",pointerup:"mouseup",pointerleave:"mouseout",pointerout:"mouseout"};function Me(t,e){var n=B.getStyle(t,e),i=n&&n.match(/^(\d+)(\.\d+)?px$/);return i?Number(i[1]):void 0}var Se=!!function(){var t=!1;try{var e=Object.defineProperty({},"passive",{get:function(){t=!0}});window.addEventListener("e",null,e)}catch(t){}return t}()&&{passive:!0};function De(t,e,n){t.addEventListener(e,n,Se)}function Ce(t,e,n){t.removeEventListener(e,n,Se)}function Pe(t,e,n,i,a){return{type:t,chart:e,native:a||null,x:void 0!==n?n:null,y:void 0!==i?i:null}}function Te(t){var e=document.createElement("div");return e.className=t||"",e}function Oe(t,e,n){var i,a,r,o,s=t[be]||(t[be]={}),l=s.resizer=function(t){var e=Te(ye),n=Te(ye+"-expand"),i=Te(ye+"-shrink");n.appendChild(Te()),i.appendChild(Te()),e.appendChild(n),e.appendChild(i),e._reset=function(){n.scrollLeft=1e6,n.scrollTop=1e6,i.scrollLeft=1e6,i.scrollTop=1e6};var a=function(){e._reset(),t()};return De(n,"scroll",a.bind(n,"expand")),De(i,"scroll",a.bind(i,"shrink")),e}((i=function(){if(s.resizer){var i=n.options.maintainAspectRatio&&t.parentNode,a=i?i.clientWidth:0;e(Pe("resize",n)),i&&i.clientWidth<a&&n.canvas&&e(Pe("resize",n))}},r=!1,o=[],function(){o=Array.prototype.slice.call(arguments),a=a||this,r||(r=!0,B.requestAnimFrame.call(window,(function(){r=!1,i.apply(a,o)})))}));!function(t,e){var n=t[be]||(t[be]={}),i=n.renderProxy=function(t){t.animationName===_e&&e()};B.each(we,(function(e){De(t,e,i)})),n.reflow=!!t.offsetParent,t.classList.add(xe)}(t,(function(){if(s.resizer){var e=t.parentNode;e&&e!==l.parentNode&&e.insertBefore(l,e.firstChild),l._reset()}}))}function Ae(t){var e=t[be]||{},n=e.resizer;delete e.resizer,function(t){var e=t[be]||{},n=e.renderProxy;n&&(B.each(we,(function(e){Ce(t,e,n)})),delete e.renderProxy),t.classList.remove(xe)}(t),n&&n.parentNode&&n.parentNode.removeChild(n)}var Fe={disableCSSInjection:!1,_enabled:"undefined"!=typeof window&&"undefined"!=typeof document,_ensureLoaded:function(t){if(!this.disableCSSInjection){var e=t.getRootNode?t.getRootNode():document;!function(t,e){var n=t[be]||(t[be]={});if(!n.containsStyles){n.containsStyles=!0,e="/* Chart.js */\n"+e;var i=document.createElement("style");i.setAttribute("type","text/css"),i.appendChild(document.createTextNode(e)),t.appendChild(i)}}(e.host?e:document.head,ve)}},acquireContext:function(t,e){"string"==typeof t?t=document.getElementById(t):t.length&&(t=t[0]),t&&t.canvas&&(t=t.canvas);var n=t&&t.getContext&&t.getContext("2d");return n&&n.canvas===t?(this._ensureLoaded(t),function(t,e){var n=t.style,i=t.getAttribute("height"),a=t.getAttribute("width");if(t[be]={initial:{height:i,width:a,style:{display:n.display,height:n.height,width:n.width}}},n.display=n.display||"block",null===a||""===a){var r=Me(t,"width");void 0!==r&&(t.width=r)}if(null===i||""===i)if(""===t.style.height)t.height=t.width/(e.options.aspectRatio||2);else{var o=Me(t,"height");void 0!==r&&(t.height=o)}}(t,e),n):null},releaseContext:function(t){var e=t.canvas;if(e[be]){var n=e[be].initial;["height","width"].forEach((function(t){var i=n[t];B.isNullOrUndef(i)?e.removeAttribute(t):e.setAttribute(t,i)})),B.each(n.style||{},(function(t,n){e.style[n]=t})),e.width=e.width,delete e[be]}},addEventListener:function(t,e,n){var i=t.canvas;if("resize"!==e){var a=n[be]||(n[be]={});De(i,e,(a.proxies||(a.proxies={}))[t.id+"_"+e]=function(e){n(function(t,e){var n=ke[t.type]||t.type,i=B.getRelativePosition(t,e);return Pe(n,e,i.x,i.y,t)}(e,t))})}else Oe(i,n,t)},removeEventListener:function(t,e,n){var i=t.canvas;if("resize"!==e){var a=((n[be]||{}).proxies||{})[t.id+"_"+e];a&&Ce(i,e,a)}else Ae(i)}};B.addEvent=De,B.removeEvent=Ce;var Ie=Fe._enabled?Fe:{acquireContext:function(t){return t&&t.canvas&&(t=t.canvas),t&&t.getContext("2d")||null}},Le=B.extend({initialize:function(){},acquireContext:function(){},releaseContext:function(){},addEventListener:function(){},removeEventListener:function(){}},Ie);Y._set("global",{plugins:{}});var Re={_plugins:[],_cacheId:0,register:function(t){var e=this._plugins;[].concat(t).forEach((function(t){-1===e.indexOf(t)&&e.push(t)})),this._cacheId++},unregister:function(t){var e=this._plugins;[].concat(t).forEach((function(t){var n=e.indexOf(t);-1!==n&&e.splice(n,1)})),this._cacheId++},clear:function(){this._plugins=[],this._cacheId++},count:function(){return this._plugins.length},getAll:function(){return this._plugins},notify:function(t,e,n){var i,a,r,o,s,l=this.descriptors(t),u=l.length;for(i=0;i<u;++i)if("function"==typeof(s=(r=(a=l[i]).plugin)[e])&&((o=[t].concat(n||[])).push(a.options),!1===s.apply(r,o)))return!1;return!0},descriptors:function(t){var e=t.$plugins||(t.$plugins={});if(e.id===this._cacheId)return e.descriptors;var n=[],i=[],a=t&&t.config||{},r=a.options&&a.options.plugins||{};return this._plugins.concat(a.plugins||[]).forEach((function(t){if(-1===n.indexOf(t)){var e=t.id,a=r[e];!1!==a&&(!0===a&&(a=B.clone(Y.global.plugins[e])),n.push(t),i.push({plugin:t,options:a||{}}))}})),e.descriptors=i,e.id=this._cacheId,i},_invalidate:function(t){delete t.$plugins}},Ne={constructors:{},defaults:{},registerScaleType:function(t,e,n){this.constructors[t]=e,this.defaults[t]=B.clone(n)},getScaleConstructor:function(t){return this.constructors.hasOwnProperty(t)?this.constructors[t]:void 0},getScaleDefaults:function(t){return this.defaults.hasOwnProperty(t)?B.merge(Object.create(null),[Y.scale,this.defaults[t]]):{}},updateScaleDefaults:function(t,e){this.defaults.hasOwnProperty(t)&&(this.defaults[t]=B.extend(this.defaults[t],e))},addScalesToLayout:function(t){B.each(t.scales,(function(e){e.fullWidth=e.options.fullWidth,e.position=e.options.position,e.weight=e.options.weight,pe.addBox(t,e)}))}},We=B.valueOrDefault,Ye=B.rtl.getRtlAdapter;Y._set("global",{tooltips:{enabled:!0,custom:null,mode:"nearest",position:"average",intersect:!0,backgroundColor:"rgba(0,0,0,0.8)",titleFontStyle:"bold",titleSpacing:2,titleMarginBottom:6,titleFontColor:"#fff",titleAlign:"left",bodySpacing:2,bodyFontColor:"#fff",bodyAlign:"left",footerFontStyle:"bold",footerSpacing:2,footerMarginTop:6,footerFontColor:"#fff",footerAlign:"left",yPadding:6,xPadding:6,caretPadding:2,caretSize:5,cornerRadius:6,multiKeyBackground:"#fff",displayColors:!0,borderColor:"rgba(0,0,0,0)",borderWidth:0,callbacks:{beforeTitle:B.noop,title:function(t,e){var n="",i=e.labels,a=i?i.length:0;if(t.length>0){var r=t[0];r.label?n=r.label:r.xLabel?n=r.xLabel:a>0&&r.index<a&&(n=i[r.index])}return n},afterTitle:B.noop,beforeBody:B.noop,beforeLabel:B.noop,label:function(t,e){var n=e.datasets[t.datasetIndex].label||"";return n&&(n+=": "),B.isNullOrUndef(t.value)?n+=t.yLabel:n+=t.value,n},labelColor:function(t,e){var n=e.getDatasetMeta(t.datasetIndex).data[t.index]._view;return{borderColor:n.borderColor,backgroundColor:n.backgroundColor}},labelTextColor:function(){return this._options.bodyFontColor},afterLabel:B.noop,afterBody:B.noop,beforeFooter:B.noop,footer:B.noop,afterFooter:B.noop}}});var ze={average:function(t){if(!t.length)return!1;var e,n,i=0,a=0,r=0;for(e=0,n=t.length;e<n;++e){var o=t[e];if(o&&o.hasValue()){var s=o.tooltipPosition();i+=s.x,a+=s.y,++r}}return{x:i/r,y:a/r}},nearest:function(t,e){var n,i,a,r=e.x,o=e.y,s=Number.POSITIVE_INFINITY;for(n=0,i=t.length;n<i;++n){var l=t[n];if(l&&l.hasValue()){var u=l.getCenterPoint(),d=B.distanceBetweenPoints(e,u);d<s&&(s=d,a=l)}}if(a){var h=a.tooltipPosition();r=h.x,o=h.y}return{x:r,y:o}}};function Ee(t,e){return e&&(B.isArray(e)?Array.prototype.push.apply(t,e):t.push(e)),t}function Ve(t){return("string"==typeof t||t instanceof String)&&t.indexOf("\n")>-1?t.split("\n"):t}function He(t){var e=Y.global;return{xPadding:t.xPadding,yPadding:t.yPadding,xAlign:t.xAlign,yAlign:t.yAlign,rtl:t.rtl,textDirection:t.textDirection,bodyFontColor:t.bodyFontColor,_bodyFontFamily:We(t.bodyFontFamily,e.defaultFontFamily),_bodyFontStyle:We(t.bodyFontStyle,e.defaultFontStyle),_bodyAlign:t.bodyAlign,bodyFontSize:We(t.bodyFontSize,e.defaultFontSize),bodySpacing:t.bodySpacing,titleFontColor:t.titleFontColor,_titleFontFamily:We(t.titleFontFamily,e.defaultFontFamily),_titleFontStyle:We(t.titleFontStyle,e.defaultFontStyle),titleFontSize:We(t.titleFontSize,e.defaultFontSize),_titleAlign:t.titleAlign,titleSpacing:t.titleSpacing,titleMarginBottom:t.titleMarginBottom,footerFontColor:t.footerFontColor,_footerFontFamily:We(t.footerFontFamily,e.defaultFontFamily),_footerFontStyle:We(t.footerFontStyle,e.defaultFontStyle),footerFontSize:We(t.footerFontSize,e.defaultFontSize),_footerAlign:t.footerAlign,footerSpacing:t.footerSpacing,footerMarginTop:t.footerMarginTop,caretSize:t.caretSize,cornerRadius:t.cornerRadius,backgroundColor:t.backgroundColor,opacity:0,legendColorBackground:t.multiKeyBackground,displayColors:t.displayColors,borderColor:t.borderColor,borderWidth:t.borderWidth}}function Be(t,e){return"center"===e?t.x+t.width/2:"right"===e?t.x+t.width-t.xPadding:t.x+t.xPadding}function je(t){return Ee([],Ve(t))}var Ue=X.extend({initialize:function(){this._model=He(this._options),this._lastActive=[]},getTitle:function(){var t=this,e=t._options,n=e.callbacks,i=n.beforeTitle.apply(t,arguments),a=n.title.apply(t,arguments),r=n.afterTitle.apply(t,arguments),o=[];return o=Ee(o,Ve(i)),o=Ee(o,Ve(a)),o=Ee(o,Ve(r))},getBeforeBody:function(){return je(this._options.callbacks.beforeBody.apply(this,arguments))},getBody:function(t,e){var n=this,i=n._options.callbacks,a=[];return B.each(t,(function(t){var r={before:[],lines:[],after:[]};Ee(r.before,Ve(i.beforeLabel.call(n,t,e))),Ee(r.lines,i.label.call(n,t,e)),Ee(r.after,Ve(i.afterLabel.call(n,t,e))),a.push(r)})),a},getAfterBody:function(){return je(this._options.callbacks.afterBody.apply(this,arguments))},getFooter:function(){var t=this,e=t._options.callbacks,n=e.beforeFooter.apply(t,arguments),i=e.footer.apply(t,arguments),a=e.afterFooter.apply(t,arguments),r=[];return r=Ee(r,Ve(n)),r=Ee(r,Ve(i)),r=Ee(r,Ve(a))},update:function(t){var e,n,i,a,r,o,s,l,u,d,h=this,c=h._options,f=h._model,g=h._model=He(c),m=h._active,p=h._data,v={xAlign:f.xAlign,yAlign:f.yAlign},b={x:f.x,y:f.y},y={width:f.width,height:f.height},x={x:f.caretX,y:f.caretY};if(m.length){g.opacity=1;var _=[],w=[];x=ze[c.position].call(h,m,h._eventPosition);var k=[];for(e=0,n=m.length;e<n;++e)k.push((i=m[e],a=void 0,r=void 0,o=void 0,s=void 0,l=void 0,u=void 0,d=void 0,a=i._xScale,r=i._yScale||i._scale,o=i._index,s=i._datasetIndex,l=i._chart.getDatasetMeta(s).controller,u=l._getIndexScale(),d=l._getValueScale(),{xLabel:a?a.getLabelForIndex(o,s):"",yLabel:r?r.getLabelForIndex(o,s):"",label:u?""+u.getLabelForIndex(o,s):"",value:d?""+d.getLabelForIndex(o,s):"",index:o,datasetIndex:s,x:i._model.x,y:i._model.y}));c.filter&&(k=k.filter((function(t){return c.filter(t,p)}))),c.itemSort&&(k=k.sort((function(t,e){return c.itemSort(t,e,p)}))),B.each(k,(function(t){_.push(c.callbacks.labelColor.call(h,t,h._chart)),w.push(c.callbacks.labelTextColor.call(h,t,h._chart))})),g.title=h.getTitle(k,p),g.beforeBody=h.getBeforeBody(k,p),g.body=h.getBody(k,p),g.afterBody=h.getAfterBody(k,p),g.footer=h.getFooter(k,p),g.x=x.x,g.y=x.y,g.caretPadding=c.caretPadding,g.labelColors=_,g.labelTextColors=w,g.dataPoints=k,y=function(t,e){var n=t._chart.ctx,i=2*e.yPadding,a=0,r=e.body,o=r.reduce((function(t,e){return t+e.before.length+e.lines.length+e.after.length}),0);o+=e.beforeBody.length+e.afterBody.length;var s=e.title.length,l=e.footer.length,u=e.titleFontSize,d=e.bodyFontSize,h=e.footerFontSize;i+=s*u,i+=s?(s-1)*e.titleSpacing:0,i+=s?e.titleMarginBottom:0,i+=o*d,i+=o?(o-1)*e.bodySpacing:0,i+=l?e.footerMarginTop:0,i+=l*h,i+=l?(l-1)*e.footerSpacing:0;var c=0,f=function(t){a=Math.max(a,n.measureText(t).width+c)};return n.font=B.fontString(u,e._titleFontStyle,e._titleFontFamily),B.each(e.title,f),n.font=B.fontString(d,e._bodyFontStyle,e._bodyFontFamily),B.each(e.beforeBody.concat(e.afterBody),f),c=e.displayColors?d+2:0,B.each(r,(function(t){B.each(t.before,f),B.each(t.lines,f),B.each(t.after,f)})),c=0,n.font=B.fontString(h,e._footerFontStyle,e._footerFontFamily),B.each(e.footer,f),{width:a+=2*e.xPadding,height:i}}(this,g),b=function(t,e,n,i){var a=t.x,r=t.y,o=t.caretSize,s=t.caretPadding,l=t.cornerRadius,u=n.xAlign,d=n.yAlign,h=o+s,c=l+s;return"right"===u?a-=e.width:"center"===u&&((a-=e.width/2)+e.width>i.width&&(a=i.width-e.width),a<0&&(a=0)),"top"===d?r+=h:r-="bottom"===d?e.height+h:e.height/2,"center"===d?"left"===u?a+=h:"right"===u&&(a-=h):"left"===u?a-=c:"right"===u&&(a+=c),{x:a,y:r}}(g,y,v=function(t,e){var n,i,a,r,o,s=t._model,l=t._chart,u=t._chart.chartArea,d="center",h="center";s.y<e.height?h="top":s.y>l.height-e.height&&(h="bottom");var c=(u.left+u.right)/2,f=(u.top+u.bottom)/2;"center"===h?(n=function(t){return t<=c},i=function(t){return t>c}):(n=function(t){return t<=e.width/2},i=function(t){return t>=l.width-e.width/2}),a=function(t){return t+e.width+s.caretSize+s.caretPadding>l.width},r=function(t){return t-e.width-s.caretSize-s.caretPadding<0},o=function(t){return t<=f?"top":"bottom"},n(s.x)?(d="left",a(s.x)&&(d="center",h=o(s.y))):i(s.x)&&(d="right",r(s.x)&&(d="center",h=o(s.y)));var g=t._options;return{xAlign:g.xAlign?g.xAlign:d,yAlign:g.yAlign?g.yAlign:h}}(this,y),h._chart)}else g.opacity=0;return g.xAlign=v.xAlign,g.yAlign=v.yAlign,g.x=b.x,g.y=b.y,g.width=y.width,g.height=y.height,g.caretX=x.x,g.caretY=x.y,h._model=g,t&&c.custom&&c.custom.call(h,g),h},drawCaret:function(t,e){var n=this._chart.ctx,i=this._view,a=this.getCaretPosition(t,e,i);n.lineTo(a.x1,a.y1),n.lineTo(a.x2,a.y2),n.lineTo(a.x3,a.y3)},getCaretPosition:function(t,e,n){var i,a,r,o,s,l,u=n.caretSize,d=n.cornerRadius,h=n.xAlign,c=n.yAlign,f=t.x,g=t.y,m=e.width,p=e.height;if("center"===c)s=g+p/2,"left"===h?(a=(i=f)-u,r=i,o=s+u,l=s-u):(a=(i=f+m)+u,r=i,o=s-u,l=s+u);else if("left"===h?(i=(a=f+d+u)-u,r=a+u):"right"===h?(i=(a=f+m-d-u)-u,r=a+u):(i=(a=n.caretX)-u,r=a+u),"top"===c)s=(o=g)-u,l=o;else{s=(o=g+p)+u,l=o;var v=r;r=i,i=v}return{x1:i,x2:a,x3:r,y1:o,y2:s,y3:l}},drawTitle:function(t,e,n){var i,a,r,o=e.title,s=o.length;if(s){var l=Ye(e.rtl,e.x,e.width);for(t.x=Be(e,e._titleAlign),n.textAlign=l.textAlign(e._titleAlign),n.textBaseline="middle",i=e.titleFontSize,a=e.titleSpacing,n.fillStyle=e.titleFontColor,n.font=B.fontString(i,e._titleFontStyle,e._titleFontFamily),r=0;r<s;++r)n.fillText(o[r],l.x(t.x),t.y+i/2),t.y+=i+a,r+1===s&&(t.y+=e.titleMarginBottom-a)}},drawBody:function(t,e,n){var i,a,r,o,s,l,u,d,h=e.bodyFontSize,c=e.bodySpacing,f=e._bodyAlign,g=e.body,m=e.displayColors,p=0,v=m?Be(e,"left"):0,b=Ye(e.rtl,e.x,e.width),y=function(e){n.fillText(e,b.x(t.x+p),t.y+h/2),t.y+=h+c},x=b.textAlign(f);for(n.textAlign=f,n.textBaseline="middle",n.font=B.fontString(h,e._bodyFontStyle,e._bodyFontFamily),t.x=Be(e,x),n.fillStyle=e.bodyFontColor,B.each(e.beforeBody,y),p=m&&"right"!==x?"center"===f?h/2+1:h+2:0,s=0,u=g.length;s<u;++s){for(i=g[s],a=e.labelTextColors[s],r=e.labelColors[s],n.fillStyle=a,B.each(i.before,y),l=0,d=(o=i.lines).length;l<d;++l){if(m){var _=b.x(v);n.fillStyle=e.legendColorBackground,n.fillRect(b.leftForLtr(_,h),t.y,h,h),n.lineWidth=1,n.strokeStyle=r.borderColor,n.strokeRect(b.leftForLtr(_,h),t.y,h,h),n.fillStyle=r.backgroundColor,n.fillRect(b.leftForLtr(b.xPlus(_,1),h-2),t.y+1,h-2,h-2),n.fillStyle=a}y(o[l])}B.each(i.after,y)}p=0,B.each(e.afterBody,y),t.y-=c},drawFooter:function(t,e,n){var i,a,r=e.footer,o=r.length;if(o){var s=Ye(e.rtl,e.x,e.width);for(t.x=Be(e,e._footerAlign),t.y+=e.footerMarginTop,n.textAlign=s.textAlign(e._footerAlign),n.textBaseline="middle",i=e.footerFontSize,n.fillStyle=e.footerFontColor,n.font=B.fontString(i,e._footerFontStyle,e._footerFontFamily),a=0;a<o;++a)n.fillText(r[a],s.x(t.x),t.y+i/2),t.y+=i+e.footerSpacing}},drawBackground:function(t,e,n,i){n.fillStyle=e.backgroundColor,n.strokeStyle=e.borderColor,n.lineWidth=e.borderWidth;var a=e.xAlign,r=e.yAlign,o=t.x,s=t.y,l=i.width,u=i.height,d=e.cornerRadius;n.beginPath(),n.moveTo(o+d,s),"top"===r&&this.drawCaret(t,i),n.lineTo(o+l-d,s),n.quadraticCurveTo(o+l,s,o+l,s+d),"center"===r&&"right"===a&&this.drawCaret(t,i),n.lineTo(o+l,s+u-d),n.quadraticCurveTo(o+l,s+u,o+l-d,s+u),"bottom"===r&&this.drawCaret(t,i),n.lineTo(o+d,s+u),n.quadraticCurveTo(o,s+u,o,s+u-d),"center"===r&&"left"===a&&this.drawCaret(t,i),n.lineTo(o,s+d),n.quadraticCurveTo(o,s,o+d,s),n.closePath(),n.fill(),e.borderWidth>0&&n.stroke()},draw:function(){var t=this._chart.ctx,e=this._view;if(0!==e.opacity){var n={width:e.width,height:e.height},i={x:e.x,y:e.y},a=Math.abs(e.opacity<.001)?0:e.opacity,r=e.title.length||e.beforeBody.length||e.body.length||e.afterBody.length||e.footer.length;this._options.enabled&&r&&(t.save(),t.globalAlpha=a,this.drawBackground(i,e,t,n),i.y+=e.yPadding,B.rtl.overrideTextDirection(t,e.textDirection),this.drawTitle(i,e,t),this.drawBody(i,e,t),this.drawFooter(i,e,t),B.rtl.restoreTextDirection(t,e.textDirection),t.restore())}},handleEvent:function(t){var e,n=this,i=n._options;return n._lastActive=n._lastActive||[],"mouseout"===t.type?n._active=[]:(n._active=n._chart.getElementsAtEventForMode(t,i.mode,i),i.reverse&&n._active.reverse()),(e=!B.arrayEquals(n._active,n._lastActive))&&(n._lastActive=n._active,(i.enabled||i.custom)&&(n._eventPosition={x:t.x,y:t.y},n.update(!0),n.pivot())),e}}),Ge=ze,qe=Ue;qe.positioners=Ge;var Ze=B.valueOrDefault;function $e(){return B.merge(Object.create(null),[].slice.call(arguments),{merger:function(t,e,n,i){if("xAxes"===t||"yAxes"===t){var a,r,o,s=n[t].length;for(e[t]||(e[t]=[]),a=0;a<s;++a)o=n[t][a],r=Ze(o.type,"xAxes"===t?"category":"linear"),a>=e[t].length&&e[t].push({}),!e[t][a].type||o.type&&o.type!==e[t][a].type?B.merge(e[t][a],[Ne.getScaleDefaults(r),o]):B.merge(e[t][a],o)}else B._merger(t,e,n,i)}})}function Xe(){return B.merge(Object.create(null),[].slice.call(arguments),{merger:function(t,e,n,i){var a=e[t]||Object.create(null),r=n[t];"scales"===t?e[t]=$e(a,r):"scale"===t?e[t]=B.merge(a,[Ne.getScaleDefaults(r.type),r]):B._merger(t,e,n,i)}})}function Ke(t){var e=t.options;B.each(t.scales,(function(e){pe.removeBox(t,e)})),e=Xe(Y.global,Y[t.config.type],e),t.options=t.config.options=e,t.ensureScalesHaveIDs(),t.buildOrUpdateScales(),t.tooltip._options=e.tooltips,t.tooltip.initialize()}function Je(t,e,n){var i,a=function(t){return t.id===i};do{i=e+n++}while(B.findIndex(t,a)>=0);return i}function Qe(t){return"top"===t||"bottom"===t}function tn(t,e){return function(n,i){return n[t]===i[t]?n[e]-i[e]:n[t]-i[t]}}Y._set("global",{elements:{},events:["mousemove","mouseout","click","touchstart","touchmove"],hover:{onHover:null,mode:"nearest",intersect:!0,animationDuration:400},onClick:null,maintainAspectRatio:!0,responsive:!0,responsiveAnimationDuration:0});var en=function(t,e){return this.construct(t,e),this};B.extend(en.prototype,{construct:function(t,e){var n=this;e=function(t){var e=(t=t||Object.create(null)).data=t.data||{};return e.datasets=e.datasets||[],e.labels=e.labels||[],t.options=Xe(Y.global,Y[t.type],t.options||{}),t}(e);var i=Le.acquireContext(t,e),a=i&&i.canvas,r=a&&a.height,o=a&&a.width;n.id=B.uid(),n.ctx=i,n.canvas=a,n.config=e,n.width=o,n.height=r,n.aspectRatio=r?o/r:null,n.options=e.options,n._bufferedRender=!1,n._layers=[],n.chart=n,n.controller=n,en.instances[n.id]=n,Object.defineProperty(n,"data",{get:function(){return n.config.data},set:function(t){n.config.data=t}}),i&&a?(n.initialize(),n.update()):console.error("Failed to create chart: can't acquire context from the given item")},initialize:function(){var t=this;return Re.notify(t,"beforeInit"),B.retinaScale(t,t.options.devicePixelRatio),t.bindEvents(),t.options.responsive&&t.resize(!0),t.initToolTip(),Re.notify(t,"afterInit"),t},clear:function(){return B.canvas.clear(this),this},stop:function(){return Q.cancelAnimation(this),this},resize:function(t){var e=this,n=e.options,i=e.canvas,a=n.maintainAspectRatio&&e.aspectRatio||null,r=Math.max(0,Math.floor(B.getMaximumWidth(i))),o=Math.max(0,Math.floor(a?r/a:B.getMaximumHeight(i)));if((e.width!==r||e.height!==o)&&(i.width=e.width=r,i.height=e.height=o,i.style.width=r+"px",i.style.height=o+"px",B.retinaScale(e,n.devicePixelRatio),!t)){var s={width:r,height:o};Re.notify(e,"resize",[s]),n.onResize&&n.onResize(e,s),e.stop(),e.update({duration:n.responsiveAnimationDuration})}},ensureScalesHaveIDs:function(){var t=this.options,e=t.scales||{},n=t.scale;B.each(e.xAxes,(function(t,n){t.id||(t.id=Je(e.xAxes,"x-axis-",n))})),B.each(e.yAxes,(function(t,n){t.id||(t.id=Je(e.yAxes,"y-axis-",n))})),n&&(n.id=n.id||"scale")},buildOrUpdateScales:function(){var t=this,e=t.options,n=t.scales||{},i=[],a=Object.keys(n).reduce((function(t,e){return t[e]=!1,t}),{});e.scales&&(i=i.concat((e.scales.xAxes||[]).map((function(t){return{options:t,dtype:"category",dposition:"bottom"}})),(e.scales.yAxes||[]).map((function(t){return{options:t,dtype:"linear",dposition:"left"}})))),e.scale&&i.push({options:e.scale,dtype:"radialLinear",isDefault:!0,dposition:"chartArea"}),B.each(i,(function(e){var i=e.options,r=i.id,o=Ze(i.type,e.dtype);Qe(i.position)!==Qe(e.dposition)&&(i.position=e.dposition),a[r]=!0;var s=null;if(r in n&&n[r].type===o)(s=n[r]).options=i,s.ctx=t.ctx,s.chart=t;else{var l=Ne.getScaleConstructor(o);if(!l)return;s=new l({id:r,type:o,options:i,ctx:t.ctx,chart:t}),n[s.id]=s}s.mergeTicksOptions(),e.isDefault&&(t.scale=s)})),B.each(a,(function(t,e){t||delete n[e]})),t.scales=n,Ne.addScalesToLayout(this)},buildOrUpdateControllers:function(){var t,e,n=this,i=[],a=n.data.datasets;for(t=0,e=a.length;t<e;t++){var r=a[t],o=n.getDatasetMeta(t),s=r.type||n.config.type;if(o.type&&o.type!==s&&(n.destroyDatasetMeta(t),o=n.getDatasetMeta(t)),o.type=s,o.order=r.order||0,o.index=t,o.controller)o.controller.updateIndex(t),o.controller.linkScales();else{var l=Qt[o.type];if(void 0===l)throw new Error('"'+o.type+'" is not a chart type.');o.controller=new l(n,t),i.push(o.controller)}}return i},resetElements:function(){var t=this;B.each(t.data.datasets,(function(e,n){t.getDatasetMeta(n).controller.reset()}),t)},reset:function(){this.resetElements(),this.tooltip.initialize()},update:function(t){var e,n,i=this;if(t&&"object"==typeof t||(t={duration:t,lazy:arguments[1]}),Ke(i),Re._invalidate(i),!1!==Re.notify(i,"beforeUpdate")){i.tooltip._data=i.data;var a=i.buildOrUpdateControllers();for(e=0,n=i.data.datasets.length;e<n;e++)i.getDatasetMeta(e).controller.buildOrUpdateElements();i.updateLayout(),i.options.animation&&i.options.animation.duration&&B.each(a,(function(t){t.reset()})),i.updateDatasets(),i.tooltip.initialize(),i.lastActive=[],Re.notify(i,"afterUpdate"),i._layers.sort(tn("z","_idx")),i._bufferedRender?i._bufferedRequest={duration:t.duration,easing:t.easing,lazy:t.lazy}:i.render(t)}},updateLayout:function(){var t=this;!1!==Re.notify(t,"beforeLayout")&&(pe.update(this,this.width,this.height),t._layers=[],B.each(t.boxes,(function(e){e._configure&&e._configure(),t._layers.push.apply(t._layers,e._layers())}),t),t._layers.forEach((function(t,e){t._idx=e})),Re.notify(t,"afterScaleUpdate"),Re.notify(t,"afterLayout"))},updateDatasets:function(){if(!1!==Re.notify(this,"beforeDatasetsUpdate")){for(var t=0,e=this.data.datasets.length;t<e;++t)this.updateDataset(t);Re.notify(this,"afterDatasetsUpdate")}},updateDataset:function(t){var e=this.getDatasetMeta(t),n={meta:e,index:t};!1!==Re.notify(this,"beforeDatasetUpdate",[n])&&(e.controller._update(),Re.notify(this,"afterDatasetUpdate",[n]))},render:function(t){var e=this;t&&"object"==typeof t||(t={duration:t,lazy:arguments[1]});var n=e.options.animation,i=Ze(t.duration,n&&n.duration),a=t.lazy;if(!1!==Re.notify(e,"beforeRender")){var r=function(t){Re.notify(e,"afterRender"),B.callback(n&&n.onComplete,[t],e)};if(n&&i){var o=new J({numSteps:i/16.66,easing:t.easing||n.easing,render:function(t,e){var n=B.easing.effects[e.easing],i=e.currentStep,a=i/e.numSteps;t.draw(n(a),a,i)},onAnimationProgress:n.onProgress,onAnimationComplete:r});Q.addAnimation(e,o,i,a)}else e.draw(),r(new J({numSteps:0,chart:e}));return e}},draw:function(t){var e,n,i=this;if(i.clear(),B.isNullOrUndef(t)&&(t=1),i.transition(t),!(i.width<=0||i.height<=0)&&!1!==Re.notify(i,"beforeDraw",[t])){for(n=i._layers,e=0;e<n.length&&n[e].z<=0;++e)n[e].draw(i.chartArea);for(i.drawDatasets(t);e<n.length;++e)n[e].draw(i.chartArea);i._drawTooltip(t),Re.notify(i,"afterDraw",[t])}},transition:function(t){for(var e=0,n=(this.data.datasets||[]).length;e<n;++e)this.isDatasetVisible(e)&&this.getDatasetMeta(e).controller.transition(t);this.tooltip.transition(t)},_getSortedDatasetMetas:function(t){var e,n,i=[];for(e=0,n=(this.data.datasets||[]).length;e<n;++e)t&&!this.isDatasetVisible(e)||i.push(this.getDatasetMeta(e));return i.sort(tn("order","index")),i},_getSortedVisibleDatasetMetas:function(){return this._getSortedDatasetMetas(!0)},drawDatasets:function(t){var e,n;if(!1!==Re.notify(this,"beforeDatasetsDraw",[t])){for(n=(e=this._getSortedVisibleDatasetMetas()).length-1;n>=0;--n)this.drawDataset(e[n],t);Re.notify(this,"afterDatasetsDraw",[t])}},drawDataset:function(t,e){var n={meta:t,index:t.index,easingValue:e};!1!==Re.notify(this,"beforeDatasetDraw",[n])&&(t.controller.draw(e),Re.notify(this,"afterDatasetDraw",[n]))},_drawTooltip:function(t){var e=this.tooltip,n={tooltip:e,easingValue:t};!1!==Re.notify(this,"beforeTooltipDraw",[n])&&(e.draw(),Re.notify(this,"afterTooltipDraw",[n]))},getElementAtEvent:function(t){return oe.modes.single(this,t)},getElementsAtEvent:function(t){return oe.modes.label(this,t,{intersect:!0})},getElementsAtXAxis:function(t){return oe.modes["x-axis"](this,t,{intersect:!0})},getElementsAtEventForMode:function(t,e,n){var i=oe.modes[e];return"function"==typeof i?i(this,t,n):[]},getDatasetAtEvent:function(t){return oe.modes.dataset(this,t,{intersect:!0})},getDatasetMeta:function(t){var e=this.data.datasets[t];e._meta||(e._meta={});var n=e._meta[this.id];return n||(n=e._meta[this.id]={type:null,data:[],dataset:null,controller:null,hidden:null,xAxisID:null,yAxisID:null,order:e.order||0,index:t}),n},getVisibleDatasetCount:function(){for(var t=0,e=0,n=this.data.datasets.length;e<n;++e)this.isDatasetVisible(e)&&t++;return t},isDatasetVisible:function(t){var e=this.getDatasetMeta(t);return"boolean"==typeof e.hidden?!e.hidden:!this.data.datasets[t].hidden},generateLegend:function(){return this.options.legendCallback(this)},destroyDatasetMeta:function(t){var e=this.id,n=this.data.datasets[t],i=n._meta&&n._meta[e];i&&(i.controller.destroy(),delete n._meta[e])},destroy:function(){var t,e,n=this,i=n.canvas;for(n.stop(),t=0,e=n.data.datasets.length;t<e;++t)n.destroyDatasetMeta(t);i&&(n.unbindEvents(),B.canvas.clear(n),Le.releaseContext(n.ctx),n.canvas=null,n.ctx=null),Re.notify(n,"destroy"),delete en.instances[n.id]},toBase64Image:function(){return this.canvas.toDataURL.apply(this.canvas,arguments)},initToolTip:function(){var t=this;t.tooltip=new qe({_chart:t,_chartInstance:t,_data:t.data,_options:t.options.tooltips},t)},bindEvents:function(){var t=this,e=t._listeners={},n=function(){t.eventHandler.apply(t,arguments)};B.each(t.options.events,(function(i){Le.addEventListener(t,i,n),e[i]=n})),t.options.responsive&&(n=function(){t.resize()},Le.addEventListener(t,"resize",n),e.resize=n)},unbindEvents:function(){var t=this,e=t._listeners;e&&(delete t._listeners,B.each(e,(function(e,n){Le.removeEventListener(t,n,e)})))},updateHoverStyle:function(t,e,n){var i,a,r,o=n?"set":"remove";for(a=0,r=t.length;a<r;++a)(i=t[a])&&this.getDatasetMeta(i._datasetIndex).controller[o+"HoverStyle"](i);"dataset"===e&&this.getDatasetMeta(t[0]._datasetIndex).controller["_"+o+"DatasetHoverStyle"]()},eventHandler:function(t){var e=this,n=e.tooltip;if(!1!==Re.notify(e,"beforeEvent",[t])){e._bufferedRender=!0,e._bufferedRequest=null;var i=e.handleEvent(t);n&&(i=n._start?n.handleEvent(t):i|n.handleEvent(t)),Re.notify(e,"afterEvent",[t]);var a=e._bufferedRequest;return a?e.render(a):i&&!e.animating&&(e.stop(),e.render({duration:e.options.hover.animationDuration,lazy:!0})),e._bufferedRender=!1,e._bufferedRequest=null,e}},handleEvent:function(t){var e,n=this,i=n.options||{},a=i.hover;return n.lastActive=n.lastActive||[],"mouseout"===t.type?n.active=[]:n.active=n.getElementsAtEventForMode(t,a.mode,a),B.callback(i.onHover||i.hover.onHover,[t.native,n.active],n),"mouseup"!==t.type&&"click"!==t.type||i.onClick&&i.onClick.call(n,t.native,n.active),n.lastActive.length&&n.updateHoverStyle(n.lastActive,a.mode,!1),n.active.length&&a.mode&&n.updateHoverStyle(n.active,a.mode,!0),e=!B.arrayEquals(n.active,n.lastActive),n.lastActive=n.active,e}}),en.instances={};var nn=en;en.Controller=en,en.types={},B.configMerge=Xe,B.scaleMerge=$e;function an(){throw new Error("This method is not implemented: either no adapter can be found or an incomplete integration was provided.")}function rn(t){this.options=t||{}}B.extend(rn.prototype,{formats:an,parse:an,format:an,add:an,diff:an,startOf:an,endOf:an,_create:function(t){return t}}),rn.override=function(t){B.extend(rn.prototype,t)};var on={_date:rn},sn={formatters:{values:function(t){return B.isArray(t)?t:""+t},linear:function(t,e,n){var i=n.length>3?n[2]-n[1]:n[1]-n[0];Math.abs(i)>1&&t!==Math.floor(t)&&(i=t-Math.floor(t));var a=B.log10(Math.abs(i)),r="";if(0!==t)if(Math.max(Math.abs(n[0]),Math.abs(n[n.length-1]))<1e-4){var o=B.log10(Math.abs(t)),s=Math.floor(o)-Math.floor(a);s=Math.max(Math.min(s,20),0),r=t.toExponential(s)}else{var l=-1*Math.floor(a);l=Math.max(Math.min(l,20),0),r=t.toFixed(l)}else r="0";return r},logarithmic:function(t,e,n){var i=t/Math.pow(10,Math.floor(B.log10(t)));return 0===t?"0":1===i||2===i||5===i||0===e||e===n.length-1?t.toExponential():""}}},ln=B.isArray,un=B.isNullOrUndef,dn=B.valueOrDefault,hn=B.valueAtIndexOrDefault;function cn(t,e,n){var i,a=t.getTicks().length,r=Math.min(e,a-1),o=t.getPixelForTick(r),s=t._startPixel,l=t._endPixel;if(!(n&&(i=1===a?Math.max(o-s,l-o):0===e?(t.getPixelForTick(1)-o)/2:(o-t.getPixelForTick(r-1))/2,(o+=r<e?i:-i)<s-1e-6||o>l+1e-6)))return o}function fn(t,e,n,i){var a,r,o,s,l,u,d,h,c,f,g,m,p,v=n.length,b=[],y=[],x=[],_=0,w=0;for(a=0;a<v;++a){if(s=n[a].label,l=n[a].major?e.major:e.minor,t.font=u=l.string,d=i[u]=i[u]||{data:{},gc:[]},h=l.lineHeight,c=f=0,un(s)||ln(s)){if(ln(s))for(r=0,o=s.length;r<o;++r)g=s[r],un(g)||ln(g)||(c=B.measureText(t,d.data,d.gc,c,g),f+=h)}else c=B.measureText(t,d.data,d.gc,c,s),f=h;b.push(c),y.push(f),x.push(h/2),_=Math.max(c,_),w=Math.max(f,w)}function k(t){return{width:b[t]||0,height:y[t]||0,offset:x[t]||0}}return function(t,e){B.each(t,(function(t){var n,i=t.gc,a=i.length/2;if(a>e){for(n=0;n<a;++n)delete t.data[i[n]];i.splice(0,a)}}))}(i,v),m=b.indexOf(_),p=y.indexOf(w),{first:k(0),last:k(v-1),widest:k(m),highest:k(p)}}function gn(t){return t.drawTicks?t.tickMarkLength:0}function mn(t){var e,n;return t.display?(e=B.options._parseFont(t),n=B.options.toPadding(t.padding),e.lineHeight+n.height):0}function pn(t,e){return B.extend(B.options._parseFont({fontFamily:dn(e.fontFamily,t.fontFamily),fontSize:dn(e.fontSize,t.fontSize),fontStyle:dn(e.fontStyle,t.fontStyle),lineHeight:dn(e.lineHeight,t.lineHeight)}),{color:B.options.resolve([e.fontColor,t.fontColor,Y.global.defaultFontColor])})}function vn(t){var e=pn(t,t.minor);return{minor:e,major:t.major.enabled?pn(t,t.major):e}}function bn(t){var e,n,i,a=[];for(n=0,i=t.length;n<i;++n)void 0!==(e=t[n])._index&&a.push(e);return a}function yn(t,e,n,i){var a,r,o,s,l=dn(n,0),u=Math.min(dn(i,t.length),t.length),d=0;for(e=Math.ceil(e),i&&(e=(a=i-n)/Math.floor(a/e)),s=l;s<0;)d++,s=Math.round(l+d*e);for(r=Math.max(l,0);r<u;r++)o=t[r],r===s?(o._index=r,d++,s=Math.round(l+d*e)):delete o.label}Y._set("scale",{display:!0,position:"left",offset:!1,gridLines:{display:!0,color:"rgba(0,0,0,0.1)",lineWidth:1,drawBorder:!0,drawOnChartArea:!0,drawTicks:!0,tickMarkLength:10,zeroLineWidth:1,zeroLineColor:"rgba(0,0,0,0.25)",zeroLineBorderDash:[],zeroLineBorderDashOffset:0,offsetGridLines:!1,borderDash:[],borderDashOffset:0},scaleLabel:{display:!1,labelString:"",padding:{top:4,bottom:4}},ticks:{beginAtZero:!1,minRotation:0,maxRotation:50,mirror:!1,padding:0,reverse:!1,display:!0,autoSkip:!0,autoSkipPadding:0,labelOffset:0,callback:sn.formatters.values,minor:{},major:{}}});var xn=X.extend({zeroLineIndex:0,getPadding:function(){return{left:this.paddingLeft||0,top:this.paddingTop||0,right:this.paddingRight||0,bottom:this.paddingBottom||0}},getTicks:function(){return this._ticks},_getLabels:function(){var t=this.chart.data;return this.options.labels||(this.isHorizontal()?t.xLabels:t.yLabels)||t.labels||[]},mergeTicksOptions:function(){},beforeUpdate:function(){B.callback(this.options.beforeUpdate,[this])},update:function(t,e,n){var i,a,r,o,s,l=this,u=l.options.ticks,d=u.sampleSize;if(l.beforeUpdate(),l.maxWidth=t,l.maxHeight=e,l.margins=B.extend({left:0,right:0,top:0,bottom:0},n),l._ticks=null,l.ticks=null,l._labelSizes=null,l._maxLabelLines=0,l.longestLabelWidth=0,l.longestTextCache=l.longestTextCache||{},l._gridLineItems=null,l._labelItems=null,l.beforeSetDimensions(),l.setDimensions(),l.afterSetDimensions(),l.beforeDataLimits(),l.determineDataLimits(),l.afterDataLimits(),l.beforeBuildTicks(),o=l.buildTicks()||[],(!(o=l.afterBuildTicks(o)||o)||!o.length)&&l.ticks)for(o=[],i=0,a=l.ticks.length;i<a;++i)o.push({value:l.ticks[i],major:!1});return l._ticks=o,s=d<o.length,r=l._convertTicksToLabels(s?function(t,e){for(var n=[],i=t.length/e,a=0,r=t.length;a<r;a+=i)n.push(t[Math.floor(a)]);return n}(o,d):o),l._configure(),l.beforeCalculateTickRotation(),l.calculateTickRotation(),l.afterCalculateTickRotation(),l.beforeFit(),l.fit(),l.afterFit(),l._ticksToDraw=u.display&&(u.autoSkip||"auto"===u.source)?l._autoSkip(o):o,s&&(r=l._convertTicksToLabels(l._ticksToDraw)),l.ticks=r,l.afterUpdate(),l.minSize},_configure:function(){var t,e,n=this,i=n.options.ticks.reverse;n.isHorizontal()?(t=n.left,e=n.right):(t=n.top,e=n.bottom,i=!i),n._startPixel=t,n._endPixel=e,n._reversePixels=i,n._length=e-t},afterUpdate:function(){B.callback(this.options.afterUpdate,[this])},beforeSetDimensions:function(){B.callback(this.options.beforeSetDimensions,[this])},setDimensions:function(){var t=this;t.isHorizontal()?(t.width=t.maxWidth,t.left=0,t.right=t.width):(t.height=t.maxHeight,t.top=0,t.bottom=t.height),t.paddingLeft=0,t.paddingTop=0,t.paddingRight=0,t.paddingBottom=0},afterSetDimensions:function(){B.callback(this.options.afterSetDimensions,[this])},beforeDataLimits:function(){B.callback(this.options.beforeDataLimits,[this])},determineDataLimits:B.noop,afterDataLimits:function(){B.callback(this.options.afterDataLimits,[this])},beforeBuildTicks:function(){B.callback(this.options.beforeBuildTicks,[this])},buildTicks:B.noop,afterBuildTicks:function(t){var e=this;return ln(t)&&t.length?B.callback(e.options.afterBuildTicks,[e,t]):(e.ticks=B.callback(e.options.afterBuildTicks,[e,e.ticks])||e.ticks,t)},beforeTickToLabelConversion:function(){B.callback(this.options.beforeTickToLabelConversion,[this])},convertTicksToLabels:function(){var t=this.options.ticks;this.ticks=this.ticks.map(t.userCallback||t.callback,this)},afterTickToLabelConversion:function(){B.callback(this.options.afterTickToLabelConversion,[this])},beforeCalculateTickRotation:function(){B.callback(this.options.beforeCalculateTickRotation,[this])},calculateTickRotation:function(){var t,e,n,i,a,r,o,s=this,l=s.options,u=l.ticks,d=s.getTicks().length,h=u.minRotation||0,c=u.maxRotation,f=h;!s._isVisible()||!u.display||h>=c||d<=1||!s.isHorizontal()?s.labelRotation=h:(e=(t=s._getLabelSizes()).widest.width,n=t.highest.height-t.highest.offset,i=Math.min(s.maxWidth,s.chart.width-e),e+6>(a=l.offset?s.maxWidth/d:i/(d-1))&&(a=i/(d-(l.offset?.5:1)),r=s.maxHeight-gn(l.gridLines)-u.padding-mn(l.scaleLabel),o=Math.sqrt(e*e+n*n),f=B.toDegrees(Math.min(Math.asin(Math.min((t.highest.height+6)/a,1)),Math.asin(Math.min(r/o,1))-Math.asin(n/o))),f=Math.max(h,Math.min(c,f))),s.labelRotation=f)},afterCalculateTickRotation:function(){B.callback(this.options.afterCalculateTickRotation,[this])},beforeFit:function(){B.callback(this.options.beforeFit,[this])},fit:function(){var t=this,e=t.minSize={width:0,height:0},n=t.chart,i=t.options,a=i.ticks,r=i.scaleLabel,o=i.gridLines,s=t._isVisible(),l="bottom"===i.position,u=t.isHorizontal();if(u?e.width=t.maxWidth:s&&(e.width=gn(o)+mn(r)),u?s&&(e.height=gn(o)+mn(r)):e.height=t.maxHeight,a.display&&s){var d=vn(a),h=t._getLabelSizes(),c=h.first,f=h.last,g=h.widest,m=h.highest,p=.4*d.minor.lineHeight,v=a.padding;if(u){var b=0!==t.labelRotation,y=B.toRadians(t.labelRotation),x=Math.cos(y),_=Math.sin(y),w=_*g.width+x*(m.height-(b?m.offset:0))+(b?0:p);e.height=Math.min(t.maxHeight,e.height+w+v);var k,M,S=t.getPixelForTick(0)-t.left,D=t.right-t.getPixelForTick(t.getTicks().length-1);b?(k=l?x*c.width+_*c.offset:_*(c.height-c.offset),M=l?_*(f.height-f.offset):x*f.width+_*f.offset):(k=c.width/2,M=f.width/2),t.paddingLeft=Math.max((k-S)*t.width/(t.width-S),0)+3,t.paddingRight=Math.max((M-D)*t.width/(t.width-D),0)+3}else{var C=a.mirror?0:g.width+v+p;e.width=Math.min(t.maxWidth,e.width+C),t.paddingTop=c.height/2,t.paddingBottom=f.height/2}}t.handleMargins(),u?(t.width=t._length=n.width-t.margins.left-t.margins.right,t.height=e.height):(t.width=e.width,t.height=t._length=n.height-t.margins.top-t.margins.bottom)},handleMargins:function(){var t=this;t.margins&&(t.margins.left=Math.max(t.paddingLeft,t.margins.left),t.margins.top=Math.max(t.paddingTop,t.margins.top),t.margins.right=Math.max(t.paddingRight,t.margins.right),t.margins.bottom=Math.max(t.paddingBottom,t.margins.bottom))},afterFit:function(){B.callback(this.options.afterFit,[this])},isHorizontal:function(){var t=this.options.position;return"top"===t||"bottom"===t},isFullWidth:function(){return this.options.fullWidth},getRightValue:function(t){if(un(t))return NaN;if(("number"==typeof t||t instanceof Number)&&!isFinite(t))return NaN;if(t)if(this.isHorizontal()){if(void 0!==t.x)return this.getRightValue(t.x)}else if(void 0!==t.y)return this.getRightValue(t.y);return t},_convertTicksToLabels:function(t){var e,n,i,a=this;for(a.ticks=t.map((function(t){return t.value})),a.beforeTickToLabelConversion(),e=a.convertTicksToLabels(t)||a.ticks,a.afterTickToLabelConversion(),n=0,i=t.length;n<i;++n)t[n].label=e[n];return e},_getLabelSizes:function(){var t=this,e=t._labelSizes;return e||(t._labelSizes=e=fn(t.ctx,vn(t.options.ticks),t.getTicks(),t.longestTextCache),t.longestLabelWidth=e.widest.width),e},_parseValue:function(t){var e,n,i,a;return ln(t)?(e=+this.getRightValue(t[0]),n=+this.getRightValue(t[1]),i=Math.min(e,n),a=Math.max(e,n)):(e=void 0,n=t=+this.getRightValue(t),i=t,a=t),{min:i,max:a,start:e,end:n}},_getScaleLabel:function(t){var e=this._parseValue(t);return void 0!==e.start?"["+e.start+", "+e.end+"]":+this.getRightValue(t)},getLabelForIndex:B.noop,getPixelForValue:B.noop,getValueForPixel:B.noop,getPixelForTick:function(t){var e=this.options.offset,n=this._ticks.length,i=1/Math.max(n-(e?0:1),1);return t<0||t>n-1?null:this.getPixelForDecimal(t*i+(e?i/2:0))},getPixelForDecimal:function(t){return this._reversePixels&&(t=1-t),this._startPixel+t*this._length},getDecimalForPixel:function(t){var e=(t-this._startPixel)/this._length;return this._reversePixels?1-e:e},getBasePixel:function(){return this.getPixelForValue(this.getBaseValue())},getBaseValue:function(){var t=this.min,e=this.max;return this.beginAtZero?0:t<0&&e<0?e:t>0&&e>0?t:0},_autoSkip:function(t){var e,n,i,a,r=this.options.ticks,o=this._length,s=r.maxTicksLimit||o/this._tickSize()+1,l=r.major.enabled?function(t){var e,n,i=[];for(e=0,n=t.length;e<n;e++)t[e].major&&i.push(e);return i}(t):[],u=l.length,d=l[0],h=l[u-1];if(u>s)return function(t,e,n){var i,a,r=0,o=e[0];for(n=Math.ceil(n),i=0;i<t.length;i++)a=t[i],i===o?(a._index=i,o=e[++r*n]):delete a.label}(t,l,u/s),bn(t);if(i=function(t,e,n,i){var a,r,o,s,l=function(t){var e,n,i=t.length;if(i<2)return!1;for(n=t[0],e=1;e<i;++e)if(t[e]-t[e-1]!==n)return!1;return n}(t),u=(e.length-1)/i;if(!l)return Math.max(u,1);for(o=0,s=(a=B.math._factorize(l)).length-1;o<s;o++)if((r=a[o])>u)return r;return Math.max(u,1)}(l,t,0,s),u>0){for(e=0,n=u-1;e<n;e++)yn(t,i,l[e],l[e+1]);return a=u>1?(h-d)/(u-1):null,yn(t,i,B.isNullOrUndef(a)?0:d-a,d),yn(t,i,h,B.isNullOrUndef(a)?t.length:h+a),bn(t)}return yn(t,i),bn(t)},_tickSize:function(){var t=this.options.ticks,e=B.toRadians(this.labelRotation),n=Math.abs(Math.cos(e)),i=Math.abs(Math.sin(e)),a=this._getLabelSizes(),r=t.autoSkipPadding||0,o=a?a.widest.width+r:0,s=a?a.highest.height+r:0;return this.isHorizontal()?s*n>o*i?o/n:s/i:s*i<o*n?s/n:o/i},_isVisible:function(){var t,e,n,i=this.chart,a=this.options.display;if("auto"!==a)return!!a;for(t=0,e=i.data.datasets.length;t<e;++t)if(i.isDatasetVisible(t)&&((n=i.getDatasetMeta(t)).xAxisID===this.id||n.yAxisID===this.id))return!0;return!1},_computeGridLineItems:function(t){var e,n,i,a,r,o,s,l,u,d,h,c,f,g,m,p,v,b=this,y=b.chart,x=b.options,_=x.gridLines,w=x.position,k=_.offsetGridLines,M=b.isHorizontal(),S=b._ticksToDraw,D=S.length+(k?1:0),C=gn(_),P=[],T=_.drawBorder?hn(_.lineWidth,0,0):0,O=T/2,A=B._alignPixel,F=function(t){return A(y,t,T)};for("top"===w?(e=F(b.bottom),s=b.bottom-C,u=e-O,h=F(t.top)+O,f=t.bottom):"bottom"===w?(e=F(b.top),h=t.top,f=F(t.bottom)-O,s=e+O,u=b.top+C):"left"===w?(e=F(b.right),o=b.right-C,l=e-O,d=F(t.left)+O,c=t.right):(e=F(b.left),d=t.left,c=F(t.right)-O,o=e+O,l=b.left+C),n=0;n<D;++n)i=S[n]||{},un(i.label)&&n<S.length||(n===b.zeroLineIndex&&x.offset===k?(g=_.zeroLineWidth,m=_.zeroLineColor,p=_.zeroLineBorderDash||[],v=_.zeroLineBorderDashOffset||0):(g=hn(_.lineWidth,n,1),m=hn(_.color,n,"rgba(0,0,0,0.1)"),p=_.borderDash||[],v=_.borderDashOffset||0),void 0!==(a=cn(b,i._index||n,k))&&(r=A(y,a,g),M?o=l=d=c=r:s=u=h=f=r,P.push({tx1:o,ty1:s,tx2:l,ty2:u,x1:d,y1:h,x2:c,y2:f,width:g,color:m,borderDash:p,borderDashOffset:v})));return P.ticksLength=D,P.borderValue=e,P},_computeLabelItems:function(){var t,e,n,i,a,r,o,s,l,u,d,h,c=this,f=c.options,g=f.ticks,m=f.position,p=g.mirror,v=c.isHorizontal(),b=c._ticksToDraw,y=vn(g),x=g.padding,_=gn(f.gridLines),w=-B.toRadians(c.labelRotation),k=[];for("top"===m?(r=c.bottom-_-x,o=w?"left":"center"):"bottom"===m?(r=c.top+_+x,o=w?"right":"center"):"left"===m?(a=c.right-(p?0:_)-x,o=p?"left":"right"):(a=c.left+(p?0:_)+x,o=p?"right":"left"),t=0,e=b.length;t<e;++t)i=(n=b[t]).label,un(i)||(s=c.getPixelForTick(n._index||t)+g.labelOffset,u=(l=n.major?y.major:y.minor).lineHeight,d=ln(i)?i.length:1,v?(a=s,h="top"===m?((w?1:.5)-d)*u:(w?0:.5)*u):(r=s,h=(1-d)*u/2),k.push({x:a,y:r,rotation:w,label:i,font:l,textOffset:h,textAlign:o}));return k},_drawGrid:function(t){var e=this,n=e.options.gridLines;if(n.display){var i,a,r,o,s,l=e.ctx,u=e.chart,d=B._alignPixel,h=n.drawBorder?hn(n.lineWidth,0,0):0,c=e._gridLineItems||(e._gridLineItems=e._computeGridLineItems(t));for(r=0,o=c.length;r<o;++r)i=(s=c[r]).width,a=s.color,i&&a&&(l.save(),l.lineWidth=i,l.strokeStyle=a,l.setLineDash&&(l.setLineDash(s.borderDash),l.lineDashOffset=s.borderDashOffset),l.beginPath(),n.drawTicks&&(l.moveTo(s.tx1,s.ty1),l.lineTo(s.tx2,s.ty2)),n.drawOnChartArea&&(l.moveTo(s.x1,s.y1),l.lineTo(s.x2,s.y2)),l.stroke(),l.restore());if(h){var f,g,m,p,v=h,b=hn(n.lineWidth,c.ticksLength-1,1),y=c.borderValue;e.isHorizontal()?(f=d(u,e.left,v)-v/2,g=d(u,e.right,b)+b/2,m=p=y):(m=d(u,e.top,v)-v/2,p=d(u,e.bottom,b)+b/2,f=g=y),l.lineWidth=h,l.strokeStyle=hn(n.color,0),l.beginPath(),l.moveTo(f,m),l.lineTo(g,p),l.stroke()}}},_drawLabels:function(){var t=this;if(t.options.ticks.display){var e,n,i,a,r,o,s,l,u=t.ctx,d=t._labelItems||(t._labelItems=t._computeLabelItems());for(e=0,i=d.length;e<i;++e){if(o=(r=d[e]).font,u.save(),u.translate(r.x,r.y),u.rotate(r.rotation),u.font=o.string,u.fillStyle=o.color,u.textBaseline="middle",u.textAlign=r.textAlign,s=r.label,l=r.textOffset,ln(s))for(n=0,a=s.length;n<a;++n)u.fillText(""+s[n],0,l),l+=o.lineHeight;else u.fillText(s,0,l);u.restore()}}},_drawTitle:function(){var t=this,e=t.ctx,n=t.options,i=n.scaleLabel;if(i.display){var a,r,o=dn(i.fontColor,Y.global.defaultFontColor),s=B.options._parseFont(i),l=B.options.toPadding(i.padding),u=s.lineHeight/2,d=n.position,h=0;if(t.isHorizontal())a=t.left+t.width/2,r="bottom"===d?t.bottom-u-l.bottom:t.top+u+l.top;else{var c="left"===d;a=c?t.left+u+l.top:t.right-u-l.top,r=t.top+t.height/2,h=c?-.5*Math.PI:.5*Math.PI}e.save(),e.translate(a,r),e.rotate(h),e.textAlign="center",e.textBaseline="middle",e.fillStyle=o,e.font=s.string,e.fillText(i.labelString,0,0),e.restore()}},draw:function(t){this._isVisible()&&(this._drawGrid(t),this._drawTitle(),this._drawLabels())},_layers:function(){var t=this,e=t.options,n=e.ticks&&e.ticks.z||0,i=e.gridLines&&e.gridLines.z||0;return t._isVisible()&&n!==i&&t.draw===t._draw?[{z:i,draw:function(){t._drawGrid.apply(t,arguments),t._drawTitle.apply(t,arguments)}},{z:n,draw:function(){t._drawLabels.apply(t,arguments)}}]:[{z:n,draw:function(){t.draw.apply(t,arguments)}}]},_getMatchingVisibleMetas:function(t){var e=this,n=e.isHorizontal();return e.chart._getSortedVisibleDatasetMetas().filter((function(i){return(!t||i.type===t)&&(n?i.xAxisID===e.id:i.yAxisID===e.id)}))}});xn.prototype._draw=xn.prototype.draw;var _n=xn,wn=B.isNullOrUndef,kn=_n.extend({determineDataLimits:function(){var t,e=this,n=e._getLabels(),i=e.options.ticks,a=i.min,r=i.max,o=0,s=n.length-1;void 0!==a&&(t=n.indexOf(a))>=0&&(o=t),void 0!==r&&(t=n.indexOf(r))>=0&&(s=t),e.minIndex=o,e.maxIndex=s,e.min=n[o],e.max=n[s]},buildTicks:function(){var t=this._getLabels(),e=this.minIndex,n=this.maxIndex;this.ticks=0===e&&n===t.length-1?t:t.slice(e,n+1)},getLabelForIndex:function(t,e){var n=this.chart;return n.getDatasetMeta(e).controller._getValueScaleId()===this.id?this.getRightValue(n.data.datasets[e].data[t]):this._getLabels()[t]},_configure:function(){var t=this,e=t.options.offset,n=t.ticks;_n.prototype._configure.call(t),t.isHorizontal()||(t._reversePixels=!t._reversePixels),n&&(t._startValue=t.minIndex-(e?.5:0),t._valueRange=Math.max(n.length-(e?0:1),1))},getPixelForValue:function(t,e,n){var i,a,r,o=this;return wn(e)||wn(n)||(t=o.chart.data.datasets[n].data[e]),wn(t)||(i=o.isHorizontal()?t.x:t.y),(void 0!==i||void 0!==t&&isNaN(e))&&(a=o._getLabels(),t=B.valueOrDefault(i,t),e=-1!==(r=a.indexOf(t))?r:e,isNaN(e)&&(e=t)),o.getPixelForDecimal((e-o._startValue)/o._valueRange)},getPixelForTick:function(t){var e=this.ticks;return t<0||t>e.length-1?null:this.getPixelForValue(e[t],t+this.minIndex)},getValueForPixel:function(t){var e=Math.round(this._startValue+this.getDecimalForPixel(t)*this._valueRange);return Math.min(Math.max(e,0),this.ticks.length-1)},getBasePixel:function(){return this.bottom}}),Mn={position:"bottom"};kn._defaults=Mn;var Sn=B.noop,Dn=B.isNullOrUndef;var Cn=_n.extend({getRightValue:function(t){return"string"==typeof t?+t:_n.prototype.getRightValue.call(this,t)},handleTickRangeOptions:function(){var t=this,e=t.options.ticks;if(e.beginAtZero){var n=B.sign(t.min),i=B.sign(t.max);n<0&&i<0?t.max=0:n>0&&i>0&&(t.min=0)}var a=void 0!==e.min||void 0!==e.suggestedMin,r=void 0!==e.max||void 0!==e.suggestedMax;void 0!==e.min?t.min=e.min:void 0!==e.suggestedMin&&(null===t.min?t.min=e.suggestedMin:t.min=Math.min(t.min,e.suggestedMin)),void 0!==e.max?t.max=e.max:void 0!==e.suggestedMax&&(null===t.max?t.max=e.suggestedMax:t.max=Math.max(t.max,e.suggestedMax)),a!==r&&t.min>=t.max&&(a?t.max=t.min+1:t.min=t.max-1),t.min===t.max&&(t.max++,e.beginAtZero||t.min--)},getTickLimit:function(){var t,e=this.options.ticks,n=e.stepSize,i=e.maxTicksLimit;return n?t=Math.ceil(this.max/n)-Math.floor(this.min/n)+1:(t=this._computeTickLimit(),i=i||11),i&&(t=Math.min(i,t)),t},_computeTickLimit:function(){return Number.POSITIVE_INFINITY},handleDirectionalChanges:Sn,buildTicks:function(){var t=this,e=t.options.ticks,n=t.getTickLimit(),i={maxTicks:n=Math.max(2,n),min:e.min,max:e.max,precision:e.precision,stepSize:B.valueOrDefault(e.fixedStepSize,e.stepSize)},a=t.ticks=function(t,e){var n,i,a,r,o=[],s=t.stepSize,l=s||1,u=t.maxTicks-1,d=t.min,h=t.max,c=t.precision,f=e.min,g=e.max,m=B.niceNum((g-f)/u/l)*l;if(m<1e-14&&Dn(d)&&Dn(h))return[f,g];(r=Math.ceil(g/m)-Math.floor(f/m))>u&&(m=B.niceNum(r*m/u/l)*l),s||Dn(c)?n=Math.pow(10,B._decimalPlaces(m)):(n=Math.pow(10,c),m=Math.ceil(m*n)/n),i=Math.floor(f/m)*m,a=Math.ceil(g/m)*m,s&&(!Dn(d)&&B.almostWhole(d/m,m/1e3)&&(i=d),!Dn(h)&&B.almostWhole(h/m,m/1e3)&&(a=h)),r=(a-i)/m,r=B.almostEquals(r,Math.round(r),m/1e3)?Math.round(r):Math.ceil(r),i=Math.round(i*n)/n,a=Math.round(a*n)/n,o.push(Dn(d)?i:d);for(var p=1;p<r;++p)o.push(Math.round((i+p*m)*n)/n);return o.push(Dn(h)?a:h),o}(i,t);t.handleDirectionalChanges(),t.max=B.max(a),t.min=B.min(a),e.reverse?(a.reverse(),t.start=t.max,t.end=t.min):(t.start=t.min,t.end=t.max)},convertTicksToLabels:function(){var t=this;t.ticksAsNumbers=t.ticks.slice(),t.zeroLineIndex=t.ticks.indexOf(0),_n.prototype.convertTicksToLabels.call(t)},_configure:function(){var t,e=this,n=e.getTicks(),i=e.min,a=e.max;_n.prototype._configure.call(e),e.options.offset&&n.length&&(i-=t=(a-i)/Math.max(n.length-1,1)/2,a+=t),e._startValue=i,e._endValue=a,e._valueRange=a-i}}),Pn={position:"left",ticks:{callback:sn.formatters.linear}};function Tn(t,e,n,i){var a,r,o=t.options,s=function(t,e,n){var i=[n.type,void 0===e&&void 0===n.stack?n.index:"",n.stack].join(".");return void 0===t[i]&&(t[i]={pos:[],neg:[]}),t[i]}(e,o.stacked,n),l=s.pos,u=s.neg,d=i.length;for(a=0;a<d;++a)r=t._parseValue(i[a]),isNaN(r.min)||isNaN(r.max)||n.data[a].hidden||(l[a]=l[a]||0,u[a]=u[a]||0,o.relativePoints?l[a]=100:r.min<0||r.max<0?u[a]+=r.min:l[a]+=r.max)}function On(t,e,n){var i,a,r=n.length;for(i=0;i<r;++i)a=t._parseValue(n[i]),isNaN(a.min)||isNaN(a.max)||e.data[i].hidden||(t.min=Math.min(t.min,a.min),t.max=Math.max(t.max,a.max))}var An=Cn.extend({determineDataLimits:function(){var t,e,n,i,a=this,r=a.options,o=a.chart.data.datasets,s=a._getMatchingVisibleMetas(),l=r.stacked,u={},d=s.length;if(a.min=Number.POSITIVE_INFINITY,a.max=Number.NEGATIVE_INFINITY,void 0===l)for(t=0;!l&&t<d;++t)l=void 0!==(e=s[t]).stack;for(t=0;t<d;++t)n=o[(e=s[t]).index].data,l?Tn(a,u,e,n):On(a,e,n);B.each(u,(function(t){i=t.pos.concat(t.neg),a.min=Math.min(a.min,B.min(i)),a.max=Math.max(a.max,B.max(i))})),a.min=B.isFinite(a.min)&&!isNaN(a.min)?a.min:0,a.max=B.isFinite(a.max)&&!isNaN(a.max)?a.max:1,a.handleTickRangeOptions()},_computeTickLimit:function(){var t;return this.isHorizontal()?Math.ceil(this.width/40):(t=B.options._parseFont(this.options.ticks),Math.ceil(this.height/t.lineHeight))},handleDirectionalChanges:function(){this.isHorizontal()||this.ticks.reverse()},getLabelForIndex:function(t,e){return this._getScaleLabel(this.chart.data.datasets[e].data[t])},getPixelForValue:function(t){return this.getPixelForDecimal((+this.getRightValue(t)-this._startValue)/this._valueRange)},getValueForPixel:function(t){return this._startValue+this.getDecimalForPixel(t)*this._valueRange},getPixelForTick:function(t){var e=this.ticksAsNumbers;return t<0||t>e.length-1?null:this.getPixelForValue(e[t])}}),Fn=Pn;An._defaults=Fn;var In=B.valueOrDefault,Ln=B.math.log10;var Rn={position:"left",ticks:{callback:sn.formatters.logarithmic}};function Nn(t,e){return B.isFinite(t)&&t>=0?t:e}var Wn=_n.extend({determineDataLimits:function(){var t,e,n,i,a,r,o=this,s=o.options,l=o.chart,u=l.data.datasets,d=o.isHorizontal();function h(t){return d?t.xAxisID===o.id:t.yAxisID===o.id}o.min=Number.POSITIVE_INFINITY,o.max=Number.NEGATIVE_INFINITY,o.minNotZero=Number.POSITIVE_INFINITY;var c=s.stacked;if(void 0===c)for(t=0;t<u.length;t++)if(e=l.getDatasetMeta(t),l.isDatasetVisible(t)&&h(e)&&void 0!==e.stack){c=!0;break}if(s.stacked||c){var f={};for(t=0;t<u.length;t++){var g=[(e=l.getDatasetMeta(t)).type,void 0===s.stacked&&void 0===e.stack?t:"",e.stack].join(".");if(l.isDatasetVisible(t)&&h(e))for(void 0===f[g]&&(f[g]=[]),a=0,r=(i=u[t].data).length;a<r;a++){var m=f[g];n=o._parseValue(i[a]),isNaN(n.min)||isNaN(n.max)||e.data[a].hidden||n.min<0||n.max<0||(m[a]=m[a]||0,m[a]+=n.max)}}B.each(f,(function(t){if(t.length>0){var e=B.min(t),n=B.max(t);o.min=Math.min(o.min,e),o.max=Math.max(o.max,n)}}))}else for(t=0;t<u.length;t++)if(e=l.getDatasetMeta(t),l.isDatasetVisible(t)&&h(e))for(a=0,r=(i=u[t].data).length;a<r;a++)n=o._parseValue(i[a]),isNaN(n.min)||isNaN(n.max)||e.data[a].hidden||n.min<0||n.max<0||(o.min=Math.min(n.min,o.min),o.max=Math.max(n.max,o.max),0!==n.min&&(o.minNotZero=Math.min(n.min,o.minNotZero)));o.min=B.isFinite(o.min)?o.min:null,o.max=B.isFinite(o.max)?o.max:null,o.minNotZero=B.isFinite(o.minNotZero)?o.minNotZero:null,this.handleTickRangeOptions()},handleTickRangeOptions:function(){var t=this,e=t.options.ticks;t.min=Nn(e.min,t.min),t.max=Nn(e.max,t.max),t.min===t.max&&(0!==t.min&&null!==t.min?(t.min=Math.pow(10,Math.floor(Ln(t.min))-1),t.max=Math.pow(10,Math.floor(Ln(t.max))+1)):(t.min=1,t.max=10)),null===t.min&&(t.min=Math.pow(10,Math.floor(Ln(t.max))-1)),null===t.max&&(t.max=0!==t.min?Math.pow(10,Math.floor(Ln(t.min))+1):10),null===t.minNotZero&&(t.min>0?t.minNotZero=t.min:t.max<1?t.minNotZero=Math.pow(10,Math.floor(Ln(t.max))):t.minNotZero=1)},buildTicks:function(){var t=this,e=t.options.ticks,n=!t.isHorizontal(),i={min:Nn(e.min),max:Nn(e.max)},a=t.ticks=function(t,e){var n,i,a=[],r=In(t.min,Math.pow(10,Math.floor(Ln(e.min)))),o=Math.floor(Ln(e.max)),s=Math.ceil(e.max/Math.pow(10,o));0===r?(n=Math.floor(Ln(e.minNotZero)),i=Math.floor(e.minNotZero/Math.pow(10,n)),a.push(r),r=i*Math.pow(10,n)):(n=Math.floor(Ln(r)),i=Math.floor(r/Math.pow(10,n)));var l=n<0?Math.pow(10,Math.abs(n)):1;do{a.push(r),10===++i&&(i=1,l=++n>=0?1:l),r=Math.round(i*Math.pow(10,n)*l)/l}while(n<o||n===o&&i<s);var u=In(t.max,r);return a.push(u),a}(i,t);t.max=B.max(a),t.min=B.min(a),e.reverse?(n=!n,t.start=t.max,t.end=t.min):(t.start=t.min,t.end=t.max),n&&a.reverse()},convertTicksToLabels:function(){this.tickValues=this.ticks.slice(),_n.prototype.convertTicksToLabels.call(this)},getLabelForIndex:function(t,e){return this._getScaleLabel(this.chart.data.datasets[e].data[t])},getPixelForTick:function(t){var e=this.tickValues;return t<0||t>e.length-1?null:this.getPixelForValue(e[t])},_getFirstTickValue:function(t){var e=Math.floor(Ln(t));return Math.floor(t/Math.pow(10,e))*Math.pow(10,e)},_configure:function(){var t=this,e=t.min,n=0;_n.prototype._configure.call(t),0===e&&(e=t._getFirstTickValue(t.minNotZero),n=In(t.options.ticks.fontSize,Y.global.defaultFontSize)/t._length),t._startValue=Ln(e),t._valueOffset=n,t._valueRange=(Ln(t.max)-Ln(e))/(1-n)},getPixelForValue:function(t){var e=this,n=0;return(t=+e.getRightValue(t))>e.min&&t>0&&(n=(Ln(t)-e._startValue)/e._valueRange+e._valueOffset),e.getPixelForDecimal(n)},getValueForPixel:function(t){var e=this,n=e.getDecimalForPixel(t);return 0===n&&0===e.min?0:Math.pow(10,e._startValue+(n-e._valueOffset)*e._valueRange)}}),Yn=Rn;Wn._defaults=Yn;var zn=B.valueOrDefault,En=B.valueAtIndexOrDefault,Vn=B.options.resolve,Hn={display:!0,animate:!0,position:"chartArea",angleLines:{display:!0,color:"rgba(0,0,0,0.1)",lineWidth:1,borderDash:[],borderDashOffset:0},gridLines:{circular:!1},ticks:{showLabelBackdrop:!0,backdropColor:"rgba(255,255,255,0.75)",backdropPaddingY:2,backdropPaddingX:2,callback:sn.formatters.linear},pointLabels:{display:!0,fontSize:10,callback:function(t){return t}}};function Bn(t){var e=t.ticks;return e.display&&t.display?zn(e.fontSize,Y.global.defaultFontSize)+2*e.backdropPaddingY:0}function jn(t,e,n,i,a){return t===i||t===a?{start:e-n/2,end:e+n/2}:t<i||t>a?{start:e-n,end:e}:{start:e,end:e+n}}function Un(t){return 0===t||180===t?"center":t<180?"left":"right"}function Gn(t,e,n,i){var a,r,o=n.y+i/2;if(B.isArray(e))for(a=0,r=e.length;a<r;++a)t.fillText(e[a],n.x,o),o+=i;else t.fillText(e,n.x,o)}function qn(t,e,n){90===t||270===t?n.y-=e.h/2:(t>270||t<90)&&(n.y-=e.h)}function Zn(t){return B.isNumber(t)?t:0}var $n=Cn.extend({setDimensions:function(){var t=this;t.width=t.maxWidth,t.height=t.maxHeight,t.paddingTop=Bn(t.options)/2,t.xCenter=Math.floor(t.width/2),t.yCenter=Math.floor((t.height-t.paddingTop)/2),t.drawingArea=Math.min(t.height-t.paddingTop,t.width)/2},determineDataLimits:function(){var t=this,e=t.chart,n=Number.POSITIVE_INFINITY,i=Number.NEGATIVE_INFINITY;B.each(e.data.datasets,(function(a,r){if(e.isDatasetVisible(r)){var o=e.getDatasetMeta(r);B.each(a.data,(function(e,a){var r=+t.getRightValue(e);isNaN(r)||o.data[a].hidden||(n=Math.min(r,n),i=Math.max(r,i))}))}})),t.min=n===Number.POSITIVE_INFINITY?0:n,t.max=i===Number.NEGATIVE_INFINITY?0:i,t.handleTickRangeOptions()},_computeTickLimit:function(){return Math.ceil(this.drawingArea/Bn(this.options))},convertTicksToLabels:function(){var t=this;Cn.prototype.convertTicksToLabels.call(t),t.pointLabels=t.chart.data.labels.map((function(){var e=B.callback(t.options.pointLabels.callback,arguments,t);return e||0===e?e:""}))},getLabelForIndex:function(t,e){return+this.getRightValue(this.chart.data.datasets[e].data[t])},fit:function(){var t=this.options;t.display&&t.pointLabels.display?function(t){var e,n,i,a=B.options._parseFont(t.options.pointLabels),r={l:0,r:t.width,t:0,b:t.height-t.paddingTop},o={};t.ctx.font=a.string,t._pointLabelSizes=[];var s,l,u,d=t.chart.data.labels.length;for(e=0;e<d;e++){i=t.getPointPosition(e,t.drawingArea+5),s=t.ctx,l=a.lineHeight,u=t.pointLabels[e],n=B.isArray(u)?{w:B.longestText(s,s.font,u),h:u.length*l}:{w:s.measureText(u).width,h:l},t._pointLabelSizes[e]=n;var h=t.getIndexAngle(e),c=B.toDegrees(h)%360,f=jn(c,i.x,n.w,0,180),g=jn(c,i.y,n.h,90,270);f.start<r.l&&(r.l=f.start,o.l=h),f.end>r.r&&(r.r=f.end,o.r=h),g.start<r.t&&(r.t=g.start,o.t=h),g.end>r.b&&(r.b=g.end,o.b=h)}t.setReductions(t.drawingArea,r,o)}(this):this.setCenterPoint(0,0,0,0)},setReductions:function(t,e,n){var i=this,a=e.l/Math.sin(n.l),r=Math.max(e.r-i.width,0)/Math.sin(n.r),o=-e.t/Math.cos(n.t),s=-Math.max(e.b-(i.height-i.paddingTop),0)/Math.cos(n.b);a=Zn(a),r=Zn(r),o=Zn(o),s=Zn(s),i.drawingArea=Math.min(Math.floor(t-(a+r)/2),Math.floor(t-(o+s)/2)),i.setCenterPoint(a,r,o,s)},setCenterPoint:function(t,e,n,i){var a=this,r=a.width-e-a.drawingArea,o=t+a.drawingArea,s=n+a.drawingArea,l=a.height-a.paddingTop-i-a.drawingArea;a.xCenter=Math.floor((o+r)/2+a.left),a.yCenter=Math.floor((s+l)/2+a.top+a.paddingTop)},getIndexAngle:function(t){var e=this.chart,n=(t*(360/e.data.labels.length)+((e.options||{}).startAngle||0))%360;return(n<0?n+360:n)*Math.PI*2/360},getDistanceFromCenterForValue:function(t){var e=this;if(B.isNullOrUndef(t))return NaN;var n=e.drawingArea/(e.max-e.min);return e.options.ticks.reverse?(e.max-t)*n:(t-e.min)*n},getPointPosition:function(t,e){var n=this.getIndexAngle(t)-Math.PI/2;return{x:Math.cos(n)*e+this.xCenter,y:Math.sin(n)*e+this.yCenter}},getPointPositionForValue:function(t,e){return this.getPointPosition(t,this.getDistanceFromCenterForValue(e))},getBasePosition:function(t){var e=this.min,n=this.max;return this.getPointPositionForValue(t||0,this.beginAtZero?0:e<0&&n<0?n:e>0&&n>0?e:0)},_drawGrid:function(){var t,e,n,i=this,a=i.ctx,r=i.options,o=r.gridLines,s=r.angleLines,l=zn(s.lineWidth,o.lineWidth),u=zn(s.color,o.color);if(r.pointLabels.display&&function(t){var e=t.ctx,n=t.options,i=n.pointLabels,a=Bn(n),r=t.getDistanceFromCenterForValue(n.ticks.reverse?t.min:t.max),o=B.options._parseFont(i);e.save(),e.font=o.string,e.textBaseline="middle";for(var s=t.chart.data.labels.length-1;s>=0;s--){var l=0===s?a/2:0,u=t.getPointPosition(s,r+l+5),d=En(i.fontColor,s,Y.global.defaultFontColor);e.fillStyle=d;var h=t.getIndexAngle(s),c=B.toDegrees(h);e.textAlign=Un(c),qn(c,t._pointLabelSizes[s],u),Gn(e,t.pointLabels[s],u,o.lineHeight)}e.restore()}(i),o.display&&B.each(i.ticks,(function(t,n){0!==n&&(e=i.getDistanceFromCenterForValue(i.ticksAsNumbers[n]),function(t,e,n,i){var a,r=t.ctx,o=e.circular,s=t.chart.data.labels.length,l=En(e.color,i-1),u=En(e.lineWidth,i-1);if((o||s)&&l&&u){if(r.save(),r.strokeStyle=l,r.lineWidth=u,r.setLineDash&&(r.setLineDash(e.borderDash||[]),r.lineDashOffset=e.borderDashOffset||0),r.beginPath(),o)r.arc(t.xCenter,t.yCenter,n,0,2*Math.PI);else{a=t.getPointPosition(0,n),r.moveTo(a.x,a.y);for(var d=1;d<s;d++)a=t.getPointPosition(d,n),r.lineTo(a.x,a.y)}r.closePath(),r.stroke(),r.restore()}}(i,o,e,n))})),s.display&&l&&u){for(a.save(),a.lineWidth=l,a.strokeStyle=u,a.setLineDash&&(a.setLineDash(Vn([s.borderDash,o.borderDash,[]])),a.lineDashOffset=Vn([s.borderDashOffset,o.borderDashOffset,0])),t=i.chart.data.labels.length-1;t>=0;t--)e=i.getDistanceFromCenterForValue(r.ticks.reverse?i.min:i.max),n=i.getPointPosition(t,e),a.beginPath(),a.moveTo(i.xCenter,i.yCenter),a.lineTo(n.x,n.y),a.stroke();a.restore()}},_drawLabels:function(){var t=this,e=t.ctx,n=t.options.ticks;if(n.display){var i,a,r=t.getIndexAngle(0),o=B.options._parseFont(n),s=zn(n.fontColor,Y.global.defaultFontColor);e.save(),e.font=o.string,e.translate(t.xCenter,t.yCenter),e.rotate(r),e.textAlign="center",e.textBaseline="middle",B.each(t.ticks,(function(r,l){(0!==l||n.reverse)&&(i=t.getDistanceFromCenterForValue(t.ticksAsNumbers[l]),n.showLabelBackdrop&&(a=e.measureText(r).width,e.fillStyle=n.backdropColor,e.fillRect(-a/2-n.backdropPaddingX,-i-o.size/2-n.backdropPaddingY,a+2*n.backdropPaddingX,o.size+2*n.backdropPaddingY)),e.fillStyle=s,e.fillText(r,0,-i))})),e.restore()}},_drawTitle:B.noop}),Xn=Hn;$n._defaults=Xn;var Kn=B._deprecated,Jn=B.options.resolve,Qn=B.valueOrDefault,ti=Number.MIN_SAFE_INTEGER||-9007199254740991,ei=Number.MAX_SAFE_INTEGER||9007199254740991,ni={millisecond:{common:!0,size:1,steps:1e3},second:{common:!0,size:1e3,steps:60},minute:{common:!0,size:6e4,steps:60},hour:{common:!0,size:36e5,steps:24},day:{common:!0,size:864e5,steps:30},week:{common:!1,size:6048e5,steps:4},month:{common:!0,size:2628e6,steps:12},quarter:{common:!1,size:7884e6,steps:4},year:{common:!0,size:3154e7}},ii=Object.keys(ni);function ai(t,e){return t-e}function ri(t){return B.valueOrDefault(t.time.min,t.ticks.min)}function oi(t){return B.valueOrDefault(t.time.max,t.ticks.max)}function si(t,e,n,i){var a=function(t,e,n){for(var i,a,r,o=0,s=t.length-1;o>=0&&o<=s;){if(a=t[(i=o+s>>1)-1]||null,r=t[i],!a)return{lo:null,hi:r};if(r[e]<n)o=i+1;else{if(!(a[e]>n))return{lo:a,hi:r};s=i-1}}return{lo:r,hi:null}}(t,e,n),r=a.lo?a.hi?a.lo:t[t.length-2]:t[0],o=a.lo?a.hi?a.hi:t[t.length-1]:t[1],s=o[e]-r[e],l=s?(n-r[e])/s:0,u=(o[i]-r[i])*l;return r[i]+u}function li(t,e){var n=t._adapter,i=t.options.time,a=i.parser,r=a||i.format,o=e;return"function"==typeof a&&(o=a(o)),B.isFinite(o)||(o="string"==typeof r?n.parse(o,r):n.parse(o)),null!==o?+o:(a||"function"!=typeof r||(o=r(e),B.isFinite(o)||(o=n.parse(o))),o)}function ui(t,e){if(B.isNullOrUndef(e))return null;var n=t.options.time,i=li(t,t.getRightValue(e));return null===i?i:(n.round&&(i=+t._adapter.startOf(i,n.round)),i)}function di(t,e,n,i){var a,r,o,s=ii.length;for(a=ii.indexOf(t);a<s-1;++a)if(o=(r=ni[ii[a]]).steps?r.steps:ei,r.common&&Math.ceil((n-e)/(o*r.size))<=i)return ii[a];return ii[s-1]}function hi(t,e,n){var i,a,r=[],o={},s=e.length;for(i=0;i<s;++i)o[a=e[i]]=i,r.push({value:a,major:!1});return 0!==s&&n?function(t,e,n,i){var a,r,o=t._adapter,s=+o.startOf(e[0].value,i),l=e[e.length-1].value;for(a=s;a<=l;a=+o.add(a,1,i))(r=n[a])>=0&&(e[r].major=!0);return e}(t,r,o,n):r}var ci=_n.extend({initialize:function(){this.mergeTicksOptions(),_n.prototype.initialize.call(this)},update:function(){var t=this,e=t.options,n=e.time||(e.time={}),i=t._adapter=new on._date(e.adapters.date);return Kn("time scale",n.format,"time.format","time.parser"),Kn("time scale",n.min,"time.min","ticks.min"),Kn("time scale",n.max,"time.max","ticks.max"),B.mergeIf(n.displayFormats,i.formats()),_n.prototype.update.apply(t,arguments)},getRightValue:function(t){return t&&void 0!==t.t&&(t=t.t),_n.prototype.getRightValue.call(this,t)},determineDataLimits:function(){var t,e,n,i,a,r,o,s=this,l=s.chart,u=s._adapter,d=s.options,h=d.time.unit||"day",c=ei,f=ti,g=[],m=[],p=[],v=s._getLabels();for(t=0,n=v.length;t<n;++t)p.push(ui(s,v[t]));for(t=0,n=(l.data.datasets||[]).length;t<n;++t)if(l.isDatasetVisible(t))if(a=l.data.datasets[t].data,B.isObject(a[0]))for(m[t]=[],e=0,i=a.length;e<i;++e)r=ui(s,a[e]),g.push(r),m[t][e]=r;else m[t]=p.slice(0),o||(g=g.concat(p),o=!0);else m[t]=[];p.length&&(c=Math.min(c,p[0]),f=Math.max(f,p[p.length-1])),g.length&&(g=n>1?function(t){var e,n,i,a={},r=[];for(e=0,n=t.length;e<n;++e)a[i=t[e]]||(a[i]=!0,r.push(i));return r}(g).sort(ai):g.sort(ai),c=Math.min(c,g[0]),f=Math.max(f,g[g.length-1])),c=ui(s,ri(d))||c,f=ui(s,oi(d))||f,c=c===ei?+u.startOf(Date.now(),h):c,f=f===ti?+u.endOf(Date.now(),h)+1:f,s.min=Math.min(c,f),s.max=Math.max(c+1,f),s._table=[],s._timestamps={data:g,datasets:m,labels:p}},buildTicks:function(){var t,e,n,i=this,a=i.min,r=i.max,o=i.options,s=o.ticks,l=o.time,u=i._timestamps,d=[],h=i.getLabelCapacity(a),c=s.source,f=o.distribution;for(u="data"===c||"auto"===c&&"series"===f?u.data:"labels"===c?u.labels:function(t,e,n,i){var a,r=t._adapter,o=t.options,s=o.time,l=s.unit||di(s.minUnit,e,n,i),u=Jn([s.stepSize,s.unitStepSize,1]),d="week"===l&&s.isoWeekday,h=e,c=[];if(d&&(h=+r.startOf(h,"isoWeek",d)),h=+r.startOf(h,d?"day":l),r.diff(n,e,l)>1e5*u)throw e+" and "+n+" are too far apart with stepSize of "+u+" "+l;for(a=h;a<n;a=+r.add(a,u,l))c.push(a);return a!==n&&"ticks"!==o.bounds||c.push(a),c}(i,a,r,h),"ticks"===o.bounds&&u.length&&(a=u[0],r=u[u.length-1]),a=ui(i,ri(o))||a,r=ui(i,oi(o))||r,t=0,e=u.length;t<e;++t)(n=u[t])>=a&&n<=r&&d.push(n);return i.min=a,i.max=r,i._unit=l.unit||(s.autoSkip?di(l.minUnit,i.min,i.max,h):function(t,e,n,i,a){var r,o;for(r=ii.length-1;r>=ii.indexOf(n);r--)if(o=ii[r],ni[o].common&&t._adapter.diff(a,i,o)>=e-1)return o;return ii[n?ii.indexOf(n):0]}(i,d.length,l.minUnit,i.min,i.max)),i._majorUnit=s.major.enabled&&"year"!==i._unit?function(t){for(var e=ii.indexOf(t)+1,n=ii.length;e<n;++e)if(ni[ii[e]].common)return ii[e]}(i._unit):void 0,i._table=function(t,e,n,i){if("linear"===i||!t.length)return[{time:e,pos:0},{time:n,pos:1}];var a,r,o,s,l,u=[],d=[e];for(a=0,r=t.length;a<r;++a)(s=t[a])>e&&s<n&&d.push(s);for(d.push(n),a=0,r=d.length;a<r;++a)l=d[a+1],o=d[a-1],s=d[a],void 0!==o&&void 0!==l&&Math.round((l+o)/2)===s||u.push({time:s,pos:a/(r-1)});return u}(i._timestamps.data,a,r,f),i._offsets=function(t,e,n,i,a){var r,o,s=0,l=0;return a.offset&&e.length&&(r=si(t,"time",e[0],"pos"),s=1===e.length?1-r:(si(t,"time",e[1],"pos")-r)/2,o=si(t,"time",e[e.length-1],"pos"),l=1===e.length?o:(o-si(t,"time",e[e.length-2],"pos"))/2),{start:s,end:l,factor:1/(s+1+l)}}(i._table,d,0,0,o),s.reverse&&d.reverse(),hi(i,d,i._majorUnit)},getLabelForIndex:function(t,e){var n=this,i=n._adapter,a=n.chart.data,r=n.options.time,o=a.labels&&t<a.labels.length?a.labels[t]:"",s=a.datasets[e].data[t];return B.isObject(s)&&(o=n.getRightValue(s)),r.tooltipFormat?i.format(li(n,o),r.tooltipFormat):"string"==typeof o?o:i.format(li(n,o),r.displayFormats.datetime)},tickFormatFunction:function(t,e,n,i){var a=this._adapter,r=this.options,o=r.time.displayFormats,s=o[this._unit],l=this._majorUnit,u=o[l],d=n[e],h=r.ticks,c=l&&u&&d&&d.major,f=a.format(t,i||(c?u:s)),g=c?h.major:h.minor,m=Jn([g.callback,g.userCallback,h.callback,h.userCallback]);return m?m(f,e,n):f},convertTicksToLabels:function(t){var e,n,i=[];for(e=0,n=t.length;e<n;++e)i.push(this.tickFormatFunction(t[e].value,e,t));return i},getPixelForOffset:function(t){var e=this._offsets,n=si(this._table,"time",t,"pos");return this.getPixelForDecimal((e.start+n)*e.factor)},getPixelForValue:function(t,e,n){var i=null;if(void 0!==e&&void 0!==n&&(i=this._timestamps.datasets[n][e]),null===i&&(i=ui(this,t)),null!==i)return this.getPixelForOffset(i)},getPixelForTick:function(t){var e=this.getTicks();return t>=0&&t<e.length?this.getPixelForOffset(e[t].value):null},getValueForPixel:function(t){var e=this._offsets,n=this.getDecimalForPixel(t)/e.factor-e.end,i=si(this._table,"pos",n,"time");return this._adapter._create(i)},_getLabelSize:function(t){var e=this.options.ticks,n=this.ctx.measureText(t).width,i=B.toRadians(this.isHorizontal()?e.maxRotation:e.minRotation),a=Math.cos(i),r=Math.sin(i),o=Qn(e.fontSize,Y.global.defaultFontSize);return{w:n*a+o*r,h:n*r+o*a}},getLabelWidth:function(t){return this._getLabelSize(t).w},getLabelCapacity:function(t){var e=this,n=e.options.time,i=n.displayFormats,a=i[n.unit]||i.millisecond,r=e.tickFormatFunction(t,0,hi(e,[t],e._majorUnit),a),o=e._getLabelSize(r),s=Math.floor(e.isHorizontal()?e.width/o.w:e.height/o.h);return e.options.offset&&s--,s>0?s:1}}),fi={position:"bottom",distribution:"linear",bounds:"data",adapters:{},time:{parser:!1,unit:!1,round:!1,displayFormat:!1,isoWeekday:!1,minUnit:"millisecond",displayFormats:{}},ticks:{autoSkip:!1,source:"auto",major:{enabled:!1}}};ci._defaults=fi;var gi={category:kn,linear:An,logarithmic:Wn,radialLinear:$n,time:ci},mi=e((function(e,n){e.exports=function(){var n,i;function a(){return n.apply(null,arguments)}function r(t){return t instanceof Array||"[object Array]"===Object.prototype.toString.call(t)}function o(t){return null!=t&&"[object Object]"===Object.prototype.toString.call(t)}function s(t){return void 0===t}function l(t){return"number"==typeof t||"[object Number]"===Object.prototype.toString.call(t)}function u(t){return t instanceof Date||"[object Date]"===Object.prototype.toString.call(t)}function d(t,e){var n,i=[];for(n=0;n<t.length;++n)i.push(e(t[n],n));return i}function h(t,e){return Object.prototype.hasOwnProperty.call(t,e)}function c(t,e){for(var n in e)h(e,n)&&(t[n]=e[n]);return h(e,"toString")&&(t.toString=e.toString),h(e,"valueOf")&&(t.valueOf=e.valueOf),t}function f(t,e,n,i){return Ie(t,e,n,i,!0).utc()}function g(t){return null==t._pf&&(t._pf={empty:!1,unusedTokens:[],unusedInput:[],overflow:-2,charsLeftOver:0,nullInput:!1,invalidMonth:null,invalidFormat:!1,userInvalidated:!1,iso:!1,parsedDateParts:[],meridiem:null,rfc2822:!1,weekdayMismatch:!1}),t._pf}function m(t){if(null==t._isValid){var e=g(t),n=i.call(e.parsedDateParts,(function(t){return null!=t})),a=!isNaN(t._d.getTime())&&e.overflow<0&&!e.empty&&!e.invalidMonth&&!e.invalidWeekday&&!e.weekdayMismatch&&!e.nullInput&&!e.invalidFormat&&!e.userInvalidated&&(!e.meridiem||e.meridiem&&n);if(t._strict&&(a=a&&0===e.charsLeftOver&&0===e.unusedTokens.length&&void 0===e.bigHour),null!=Object.isFrozen&&Object.isFrozen(t))return a;t._isValid=a}return t._isValid}function p(t){var e=f(NaN);return null!=t?c(g(e),t):g(e).userInvalidated=!0,e}i=Array.prototype.some?Array.prototype.some:function(t){for(var e=Object(this),n=e.length>>>0,i=0;i<n;i++)if(i in e&&t.call(this,e[i],i,e))return!0;return!1};var v=a.momentProperties=[];function b(t,e){var n,i,a;if(s(e._isAMomentObject)||(t._isAMomentObject=e._isAMomentObject),s(e._i)||(t._i=e._i),s(e._f)||(t._f=e._f),s(e._l)||(t._l=e._l),s(e._strict)||(t._strict=e._strict),s(e._tzm)||(t._tzm=e._tzm),s(e._isUTC)||(t._isUTC=e._isUTC),s(e._offset)||(t._offset=e._offset),s(e._pf)||(t._pf=g(e)),s(e._locale)||(t._locale=e._locale),v.length>0)for(n=0;n<v.length;n++)s(a=e[i=v[n]])||(t[i]=a);return t}var y=!1;function x(t){b(this,t),this._d=new Date(null!=t._d?t._d.getTime():NaN),this.isValid()||(this._d=new Date(NaN)),!1===y&&(y=!0,a.updateOffset(this),y=!1)}function _(t){return t instanceof x||null!=t&&null!=t._isAMomentObject}function w(t){return t<0?Math.ceil(t)||0:Math.floor(t)}function k(t){var e=+t,n=0;return 0!==e&&isFinite(e)&&(n=w(e)),n}function M(t,e,n){var i,a=Math.min(t.length,e.length),r=Math.abs(t.length-e.length),o=0;for(i=0;i<a;i++)(n&&t[i]!==e[i]||!n&&k(t[i])!==k(e[i]))&&o++;return o+r}function S(t){!1===a.suppressDeprecationWarnings&&"undefined"!=typeof console&&console.warn&&console.warn("Deprecation warning: "+t)}function D(t,e){var n=!0;return c((function(){if(null!=a.deprecationHandler&&a.deprecationHandler(null,t),n){for(var i,r=[],o=0;o<arguments.length;o++){if(i="","object"==typeof arguments[o]){for(var s in i+="\n["+o+"] ",arguments[0])i+=s+": "+arguments[0][s]+", ";i=i.slice(0,-2)}else i=arguments[o];r.push(i)}S(t+"\nArguments: "+Array.prototype.slice.call(r).join("")+"\n"+(new Error).stack),n=!1}return e.apply(this,arguments)}),e)}var C,P={};function T(t,e){null!=a.deprecationHandler&&a.deprecationHandler(t,e),P[t]||(S(e),P[t]=!0)}function O(t){return t instanceof Function||"[object Function]"===Object.prototype.toString.call(t)}function A(t,e){var n,i=c({},t);for(n in e)h(e,n)&&(o(t[n])&&o(e[n])?(i[n]={},c(i[n],t[n]),c(i[n],e[n])):null!=e[n]?i[n]=e[n]:delete i[n]);for(n in t)h(t,n)&&!h(e,n)&&o(t[n])&&(i[n]=c({},i[n]));return i}function F(t){null!=t&&this.set(t)}a.suppressDeprecationWarnings=!1,a.deprecationHandler=null,C=Object.keys?Object.keys:function(t){var e,n=[];for(e in t)h(t,e)&&n.push(e);return n};var I={};function L(t,e){var n=t.toLowerCase();I[n]=I[n+"s"]=I[e]=t}function R(t){return"string"==typeof t?I[t]||I[t.toLowerCase()]:void 0}function N(t){var e,n,i={};for(n in t)h(t,n)&&(e=R(n))&&(i[e]=t[n]);return i}var W={};function Y(t,e){W[t]=e}function z(t,e,n){var i=""+Math.abs(t),a=e-i.length;return(t>=0?n?"+":"":"-")+Math.pow(10,Math.max(0,a)).toString().substr(1)+i}var E=/(\[[^\[]*\])|(\\)?([Hh]mm(ss)?|Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Qo?|YYYYYY|YYYYY|YYYY|YY|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|kk?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|.)/g,V=/(\[[^\[]*\])|(\\)?(LTS|LT|LL?L?L?|l{1,4})/g,H={},B={};function j(t,e,n,i){var a=i;"string"==typeof i&&(a=function(){return this[i]()}),t&&(B[t]=a),e&&(B[e[0]]=function(){return z(a.apply(this,arguments),e[1],e[2])}),n&&(B[n]=function(){return this.localeData().ordinal(a.apply(this,arguments),t)})}function U(t,e){return t.isValid()?(e=G(e,t.localeData()),H[e]=H[e]||function(t){var e,n,i,a=t.match(E);for(e=0,n=a.length;e<n;e++)B[a[e]]?a[e]=B[a[e]]:a[e]=(i=a[e]).match(/\[[\s\S]/)?i.replace(/^\[|\]$/g,""):i.replace(/\\/g,"");return function(e){var i,r="";for(i=0;i<n;i++)r+=O(a[i])?a[i].call(e,t):a[i];return r}}(e),H[e](t)):t.localeData().invalidDate()}function G(t,e){var n=5;function i(t){return e.longDateFormat(t)||t}for(V.lastIndex=0;n>=0&&V.test(t);)t=t.replace(V,i),V.lastIndex=0,n-=1;return t}var q=/\d/,Z=/\d\d/,$=/\d{3}/,X=/\d{4}/,K=/[+-]?\d{6}/,J=/\d\d?/,Q=/\d\d\d\d?/,tt=/\d\d\d\d\d\d?/,et=/\d{1,3}/,nt=/\d{1,4}/,it=/[+-]?\d{1,6}/,at=/\d+/,rt=/[+-]?\d+/,ot=/Z|[+-]\d\d:?\d\d/gi,st=/Z|[+-]\d\d(?::?\d\d)?/gi,lt=/[0-9]{0,256}['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFF07\uFF10-\uFFEF]{1,256}|[\u0600-\u06FF\/]{1,256}(\s*?[\u0600-\u06FF]{1,256}){1,2}/i,ut={};function dt(t,e,n){ut[t]=O(e)?e:function(t,i){return t&&n?n:e}}function ht(t,e){return h(ut,t)?ut[t](e._strict,e._locale):new RegExp(ct(t.replace("\\","").replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g,(function(t,e,n,i,a){return e||n||i||a}))))}function ct(t){return t.replace(/[-\/\\^$*+?.()|[\]{}]/g,"\\$&")}var ft={};function gt(t,e){var n,i=e;for("string"==typeof t&&(t=[t]),l(e)&&(i=function(t,n){n[e]=k(t)}),n=0;n<t.length;n++)ft[t[n]]=i}function mt(t,e){gt(t,(function(t,n,i,a){i._w=i._w||{},e(t,i._w,i,a)}))}function pt(t,e,n){null!=e&&h(ft,t)&&ft[t](e,n._a,n,t)}var vt=0,bt=1,yt=2,xt=3,_t=4,wt=5,kt=6,Mt=7,St=8;function Dt(t){return Ct(t)?366:365}function Ct(t){return t%4==0&&t%100!=0||t%400==0}j("Y",0,0,(function(){var t=this.year();return t<=9999?""+t:"+"+t})),j(0,["YY",2],0,(function(){return this.year()%100})),j(0,["YYYY",4],0,"year"),j(0,["YYYYY",5],0,"year"),j(0,["YYYYYY",6,!0],0,"year"),L("year","y"),Y("year",1),dt("Y",rt),dt("YY",J,Z),dt("YYYY",nt,X),dt("YYYYY",it,K),dt("YYYYYY",it,K),gt(["YYYYY","YYYYYY"],vt),gt("YYYY",(function(t,e){e[vt]=2===t.length?a.parseTwoDigitYear(t):k(t)})),gt("YY",(function(t,e){e[vt]=a.parseTwoDigitYear(t)})),gt("Y",(function(t,e){e[vt]=parseInt(t,10)})),a.parseTwoDigitYear=function(t){return k(t)+(k(t)>68?1900:2e3)};var Pt,Tt=Ot("FullYear",!0);function Ot(t,e){return function(n){return null!=n?(Ft(this,t,n),a.updateOffset(this,e),this):At(this,t)}}function At(t,e){return t.isValid()?t._d["get"+(t._isUTC?"UTC":"")+e]():NaN}function Ft(t,e,n){t.isValid()&&!isNaN(n)&&("FullYear"===e&&Ct(t.year())&&1===t.month()&&29===t.date()?t._d["set"+(t._isUTC?"UTC":"")+e](n,t.month(),It(n,t.month())):t._d["set"+(t._isUTC?"UTC":"")+e](n))}function It(t,e){if(isNaN(t)||isNaN(e))return NaN;var n=function(t,e){return(t%e+e)%e}(e,12);return t+=(e-n)/12,1===n?Ct(t)?29:28:31-n%7%2}Pt=Array.prototype.indexOf?Array.prototype.indexOf:function(t){var e;for(e=0;e<this.length;++e)if(this[e]===t)return e;return-1},j("M",["MM",2],"Mo",(function(){return this.month()+1})),j("MMM",0,0,(function(t){return this.localeData().monthsShort(this,t)})),j("MMMM",0,0,(function(t){return this.localeData().months(this,t)})),L("month","M"),Y("month",8),dt("M",J),dt("MM",J,Z),dt("MMM",(function(t,e){return e.monthsShortRegex(t)})),dt("MMMM",(function(t,e){return e.monthsRegex(t)})),gt(["M","MM"],(function(t,e){e[bt]=k(t)-1})),gt(["MMM","MMMM"],(function(t,e,n,i){var a=n._locale.monthsParse(t,i,n._strict);null!=a?e[bt]=a:g(n).invalidMonth=t}));var Lt=/D[oD]?(\[[^\[\]]*\]|\s)+MMMM?/,Rt="January_February_March_April_May_June_July_August_September_October_November_December".split("_"),Nt="Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_");function Wt(t,e,n){var i,a,r,o=t.toLocaleLowerCase();if(!this._monthsParse)for(this._monthsParse=[],this._longMonthsParse=[],this._shortMonthsParse=[],i=0;i<12;++i)r=f([2e3,i]),this._shortMonthsParse[i]=this.monthsShort(r,"").toLocaleLowerCase(),this._longMonthsParse[i]=this.months(r,"").toLocaleLowerCase();return n?"MMM"===e?-1!==(a=Pt.call(this._shortMonthsParse,o))?a:null:-1!==(a=Pt.call(this._longMonthsParse,o))?a:null:"MMM"===e?-1!==(a=Pt.call(this._shortMonthsParse,o))?a:-1!==(a=Pt.call(this._longMonthsParse,o))?a:null:-1!==(a=Pt.call(this._longMonthsParse,o))?a:-1!==(a=Pt.call(this._shortMonthsParse,o))?a:null}function Yt(t,e){var n;if(!t.isValid())return t;if("string"==typeof e)if(/^\d+$/.test(e))e=k(e);else if(!l(e=t.localeData().monthsParse(e)))return t;return n=Math.min(t.date(),It(t.year(),e)),t._d["set"+(t._isUTC?"UTC":"")+"Month"](e,n),t}function zt(t){return null!=t?(Yt(this,t),a.updateOffset(this,!0),this):At(this,"Month")}var Et=lt,Vt=lt;function Ht(){function t(t,e){return e.length-t.length}var e,n,i=[],a=[],r=[];for(e=0;e<12;e++)n=f([2e3,e]),i.push(this.monthsShort(n,"")),a.push(this.months(n,"")),r.push(this.months(n,"")),r.push(this.monthsShort(n,""));for(i.sort(t),a.sort(t),r.sort(t),e=0;e<12;e++)i[e]=ct(i[e]),a[e]=ct(a[e]);for(e=0;e<24;e++)r[e]=ct(r[e]);this._monthsRegex=new RegExp("^("+r.join("|")+")","i"),this._monthsShortRegex=this._monthsRegex,this._monthsStrictRegex=new RegExp("^("+a.join("|")+")","i"),this._monthsShortStrictRegex=new RegExp("^("+i.join("|")+")","i")}function Bt(t,e,n,i,a,r,o){var s;return t<100&&t>=0?(s=new Date(t+400,e,n,i,a,r,o),isFinite(s.getFullYear())&&s.setFullYear(t)):s=new Date(t,e,n,i,a,r,o),s}function jt(t){var e;if(t<100&&t>=0){var n=Array.prototype.slice.call(arguments);n[0]=t+400,e=new Date(Date.UTC.apply(null,n)),isFinite(e.getUTCFullYear())&&e.setUTCFullYear(t)}else e=new Date(Date.UTC.apply(null,arguments));return e}function Ut(t,e,n){var i=7+e-n;return-(7+jt(t,0,i).getUTCDay()-e)%7+i-1}function Gt(t,e,n,i,a){var r,o,s=1+7*(e-1)+(7+n-i)%7+Ut(t,i,a);return s<=0?o=Dt(r=t-1)+s:s>Dt(t)?(r=t+1,o=s-Dt(t)):(r=t,o=s),{year:r,dayOfYear:o}}function qt(t,e,n){var i,a,r=Ut(t.year(),e,n),o=Math.floor((t.dayOfYear()-r-1)/7)+1;return o<1?i=o+Zt(a=t.year()-1,e,n):o>Zt(t.year(),e,n)?(i=o-Zt(t.year(),e,n),a=t.year()+1):(a=t.year(),i=o),{week:i,year:a}}function Zt(t,e,n){var i=Ut(t,e,n),a=Ut(t+1,e,n);return(Dt(t)-i+a)/7}function $t(t,e){return t.slice(e,7).concat(t.slice(0,e))}j("w",["ww",2],"wo","week"),j("W",["WW",2],"Wo","isoWeek"),L("week","w"),L("isoWeek","W"),Y("week",5),Y("isoWeek",5),dt("w",J),dt("ww",J,Z),dt("W",J),dt("WW",J,Z),mt(["w","ww","W","WW"],(function(t,e,n,i){e[i.substr(0,1)]=k(t)})),j("d",0,"do","day"),j("dd",0,0,(function(t){return this.localeData().weekdaysMin(this,t)})),j("ddd",0,0,(function(t){return this.localeData().weekdaysShort(this,t)})),j("dddd",0,0,(function(t){return this.localeData().weekdays(this,t)})),j("e",0,0,"weekday"),j("E",0,0,"isoWeekday"),L("day","d"),L("weekday","e"),L("isoWeekday","E"),Y("day",11),Y("weekday",11),Y("isoWeekday",11),dt("d",J),dt("e",J),dt("E",J),dt("dd",(function(t,e){return e.weekdaysMinRegex(t)})),dt("ddd",(function(t,e){return e.weekdaysShortRegex(t)})),dt("dddd",(function(t,e){return e.weekdaysRegex(t)})),mt(["dd","ddd","dddd"],(function(t,e,n,i){var a=n._locale.weekdaysParse(t,i,n._strict);null!=a?e.d=a:g(n).invalidWeekday=t})),mt(["d","e","E"],(function(t,e,n,i){e[i]=k(t)}));var Xt="Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),Kt="Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),Jt="Su_Mo_Tu_We_Th_Fr_Sa".split("_");function Qt(t,e,n){var i,a,r,o=t.toLocaleLowerCase();if(!this._weekdaysParse)for(this._weekdaysParse=[],this._shortWeekdaysParse=[],this._minWeekdaysParse=[],i=0;i<7;++i)r=f([2e3,1]).day(i),this._minWeekdaysParse[i]=this.weekdaysMin(r,"").toLocaleLowerCase(),this._shortWeekdaysParse[i]=this.weekdaysShort(r,"").toLocaleLowerCase(),this._weekdaysParse[i]=this.weekdays(r,"").toLocaleLowerCase();return n?"dddd"===e?-1!==(a=Pt.call(this._weekdaysParse,o))?a:null:"ddd"===e?-1!==(a=Pt.call(this._shortWeekdaysParse,o))?a:null:-1!==(a=Pt.call(this._minWeekdaysParse,o))?a:null:"dddd"===e?-1!==(a=Pt.call(this._weekdaysParse,o))?a:-1!==(a=Pt.call(this._shortWeekdaysParse,o))?a:-1!==(a=Pt.call(this._minWeekdaysParse,o))?a:null:"ddd"===e?-1!==(a=Pt.call(this._shortWeekdaysParse,o))?a:-1!==(a=Pt.call(this._weekdaysParse,o))?a:-1!==(a=Pt.call(this._minWeekdaysParse,o))?a:null:-1!==(a=Pt.call(this._minWeekdaysParse,o))?a:-1!==(a=Pt.call(this._weekdaysParse,o))?a:-1!==(a=Pt.call(this._shortWeekdaysParse,o))?a:null}var te=lt,ee=lt,ne=lt;function ie(){function t(t,e){return e.length-t.length}var e,n,i,a,r,o=[],s=[],l=[],u=[];for(e=0;e<7;e++)n=f([2e3,1]).day(e),i=this.weekdaysMin(n,""),a=this.weekdaysShort(n,""),r=this.weekdays(n,""),o.push(i),s.push(a),l.push(r),u.push(i),u.push(a),u.push(r);for(o.sort(t),s.sort(t),l.sort(t),u.sort(t),e=0;e<7;e++)s[e]=ct(s[e]),l[e]=ct(l[e]),u[e]=ct(u[e]);this._weekdaysRegex=new RegExp("^("+u.join("|")+")","i"),this._weekdaysShortRegex=this._weekdaysRegex,this._weekdaysMinRegex=this._weekdaysRegex,this._weekdaysStrictRegex=new RegExp("^("+l.join("|")+")","i"),this._weekdaysShortStrictRegex=new RegExp("^("+s.join("|")+")","i"),this._weekdaysMinStrictRegex=new RegExp("^("+o.join("|")+")","i")}function ae(){return this.hours()%12||12}function re(t,e){j(t,0,0,(function(){return this.localeData().meridiem(this.hours(),this.minutes(),e)}))}function oe(t,e){return e._meridiemParse}j("H",["HH",2],0,"hour"),j("h",["hh",2],0,ae),j("k",["kk",2],0,(function(){return this.hours()||24})),j("hmm",0,0,(function(){return""+ae.apply(this)+z(this.minutes(),2)})),j("hmmss",0,0,(function(){return""+ae.apply(this)+z(this.minutes(),2)+z(this.seconds(),2)})),j("Hmm",0,0,(function(){return""+this.hours()+z(this.minutes(),2)})),j("Hmmss",0,0,(function(){return""+this.hours()+z(this.minutes(),2)+z(this.seconds(),2)})),re("a",!0),re("A",!1),L("hour","h"),Y("hour",13),dt("a",oe),dt("A",oe),dt("H",J),dt("h",J),dt("k",J),dt("HH",J,Z),dt("hh",J,Z),dt("kk",J,Z),dt("hmm",Q),dt("hmmss",tt),dt("Hmm",Q),dt("Hmmss",tt),gt(["H","HH"],xt),gt(["k","kk"],(function(t,e,n){var i=k(t);e[xt]=24===i?0:i})),gt(["a","A"],(function(t,e,n){n._isPm=n._locale.isPM(t),n._meridiem=t})),gt(["h","hh"],(function(t,e,n){e[xt]=k(t),g(n).bigHour=!0})),gt("hmm",(function(t,e,n){var i=t.length-2;e[xt]=k(t.substr(0,i)),e[_t]=k(t.substr(i)),g(n).bigHour=!0})),gt("hmmss",(function(t,e,n){var i=t.length-4,a=t.length-2;e[xt]=k(t.substr(0,i)),e[_t]=k(t.substr(i,2)),e[wt]=k(t.substr(a)),g(n).bigHour=!0})),gt("Hmm",(function(t,e,n){var i=t.length-2;e[xt]=k(t.substr(0,i)),e[_t]=k(t.substr(i))})),gt("Hmmss",(function(t,e,n){var i=t.length-4,a=t.length-2;e[xt]=k(t.substr(0,i)),e[_t]=k(t.substr(i,2)),e[wt]=k(t.substr(a))}));var se,le=Ot("Hours",!0),ue={calendar:{sameDay:"[Today at] LT",nextDay:"[Tomorrow at] LT",nextWeek:"dddd [at] LT",lastDay:"[Yesterday at] LT",lastWeek:"[Last] dddd [at] LT",sameElse:"L"},longDateFormat:{LTS:"h:mm:ss A",LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY h:mm A",LLLL:"dddd, MMMM D, YYYY h:mm A"},invalidDate:"Invalid date",ordinal:"%d",dayOfMonthOrdinalParse:/\d{1,2}/,relativeTime:{future:"in %s",past:"%s ago",s:"a few seconds",ss:"%d seconds",m:"a minute",mm:"%d minutes",h:"an hour",hh:"%d hours",d:"a day",dd:"%d days",M:"a month",MM:"%d months",y:"a year",yy:"%d years"},months:Rt,monthsShort:Nt,week:{dow:0,doy:6},weekdays:Xt,weekdaysMin:Jt,weekdaysShort:Kt,meridiemParse:/[ap]\.?m?\.?/i},de={},he={};function ce(t){return t?t.toLowerCase().replace("_","-"):t}function fe(n){var i=null;if(!de[n]&&e&&e.exports)try{i=se._abbr,t(),ge(i)}catch(t){}return de[n]}function ge(t,e){var n;return t&&((n=s(e)?pe(t):me(t,e))?se=n:"undefined"!=typeof console&&console.warn&&console.warn("Locale "+t+" not found. Did you forget to load it?")),se._abbr}function me(t,e){if(null!==e){var n,i=ue;if(e.abbr=t,null!=de[t])T("defineLocaleOverride","use moment.updateLocale(localeName, config) to change an existing locale. moment.defineLocale(localeName, config) should only be used for creating a new locale See http://momentjs.com/guides/#/warnings/define-locale/ for more info."),i=de[t]._config;else if(null!=e.parentLocale)if(null!=de[e.parentLocale])i=de[e.parentLocale]._config;else{if(null==(n=fe(e.parentLocale)))return he[e.parentLocale]||(he[e.parentLocale]=[]),he[e.parentLocale].push({name:t,config:e}),null;i=n._config}return de[t]=new F(A(i,e)),he[t]&&he[t].forEach((function(t){me(t.name,t.config)})),ge(t),de[t]}return delete de[t],null}function pe(t){var e;if(t&&t._locale&&t._locale._abbr&&(t=t._locale._abbr),!t)return se;if(!r(t)){if(e=fe(t))return e;t=[t]}return function(t){for(var e,n,i,a,r=0;r<t.length;){for(e=(a=ce(t[r]).split("-")).length,n=(n=ce(t[r+1]))?n.split("-"):null;e>0;){if(i=fe(a.slice(0,e).join("-")))return i;if(n&&n.length>=e&&M(a,n,!0)>=e-1)break;e--}r++}return se}(t)}function ve(t){var e,n=t._a;return n&&-2===g(t).overflow&&(e=n[bt]<0||n[bt]>11?bt:n[yt]<1||n[yt]>It(n[vt],n[bt])?yt:n[xt]<0||n[xt]>24||24===n[xt]&&(0!==n[_t]||0!==n[wt]||0!==n[kt])?xt:n[_t]<0||n[_t]>59?_t:n[wt]<0||n[wt]>59?wt:n[kt]<0||n[kt]>999?kt:-1,g(t)._overflowDayOfYear&&(e<vt||e>yt)&&(e=yt),g(t)._overflowWeeks&&-1===e&&(e=Mt),g(t)._overflowWeekday&&-1===e&&(e=St),g(t).overflow=e),t}function be(t,e,n){return null!=t?t:null!=e?e:n}function ye(t){var e,n,i,r,o,s=[];if(!t._d){for(i=function(t){var e=new Date(a.now());return t._useUTC?[e.getUTCFullYear(),e.getUTCMonth(),e.getUTCDate()]:[e.getFullYear(),e.getMonth(),e.getDate()]}(t),t._w&&null==t._a[yt]&&null==t._a[bt]&&function(t){var e,n,i,a,r,o,s,l;if(null!=(e=t._w).GG||null!=e.W||null!=e.E)r=1,o=4,n=be(e.GG,t._a[vt],qt(Le(),1,4).year),i=be(e.W,1),((a=be(e.E,1))<1||a>7)&&(l=!0);else{r=t._locale._week.dow,o=t._locale._week.doy;var u=qt(Le(),r,o);n=be(e.gg,t._a[vt],u.year),i=be(e.w,u.week),null!=e.d?((a=e.d)<0||a>6)&&(l=!0):null!=e.e?(a=e.e+r,(e.e<0||e.e>6)&&(l=!0)):a=r}i<1||i>Zt(n,r,o)?g(t)._overflowWeeks=!0:null!=l?g(t)._overflowWeekday=!0:(s=Gt(n,i,a,r,o),t._a[vt]=s.year,t._dayOfYear=s.dayOfYear)}(t),null!=t._dayOfYear&&(o=be(t._a[vt],i[vt]),(t._dayOfYear>Dt(o)||0===t._dayOfYear)&&(g(t)._overflowDayOfYear=!0),n=jt(o,0,t._dayOfYear),t._a[bt]=n.getUTCMonth(),t._a[yt]=n.getUTCDate()),e=0;e<3&&null==t._a[e];++e)t._a[e]=s[e]=i[e];for(;e<7;e++)t._a[e]=s[e]=null==t._a[e]?2===e?1:0:t._a[e];24===t._a[xt]&&0===t._a[_t]&&0===t._a[wt]&&0===t._a[kt]&&(t._nextDay=!0,t._a[xt]=0),t._d=(t._useUTC?jt:Bt).apply(null,s),r=t._useUTC?t._d.getUTCDay():t._d.getDay(),null!=t._tzm&&t._d.setUTCMinutes(t._d.getUTCMinutes()-t._tzm),t._nextDay&&(t._a[xt]=24),t._w&&void 0!==t._w.d&&t._w.d!==r&&(g(t).weekdayMismatch=!0)}}var xe=/^\s*((?:[+-]\d{6}|\d{4})-(?:\d\d-\d\d|W\d\d-\d|W\d\d|\d\d\d|\d\d))(?:(T| )(\d\d(?::\d\d(?::\d\d(?:[.,]\d+)?)?)?)([\+\-]\d\d(?::?\d\d)?|\s*Z)?)?$/,_e=/^\s*((?:[+-]\d{6}|\d{4})(?:\d\d\d\d|W\d\d\d|W\d\d|\d\d\d|\d\d))(?:(T| )(\d\d(?:\d\d(?:\d\d(?:[.,]\d+)?)?)?)([\+\-]\d\d(?::?\d\d)?|\s*Z)?)?$/,we=/Z|[+-]\d\d(?::?\d\d)?/,ke=[["YYYYYY-MM-DD",/[+-]\d{6}-\d\d-\d\d/],["YYYY-MM-DD",/\d{4}-\d\d-\d\d/],["GGGG-[W]WW-E",/\d{4}-W\d\d-\d/],["GGGG-[W]WW",/\d{4}-W\d\d/,!1],["YYYY-DDD",/\d{4}-\d{3}/],["YYYY-MM",/\d{4}-\d\d/,!1],["YYYYYYMMDD",/[+-]\d{10}/],["YYYYMMDD",/\d{8}/],["GGGG[W]WWE",/\d{4}W\d{3}/],["GGGG[W]WW",/\d{4}W\d{2}/,!1],["YYYYDDD",/\d{7}/]],Me=[["HH:mm:ss.SSSS",/\d\d:\d\d:\d\d\.\d+/],["HH:mm:ss,SSSS",/\d\d:\d\d:\d\d,\d+/],["HH:mm:ss",/\d\d:\d\d:\d\d/],["HH:mm",/\d\d:\d\d/],["HHmmss.SSSS",/\d\d\d\d\d\d\.\d+/],["HHmmss,SSSS",/\d\d\d\d\d\d,\d+/],["HHmmss",/\d\d\d\d\d\d/],["HHmm",/\d\d\d\d/],["HH",/\d\d/]],Se=/^\/?Date\((\-?\d+)/i;function De(t){var e,n,i,a,r,o,s=t._i,l=xe.exec(s)||_e.exec(s);if(l){for(g(t).iso=!0,e=0,n=ke.length;e<n;e++)if(ke[e][1].exec(l[1])){a=ke[e][0],i=!1!==ke[e][2];break}if(null==a)return void(t._isValid=!1);if(l[3]){for(e=0,n=Me.length;e<n;e++)if(Me[e][1].exec(l[3])){r=(l[2]||" ")+Me[e][0];break}if(null==r)return void(t._isValid=!1)}if(!i&&null!=r)return void(t._isValid=!1);if(l[4]){if(!we.exec(l[4]))return void(t._isValid=!1);o="Z"}t._f=a+(r||"")+(o||""),Ae(t)}else t._isValid=!1}var Ce=/^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|([+-]\d{4}))$/;function Pe(t){var e=parseInt(t,10);return e<=49?2e3+e:e<=999?1900+e:e}var Te={UT:0,GMT:0,EDT:-240,EST:-300,CDT:-300,CST:-360,MDT:-360,MST:-420,PDT:-420,PST:-480};function Oe(t){var e,n,i,a,r,o,s,l=Ce.exec(t._i.replace(/\([^)]*\)|[\n\t]/g," ").replace(/(\s\s+)/g," ").replace(/^\s\s*/,"").replace(/\s\s*$/,""));if(l){var u=(e=l[4],n=l[3],i=l[2],a=l[5],r=l[6],o=l[7],s=[Pe(e),Nt.indexOf(n),parseInt(i,10),parseInt(a,10),parseInt(r,10)],o&&s.push(parseInt(o,10)),s);if(!function(t,e,n){return!t||Kt.indexOf(t)===new Date(e[0],e[1],e[2]).getDay()||(g(n).weekdayMismatch=!0,n._isValid=!1,!1)}(l[1],u,t))return;t._a=u,t._tzm=function(t,e,n){if(t)return Te[t];if(e)return 0;var i=parseInt(n,10),a=i%100;return(i-a)/100*60+a}(l[8],l[9],l[10]),t._d=jt.apply(null,t._a),t._d.setUTCMinutes(t._d.getUTCMinutes()-t._tzm),g(t).rfc2822=!0}else t._isValid=!1}function Ae(t){if(t._f!==a.ISO_8601)if(t._f!==a.RFC_2822){t._a=[],g(t).empty=!0;var e,n,i,r,o,s=""+t._i,l=s.length,u=0;for(i=G(t._f,t._locale).match(E)||[],e=0;e<i.length;e++)r=i[e],(n=(s.match(ht(r,t))||[])[0])&&((o=s.substr(0,s.indexOf(n))).length>0&&g(t).unusedInput.push(o),s=s.slice(s.indexOf(n)+n.length),u+=n.length),B[r]?(n?g(t).empty=!1:g(t).unusedTokens.push(r),pt(r,n,t)):t._strict&&!n&&g(t).unusedTokens.push(r);g(t).charsLeftOver=l-u,s.length>0&&g(t).unusedInput.push(s),t._a[xt]<=12&&!0===g(t).bigHour&&t._a[xt]>0&&(g(t).bigHour=void 0),g(t).parsedDateParts=t._a.slice(0),g(t).meridiem=t._meridiem,t._a[xt]=function(t,e,n){var i;return null==n?e:null!=t.meridiemHour?t.meridiemHour(e,n):null!=t.isPM?((i=t.isPM(n))&&e<12&&(e+=12),i||12!==e||(e=0),e):e}(t._locale,t._a[xt],t._meridiem),ye(t),ve(t)}else Oe(t);else De(t)}function Fe(t){var e=t._i,n=t._f;return t._locale=t._locale||pe(t._l),null===e||void 0===n&&""===e?p({nullInput:!0}):("string"==typeof e&&(t._i=e=t._locale.preparse(e)),_(e)?new x(ve(e)):(u(e)?t._d=e:r(n)?function(t){var e,n,i,a,r;if(0===t._f.length)return g(t).invalidFormat=!0,void(t._d=new Date(NaN));for(a=0;a<t._f.length;a++)r=0,e=b({},t),null!=t._useUTC&&(e._useUTC=t._useUTC),e._f=t._f[a],Ae(e),m(e)&&(r+=g(e).charsLeftOver,r+=10*g(e).unusedTokens.length,g(e).score=r,(null==i||r<i)&&(i=r,n=e));c(t,n||e)}(t):n?Ae(t):function(t){var e=t._i;s(e)?t._d=new Date(a.now()):u(e)?t._d=new Date(e.valueOf()):"string"==typeof e?function(t){var e=Se.exec(t._i);null===e?(De(t),!1===t._isValid&&(delete t._isValid,Oe(t),!1===t._isValid&&(delete t._isValid,a.createFromInputFallback(t)))):t._d=new Date(+e[1])}(t):r(e)?(t._a=d(e.slice(0),(function(t){return parseInt(t,10)})),ye(t)):o(e)?function(t){if(!t._d){var e=N(t._i);t._a=d([e.year,e.month,e.day||e.date,e.hour,e.minute,e.second,e.millisecond],(function(t){return t&&parseInt(t,10)})),ye(t)}}(t):l(e)?t._d=new Date(e):a.createFromInputFallback(t)}(t),m(t)||(t._d=null),t))}function Ie(t,e,n,i,a){var s,l={};return!0!==n&&!1!==n||(i=n,n=void 0),(o(t)&&function(t){if(Object.getOwnPropertyNames)return 0===Object.getOwnPropertyNames(t).length;var e;for(e in t)if(t.hasOwnProperty(e))return!1;return!0}(t)||r(t)&&0===t.length)&&(t=void 0),l._isAMomentObject=!0,l._useUTC=l._isUTC=a,l._l=n,l._i=t,l._f=e,l._strict=i,(s=new x(ve(Fe(l))))._nextDay&&(s.add(1,"d"),s._nextDay=void 0),s}function Le(t,e,n,i){return Ie(t,e,n,i,!1)}a.createFromInputFallback=D("value provided is not in a recognized RFC2822 or ISO format. moment construction falls back to js Date(), which is not reliable across all browsers and versions. Non RFC2822/ISO date formats are discouraged and will be removed in an upcoming major release. Please refer to http://momentjs.com/guides/#/warnings/js-date/ for more info.",(function(t){t._d=new Date(t._i+(t._useUTC?" UTC":""))})),a.ISO_8601=function(){},a.RFC_2822=function(){};var Re=D("moment().min is deprecated, use moment.max instead. http://momentjs.com/guides/#/warnings/min-max/",(function(){var t=Le.apply(null,arguments);return this.isValid()&&t.isValid()?t<this?this:t:p()})),Ne=D("moment().max is deprecated, use moment.min instead. http://momentjs.com/guides/#/warnings/min-max/",(function(){var t=Le.apply(null,arguments);return this.isValid()&&t.isValid()?t>this?this:t:p()}));function We(t,e){var n,i;if(1===e.length&&r(e[0])&&(e=e[0]),!e.length)return Le();for(n=e[0],i=1;i<e.length;++i)e[i].isValid()&&!e[i][t](n)||(n=e[i]);return n}var Ye=["year","quarter","month","week","day","hour","minute","second","millisecond"];function ze(t){var e=N(t),n=e.year||0,i=e.quarter||0,a=e.month||0,r=e.week||e.isoWeek||0,o=e.day||0,s=e.hour||0,l=e.minute||0,u=e.second||0,d=e.millisecond||0;this._isValid=function(t){for(var e in t)if(-1===Pt.call(Ye,e)||null!=t[e]&&isNaN(t[e]))return!1;for(var n=!1,i=0;i<Ye.length;++i)if(t[Ye[i]]){if(n)return!1;parseFloat(t[Ye[i]])!==k(t[Ye[i]])&&(n=!0)}return!0}(e),this._milliseconds=+d+1e3*u+6e4*l+1e3*s*60*60,this._days=+o+7*r,this._months=+a+3*i+12*n,this._data={},this._locale=pe(),this._bubble()}function Ee(t){return t instanceof ze}function Ve(t){return t<0?-1*Math.round(-1*t):Math.round(t)}function He(t,e){j(t,0,0,(function(){var t=this.utcOffset(),n="+";return t<0&&(t=-t,n="-"),n+z(~~(t/60),2)+e+z(~~t%60,2)}))}He("Z",":"),He("ZZ",""),dt("Z",st),dt("ZZ",st),gt(["Z","ZZ"],(function(t,e,n){n._useUTC=!0,n._tzm=je(st,t)}));var Be=/([\+\-]|\d\d)/gi;function je(t,e){var n=(e||"").match(t);if(null===n)return null;var i=((n[n.length-1]||[])+"").match(Be)||["-",0,0],a=60*i[1]+k(i[2]);return 0===a?0:"+"===i[0]?a:-a}function Ue(t,e){var n,i;return e._isUTC?(n=e.clone(),i=(_(t)||u(t)?t.valueOf():Le(t).valueOf())-n.valueOf(),n._d.setTime(n._d.valueOf()+i),a.updateOffset(n,!1),n):Le(t).local()}function Ge(t){return 15*-Math.round(t._d.getTimezoneOffset()/15)}function qe(){return!!this.isValid()&&this._isUTC&&0===this._offset}a.updateOffset=function(){};var Ze=/^(\-|\+)?(?:(\d*)[. ])?(\d+)\:(\d+)(?:\:(\d+)(\.\d*)?)?$/,$e=/^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/;function Xe(t,e){var n,i,a,r,o,s,u=t,d=null;return Ee(t)?u={ms:t._milliseconds,d:t._days,M:t._months}:l(t)?(u={},e?u[e]=t:u.milliseconds=t):(d=Ze.exec(t))?(n="-"===d[1]?-1:1,u={y:0,d:k(d[yt])*n,h:k(d[xt])*n,m:k(d[_t])*n,s:k(d[wt])*n,ms:k(Ve(1e3*d[kt]))*n}):(d=$e.exec(t))?(n="-"===d[1]?-1:1,u={y:Ke(d[2],n),M:Ke(d[3],n),w:Ke(d[4],n),d:Ke(d[5],n),h:Ke(d[6],n),m:Ke(d[7],n),s:Ke(d[8],n)}):null==u?u={}:"object"==typeof u&&("from"in u||"to"in u)&&(r=Le(u.from),o=Le(u.to),a=r.isValid()&&o.isValid()?(o=Ue(o,r),r.isBefore(o)?s=Je(r,o):((s=Je(o,r)).milliseconds=-s.milliseconds,s.months=-s.months),s):{milliseconds:0,months:0},(u={}).ms=a.milliseconds,u.M=a.months),i=new ze(u),Ee(t)&&h(t,"_locale")&&(i._locale=t._locale),i}function Ke(t,e){var n=t&&parseFloat(t.replace(",","."));return(isNaN(n)?0:n)*e}function Je(t,e){var n={};return n.months=e.month()-t.month()+12*(e.year()-t.year()),t.clone().add(n.months,"M").isAfter(e)&&--n.months,n.milliseconds=+e-+t.clone().add(n.months,"M"),n}function Qe(t,e){return function(n,i){var a;return null===i||isNaN(+i)||(T(e,"moment()."+e+"(period, number) is deprecated. Please use moment()."+e+"(number, period). See http://momentjs.com/guides/#/warnings/add-inverted-param/ for more info."),a=n,n=i,i=a),tn(this,Xe(n="string"==typeof n?+n:n,i),t),this}}function tn(t,e,n,i){var r=e._milliseconds,o=Ve(e._days),s=Ve(e._months);t.isValid()&&(i=null==i||i,s&&Yt(t,At(t,"Month")+s*n),o&&Ft(t,"Date",At(t,"Date")+o*n),r&&t._d.setTime(t._d.valueOf()+r*n),i&&a.updateOffset(t,o||s))}Xe.fn=ze.prototype,Xe.invalid=function(){return Xe(NaN)};var en=Qe(1,"add"),nn=Qe(-1,"subtract");function an(t,e){var n=12*(e.year()-t.year())+(e.month()-t.month()),i=t.clone().add(n,"months");return-(n+(e-i<0?(e-i)/(i-t.clone().add(n-1,"months")):(e-i)/(t.clone().add(n+1,"months")-i)))||0}function rn(t){var e;return void 0===t?this._locale._abbr:(null!=(e=pe(t))&&(this._locale=e),this)}a.defaultFormat="YYYY-MM-DDTHH:mm:ssZ",a.defaultFormatUtc="YYYY-MM-DDTHH:mm:ss[Z]";var on=D("moment().lang() is deprecated. Instead, use moment().localeData() to get the language configuration. Use moment().locale() to change languages.",(function(t){return void 0===t?this.localeData():this.locale(t)}));function sn(){return this._locale}var ln=1e3,un=60*ln,dn=60*un,hn=3506328*dn;function cn(t,e){return(t%e+e)%e}function fn(t,e,n){return t<100&&t>=0?new Date(t+400,e,n)-hn:new Date(t,e,n).valueOf()}function gn(t,e,n){return t<100&&t>=0?Date.UTC(t+400,e,n)-hn:Date.UTC(t,e,n)}function mn(t,e){j(0,[t,t.length],0,e)}function pn(t,e,n,i,a){var r;return null==t?qt(this,i,a).year:(e>(r=Zt(t,i,a))&&(e=r),vn.call(this,t,e,n,i,a))}function vn(t,e,n,i,a){var r=Gt(t,e,n,i,a),o=jt(r.year,0,r.dayOfYear);return this.year(o.getUTCFullYear()),this.month(o.getUTCMonth()),this.date(o.getUTCDate()),this}j(0,["gg",2],0,(function(){return this.weekYear()%100})),j(0,["GG",2],0,(function(){return this.isoWeekYear()%100})),mn("gggg","weekYear"),mn("ggggg","weekYear"),mn("GGGG","isoWeekYear"),mn("GGGGG","isoWeekYear"),L("weekYear","gg"),L("isoWeekYear","GG"),Y("weekYear",1),Y("isoWeekYear",1),dt("G",rt),dt("g",rt),dt("GG",J,Z),dt("gg",J,Z),dt("GGGG",nt,X),dt("gggg",nt,X),dt("GGGGG",it,K),dt("ggggg",it,K),mt(["gggg","ggggg","GGGG","GGGGG"],(function(t,e,n,i){e[i.substr(0,2)]=k(t)})),mt(["gg","GG"],(function(t,e,n,i){e[i]=a.parseTwoDigitYear(t)})),j("Q",0,"Qo","quarter"),L("quarter","Q"),Y("quarter",7),dt("Q",q),gt("Q",(function(t,e){e[bt]=3*(k(t)-1)})),j("D",["DD",2],"Do","date"),L("date","D"),Y("date",9),dt("D",J),dt("DD",J,Z),dt("Do",(function(t,e){return t?e._dayOfMonthOrdinalParse||e._ordinalParse:e._dayOfMonthOrdinalParseLenient})),gt(["D","DD"],yt),gt("Do",(function(t,e){e[yt]=k(t.match(J)[0])}));var bn=Ot("Date",!0);j("DDD",["DDDD",3],"DDDo","dayOfYear"),L("dayOfYear","DDD"),Y("dayOfYear",4),dt("DDD",et),dt("DDDD",$),gt(["DDD","DDDD"],(function(t,e,n){n._dayOfYear=k(t)})),j("m",["mm",2],0,"minute"),L("minute","m"),Y("minute",14),dt("m",J),dt("mm",J,Z),gt(["m","mm"],_t);var yn=Ot("Minutes",!1);j("s",["ss",2],0,"second"),L("second","s"),Y("second",15),dt("s",J),dt("ss",J,Z),gt(["s","ss"],wt);var xn,_n=Ot("Seconds",!1);for(j("S",0,0,(function(){return~~(this.millisecond()/100)})),j(0,["SS",2],0,(function(){return~~(this.millisecond()/10)})),j(0,["SSS",3],0,"millisecond"),j(0,["SSSS",4],0,(function(){return 10*this.millisecond()})),j(0,["SSSSS",5],0,(function(){return 100*this.millisecond()})),j(0,["SSSSSS",6],0,(function(){return 1e3*this.millisecond()})),j(0,["SSSSSSS",7],0,(function(){return 1e4*this.millisecond()})),j(0,["SSSSSSSS",8],0,(function(){return 1e5*this.millisecond()})),j(0,["SSSSSSSSS",9],0,(function(){return 1e6*this.millisecond()})),L("millisecond","ms"),Y("millisecond",16),dt("S",et,q),dt("SS",et,Z),dt("SSS",et,$),xn="SSSS";xn.length<=9;xn+="S")dt(xn,at);function wn(t,e){e[kt]=k(1e3*("0."+t))}for(xn="S";xn.length<=9;xn+="S")gt(xn,wn);var kn=Ot("Milliseconds",!1);j("z",0,0,"zoneAbbr"),j("zz",0,0,"zoneName");var Mn=x.prototype;function Sn(t){return t}Mn.add=en,Mn.calendar=function(t,e){var n=t||Le(),i=Ue(n,this).startOf("day"),r=a.calendarFormat(this,i)||"sameElse",o=e&&(O(e[r])?e[r].call(this,n):e[r]);return this.format(o||this.localeData().calendar(r,this,Le(n)))},Mn.clone=function(){return new x(this)},Mn.diff=function(t,e,n){var i,a,r;if(!this.isValid())return NaN;if(!(i=Ue(t,this)).isValid())return NaN;switch(a=6e4*(i.utcOffset()-this.utcOffset()),e=R(e)){case"year":r=an(this,i)/12;break;case"month":r=an(this,i);break;case"quarter":r=an(this,i)/3;break;case"second":r=(this-i)/1e3;break;case"minute":r=(this-i)/6e4;break;case"hour":r=(this-i)/36e5;break;case"day":r=(this-i-a)/864e5;break;case"week":r=(this-i-a)/6048e5;break;default:r=this-i}return n?r:w(r)},Mn.endOf=function(t){var e;if(void 0===(t=R(t))||"millisecond"===t||!this.isValid())return this;var n=this._isUTC?gn:fn;switch(t){case"year":e=n(this.year()+1,0,1)-1;break;case"quarter":e=n(this.year(),this.month()-this.month()%3+3,1)-1;break;case"month":e=n(this.year(),this.month()+1,1)-1;break;case"week":e=n(this.year(),this.month(),this.date()-this.weekday()+7)-1;break;case"isoWeek":e=n(this.year(),this.month(),this.date()-(this.isoWeekday()-1)+7)-1;break;case"day":case"date":e=n(this.year(),this.month(),this.date()+1)-1;break;case"hour":e=this._d.valueOf(),e+=dn-cn(e+(this._isUTC?0:this.utcOffset()*un),dn)-1;break;case"minute":e=this._d.valueOf(),e+=un-cn(e,un)-1;break;case"second":e=this._d.valueOf(),e+=ln-cn(e,ln)-1}return this._d.setTime(e),a.updateOffset(this,!0),this},Mn.format=function(t){t||(t=this.isUtc()?a.defaultFormatUtc:a.defaultFormat);var e=U(this,t);return this.localeData().postformat(e)},Mn.from=function(t,e){return this.isValid()&&(_(t)&&t.isValid()||Le(t).isValid())?Xe({to:this,from:t}).locale(this.locale()).humanize(!e):this.localeData().invalidDate()},Mn.fromNow=function(t){return this.from(Le(),t)},Mn.to=function(t,e){return this.isValid()&&(_(t)&&t.isValid()||Le(t).isValid())?Xe({from:this,to:t}).locale(this.locale()).humanize(!e):this.localeData().invalidDate()},Mn.toNow=function(t){return this.to(Le(),t)},Mn.get=function(t){return O(this[t=R(t)])?this[t]():this},Mn.invalidAt=function(){return g(this).overflow},Mn.isAfter=function(t,e){var n=_(t)?t:Le(t);return!(!this.isValid()||!n.isValid())&&("millisecond"===(e=R(e)||"millisecond")?this.valueOf()>n.valueOf():n.valueOf()<this.clone().startOf(e).valueOf())},Mn.isBefore=function(t,e){var n=_(t)?t:Le(t);return!(!this.isValid()||!n.isValid())&&("millisecond"===(e=R(e)||"millisecond")?this.valueOf()<n.valueOf():this.clone().endOf(e).valueOf()<n.valueOf())},Mn.isBetween=function(t,e,n,i){var a=_(t)?t:Le(t),r=_(e)?e:Le(e);return!!(this.isValid()&&a.isValid()&&r.isValid())&&("("===(i=i||"()")[0]?this.isAfter(a,n):!this.isBefore(a,n))&&(")"===i[1]?this.isBefore(r,n):!this.isAfter(r,n))},Mn.isSame=function(t,e){var n,i=_(t)?t:Le(t);return!(!this.isValid()||!i.isValid())&&("millisecond"===(e=R(e)||"millisecond")?this.valueOf()===i.valueOf():(n=i.valueOf(),this.clone().startOf(e).valueOf()<=n&&n<=this.clone().endOf(e).valueOf()))},Mn.isSameOrAfter=function(t,e){return this.isSame(t,e)||this.isAfter(t,e)},Mn.isSameOrBefore=function(t,e){return this.isSame(t,e)||this.isBefore(t,e)},Mn.isValid=function(){return m(this)},Mn.lang=on,Mn.locale=rn,Mn.localeData=sn,Mn.max=Ne,Mn.min=Re,Mn.parsingFlags=function(){return c({},g(this))},Mn.set=function(t,e){if("object"==typeof t)for(var n=function(t){var e=[];for(var n in t)e.push({unit:n,priority:W[n]});return e.sort((function(t,e){return t.priority-e.priority})),e}(t=N(t)),i=0;i<n.length;i++)this[n[i].unit](t[n[i].unit]);else if(O(this[t=R(t)]))return this[t](e);return this},Mn.startOf=function(t){var e;if(void 0===(t=R(t))||"millisecond"===t||!this.isValid())return this;var n=this._isUTC?gn:fn;switch(t){case"year":e=n(this.year(),0,1);break;case"quarter":e=n(this.year(),this.month()-this.month()%3,1);break;case"month":e=n(this.year(),this.month(),1);break;case"week":e=n(this.year(),this.month(),this.date()-this.weekday());break;case"isoWeek":e=n(this.year(),this.month(),this.date()-(this.isoWeekday()-1));break;case"day":case"date":e=n(this.year(),this.month(),this.date());break;case"hour":e=this._d.valueOf(),e-=cn(e+(this._isUTC?0:this.utcOffset()*un),dn);break;case"minute":e=this._d.valueOf(),e-=cn(e,un);break;case"second":e=this._d.valueOf(),e-=cn(e,ln)}return this._d.setTime(e),a.updateOffset(this,!0),this},Mn.subtract=nn,Mn.toArray=function(){var t=this;return[t.year(),t.month(),t.date(),t.hour(),t.minute(),t.second(),t.millisecond()]},Mn.toObject=function(){var t=this;return{years:t.year(),months:t.month(),date:t.date(),hours:t.hours(),minutes:t.minutes(),seconds:t.seconds(),milliseconds:t.milliseconds()}},Mn.toDate=function(){return new Date(this.valueOf())},Mn.toISOString=function(t){if(!this.isValid())return null;var e=!0!==t,n=e?this.clone().utc():this;return n.year()<0||n.year()>9999?U(n,e?"YYYYYY-MM-DD[T]HH:mm:ss.SSS[Z]":"YYYYYY-MM-DD[T]HH:mm:ss.SSSZ"):O(Date.prototype.toISOString)?e?this.toDate().toISOString():new Date(this.valueOf()+60*this.utcOffset()*1e3).toISOString().replace("Z",U(n,"Z")):U(n,e?"YYYY-MM-DD[T]HH:mm:ss.SSS[Z]":"YYYY-MM-DD[T]HH:mm:ss.SSSZ")},Mn.inspect=function(){if(!this.isValid())return"moment.invalid(/* "+this._i+" */)";var t="moment",e="";this.isLocal()||(t=0===this.utcOffset()?"moment.utc":"moment.parseZone",e="Z");var n="["+t+'("]',i=0<=this.year()&&this.year()<=9999?"YYYY":"YYYYYY",a=e+'[")]';return this.format(n+i+"-MM-DD[T]HH:mm:ss.SSS"+a)},Mn.toJSON=function(){return this.isValid()?this.toISOString():null},Mn.toString=function(){return this.clone().locale("en").format("ddd MMM DD YYYY HH:mm:ss [GMT]ZZ")},Mn.unix=function(){return Math.floor(this.valueOf()/1e3)},Mn.valueOf=function(){return this._d.valueOf()-6e4*(this._offset||0)},Mn.creationData=function(){return{input:this._i,format:this._f,locale:this._locale,isUTC:this._isUTC,strict:this._strict}},Mn.year=Tt,Mn.isLeapYear=function(){return Ct(this.year())},Mn.weekYear=function(t){return pn.call(this,t,this.week(),this.weekday(),this.localeData()._week.dow,this.localeData()._week.doy)},Mn.isoWeekYear=function(t){return pn.call(this,t,this.isoWeek(),this.isoWeekday(),1,4)},Mn.quarter=Mn.quarters=function(t){return null==t?Math.ceil((this.month()+1)/3):this.month(3*(t-1)+this.month()%3)},Mn.month=zt,Mn.daysInMonth=function(){return It(this.year(),this.month())},Mn.week=Mn.weeks=function(t){var e=this.localeData().week(this);return null==t?e:this.add(7*(t-e),"d")},Mn.isoWeek=Mn.isoWeeks=function(t){var e=qt(this,1,4).week;return null==t?e:this.add(7*(t-e),"d")},Mn.weeksInYear=function(){var t=this.localeData()._week;return Zt(this.year(),t.dow,t.doy)},Mn.isoWeeksInYear=function(){return Zt(this.year(),1,4)},Mn.date=bn,Mn.day=Mn.days=function(t){if(!this.isValid())return null!=t?this:NaN;var e=this._isUTC?this._d.getUTCDay():this._d.getDay();return null!=t?(t=function(t,e){return"string"!=typeof t?t:isNaN(t)?"number"==typeof(t=e.weekdaysParse(t))?t:null:parseInt(t,10)}(t,this.localeData()),this.add(t-e,"d")):e},Mn.weekday=function(t){if(!this.isValid())return null!=t?this:NaN;var e=(this.day()+7-this.localeData()._week.dow)%7;return null==t?e:this.add(t-e,"d")},Mn.isoWeekday=function(t){if(!this.isValid())return null!=t?this:NaN;if(null!=t){var e=function(t,e){return"string"==typeof t?e.weekdaysParse(t)%7||7:isNaN(t)?null:t}(t,this.localeData());return this.day(this.day()%7?e:e-7)}return this.day()||7},Mn.dayOfYear=function(t){var e=Math.round((this.clone().startOf("day")-this.clone().startOf("year"))/864e5)+1;return null==t?e:this.add(t-e,"d")},Mn.hour=Mn.hours=le,Mn.minute=Mn.minutes=yn,Mn.second=Mn.seconds=_n,Mn.millisecond=Mn.milliseconds=kn,Mn.utcOffset=function(t,e,n){var i,r=this._offset||0;if(!this.isValid())return null!=t?this:NaN;if(null!=t){if("string"==typeof t){if(null===(t=je(st,t)))return this}else Math.abs(t)<16&&!n&&(t*=60);return!this._isUTC&&e&&(i=Ge(this)),this._offset=t,this._isUTC=!0,null!=i&&this.add(i,"m"),r!==t&&(!e||this._changeInProgress?tn(this,Xe(t-r,"m"),1,!1):this._changeInProgress||(this._changeInProgress=!0,a.updateOffset(this,!0),this._changeInProgress=null)),this}return this._isUTC?r:Ge(this)},Mn.utc=function(t){return this.utcOffset(0,t)},Mn.local=function(t){return this._isUTC&&(this.utcOffset(0,t),this._isUTC=!1,t&&this.subtract(Ge(this),"m")),this},Mn.parseZone=function(){if(null!=this._tzm)this.utcOffset(this._tzm,!1,!0);else if("string"==typeof this._i){var t=je(ot,this._i);null!=t?this.utcOffset(t):this.utcOffset(0,!0)}return this},Mn.hasAlignedHourOffset=function(t){return!!this.isValid()&&(t=t?Le(t).utcOffset():0,(this.utcOffset()-t)%60==0)},Mn.isDST=function(){return this.utcOffset()>this.clone().month(0).utcOffset()||this.utcOffset()>this.clone().month(5).utcOffset()},Mn.isLocal=function(){return!!this.isValid()&&!this._isUTC},Mn.isUtcOffset=function(){return!!this.isValid()&&this._isUTC},Mn.isUtc=qe,Mn.isUTC=qe,Mn.zoneAbbr=function(){return this._isUTC?"UTC":""},Mn.zoneName=function(){return this._isUTC?"Coordinated Universal Time":""},Mn.dates=D("dates accessor is deprecated. Use date instead.",bn),Mn.months=D("months accessor is deprecated. Use month instead",zt),Mn.years=D("years accessor is deprecated. Use year instead",Tt),Mn.zone=D("moment().zone is deprecated, use moment().utcOffset instead. http://momentjs.com/guides/#/warnings/zone/",(function(t,e){return null!=t?("string"!=typeof t&&(t=-t),this.utcOffset(t,e),this):-this.utcOffset()})),Mn.isDSTShifted=D("isDSTShifted is deprecated. See http://momentjs.com/guides/#/warnings/dst-shifted/ for more information",(function(){if(!s(this._isDSTShifted))return this._isDSTShifted;var t={};if(b(t,this),(t=Fe(t))._a){var e=t._isUTC?f(t._a):Le(t._a);this._isDSTShifted=this.isValid()&&M(t._a,e.toArray())>0}else this._isDSTShifted=!1;return this._isDSTShifted}));var Dn=F.prototype;function Cn(t,e,n,i){var a=pe(),r=f().set(i,e);return a[n](r,t)}function Pn(t,e,n){if(l(t)&&(e=t,t=void 0),t=t||"",null!=e)return Cn(t,e,n,"month");var i,a=[];for(i=0;i<12;i++)a[i]=Cn(t,i,n,"month");return a}function Tn(t,e,n,i){"boolean"==typeof t?(l(e)&&(n=e,e=void 0),e=e||""):(n=e=t,t=!1,l(e)&&(n=e,e=void 0),e=e||"");var a,r=pe(),o=t?r._week.dow:0;if(null!=n)return Cn(e,(n+o)%7,i,"day");var s=[];for(a=0;a<7;a++)s[a]=Cn(e,(a+o)%7,i,"day");return s}Dn.calendar=function(t,e,n){var i=this._calendar[t]||this._calendar.sameElse;return O(i)?i.call(e,n):i},Dn.longDateFormat=function(t){var e=this._longDateFormat[t],n=this._longDateFormat[t.toUpperCase()];return e||!n?e:(this._longDateFormat[t]=n.replace(/MMMM|MM|DD|dddd/g,(function(t){return t.slice(1)})),this._longDateFormat[t])},Dn.invalidDate=function(){return this._invalidDate},Dn.ordinal=function(t){return this._ordinal.replace("%d",t)},Dn.preparse=Sn,Dn.postformat=Sn,Dn.relativeTime=function(t,e,n,i){var a=this._relativeTime[n];return O(a)?a(t,e,n,i):a.replace(/%d/i,t)},Dn.pastFuture=function(t,e){var n=this._relativeTime[t>0?"future":"past"];return O(n)?n(e):n.replace(/%s/i,e)},Dn.set=function(t){var e,n;for(n in t)O(e=t[n])?this[n]=e:this["_"+n]=e;this._config=t,this._dayOfMonthOrdinalParseLenient=new RegExp((this._dayOfMonthOrdinalParse.source||this._ordinalParse.source)+"|"+/\d{1,2}/.source)},Dn.months=function(t,e){return t?r(this._months)?this._months[t.month()]:this._months[(this._months.isFormat||Lt).test(e)?"format":"standalone"][t.month()]:r(this._months)?this._months:this._months.standalone},Dn.monthsShort=function(t,e){return t?r(this._monthsShort)?this._monthsShort[t.month()]:this._monthsShort[Lt.test(e)?"format":"standalone"][t.month()]:r(this._monthsShort)?this._monthsShort:this._monthsShort.standalone},Dn.monthsParse=function(t,e,n){var i,a,r;if(this._monthsParseExact)return Wt.call(this,t,e,n);for(this._monthsParse||(this._monthsParse=[],this._longMonthsParse=[],this._shortMonthsParse=[]),i=0;i<12;i++){if(a=f([2e3,i]),n&&!this._longMonthsParse[i]&&(this._longMonthsParse[i]=new RegExp("^"+this.months(a,"").replace(".","")+"$","i"),this._shortMonthsParse[i]=new RegExp("^"+this.monthsShort(a,"").replace(".","")+"$","i")),n||this._monthsParse[i]||(r="^"+this.months(a,"")+"|^"+this.monthsShort(a,""),this._monthsParse[i]=new RegExp(r.replace(".",""),"i")),n&&"MMMM"===e&&this._longMonthsParse[i].test(t))return i;if(n&&"MMM"===e&&this._shortMonthsParse[i].test(t))return i;if(!n&&this._monthsParse[i].test(t))return i}},Dn.monthsRegex=function(t){return this._monthsParseExact?(h(this,"_monthsRegex")||Ht.call(this),t?this._monthsStrictRegex:this._monthsRegex):(h(this,"_monthsRegex")||(this._monthsRegex=Vt),this._monthsStrictRegex&&t?this._monthsStrictRegex:this._monthsRegex)},Dn.monthsShortRegex=function(t){return this._monthsParseExact?(h(this,"_monthsRegex")||Ht.call(this),t?this._monthsShortStrictRegex:this._monthsShortRegex):(h(this,"_monthsShortRegex")||(this._monthsShortRegex=Et),this._monthsShortStrictRegex&&t?this._monthsShortStrictRegex:this._monthsShortRegex)},Dn.week=function(t){return qt(t,this._week.dow,this._week.doy).week},Dn.firstDayOfYear=function(){return this._week.doy},Dn.firstDayOfWeek=function(){return this._week.dow},Dn.weekdays=function(t,e){var n=r(this._weekdays)?this._weekdays:this._weekdays[t&&!0!==t&&this._weekdays.isFormat.test(e)?"format":"standalone"];return!0===t?$t(n,this._week.dow):t?n[t.day()]:n},Dn.weekdaysMin=function(t){return!0===t?$t(this._weekdaysMin,this._week.dow):t?this._weekdaysMin[t.day()]:this._weekdaysMin},Dn.weekdaysShort=function(t){return!0===t?$t(this._weekdaysShort,this._week.dow):t?this._weekdaysShort[t.day()]:this._weekdaysShort},Dn.weekdaysParse=function(t,e,n){var i,a,r;if(this._weekdaysParseExact)return Qt.call(this,t,e,n);for(this._weekdaysParse||(this._weekdaysParse=[],this._minWeekdaysParse=[],this._shortWeekdaysParse=[],this._fullWeekdaysParse=[]),i=0;i<7;i++){if(a=f([2e3,1]).day(i),n&&!this._fullWeekdaysParse[i]&&(this._fullWeekdaysParse[i]=new RegExp("^"+this.weekdays(a,"").replace(".","\\.?")+"$","i"),this._shortWeekdaysParse[i]=new RegExp("^"+this.weekdaysShort(a,"").replace(".","\\.?")+"$","i"),this._minWeekdaysParse[i]=new RegExp("^"+this.weekdaysMin(a,"").replace(".","\\.?")+"$","i")),this._weekdaysParse[i]||(r="^"+this.weekdays(a,"")+"|^"+this.weekdaysShort(a,"")+"|^"+this.weekdaysMin(a,""),this._weekdaysParse[i]=new RegExp(r.replace(".",""),"i")),n&&"dddd"===e&&this._fullWeekdaysParse[i].test(t))return i;if(n&&"ddd"===e&&this._shortWeekdaysParse[i].test(t))return i;if(n&&"dd"===e&&this._minWeekdaysParse[i].test(t))return i;if(!n&&this._weekdaysParse[i].test(t))return i}},Dn.weekdaysRegex=function(t){return this._weekdaysParseExact?(h(this,"_weekdaysRegex")||ie.call(this),t?this._weekdaysStrictRegex:this._weekdaysRegex):(h(this,"_weekdaysRegex")||(this._weekdaysRegex=te),this._weekdaysStrictRegex&&t?this._weekdaysStrictRegex:this._weekdaysRegex)},Dn.weekdaysShortRegex=function(t){return this._weekdaysParseExact?(h(this,"_weekdaysRegex")||ie.call(this),t?this._weekdaysShortStrictRegex:this._weekdaysShortRegex):(h(this,"_weekdaysShortRegex")||(this._weekdaysShortRegex=ee),this._weekdaysShortStrictRegex&&t?this._weekdaysShortStrictRegex:this._weekdaysShortRegex)},Dn.weekdaysMinRegex=function(t){return this._weekdaysParseExact?(h(this,"_weekdaysRegex")||ie.call(this),t?this._weekdaysMinStrictRegex:this._weekdaysMinRegex):(h(this,"_weekdaysMinRegex")||(this._weekdaysMinRegex=ne),this._weekdaysMinStrictRegex&&t?this._weekdaysMinStrictRegex:this._weekdaysMinRegex)},Dn.isPM=function(t){return"p"===(t+"").toLowerCase().charAt(0)},Dn.meridiem=function(t,e,n){return t>11?n?"pm":"PM":n?"am":"AM"},ge("en",{dayOfMonthOrdinalParse:/\d{1,2}(th|st|nd|rd)/,ordinal:function(t){var e=t%10;return t+(1===k(t%100/10)?"th":1===e?"st":2===e?"nd":3===e?"rd":"th")}}),a.lang=D("moment.lang is deprecated. Use moment.locale instead.",ge),a.langData=D("moment.langData is deprecated. Use moment.localeData instead.",pe);var On=Math.abs;function An(t,e,n,i){var a=Xe(e,n);return t._milliseconds+=i*a._milliseconds,t._days+=i*a._days,t._months+=i*a._months,t._bubble()}function Fn(t){return t<0?Math.floor(t):Math.ceil(t)}function In(t){return 4800*t/146097}function Ln(t){return 146097*t/4800}function Rn(t){return function(){return this.as(t)}}var Nn=Rn("ms"),Wn=Rn("s"),Yn=Rn("m"),zn=Rn("h"),En=Rn("d"),Vn=Rn("w"),Hn=Rn("M"),Bn=Rn("Q"),jn=Rn("y");function Un(t){return function(){return this.isValid()?this._data[t]:NaN}}var Gn=Un("milliseconds"),qn=Un("seconds"),Zn=Un("minutes"),$n=Un("hours"),Xn=Un("days"),Kn=Un("months"),Jn=Un("years"),Qn=Math.round,ti={ss:44,s:45,m:45,h:22,d:26,M:11};function ei(t,e,n,i,a){return a.relativeTime(e||1,!!n,t,i)}var ni=Math.abs;function ii(t){return(t>0)-(t<0)||+t}function ai(){if(!this.isValid())return this.localeData().invalidDate();var t,e,n=ni(this._milliseconds)/1e3,i=ni(this._days),a=ni(this._months);t=w(n/60),e=w(t/60),n%=60,t%=60;var r=w(a/12),o=a%=12,s=i,l=e,u=t,d=n?n.toFixed(3).replace(/\.?0+$/,""):"",h=this.asSeconds();if(!h)return"P0D";var c=h<0?"-":"",f=ii(this._months)!==ii(h)?"-":"",g=ii(this._days)!==ii(h)?"-":"",m=ii(this._milliseconds)!==ii(h)?"-":"";return c+"P"+(r?f+r+"Y":"")+(o?f+o+"M":"")+(s?g+s+"D":"")+(l||u||d?"T":"")+(l?m+l+"H":"")+(u?m+u+"M":"")+(d?m+d+"S":"")}var ri=ze.prototype;return ri.isValid=function(){return this._isValid},ri.abs=function(){var t=this._data;return this._milliseconds=On(this._milliseconds),this._days=On(this._days),this._months=On(this._months),t.milliseconds=On(t.milliseconds),t.seconds=On(t.seconds),t.minutes=On(t.minutes),t.hours=On(t.hours),t.months=On(t.months),t.years=On(t.years),this},ri.add=function(t,e){return An(this,t,e,1)},ri.subtract=function(t,e){return An(this,t,e,-1)},ri.as=function(t){if(!this.isValid())return NaN;var e,n,i=this._milliseconds;if("month"===(t=R(t))||"quarter"===t||"year"===t)switch(e=this._days+i/864e5,n=this._months+In(e),t){case"month":return n;case"quarter":return n/3;case"year":return n/12}else switch(e=this._days+Math.round(Ln(this._months)),t){case"week":return e/7+i/6048e5;case"day":return e+i/864e5;case"hour":return 24*e+i/36e5;case"minute":return 1440*e+i/6e4;case"second":return 86400*e+i/1e3;case"millisecond":return Math.floor(864e5*e)+i;default:throw new Error("Unknown unit "+t)}},ri.asMilliseconds=Nn,ri.asSeconds=Wn,ri.asMinutes=Yn,ri.asHours=zn,ri.asDays=En,ri.asWeeks=Vn,ri.asMonths=Hn,ri.asQuarters=Bn,ri.asYears=jn,ri.valueOf=function(){return this.isValid()?this._milliseconds+864e5*this._days+this._months%12*2592e6+31536e6*k(this._months/12):NaN},ri._bubble=function(){var t,e,n,i,a,r=this._milliseconds,o=this._days,s=this._months,l=this._data;return r>=0&&o>=0&&s>=0||r<=0&&o<=0&&s<=0||(r+=864e5*Fn(Ln(s)+o),o=0,s=0),l.milliseconds=r%1e3,t=w(r/1e3),l.seconds=t%60,e=w(t/60),l.minutes=e%60,n=w(e/60),l.hours=n%24,o+=w(n/24),a=w(In(o)),s+=a,o-=Fn(Ln(a)),i=w(s/12),s%=12,l.days=o,l.months=s,l.years=i,this},ri.clone=function(){return Xe(this)},ri.get=function(t){return t=R(t),this.isValid()?this[t+"s"]():NaN},ri.milliseconds=Gn,ri.seconds=qn,ri.minutes=Zn,ri.hours=$n,ri.days=Xn,ri.weeks=function(){return w(this.days()/7)},ri.months=Kn,ri.years=Jn,ri.humanize=function(t){if(!this.isValid())return this.localeData().invalidDate();var e=this.localeData(),n=function(t,e,n){var i=Xe(t).abs(),a=Qn(i.as("s")),r=Qn(i.as("m")),o=Qn(i.as("h")),s=Qn(i.as("d")),l=Qn(i.as("M")),u=Qn(i.as("y")),d=a<=ti.ss&&["s",a]||a<ti.s&&["ss",a]||r<=1&&["m"]||r<ti.m&&["mm",r]||o<=1&&["h"]||o<ti.h&&["hh",o]||s<=1&&["d"]||s<ti.d&&["dd",s]||l<=1&&["M"]||l<ti.M&&["MM",l]||u<=1&&["y"]||["yy",u];return d[2]=e,d[3]=+t>0,d[4]=n,ei.apply(null,d)}(this,!t,e);return t&&(n=e.pastFuture(+this,n)),e.postformat(n)},ri.toISOString=ai,ri.toString=ai,ri.toJSON=ai,ri.locale=rn,ri.localeData=sn,ri.toIsoString=D("toIsoString() is deprecated. Please use toISOString() instead (notice the capitals)",ai),ri.lang=on,j("X",0,0,"unix"),j("x",0,0,"valueOf"),dt("x",rt),dt("X",/[+-]?\d+(\.\d{1,3})?/),gt("X",(function(t,e,n){n._d=new Date(1e3*parseFloat(t,10))})),gt("x",(function(t,e,n){n._d=new Date(k(t))})),a.version="2.24.0",n=Le,a.fn=Mn,a.min=function(){return We("isBefore",[].slice.call(arguments,0))},a.max=function(){return We("isAfter",[].slice.call(arguments,0))},a.now=function(){return Date.now?Date.now():+new Date},a.utc=f,a.unix=function(t){return Le(1e3*t)},a.months=function(t,e){return Pn(t,e,"months")},a.isDate=u,a.locale=ge,a.invalid=p,a.duration=Xe,a.isMoment=_,a.weekdays=function(t,e,n){return Tn(t,e,n,"weekdays")},a.parseZone=function(){return Le.apply(null,arguments).parseZone()},a.localeData=pe,a.isDuration=Ee,a.monthsShort=function(t,e){return Pn(t,e,"monthsShort")},a.weekdaysMin=function(t,e,n){return Tn(t,e,n,"weekdaysMin")},a.defineLocale=me,a.updateLocale=function(t,e){if(null!=e){var n,i,a=ue;null!=(i=fe(t))&&(a=i._config),e=A(a,e),(n=new F(e)).parentLocale=de[t],de[t]=n,ge(t)}else null!=de[t]&&(null!=de[t].parentLocale?de[t]=de[t].parentLocale:null!=de[t]&&delete de[t]);return de[t]},a.locales=function(){return C(de)},a.weekdaysShort=function(t,e,n){return Tn(t,e,n,"weekdaysShort")},a.normalizeUnits=R,a.relativeTimeRounding=function(t){return void 0===t?Qn:"function"==typeof t&&(Qn=t,!0)},a.relativeTimeThreshold=function(t,e){return void 0!==ti[t]&&(void 0===e?ti[t]:(ti[t]=e,"s"===t&&(ti.ss=e-1),!0))},a.calendarFormat=function(t,e){var n=t.diff(e,"days",!0);return n<-6?"sameElse":n<-1?"lastWeek":n<0?"lastDay":n<1?"sameDay":n<2?"nextDay":n<7?"nextWeek":"sameElse"},a.prototype=Mn,a.HTML5_FMT={DATETIME_LOCAL:"YYYY-MM-DDTHH:mm",DATETIME_LOCAL_SECONDS:"YYYY-MM-DDTHH:mm:ss",DATETIME_LOCAL_MS:"YYYY-MM-DDTHH:mm:ss.SSS",DATE:"YYYY-MM-DD",TIME:"HH:mm",TIME_SECONDS:"HH:mm:ss",TIME_MS:"HH:mm:ss.SSS",WEEK:"GGGG-[W]WW",MONTH:"YYYY-MM"},a}()})),pi={datetime:"MMM D, YYYY, h:mm:ss a",millisecond:"h:mm:ss.SSS a",second:"h:mm:ss a",minute:"h:mm a",hour:"hA",day:"MMM D",week:"ll",month:"MMM YYYY",quarter:"[Q]Q - YYYY",year:"YYYY"};on._date.override("function"==typeof mi?{_id:"moment",formats:function(){return pi},parse:function(t,e){return"string"==typeof t&&"string"==typeof e?t=mi(t,e):t instanceof mi||(t=mi(t)),t.isValid()?t.valueOf():null},format:function(t,e){return mi(t).format(e)},add:function(t,e,n){return mi(t).add(e,n).valueOf()},diff:function(t,e,n){return mi(t).diff(mi(e),n)},startOf:function(t,e,n){return t=mi(t),"isoWeek"===e?t.isoWeekday(n).valueOf():t.startOf(e).valueOf()},endOf:function(t,e){return mi(t).endOf(e).valueOf()},_create:function(t){return mi(t)}}:{}),Y._set("global",{plugins:{filler:{propagate:!0}}});var vi={dataset:function(t){var e=t.fill,n=t.chart,i=n.getDatasetMeta(e),a=i&&n.isDatasetVisible(e)&&i.dataset._children||[],r=a.length||0;return r?function(t,e){return e<r&&a[e]._view||null}:null},boundary:function(t){var e=t.boundary,n=e?e.x:null,i=e?e.y:null;return B.isArray(e)?function(t,n){return e[n]}:function(t){return{x:null===n?t.x:n,y:null===i?t.y:i}}}};function bi(t,e,n){var i,a=t._model||{},r=a.fill;if(void 0===r&&(r=!!a.backgroundColor),!1===r||null===r)return!1;if(!0===r)return"origin";if(i=parseFloat(r,10),isFinite(i)&&Math.floor(i)===i)return"-"!==r[0]&&"+"!==r[0]||(i=e+i),!(i===e||i<0||i>=n)&&i;switch(r){case"bottom":return"start";case"top":return"end";case"zero":return"origin";case"origin":case"start":case"end":return r;default:return!1}}function yi(t){return(t.el._scale||{}).getPointPositionForValue?function(t){var e,n,i,a,r,o=t.el._scale,s=o.options,l=o.chart.data.labels.length,u=t.fill,d=[];if(!l)return null;for(e=s.ticks.reverse?o.max:o.min,n=s.ticks.reverse?o.min:o.max,i=o.getPointPositionForValue(0,e),a=0;a<l;++a)r="start"===u||"end"===u?o.getPointPositionForValue(a,"start"===u?e:n):o.getBasePosition(a),s.gridLines.circular&&(r.cx=i.x,r.cy=i.y,r.angle=o.getIndexAngle(a)-Math.PI/2),d.push(r);return d}(t):function(t){var e,n=t.el._model||{},i=t.el._scale||{},a=t.fill,r=null;if(isFinite(a))return null;if("start"===a?r=void 0===n.scaleBottom?i.bottom:n.scaleBottom:"end"===a?r=void 0===n.scaleTop?i.top:n.scaleTop:void 0!==n.scaleZero?r=n.scaleZero:i.getBasePixel&&(r=i.getBasePixel()),null!=r){if(void 0!==r.x&&void 0!==r.y)return r;if(B.isFinite(r))return{x:(e=i.isHorizontal())?r:null,y:e?null:r}}return null}(t)}function xi(t,e,n){var i,a=t[e].fill,r=[e];if(!n)return a;for(;!1!==a&&-1===r.indexOf(a);){if(!isFinite(a))return a;if(!(i=t[a]))return!1;if(i.visible)return a;r.push(a),a=i.fill}return!1}function _i(t){var e=t.fill,n="dataset";return!1===e?null:(isFinite(e)||(n="boundary"),vi[n](t))}function wi(t){return t&&!t.skip}function ki(t,e,n,i,a){var r,o,s,l;if(i&&a){for(t.moveTo(e[0].x,e[0].y),r=1;r<i;++r)B.canvas.lineTo(t,e[r-1],e[r]);if(void 0===n[0].angle)for(t.lineTo(n[a-1].x,n[a-1].y),r=a-1;r>0;--r)B.canvas.lineTo(t,n[r],n[r-1],!0);else for(o=n[0].cx,s=n[0].cy,l=Math.sqrt(Math.pow(n[0].x-o,2)+Math.pow(n[0].y-s,2)),r=a-1;r>0;--r)t.arc(o,s,l,n[r].angle,n[r-1].angle,!0)}}function Mi(t,e,n,i,a,r){var o,s,l,u,d,h,c,f,g=e.length,m=i.spanGaps,p=[],v=[],b=0,y=0;for(t.beginPath(),o=0,s=g;o<s;++o)d=n(u=e[l=o%g]._view,l,i),h=wi(u),c=wi(d),r&&void 0===f&&h&&(s=g+(f=o+1)),h&&c?(b=p.push(u),y=v.push(d)):b&&y&&(m?(h&&p.push(u),c&&v.push(d)):(ki(t,p,v,b,y),b=y=0,p=[],v=[]));ki(t,p,v,b,y),t.closePath(),t.fillStyle=a,t.fill()}var Si={id:"filler",afterDatasetsUpdate:function(t,e){var n,i,a,r,o=(t.data.datasets||[]).length,s=e.propagate,l=[];for(i=0;i<o;++i)r=null,(a=(n=t.getDatasetMeta(i)).dataset)&&a._model&&a instanceof kt.Line&&(r={visible:t.isDatasetVisible(i),fill:bi(a,i,o),chart:t,el:a}),n.$filler=r,l.push(r);for(i=0;i<o;++i)(r=l[i])&&(r.fill=xi(l,i,s),r.boundary=yi(r),r.mapper=_i(r))},beforeDatasetsDraw:function(t){var e,n,i,a,r,o,s,l=t._getSortedVisibleDatasetMetas(),u=t.ctx;for(n=l.length-1;n>=0;--n)(e=l[n].$filler)&&e.visible&&(a=(i=e.el)._view,r=i._children||[],o=e.mapper,s=a.backgroundColor||Y.global.defaultColor,o&&s&&r.length&&(B.canvas.clipArea(u,t.chartArea),Mi(u,r,o,a,s,i._loop),B.canvas.unclipArea(u)))}},Di=B.rtl.getRtlAdapter,Ci=B.noop,Pi=B.valueOrDefault;function Ti(t,e){return t.usePointStyle&&t.boxWidth>e?e:t.boxWidth}Y._set("global",{legend:{display:!0,position:"top",align:"center",fullWidth:!0,reverse:!1,weight:1e3,onClick:function(t,e){var n=e.datasetIndex,i=this.chart,a=i.getDatasetMeta(n);a.hidden=null===a.hidden?!i.data.datasets[n].hidden:null,i.update()},onHover:null,onLeave:null,labels:{boxWidth:40,padding:10,generateLabels:function(t){var e=t.data.datasets,n=t.options.legend||{},i=n.labels&&n.labels.usePointStyle;return t._getSortedDatasetMetas().map((function(n){var a=n.controller.getStyle(i?0:void 0);return{text:e[n.index].label,fillStyle:a.backgroundColor,hidden:!t.isDatasetVisible(n.index),lineCap:a.borderCapStyle,lineDash:a.borderDash,lineDashOffset:a.borderDashOffset,lineJoin:a.borderJoinStyle,lineWidth:a.borderWidth,strokeStyle:a.borderColor,pointStyle:a.pointStyle,rotation:a.rotation,datasetIndex:n.index}}),this)}}},legendCallback:function(t){var e,n,i,a=document.createElement("ul"),r=t.data.datasets;for(a.setAttribute("class",t.id+"-legend"),e=0,n=r.length;e<n;e++)(i=a.appendChild(document.createElement("li"))).appendChild(document.createElement("span")).style.backgroundColor=r[e].backgroundColor,r[e].label&&i.appendChild(document.createTextNode(r[e].label));return a.outerHTML}});var Oi=X.extend({initialize:function(t){B.extend(this,t),this.legendHitBoxes=[],this._hoveredItem=null,this.doughnutMode=!1},beforeUpdate:Ci,update:function(t,e,n){var i=this;return i.beforeUpdate(),i.maxWidth=t,i.maxHeight=e,i.margins=n,i.beforeSetDimensions(),i.setDimensions(),i.afterSetDimensions(),i.beforeBuildLabels(),i.buildLabels(),i.afterBuildLabels(),i.beforeFit(),i.fit(),i.afterFit(),i.afterUpdate(),i.minSize},afterUpdate:Ci,beforeSetDimensions:Ci,setDimensions:function(){var t=this;t.isHorizontal()?(t.width=t.maxWidth,t.left=0,t.right=t.width):(t.height=t.maxHeight,t.top=0,t.bottom=t.height),t.paddingLeft=0,t.paddingTop=0,t.paddingRight=0,t.paddingBottom=0,t.minSize={width:0,height:0}},afterSetDimensions:Ci,beforeBuildLabels:Ci,buildLabels:function(){var t=this,e=t.options.labels||{},n=B.callback(e.generateLabels,[t.chart],t)||[];e.filter&&(n=n.filter((function(n){return e.filter(n,t.chart.data)}))),t.options.reverse&&n.reverse(),t.legendItems=n},afterBuildLabels:Ci,beforeFit:Ci,fit:function(){var t=this,e=t.options,n=e.labels,i=e.display,a=t.ctx,r=B.options._parseFont(n),o=r.size,s=t.legendHitBoxes=[],l=t.minSize,u=t.isHorizontal();if(u?(l.width=t.maxWidth,l.height=i?10:0):(l.width=i?10:0,l.height=t.maxHeight),i){if(a.font=r.string,u){var d=t.lineWidths=[0],h=0;a.textAlign="left",a.textBaseline="middle",B.each(t.legendItems,(function(t,e){var i=Ti(n,o)+o/2+a.measureText(t.text).width;(0===e||d[d.length-1]+i+2*n.padding>l.width)&&(h+=o+n.padding,d[d.length-(e>0?0:1)]=0),s[e]={left:0,top:0,width:i,height:o},d[d.length-1]+=i+n.padding})),l.height+=h}else{var c=n.padding,f=t.columnWidths=[],g=t.columnHeights=[],m=n.padding,p=0,v=0;B.each(t.legendItems,(function(t,e){var i=Ti(n,o)+o/2+a.measureText(t.text).width;e>0&&v+o+2*c>l.height&&(m+=p+n.padding,f.push(p),g.push(v),p=0,v=0),p=Math.max(p,i),v+=o+c,s[e]={left:0,top:0,width:i,height:o}})),m+=p,f.push(p),g.push(v),l.width+=m}t.width=l.width,t.height=l.height}else t.width=l.width=t.height=l.height=0},afterFit:Ci,isHorizontal:function(){return"top"===this.options.position||"bottom"===this.options.position},draw:function(){var t=this,e=t.options,n=e.labels,i=Y.global,a=i.defaultColor,r=i.elements.line,o=t.height,s=t.columnHeights,l=t.width,u=t.lineWidths;if(e.display){var d,h=Di(e.rtl,t.left,t.minSize.width),c=t.ctx,f=Pi(n.fontColor,i.defaultFontColor),g=B.options._parseFont(n),m=g.size;c.textAlign=h.textAlign("left"),c.textBaseline="middle",c.lineWidth=.5,c.strokeStyle=f,c.fillStyle=f,c.font=g.string;var p=Ti(n,m),v=t.legendHitBoxes,b=function(t,i){switch(e.align){case"start":return n.padding;case"end":return t-i;default:return(t-i+n.padding)/2}},y=t.isHorizontal();d=y?{x:t.left+b(l,u[0]),y:t.top+n.padding,line:0}:{x:t.left+n.padding,y:t.top+b(o,s[0]),line:0},B.rtl.overrideTextDirection(t.ctx,e.textDirection);var x=m+n.padding;B.each(t.legendItems,(function(e,i){var f=c.measureText(e.text).width,g=p+m/2+f,_=d.x,w=d.y;h.setWidth(t.minSize.width),y?i>0&&_+g+n.padding>t.left+t.minSize.width&&(w=d.y+=x,d.line++,_=d.x=t.left+b(l,u[d.line])):i>0&&w+x>t.top+t.minSize.height&&(_=d.x=_+t.columnWidths[d.line]+n.padding,d.line++,w=d.y=t.top+b(o,s[d.line]));var k=h.x(_);!function(t,e,i){if(!(isNaN(p)||p<=0)){c.save();var o=Pi(i.lineWidth,r.borderWidth);if(c.fillStyle=Pi(i.fillStyle,a),c.lineCap=Pi(i.lineCap,r.borderCapStyle),c.lineDashOffset=Pi(i.lineDashOffset,r.borderDashOffset),c.lineJoin=Pi(i.lineJoin,r.borderJoinStyle),c.lineWidth=o,c.strokeStyle=Pi(i.strokeStyle,a),c.setLineDash&&c.setLineDash(Pi(i.lineDash,r.borderDash)),n&&n.usePointStyle){var s=p*Math.SQRT2/2,l=h.xPlus(t,p/2),u=e+m/2;B.canvas.drawPoint(c,i.pointStyle,s,l,u,i.rotation)}else c.fillRect(h.leftForLtr(t,p),e,p,m),0!==o&&c.strokeRect(h.leftForLtr(t,p),e,p,m);c.restore()}}(k,w,e),v[i].left=h.leftForLtr(k,v[i].width),v[i].top=w,function(t,e,n,i){var a=m/2,r=h.xPlus(t,p+a),o=e+a;c.fillText(n.text,r,o),n.hidden&&(c.beginPath(),c.lineWidth=2,c.moveTo(r,o),c.lineTo(h.xPlus(r,i),o),c.stroke())}(k,w,e,f),y?d.x+=g+n.padding:d.y+=x})),B.rtl.restoreTextDirection(t.ctx,e.textDirection)}},_getLegendItemAt:function(t,e){var n,i,a,r=this;if(t>=r.left&&t<=r.right&&e>=r.top&&e<=r.bottom)for(a=r.legendHitBoxes,n=0;n<a.length;++n)if(t>=(i=a[n]).left&&t<=i.left+i.width&&e>=i.top&&e<=i.top+i.height)return r.legendItems[n];return null},handleEvent:function(t){var e,n=this,i=n.options,a="mouseup"===t.type?"click":t.type;if("mousemove"===a){if(!i.onHover&&!i.onLeave)return}else{if("click"!==a)return;if(!i.onClick)return}e=n._getLegendItemAt(t.x,t.y),"click"===a?e&&i.onClick&&i.onClick.call(n,t.native,e):(i.onLeave&&e!==n._hoveredItem&&(n._hoveredItem&&i.onLeave.call(n,t.native,n._hoveredItem),n._hoveredItem=e),i.onHover&&e&&i.onHover.call(n,t.native,e))}});function Ai(t,e){var n=new Oi({ctx:t.ctx,options:e,chart:t});pe.configure(t,n,e),pe.addBox(t,n),t.legend=n}var Fi={id:"legend",_element:Oi,beforeInit:function(t){var e=t.options.legend;e&&Ai(t,e)},beforeUpdate:function(t){var e=t.options.legend,n=t.legend;e?(B.mergeIf(e,Y.global.legend),n?(pe.configure(t,n,e),n.options=e):Ai(t,e)):n&&(pe.removeBox(t,n),delete t.legend)},afterEvent:function(t,e){var n=t.legend;n&&n.handleEvent(e)}},Ii=B.noop;Y._set("global",{title:{display:!1,fontStyle:"bold",fullWidth:!0,padding:10,position:"top",text:"",weight:2e3}});var Li=X.extend({initialize:function(t){B.extend(this,t),this.legendHitBoxes=[]},beforeUpdate:Ii,update:function(t,e,n){var i=this;return i.beforeUpdate(),i.maxWidth=t,i.maxHeight=e,i.margins=n,i.beforeSetDimensions(),i.setDimensions(),i.afterSetDimensions(),i.beforeBuildLabels(),i.buildLabels(),i.afterBuildLabels(),i.beforeFit(),i.fit(),i.afterFit(),i.afterUpdate(),i.minSize},afterUpdate:Ii,beforeSetDimensions:Ii,setDimensions:function(){var t=this;t.isHorizontal()?(t.width=t.maxWidth,t.left=0,t.right=t.width):(t.height=t.maxHeight,t.top=0,t.bottom=t.height),t.paddingLeft=0,t.paddingTop=0,t.paddingRight=0,t.paddingBottom=0,t.minSize={width:0,height:0}},afterSetDimensions:Ii,beforeBuildLabels:Ii,buildLabels:Ii,afterBuildLabels:Ii,beforeFit:Ii,fit:function(){var t,e=this,n=e.options,i=e.minSize={},a=e.isHorizontal();n.display?(t=(B.isArray(n.text)?n.text.length:1)*B.options._parseFont(n).lineHeight+2*n.padding,e.width=i.width=a?e.maxWidth:t,e.height=i.height=a?t:e.maxHeight):e.width=i.width=e.height=i.height=0},afterFit:Ii,isHorizontal:function(){var t=this.options.position;return"top"===t||"bottom"===t},draw:function(){var t=this,e=t.ctx,n=t.options;if(n.display){var i,a,r,o=B.options._parseFont(n),s=o.lineHeight,l=s/2+n.padding,u=0,d=t.top,h=t.left,c=t.bottom,f=t.right;e.fillStyle=B.valueOrDefault(n.fontColor,Y.global.defaultFontColor),e.font=o.string,t.isHorizontal()?(a=h+(f-h)/2,r=d+l,i=f-h):(a="left"===n.position?h+l:f-l,r=d+(c-d)/2,i=c-d,u=Math.PI*("left"===n.position?-.5:.5)),e.save(),e.translate(a,r),e.rotate(u),e.textAlign="center",e.textBaseline="middle";var g=n.text;if(B.isArray(g))for(var m=0,p=0;p<g.length;++p)e.fillText(g[p],0,m,i),m+=s;else e.fillText(g,0,0,i);e.restore()}}});function Ri(t,e){var n=new Li({ctx:t.ctx,options:e,chart:t});pe.configure(t,n,e),pe.addBox(t,n),t.titleBlock=n}var Ni={},Wi=Si,Yi=Fi,zi={id:"title",_element:Li,beforeInit:function(t){var e=t.options.title;e&&Ri(t,e)},beforeUpdate:function(t){var e=t.options.title,n=t.titleBlock;e?(B.mergeIf(e,Y.global.title),n?(pe.configure(t,n,e),n.options=e):Ri(t,e)):n&&(pe.removeBox(t,n),delete t.titleBlock)}};for(var Ei in Ni.filler=Wi,Ni.legend=Yi,Ni.title=zi,nn.helpers=B,function(){function t(t,e,n){var i;return"string"==typeof t?(i=parseInt(t,10),-1!==t.indexOf("%")&&(i=i/100*e.parentNode[n])):i=t,i}function e(t){return null!=t&&"none"!==t}function n(n,i,a){var r=document.defaultView,o=B._getParentNode(n),s=r.getComputedStyle(n)[i],l=r.getComputedStyle(o)[i],u=e(s),d=e(l),h=Number.POSITIVE_INFINITY;return u||d?Math.min(u?t(s,n,a):h,d?t(l,o,a):h):"none"}B.where=function(t,e){if(B.isArray(t)&&Array.prototype.filter)return t.filter(e);var n=[];return B.each(t,(function(t){e(t)&&n.push(t)})),n},B.findIndex=Array.prototype.findIndex?function(t,e,n){return t.findIndex(e,n)}:function(t,e,n){n=void 0===n?t:n;for(var i=0,a=t.length;i<a;++i)if(e.call(n,t[i],i,t))return i;return-1},B.findNextWhere=function(t,e,n){B.isNullOrUndef(n)&&(n=-1);for(var i=n+1;i<t.length;i++){var a=t[i];if(e(a))return a}},B.findPreviousWhere=function(t,e,n){B.isNullOrUndef(n)&&(n=t.length);for(var i=n-1;i>=0;i--){var a=t[i];if(e(a))return a}},B.isNumber=function(t){return!isNaN(parseFloat(t))&&isFinite(t)},B.almostEquals=function(t,e,n){return Math.abs(t-e)<n},B.almostWhole=function(t,e){var n=Math.round(t);return n-e<=t&&n+e>=t},B.max=function(t){return t.reduce((function(t,e){return isNaN(e)?t:Math.max(t,e)}),Number.NEGATIVE_INFINITY)},B.min=function(t){return t.reduce((function(t,e){return isNaN(e)?t:Math.min(t,e)}),Number.POSITIVE_INFINITY)},B.sign=Math.sign?function(t){return Math.sign(t)}:function(t){return 0===(t=+t)||isNaN(t)?t:t>0?1:-1},B.toRadians=function(t){return t*(Math.PI/180)},B.toDegrees=function(t){return t*(180/Math.PI)},B._decimalPlaces=function(t){if(B.isFinite(t)){for(var e=1,n=0;Math.round(t*e)/e!==t;)e*=10,n++;return n}},B.getAngleFromPoint=function(t,e){var n=e.x-t.x,i=e.y-t.y,a=Math.sqrt(n*n+i*i),r=Math.atan2(i,n);return r<-.5*Math.PI&&(r+=2*Math.PI),{angle:r,distance:a}},B.distanceBetweenPoints=function(t,e){return Math.sqrt(Math.pow(e.x-t.x,2)+Math.pow(e.y-t.y,2))},B.aliasPixel=function(t){return t%2==0?0:.5},B._alignPixel=function(t,e,n){var i=t.currentDevicePixelRatio,a=n/2;return Math.round((e-a)*i)/i+a},B.splineCurve=function(t,e,n,i){var a=t.skip?e:t,r=e,o=n.skip?e:n,s=Math.sqrt(Math.pow(r.x-a.x,2)+Math.pow(r.y-a.y,2)),l=Math.sqrt(Math.pow(o.x-r.x,2)+Math.pow(o.y-r.y,2)),u=s/(s+l),d=l/(s+l),h=i*(u=isNaN(u)?0:u),c=i*(d=isNaN(d)?0:d);return{previous:{x:r.x-h*(o.x-a.x),y:r.y-h*(o.y-a.y)},next:{x:r.x+c*(o.x-a.x),y:r.y+c*(o.y-a.y)}}},B.EPSILON=Number.EPSILON||1e-14,B.splineCurveMonotone=function(t){var e,n,i,a,r,o,s,l,u,d=(t||[]).map((function(t){return{model:t._model,deltaK:0,mK:0}})),h=d.length;for(e=0;e<h;++e)if(!(i=d[e]).model.skip){if(n=e>0?d[e-1]:null,(a=e<h-1?d[e+1]:null)&&!a.model.skip){var c=a.model.x-i.model.x;i.deltaK=0!==c?(a.model.y-i.model.y)/c:0}!n||n.model.skip?i.mK=i.deltaK:!a||a.model.skip?i.mK=n.deltaK:this.sign(n.deltaK)!==this.sign(i.deltaK)?i.mK=0:i.mK=(n.deltaK+i.deltaK)/2}for(e=0;e<h-1;++e)i=d[e],a=d[e+1],i.model.skip||a.model.skip||(B.almostEquals(i.deltaK,0,this.EPSILON)?i.mK=a.mK=0:(r=i.mK/i.deltaK,o=a.mK/i.deltaK,(l=Math.pow(r,2)+Math.pow(o,2))<=9||(s=3/Math.sqrt(l),i.mK=r*s*i.deltaK,a.mK=o*s*i.deltaK)));for(e=0;e<h;++e)(i=d[e]).model.skip||(n=e>0?d[e-1]:null,a=e<h-1?d[e+1]:null,n&&!n.model.skip&&(u=(i.model.x-n.model.x)/3,i.model.controlPointPreviousX=i.model.x-u,i.model.controlPointPreviousY=i.model.y-u*i.mK),a&&!a.model.skip&&(u=(a.model.x-i.model.x)/3,i.model.controlPointNextX=i.model.x+u,i.model.controlPointNextY=i.model.y+u*i.mK))},B.nextItem=function(t,e,n){return n?e>=t.length-1?t[0]:t[e+1]:e>=t.length-1?t[t.length-1]:t[e+1]},B.previousItem=function(t,e,n){return n?e<=0?t[t.length-1]:t[e-1]:e<=0?t[0]:t[e-1]},B.niceNum=function(t,e){var n=Math.floor(B.log10(t)),i=t/Math.pow(10,n);return(e?i<1.5?1:i<3?2:i<7?5:10:i<=1?1:i<=2?2:i<=5?5:10)*Math.pow(10,n)},B.requestAnimFrame="undefined"==typeof window?function(t){t()}:window.requestAnimationFrame||window.webkitRequestAnimationFrame||window.mozRequestAnimationFrame||window.oRequestAnimationFrame||window.msRequestAnimationFrame||function(t){return window.setTimeout(t,1e3/60)},B.getRelativePosition=function(t,e){var n,i,a=t.originalEvent||t,r=t.target||t.srcElement,o=r.getBoundingClientRect(),s=a.touches;s&&s.length>0?(n=s[0].clientX,i=s[0].clientY):(n=a.clientX,i=a.clientY);var l=parseFloat(B.getStyle(r,"padding-left")),u=parseFloat(B.getStyle(r,"padding-top")),d=parseFloat(B.getStyle(r,"padding-right")),h=parseFloat(B.getStyle(r,"padding-bottom")),c=o.right-o.left-l-d,f=o.bottom-o.top-u-h;return{x:n=Math.round((n-o.left-l)/c*r.width/e.currentDevicePixelRatio),y:i=Math.round((i-o.top-u)/f*r.height/e.currentDevicePixelRatio)}},B.getConstraintWidth=function(t){return n(t,"max-width","clientWidth")},B.getConstraintHeight=function(t){return n(t,"max-height","clientHeight")},B._calculatePadding=function(t,e,n){return(e=B.getStyle(t,e)).indexOf("%")>-1?n*parseInt(e,10)/100:parseInt(e,10)},B._getParentNode=function(t){var e=t.parentNode;return e&&"[object ShadowRoot]"===e.toString()&&(e=e.host),e},B.getMaximumWidth=function(t){var e=B._getParentNode(t);if(!e)return t.clientWidth;var n=e.clientWidth,i=n-B._calculatePadding(e,"padding-left",n)-B._calculatePadding(e,"padding-right",n),a=B.getConstraintWidth(t);return isNaN(a)?i:Math.min(i,a)},B.getMaximumHeight=function(t){var e=B._getParentNode(t);if(!e)return t.clientHeight;var n=e.clientHeight,i=n-B._calculatePadding(e,"padding-top",n)-B._calculatePadding(e,"padding-bottom",n),a=B.getConstraintHeight(t);return isNaN(a)?i:Math.min(i,a)},B.getStyle=function(t,e){return t.currentStyle?t.currentStyle[e]:document.defaultView.getComputedStyle(t,null).getPropertyValue(e)},B.retinaScale=function(t,e){var n=t.currentDevicePixelRatio=e||"undefined"!=typeof window&&window.devicePixelRatio||1;if(1!==n){var i=t.canvas,a=t.height,r=t.width;i.height=a*n,i.width=r*n,t.ctx.scale(n,n),i.style.height||i.style.width||(i.style.height=a+"px",i.style.width=r+"px")}},B.fontString=function(t,e,n){return e+" "+t+"px "+n},B.longestText=function(t,e,n,i){var a=(i=i||{}).data=i.data||{},r=i.garbageCollect=i.garbageCollect||[];i.font!==e&&(a=i.data={},r=i.garbageCollect=[],i.font=e),t.font=e;var o,s,l,u,d,h=0,c=n.length;for(o=0;o<c;o++)if(null!=(u=n[o])&&!0!==B.isArray(u))h=B.measureText(t,a,r,h,u);else if(B.isArray(u))for(s=0,l=u.length;s<l;s++)null==(d=u[s])||B.isArray(d)||(h=B.measureText(t,a,r,h,d));var f=r.length/2;if(f>n.length){for(o=0;o<f;o++)delete a[r[o]];r.splice(0,f)}return h},B.measureText=function(t,e,n,i,a){var r=e[a];return r||(r=e[a]=t.measureText(a).width,n.push(a)),r>i&&(i=r),i},B.numberOfLabelLines=function(t){var e=1;return B.each(t,(function(t){B.isArray(t)&&t.length>e&&(e=t.length)})),e},B.color=w?function(t){return t instanceof CanvasGradient&&(t=Y.global.defaultColor),w(t)}:function(t){return console.error("Color.js not found!"),t},B.getHoverColor=function(t){return t instanceof CanvasPattern||t instanceof CanvasGradient?t:B.color(t).saturate(.5).darken(.1).rgbString()}}(),nn._adapters=on,nn.Animation=J,nn.animationService=Q,nn.controllers=Qt,nn.DatasetController=at,nn.defaults=Y,nn.Element=X,nn.elements=kt,nn.Interaction=oe,nn.layouts=pe,nn.platform=Le,nn.plugins=Re,nn.Scale=_n,nn.scaleService=Ne,nn.Ticks=sn,nn.Tooltip=qe,nn.helpers.each(gi,(function(t,e){nn.scaleService.registerScaleType(e,t,t._defaults)})),Ni)Ni.hasOwnProperty(Ei)&&nn.plugins.register(Ni[Ei]);nn.platform.initialize();var Vi=nn;return"undefined"!=typeof window&&(window.Chart=nn),nn.Chart=nn,nn.Legend=Ni.legend._element,nn.Title=Ni.title._element,nn.pluginService=nn.plugins,nn.PluginBase=nn.Element.extend({}),nn.canvasHelpers=nn.helpers.canvas,nn.layoutService=nn.layouts,nn.LinearScaleBase=Cn,nn.helpers.each(["Bar","Bubble","Doughnut","Line","PolarArea","Radar","Scatter"],(function(t){nn[t]=function(e,n){return new nn(e,nn.helpers.merge(n||{},{type:t.charAt(0).toLowerCase()+t.slice(1)}))}})),Vi}));
