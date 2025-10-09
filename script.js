// ======== CONFIGURAÇÃO DO ARQUIVO JSON ========
// const DATA_URL = "dados_completos.json"; // Removido para carregar localmente ou via URL


// Mapeamento de cada site para sua categoria (NOVO)
const SITE_CATEGORIES = {
  "Fotos e Vídeos": ["Adobe Stock", "Freepik", "Shutterstock", "Getty Images", "Deposite Photos", "123RF", "Dreamstime", "Alamy"],
  "Cursos": ["Udemy", "Hotmart", "Kiwify"],
  "Templates": ["Envato"]
};

// Limites de resgate para cada plataforma (em moeda nativa: USD ou EUR)
const THRESHOLDS = {
  "Adobe Stock": 25,
  "Freepik": 50,
  "Shutterstock": 35,
  "Getty Images": 50,
  "Deposite Photos": 50,
  "123RF": 50,
  "Dreamstime": 100,
  "Alamy": 50,
};

const PT_MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const PT_MONTH_TO_NUM = {"janeiro":1,"fevereiro":2,"março":3,"marco":3,"abril":4,"maio":5,"junho":6,"julho":7,"agosto":8,"setembro":9,"outubro":10,"novembro":11,"dezembro":12};

let RAW = [];
let availableBalances = {};
let LINE, BAR;
let stateRates = { usd_brl: 5.00, eur_brl: 6.00 };
let historicalRates = new Map();
let useHistoricalRates = false;
let displayCurrency = 'BRL';
let taxFreepikPct = 24;
// NOVA VARIÁVEL DE ESTADO
let showAllMonths = false; 

const rateCache = new Map();

// Função para processar os dados recebidos (de arquivo ou URL)
function processData(jsonData) {
  try {
    const completeData = JSON.parse(jsonData);

    RAW = flattenFromNested(completeData);
    availableBalances = completeData.availableBalances || {};

    populateFilters();
    render(); // A função render irá reabilitar a interface

  } catch (error) {
    console.error("Erro ao processar o JSON:", error);
    alert(`Erro ao processar os dados: ${error.message}. Verifique se o conteúdo do link ou arquivo é um JSON válido.`);
  }
}

