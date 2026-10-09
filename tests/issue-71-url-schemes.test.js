'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const linesheet = fs.readFileSync(path.join(root, 'btv_calendar_linesheet_files', 'linesheet.html'), 'utf8');
const creative = fs.readFileSync(path.join(root, 'btv_calendar_linesheet_files', 'global calendar.html'), 'utf8');

const JS = 'javascript:alert(1)';
const JS_MIXED = ' \tJaVaScRiPt:alert(1)';
const DATA_HTML = 'data:text/html,alert(1)';
const DATA_SVG = 'data:image/svg+xml;base64,PHN2Zy8+';
const DATA_PNG = 'data:image/png;base64,iVBORw0KGgo=';
const DATA_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const HTTPS_LOOK = 'https://cdn.example/look.jpg';
const HTTPS_PRODUCT = 'https://cdn.example/product.jpg';
const HTTPS_REF = 'https://cdn.example/ref';
const BREAKOUT = '"><img src=x onerror=alert(1)>';

const failures = [];

function fail(message, actual) {
  failures.push({ message: message, actual: actual });
}

function extractFunction(source, name) {
  const markers = [
    'window.' + name + ' = function(',
    'window.' + name + '=function(',
    'async function ' + name + '(',
    'function ' + name + '('
  ];
  let start = -1;
  for (let m = 0; m < markers.length; m++) {
    const at = source.indexOf(markers[m]);
    if (at !== -1) {
      start = at;
      break;
    }
  }
  if (start < 0) throw new Error('missing function ' + name);
  let i = source.indexOf('(', start);
  let paren = 0;
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')') {
      paren--;
      if (paren === 0) {
        i++;
        break;
      }
    }
  }
  while (source[i] !== '{') i++;
  let depth = 0;
  let mode = 'code';
  const interp = [];
  for (; i < source.length; i++) {
    const c = source[i];
    const n = source[i + 1];
    if (mode === 'line') {
      if (c === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') {
        mode = 'code';
        i++;
      }
      continue;
    }
    if (mode === 'squote' || mode === 'dquote') {
      if (c === '\\') {
        i++;
        continue;
      }
      if ((mode === 'squote' && c === "'") || (mode === 'dquote' && c === '"')) mode = 'code';
      continue;
    }
    if (mode === 'template') {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '`') {
        mode = 'code';
        continue;
      }
      if (c === '$' && n === '{') {
        depth++;
        interp.push(depth);
        mode = 'code';
        i++;
      }
      continue;
    }
    if (c === '/' && n === '/') {
      mode = 'line';
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      mode = 'block';
      i++;
      continue;
    }
    if (c === "'") {
      mode = 'squote';
      continue;
    }
    if (c === '"') {
      mode = 'dquote';
      continue;
    }
    if (c === '`') {
      mode = 'template';
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (interp.length && depth === interp[interp.length - 1] - 1) {
        interp.pop();
        mode = 'template';
        continue;
      }
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unclosed function ' + name);
}

function isSafeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (err) {
    return false;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return true;
  return /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/]+=*$/i.test(url.href);
}

function outsideQuotes(html) {
  return String(html).replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
}

