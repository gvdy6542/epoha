/** ===================== CONFIG ===================== **/
const TZ      = 'Europe/Sofia';
const SS_ID   = SpreadsheetApp.getActive().getId();
const SH_TX   = 'Transactions';     // Операции (приход/разход)
const SH_CNT  = 'CashCounts';       // Броене на каса по деноминации
const SH_DAY  = 'DayClosings';      // Дневни отчети / приключване
const SH_SET  = 'Settings';         // Настройки (по избор)
const SH_USERS= 'Users';            // Потребители (по избор)

const DEFAULT_DENOMS  = [100,50,20,10,5,2,1,0.5,0.2,0.1,0.05];
const DEFAULT_METHODS = ['CASH','CARD','BANK'];
const DEFAULT_TYPES   = ['INCOME','EXPENSE'];
const SH_SUP  = 'Suppliers';        // Доставчици
const REPORT_PIN = '6176';          // PIN за справки
const DOC_TYPES = [
  'INVOICE','CREDIT_NOTE','DEBIT_NOTE','DELIVERY_NOTE','FISCAL_RECEIPT',
  'CASH_VOUCHER_OUT','BANK_PAYMENT','BANK_FEE','VAT_PROTOCOL','RECEIPT','CONTRACT','OTHER'
];

let TX_COLS = {}; // map колона->индекс за Transactions

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

/** ===================== PUBLIC API (called from UI) ===================== **/
function getMeta(){
  ensureSheets_();
  const set = getSheet_(SH_SET);
  const meta = {
    denoms: DEFAULT_DENOMS.slice(),
    methods: DEFAULT_METHODS.slice(),
    types: DEFAULT_TYPES.slice(),
    stores: ['Основен'],
    categories: {
      INCOME: ['Продажби', 'Друг приход'],
      EXPENSE: ['Стока', 'Наем', 'Комунални', 'Касови разходи', 'Друго']
    }
  };

  // Позволи override от Settings (key/value)
  const rows = set.getLastRow() > 1 ? set.getRange(2,1,set.getLastRow()-1,2).getValues() : [];
  const map = {};
  rows.forEach(r=> map[String(r[0]||'').trim()] = String(r[1]||'').trim());
  if(map.DENOMS){ try{ meta.denoms = JSON.parse(map.DENOMS); }catch(e){} }
  if(map.METHODS){ try{ meta.methods = JSON.parse(map.METHODS); }catch(e){} }
  if(map.STORES){ try{ meta.stores = JSON.parse(map.STORES); }catch(e){} }
  if(map.CAT_INCOME){ try{ meta.categories.INCOME = JSON.parse(map.CAT_INCOME); }catch(e){} }
  if(map.CAT_EXPENSE){ try{ meta.categories.EXPENSE = JSON.parse(map.CAT_EXPENSE); }catch(e){} }

  return meta;
}

function verifyReportPin(pin){
  const p = String(pin||'');
  if(p === REPORT_PIN){
    const until = Date.now() + 12*60*60*1000;
    PropertiesService.getUserProperties().setProperty('REPORT_OK_UNTIL', String(until));
    return {ok:true, until};
  }
  throw new Error('Невалиден PIN');
}