// Função para carregar dados da URL do Google Drive
async function loadFromUrl() {
    const urlInput = document.getElementById('driveUrlInput');
    const url = urlInput.value.trim();

    if (!url) {
        alert("Por favor, insira um link válido.");
        return;
    }
    
    // Adiciona um spinner ao botão para feedback visual
    const loadBtn = document.getElementById('loadFromUrlBtn');
    loadBtn.textContent = 'Carregando...';
    loadBtn.disabled = true;

    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Falha ao buscar o link. Status: ${response.status}. Verifique se o link está correto, compartilhado publicamente e se não há bloqueios de CORS.`);
        }
        
        const fileContent = await response.text();
        processData(fileContent);

    } catch (error) {
        console.error("Erro ao carregar do link:", error);
        alert(`Não foi possível carregar os dados do link. Causa provável:\n\n1. O link está incorreto ou não é um link de download direto.\n2. O arquivo no Google Drive não está compartilhado como "Qualquer pessoa com o link".\n3. Problema de CORS (o servidor do Google pode bloquear a requisição do seu navegador).\n\nDetalhe do erro: ${error.message}`);
    } finally {
        // Restaura o botão
        loadBtn.textContent = 'Carregar do Link';
        loadBtn.disabled = false;
    }
}


// Função de inicialização principal
async function load() {
  // Configura os manipuladores de eventos e a interface inicial
  populateFilters();
  attachCurrencyHandlers();

  // Listener para o upload local de arquivo
  const jsonUpload = document.getElementById('jsonUpload');
  jsonUpload.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => processData(e.target.result);
    reader.onerror = () => alert("Não foi possível ler o arquivo selecionado.");
    reader.readAsText(file);
  });
  
  // Listeners para carregar da URL
  const loadFromUrlBtn = document.getElementById('loadFromUrlBtn');
  const driveUrlInput = document.getElementById('driveUrlInput');
  
  loadFromUrlBtn.addEventListener('click', loadFromUrl);
  driveUrlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
          event.preventDefault(); // Evita que o formulário seja enviado, se houver
          loadFromUrl();
      }
  });

  // Desabilita a interface visualmente até que os dados sejam carregados
  const elementsToDisable = ['.kpis', '.chart-grid', '.table-grid', '.footer'];
  elementsToDisable.forEach(selector => {
      const el = document.querySelector(selector);
      if (el) {
          el.style.opacity = '0.3';
          el.style.pointerEvents = 'none';
      }
  });
  
  // Mantém os controles de filtros e carregamento habilitados
  document.querySelector('.controls').style.opacity = '1';
  document.querySelector('.controls').style.pointerEvents = 'auto';
}


function flattenFromNested(obj){
  const out = [];
  const sites = obj.sites || {};
  for (const [platform, years] of Object.entries(sites)){
    for (const [yearStr, months] of Object.entries(years)){
      const y = parseInt(yearStr,10);
      if (!y || typeof months !== 'object') continue;
      for (const [mKey, val] of Object.entries(months)){
        const mnum = PT_MONTH_TO_NUM[String(mKey).toLowerCase()];
        if (!mnum) continue;
        const amount = (val==null || isNaN(Number(val))) ? 0 : Number(val);
        out.push({ year: y, month_num: mnum, month_name: PT_MONTHS[mnum-1], platform, amount });
      }
    }
  }
  return out;
}

async function fetchHistoricalRate(from, to, date) {
  const cacheKey = `${from}-${to}-${date}`;
  if (rateCache.has(cacheKey)) return rateCache.get(cacheKey);
  try {
    const response = await fetch(`https://api.frankfurter.app/${date}?from=${from}&to=${to}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rate = data.rates[to];
    if (rate) { rateCache.set(cacheKey, rate); return rate; }
  } catch (error) { console.warn(`Erro taxa ${from}→${to} para ${date}:`, error); }
  return null;
}
async function loadHistoricalRates() {
  if (!useHistoricalRates || !RAW.length) return;
  const statusEl = document.getElementById('rateStatus');
  statusEl.textContent = 'Carregando...'; statusEl.className = 'muted';
  const uniqueDates = new Set(RAW.map(r => `${r.year}-${String(r.month_num).padStart(2, '0')}-15`));
  const dates = Array.from(uniqueDates).sort();
  let loadedCount = 0, errorCount = 0;
  for (const date of dates) {
    const [usd, eur] = await Promise.all([fetchHistoricalRate('USD', 'BRL', date), fetchHistoricalRate('EUR', 'BRL', date)]);
    if (usd && eur) { historicalRates.set(date, { usd_brl: usd, eur_brl: eur }); loadedCount++; } else { errorCount++; }
    statusEl.textContent = `Carregando... ${loadedCount}/${dates.length}`;
  }
  statusEl.textContent = `✓ ${loadedCount} períodos carregados${errorCount > 0 ? ` (${errorCount} falhas)` : ''}`;
  render();
}
function getHistoricalRate(from, to, year, month) {
  if (!useHistoricalRates || !historicalRates.size) return null;
  const rates = historicalRates.get(`${year}-${String(month).padStart(2, '0')}-15`);
  if (!rates) return null;
  if (from === 'USD' && to === 'BRL') return rates.usd_brl;
  if (from === 'EUR' && to === 'BRL') return rates.eur_brl;
  return null;
}
function platformCurrency(platform){
  const pLower = String(platform).toLowerCase();
  if (pLower.includes('freepik')) return 'EUR';
  if (pLower.includes('hotmart') || pLower.includes('kiwify')) return 'BRL';
  return 'USD'; // Padrão para as outras
}

