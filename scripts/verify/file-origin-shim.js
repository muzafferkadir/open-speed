// file:// origin shim for offline headless verification only.
// Chrome rejects XHR on file:// (used by three's FileLoader) and strips some
// fetch options. Re-implement XHR on top of fetch, which does work for file://.
(() => {
  // Rewrite a root-absolute URL ('/audio/x.wav') to the document-relative form so
  // it resolves against the file:// directory instead of the filesystem root.
  const fix = (u) => {
    if (typeof u !== 'string') return u;
    const base = location.href.replace(/[^/]*$/, '');
    const root = location.protocol === 'file:' ? 'file:///' : location.origin + '/';
    const resolved = u.startsWith(root) ? u : (u.startsWith('/') ? root + u.slice(1) : null);
    if (!resolved) return u;
    if (resolved.startsWith(base)) return resolved; // already rebased
    return base + resolved.slice(root.length);
  };
  window.__fixUrl = fix;

  const NativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string') input = fix(input);
    else if (input && typeof input.url === 'string') input = new Request(fix(input.url), input);
    return NativeFetch(input, init);
  };

  const NativeOpen = XMLHttpRequest.prototype.open;
  const NativeSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__method = method;
    this.__url = fix(String(url));
    this.__headers = {};
    this.__async = rest[0] !== false;
    // Do not call native open: we never use the real XHR transport.
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    this.__headers[name] = value;
  };

  XMLHttpRequest.prototype.send = function (body) {
    const self = this;
    fetch(self.__url, { method: self.__method || 'GET' })
      .then(async (res) => {
        const buf = await res.arrayBuffer();
        Object.defineProperty(self, 'response', { value: self.responseType === 'arraybuffer' ? buf : new TextDecoder().decode(buf), configurable: true });
        Object.defineProperty(self, 'responseText', { value: self.responseType === 'arraybuffer' ? '' : new TextDecoder().decode(buf), configurable: true });
        Object.defineProperty(self, 'status', { value: res.status || 200, configurable: true });
        Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
        self.getAllResponseHeaders = () => [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\r\n');
        self.getResponseHeader = (k) => res.headers.get(k);
        if (self.onreadystatechange) self.onreadystatechange();
        if (self.onload) self.onload();
      })
      .catch((err) => {
        Object.defineProperty(self, 'status', { value: 0, configurable: true });
        Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
        if (self.onerror) self.onerror(err);
      });
  };

  window.__fileShim = true;

  // <audio>/<img> created with an absolute src bypass fetch/XHR entirely.
  for (const Ctor of [window.Audio]) {
    if (!Ctor) continue;
    const Native = Ctor;
    window.Audio = function (src) {
      return new Native(fix(src));
    };
    window.Audio.prototype = Native.prototype;
  }
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    get: desc.get,
    set(v) { desc.set.call(this, fix(v)); },
    configurable: true,
  });
})();
