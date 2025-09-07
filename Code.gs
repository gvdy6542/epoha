/** ===================== CONFIG ===================== **/
const TZ      = 'Europe/Sofia';
const SS_ID   = SpreadsheetApp.getActive().getId();

const SH_TX   = 'Transactions';     // Операции (приход/разход)
const SH_CNT  = 'CashCounts';       // Броене на каса по деноминации
const SH_DAY  = 'DayClosings';      // Дневни отчети / приключване
const SH_SET  = 'Settings';         // Настройки (по избор)
const SH_USERS= 'Users';            // Потребители (по избор)
const SH_SUP  = 'Suppliers';        // Доставчици

const DEFAULT_DENOMS  = [100,50,20,10,5,2,1,0.5,0.2,0.1,0.05];
const DEFAULT_METHODS = ['CASH','CARD','BANK'];
const DEFAULT_TYPES   = ['INCOME','EXPENSE'];
const DOC_TYPES = [
  'INVOICE','CREDIT_NOTE','DEBIT_NOTE','DELIVERY_NOTE','FISCAL_RECEIPT',
  'CASH_VOUCHER_OUT','BANK_PAYMENT','BANK_FEE','VAT_PROTOCOL','RECEIPT','CONTRACT','OTHER'
];

let TX_COLS = {}; // map колона->индекс за Transactions

// Глобален достъп до Script Properties
const SP = PropertiesService.getScriptProperties();

/** ===================== WEB APP & MENU ===================== **/
function onOpen(){
  SpreadsheetApp.getUi()
    .createMenu('Отчитане')
    .addItem('Отвори приложението', 'showWebApp_')
    .addToUi();
}

function showWebApp_(){
  const html = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Отчитане на магазин')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setWidth(1200)
    .setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(html, 'Отчитане на магазин');
}

