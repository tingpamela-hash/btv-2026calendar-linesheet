(function (root) {
  var IMAGE_DATA = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/]+=*$/i;
  var slots = [];

  function safeResourceUrl(raw, kind) {
    if (raw == null) return '';
    var text = String(raw).replace(/^\s+|\s+$/g, '');
    if (!text) return '';
    var url;
    try {
      url = new URL(text);
    } catch (err) {
      return '';
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    if (kind === 'image' && url.protocol === 'data:' && IMAGE_DATA.test(url.href)) return url.href;
    return '';
  }

  function safeStoredImageUrl(raw) {
    if (raw == null) return '';
    var text = String(raw).replace(/^\s+|\s+$/g, '');
    if (!text || /[<>"']/.test(text) || /^javascript:/i.test(text) || /^data:/i.test(text)) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
      var url;
      try { url = new URL(text); } catch (err) { return ''; }
      if (url.protocol !== 'https:') return '';
      var cfg = root.BTV_SUPABASE_CONFIG || {};
      var allowed = '';
      try { allowed = new URL(String(cfg.url || '')).host; } catch (err) { allowed = ''; }
      if (!allowed || url.host !== allowed) return '';
      return url.href;
    }
    if (text.indexOf('//') !== -1 || text.indexOf('\\') !== -1 || /\s/.test(text)) return '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._~/-]*$/.test(text)) return '';
    return text;
  }

  function safeLocalImagePreview(raw) {
    var text = String(raw || '');
    if (!/^data:image\/(png|jpeg);base64,[a-z0-9+/=]+$/i.test(text)) return '';
    if (/[<>"']/.test(text)) return '';
    return text;
  }

  function btvPaintStoredImage(parent, raw, alt) {
    if (!parent || typeof document === 'undefined') return;
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    var href = safeStoredImageUrl(raw) || safeLocalImagePreview(raw);
    if (!href) {
      var empty = document.createElement('div');
      empty.className = 'ls-img-placeholder';
      empty.textContent = alt || 'No image';
      parent.appendChild(empty);
      return;
    }
    var img = document.createElement('img');
    img.className = 'ls-img';
    img.alt = alt || '';
    img.setAttribute('src', href);
    parent.appendChild(img);
  }

  function btvBeginImgSlots() {
    slots = [];
  }

  function btvImgSlot(url, alt, options) {
    options = options || {};
    if (url == null || String(url).replace(/^\s+|\s+$/g, '') === '') {
      return options.emptyHtml || '—';
    }
    var index = slots.length;
    slots.push({ url: url, alt: alt || '', options: options });
    var cls = options.className ? ' class="' + options.className + '"' : '';
    return '<span data-btv-img-slot="' + index + '"' + cls + '></span>';
  }

  function placeholderNode(type) {
    var node = document.createElement('div');
    node.className = 'placeholder';
    var label = document.createElement('span');
    label.textContent = type === 'lookbook' ? '🖼️ Lookbook image' : '📷 Product image';
    var hint = document.createElement('span');
    hint.textContent = 'JPG / PNG';
    node.appendChild(label);
    node.appendChild(document.createElement('br'));
    node.appendChild(hint);
    return node;
  }

  function imageNode(href, alt, options) {
    var img = document.createElement('img');
    img.alt = alt || '';
    if (options && options.imgClass) img.className = options.imgClass;
    if (options && options.imgStyle) img.setAttribute('style', options.imgStyle);
    img.src = href;
    return img;
  }

  function btvFillImageBox(box, type, imageData) {
    if (!box) return;
    var href = safeResourceUrl(imageData, 'image');
    if (typeof box.replaceChildren === 'function') box.replaceChildren();
    if (!href) {
      box.appendChild(placeholderNode(type));
      return;
    }
    var alt = type === 'lookbook' ? 'lookbook image' : 'product image';
    box.appendChild(imageNode(href, alt));
  }

  function btvFillImgSlots(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    var nodes = root.querySelectorAll('[data-btv-img-slot]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var slot = slots[Number(el.getAttribute('data-btv-img-slot'))];
      if (!slot) continue;
      var opts = slot.options || {};
      var href = safeResourceUrl(slot.url, 'image');
      if (typeof el.replaceChildren === 'function') el.replaceChildren();
      if (!href) {
        if (opts.blankClass) el.className += (el.className ? ' ' : '') + opts.blankClass;
        var mark = document.createElement('span');
        mark.textContent = opts.blankClass ? (slot.alt || '') : '—';
        el.appendChild(mark);
        continue;
      }
      var img = imageNode(href, slot.alt, opts);
      if (opts.link) {
        var link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.appendChild(img);
        el.appendChild(link);
      } else {
        el.appendChild(img);
      }
    }
  }

  function btvAppendSafeAnchor(parent, rawUrl, label, kind) {
    var text = label == null || label === '' ? String(rawUrl || '') : String(label);
    var href = safeResourceUrl(rawUrl, kind || 'link');
    if (!href) {
      var span = document.createElement('span');
      span.textContent = text;
      parent.appendChild(span);
      return span;
    }
    var anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = text;
    parent.appendChild(anchor);
    return anchor;
  }

  function btvAppendLinkGroup(parent, label, links) {
    if (!parent || !links || !links.length) return;
    var group = document.createElement('div');
    group.className = 'vf-group';
    var lbl = document.createElement('div');
    lbl.className = 'vf-lbl';
    lbl.textContent = label;
    var val = document.createElement('div');
    val.className = 'vf-val';
    for (var i = 0; i < links.length; i++) {
      if (i) val.appendChild(document.createElement('br'));
      btvAppendSafeAnchor(val, links[i], links[i], 'link');
    }
    group.appendChild(lbl);
    group.appendChild(val);
    parent.appendChild(group);
  }

  function btvAppendImageLinks(parent, images) {
    if (!parent || !images || !images.length) return;
    var group = document.createElement('div');
    group.className = 'vf-group';
    var lbl = document.createElement('div');
    lbl.className = 'vf-lbl';
    lbl.textContent = 'Images';
    var val = document.createElement('div');
    val.className = 'vf-val';
    images.forEach(function (img) {
      var row = document.createElement('div');
      row.style.marginBottom = '6px';
      btvAppendSafeAnchor(row, img && img.url, (img && (img.title || img.url)) || '', 'image');
      if (img && img.notes) {
        var notes = document.createElement('div');
        notes.style.fontSize = '11px';
        notes.style.color = '#888';
        notes.textContent = String(img.notes);
        row.appendChild(notes);
      }
      val.appendChild(row);
    });
    group.appendChild(lbl);
    group.appendChild(val);
    parent.appendChild(group);
  }

  root.safeResourceUrl = safeResourceUrl;
  root.safeStoredImageUrl = safeStoredImageUrl;
  root.safeLocalImagePreview = safeLocalImagePreview;
  root.btvPaintStoredImage = btvPaintStoredImage;
  root.btvBeginImgSlots = btvBeginImgSlots;
  root.btvImgSlot = btvImgSlot;
  root.btvFillImgSlots = btvFillImgSlots;
  root.btvFillImageBox = btvFillImageBox;
  root.btvAppendSafeAnchor = btvAppendSafeAnchor;
  root.btvAppendLinkGroup = btvAppendLinkGroup;
  root.btvAppendImageLinks = btvAppendImageLinks;
})(typeof globalThis !== 'undefined' ? globalThis : this);
