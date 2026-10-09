(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calendar-csv'),require('./markdown-calendar'));
  else root.BtvCalendarExport = factory(root.BtvCalendarCSV,root.BtvMarkdown);
})(typeof window === 'undefined' ? globalThis : window, function(csv,markdown) {
  'use strict';
  const SECTIONS = [{key:'global',label:'Global',bg:'D4D4D4',fg:'2D2D2D'},
    {key:'china',label:'China',bg:'C47800',fg:'FFFFFF'},
    {key:'restocks',label:'Restocks',bg:'7A5A35',fg:'FFFFFF'},
    {key:'store_openings',label:'Store Opening',bg:'D4D4D4',fg:'2D2D2D'}];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function dateLabel(iso) {
    if (!iso) return '';
    const date = new Date(iso + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime())) return '';
    return date.getUTCDate() + '-' + MONTHS[date.getUTCMonth()] + ' (' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getUTCDay()] + ')';
  }
  function card(section, entry, skuCount) {
    if(section === 'store_openings') return {
      title:entry.storeName || 'Store Opening',date:dateLabel(entry.openingDate || entry.targetOpenDate),
      published:entry.workflowStatus === 'published',delayed:false,priority:entry.keyLevel || 'brand',
      groups:[{category:entry.storeType === 'popup' ? 'Pop-up' : entry.storeType === 'permanent' ? 'Permanent' : 'Store',
        products:[{name:entry.storeName || '',colour:entry.storeAddress || '',size:'',price:''}]}],
      metadata:['Country: '+(entry.market || '-'),
        ...(entry.storeType === 'popup' && entry.closingDate ? ['Closes: '+dateLabel(entry.closingDate)] : []),
        entry.workflowStatus === 'published' ? 'Published' : 'Draft']};
    const groups = new Map();
    (entry.lines || []).forEach(line => {
      if (!line.productName && !line.productTitle && !line.category && !line.colour && !line.size) return;
      const category = line.category || (section === 'restocks' ? 'Restock' : '');
      if (!groups.has(category)) groups.set(category,[]);
      groups.get(category).push({name:line.productName || line.productTitle || '',
        colour:line.colour || '',size:line.size || '',price:line.price == null ? '' : String(line.price)});
    });
    const markets = csv.effectiveMarkets(section,entry);
    const channels = (entry.noLaunchChannelsCollapsed || []).filter(c => section !== 'china' || c.market === 'CN').map(c => c.market + ': ' + (c.stores || []).join(', '));
    const metadata = ['No. of SKUs: ' + (skuCount == null ? entry.skuCount || 0 : skuCount),
      'Launch (Mkt): ' + (markets.length === 6 ? 'Global' : markets.join(', ') || '-'),
      ...(channels.length ? channels.map(c => 'Launch (Channel): ' + c) : ['Launch (Channel): -']),
      'Launch Status: ' + (entry.launchStatus === 'delay' ? 'Delay Flagged' : 'On Time'),
      ...(entry.launchStatus === 'delay' ? (entry.delayMarkets || []).map(d => 'Delay Mkt: ' + d.market + ' | ETA ' + dateLabel(d.eta)) : []),
      entry.workflowStatus === 'published' ? 'Published' : 'Draft'];
    return {title:entry.launchTitle || entry.productTitle || 'Restock',date:dateLabel(entry.launchDate || entry.etaISO),
      published:entry.workflowStatus === 'published',delayed:entry.launchStatus === 'delay',
      priority:entry.keyLevel || 'brand',groups:Array.from(groups,([category,products]) => ({category,products})),metadata};
  }
  function escape(value) {
    return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function cardHTML(model) {
    let html = '<div class="entry ' + (model.published ? 'published' : 'draft') + (model.delayed ? ' delay' : '') + '">';
    html += '<div class="card-heading"><span class="priority-dot '+escape(model.priority)+'"></span><div><div class="ed">'+escape(model.date)+'</div><div class="et">'+escape(model.title)+'</div></div></div>';
    model.groups.forEach(group => {
      html += '<div class="export-group"><div class="export-category">'+escape(group.category)+'</div><div>';
      group.products.forEach(product => {
        html += '<div class="export-product"><div class="export-product-top"><strong class="export-name">'+escape(product.name)+'</strong>';
        if (product.price) html += '<strong class="export-price">$'+escape(product.price)+'</strong>';
        html += '</div>';
        if (product.colour) html += '<div class="export-meta">'+escape(product.colour)+'</div>';
        if (product.size) html += '<div class="export-meta">'+escape(product.size)+'</div>';
        html += '</div>';
      });
      html += '</div></div>';
    });
    model.metadata.forEach(value => { html += '<div class="em">'+escape(value)+'</div>'; });
    return html+'</div>';
  }
  function lanes(markdowns, weeks) {
    const spans = [];
    Object.values(markdowns || {}).forEach(md => {
      if (!md || !md.startDate || !md.endDate) return;
      const start = new Date(md.startDate+'T00:00:00'), end = new Date(md.endDate+'T00:00:00');
      const hits = weeks.map((w,i) => new Date(w.start) <= end && new Date(w.end) >= start ? i : -1).filter(i => i >= 0);
      if (hits.length) spans.push({md,first:hits[0],last:hits[hits.length-1]});
    });
    spans.sort((a,b) => a.first-b.first);
    const result = [];
    spans.forEach(span => {
      let lane = result.find(items => items[items.length-1].last < span.first);
      if (!lane) { lane=[]; result.push(lane); }
      lane.push(span);
    });
    return result;
  }
  function chunks(text, limit=240) {
    const result=[];let remaining=String(text);
    while (remaining.length > limit) {
      const space=remaining.lastIndexOf(' ',limit),cut=space > limit/2 ? space : limit;
      result.push(remaining.slice(0,cut));remaining=remaining.slice(cut).trimStart();
    }
    result.push(remaining);return result;
  }
  function lineCount(text,width) {
    return String(text).split('\n').reduce((sum,line) => {
      let count=1,used=0;
      line.split(/\s+/).forEach(word => {
        if (used && used+word.length+1 > width) { count++;used=0; }
        while (word.length > width) { count++;word=word.slice(width); }
        used += word.length + (used ? 1 : 0);
      });
      return sum+count;
    },0);
  }
  function localISO(value) {
    const date=new Date(value);
    return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  }
  function entriesForWeek(state, section, week) {
    if (!week) return [];
    const ids=new Set(),result=[],keys=new Set([week.id,localISO(week.start)]);
    keys.forEach(key=>((state[section] || {})[key] || []).forEach(entry=>{
      if(entry.id && ids.has(entry.id))return;
      if(entry.id)ids.add(entry.id);
      result.push(entry);
    }));
    return result;
  }
  function buildWorkbook(data, ExcelJS) {
    if (!data.weeks.length) throw new Error('No weeks in this calendar view.');
    const workbook=new ExcelJS.Workbook();workbook.creator='BTV Planner';
    const months=new Map();
    data.weeks.forEach(week => { if (!months.has(week.month)) months.set(week.month,[]);months.get(week.month).push(week); });
    for (const [month,weeks] of months) {
      const sheet=workbook.addWorksheet(month+' '+data.year,{
        views:[{state:'frozen',xSplit:1,ySplit:4,showGridLines:false,zoomScale:85}],
        pageSetup:{paperSize:8,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,
          printTitlesRow:'1:4',margins:{left:0.25,right:0.25,top:0.35,bottom:0.35,header:0.1,footer:0.1}}});
      sheet.getColumn(1).width=18;
      weeks.forEach((week,i)=>{const col=2+i*3;[8,34,10].forEach((width,j)=>{sheet.getColumn(col+j).width=width;});});
      const lastCol=1+weeks.length*3;
      function put(row,col,value,options={}) {
        if (options.span) sheet.mergeCells(row,col,row,col+options.span);
        const cell=sheet.getCell(row,col);cell.value=value;
        cell.font={name:'Arial',size:options.size || 11,bold:!!options.bold,color:{argb:'FF'+(options.fg || '111111')}};
        cell.alignment={vertical:'top',horizontal:options.align || 'left',wrapText:true,indent:options.indent || 0};
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+(options.bg || 'FFFFFF')}};
        if (options.border) cell.border=options.border;
        const width=options.width || (options.span ? 48 : col===1 ? 16 : 29);
        const height=Math.max(22,lineCount(typeof value==='object' ? value.richText.map(r=>r.text).join('') : value,width)*(options.size || 11)*1.4+10);
        sheet.getRow(row).height=Math.max(sheet.getRow(row).height || 0,height);
        return cell;
      }
      ['Quarter','Month','Week','Dates'].forEach((label,i)=>put(i+1,1,label,{bold:true,bg:'ECEAE7',size:10}));
      put(1,2,weeks[0].quarter+' '+data.year,{span:lastCol-2,bold:true,bg:'ECEAE7',align:'center'});
      put(2,2,month+' '+data.year,{span:lastCol-2,bold:true,bg:'ECEAE7',align:'center'});
      weeks.forEach((week,i)=>{
        const col=2+i*3;
        put(3,col,'Wk '+week.weekOfYear,{span:2,bold:true,bg:'ECEAE7',align:'center'});
        put(4,col,dateLabel(localISO(week.start)).replace(/ \(.*\)/,'')+' to '+dateLabel(localISO(week.end)).replace(/ \(.*\)/,''),{span:2,bg:'ECEAE7',align:'center',size:10});
      });
      let row=5;
      const mdLanes=lanes(data.markdowns,weeks);
      put(row,1,'Markdown',{bold:true,bg:'D4D4D4',size:10});
      (mdLanes.length ? mdLanes : [[]]).forEach(lane=>{
        lane.forEach(span=>put(row,2+span.first*3,(span.md.title || 'Markdown')+'\n'+dateLabel(span.md.startDate)+' to '+dateLabel(span.md.endDate)+'\n'+(markdown?markdown.scope(span.md):''),
          {span:(span.last-span.first+1)*3-1,bold:true,bg:'F5DF73',size:10,width:48*(span.last-span.first+1)}));
        row++;
      });
      for (const section of SECTIONS) {
        const sectionStart=row;
        put(row,1,section.label,{bold:true,bg:section.bg,fg:section.fg,size:10});
        const cards=weeks.map(w=>entriesForWeek(data.state,section.key,w).map(entry=>card(section.key,entry,data.skus && data.skus[entry.id])));
        const count=Math.max(1,...cards.map(c=>c.length));
        for(let slot=0;slot<count;slot++) {
          let end=row;
          cards.forEach((list,i)=>{
            const model=list[slot];if(!model)return;
            const col=2+i*3,start=row;let cursor=row;
            const bg=model.delayed?'FFF0F0':'FFFDFA';
            const full=(value,options={})=>{for(const part of chunks(value))put(cursor++,col,part,{span:2,bg,...options});};
            full(model.date,{bold:true,size:10,fg:'787470'});
            full(model.title,{bold:true,size:12});
            model.groups.forEach(group=>{
              const groupStart=cursor;
              group.products.forEach(product=>{
                let first=true;
                chunks(product.name).forEach(part=>{
                  put(cursor,col+1,part,{bold:true,bg,width:29});
                  if(first && product.price) {
                    const price=Number(product.price);
                    const cell=put(cursor,col+2,Number.isFinite(price)?price:'$'+product.price,{bold:true,bg,width:9,align:'right'});
                    if(Number.isFinite(price))cell.numFmt=Number.isInteger(price)?'"$"#,##0':'"$"#,##0.00';
                  }
                  first=false;cursor++;
                });
                [product.colour,product.size].filter(Boolean).forEach(value=>chunks(value).forEach(part=>put(cursor++,col+1,part,{span:1,bg,size:10,width:39})));
              });
              if(cursor>groupStart) {
                if(cursor-groupStart>1)sheet.mergeCells(groupStart,col,cursor-1,col);
                put(groupStart,col,group.category,{bold:true,bg,size:9,width:7});
              }
            });
            model.metadata.forEach(value=>full(value,{size:10,fg:model.delayed && value.startsWith('Launch Status')?'A82020':'555555'}));
            const edge={style:model.published?'thin':'dashed',color:{argb:'FF999999'}};
            for(let r=start;r<cursor;r++)for(let c=col;c<col+3;c++) {
              const cell=sheet.getCell(r,c);
              if(!cell.fill || !cell.fill.fgColor)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+bg}};
              cell.border={...cell.border,...(r===start?{top:edge}:{}),...(r===cursor-1?{bottom:edge}:{}),...(c===col?{left:edge}:{}),...(c===col+2?{right:edge}:{})};
            }
            end=Math.max(end,cursor);
          });
          row=end+1;sheet.getRow(row).height=10;row++;
        }
        if(row-sectionStart>1)sheet.mergeCells(sectionStart,1,row-1,1);
      }
      for(let r=5;r<row;r++)for(let c=2;c<=lastCol;c++) {
        const cell=sheet.getCell(r,c);
        if(!cell.fill || !cell.fill.fgColor)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:Math.floor((c-2)/3)%2?'FFF3F2F0':'FFFFFFFF'}};
      }
      sheet.pageSetup.printArea='A1:'+sheet.getCell(row-1,lastCol).address;
    }
    return workbook;
  }
  return {card,cardHTML,buildWorkbook,lanes,entriesForWeek};
});
