const {test} = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const exporter = require('../js/calendar-export');
function fixture() {
  const week=(id,month,no)=>{const start=new Date(id+'T00:00:00'),end=new Date(start);end.setDate(end.getDate()+6);return {id,start,end,month,quarter:'Q4',weekOfYear:no};};
  return {year:2026,weeks:[week('2026-10-05','Oct',41),week('2026-10-12','Oct',42),week('2026-11-02','Nov',45)],
    markdowns:{sale:{title:'Mid-season sale',startDate:'2026-10-06',endDate:'2026-10-18'}},skus:{launch:3},
    state:{global:{'2026-10-05':[{id:'launch',launchTitle:'Summer Launch',launchDate:'2026-10-06',
      workflowStatus:'published',keyLevel:'brand',launchStatus:'on_time',noLaunchMarkets:['CN'],
      noLaunchChannelsCollapsed:[{market:'SG',stores:['Ecomm','Store A']}],lines:[
        {category:'BAGS',productName:'Studio Tote',colour:'Navy, Black',size:'OS',price:'89'},
        {category:'BAGS',productName:'Large Studio Tote',colour:'Plum',size:'OS',price:'109'},
        {category:'MRTW',productName:'Oxford Shirt',colour:'Blue',size:'S, M, L',price:'89.50'}]}]},
      restocks:{'2026-10-12':[{id:'restock',launchTitle:'Tote restock',launchDate:'2026-10-18',workflowStatus:'draft',
        launchStatus:'delay',delayMarkets:[{market:'SG',eta:'2026-11-02'}],noLaunchMarkets:['TH','ID','PH','JP','CN'],
        lines:[{category:'BAGS',productName:'Restocked Tote',colour:'Black',size:'OS',price:'89'}]}]}}};
}
function find(sheet,text){let found;sheet.eachRow(row=>row.eachCell(cell=>{if(cell.value===text)found=cell;}));return found;}
test('store opening survives a real XLSX round trip with address, country, type and optional closing date',async()=>{
  const data=fixture();data.state.store_openings={'2026-10-05':[{id:'store',storeName:'Fixture Store',market:'SG',
    storeType:'popup',storeAddress:'123 Street',openingDate:'2026-10-09',closingDate:'2026-11-01',workflowStatus:'published'}]};
  const book=exporter.buildWorkbook(data,ExcelJS),reopened=new ExcelJS.Workbook();
  await reopened.xlsx.load(await book.xlsx.writeBuffer());const sheet=reopened.getWorksheet('Oct 2026');
  for(const value of ['Store Opening','Fixture Store','Pop-up','123 Street','Country: SG','Closes: 1-Nov (Sun)'])assert.ok(find(sheet,value),value);
});
test('title-free restocks export with product name, size and a Restock side label', async () => {
  const data=fixture(),entry=data.state.restocks['2026-10-12'][0];
  entry.launchTitle='';entry.lines[0].category='';entry.lines[0].price='';
  const model=exporter.card('restocks',entry);
  assert.equal(model.title,'Restock');assert.equal(model.groups[0].category,'Restock');
  assert.equal(model.groups[0].products[0].price,'');
  const html=exporter.cardHTML(model);assert.ok(html.includes('Restocked Tote'));assert.ok(html.includes('OS'));
  const book=exporter.buildWorkbook(data,ExcelJS),bytes=await book.xlsx.writeBuffer();
  const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(bytes);
  const sheet=reopened.getWorksheet('Oct 2026'),product=find(sheet,'Restocked Tote');
  assert.ok(product);assert.equal(sheet.getCell(product.row,product.col-1).value,'Restock');
  assert.ok(find(sheet,'OS'));assert.equal(sheet.getCell(product.row,product.col+1).value,null);
});
test('real XLSX round trip has monthly worksheets, frozen headings and separate category/product/price columns',async()=>{
  const data=fixture(),before=JSON.stringify(data),book=exporter.buildWorkbook(data,ExcelJS);
  const bytes=await book.xlsx.writeBuffer();assert.equal(bytes[0],80);assert.equal(bytes[1],75);
  const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(bytes);
  assert.deepEqual(reopened.worksheets.map(s=>s.name),['Oct 2026','Nov 2026']);
  const sheet=reopened.getWorksheet('Oct 2026'),name=find(sheet,'Studio Tote');
  assert.ok(name);assert.equal(name.col,3);assert.equal(name.font.bold,true);
  assert.equal(sheet.getCell(name.row,2).value,'BAGS');assert.equal(sheet.getCell(name.row,4).value,89);
  assert.equal(sheet.getCell(name.row,4).font.bold,true);assert.equal(sheet.getCell(name.row,4).numFmt,'"$"#,##0');
  assert.equal(find(sheet,'Summer Launch').font.bold,true);assert.equal(!!find(sheet,'Navy, Black').font.bold,false);
  assert.ok(find(sheet,'S, M, L'));assert.equal(sheet.views[0].xSplit,1);assert.equal(sheet.views[0].ySplit,4);
  assert.equal(sheet.getColumn(3).width,34);assert.equal(sheet.pageSetup.fitToHeight,0);
  assert.equal(JSON.stringify(data),before);
});
test('PDF model uses the same grouped products, bold text and category-side hierarchy without unsafe HTML',()=>{
  const entry=fixture().state.global['2026-10-05'][0];entry.launchTitle='<script>alert(1)</script>';
  const model=exporter.card('global',entry,3),html=exporter.cardHTML(model);
  assert.equal(model.groups.length,2);assert.equal(model.groups[0].products.length,2);
  assert.ok(html.includes('class="export-category">BAGS'));assert.ok(html.includes('<strong class="export-name">Studio Tote'));
  assert.ok(html.includes('<strong class="export-price">$89'));assert.ok(html.includes('Navy, Black'));
  assert.ok(html.includes('S, M, L'));assert.ok(html.includes('No. of SKUs: 3'));assert.ok(!html.includes('<script>'));
});
test('long product text is split across rows rather than clipped at Excel maximum row height',()=>{
  const data=fixture(),text='Navy, Black, Plum, Mustard, Lilac, Blue, '.repeat(70);
  data.state.global['2026-10-05'][0].lines[0].colour=text;
  const sheet=exporter.buildWorkbook(data,ExcelJS).getWorksheet('Oct 2026');
  const pieces=[];sheet.eachRow(row=>{assert.ok((row.height || 18)<=409.5,'Row exceeds Excel height limit');row.eachCell(cell=>{
    if(typeof cell.value==='string' && cell.value.includes('Navy, Black, Plum'))pieces.push(cell.value);
  });});
  assert.ok(pieces.length>5);assert.ok(sheet.rowCount>30);
});
test('multiple launches, restock products, delay flags, markets and markdown spans are retained',()=>{
  const data=fixture();data.state.global['2026-10-05'].push({...data.state.global['2026-10-05'][0],id:'second',launchTitle:'Second launch'});
  const sheet=exporter.buildWorkbook(data,ExcelJS).getWorksheet('Oct 2026');
  for(const value of ['Second launch','Tote restock','Restocked Tote','Delay Mkt: SG | ETA 2-Nov (Mon)','Launch (Mkt): SG'])assert.ok(find(sheet,value),value);
  const delay=find(sheet,'Launch Status: Delay Flagged');assert.equal(delay.fill.fgColor.argb,'FFFFF0F0');
  assert.equal(find(sheet,'Mid-season sale\n6-Oct (Tue) to 18-Oct (Sun)').isMerged,true);
});
test('empty calendars produce valid worksheets and empty view fails clearly',()=>{
  const data=fixture();data.state={};data.markdowns={};assert.ok(exporter.buildWorkbook(data,ExcelJS).worksheets.length===2);
  assert.throws(()=>exporter.buildWorkbook({...data,weeks:[]},ExcelJS),/No weeks/);
});
test('local Monday and legacy UTC-shifted week keys both export without duplicating launches',()=>{
  const data=fixture(),week=data.weeks[0],entry=data.state.global[week.id][0];
  week.id='2026-10-04';data.state.global['2026-10-04']=[entry];
  assert.equal(exporter.entriesForWeek(data.state,'global',week).length,1);
  const sheet=exporter.buildWorkbook(data,ExcelJS).getWorksheet('Oct 2026');
  assert.ok(find(sheet,'Studio Tote'));
});
test('China export cards do not show channels from other markets',()=>{
  const entry=fixture().state.global['2026-10-05'][0];
  entry.noLaunchChannelsCollapsed.push({market:'CN',stores:['China Ecomm']});
  const model=exporter.card('china',entry,3);
  assert.ok(model.metadata.includes('Launch (Channel): CN: China Ecomm'));
  assert.ok(!model.metadata.some(text=>text.startsWith('Launch (Channel): SG')));
});