function attachCurrencyHandlers(){
  const sel = document.getElementById('currencySel'), 
        usd = document.getElementById('rateUsdBrl'), 
        eur = document.getElementById('rateEurBrl'), 
        tax = document.getElementById('taxFreepik'), 
        hist = document.getElementById('useHistoricalRates'), 
        manual = document.getElementById('manualRates'),
        yearSel = document.getElementById('yearSel'),
        monthSel = document.getElementById('monthSel'),
        siteSel = document.getElementById('siteSel'),
        btnSelectAll = document.getElementById('btnSelectAll'),
        // NOVO BOTÃO
        btnToggleMonths = document.getElementById('btnToggleMonths');

  const update = () => {
    displayCurrency = sel.value; 
    stateRates.usd_brl = parseFloat(usd.value)||5; 
    stateRates.eur_brl = parseFloat(eur.value)||6; 
    taxFreepikPct = parseFloat(tax.value)||24; 
    useHistoricalRates = hist.checked;
    manual.style.opacity = useHistoricalRates ? 0.5 : 1; 
    manual.style.pointerEvents = useHistoricalRates ? 'none' : 'auto';
  };

  sel.onchange = ()=>{update(); render();};
  usd.oninput = eur.oninput = tax.oninput = ()=>{update(); if(!useHistoricalRates) render();};
  hist.onchange = ()=>{ update(); if(useHistoricalRates && historicalRates.size === 0) loadHistoricalRates(); else render(); };
  
  btnSelectAll.onclick = () => {
    [...siteSel.options].forEach(o => o.selected = true);
    render();
  };
  
  // EVENTO DO BOTÃO DE MOVIMENTAÇÃO MENSAL
  btnToggleMonths.onclick = () => {
    showAllMonths = !showAllMonths; // Inverte o estado
    render(); // Re-renderiza o painel
  };
  
  document.getElementById('btnReset').onclick = ()=>{ 
    yearSel.value = "";
    monthSel.value = "";
    sel.value = "BRL";
    usd.value = "5.00";
    eur.value = "6.00";
    tax.value = "24";
    hist.checked = false;
    showAllMonths = false; // Reseta o estado do botão
    document.getElementById('rateStatus').textContent = '';
    [...siteSel.options].forEach(o => o.selected = true);
    historicalRates.clear(); 
    rateCache.clear(); 
    update(); 
    if (RAW.length > 0) render(); // Só renderiza se houver dados
  };

  update();
}

function convertAmount(amount, from, to, year = null, month = null){
  if (from === to) return amount;
  if (year && month && useHistoricalRates) { const rate = getHistoricalRate(from, to, year, month); if(rate) return amount * rate; }
  const { usd_brl, eur_brl } = stateRates;
  if (from === 'USD' && to === 'BRL') return amount * usd_brl;
  if (from === 'EUR' && to === 'BRL') return amount * eur_brl;
  return amount; 
}
function unique(arr){return [...new Set(arr.filter(x=>x!=null))]}
function populateFilters(){
  const years = unique(RAW.map(d=>d.year)).sort((a,b)=>b-a);
  const yearSel = document.getElementById('yearSel'), 
        monthSel = document.getElementById('monthSel'), 
        siteSel = document.getElementById('siteSel'),
        categorySel = document.getElementById('categorySel'); // NOVO

  yearSel.innerHTML = '<option value="">Todos</option>' + years.map(y=>`<option>${y}</option>`).join('');
  monthSel.innerHTML = '<option value="">Todos</option>' + PT_MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');

  // Popula o seletor de categorias (NOVO)
  const categories = Object.keys(SITE_CATEGORIES);
  categorySel.innerHTML = '<option value="">Todas</option>' + categories.map(c => `<option>${c}</option>`).join('');
  
  // Popula o seletor de sites com base na categoria selecionada (inicialmente todas)
  updateSiteFilter(); 

  yearSel.onchange = monthSel.onchange = siteSel.onchange = render;
  categorySel.onchange = () => { // NOVO EVENTO
    updateSiteFilter();
    render();
  };
}
function updateSiteFilter() {
  const categorySel = document.getElementById('categorySel');
  const siteSel = document.getElementById('siteSel');
  const selectedCategory = categorySel.value;
  
  let availableSites = [];

  if (selectedCategory) {
    // Se uma categoria específica for selecionada
    availableSites = SITE_CATEGORIES[selectedCategory] || [];
  } else {
    // Se "Todas" as categorias forem selecionadas, junta os sites de todas
    availableSites = Object.values(SITE_CATEGORIES).flat();
  }

  // Apenas sites que realmente existem nos dados RAW
  const allRawSites = unique(RAW.map(d => d.platform));
  const sitesToDisplay = availableSites.filter(site => allRawSites.includes(site)).sort();

  siteSel.innerHTML = sitesToDisplay.map(s => `<option selected>${s}</option>`).join('');
}

function getFilters(){
  const y = document.getElementById('yearSel').value, 
        m = document.getElementById('monthSel').value, 
        sites = [...document.getElementById('siteSel').selectedOptions].map(o=>o.value),
        category = document.getElementById('categorySel').value; // NOVO
  
  return {year: y?+y:null, month: m?+m:null, sites, category}; // NOVO
}
function fmt(n, cur = displayCurrency) {
    const map = { BRL: ['pt-BR', 'BRL'], USD: ['en-US', 'USD'], EUR: ['de-DE', 'EUR'] };
    const [loc, currency] = map[cur] || map.BRL;
    return n.toLocaleString(loc, { style: 'currency', currency: currency });
}

