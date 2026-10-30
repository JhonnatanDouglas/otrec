const $ = id => document.getElementById(id);
let jobId = sessionStorage.getItem('jobId');
let snapshot = null;
let timer;
const money = n => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(n);
function updatePriceRange() {
  const custom = $('priceRange').value === 'custom';
  $('customPriceFields').hidden = !custom;
  $('min').disabled = !custom;
  $('max').disabled = !custom;
  if (!custom) {
    const [min, max] = $('priceRange').value.split(':');
    $('min').value = min;
    $('max').value = max;
  }
}
$('priceRange').addEventListener('change', updatePriceRange);
updatePriceRange();
function element(tag, text, cls) { const el=document.createElement(tag); if(text!==undefined)el.textContent=text; if(cls)el.className=cls; return el; }
const highestPriceOption=element('option','Maior preço');highestPriceOption.value='price-desc';$('sort').insertBefore(highestPriceOption,$('sort').querySelector('[value="rating"]'));
async function api(path, body) {
  const response=await fetch(path, body===undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json(); if(!response.ok)throw new Error(data.erro || 'Falha na requisição'); return data;
}
function safeLink(raw) {try { const u=new URL(raw); return u.protocol==='https:' ? u.href : null; }catch{return null;}}
function renderProducts() {
  const target=$('products'); target.replaceChildren();
  if(!snapshot)return;
  let products=snapshot.produtos.filter(p=>p.nome.toLocaleLowerCase('pt-BR').includes($('search').value.toLocaleLowerCase('pt-BR')));
  if($('sort').value==='price')products.sort((a,b)=>a.preco-b.preco);
  if($('sort').value==='price-desc')products.sort((a,b)=>b.preco-a.preco);
  if($('sort').value==='rating')products.sort((a,b)=>(b.avaliacao??-1)-(a.avaliacao??-1));
  if(!products.length){const empty=element('div',undefined,'empty');empty.append(element('h3',snapshot.status==='executando'?'Buscando produtos…':'Nenhum produto para estes critérios'),element('p',snapshot.status==='executando'?'Os resultados aparecerão à medida que as páginas forem lidas.':'Confira os avisos, os filtros de preço e as URLs de busca.'));target.append(empty);return;}
  const grid=element('div',undefined,'grid');
  for(const p of products){
    const card=element('article',undefined,'card');
    const imageUrl=safeLink(p.imagem);if(imageUrl){const img=element('img');img.src=imageUrl;img.alt=p.nome;img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.remove());card.append(img);}
    card.append(element('span',p.marketplace,'market'),element('h3',p.nome),element('div',money(p.preco),'price'),element('div',p.avaliacao!==null?`★ ${p.avaliacao.toLocaleString('pt-BR')} · ${p.quantidadeAvaliacoes??'—'} avaliações`:'Avaliação não informada','rating'));
    const link=safeLink(p.link);if(link){const a=element('a','Ver no marketplace ↗');a.href=link;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}grid.append(card);
  }target.append(grid);
}
function render(data){snapshot=data;$('count').textContent=data.produtos.length;$('pagesCount').textContent=data.paginasColetadas;$('internationalCount').textContent=data.descartadosInternacionais;$('priceCount').textContent=data.descartadosPreco;$('duplicateCount').textContent=data.duplicados;
  const active=data.status==='executando';$('start').disabled=active;$('cancel').hidden=!active;
  $('status').textContent=({executando:'Coletando…',concluido:'Coleta concluída',concluido_com_avisos:'Concluída com avisos',cancelado:'Coleta interrompida'})[data.status];
  $('csv').disabled=!data.produtos.length;$('json').disabled=false;
  $('errors').replaceChildren(...data.erros.map(e=>element('div',e.mensagem+' · '+e.url,'warning')));
  $('events').textContent=data.eventos.join('\n')||'Conectando ao marketplace…';renderProducts();
}
async function poll(){clearTimeout(timer);try{const data=await api('/api/jobs/'+jobId);render(data);$('feedback').textContent='';if(data.status==='executando')timer=setTimeout(poll,1500);}catch(error){$('feedback').textContent=error.message;$('start').disabled=false;$('cancel').hidden=true;}}
$('form').addEventListener('submit',async e=>{e.preventDefault();$('feedback').textContent='';if(Number($('min').value)>=Number($('max').value)){$('feedback').textContent='O máximo deve ser maior que o mínimo.';return;}$('start').disabled=true;try{const data=await api('/api/jobs',{urls:$('urls').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),min:Number($('min').value),max:Number($('max').value),pages:Number($('pages').value),concurrency:Number($('concurrency').value),excludeInternational:$('international').checked});jobId=data.id;sessionStorage.setItem('jobId',jobId);await poll();}catch(error){$('feedback').textContent=error.message;$('start').disabled=false;}});
$('cancel').addEventListener('click',async()=>{try{await api('/api/jobs/'+jobId+'/cancel',{});$('feedback').textContent='Interrompendo. A requisição em andamento pode levar até 20 segundos.';}catch(error){$('feedback').textContent=error.message;}});
$('search').addEventListener('input',renderProducts);$('sort').addEventListener('change',renderProducts);
function download(text,type,extension){const url=URL.createObjectURL(new Blob([text],{type}));const a=element('a');a.href=url;a.download='otrec-'+new Date().toISOString().slice(0,10)+'.'+extension;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('json').addEventListener('click',()=>download(JSON.stringify(snapshot,null,2),'application/json','json'));
function cell(value){let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
$('csv').addEventListener('click',()=>{const keys=['marketplace','id','nome','preco','avaliacao','quantidadeAvaliacoes','internacional','link','pagina','posicao'];download('\ufeff'+[keys.join(';'),...snapshot.produtos.map(p=>keys.map(k=>cell(k==='preco'?p[k].toFixed(2).replace('.',','):p[k])).join(';'))].join('\r\n'),'text/csv;charset=utf-8','csv');});
if(jobId)poll();