function isReportAllowed_(){
  const until = Number(PropertiesService.getUserProperties().getProperty('REPORT_OK_UNTIL')||0);
  return until > Date.now();
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
 * payload:
 *   date, store, type, method, category, description, amount
 *   [if EXPENSE] supplier, doc_type, doc_number, doc_date
 *   [optional file] file: {name, mimeType, bytes(base64)}
 */
function addTransaction(payload){
  ensureSheets_();
  const required = ['date','type','method','amount'];
  required.forEach(k=>{
    if(payload[k] === undefined || payload[k] === null || payload[k] === ''){
      throw new Error('Липсва поле: '+k);
    }
  });

  const type = String(payload.type||'').toUpperCase();
  if(!DEFAULT_TYPES.includes(type)) throw new Error('Невалиден тип (INCOME/EXPENSE)');

  const method = String(payload.method||'').toUpperCase();
  if(!getMeta().methods.includes(method)) throw new Error('Невалиден метод на плащане');

  let amount = Number(payload.amount);
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

  // файл (по избор)
  let fileId = '', fileUrl = '';
  if(payload.file && payload.file.bytes){
    const saved = saveTxDocumentFile_(payload.file, payload.store || 'Основен', dateOnly);
    fileId = saved.id || '';
    fileUrl = saved.url || '';
  }

  const cols = TX_COLS;
  const row = new Array(Object.keys(cols).length).fill('');
  row[cols.timestamp]    = new Date();
  row[cols.date]         = dateOnly;
  row[cols.store]        = payload.store || 'Основен';
  row[cols.type]         = type;
  row[cols.method]       = method;
  row[cols.category]     = payload.category || '';
  row[cols.supplier]     = supplier;
  row[cols.doc_type]     = docType;
  row[cols.doc_number]   = docNumber;
  row[cols.doc_date]     = docDate;
  row[cols.description]  = payload.description || '';
  row[cols.amount]       = round2_(amount);
  row[cols.user]         = user;
  if(cols.doc_file_id !== undefined)  row[cols.doc_file_id]  = fileId;
  if(cols.doc_file_url !== undefined) row[cols.doc_file_url] = fileUrl;

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
  const df = query?.dateFrom ? toDateOnly_(query.dateFrom) : null;
  const dt = query?.dateTo   ? toDateOnly_(query.dateTo)   : null;
  const store = query?.store || null;
  let rows = data.filter(r => {
    const date = r[cols.date];
    const st = r[cols.store];
    let ok = true;
    if(df && date < df) ok = false;
    if(dt && date > dt) ok = false;
    if(store && st !== store) ok = false;
    return ok;
  });
  rows.sort((a,b)=> new Date(b[cols.timestamp]).getTime()-new Date(a[cols.timestamp]).getTime());
  const lim = Math.min(Number(query?.limit||200), 1000);
  rows = rows.slice(0, lim);

  return rows.map(r=>({
    timestamp: r[cols.timestamp],
    date: r[cols.date],
    store: r[cols.store],
    type: r[cols.type],
    method: r[cols.method],
    category: r[cols.category],
    supplier: r[cols.supplier],
    doc_type: r[cols.doc_type],
    doc_number: r[cols.doc_number],
    doc_date: r[cols.doc_date],
    description: r[cols.description],
    amount: r[cols.amount],
    user: r[cols.user],
    doc_file_id:  cols.doc_file_id  !== undefined ? (r[cols.doc_file_id]  || '') : '',
    doc_file_url: cols.doc_file_url !== undefined ? (r[cols.doc_file_url] || '') : ''
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

function closeDay(payload){
  // payload: {date, store, declaredCash, note}
  ensureSheets_();
  const dateOnly = toDateOnly_(payload.date);
  const store = payload.store || 'Основен';
  const declared = round2_(Number(payload.declaredCash)||0);
  const note = String(payload.note||'');
  const user = Session.getActiveUser().getEmail() || 'anonymous';

  const s = getDailySummary(dateOnly, store);
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

function getReportData(query){
  ensureSheets_();
  if(!isReportAllowed_()) throw new Error('Unauthorized');

  const df = toDateOnly_(query.dateFrom);
  const dt = toDateOnly_(query.dateTo);
  const store = query?.store || null;

  const methods = getMeta().methods;
  const byMethod = {income:{}, expense:{}};
  methods.forEach(m=>{ byMethod.income[m]=0; byMethod.expense[m]=0; });
  const byCatIncome = {}, byCatExpense = {};
  const expDoc = {}, supMap = {};
  let income_total=0, expense_total=0, income_count=0, expense_count=0;

  const sh = getSheet_(SH_TX);
  const last = sh.getLastRow();
  const recentTx = [];
  if(last >= 2){
    const data = sh.getRange(2,1,last-1,sh.getLastColumn()).getValues();
    const cols = TX_COLS;
    const rows = data.filter(r=>{
      const d = r[cols.date];
      const st = r[cols.store];
      if(df && d < df) return false;
      if(dt && d > dt) return false;
      if(store && st !== store) return false;
      return true;
    });
    rows.forEach(r=>{
      const t = r[cols.type];
      const amt = Number(r[cols.amount])||0;
      const m = r[cols.method];
      const cat = r[cols.category]||'';
      if(t === 'INCOME'){
        income_total += amt; income_count++;
        byMethod.income[m] = (byMethod.income[m]||0)+amt;
        byCatIncome[cat] = (byCatIncome[cat]||0)+amt;
      }else if(t === 'EXPENSE'){
        expense_total += amt; expense_count++;
        byMethod.expense[m] = (byMethod.expense[m]||0)+amt;
        byCatExpense[cat] = (byCatExpense[cat]||0)+amt;
        const dtp = r[cols.doc_type]||'';
        if(dtp){
          const o = expDoc[dtp]||{amount:0,count:0};
          o.amount += amt; o.count++; expDoc[dtp]=o;
        }
        const sup = r[cols.supplier]||'';
        if(sup){
          const o = supMap[sup]||{amount:0,count:0};
          o.amount += amt; o.count++; supMap[sup]=o;
        }
      }
    });
    rows.sort((a,b)=> new Date(b[cols.timestamp]).getTime()-new Date(a[cols.timestamp]).getTime());
    rows.slice(0,100).forEach(r=>{
      recentTx.push({
        timestamp:r[cols.timestamp],
        date:r[cols.date],
        store:r[cols.store],
        type:r[cols.type],
        method:r[cols.method],
        category:r[cols.category],
        supplier:r[cols.supplier],
        doc_type:r[cols.doc_type],
        doc_number:r[cols.doc_number],
        doc_date:r[cols.doc_date],
        description:r[cols.description],
        amount:r[cols.amount],
        user:r[cols.user],
        doc_file_url: (TX_COLS.doc_file_url !== undefined) ? (r[TX_COLS.doc_file_url]||'') : ''
      });
    });
  }

  const byCategory = {
    income: Object.keys(byCatIncome).map(k=>({category:k, amount: round2_(byCatIncome[k])})),
    expense: Object.keys(byCatExpense).map(k=>({category:k, amount: round2_(byCatExpense[k])}))
  };
  const expenseByDocType = Object.keys(expDoc).map(k=>({doc_type:k, amount: round2_(expDoc[k].amount), count: expDoc[k].count}));
  const suppliersTop = Object.keys(supMap).map(k=>({supplier:k, amount: round2_(supMap[k].amount), count: supMap[k].count})).sort((a,b)=>b.amount-a.amount).slice(0,20);
  methods.forEach(m=>{ byMethod.income[m]=round2_(byMethod.income[m]||0); byMethod.expense[m]=round2_(byMethod.expense[m]||0); });

  // DayClosings
  const shd = getSheet_(SH_DAY);
  const closings = [];
  const lastd = shd.getLastRow();
  if(lastd >= 2){
    const h = shd.getRange(1,1,1,shd.getLastColumn()).getValues()[0];
    const idx = {}; h.forEach((v,i)=>idx[v]=i);
    const data = shd.getRange(2,1,lastd-1,shd.getLastColumn()).getValues();
    data.forEach(r=>{
      const d = r[idx.date];
      const st = r[idx.store];
      if(df && d<df) return;
      if(dt && d>dt) return;
      if(store && st!==store) return;
      closings.push({
        date:d, store:st,
        sales_cash:r[idx.sales_cash]||0,
        sales_card:r[idx.sales_card]||0,
        sales_bank:r[idx.sales_bank]||0,
        expenses_cash:r[idx.expenses_cash]||0,
        expenses_card:r[idx.expenses_card]||0,
        expenses_bank:r[idx.expenses_bank]||0,
        declared_cash:r[idx.declared_cash]||0,
        expected_cash:r[idx.expected_cash]||0,
        diff:r[idx.diff]||0
      });
    });
  }

  income_total = round2_(income_total);
  expense_total = round2_(expense_total);
  const net = round2_(income_total - expense_total);
  const kpi = {income_total, expense_total, net, tx_count: income_count+expense_count, income_count, expense_count};

  return {
    range:{from: df || '', to: dt || '', store: store || 'Всички'},
    kpi,
    byMethod,
    byCategory,
    expenseByDocType,
    suppliersTop,
    closings,
    recentTx
  };
}

function exportReportCsv(query){
  ensureSheets_();
  if(!isReportAllowed_()) throw new Error('Unauthorized');
  const data = getReportData(query);
  if(!data || !data.kpi) throw new Error('Няма данни за справка');

  const from = data.range.from || '';
  const to   = data.range.to   || '';
  const store= data.range.store|| 'Всички';

  const lines = [];
  const csvCell_ = v => `"${String(v||'').replace(/"/g,'""').replace(/\n/g,' ')}"`;
  lines.push(`Период от,${from},до,${to},Магазин,${store}`);
  lines.push('');
  lines.push('KPI');
  lines.push(`Общ приход,${data.kpi.income_total.toFixed(2)}`);
  lines.push(`Общ разход,${data.kpi.expense_total.toFixed(2)}`);
  lines.push(`Нето,${data.kpi.net.toFixed(2)}`);
  lines.push(`Брой операции,${data.kpi.tx_count}`);
  lines.push('');
  lines.push('По метод');
  lines.push('Метод,Приход,Разход');
  Object.keys(data.byMethod.income).forEach(m=>{
    lines.push(`${m},${data.byMethod.income[m].toFixed(2)},${data.byMethod.expense[m].toFixed(2)}`);
  });
  lines.push('');
  lines.push('Приходи по категории');
  lines.push('Категория,Сума');
  data.byCategory.income.forEach(c=> lines.push(`${csvCell_(c.category)},${c.amount.toFixed(2)}`));
  lines.push('');
  lines.push('Разходи по категории');
  lines.push('Категория,Сума');
  data.byCategory.expense.forEach(c=> lines.push(`${csvCell_(c.category)},${c.amount.toFixed(2)}`));
  lines.push('');
  lines.push('Разходи по тип документ');
  lines.push('Тип,Сума,Брой');
  data.expenseByDocType.forEach(d=> lines.push(`${csvCell_(d.doc_type)},${d.amount.toFixed(2)},${d.count}`));
  lines.push('');
  lines.push('Топ доставчици');
  lines.push('Доставчик,Сума,Брой');
  data.suppliersTop.forEach(s=> lines.push(`${csvCell_(s.supplier)},${s.amount.toFixed(2)},${s.count}`));
  lines.push('');
  lines.push('Последни операции');
  lines.push('timestamp,date,store,type,method,category,supplier,doc_type,doc_number,doc_date,description,amount,user,doc_file_url');
  data.recentTx.forEach(t=>{
    lines.push([
      t.timestamp,
      t.date,
      t.store,
      t.type,
      t.method,
      t.category||'',
      t.supplier||'',
      t.doc_type||'',
      t.doc_number||'',
      t.doc_date||'',
      t.description||'',
      Number(t.amount).toFixed(2),
      t.user||'',
      t.doc_file_url||''
    ].map(csvCell_).join(','));
  });
  const csv = lines.join('\n');
  const fname = `Report_${from}_${to}_${store}.csv`;
  return Utilities.newBlob(csv, 'text/csv', fname);
}

/** ===================== INTERNALS ===================== **/
function ensureSheets_(){
  const ss = SpreadsheetApp.openById(SS_ID);

  // Transactions с миграция (+ колони за файл)
  const txHeader = [
    'timestamp','date','store','type','method','category','supplier',
    'doc_type','doc_number','doc_date','description','amount','user',
    'doc_file_id','doc_file_url'
  ];
  let shTx = ss.getSheetByName(SH_TX);
  if(!shTx){
    shTx = ss.insertSheet(SH_TX);
    shTx.getRange(1,1,1,txHeader.length).setValues([txHeader]);
    shTx.setFrozenRows(1);
  }else{
    const existing = shTx.getRange(1,1,1,shTx.getLastColumn()).getValues()[0].map(h=>String(h));
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

  // Settings
  ensureSheetWithHeader_(ss, SH_SET, ['key','value']);

  // Users (по избор)
  ensureSheetWithHeader_(ss, SH_USERS, ['email','name','role','stores']);

  // Suppliers
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
  // устойчиво към празни/невалидни стойности – връща yyyy-mm-dd или null
  if(!v) return null;
  const d = new Date(v);
  if(isNaN(d.getTime())) return null;
  const tz = Session.getScriptTimeZone() || TZ;
  const y = Utilities.formatDate(d, tz, 'yyyy');
  const m = Utilities.formatDate(d, tz, 'MM');
  const day = Utilities.formatDate(d, tz, 'dd');
  return `${y}-${m}-${day}`;
}

function round2_(n){
  return Math.round((Number(n)||0)*100)/100;
}

/** ====== Drive helpers for document files ====== **/
function getDocsFolderId_(){
  const set = getSheet_(SH_SET);
  const last = set.getLastRow();
  if(last >= 2){
    const rows = set.getRange(2,1,last-1,2).getValues();
    for(const [k,v] of rows){
      if(String(k).trim() === 'DOC_FOLDER_ID' && v) return String(v).trim();
    }
  }
  const parent = DriveApp.getRootFolder();
  const folder = parent.createFolder('StoreDocs');
  set.appendRow(['DOC_FOLDER_ID', folder.getId()]);
  return folder.getId();
}

function saveTxDocumentFile_(fileObj, store, dateOnly){
  if(!fileObj || !fileObj.bytes) return {id:'', url:''};
  const rootId = getDocsFolderId_();
  let folder = DriveApp.getFolderById(rootId);

  const y = (dateOnly||'').split('-')[0] || Utilities.formatDate(new Date(), TZ, 'yyyy');
  const m = (dateOnly||'').split('-')[1] || Utilities.formatDate(new Date(), TZ, 'MM');

  function getOrCreate_(parent, name){
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  }

  folder = getOrCreate_(folder, store || 'Основен');
  folder = getOrCreate_(folder, y);
  folder = getOrCreate_(folder, m);

  const blob = Utilities.newBlob(Utilities.base64Decode(fileObj.bytes), fileObj.mimeType || 'application/octet-stream', fileObj.name || 'document');
  const f = folder.createFile(blob);
  return { id: f.getId(), url: f.getUrl() };
}