function compute(){
  // Se não houver dados, retorna um estado vazio para evitar erros
  if (RAW.length === 0) {
    return {rows: [], series: [], platforms: [], total: 0, totalBruto: 0, avg: 0, countMonths: 0, best: null, worst: null, yoy: null};
  }
    
  const f = getFilters();
  const base = RAW.filter(d=> (f.year? d.year===f.year : true) && (f.month? d.month_num===f.month : true) && (f.sites.includes(d.platform)) ).map(r=>{
      const cur = platformCurrency(r.platform);
      const bruto = r.amount;
      const liquido = String(r.platform).toLowerCase().includes('freepik') ? bruto * (1 - taxFreepikPct/100) : bruto;
      return { ...r, native_currency: cur, bruto, liquido };
    });
  
  let rows;
  if (displayCurrency === 'BRL'){ rows = base.map(r=>({ ...r, amount_conv_bruto: convertAmount(r.bruto, r.native_currency, 'BRL', r.year, r.month_num), amount_conv: convertAmount(r.liquido, r.native_currency, 'BRL', r.year, r.month_num) })); }
  else if (displayCurrency === 'USD'){ rows = base.filter(r=> r.native_currency==='USD').map(r=> ({...r, amount_conv_bruto: r.bruto, amount_conv: r.liquido})); }
  else if (displayCurrency === 'EUR'){ rows = base.filter(r=> r.native_currency==='EUR').map(r=> ({...r, amount_conv_bruto: r.bruto, amount_conv: r.liquido})); }
  else { rows = []; }

  const seriesMap = new Map();
  rows.forEach(d=>{ const k = `${d.year}-${String(d.month_num).padStart(2,'0')}`; seriesMap.set(k,(seriesMap.get(k)||0)+d.amount_conv); });
  const series = [...seriesMap.entries()].map(([k,v])=>({key:k, value:v, year:+k.split('-')[0], month:+k.split('-')[1]})).sort((a,b)=> a.key.localeCompare(b.key));
  const platAgg = new Map();
  rows.forEach(d=>{ const o = platAgg.get(d.platform) || { bruto:0, liquido:0 }; o.bruto += d.amount_conv_bruto; o.liquido += d.amount_conv; platAgg.set(d.platform, o); });
  const platforms = [...platAgg.entries()].map(([name,vals])=>({name, bruto: vals.bruto, val: vals.liquido})).sort((a,b)=> b.val - a.val);
  const total = platforms.reduce((s,p)=>s+p.val,0);
  const totalBruto = platforms.reduce((s,p)=>s+p.bruto,0);
  const countMonths = unique(series.map(s=>s.key)).length;
  const avg = countMonths ? total / countMonths : 0;
  const best = series.length ? series.reduce((a,b)=> a.value>=b.value? a: b) : null;
  const worst = series.length ? series.reduce((a,b)=> a.value<=b.value? a: b) : null;

  // ======== LÓGICA DO YOY ADICIONADA AQUI ========
  let yoy = null;
  // Só calcula se um ano específico (e não "Todos") estiver selecionado
  if (f.year) {
    // Filtra os dados brutos para o mesmo período do ano anterior
    const prevYearRows = RAW
      .filter(d => d.year === f.year - 1 && (f.month ? d.month_num === f.month : true) && f.sites.includes(d.platform))
      .map(r => {
        const cur = platformCurrency(r.platform);
        const liquido = String(r.platform).toLowerCase().includes('freepik') ? r.amount * (1 - taxFreepikPct / 100) : r.amount;
        const amount_conv = convertAmount(liquido, cur, displayCurrency, r.year, r.month_num);
        return { ...r, amount_conv };
      });
    
    const totalPreviousPeriod = prevYearRows.reduce((sum, row) => sum + row.amount_conv, 0);

    // Evita divisão por zero se não houver dados no ano anterior
    if (totalPreviousPeriod > 0) {
      const percentage = ((total - totalPreviousPeriod) / totalPreviousPeriod) * 100;
      yoy = { percentage };
    }
  }
  // =================================================

  return {rows, series, platforms, total, totalBruto, avg, countMonths, best, worst, yoy};
}