function createDocument() {
  const byId = {};

  function El(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.attrs = {};
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.value = '';
    this._html = '';
    this._src = '';
    this._href = '';
    this.style = {};
    this.dataset = {};
    this.classList = { add: function () {}, remove: function () {} };
  }

  El.prototype.setAttribute = function (name, value) {
    this.attrs[name] = String(value);
    if (name === 'id') {
      this.id = String(value);
      byId[this.id] = this;
    }
    if (name === 'class') this.className = String(value);
    if (name === 'src') this._src = String(value);
    if (name === 'href') this._href = String(value);
  };
  El.prototype.getAttribute = function (name) {
    if (name === 'src' && this._src) return this._src;
    if (name === 'href' && this._href) return this._href;
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  };
  El.prototype.appendChild = function (child) {
    this.children.push(child);
    if (child.id) byId[child.id] = child;
    return child;
  };
  El.prototype.replaceChildren = function () {
    this.children = [];
    this._html = '';
  };
  El.prototype.addEventListener = function () {};
  El.prototype.closest = function () { return this; };
  Object.defineProperty(El.prototype, 'src', {
    get: function () { return this._src; },
    set: function (value) { this._src = String(value); }
  });
  Object.defineProperty(El.prototype, 'href', {
    get: function () { return this._href; },
    set: function (value) { this._href = String(value); }
  });
  Object.defineProperty(El.prototype, 'innerHTML', {
    get: function () { return this._html; },
    set: function (value) {
      this._html = String(value);
      this.children = [];
      parseMarkup(this, this._html);
    }
  });

  function matches(el, sel) {
    if (sel.charAt(0) === '.') return el.className.split(/\s+/).indexOf(sel.slice(1)) !== -1;
    if (sel.charAt(0) === '#') return el.id === sel.slice(1);
    const attr = sel.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
    if (attr) {
      const have = el.getAttribute(attr[1]);
      if (have == null) return false;
      return attr[2] == null || have === attr[2];
    }
    return el.tagName.toLowerCase() === sel.toLowerCase();
  }

  function walk(el, visit) {
    el.children.forEach(function (child) {
      visit(child);
      walk(child, visit);
    });
  }

  El.prototype.querySelectorAll = function (sel) {
    const out = [];
    walk(this, function (el) {
      if (matches(el, sel)) out.push(el);
    });
    return out;
  };
  El.prototype.querySelector = function (sel) {
    return this.querySelectorAll(sel)[0] || null;
  };

  function parseMarkup(parent, html) {
    const re = /<([a-zA-Z][\w:-]*)([^>]*)>/g;
    let match;
    while ((match = re.exec(html))) {
      const el = new El(match[1]);
      const attrs = match[2];
      const quoted = /([:@A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;
      let attr;
      while ((attr = quoted.exec(attrs))) {
        el.setAttribute(attr[1], attr[2]);
      }
      const bare = outsideQuotes(attrs);
      const eventRe = /\s(on[a-z]+)\s*=/ig;
      let eventAttr;
      while ((eventAttr = eventRe.exec(bare))) {
        el.setAttribute(eventAttr[1], '1');
      }
      parent.appendChild(el);
    }
  }

  function make(id) {
    if (!byId[id]) {
      const el = new El('div');
      el.id = id;
      byId[id] = el;
    }
    return byId[id];
  }

  const document = {
    head: new El('head'),
    body: new El('body'),
    createElement: function (tag) { return new El(tag); },
    getElementById: function (id) { return make(id); },
    querySelectorAll: function () { return []; }
  };
  document.documentElement = new El('html');

  return {
    document: document,
    walk: function (el, visit) {
      visit(el);
      walk(el, visit);
    }
  };
}

function liveProblems(root, walk) {
  const urls = [];
  const handlers = [];
  walk(root, function (el) {
    if ((el.tagName === 'IMG' && el.src) || (el.tagName === 'A' && el.href)) {
      const value = el.tagName === 'IMG' ? el.src : el.href;
      if (!isSafeUrl(value)) urls.push(el.tagName.toLowerCase() + ' ' + value);
    }
    Object.keys(el.attrs || {}).forEach(function (name) {
      if (/^on(?:error|load)$/i.test(name)) handlers.push(name);
    });
    if (/\son(?:error|load)\s*=/i.test(outsideQuotes(el._html || ''))) handlers.push('markup');
  });
  return { urls: urls, handlers: handlers };
}

function assertClean(label, root, walk, mustHave) {
  const found = liveProblems(root, walk);
  if (found.urls.length || found.handlers.length) {
    fail(label + ' rendered an active url or handler', found);
  }
  const have = [];
  walk(root, function (el) {
    if (el.tagName === 'IMG' && el.src) have.push(el.src);
    if (el.tagName === 'A' && el.href) have.push(el.href);
  });
  mustHave.forEach(function (url) {
    if (have.indexOf(url) === -1) fail(label + ' dropped a safe url', { expected: url, have: have });
  });
}

function install(source, names, sandbox) {
  names.forEach(function (name) {
    try {
      vm.runInContext(extractFunction(source, name), sandbox);
    } catch (err) {
      throw new Error(name + ' failed to load: ' + (err && err.message));
    }
  });
}

function runPage() {
  const dom = createDocument();
  const sandbox = vm.createContext({
    URL: URL,
    document: dom.document,
    console: console,
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    products: [],
    ROW_DEFS: [],
    MKT_CSS: {}
  });
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const safePath = path.join(root, 'js', 'safe-url.js');
  if (fs.existsSync(safePath)) vm.runInContext(fs.readFileSync(safePath, 'utf8'), sandbox);

  sandbox.window.addEventListener = function () {};
  install(linesheet, ['createImageBoxHTML'], sandbox);
  const images = dom.document.createElement('div');
  images.innerHTML = sandbox.createImageBoxHTML('product', JS) + sandbox.createImageBoxHTML('lookbook', HTTPS_LOOK);
  assertClean('linesheet image box', images, dom.walk, [HTTPS_LOOK]);

  sandbox.esc = function (v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  sandbox.vfG = function (_label, html) { return '<div>' + html + '</div>'; };
  sandbox.statusPillClass = function () { return ''; };
  sandbox.formatDate = function (v) { return String(v || ''); };
  install(creative, ['openViewModal', 'openMarketingReadOnlyModal', 'renderMarketingImagesList'], sandbox);
  sandbox.openViewModal({ title: 'Drop', links: [JS, HTTPS_REF, DATA_HTML, JS_MIXED] });
  assertClean('global calendar links', dom.document.getElementById('vm-body'), dom.walk, [HTTPS_REF]);

  dom.document.getElementById('vm-body').innerHTML = '';
  sandbox.openMarketingReadOnlyModal({
    row: 'brand_events',
    title: 'Activation',
    links: [JS, HTTPS_REF],
    images: [
      { url: DATA_SVG, title: 'svg' },
      { url: HTTPS_PRODUCT, title: 'product' }
    ]
  }, 'SG');
  assertClean('marketing modal', dom.document.getElementById('vm-body'), dom.walk, [HTTPS_REF, HTTPS_PRODUCT]);

  sandbox._marketingPendingImages = [{ url: JS, name: 'bad' }, { url: HTTPS_LOOK, name: 'look' }];
  sandbox.renderMarketingImagesList();
  assertClean('marketing image list', dom.document.getElementById('mImagesList'), dom.walk, [HTTPS_LOOK]);

  sandbox.x = function (value) { return sandbox.esc(value == null ? '' : String(value)); };
  vm.runInContext(extractFunction(creative, 'img'), sandbox);
  const launch = dom.document.createElement('div');
  launch.innerHTML = sandbox.img(JS, 'Product') + sandbox.img(HTTPS_LOOK, 'Lookbook');
  assertClean('launch detail images', launch, dom.walk, [HTTPS_LOOK]);
}

function runAllowlist(sandbox) {
  if (typeof sandbox.safeResourceUrl !== 'function') {
    fail('safeResourceUrl is missing', null);
    return;
  }
  const cases = [
    [JS, 'link', ''],
    [JS_MIXED, 'link', ''],
    ['java\nscript:alert(1)', 'image', ''],
    [DATA_HTML, 'link', ''],
    [DATA_HTML, 'image', ''],
    [DATA_SVG, 'image', ''],
    ['ftp://cdn.example/a.jpg', 'image', ''],
    ['blob:https://example.com/uuid', 'image', ''],
    ['//cdn.example/a.jpg', 'link', ''],
    [HTTPS_LOOK, 'link', HTTPS_LOOK],
    ['HTTP://cdn.example/a.jpg', 'image', 'http://cdn.example/a.jpg'],
    [DATA_PNG, 'image', DATA_PNG],
    [DATA_PNG, 'link', ''],
    [DATA_JPEG, 'image', DATA_JPEG],
    [BREAKOUT, 'image', '']
  ];
  cases.forEach(function (row) {
    const actual = sandbox.safeResourceUrl(row[0], row[1]);
    if (actual !== row[2]) fail('safeResourceUrl ' + row[1], { input: row[0], expected: row[2], actual: actual });
  });
}

try {
  runPage();
} catch (err) {
  fail('page render threw', err && err.stack ? err.stack : String(err));
}

try {
  const dom = createDocument();
  const sandbox = vm.createContext({
    URL: URL,
    document: dom.document,
    console: console
  });
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const safePath = path.join(root, 'js', 'safe-url.js');
  if (fs.existsSync(safePath)) vm.runInContext(fs.readFileSync(safePath, 'utf8'), sandbox);
  runAllowlist(sandbox);
} catch (err) {
  fail('allowlist threw', err && err.stack ? err.stack : String(err));
}

if (failures.length) {
  console.error(JSON.stringify({ issue: 71, tz: process.env.TZ || '', failures: failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  issue: 71,
  tz: process.env.TZ || '',
  ok: true,
  checked: ['master', 'linesheet', 'variant', 'preview', 'links', 'marketing', 'launch', 'allowlist']
}));
