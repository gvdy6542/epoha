/**************************************************
 * CONFIGURATION
 **************************************************/

const TZ = 'Europe/Sofia';

// 📄 Основна таблица за проекта (ЕПОХА)
const SS_ID = '1EW4CzXn-DSm9RjloqXNeX7wYY7OeFRBsP1Kwi6vviKs';
function SS_() {
  return SpreadsheetApp.openById(SS_ID);
}

// Основни листове (провери дали имената съвпадат с тези в твоя файл)
const SH_TX   = 'Transactions';
const SH_CNT  = 'CashCounts';
const SH_DAY  = 'DayClosings';
const SH_SET  = 'Settings';
const SH_USERS= 'Users';
const SH_SUP  = 'Suppliers';

// Настройки по подразбиране
const DEFAULT_DENOMS = [100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];

const DEFAULT_METHODS = ['CASH','CARD','BANK'];
const DEFAULT_TYPES   = ['INCOME','EXPENSE'];
const DOC_TYPES = [
  'INVOICE','CREDIT_NOTE','DEBIT_NOTE','DELIVERY_NOTE','FISCAL_RECEIPT',
  'CASH_VOUCHER_OUT','BANK_PAYMENT','BANK_FEE','VAT_PROTOCOL','RECEIPT','CONTRACT','OTHER'
];

let TX_COLS = {};

/**************************************************
 * WEB APP & MENU
 **************************************************/
function onOpen(){
  ensureSheets_();
  SpreadsheetApp.getUi()
    .createMenu('Отчитане')
    .addItem('Отвори приложението', 'showWebApp_')
    .addItem('Админ панел', 'showAdminPanel_')
    .addSeparator()
    .addItem('SEED ADMIN (временно)', 'seedAdminUser_') // <-- добавено
    .addToUi();
}

function showWebApp_(){
  const html = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Отчитане на магазин')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setWidth(1200).setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(html, 'Отчитане на магазин');
}
function showAdminPanel_(){
  const html = HtmlService.createHtmlOutputFromFile('Admin')
    .setTitle('Админ панел')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
   .setWidth(1200).setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(html, 'Админ панел');
}

function doGet(e){
  ensureSheets_();
  const page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page).toLowerCase() : '';
  if (page === 'app') {
    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('Отчитане на магазин')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  
  }