function renderAvailableBalance() {
  const tb = document.querySelector('#tblAvailableBalance tbody');
  if (!tb || !availableBalances) return;

  const { sites: selectedSites } = getFilters();
  let totalAvailableConverted = 0;
  
  tb.innerHTML = '';

  const sortedPlatforms = Object.entries(availableBalances)
    .sort(([, balanceA], [, balanceB]) => balanceB - balanceA);

  for (const [platform, balance] of sortedPlatforms) {
    if (balance == null) continue;

    const nativeCurrency = platformCurrency(platform);
    
    if (selectedSites.includes(platform)) {
      if (displayCurrency === 'BRL') {
        totalAvailableConverted += convertAmount(balance, nativeCurrency, 'BRL');
      } else if (displayCurrency === nativeCurrency) {
        totalAvailableConverted += balance;
      }
    }

    const threshold = THRESHOLDS[platform] || 0;
    const progress = threshold > 0 ? (balance / threshold) * 100 : 100;

    tb.innerHTML += `
      <tr>
        <td>${platform}</td>
        <td>${fmt(balance, nativeCurrency)}</td>
        <td>${fmt(threshold, nativeCurrency)}</td>
        <td>
          <div style="width: 100%; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
            <div style="width: ${Math.min(100, progress)}%; background: var(--gradient-accent); color: white; text-align: right; padding: 2px 5px; font-size: 12px; min-width: 25px; white-space: nowrap;">
              ${progress.toFixed(0)}%
            </div>
          </div>
        </td>
      </tr>`;
  }

  const kpiEl = document.getElementById('kpiAvailableBalance');
  if (kpiEl) {
    kpiEl.textContent = fmt(totalAvailableConverted);
  }
}

// ======== FUNÇÃO MODIFICADA ========
function renderTables(state){
  const {platforms, total, rows, totalBruto} = state;
  const tblPlatformsBody = document.querySelector('#tblPlatforms tbody');
  let totalAReceber = 0;

  tblPlatformsBody.innerHTML = platforms.map(p=>{
    const pct = total? ((p.val/total)*100).toFixed(1) : '0.0';
    
    const nativeBalance = availableBalances[p.name] || 0;
    const nativeCurrency = platformCurrency(p.name);
    
    let balanceToConvert = nativeBalance;
    if (String(p.name).toLowerCase().includes('freepik')) {
        balanceToConvert = nativeBalance * (1 - taxFreepikPct / 100);
    }
    
    let aReceber = 0;
    if (displayCurrency === 'BRL') {
      aReceber = convertAmount(balanceToConvert, nativeCurrency, 'BRL');
    } else if (displayCurrency === nativeCurrency) {
      aReceber = balanceToConvert;
    }
    
    totalAReceber += aReceber;

    return `<tr>
              <td>${p.name}</td>
              <td>${fmt(p.bruto)}</td>
              <td>${fmt(p.val)}</td>
              <td>${fmt(aReceber)}</td>
              <td>${pct}%</td>
            </tr>`;
  }).join('');
  
  document.getElementById('tblTotal').textContent = fmt(total);
  document.getElementById('tblTotalBruto').textContent = fmt(totalBruto);
  document.getElementById('tblTotalAReceber').textContent = fmt(totalAReceber);
  
  // Tabela de Movimentação Mensal (LÓGICA ALTERADA)
  const tblMonths = document.getElementById('tblMonths');
  const toggleBtn = document.getElementById('btnToggleMonths');

  // CABEÇALHO DA TABELA MODIFICADO
  tblMonths.querySelector('thead').innerHTML = `
    <tr>
        <th>Mês/Ano</th>
        <th>Bruto</th>
        <th>Líquido</th>
        <th>Câmbio</th>
    </tr>`;
  
  const monthAgg = new Map();
  rows.forEach(d=>{
    const k = `${d.year}-${String(d.month_num).padStart(2,'0')}`;
    const o = monthAgg.get(k) || { bruto:0, liquido:0, year:d.year, month:d.month_num };
    o.bruto += d.amount_conv_bruto; o.liquido += d.amount_conv; monthAgg.set(k,o);
  });
  
  const sortedMonths = [...monthAgg.values()].sort((a,b)=> (b.year - a.year) || (b.month - a.month));
  
  // Lógica para limitar a 15 meses e controlar o botão
  let monthsToDisplay = sortedMonths;
  if (!showAllMonths && sortedMonths.length > 12) {
      monthsToDisplay = sortedMonths.slice(0, 12);
  }

  if (sortedMonths.length > 12) {
    toggleBtn.style.display = 'block';
    toggleBtn.textContent = showAllMonths ? 'Ver menos ↑' : 'Ver mais ↓';
  } else {
    toggleBtn.style.display = 'none';
  }

  // CONTEÚDO DA TABELA MODIFICADO
  tblMonths.querySelector('tbody').innerHTML = monthsToDisplay.map(s => {
    let cambioHtml = '<td>-</td>'; // Conteúdo padrão da célula

    // Se as taxas históricas estiverem ativadas e carregadas
    if (useHistoricalRates && historicalRates.size > 0) {
        const dateKey = `${s.year}-${String(s.month).padStart(2, '0')}-15`;
        const rates = historicalRates.get(dateKey);

        if (rates && rates.usd_brl && rates.eur_brl) {
            // Formata o HTML com as taxas do mês
            cambioHtml = `
                <td>
                    <div class="rate-info">USD: ${rates.usd_brl.toFixed(3)}</div>
                    <div class="rate-info">EUR: ${rates.eur_brl.toFixed(3)}</div>
                </td>`;
        }
    }
    
    return `<tr>
              <td>${PT_MONTHS[s.month - 1]}/${s.year}</td>
              <td>${fmt(s.bruto)}</td>
              <td>${fmt(s.liquido)}</td>
              ${cambioHtml}
            </tr>`;
  }).join('');
}


