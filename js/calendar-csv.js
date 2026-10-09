(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BtvCalendarCSV = api;
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  const MARKETS = ['SG', 'TH', 'ID', 'PH', 'JP', 'CN'];
  const HEADERS = ['Entry ID', 'Product Line ID', 'Launch Title', 'Launch Date', 'Section',
    'Priority', 'Workflow Status', 'Launch Status', 'Category', 'Product Name', 'Colour',
    'Size / SKUs', 'SGD RRP', 'Markets'];
  const aliases = {
    'key level': 'priority', keylevel: 'priority', status: 'workflow status',
    'price (usd)': 'sgd rrp', 'price (sgd)': 'sgd rrp', price: 'sgd rrp',
    colours: 'colour', colors: 'colour', sizes: 'size / skus', size: 'size / skus',
    product: 'product name', category: 'category'
  };
  const id = prefix => prefix + (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const quote = value => {
    const s = String(value == null ? '' : value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  function parse(text) {
    const rows = []; let row = [], value = '', quoted = false, closed = false;
    text = String(text).replace(/^\uFEFF/, '');
    function cell() { row.push(value.trim()); value = ''; closed = false; }
    function finish() { cell(); if (row.some(Boolean)) rows.push(row); row = []; }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { value += '"'; i++; }
          else { quoted = false; closed = true; }
        } else value += ch;
      } else if (ch === ',') cell();
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        finish();
      } else if (ch === '"') {
        if (value.trim() || closed) throw new Error('Unexpected quote in CSV.');
        value = ''; quoted = true;
      } else {
        if (closed && ch.trim()) throw new Error('Unexpected text after a quoted CSV value.');
        value += ch;
      }
    }
    if (quoted) throw new Error('CSV contains an unclosed quoted value.');
    finish(); return rows;
  }
  function date(value) {
    let y, m, d, match;
    if ((match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = match;
    else if ((match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) [, d, m, y] = match;
    else if ((match = value.match(/^(\d{1,2})[- ]([A-Za-z]+)[- ](\d{4})$/))) {
      [, d, m, y] = match;
      m = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m.slice(0,3).toLowerCase()) + 1;
    } else throw new Error('Use YYYY-MM-DD or DD/MM/YYYY for Launch Date.');
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d)
      throw new Error('Invalid Launch Date: ' + value);
    return dt.toISOString().slice(0,10);
  }
  function monday(iso) {
    const dt = new Date(iso + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() - (dt.getUTCDay() + 6) % 7);
    return dt.toISOString().slice(0,10);
  }
  function markets(value) {
    if (/^(all|all markets|global)$/i.test(value)) return MARKETS.slice();
    const codes = value.split(/[,;|\s]+/).filter(Boolean).map(s => s.toUpperCase());
    const bad = codes.filter(s => !MARKETS.includes(s));
    if (bad.length) throw new Error('Unknown market code: ' + bad.join(', ') + '. Use ' + MARKETS.join(', ') + '.');
    return MARKETS.filter(s => codes.includes(s));
  }
  function entries(state) {
    const result = [];
    ['global','china','restocks'].forEach(section => {
      Object.entries(state[section] || {}).forEach(([weekId, list]) => {
        (Array.isArray(list) ? list : []).forEach(entry => result.push({entry, section, weekId}));
      });
    });
    return result;
  }
  function effectiveMarkets(section, entry) {
    if (section === 'china') return ['CN'];
    if (section === 'restocks' && !Array.isArray(entry.noLaunchMarkets) && Array.isArray(entry.markets))
      return entry.allMarkets ? MARKETS : MARKETS.filter(m => entry.markets.includes(m));
    return MARKETS.filter(m => !(entry.noLaunchMarkets || []).includes(m));
  }
  function colourIds(line, colour) {
    const tokens = value => value.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const oldTokens = tokens(line.colour || ''), newTokens = tokens(colour || '');
    const oldIds = line.colourIds || [];
    const reserved = new Set(newTokens.map(c => oldTokens.indexOf(c)).filter(i => i >= 0));
    return (newTokens.length ? newTokens : ['']).map((c,i) => {
      const previous = oldTokens.indexOf(c);
      return oldIds[previous >= 0 ? previous : !reserved.has(i) ? i : -1] || id('col_');
    });
  }
  function serialize(state) {
    const rows = [HEADERS];
    entries(state).sort((a,b) => a.weekId.localeCompare(b.weekId)).forEach(({entry:e, section}) => {
      (e.lines && e.lines.length ? e.lines : [{}]).forEach(line => rows.push([
        e.id || '', line.lineId || '', e.launchTitle || e.productTitle || '', e.launchDate || e.etaISO || '',
        section, e.keyLevel || 'brand', e.workflowStatus || 'draft', e.launchStatus || 'on_time',
        line.category || '', line.productName || line.productTitle || '', line.colour || '',
        line.size || '', line.price == null ? '' : line.price, effectiveMarkets(section,e).join(', ')
      ]));
    });
    return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n');
  }
  // Build and validate a complete plan before changing live state. Missing rows are not deletions.
  function plan(text, state, year) {
    const rows = parse(text);
    if (rows.length < 2) throw new Error('CSV contains no launch rows.');
    const headers = rows.shift().map(h => { const key = h.toLowerCase().trim(); return aliases[key] || key; });
    if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate column headings.');
    ['launch title','launch date','section'].forEach(h => {
      if (!headers.includes(h)) throw new Error('Missing column: ' + h);
    });
    const existing = entries(state), groups = new Map(), errors = [];
    rows.forEach((row, index) => {
      try {
        if (row.length !== headers.length) throw new Error('Column count does not match the header.');
        const r = Object.fromEntries(headers.map((h,i) => [h,row[i]]));
        const section = r.section.toLowerCase() === 'restock' ? 'restocks' : r.section.toLowerCase();
        if (!['global','china','restocks'].includes(section)) throw new Error('Unknown section: ' + r.section);
        if (!r['launch title'] && section !== 'restocks') throw new Error('Launch Title is required.');
        const launchDate = date(r['launch date']);
        if (+launchDate.slice(0,4) !== +year) throw new Error('Launch Date belongs to ' + launchDate.slice(0,4) + '; select that calendar year before importing.');
        let matches = r['entry id'] ? existing.filter(p => p.entry.id === r['entry id'])
          : existing.filter(p => p.section === section && (p.entry.launchTitle || p.entry.productTitle || '') === r['launch title'] && (p.entry.launchDate || p.entry.etaISO) === launchDate);
        if (r['entry id'] && !matches.length) throw new Error('Entry ID not found. Export a fresh CSV, or clear the ID to create a new launch.');
        if (matches.length > 1) throw new Error('Ambiguous launch. Use Entry ID from a fresh export.');
        const source = matches[0];
        const key = source ? source.entry.id : JSON.stringify([section, r['launch title'], launchDate]);
        const fields = {section, weekId:monday(launchDate), launchTitle:r['launch title'], launchDate};
        for (const [heading, field, allowed] of [
          ['priority','keyLevel',['brand','revenue','both']],
          ['workflow status','workflowStatus',['draft','published']],
          ['launch status','launchStatus',['on_time','delay']]
        ]) {
          if (r[heading] !== undefined) {
            const value = r[heading].toLowerCase().replace(/ /g,'_');
            if (!allowed.includes(value)) throw new Error('Invalid ' + heading + ': ' + r[heading]);
            fields[field] = value;
          }
        }
        if (r.markets) {
          const codes = markets(r.markets);
          if (section === 'china' && (codes.length !== 1 || codes[0] !== 'CN')) throw new Error('China launches must use CN only.');
          if (section !== 'china') fields.noLaunchMarkets = MARKETS.filter(m => !codes.includes(m));
          if (section === 'restocks' && source && ('markets' in source.entry || 'allMarkets' in source.entry)) {
            fields.markets = codes; fields.allMarkets = codes.length === MARKETS.length;
          }
        } else if (r.markets === '' && !source) throw new Error('Markets are required for new launches.');
        if (section === 'restocks' && source && source.entry.etaISO && !source.entry.launchDate) {
          fields.etaISO = launchDate; fields.eta = launchDate;
        }
        let group = groups.get(key);
        if (!group) {
          const entry = source ? JSON.parse(JSON.stringify(source.entry)) : {
            id:id(''), keyLevel:'brand', workflowStatus:'draft', launchStatus:'on_time', noLaunchMarkets:[], lines:[]
          };
          Object.assign(entry,fields);
          group = {entry, source, fields:JSON.stringify(fields), used:new Set()}; groups.set(key,group);
        } else if (group.fields !== JSON.stringify(fields)) throw new Error('Launch fields disagree across rows for the same Entry ID/title.');
        const list = group.entry.lines || (group.entry.lines = []);
        const lineId = r['product line id'];
        let line;
        if (lineId) {
          line = list.find(l => l.lineId === lineId);
          if (!line) throw new Error('Product Line ID not found in this launch. Clear it to add a new product.');
        } else {
          const candidates = list.filter(l => (l.productName || l.productTitle || '') === (r['product name'] || '') && (l.category || '').toUpperCase() === (r.category || '').toUpperCase());
          if (candidates.length > 1) throw new Error('Ambiguous product. Use Product Line ID from a fresh export.');
          line = candidates[0];
        }
        if (!line && !r['product name'] && !r.category && !r.colour) return;
        if (!line) { line = {lineId:id('line_'),colourIds:[]}; list.push(line); }
        if (group.used.has(line.lineId)) throw new Error('Duplicate product row. Keep one row per Product Line ID.');
        group.used.add(line.lineId);
        const oldLine = {colour:line.colour, colourIds:line.colourIds};
        for (const [heading,field] of [['category','category'],['product name','productName'],['colour','colour'],['size / skus','size'],['sgd rrp','price']]) {
          if (r[heading] !== undefined) line[field] = heading === 'category' ? r[heading].toUpperCase() : r[heading];
        }
        if (r['sgd rrp'] !== undefined) {
          line.price = line.price.replace(/^(?:SGD|S\$|\$)\s*/i,'').replace(/,/g,'');
          if (line.price && (!/^\d+(\.\d+)?$/.test(line.price) || !Number.isFinite(+line.price))) throw new Error('Invalid SGD RRP.');
        }
        // Retain identities across unchanged colours, reorders, and simple positional renames.
        line.colourIds = colourIds(oldLine, line.colour);
        if ('productTitle' in line) line.productTitle = line.productName;
        if ('colors' in line) line.colors = (line.colour || '') + (line.size ? ' / ' + line.size : '');
      } catch(error) { errors.push('Row ' + (index + 2) + ': ' + error.message); }
    });
    if (errors.length) throw new Error(errors.slice(0,10).join('\n') + (errors.length > 10 ? '\nMore invalid rows: ' + (errors.length-10) : ''));
    const changes = []; let added = 0, updated = 0, unchanged = 0;
    groups.forEach(g => {
      if (g.source && JSON.stringify(g.entry) === JSON.stringify(g.source.entry)) { unchanged++; return; }
      if (g.source) updated++; else added++;
      changes.push({entry:g.entry, source:g.source});
    });
    return {changes, added, updated, unchanged};
  }
  return {parse, date, monday, markets, serialize, plan, entries, effectiveMarkets, colourIds, id};
});