if (page === 'admin') {
    return HtmlService.createTemplateFromFile('Admin')
      .evaluate()
      .setTitle('Админ панел')
     .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  // default: Landing
  
return HtmlService.createTemplateFromFile('Landing')
    .evaluate()
    .setTitle('Начало')
   .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**************************************************
 * PUBLIC API
 **************************************************/
function listSuppliers(){
  ensureSheets_();
  const sh = getSheet_(SH_SUP);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const names = sh.getRange(2,1,last-1,1).getValues()
    .map(r => String(r[0]||'').trim())
    .filter(Boolean);
  const uniq = Array.from(new Set(names));
  uniq.sort((a,b)=> a.localeCompare(b, 'bg', {sensitivity:'base'}));
  return uniq;
}

function api_getReportV2(q){
  try{
    ensureSheets_();
    const raw = getReportV2(q || {});
    return JSON.parse(JSON.stringify(raw || defaultReport_()));
  }catch(e){
    throw new Error('getReportV2 failed: ' + (e && e.message ? e.message : e));
  }
}

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

function listTransactions(query){
  ensureSheets_();
  const sh = getSheet_(SH_TX);
  const last = sh.getLastRow();
  if (last < 2) return [];

  const data = sh.getRange(2,1,last-1,sh.getLastColumn()).getValues();
  const cols = TX_COLS;

  const toNum_ = v => Number(String(v||0).replace(',','.')) || 0;

  const df = query?.dateFrom ? toDateOnly_(query.dateFrom) : null;
  const dt = query?.dateTo   ? toDateOnly_(query.dateTo)   : null;
  const store = query?.store ? String(query.store) : null;

  const dkIdx = (typeof cols.dateKey === 'number') ? cols.dateKey : cols.date;

  let rows = data.filter(r => {
    let dkey = r[dkIdx];
    if (dkey instanceof Date) dkey = toDateOnly_(dkey);
    else dkey = String(dkey || '').slice(0,10);

    if (df && dkey < df) return false;
    if (dt && dkey > dt) return false;
    if (store && cols.store !== undefined && String(r[cols.store]||'') !== store) return false;
    return true;
  });

  const getTime = v => (v instanceof Date) ? v.getTime() : (new Date(v).getTime() || 0);
  rows.sort((a,b)=> getTime(b[cols.timestamp]) - getTime(a[cols.timestamp]));

  const lim = Math.min(Number(query?.limit||200), 1000);
  rows = rows.slice(0, lim);

  const iso = v => {
    if (!v) return '';
    const d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
  };
  const dateOnly = v => (v ? toDateOnly_(v) : '');

  return rows.map(r=>({
    timestamp: iso(r[cols.timestamp]),
    date: dateOnly(r[cols.date]),
    store: cols.store!==undefined ? String(r[cols.store]||'') : '',
    type: String(r[cols.type]||''),
    method: String(r[cols.method]||''),
    category: cols.category!==undefined ? String(r[cols.category]||'') : '',
    description: cols.description!==undefined ? String(r[cols.description]||'') : '',
    amount: toNum_(r[cols.amount]),
    user: cols.user!==undefined ? String(r[cols.user]||'') : '',
    supplier: cols.supplier!==undefined ? String(r[cols.supplier]||'') : '',
    doc_type: cols.doc_type!==undefined ? String(r[cols.doc_type]||'') : '',
    doc_number: cols.doc_number!==undefined ? String(r[cols.doc_number]||'') : '',
    doc_date: cols.doc_date!==undefined ? dateOnly(r[cols.doc_date]) : '',
    doc_file_id: cols.doc_file_id!==undefined ? String(r[cols.doc_file_id]||'') : '',
    doc_file_url: cols.doc_file_url!==undefined ? String(r[cols.doc_file_url]||'') : ''
  }));
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
  const dateKey = String(dateOnly);

  const user = Session.getActiveUser().getEmail() || 'anonymous';
  const store = payload.store || 'Основен';

  let supplier = payload.supplier || '';
  let docType = payload.doc_type || '';
  let docNumber = payload.doc_number || '';
  let docDate = payload.doc_date ? toDateOnly_(payload.doc_date) : '';
  let docFileId = payload.doc_file_id || '';
  let docFileUrl = payload.doc_file_url || '';

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
  const row = new Array(Math.max(16, Object.keys(cols).length)).fill('');
  row[cols.timestamp]    = new Date();
  row[cols.date]         = dateOnly;
  if(cols.dateKey !== undefined) row[cols.dateKey] = dateKey;
  if(cols.store       !== undefined) row[cols.store]       = store;
  row[cols.type]         = type;
  row[cols.method]       = method;
  row[cols.category]     = payload.category || '';
  row[cols.description]  = payload.description || '';
  row[cols.amount]       = round2_(amount);
  row[cols.user]         = user;
  if(cols.supplier     !== undefined) row[cols.supplier]     = supplier;
  if(cols.doc_type     !== undefined) row[cols.doc_type]     = docType;
  if(cols.doc_number   !== undefined) row[cols.doc_number]   = docNumber;
  if(cols.doc_date     !== undefined) row[cols.doc_date]     = docDate;
  if(cols.doc_file_id  !== undefined) row[cols.doc_file_id]  = docFileId;
  if(cols.doc_file_url !== undefined) row[cols.doc_file_url] = docFileUrl;

  const sh = getSheet_(SH_TX);
  sh.appendRow(row);
  return {ok:true};
}

function getReportV2(query){
  const tx = listTransactions({dateFrom: query?.dateFrom, dateTo: query?.dateTo, store: query?.store, limit: 1000});

  const kpi = {income_total:0, expense_total:0, net:0, tx_count:tx.length};
  const byMethod = {};
  const byCatIncome = {};
  const byCatExpense = {};
  const expenseByDocType = {};
  const suppliersTop = {};

  tx.forEach(t => {
    const amt = Number(t.amount)||0;

    if(t.type === 'INCOME') kpi.income_total += amt;
    else if(t.type === 'EXPENSE') kpi.expense_total += amt;

    if(!byMethod[t.method]) byMethod[t.method] = {income:0, expense:0};
    if(t.type === 'INCOME') byMethod[t.method].income += amt;
    else if(t.type === 'EXPENSE') byMethod[t.method].expense += amt;

    if(t.type === 'INCOME'){
      if(!byCatIncome[t.category]) byCatIncome[t.category] = 0;
      byCatIncome[t.category] += amt;
    } else if(t.type === 'EXPENSE'){
      if(!byCatExpense[t.category]) byCatExpense[t.category] = 0;
      byCatExpense[t.category] += amt;

      if(!expenseByDocType[t.doc_type]) expenseByDocType[t.doc_type] = {amount:0, count:0};
      expenseByDocType[t.doc_type].amount += amt;
      expenseByDocType[t.doc_type].count++;

      if(t.supplier){
        if(!suppliersTop[t.supplier]) suppliersTop[t.supplier] = {amount:0, count:0};
        suppliersTop[t.supplier].amount += amt;
        suppliersTop[t.supplier].count++;
      }
    }
  });

  kpi.net = kpi.income_total - kpi.expense_total;

  const byMethodArr = Object.keys(byMethod).map(m=>({method:m, ...byMethod[m]}));
  const byCatIncomeArr = Object.keys(byCatIncome).map(c=>({category:c, amount:byCatIncome[c]}));
  const byCatExpenseArr = Object.keys(byCatExpense).map(c=>({category:c, amount:byCatExpense[c]}));
  const expenseByDocTypeArr = Object.keys(expenseByDocType).map(d=>({doc_type:d, ...expenseByDocType[d]}));
  const suppliersTopArr = Object.keys(suppliersTop).map(s=>({supplier:s, ...suppliersTop[s]})).sort((a,b)=>b.amount-a.amount);

  const closings = listClosings_({dateFrom: query?.dateFrom, dateTo: query?.dateTo, store: query?.store});

  return {
    kpi,
    byMethod: byMethodArr,
    byCatIncome: byCatIncomeArr,
    byCatExpense: byCatExpenseArr,
    expenseByDocType: expenseByDocTypeArr,
    suppliersTop: suppliersTopArr,
    closings,
    recentTx: tx
  };
}

function listClosings_(query){
  ensureSheets_();
  const sh = getSheet_(SH_DAY);
  const last = sh.getLastRow();
  if (last < 2) return [];

  const data = sh.getRange(2,1,last-1,sh.getLastColumn()).getValues();
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const cols = {}; headers.forEach((h,i)=> cols[String(h)] = i);

  const df = query?.dateFrom ? toDateOnly_(query.dateFrom) : null;
  const dt = query?.dateTo   ? toDateOnly_(query.dateTo)   : null;
  const store = query?.store ? String(query.store) : null;

  const toNum_ = v => Number(String(v||0).replace(',','.')) || 0;

  const rows = data.filter(r => {
    const d = toDateOnly_(r[cols.date]);
    if (!d) return false;
    if (df && d < df) return false;
    if (dt && d > dt) return false;
    if (store && String(r[cols.store]||'') !== store) return false;
    return true;
  });

  return rows.map(r=>({
    date: toDateOnly_(r[cols.date]) || '',
    store: String(r[cols.store]||''),
    sales_cash: toNum_(r[cols.sales_cash]),
    sales_card: toNum_(r[cols.sales_card]),
    sales_bank: toNum_(r[cols.sales_bank]),
    expenses_cash: toNum_(r[cols.expenses_cash]),
    expenses_card: toNum_(r[cols.expenses_card]),
    expenses_bank: toNum_(r[cols.expenses_bank]),
    declared_cash: toNum_(r[cols.declared_cash]),
    expected_cash: toNum_(r[cols.expected_cash]),
    diff: toNum_(r[cols.diff])
  }));
}

function exportReportCsvV2(query){
  const tx = listTransactions({dateFrom: query?.dateFrom, dateTo: query?.dateTo, store: query?.store, limit: 1000});
  const header = ['timestamp','date','store','type','method','category','description','amount','user','supplier','doc_type','doc_number','doc_date','doc_file_id','doc_file_url'];
  const rows = tx.map(t => [t.timestamp, t.date, t.store, t.type, t.method, t.category, t.description, t.amount, t.user, t.supplier, t.doc_type, t.doc_number, t.doc_date, t.doc_file_id, t.doc_file_url]);
  const csv = [header.join(','), ...rows.map(r => r.map(v => '"'+String(v).replace(/"/g,'""')+'"').join(','))].join('\n');
  return Utilities.newBlob(csv, 'text/csv', 'transactions.csv');
}

function saveCashCount(payload){
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

  sh.appendRow([ new Date(), dateOnly, store, ...qtys, round2_(total), user ]);
  return {ok:true, total: round2_(total)};
}

function getDailySummary(date, store){
  ensureSheets_();
  const dateOnly = toDateOnly_(date);
  const tx = listTransactions({dateFrom: dateOnly, dateTo: dateOnly, store: store, limit: 5000});
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
  return {date: dateOnly, store: store||'Основен', ...sum, expectedCash};
}

function closeDay(payload) {
  ensureSheets_();
  const dateOnly = toDateOnly_(payload.date);
  const store = payload.store || 'Основен';
  const declared = round2_(Number(payload.declaredCash) || 0);
  const note = String(payload.note || '');
  const user = Session.getActiveUser().getEmail() || 'anonymous';

  const sCum = getCumulativeSummary(dateOnly, store);
  const expectedCash = round2_(sCum.expectedCash);
  const diff = round2_(declared - expectedCash);

  const sh = getSheet_(SH_DAY);
  sh.appendRow([
    new Date(),
    dateOnly,
    store,
    round2_(sCum.sales.CASH || 0),
    round2_(sCum.sales.CARD || 0),
    round2_(sCum.sales.BANK || 0),
    round2_(sCum.expenses.CASH || 0),
    round2_(sCum.expenses.CARD || 0),
    round2_(sCum.expenses.BANK || 0),
    declared,
    expectedCash,
    diff,
    note,
    user
  ]);

  return { ok: true, expectedCash, declared, diff };
}

function getCumulativeSummary(dateTo, store) {
  ensureSheets_();
  const dt = toDateOnly_(dateTo) || toDateOnly_(new Date());
  const tx = listTransactions({ dateTo: dt, store: store || '', limit: 500000 });
  const methods = getMeta().methods;

  const sum = { sales: {}, expenses: {}, total: { sales: 0, expenses: 0 } };
  methods.forEach(m => { sum.sales[m] = 0; sum.expenses[m] = 0; });

  tx.forEach(t => {
    const a = Number(t.amount) || 0;
    if (t.type === 'INCOME') { sum.sales[t.method] = (sum.sales[t.method] || 0) + a; sum.total.sales += a; }
    else if (t.type === 'EXPENSE') { sum.expenses[t.method] = (sum.expenses[t.method] || 0) + a; sum.total.expenses += a; }
  });

  const expectedCash = round2_((sum.sales.CASH || 0) - (sum.expenses.CASH || 0));
  return { dateTo: dt, store: store || 'Основен', ...sum, expectedCash };
}

/**************************************************
 * INTERNALS
 **************************************************/

function ensureSheets_(){
  const ss = SpreadsheetApp.openById(SS_ID);

  // Transactions
  const txHeader = [
    'timestamp','date','dateKey','store','type','method','category','description',
    'amount','user','supplier','doc_type','doc_number','doc_date','doc_file_id','doc_file_url'
  ];
  let shTx = ss.getSheetByName(SH_TX);
  if(!shTx){
    shTx = ss.insertSheet(SH_TX);
    shTx.getRange(1,1,1,txHeader.length).setValues([txHeader]);
    shTx.setFrozenRows(1);
  }else{
    const existing = shTx.getLastColumn()>0 ? shTx.getRange(1,1,1,shTx.getLastColumn()).getValues()[0].map(String) : [];
    let nextCol = existing.length;
    txHeader.forEach(h=>{
      if(!existing.includes(h)){
        nextCol += 1;
        shTx.getRange(1,nextCol).setValue(h);
      }
    });
    if(shTx.getFrozenRows() === 0) shTx.setFrozenRows(1);
  }
  TX_COLS = {};
  const header = shTx.getRange(1,1,1,shTx.getLastColumn()).getValues()[0];
  header.forEach((h,i)=>{ TX_COLS[String(h)] = i; });

  // CashCounts
  const denoms = getExistingOrDefaultDenoms_();
  ensureSheetWithHeader_(ss, SH_CNT, ['timestamp','date','store', ...denoms.map(d=>`qty_${d}`), 'total','user']);

  // DayClosings
  ensureSheetWithHeader_(ss, SH_DAY, [
    'timestamp','date','store',
    'sales_cash','sales_card','sales_bank',
    'expenses_cash','expenses_card','expenses_bank',
    'declared_cash','expected_cash','diff','note','user'
  ]);

  // Settings
  ensureSheetWithHeader_(ss, SH_SET, ['key','value']);

  // Users – УНИФИЦИРАНО
  let shU = ss.getSheetByName(SH_USERS);
  if(!shU){
    shU = ss.insertSheet(SH_USERS);
    shU.getRange(1,1,1,4).setValues([['Name','Email','PasswordHash','Role']]);
    shU.setFrozenRows(1);
  } else if (shU.getLastRow()===0){
    shU.getRange(1,1,1,4).setValues([['Name','Email','PasswordHash','Role']]);
  }

  // Suppliers
  ensureSheetWithHeader_(ss, SH_SUP, ['supplier','created_at','created_by']);
}
function ping_(){ ensureSheets_(); return 'OK'; }



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
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if(isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}
function round2_(n){ return Math.round((Number(n)||0)*100)/100; }
function defaultReport_(){
  return {
    kpi:{income_total:0,expense_total:0,net:0,tx_count:0},
    byMethod:[],byCatIncome:[],byCatExpense:[],
    expenseByDocType:[],suppliersTop:[],closings:[],recentTx:[]
  };
}



function getAdminUrl(){ return ScriptApp.getService().getUrl() + '?view=admin'; }

function seedAdminUser_(){
  const ss = SpreadsheetApp.openById(SS_ID);
  let sh = ss.getSheetByName('Users');
  if (!sh){
    sh = ss.insertSheet('Users');
    sh.getRange(1,1,1,4).setValues([['Name','Email','PasswordHash','Role']]);
  } else {
    const h = sh.getRange(1,1,1,Math.max(4, sh.getLastColumn())).getValues()[0];
    if (h[0] !== 'Name' || h[1] !== 'Email' || h[2] !== 'PasswordHash' || h[3] !== 'Role') {
      sh.getRange(1,1,1,4).setValues([['Name','Email','PasswordHash','Role']]);
    }
  }

  const existing = sh.getLastRow() > 1
    ? sh.getRange(2,2,sh.getLastRow()-1,1).getValues().map(r=>String(r[0]||'').toLowerCase())
    : [];
  const email = 'admin@example.com';
  if (existing.includes(email.toLowerCase())) {
    return false;
  }

  const hash = (s)=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8)
                  .map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
  sh.appendRow(['Admin',email, hash('admin123'), 'ADMIN']);
  return true;
}

// End of file