function renderKpis(state){
  const {total, avg, best, worst, countMonths, yoy} = state; // Adicionamos 'yoy' aqui
  
  document.getElementById('kpiTotal').textContent = fmt(total);
  document.getElementById('kpiAvg').textContent = fmt(avg);
  document.getElementById('kpiCount').textContent = `${countMonths} mês(es)`;
  
  document.getElementById('kpiBest').textContent = best ? fmt(best.value) : '—';
  document.getElementById('kpiBestInfo').textContent = best ? `${PT_MONTHS[best.month-1]}/${best.year}` : '';
  
  document.getElementById('kpiWorst').textContent = worst ? fmt(worst.value) : '—';
  document.getElementById('kpiWorstInfo').textContent = worst ? `${PT_MONTHS[worst.month-1]}/${worst.year}`: '';

  // ======== LÓGICA DE RENDERIZAÇÃO DO YOY ADICIONADA AQUI ========
  const kpiYoyEl = document.getElementById('kpiYOY');
  // Limpa o estado anterior
  kpiYoyEl.innerHTML = '';
  kpiYoyEl.className = 'delta';

  if (yoy && isFinite(yoy.percentage)) {
    const sign = yoy.percentage > 0 ? '+' : '';
    const formattedPct = `${sign}${yoy.percentage.toFixed(1)}%`;
    
    kpiYoyEl.textContent = `${formattedPct} vs. ano anterior`;
    kpiYoyEl.classList.add(yoy.percentage >= 0 ? 'ok' : 'bad');
  }
  // ================================================================
}
function renderCharts(state){
  const lineCtx = document.getElementById('lineTotals').getContext('2d');
  const barCtx = document.getElementById('barPlatforms').getContext('2d');
  Chart.defaults.color = '#cbd5e1'; Chart.defaults.borderColor = 'rgba(59, 130, 246, 0.2)';
  if (LINE) LINE.destroy();
  LINE = new Chart(lineCtx, { type: 'line', data: { labels: state.series.map(s=> `${PT_MONTHS[s.month-1].slice(0,3)}/${String(s.year).slice(2)}`), datasets: [{ label: `Ganhos por Mês (${displayCurrency})`, data: state.series.map(s=>s.value), tension: 0.4, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true }] }, options: { responsive: true, maintainAspectRatio: false } });
  if (BAR) BAR.destroy();
  BAR = new Chart(barCtx, { type: 'bar', data: { labels: state.platforms.map(p=>p.name), datasets: [{ label: `Ganhos por Plataforma (${displayCurrency})`, data: state.platforms.map(p=>p.val), backgroundColor: state.platforms.map((_, i) => `hsl(${(i * 137.5) % 360}, 70%, 60%)`) }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y' } });
}

// Função de renderização principal
function render(){
  // Reabilita a interface quando os dados são carregados
  const elementsToEnable = ['.kpis', '.chart-grid', '.table-grid', '.footer'];
   elementsToEnable.forEach(selector => {
      const el = document.querySelector(selector);
      if (el) {
          el.style.opacity = '1';
          el.style.pointerEvents = 'auto';
      }
  });

  const state = compute();
  renderKpis(state);
  renderCharts(state);
  renderTables(state);
  renderAvailableBalance();
}

// Inicia o script
load();