function doGet(){
  ensureSheets_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Отчитане на магазин')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** ===================== PUBLIC API ===================== **/
function getMeta(){
  ensureSheets_();
  return {
    denoms: getExistingOrDefaultDenoms_(),
    methods: DEFAULT_METHODS.slice(),
    types: DEFAULT_TYPES.slice(),
    stores: ['Основен'],
    categories: {
      INCOME: ['Продажби', 'Друг приход'],
      EXPENSE: ['Стока', 'Наем', 'Комунални', 'Касови разходи', 'Друго']
    }
  };
}

function listSuppliers(){
  ensureSheets_();
  const sh = getSheet_(SH_SUP);
  const last = sh.getLastRow();
  if(last < 2) return [];
  const arr = sh.getRange(2,1,last-1,1).getValues().map(r=>String(r[0]||''));
  arr.sort((a,b)=> a.toLowerCase().localeCompare(b.toLowerCase()));
  return arr;
}

function addSupplier(name){
  ensureSheets_();
  let n = String(name||'').trim().replace(/\s+/g,' ');
  if(n.length < 2) throw new Error('Невалидно име на доставчик');
  const sh = getSheet_(SH_SUP);
  const last = sh.getLastRow();
  const existing = last < 2 ? [] : sh.getRange(2,1,last-1,1).getValues().map(r=>String(r[0]||'').toLowerCase());
  if(existing.includes(n.toLowerCase())) throw new Error('Доставчик вече съществува');
  const user = Session.getActiveUser().getEmail() || 'anonymous';
  sh.appendRow([n, new Date(), user]);
  return {ok:true};
}

/**
 * payload: {date, type, method, category, description, amount,
 *           supplier?, doc_type?, doc_number?, doc_date?}
 */
function addTransaction(payload){
  ensureSheets_();
  const required = ['date','type','method','amount'];
  required.forEach(k=>{
    if(payload[k] === undefined || payload[k] === null || payload[k] === '') throw new Error('Липсва поле: '+k);
  });

  const type = String(payload.type||'').toUpperCase();
  if(!DEFAULT_TYPES.includes(type)) throw new Error('Невалиден тип (INCOME/EXPENSE)');

  const method = String(payload.method||'').toUpperCase();
  if(!getMeta().methods.includes(method)) throw new Error('Невалиден метод на плащане');

  let amount = Number(String(payload.amount).replace(',','.'));
  if(isNaN(amount)) throw new Error('Сумата не е число');

  const dateOnly = toDateOnly_(payload.date);
  if(!dateOnly) throw new Error('Невалидна дата');

  const user = Session.getActiveUser().getEmail() || 'anonymous';

  let supplier = payload.supplier || '';
  let docType = payload.doc_type || '';
  let docNumber = payload.doc_number || '';
  let docDate = payload.doc_date ? toDateOnly_(payload.doc_date) : '';

  if(type === 'EXPENSE'){
    supplier = String(supplier||'').trim();
    if(!supplier) throw new Error('Доставчикът е задължителен');
    docType = String(docType||'').toUpperCase();
    if(!DOC_TYPES.includes(docType)) throw new Error('Невалиден тип документ');
    if(['INVOICE','CREDIT_NOTE','DEBIT_NOTE','VAT_PROTOCOL'].includes(docType)){
      if(!docNumber) throw new Error('Липсва номер на документ');
    }
    if(!docDate) throw new Error('Липсва дата на документа');
    if(docDate > toDateOnly_(new Date())) throw new Error('Дата на документа е в бъдещето');
    if(docType === 'CREDIT_NOTE') amount = -Math.abs(amount);
  }

  const cols = TX_COLS;
  const row = new Array(Object.keys(cols).length).fill('');
  row[cols.timestamp]    = new Date();
  row[cols.date]         = dateOnly;
  row[cols.type]         = type;
  row[cols.method]       = method;
  row[cols.category]     = payload.category || '';
  if(cols.supplier     !== undefined) row[cols.supplier]     = supplier;
  if(cols.doc_type     !== undefined) row[cols.doc_type]     = docType;
  if(cols.doc_number   !== undefined) row[cols.doc_number]   = docNumber;
  if(cols.doc_date     !== undefined) row[cols.doc_date]     = docDate;
  row[cols.description]  = payload.description || '';
  row[cols.amount]       = round2_(amount);
  row[cols.user]         = user;

  const sh = getSheet_(SH_TX);
  sh.appendRow(row);
  return {ok:true};
}

function listTransactions(query){
  ensureSheets_();
  const sh = getSheet_(SH_TX);
  const last = sh.getLastRow();
  if(last < 2) return [];
  const data = sh.getRange(2,1,last-1,sh.getLastColumn()).getValues();
  const cols = TX_COLS;

  const toNum_ = v => Number(String(v||0).replace(',','.'))||0;

  const df = query?.dateFrom ? toDateOnly_(query.dateFrom) : null;
  const dt = query?.dateTo   ? toDateOnly_(query.dateTo)   : null;

  let rows = data.filter(r => {
    const date = r[cols.date];
    let ok = true;
    if(df && date < df) ok = false;
    if(dt && date > dt) ok = false;
    return ok;
  });
  rows.sort((a,b)=> new Date(b[cols.timestamp]).getTime()-new Date(a[cols.timestamp]).getTime());
  const lim = Math.min(Number(query?.limit||200), 1000);
  rows = rows.slice(0, lim);

  return rows.map(r=>({
    timestamp: r[cols.timestamp],
    date: r[cols.date],
    type: r[cols.type],
    method: r[cols.method],
    category: cols.category!==undefined ? r[cols.category] : '',
    supplier: cols.supplier!==undefined ? r[cols.supplier] : '',
    doc_type: cols.doc_type!==undefined ? r[cols.doc_type] : '',
    doc_number: cols.doc_number!==undefined ? r[cols.doc_number] : '',
    doc_date: cols.doc_date!==undefined ? r[cols.doc_date] : '',
    description: cols.description!==undefined ? r[cols.description] : '',
    amount: toNum_(r[cols.amount]),
    user: cols.user!==undefined ? r[cols.user] : ''
  }));
}

function saveCashCount(payload){
  // payload: {date, store, counts: {denom: qty}}
  ensureSheets_();
  const meta = getMeta();
  const sh = getSheet_(SH_CNT);
  const dateOnly = toDateOnly_(payload.date);
  const store = payload.store || 'Основен';
  const user = Session.getActiveUser().getEmail() || 'anonymous';

  const denoms = meta.denoms;
  let total = 0;
  const qtys = denoms.map(d => {
    const q = Number(payload.counts?.[String(d)]||0);
    total += d * q;
    return q;
  });

  sh.appendRow([
    new Date(),          // timestamp
    dateOnly,
    store,
    ...qtys,
    round2_(total),
    user
  ]);
  return {ok:true, total: round2_(total)};
}

function getDailySummary(date){
  ensureSheets_();
  const dateOnly = toDateOnly_(date);
  const tx = listTransactions({dateFrom: dateOnly, dateTo: dateOnly, limit: 5000});
  const methods = getMeta().methods;
  const sum = { sales:{}, expenses:{}, total:{ sales:0, expenses:0 } };
  methods.forEach(m=>{ sum.sales[m]=0; sum.expenses[m]=0; });

  tx.forEach(t => {
    if(t.type === 'INCOME'){
      sum.sales[t.method] += Number(t.amount)||0;
      sum.total.sales += Number(t.amount)||0;
    }else if(t.type === 'EXPENSE'){
      sum.expenses[t.method] += Number(t.amount)||0;
      sum.total.expenses += Number(t.amount)||0;
    }
  });

  const expectedCash = round2_( (sum.sales.CASH||0) - (sum.expenses.CASH||0) );
  return {date: dateOnly, store: 'Основен', ...sum, expectedCash};
}

function closeDay(payload){
  // payload: {date, store, declaredCash, note}
  ensureSheets_();
  const dateOnly = toDateOnly_(payload.date);
  const store = payload.store || 'Основен';
  const declared = round2_(Number(payload.declaredCash)||0);
  const note = String(payload.note||'');
  const user = Session.getActiveUser().getEmail() || 'anonymous';

  const s = getDailySummary(dateOnly);
  const expectedCash = round2_(s.expectedCash);
  const diff = round2_(declared - expectedCash);

  const sh = getSheet_(SH_DAY);
  sh.appendRow([
    new Date(),
    dateOnly,
    store,
    round2_(s.sales.CASH||0),
    round2_(s.sales.CARD||0),
    round2_(s.sales.BANK||0),
    round2_(s.expenses.CASH||0),
    round2_(s.expenses.CARD||0),
    round2_(s.expenses.BANK||0),
    declared,
    expectedCash,
    diff,
    note,
    user
  ]);

  return {ok:true, expectedCash, declared, diff};
}

/** ===================== REPORT V2 (без PIN) ===================== **/
function getReportV2(query){
  ensureSheets_();

  const df = query?.dateFrom ? toDateOnly_(query.dateFrom) : null;
  const dt = query?.dateTo   ? toDateOnly_(query.dateTo)   : null;
  const store = (query?.store || '').trim() || '';

  const toNum_ = v => Number(String(v||0).replace(',','.'))||0;
  const round2 = n => Math.round(n*100)/100;

  const res = {
    range:{from: df||'', to: dt||'', store: store||'Всички'},
    kpi:{income_total:0,expense_total:0,net:0,tx_count:0,income_count:0,expense_count:0},
    byMethod:[], byCatIncome:[], byCatExpense:[],
    expenseByDocType:[], suppliersTop:[], closings:[], recentTx:[]
  };

  // Transactions
  const sh = getSheet_(SH_TX);
  const last = sh.getLastRow();
  if(last>=2){
    const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const c={}; header.forEach((h,i)=>c[h]=i);
    const data = sh.getRange(2,1,last-1,sh.getLastColumn()).getValues();

    const byMethod={}, byCatIn={}, byCatEx={}, byDoc={}, bySup={}, perDay={};

    const rows = data.filter(r=>{
      const d = r[c.date];
      if(df && d < df) return false;
      if(dt && d > dt) return false;
      if(store && c.store !== undefined){
        const st = r[c.store];
        if(st !== store) return false;
      }
      return true;
    });

    rows.forEach(r=>{
        const t=r[c.type], m=r[c.method], cat=r[c.category], sup=r[c.supplier], dtp=r[c.doc_type], amt=toNum_(r[c.amount]);
        const st = c.store!==undefined ? r[c.store] : '';
        const key = `${r[c.date]}|${st}`;
        const pd = perDay[key] || (perDay[key]={income:0,expenses:{}});
      if(!byMethod[m]) byMethod[m]={income:0,expense:0};
      if(t==='INCOME'){
        res.kpi.income_total += amt; res.kpi.income_count++;
        byMethod[m].income += amt;
        if(cat) byCatIn[cat] = (byCatIn[cat]||0) + amt;
        pd.income += amt;
      }else if(t==='EXPENSE'){
        res.kpi.expense_total += amt; res.kpi.expense_count++;
        byMethod[m].expense += amt;
        if(cat) byCatEx[cat] = (byCatEx[cat]||0) + amt;
        if(dtp){ const o=byDoc[dtp]||{amount:0,count:0}; o.amount+=amt; o.count++; byDoc[dtp]=o; }
        if(sup){
          const o=bySup[sup]||{amount:0,count:0}; o.amount+=amt; o.count++; bySup[sup]=o;
          pd.expenses[sup] = (pd.expenses[sup]||0) + amt;
        }
      }
    });

    rows.sort((a,b)=> new Date(b[c.timestamp]) - new Date(a[c.timestamp]));
    rows.slice(0,100).forEach(r=>{
        res.recentTx.push({
          timestamp:r[c.timestamp],
          date:r[c.date],
          type:r[c.type],
          method:r[c.method],
        category:r[c.category]||'',
        supplier:r[c.supplier]||'',
        doc_type:r[c.doc_type]||'',
        doc_number:c.doc_number!==undefined? (r[c.doc_number]||'') : '',
        doc_date:c.doc_date!==undefined? (r[c.doc_date]||'') : '',
        description:r[c.description]||'',
        amount: toNum_(r[c.amount]),
        user:r[c.user]||''
      });
    });

    Object.keys(byMethod).forEach(k=>res.byMethod.push({method:k||'-',income:round2(byMethod[k].income),expense:round2(byMethod[k].expense)}));
    Object.keys(byCatIn).forEach(k=>res.byCatIncome.push({category:k,amount:round2(byCatIn[k])}));
    Object.keys(byCatEx).forEach(k=>res.byCatExpense.push({category:k,amount:round2(byCatEx[k])}));
    Object.keys(byDoc).forEach(k=>res.expenseByDocType.push({doc_type:k,amount:round2(byDoc[k].amount),count:byDoc[k].count}));
    Object.keys(bySup).forEach(k=>res.suppliersTop.push({supplier:k,amount:round2(bySup[k].amount),count:bySup[k].count}));

    res.kpi.income_total = round2(res.kpi.income_total);
    res.kpi.expense_total= round2(res.kpi.expense_total);
    res.kpi.net          = round2(res.kpi.income_total - res.kpi.expense_total);
    res.kpi.tx_count     = res.kpi.income_count + res.kpi.expense_count;
  }

  // CashCounts per day
  const shc = getSheet_(SH_CNT);
  const lastc = shc.getLastRow();
  const cashMap = {};
  if(lastc >= 2){
    const hc = shc.getRange(1,1,1,shc.getLastColumn()).getValues()[0];
    const ic = {}; hc.forEach((v,i)=>ic[v]=i);
    const denomCols = Object.keys(ic).filter(k=>k.startsWith('qty_'));
    const datac = shc.getRange(2,1,lastc-1,shc.getLastColumn()).getValues();
    datac.forEach(r=>{
      const d = r[ic.date];
      const st = r[ic.store];
      if(df && d<df) return;
      if(dt && d>dt) return;
      if(store && st!==store) return;
      const key = `${d}|${st}`;
      const arr = [];
      denomCols.forEach(col=>{
        const qty = r[ic[col]];
        if(qty){ const denom = col.replace('qty_',''); arr.push(`${denom}x${qty}`); }
      });
      cashMap[key] = arr.join(';');
    });
  }

  // DayClosings
  const shd = getSheet_(SH_DAY);
  const lastd = shd.getLastRow();
  if(lastd >= 2){
    const h = shd.getRange(1,1,1,shd.getLastColumn()).getValues()[0];
    const idx = {}; h.forEach((v,i)=>idx[v]=i);
    const data = shd.getRange(2,1,lastd-1,shd.getLastColumn()).getValues();
    const perDay = {};
    data.forEach(r=>{
      const d = r[idx.date];
      const st = r[idx.store];
      if(df && d<df) return;
      if(dt && d>dt) return;
      if(store && st!==store) return;
      const key = `${d}|${st}`;
      const pd = perDay[key] || {income:0,expenses:{}};
      const expStr = Object.keys(pd.expenses).map(s=>`${s}:${round2(pd.expenses[s])}`).join(';');
      res.closings.push({
        date:d, store:st,
        sales_cash:r[idx.sales_cash]||0,
        sales_card:r[idx.sales_card]||0,
        sales_bank:r[idx.sales_bank]||0,
        expenses_cash:r[idx.expenses_cash]||0,
        expenses_card:r[idx.expenses_card]||0,
        expenses_bank:r[idx.expenses_bank]||0,
        declared_cash:r[idx.declared_cash]||0,
        expected_cash:r[idx.expected_cash]||0,
        diff:r[idx.diff]||0,
        banknotes:cashMap[key]||'',
        expense_suppliers:expStr,
        income_total:round2(pd.income)
      });
    });
  }

  return res;
}

function exportReportCsvV2(query){
  const data = getReportV2(query);
  const q = v => `"${String(v??'').replace(/"/g,'""').replace(/\n/g,' ') }"`;
  const lines = [];
  const from = data.range.from||'', to = data.range.to||'', store = data.range.store||'Всички';

  lines.push(`Период от,${from},до,${to},Магазин,${store}`);
  lines.push('');
  lines.push('KPI');
  lines.push(`Общ приход,${data.kpi.income_total}`);
  lines.push(`Общ разход,${data.kpi.expense_total}`);
  lines.push(`Нето,${data.kpi.net}`);
  lines.push(`Брой операции,${data.kpi.tx_count}`);
  lines.push('');
  lines.push('По метод');
  lines.push('Метод,Приход,Разход');
  data.byMethod.forEach(m=> lines.push(`${q(m.method)},${m.income},${m.expense}`));
  lines.push('');
  lines.push('Приходи по категории');
  lines.push('Категория,Сума');
  data.byCatIncome.forEach(c=> lines.push(`${q(c.category)},${c.amount}`));
  lines.push('');
  lines.push('Разходи по категории');
  lines.push('Категория,Сума');
  data.byCatExpense.forEach(c=> lines.push(`${q(c.category)},${c.amount}`));
  lines.push('');
  lines.push('Разходи по тип документ');
  lines.push('Тип,Сума,Брой');
  data.expenseByDocType.forEach(d=> lines.push(`${q(d.doc_type)},${d.amount},${d.count}`));
  lines.push('');
  lines.push('Топ доставчици');
  lines.push('Доставчик,Сума,Брой');
  data.suppliersTop.forEach(s=> lines.push(`${q(s.supplier)},${s.amount},${s.count}`));
  lines.push('');
  lines.push('Дневни отчети');
  lines.push('Дата,Магазин,Прод. каса,Прод. карта,Прод. банка,Разх. каса,Разх. карта,Разх. банка,Декл. каса,Очакв. каса,Разлика,Банкноти,Разходи доставчици,Приход');
  data.closings.forEach(c=> lines.push(`${c.date},${q(c.store)},${c.sales_cash},${c.sales_card},${c.sales_bank},${c.expenses_cash},${c.expenses_card},${c.expenses_bank},${c.declared_cash},${c.expected_cash},${c.diff},${q(c.banknotes)},${q(c.expense_suppliers)},${c.income_total}`));
  lines.push('');
  lines.push('Последни операции');
  lines.push('timestamp,date,type,method,category,supplier,doc_type,doc_number,doc_date,description,amount,user');
  data.recentTx.forEach(t=>{
    lines.push([
      t.timestamp,t.date,t.type,t.method,t.category||'',t.supplier||'',
      t.doc_type||'',t.doc_number||'',t.doc_date||'',t.description||'',t.amount,t.user||''
    ].map(q).join(','));
  });

  return Utilities.newBlob(lines.join('\n'),'text/csv',`Report_${from}_${to}_${store}.csv`);
}

/** ===================== INTERNALS ===================== **/
function ensureSheets_(){
  const ss = SpreadsheetApp.openById(SS_ID);

  // Transactions – миграция, добавяме липсващи колони без да чупим реда
  const txHeader = ['timestamp','date','type','method','category','supplier','doc_type','doc_number','doc_date','description','amount','user'];
  let shTx = ss.getSheetByName(SH_TX);
  if(!shTx){
    shTx = ss.insertSheet(SH_TX);
    shTx.getRange(1,1,1,txHeader.length).setValues([txHeader]);
    shTx.setFrozenRows(1);
  }else{
    const existing = shTx.getRange(1,1,1,shTx.getLastColumn()).getValues()[0].map(String);
    txHeader.forEach(h=>{
      if(!existing.includes(h)){
        shTx.getRange(1, existing.length+1).setValue(h);
        existing.push(h);
      }
    });
    if(shTx.getFrozenRows() === 0) shTx.setFrozenRows(1);
  }
  // map header -> index
  TX_COLS = {};
  const header = shTx.getRange(1,1,1,shTx.getLastColumn()).getValues()[0];
  header.forEach((h,i)=>{ TX_COLS[String(h)] = i; });

  // CashCounts
  const denoms = getExistingOrDefaultDenoms_();
  ensureSheetWithHeader_(ss, SH_CNT, [
    'timestamp','date','store', ...denoms.map(d=>`qty_${d}`), 'total','user'
  ]);

  // DayClosings
  ensureSheetWithHeader_(ss, SH_DAY, [
    'timestamp','date','store',
    'sales_cash','sales_card','sales_bank',
    'expenses_cash','expenses_card','expenses_bank',
    'declared_cash','expected_cash','diff','note','user'
  ]);

  // Settings, Users, Suppliers
  ensureSheetWithHeader_(ss, SH_SET, ['key','value']);
  ensureSheetWithHeader_(ss, SH_USERS, ['email','name','role','stores']);
  ensureSheetWithHeader_(ss, SH_SUP, ['supplier','created_at','created_by']);
}

function ensureSheetWithHeader_(ss, name, header){
  let sh = ss.getSheetByName(name);
  if(!sh) sh = ss.insertSheet(name);
  if(sh.getLastRow() === 0){
    sh.getRange(1,1,1,header.length).setValues([header]);
    sh.setFrozenRows(1);
  }
}

function getExistingOrDefaultDenoms_(){
  const ss = SpreadsheetApp.openById(SS_ID);
  let sh = ss.getSheetByName(SH_CNT);
  if(!sh || sh.getLastRow() === 0) return DEFAULT_DENOMS.slice();
  const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const cols = header.filter(h => String(h).startsWith('qty_'));
  if(cols.length === 0) return DEFAULT_DENOMS.slice();
  return cols.map(c => Number(String(c).replace('qty_','')) );
}

function getSheet_(name){
  const ss = SpreadsheetApp.openById(SS_ID);
  const sh = ss.getSheetByName(name);
  if(!sh) throw new Error('Липсва лист: '+name);
  return sh;
}

function toDateOnly_(v){
  if(!v) return null;
  const d = new Date(v);
  if(isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function round2_(n){
  return Math.round((Number(n)||0)*100)/100;
}

