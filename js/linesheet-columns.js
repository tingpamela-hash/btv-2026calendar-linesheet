(function () {
  const key = 'btv-ls-master-columns-v4';
  const legacyKey = 'btv-ls-master-columns-v2';
  const table = document.getElementById('masterTable');
  const list = document.getElementById('masterColumnList');
  const headers = Array.from(table.tHead.rows[0].cells);
  const defaults = headers.map(cell => {
    const label=cell.textContent.replace(/[\u25b2\u25bc]/g,'').trim();
    const id='column:'+label;
    cell.dataset.column=id;
    return {id,label,visible:!cell.matches('.col-images,.col-details,.col-calendar')};
  });
  let columns = [];
  function controls() {
    list.replaceChildren();
    columns.forEach((column,index) => {
      const row=document.createElement('div');
      row.className='master-column-option';
      const label=document.createElement('label');
      const checkbox=document.createElement('input');
      checkbox.type='checkbox';
      checkbox.checked=column.visible;
      checkbox.disabled=column.visible && columns.filter(c=>c.visible).length===1;
      checkbox.addEventListener('change',()=>{column.visible=checkbox.checked;apply();controls();});
      label.append(checkbox,document.createTextNode(column.label));
      row.append(label);
      [-1,1].forEach(direction=>{
        const button=document.createElement('button');
        button.type='button';
        button.textContent=direction<0?'\u2191':'\u2193';
        button.title='Move '+column.label+(direction<0?' earlier':' later');
        button.setAttribute('aria-label',button.title);
        button.disabled=index+direction<0 || index+direction>=columns.length;
        button.addEventListener('click',()=>{
          [columns[index],columns[index+direction]]=[columns[index+direction],columns[index]];
          apply();controls();
          list.children[index+direction].querySelectorAll('button')[direction<0?0:1].focus();
        });
        row.append(button);
      });
      list.append(row);
    });
  }
  function apply(skipSave) {
    const visible=columns.filter(c=>c.visible).length;
    Array.from(table.rows).forEach(row=>{
      if (row.cells.length!==columns.length || row.classList.contains('product-group-heading')) {
        if(row.cells.length===1) row.cells[0].colSpan=visible;
        return;
      }
      const cells=Array.from(row.cells);
      cells.forEach((cell,index)=>{if(!cell.dataset.column) cell.dataset.column=defaults[index].id;});
      const byId=new Map(cells.map(cell=>[cell.dataset.column,cell]));
      columns.forEach(column=>{
        const cell=byId.get(column.id);
        cell.style.display=column.visible?'table-cell':'none';
        row.append(cell);
      });
    });
    if(!skipSave) {
      try{localStorage.setItem(key,JSON.stringify(columns));}catch(error){}
    }
  }
  function normalize(saved) {
    const remaining=new Map(defaults.map(column=>[column.id,column]));
    const result=[];
    if(Array.isArray(saved)) saved.forEach(column=>{
      const definition=column && (remaining.get(column.id) || Array.from(remaining.values()).find(item=>item.label===column.label));
      if(definition) {
        result.push({...definition,visible:column.visible!==false});
        remaining.delete(definition.id);
      }
    });
    result.push(...Array.from(remaining.values(),column=>({...column})));
    if(!result.some(column=>column.visible)) result[0].visible=true;
    return result;
  }
  function load() {
    let saved=[];
    try{saved=JSON.parse(localStorage.getItem(key)) || [];}catch(error){}
    columns=normalize(saved);
    apply(true);controls();
  }
  window.btvMasterColumnManager={load,apply};
  window.btvResetMasterColumns=()=>{try{localStorage.removeItem(key);localStorage.removeItem(legacyKey);}catch(error){}load();};
  load();
})();
