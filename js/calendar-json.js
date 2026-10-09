(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calendar-csv'),require('./calendar-entry'));
  else root.BtvCalendarJSON = factory(root.BtvCalendarCSV,root.BtvCalendarEntry);
})(typeof window === 'undefined' ? globalThis : window, function(csv,calendarEntry) {
  'use strict';
  const FORMAT = 'btv-management-calendar';
  const SECTIONS = ['global','china','restocks','store_openings'];
  const MARKETS = csv.markets('All');
  const clone = value => JSON.parse(JSON.stringify(value));
  function entries(state){
    return csv.entries(state).concat(Object.entries(state.store_openings || {}).flatMap(([weekId,list]) =>
      list.map(entry => ({entry,section:'store_openings',weekId}))));
  }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object.');
  }
  function text(value, label) {
    if (typeof value !== 'string') throw new Error(label + ' must be text.');
    return value.trim();
  }
  function codes(value, label) {
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new Error(label + ' must be a list of market codes.');
    return csv.markets(value.join(','));
  }
  function serialize(state, year) {
    return JSON.stringify({format:FORMAT, schemaVersion:1, year, entries:entries(state).map(({entry,section}) => {
      const result = clone(entry);
      result.section = section;
      if(section !== 'store_openings') result.markets = csv.effectiveMarkets(section,entry);
      if (section === 'china') {
        if (Array.isArray(result.noLaunchChannelsCollapsed))
          result.noLaunchChannelsCollapsed = result.noLaunchChannelsCollapsed.filter(channel => channel.market === 'CN');
        if (Array.isArray(result.delayMarkets)) {
          result.delayMarkets = result.delayMarkets.filter(delay => delay.market === 'CN');
          if (result.launchStatus === 'delay' && !result.delayMarkets.length) result.launchStatus = 'on_time';
        }
      }
      delete result.noLaunchMarkets;
      delete result.allMarkets;
      delete result.weekId;
      delete result.updatedBy;
      return result;
    })}, null, 2);
  }
  function read(textValue) {
    const parsed = JSON.parse(textValue.replace(/^\uFEFF/, ''), (key,value) => {
      if (['__proto__','prototype','constructor'].includes(key)) throw new Error('Unsupported property: ' + key);
      return value;
    });
    object(parsed,'Calendar export');
    if ('format' in parsed && parsed.format !== FORMAT) throw new Error('This JSON belongs to a different export format.');
    if ('schemaVersion' in parsed && parsed.schemaVersion !== 1) throw new Error('Unsupported JSON schema version.');
    if ('entries' in parsed) {
      if (!Array.isArray(parsed.entries)) throw new Error('entries must be a list.');
      return parsed.entries;
    }
    const state = 'state' in parsed ? parsed.state : parsed;
    object(state,'Calendar state');
    const unsupported = Object.keys(state).filter(k => !SECTIONS.includes(k));
    if (unsupported.length) throw new Error('Unsupported calendar sections: ' + unsupported.join(', ') + '. Import a current Management Calendar export.');
    const records = [];
    Object.entries(state).forEach(([section,weeks]) => {
      object(weeks,section);
      Object.values(weeks).forEach(list => {
        if (!Array.isArray(list)) throw new Error(section + ' weeks must contain lists of launches.');
        list.forEach(entry => { object(entry,'Launch'); records.push({...entry, section}); });
      });
    });
    return records;
  }
  function plan(textValue, state, year) {
    const records = read(textValue);
    if (!records.length) throw new Error('JSON contains no launch records.');
    const existing = entries(state), seen = new Set(), errors = [], planned = [];
    records.forEach((raw,index) => {
      try {
        object(raw,'Launch');
        if (raw.id !== undefined && typeof raw.id !== 'string') throw new Error('Entry ID must be text.');
        const section = text(raw.section,'Section').toLowerCase();
        if (!SECTIONS.includes(section)) throw new Error('Unknown section: ' + section);
        if(section === 'store_openings'){
          const matches = existing.filter(p => p.section === section && (raw.id ? p.entry.id === raw.id :
            p.entry.storeName === raw.storeName && calendarEntry.dateOf(p.entry) === calendarEntry.dateOf(raw)));
          if(raw.id && !matches.length) throw new Error('Entry ID not found. Export a fresh JSON, or clear the ID to add a store.');
          if(matches.length > 1) throw new Error('Ambiguous store. Use Entry ID.');
          const source = matches[0];
          const entry = calendarEntry.store({...source?.entry,...raw,storeType:raw.storeType || source?.entry.storeType || 'permanent'},year);
          entry.id = source ? source.entry.id : csv.id(''); entry.section = section;
          entry.workflowStatus = entry.workflowStatus || 'draft';
          if(!['draft','published'].includes(entry.workflowStatus)) throw new Error('Invalid workflowStatus.');
          const key = source ? source.entry.id : JSON.stringify([section,entry.storeName,entry.openingDate]);
          if(seen.has(key)) throw new Error('Duplicate store record.');
          seen.add(key); delete entry.updatedBy;
          if(source?.entry.updatedBy) entry.updatedBy = source.entry.updatedBy;
          planned.push({entry,source}); return;
        }
        const launchTitle = text(raw.launchTitle === undefined ? raw.productTitle ?? (section === 'restocks' ? '' : undefined) : raw.launchTitle,'Launch Title');
        if (!launchTitle && section !== 'restocks') throw new Error('Launch Title is required.');
        const launchDate = csv.date(text(raw.launchDate || raw.etaISO,'Launch Date'));
        if (+launchDate.slice(0,4) !== +year) throw new Error('Launch Date belongs to ' + launchDate.slice(0,4) + '; select that calendar year before importing.');
        const matches = raw.id ? existing.filter(p => p.entry.id === raw.id) : existing.filter(p =>
          p.section === section && (p.entry.launchTitle || p.entry.productTitle || '') === launchTitle && (p.entry.launchDate || p.entry.etaISO) === launchDate);
        if (raw.id && !matches.length) throw new Error('Entry ID not found. Export a fresh JSON, or clear the entry and product IDs to add a new launch.');
        if (matches.length > 1) throw new Error('Ambiguous launch. Use Entry ID from a fresh export.');
        const source = matches[0], key = source ? source.entry.id : JSON.stringify([section,launchTitle,launchDate]);
        if (seen.has(key)) throw new Error('Duplicate launch record.');
        seen.add(key);
        const entry = {...(source ? clone(source.entry) : {keyLevel:'brand',workflowStatus:'draft',launchStatus:'on_time',noLaunchMarkets:[],lines:[]}), ...raw};
        entry.id = source ? source.entry.id : csv.id('');
        entry.section = section; entry.launchTitle = launchTitle; entry.launchDate = launchDate; entry.weekId = csv.monday(launchDate);
        if (source && 'updatedBy' in source.entry) entry.updatedBy = source.entry.updatedBy;
        else delete entry.updatedBy;
        for (const [field,allowed] of [['keyLevel',['brand','revenue','both']],['workflowStatus',['draft','published']],['launchStatus',['on_time','delay']]]) {
          entry[field] = text(entry[field],field).toLowerCase();
          if (!allowed.includes(entry[field])) throw new Error('Invalid ' + field + ': ' + entry[field]);
        }
        let launching;
        if ('allMarkets' in raw && typeof raw.allMarkets !== 'boolean') throw new Error('allMarkets must be true or false.');
        if ('noLaunchMarkets' in raw) {
          const excluded = codes(raw.noLaunchMarkets,'noLaunchMarkets');
          launching = section === 'china' ? ['CN'] : MARKETS.filter(m => !excluded.includes(m));
        } else if ('markets' in raw) {
          launching = raw.allMarkets === true ? MARKETS : codes(raw.markets,'Markets');
        } else launching = source ? csv.effectiveMarkets(source.section,source.entry) : section === 'china' ? ['CN'] : MARKETS;
        if (section === 'china' && (launching.length !== 1 || launching[0] !== 'CN')) throw new Error('China launches must use CN only.');
        if (section !== 'china') entry.noLaunchMarkets = MARKETS.filter(m => !launching.includes(m));
        if (source && 'markets' in source.entry) entry.markets = launching;
        else delete entry.markets;
        if (source && 'allMarkets' in source.entry) entry.allMarkets = launching.length === MARKETS.length;
        else delete entry.allMarkets;
        if ('skuCount' in raw && (!Number.isInteger(raw.skuCount) || raw.skuCount < 0)) throw new Error('skuCount must be a non-negative whole number.');
        if ('delayMarkets' in raw) {
          if (!Array.isArray(raw.delayMarkets)) throw new Error('delayMarkets must be a list.');
          const used = new Set();
          entry.delayMarkets = raw.delayMarkets.map(delay => {
            object(delay,'Delay'); const market = csv.markets(text(delay.market,'Delay market'));
            if (market.length !== 1 || used.has(market[0])) throw new Error('Delay markets must be unique individual market codes.');
            if (section === 'china' && market[0] !== 'CN') throw new Error('China delay markets must use CN only.');
            used.add(market[0]);
            return {market:market[0], eta:csv.date(text(delay.eta,'Delay ETA'))};
          });
        }
        if ('noLaunchChannelsCollapsed' in raw) {
          if (!Array.isArray(raw.noLaunchChannelsCollapsed)) throw new Error('Launch channels must be a list.');
          entry.noLaunchChannelsCollapsed = raw.noLaunchChannelsCollapsed.map(channel => {
            object(channel,'Launch channel'); const market = csv.markets(text(channel.market,'Channel market'));
            if (market.length !== 1 || !Array.isArray(channel.stores) || channel.stores.some(s => typeof s !== 'string'))
              throw new Error('Each launch channel needs a market and a list of stores.');
            if (section === 'china' && market[0] !== 'CN') throw new Error('China launch channels must use CN only.');
            return {market:market[0],stores:channel.stores.slice()};
          });
        }
        const oldLines = source ? source.entry.lines || [] : [], used = new Set(), lines = [];
        if ('lines' in raw) {
          if (!Array.isArray(raw.lines)) throw new Error('Product lines must be a list.');
          raw.lines.forEach(line => {
            object(line,'Product line');
            if (line.lineId !== undefined && typeof line.lineId !== 'string') throw new Error('Product Line ID must be text.');
            if ('colourIds' in line && (!Array.isArray(line.colourIds) || line.colourIds.some(value => typeof value !== 'string')))
              throw new Error('Colour IDs must be a list of text values.');
            const candidates = line.lineId ? oldLines.filter(l => l.lineId === line.lineId) : oldLines.filter(l =>
              (l.productName || l.productTitle || '') === (line.productName || line.productTitle || '') && (l.category || '') === (line.category || ''));
            if (line.lineId && !candidates.length) throw new Error('Product Line ID not found. Clear it to add a new product.');
            if (candidates.length > 1) throw new Error('Ambiguous product. Use Product Line ID.');
            const before = candidates[0] || {}, merged = {...clone(before),...line};
            merged.lineId = before.lineId || csv.id('line_');
            if (used.has(merged.lineId)) throw new Error('Duplicate Product Line ID.');
            used.add(merged.lineId);
            for (const field of ['category','productName','colour','size','price']) {
              const value = merged[field] === undefined ? field === 'productName' ? merged.productTitle || '' : '' : merged[field];
              merged[field] = field === 'price' && typeof value === 'number' ? String(value) : text(value,field);
            }
            if (merged.price && !/^\d+(\.\d+)?$/.test(merged.price)) throw new Error('Invalid product price.');
            merged.colourIds = csv.colourIds(before,merged.colour);
            if ('productTitle' in before) merged.productTitle = merged.productName;
            lines.push(merged);
          });
          entry.lines = lines.concat(oldLines.filter(l => !used.has(l.lineId)).map(clone));
        }
        planned.push({entry,source});
      } catch(error) { errors.push('Launch ' + (index+1) + ': ' + error.message); }
    });
    if (errors.length) throw new Error(errors.slice(0,10).join('\n'));
    const changes = []; let added=0,updated=0,unchanged=0;
    planned.forEach(change => {
      if (change.source && JSON.stringify(change.entry) === JSON.stringify(change.source.entry)) { unchanged++; return; }
      if (change.source) updated++; else added++;
      changes.push(change);
    });
    return {changes,added,updated,unchanged};
  }
  return {serialize,plan};
});
