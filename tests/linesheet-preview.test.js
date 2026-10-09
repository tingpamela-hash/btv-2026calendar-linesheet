const test=require('node:test');
const assert=require('node:assert/strict');
const {groupProducts}=require('../js/linesheet-preview.js');
const {launchOrder,measurementValue}=require('../js/linesheet-preview.js');

test('preview order follows calendar products and colours with stable unmatched fallback',()=>{
  const rows=[{name:'Shirt',variant:'Blue'},{name:'Bag',variant:'Cherry'},{name:'Bag',variant:'Plum'},{name:'Other',variant:''}];
  const ordered=launchOrder(rows,[{productName:'Bag',colour:'Plum'},{productName:'Shirt',colour:'Blue'},{productName:'Bag',colour:'Cherry'}]);
  assert.deepEqual(ordered.map(p=>p.name+'|'+p.variant),['Bag|Plum','Shirt|Blue','Bag|Cherry','Other|']);
  assert.equal(rows[0].name,'Shirt');
});
test('measurement units retain entered values and zero, convert missing units, and leave missing data blank',()=>{
  assert.equal(measurementValue({inch:'20',cm:'50.8'},'cm'),'50.8cm');
  assert.equal(measurementValue({inch:'20'},'cm'),'50.8cm');
  assert.equal(measurementValue({cm:0},'inch'),'0in');
  assert.equal(measurementValue({},'cm'),'—');
  assert.equal(measurementValue({cm:'50.8cm'},'cm'),'50.8cm');
});

test('measurements survive empty first records, legacy maps and shared colour records',()=>{
  const result=groupProducts([
    {name:'Shirt',variant:'Blue',size:'S',measurementMatrix:[]},
    {name:'Shirt',variant:'Blue',size:'M',measurementMatrix:[{point:'Chest',values:[{size:'S',inch:0,cm:'0'},{size:'M',inch:'20',cm:'50.8'}],tolerance:0}]},
    {name:'Shirt',variant:'Red',size:'L',measurementMatrix:[{label:'Chest',values:{L:{inch:'22',cm:'55.88'}}}]}
  ]);
  assert.equal(result[0].measurementMatrix.length,1);
  assert.deepEqual(result[0].measurementSizes,['S','M','L']);
  assert.equal(result[0].measurementMatrix[0].values[0].inch,0);
  assert.equal(result[1].measurementMatrix[0].values[1].cm,'50.8');
  assert.equal(result[0].measurementMatrix[0].tolerance,0);
});
test('approval status needs both scopes on every size',()=>{
  const yes={designer:{approved:true},sc:{approved:true},merch:{approved:true}};
  const [p]=groupProducts([{name:'Bag',variant:'Red',generalApprovals:yes,variantApprovals:yes},{name:'Bag',variant:'Red',generalApprovals:yes,variantApprovals:{}}]);
  assert.equal(p.approvedDesigner,false);assert.equal(p.generalApprovals.designer.approved,true);
});

test('one name/colour card includes size-level scalar codes and barcode-only sizes',()=>{
  const rows=[
    {name:'Oxford Shirt',variant:'Blue',size:'M',sku:'SKU-M',barcode:'BC-M',approvedSC:true},
    {name:' oxford shirt ',variant:'blue',size:'S',sku:'SKU-S',barcode:'BC-S',approvedSC:true},
    {name:'Oxford Shirt',variant:'Blue',sizeBarcodes:{L:'BC-L'},approvedSC:false}
  ];
  const result=groupProducts(rows);
  assert.equal(result.length,1);
  assert.deepEqual(result[0].previewSizes.map(r=>[r.size,r.sku,r.barcode]),[['S','SKU-S','BC-S'],['M','SKU-M','BC-M'],['L','','BC-L']]);
  assert.equal(result[0].approvedSC,false);
  assert.equal(rows[0].previewSizes,undefined);
});

test('legacy maps, case-equivalent sizes and duplicates retain every entered code',()=>{
  const [p]=groupProducts([
    {name:'Bag',variant:'Cherry',sizing:'S,M',sizeSKUs:{S:'S1',M:'M1'},sizeBarcodes:{S:'B1',M:'B2'}},
    {name:'Bag',variant:'Cherry',size:'s',sku:'S1',barcode:'B1'},
    {name:'Bag',variant:'Cherry',size:'S',sku:'CONFLICT',barcode:'B1'}
  ]);
  assert.equal(p.previewSizes.length,2);
  assert.equal(p.previewSizes[0].sku,'S1 / CONFLICT');
  assert.equal(p.previewSizes[0].barcode,'B1');
  assert.equal(p.previewSizes[0].conflict,true);
});

test('different names/colours stay separate and one-size scalar codes remain visible',()=>{
  const result=groupProducts([
    {name:'Bag',variant:'Blue',sku:'ONE',barcode:'001',productImgUrl:'https://example.test/product.jpg'},
    {name:'Bag',variant:'Red',size:'One Size',sku:'RED'},
    {name:'Other Bag',variant:'Blue',size:'One Size',sku:'OTHER'}
  ]);
  assert.equal(result.length,3);
  assert.equal(result[0].previewSizes[0].sku,'ONE');
  assert.equal(result[0].previewSizes[0].barcode,'001');
  assert.equal(result[0].productImg,'https://example.test/product.jpg');
});
