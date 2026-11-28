/* AutoPost Pro — Legacy iOS (iOS 10–15 Safari / WKWebView) Compatibility Shim (Pure ES5) */
(function (w, d) {
    'use strict';

    // 1. globalThis (iOS < 12.2)
    if (typeof w.globalThis === 'undefined') {
        try {
            Object.defineProperty(w, 'globalThis', {
                value: w,
                writable: true,
                configurable: true
            });
        } catch (e) {
            w.globalThis = w;
        }
    }

    // 2. queueMicrotask (iOS < 12.2)
    if (typeof w.queueMicrotask !== 'function') {
        w.queueMicrotask = function (cb) {
            if (typeof Promise === 'function') {
                Promise.resolve().then(cb).catch(function (err) {
                    setTimeout(function () { throw err; }, 0);
                });
            } else {
                setTimeout(cb, 0);
            }
        };
    }

    // 3. Object.values & Object.entries (iOS < 10.3)
    if (typeof Object.values !== 'function') {
        Object.values = function (obj) {
            var res = [];
            var keys = Object.keys(obj);
            for (var i = 0; i < keys.length; i++) {
                res.push(obj[keys[i]]);
            }
            return res;
        };
    }
    if (typeof Object.entries !== 'function') {
        Object.entries = function (obj) {
            var res = [];
            var keys = Object.keys(obj);
            for (var i = 0; i < keys.length; i++) {
                res.push([keys[i], obj[keys[i]]]);
            }
            return res;
        };
    }

    // 4. Object.fromEntries (iOS < 12.2)
    if (typeof Object.fromEntries !== 'function') {
        Object.fromEntries = function (iterable) {
            var obj = {};
            if (!iterable) return obj;
            if (Array.isArray(iterable)) {
                for (var i = 0; i < iterable.length; i++) {
                    var pair = iterable[i];
                    if (pair && pair.length >= 2) obj[pair[0]] = pair[1];
                }
                return obj;
            }
            if (typeof iterable.forEach === 'function') {
                iterable.forEach(function (val, key) {
                    obj[key] = val;
                });
            }
            return obj;
        };
    }

    // 5. Object.hasOwn (iOS < 15.4)
    if (typeof Object.hasOwn !== 'function') {
        Object.hasOwn = function (obj, prop) {
            if (obj === null || obj === undefined) {
                throw new TypeError('Cannot convert undefined or null to object');
            }
            return Object.prototype.hasOwnProperty.call(Object(obj), prop);
        };
    }

    // 6. Array.prototype.flat & flatMap (iOS < 12.0)
    if (typeof Array.prototype.flat !== 'function') {
        Array.prototype.flat = function (depth) {
            var d = depth === undefined ? 1 : Number(depth);
            var flatten = function (arr, curDepth) {
                var out = [];
                for (var i = 0; i < arr.length; i++) {
                    if (Array.isArray(arr[i]) && curDepth > 0) {
                        out = out.concat(flatten(arr[i], curDepth - 1));
                    } else if (i in arr) {
                        out.push(arr[i]);
                    }
                }
                return out;
            };
            return flatten(this, isNaN(d) ? 0 : d);
        };
    }
    if (typeof Array.prototype.flatMap !== 'function') {
        Array.prototype.flatMap = function (callback, thisArg) {
            return Array.prototype.map.call(this, callback, thisArg).flat(1);
        };
    }

    // 7. Array.prototype.at & String.prototype.at (iOS < 15.4)
    if (typeof Array.prototype.at !== 'function') {
        Array.prototype.at = function (n) {
            var idx = Math.trunc ? Math.trunc(n) : (n < 0 ? Math.ceil(n) : Math.floor(n));
            if (isNaN(idx)) idx = 0;
            if (idx < 0) idx += this.length;
            if (idx < 0 || idx >= this.length) return undefined;
            return this[idx];
        };
    }
    if (typeof String.prototype.at !== 'function') {
        String.prototype.at = function (n) {
            var idx = Math.trunc ? Math.trunc(n) : (n < 0 ? Math.ceil(n) : Math.floor(n));
            if (isNaN(idx)) idx = 0;
            if (idx < 0) idx += this.length;
            if (idx < 0 || idx >= this.length) return undefined;
            return this.charAt(idx);
        };
    }

    // 8. String.prototype.replaceAll, trimStart, trimEnd (iOS < 13.4 / < 12.0)
    if (typeof String.prototype.replaceAll !== 'function') {
        String.prototype.replaceAll = function (search, replacement) {
            if (search instanceof RegExp) {
                if (!search.global) {
                    throw new TypeError('replaceAll must be called with a global RegExp');
                }
                return this.replace(search, replacement);
            }
            var str = String(this);
            var find = String(search);
            if (find === '') return str;
            if (typeof replacement === 'function') {
                var parts = str.split(find);
                var result = '';
                var offset = 0;
                for (var i = 0; i < parts.length; i++) {
                    result += parts[i];
                    offset += parts[i].length;
                    if (i < parts.length - 1) {
                        result += replacement(find, offset, str);
                        offset += find.length;
                    }
                }
                return result;
            }
            return str.split(find).join(String(replacement));
        };
    }
    if (typeof String.prototype.trimStart !== 'function') {
        String.prototype.trimStart = String.prototype.trimLeft || function () {
            return this.replace(/^\s+/, '');
        };
    }
    if (typeof String.prototype.trimEnd !== 'function') {
        String.prototype.trimEnd = String.prototype.trimRight || function () {
            return this.replace(/\s+$/, '');
        };
    }

    // 9. Promise.prototype.finally (iOS < 11.1) & Promise.allSettled (iOS < 13.0)
    if (typeof Promise === 'function') {
        if (typeof Promise.prototype.finally !== 'function') {
            Promise.prototype.finally = function (onFinally) {
                var P = this.constructor || Promise;
                return this.then(
                    function (value) {
                        return P.resolve(typeof onFinally === 'function' ? onFinally() : undefined).then(function () { return value; });
                    },
                    function (reason) {
                        return P.resolve(typeof onFinally === 'function' ? onFinally() : undefined).then(function () { throw reason; });
                    }
                );
            };
        }
        if (typeof Promise.allSettled !== 'function') {
            Promise.allSettled = function (promises) {
                var list = Array.prototype.slice.call(promises || []);
                return Promise.all(list.map(function (p) {
                    return Promise.resolve(p).then(
                        function (value) { return { status: 'fulfilled', value: value }; },
                        function (reason) { return { status: 'rejected', reason: reason }; }
                    );
                }));
            };
        }
    }

    // 10. structuredClone fallback (iOS < 15.4)
    if (typeof w.structuredClone !== 'function') {
        w.structuredClone = function (val) {
            if (val === undefined || val === null || typeof val !== 'object') return val;
            try {
                return JSON.parse(JSON.stringify(val));
            } catch (e) {
                return val;
            }
        };
    }

    // 11. DOM Helpers: NodeList.forEach, Element.matches/closest/remove
    if (typeof w.NodeList === 'function' && !w.NodeList.prototype.forEach) {
        w.NodeList.prototype.forEach = Array.prototype.forEach;
    }
    if (typeof w.Element === 'function') {
        if (!w.Element.prototype.matches) {
            w.Element.prototype.matches =
                w.Element.prototype.webkitMatchesSelector ||
                w.Element.prototype.msMatchesSelector;
        }
        if (!w.Element.prototype.closest) {
            w.Element.prototype.closest = function (s) {
                var el = this;
                while (el && el.nodeType === 1) {
                    if (el.matches(s)) return el;
                    el = el.parentElement || el.parentNode;
                }
                return null;
            };
        }
        if (!w.Element.prototype.remove) {
            w.Element.prototype.remove = function () {
                if (this.parentNode) this.parentNode.removeChild(this);
            };
        }
    }

    // 12. URLSearchParams minimal polyfill (iOS < 10.3)
    if (typeof w.URLSearchParams !== 'function') {
        w.URLSearchParams = function (search) {
            this._map = {};
            var str = String(search || '').replace(/^\?/, '');
            if (!str) return;
            var pairs = str.split('&');
            for (var i = 0; i < pairs.length; i++) {
                var idx = pairs[i].indexOf('=');
                var k = idx === -1 ? pairs[i] : pairs[i].slice(0, idx);
                var v = idx === -1 ? '' : pairs[i].slice(idx + 1);
                try {
                    k = decodeURIComponent(k.replace(/\+/g, ' '));
                    v = decodeURIComponent(v.replace(/\+/g, ' '));
                } catch (e) {}
                if (k) this._map[k] = v;
            }
        };
        w.URLSearchParams.prototype.get = function (k) {
            return Object.prototype.hasOwnProperty.call(this._map, k) ? this._map[k] : null;
        };
        w.URLSearchParams.prototype.has = function (k) {
            return Object.prototype.hasOwnProperty.call(this._map, k);
        };
        w.URLSearchParams.prototype.set = function (k, v) {
            this._map[String(k)] = String(v);
        };
        w.URLSearchParams.prototype.toString = function () {
            var out = [];
            for (var k in this._map) {
                if (Object.prototype.hasOwnProperty.call(this._map, k)) {
                    out.push(encodeURIComponent(k) + '=' + encodeURIComponent(this._map[k]));
                }
            }
            return out.join('&');
        };
    }

    // 13. Safe matchMedia fallback
    if (typeof w.matchMedia !== 'function') {
        w.matchMedia = function () {
            return {
                matches: false,
                media: '',
                addListener: function () {},
                removeListener: function () {},
                addEventListener: function () {},
                removeEventListener: function () {}
            };
        };
    }

    // 14. Detect iOS Safari Private Browsing localStorage crash & patch safely
    try {
        var testKey = '__autopost_ios_test__';
        w.localStorage.setItem(testKey, '1');
        w.localStorage.removeItem(testKey);
    } catch (e) {
        var memStore = {};
        try {
            Object.defineProperty(w, 'localStorage', {
                configurable: true,
                value: {
                    getItem: function (k) { return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null; },
                    setItem: function (k, v) { memStore[String(k)] = String(v); },
                    removeItem: function (k) { delete memStore[String(k)]; },
                    clear: function () { memStore = {}; }
                }
            });
        } catch (err) {}
    }

    // 15. Dynamic --app-vh CSS variable for iOS 10–15.3 (where 100dvh is unsupported)
    function updateAppVh() {
        try {
            var vh = w.innerHeight * 0.01;
            d.documentElement.style.setProperty('--app-vh', vh + 'px');
        } catch (e) {}
    }
    updateAppVh();
    w.addEventListener('resize', updateAppVh);
    w.addEventListener('orientationchange', function () {
        setTimeout(updateAppVh, 150);
    });

    // 16. Detect Flexbox gap support (iOS 10–14.4 do NOT support flex gap!)
    function checkFlexGap() {
        try {
            var flex = d.createElement('div');
            flex.style.display = 'flex';
            flex.style.flexDirection = 'column';
            flex.style.rowGap = '1px';
            flex.appendChild(d.createElement('div'));
            flex.appendChild(d.createElement('div'));
            var parent = d.body || d.documentElement;
            parent.appendChild(flex);
            var isSupported = flex.scrollHeight === 1;
            parent.removeChild(flex);
            if (!isSupported) {
                d.documentElement.className += (d.documentElement.className ? ' ' : '') + 'no-flex-gap';
            }
        } catch (e) {}
    }
    if (d.readyState === 'loading') {
        d.addEventListener('DOMContentLoaded', checkFlexGap);
    } else {
        checkFlexGap();
    }

    // 17. Helper to detect legacy iOS Safari / WKWebView for OAuth redirect fallback
    w.__IS_IOS_BROWSER__ = (function () {
        try {
            var ua = w.navigator.userAgent || '';
            return /iP(ad|hone|od)/i.test(ua) || (w.navigator.platform === 'MacIntel' && w.navigator.maxTouchPoints > 1);
        } catch (e) {
            return false;
        }
    })();
})(window, document);
