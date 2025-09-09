/**************************************************
 * CONFIG
 **************************************************/
const TZ      = 'Europe/Sofia';
const SS_ID   = SpreadsheetApp.getActive().getId();

const SH_TX   = 'Transactions';
const SH_CNT  = 'CashCounts';
const SH_DAY  = 'DayClosings';
const SH_SET  = 'Settings';
const SH_USERS= 'Users';
const SH_SUP  = 'Suppliers';

const DEFAULT_DENOMS  = [100,50,20,10,5,2,1,0.5,0.2,0.1,0.05];
const DEFAULT_METHODS = ['CASH','CARD','BANK'];
const DEFAULT_TYPES   = ['INCOME','EXPENSE'];
const DOC_TYPES = [
  'INVOICE','CREDIT_NOTE','DEBIT_NOTE','DELIVERY_NOTE','FISCAL_RECEIPT',
  'CASH_VOUCHER_OUT','BANK_PAYMENT','BANK_FEE','VAT_PROTOCOL','RECEIPT','CONTRACT','OTHER'
];

let TX_COLS = {}; // map колона->индекс за Transactions
const SP = PropertiesService.getScriptProperties();

/**************************************************
 * WEB APP & MENU
 **************************************************/
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

/**************************************************
 * PUBLIC API
 **************************************************/
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
  const row = new Array(Object.keys(cols).length).fill('');
  row[cols.timestamp]    = new Date();
  row[cols.date]         = dateOnly;
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
  const store = query?.store ? String(query.store) : null;

  let rows = data.filter(r => {
    const date = r[cols.date];
    let ok = true;
    if(df && date < df) ok = false;
    if(dt && date > dt) ok = false;
    if(store && cols.store !== undefined && String(r[cols.store]) !== store) ok = false;
    return ok;
  });
  rows.sort((a,b)=> new Date(b[cols.timestamp]).getTime()-new Date(a[cols.timestamp]).getTime());
  const lim = Math.min(Number(query?.limit||200), 1000);
  rows = rows.slice(0, lim);

  return rows.map(r=>({
    timestamp: r[cols.timestamp],
    date: r[cols.date],
    store: cols.store!==undefined ? r[cols.store] : '',
    type: r[cols.type],
    method: r[cols.method],
    category: cols.category!==undefined ? r[cols.category] : '',
    description: cols.description!==undefined ? r[cols.description] : '',
    amount: toNum_(r[cols.amount]),
    user: cols.user!==undefined ? r[cols.user] : '',
    supplier: cols.supplier!==undefined ? r[cols.supplier] : '',
    doc_type: cols.doc_type!==undefined ? r[cols.doc_type] : '',
    doc_number: cols.doc_number!==undefined ? r[cols.doc_number] : '',
    doc_date: cols.doc_date!==undefined ? r[cols.doc_date] : '',
    doc_file_id: cols.doc_file_id!==undefined ? r[cols.doc_file_id] : '',
    doc_file_url: cols.doc_file_url!==undefined ? r[cols.doc_file_url] : ''
  }));
}

function getReportV2(query){
  const tx = listTransactions({dateFrom: query?.dateFrom, dateTo: query?.dateTo, store: query?.store, limit: 1000});
  const kpi = {income_total:0, expense_total:0, net:0, tx_count:tx.length};
  tx.forEach(t => {
    if(t.type === 'INCOME') kpi.income_total += Number(t.amount)||0;
    else if(t.type === 'EXPENSE') kpi.expense_total += Number(t.amount)||0;
  });
  kpi.net = kpi.income_total - kpi.expense_total;
  return {kpi, byMethod:[], byCatIncome:[], byCatExpense:[], expenseByDocType:[], suppliersTop:[], closings:[], recentTx: tx};
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

  sh.appendRow([
    new Date(), dateOnly, store, ...qtys, round2_(total), user
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
    new Date(), dateOnly, store,
    round2_(s.sales.CASH||0), round2_(s.sales.CARD||0), round2_(s.sales.BANK||0),
    round2_(s.expenses.CASH||0), round2_(s.expenses.CARD||0), round2_(s.expenses.BANK||0),
    declared, expectedCash, diff, note, user
  ]);

  return {ok:true, expectedCash, declared, diff};
}

/**************************************************
 * INTERNALS
 **************************************************/
function ensureSheets_(){
  const ss = SpreadsheetApp.openById(SS_ID);

  // Transactions
  const txHeader = ['timestamp','date','store','type','method','category','description','amount','user','supplier','doc_type','doc_number','doc_date','doc_file_id','doc_file_url'];
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

/**************************************************
 * BOTS: Viber + Telegram
 **************************************************/

/* ====== Viber ====== */
// !!! СМЕНИ ТОКЕНА !!!
const VIBER_AUTH_TOKEN = 'PASTE_YOUR_VIBER_TOKEN';
const VIBER_API = 'https://chatapi.viber.com/pa';

const VBR_STEP = {
  START:'START', TYPE:'TYPE', CATEGORY:'CATEGORY', SUPPLIER:'SUPPLIER',
  DOC_TYPE:'DOC_TYPE', DOC_NUMBER:'DOC_NUMBER', DOC_DATE:'DOC_DATE',
  AMOUNT:'AMOUNT', METHOD:'METHOD', NOTE:'NOTE', CONFIRM:'CONFIRM'
};

// Viber state
function vbrKey_(uid){ return 'VBR_STATE_'+uid; }
function vbrGetState_(uid){
  const c = CacheService.getUserCache();
  const raw = c.get(vbrKey_(uid));
  if (raw) { try { return JSON.parse(raw); } catch(e){} }
  const init = { step: VBR_STEP.START };
  vbrSetState_(uid, init);
  return init;
}
function vbrSetState_(uid, patch){
  const c = CacheService.getUserCache();
  const cur = vbrGetState_(uid);
  const next = Object.assign({}, cur, patch);
  c.put(vbrKey_(uid), JSON.stringify(next), 21600);
  return next;
}
function vbrReset_(uid){
  const c = CacheService.getUserCache();
  c.remove(vbrKey_(uid));
  vbrSetState_(uid, { step: VBR_STEP.START });
}

// Viber keyboards
function vbrBtn_(text, value){
  return {"Columns":6,"Rows":1,"BgColor":"#FFFFFF","ActionType":"reply","ActionBody":value,"Text":text};
}
function vbrMainKb_(){
  return {"Type":"keyboard","DefaultHeight":true,"Buttons":[
    vbrBtn_('➖ Разход','/expense'),
    vbrBtn_('➕ Приход','/income'),
    vbrBtn_('📤 Reset','/reset'),
    vbrBtn_('🧾 Logs','/logs')
  ]};
}
function vbrTypeKb_(){
  return {"Type":"keyboard","DefaultHeight":true,"Buttons":[
    vbrBtn_('➕ INCOME','INCOME'),
    vbrBtn_('➖ EXPENSE','EXPENSE')
  ]};
}
function vbrMethodsKb_(){ return {"Type":"keyboard","DefaultHeight":true,"Buttons": DEFAULT_METHODS.map(m=>vbrBtn_(m,m)) }; }
function vbrDocTypesKb_(){ return {"Type":"keyboard","DefaultHeight":true,"Buttons": DOC_TYPES.map(d=>vbrBtn_(d,d)) }; }
function vbrCategoriesKb_(type){
  const cats = getMeta().categories[type] || [];
  return {"Type":"keyboard","DefaultHeight":true,"Buttons": cats.map(c=>vbrBtn_(c,c)) };
}
function vbrConfirmKb_(){
  return {"Type":"keyboard","DefaultHeight":true,"Buttons":[
    vbrBtn_('✅ Потвърди','✅ Потвърди'),
    vbrBtn_('❌ Отмени','❌ Отмени')
  ]};
}

// Viber API helpers
function vbrSend_(receiverId, text, keyboard){
  const payload = { receiver: receiverId, min_api_version: 7, type: 'text', text: String(text) };
  if (keyboard) payload.keyboard = keyboard;
  const res = UrlFetchApp.fetch(VIBER_API + '/send_message', {
    method:'post', contentType:'application/json', payload: JSON.stringify(payload),
    headers: { 'X-Viber-Auth-Token': VIBER_AUTH_TOKEN }, muteHttpExceptions:true
  });
  SP.setProperty('VBR_LOG', ((SP.getProperty('VBR_LOG')||'')+'\nSEND '+res.getResponseCode()+': '+res.getContentText()).split('\n').slice(-200).join('\n'));
}
function setViberWebhook(){
  const url = ScriptApp.getService().getUrl();
  const payload = { url, event_types:['conversation_started','message','subscribed','unsubscribed','delivered','seen','webhook'], send_name:true, send_photo:false };
  const res = UrlFetchApp.fetch(VIBER_API + '/set_webhook', {
    method:'post', contentType:'application/json', payload: JSON.stringify(payload),
    headers: { 'X-Viber-Auth-Token': VIBER_AUTH_TOKEN }, muteHttpExceptions:true
  });
  SP.setProperty('VBR_LOG', ((SP.getProperty('VBR_LOG')||'')+'\nWEBHOOK '+res.getResponseCode()+': '+res.getContentText()).split('\n').slice(-200).join('\n'));
}
// Viber signature
function vbrVerifySig_(body, signature){
  try{
    if (!signature) return false;
    const raw = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, body, VIBER_AUTH_TOKEN);
    const hex = raw.map(b => ('0'+(b & 0xFF).toString(16)).slice(-2)).join('');
    return hex === String(signature).toLowerCase();
  }catch(e){ return false; }
}
function vbrLog_(){
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  const line = now+' | '+[].slice.call(arguments).map(a=>{ try{return (typeof a==='string')?a:JSON.stringify(a);}catch(e){return String(a);} }).join(' | ');
  SP.setProperty('VBR_LOG', ((SP.getProperty('VBR_LOG')||'')+'\n'+line).split('\n').slice(-200).join('\n'));
}
function vbrGetLogs_(){ return (SP.getProperty('VBR_LOG')||'').split('\n').filter(Boolean).slice(-50).join('\n'); }
function vbrHandleWizard_(uid, text){
  const st = vbrGetState_(uid);

  if (st.step === VBR_STEP.START || st.step === VBR_STEP.TYPE){
    let picked = null;
    if (text.includes('➖') || text.toUpperCase()==='EXPENSE' || text.toLowerCase()==='/expense') picked = 'EXPENSE';
    if (text.includes('➕') || text.toUpperCase()==='INCOME'  || text.toLowerCase()==='/income')  picked = 'INCOME';
    if (!picked){ vbrSetState_(uid,{step:VBR_STEP.TYPE}); vbrSend_(uid,'Избери тип:', vbrTypeKb_()); return; }
    vbrSetState_(uid,{type:picked, step:VBR_STEP.CATEGORY});
    vbrSend_(uid,'Избери категория:', vbrCategoriesKb_(picked)); return;
  }
  if (st.step === VBR_STEP.CATEGORY){
    const cats = getMeta().categories[st.type] || [];
    if (!cats.includes(text)){ vbrSend_(uid,'Избери валидна категория:', vbrCategoriesKb_(st.type)); return; }
    if (st.type === 'EXPENSE'){ vbrSetState_(uid,{category:text, step:VBR_STEP.SUPPLIER}); vbrSend_(uid,'Въведи доставчик (име):'); return; }
    vbrSetState_(uid,{category:text, step:VBR_STEP.AMOUNT}); vbrSend_(uid,'Въведи сума (точка за десетични):'); return;
  }
  if (st.step === VBR_STEP.SUPPLIER){
    const sup = String(text).trim(); if (!sup){ vbrSend_(uid,'Въведи доставчик:'); return; }
    vbrSetState_(uid,{supplier:sup, step:VBR_STEP.DOC_TYPE}); vbrSend_(uid,'Избери тип документ:', vbrDocTypesKb_()); return;
  }
  if (st.step === VBR_STEP.DOC_TYPE){
    const d = String(text).toUpperCase();
    if (!DOC_TYPES.includes(d)){ vbrSend_(uid,'Избери валиден тип документ:', vbrDocTypesKb_()); return; }
    if (['INVOICE','CREDIT_NOTE','DEBIT_NOTE','VAT_PROTOCOL'].includes(d)){
      vbrSetState_(uid,{doc_type:d, step:VBR_STEP.DOC_NUMBER}); vbrSend_(uid,'Въведи номер на документ:'); return;
    } else {
      vbrSetState_(uid,{doc_type:d, doc_number:'', step:VBR_STEP.DOC_DATE}); vbrSend_(uid,'Въведи дата на документа (ГГГГ-ММ-ДД):'); return;
    }
  }
  if (st.step === VBR_STEP.DOC_NUMBER){
    const num = String(text).trim(); if (!num){ vbrSend_(uid,'Въведи номер на документ:'); return; }
    vbrSetState_(uid,{doc_number:num, step:VBR_STEP.DOC_DATE}); vbrSend_(uid,'Въведи дата на документа (ГГГГ-ММ-ДД):'); return;
  }
  if (st.step === VBR_STEP.DOC_DATE){
    vbrSetState_(uid,{doc_date:String(text).trim(), step:VBR_STEP.AMOUNT}); vbrSend_(uid,'Въведи сума (точка за десетични):'); return;
  }
  if (st.step === VBR_STEP.AMOUNT){
    const a = parseFloat(String(text).replace(',','.')); if (!(a>0)){ vbrSend_(uid,'Невалидна сума. Опитай пак:'); return; }
    vbrSetState_(uid,{amount:a, step:VBR_STEP.METHOD}); vbrSend_(uid,'Метод на плащане:', vbrMethodsKb_()); return;
  }
  if (st.step === VBR_STEP.METHOD){
    const m = String(text).toUpperCase(); if (!DEFAULT_METHODS.includes(m)){ vbrSend_(uid,'Избери валиден метод:', vbrMethodsKb_()); return; }
    vbrSetState_(uid,{method:m, step:VBR_STEP.NOTE}); vbrSend_(uid,'Бележка (по избор) – напиши текст или „-”:'); return;
  }
  if (st.step === VBR_STEP.NOTE){
    const note = (text === '-' ? '' : String(text));
    vbrSetState_(uid,{note, step:VBR_STEP.CONFIRM});
    const s = vbrGetState_(uid);
    const review = [
      `Тип: ${s.type}`, `Категория: ${s.category||''}`, `Доставчик: ${s.supplier||''}`,
      `Документ: ${s.doc_type||''} №${s.doc_number||''} ${s.doc_date?('('+s.doc_date+')'):''}`,
      `Сума: ${s.amount}`, `Метод: ${s.method}`, `Описание: ${note||''}`
    ].join('\n');
    vbrSend_(uid, 'Провери и потвърди:\n\n'+review, vbrConfirmKb_()); return;
  }
  if (st.step === VBR_STEP.CONFIRM){
    if (text === '✅ Потвърди'){
      try{
        const s = vbrGetState_(uid);
        const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
        const payload = {
          date: today, type: s.type, method: s.method,
          category: s.category || '', description: s.note || '', amount: s.amount,
          supplier: s.type==='EXPENSE' ? s.supplier : '',
          doc_type: s.type==='EXPENSE' ? (s.doc_type||'') : '',
          doc_number: s.type==='EXPENSE' ? (s.doc_number||'') : '',
          doc_date: s.type==='EXPENSE' ? (s.doc_date||'') : ''
        };
        addTransaction(payload);
        if (payload.supplier) { try{ addSupplier(payload.supplier); }catch(e){} }
        vbrSend_(uid, '✅ Записано. Можеш да започнеш нова операция.', vbrMainKb_());
        vbrReset_(uid);
      }catch(err){ vbrSend_(uid, '❌ Грешка: '+err.message); }
      return;
    }
    if (text === '❌ Отмени'){ vbrReset_(uid); vbrSend_(uid, '❌ Отменено. Започни наново.', vbrMainKb_()); return; }
    vbrSend_(uid, 'Натисни „✅ Потвърди“ или „❌ Отмени“.', vbrConfirmKb_()); return;
  }
  vbrSetState_(uid,{step:VBR_STEP.TYPE});
  vbrSend_(uid,'Избери операция:', vbrTypeKb_());
}

/* ====== Telegram ====== */
/***** ===== TELEGRAM (clean) ===== *****/
const TG_TOKEN  = '8387121974:AAGwblEpebB_WgxIjZS7SAaoWzmXIB-5BPE';
const TG_SECRET = 'epoha2206_tg_secret_2025';
const TG_API    = 'https://api.telegram.org/bot' + TG_TOKEN;

const TG_STEP = {
  START:'START', TYPE:'TYPE', CATEGORY:'CATEGORY', SUPPLIER:'SUPPLIER',
  DOC_TYPE:'DOC_TYPE', DOC_NUMBER:'DOC_NUMBER', DOC_DATE:'DOC_DATE',
  AMOUNT:'AMOUNT', METHOD:'METHOD', NOTE:'NOTE', CONFIRM:'CONFIRM'
};

/* ===== State (без рекурсия) ===== */
function tgKey_(uid){ return 'TG_STATE_'+uid; }

function tgGetState_(uid){
  const c = CacheService.getUserCache();
  const raw = c.get(tgKey_(uid));
  if (raw){ try { return JSON.parse(raw); } catch(e){} }
  const init = { step: TG_STEP.START };
  c.put(tgKey_(uid), JSON.stringify(init), 21600); // 6 часа
  return init;
}

function tgSetState_(uid, patch){
  const c = CacheService.getUserCache();
  let cur = {};
  const raw = c.get(tgKey_(uid));
  if (raw){ try { cur = JSON.parse(raw) || {}; } catch(e){} }
  const next = Object.assign({}, cur, patch);
  c.put(tgKey_(uid), JSON.stringify(next), 21600);
  return next;
}

function tgReset_(uid){
  const c = CacheService.getUserCache();
  c.remove(tgKey_(uid));
  c.put(tgKey_(uid), JSON.stringify({ step: TG_STEP.START }), 21600);
}

/* ===== Keyboards ===== */
function tgKb_(rows){ return { keyboard: rows, resize_keyboard:true, one_time_keyboard:false }; }
function tgMainKb_(){ return tgKb_([['➖ Разход','➕ Приход'],['📤 Reset','🧾 Logs']]); }
function tgTypeKb_(){ return tgKb_([['➕ INCOME','➖ EXPENSE']]); }
function tgMethodsKb_(){ return tgKb_([DEFAULT_METHODS]); }
function tgDocTypesKb_(){
  const rows=[]; DOC_TYPES.forEach((d,i)=>{ if(i%3===0) rows.push([]); rows[rows.length-1].push(d); });
  return tgKb_(rows);
}
function tgCategoriesKb_(type){
  const cats = getMeta().categories[type] || [];
  const rows=[]; cats.forEach((c,i)=>{ if(i%3===0) rows.push([]); rows[rows.length-1].push(c); });
  return tgKb_(rows.length?rows:[['Друго']]);
}

/* ===== API ===== */
function tgSend_(chatId, text, kb){
  const payload = { chat_id: chatId, text: String(text) };
  if (kb) payload.reply_markup = JSON.stringify(kb);

  const res = UrlFetchApp.fetch(TG_API + '/sendMessage', {
    method:'post', payload, muteHttpExceptions:true
  });

  SP.setProperty('TG_LOG', ((SP.getProperty('TG_LOG')||'')+
    `\nTG_SEND to=${chatId} resp=${res.getResponseCode()} ${res.getContentText()}`).split('\n').slice(-200).join('\n'));
}

const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwzndATrElud-Knu9fsZJ-6dTxug5ps578hKR662Uy9SC-PY2qsrc3XLmnOcYYXvrPS/exec';
function setTelegramWebhook(){
  const url = ScriptApp.getService().getUrl(); // ВАЖНО: това е /exec
  const res = UrlFetchApp.fetch(TG_API + '/setWebhook', {
    method:'post', contentType:'application/json',
    payload: JSON.stringify({
      url,
      secret_token: TG_SECRET,
      allowed_updates:['message'],
      drop_pending_updates:true
    }),
    muteHttpExceptions:true
  });
  Logger.log(res.getResponseCode()+' '+res.getContentText());
}

function tgGetWebhookInfo(){
  const r = UrlFetchApp.fetch(TG_API + '/getWebhookInfo', { muteHttpExceptions:true });
  Logger.log(r.getResponseCode()+' '+r.getContentText());
}

function tgGetMe(){
  const r = UrlFetchApp.fetch(TG_API + '/getMe', { muteHttpExceptions:true });
  Logger.log(r.getResponseCode()+' '+r.getContentText());
}

/* ===== Router ===== */
function tgHandleUpdate_(upd){
  const msg = upd.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const uid = String(chatId);
  const text = (msg.text || '').trim();

  if (text === '/start'){ tgReset_(uid); tgSend_(chatId,'Готов съм. Избери операция:', tgMainKb_()); return; }
  if (text === '/reset' || text === '📤 Reset'){ tgReset_(uid); tgSend_(chatId,'Сесията е нулирана. Избери операция:', tgMainKb_()); return; }
  if (text === '/logs'  || text === '🧾 Logs'){ tgSend_(chatId, (SP.getProperty('TG_LOG')||'').split('\n').filter(Boolean).slice(-20).join('\n') || 'Няма логове.'); return; }

  tgHandleWizard_(uid, chatId, text);
}

function tgHandleWizard_(uid, chatId, text){
  const st = tgGetState_(uid);

  if (st.step === TG_STEP.START || st.step === TG_STEP.TYPE){
    let picked=null;
    if (text.includes('➖') || text.toUpperCase()==='EXPENSE' || text.toLowerCase()==='/expense') picked='EXPENSE';
    if (text.includes('➕') || text.toUpperCase()==='INCOME'  || text.toLowerCase()==='/income')  picked='INCOME';
    if (!picked){ tgSetState_(uid,{step:TG_STEP.TYPE}); tgSend_(chatId,'Избери тип:', tgTypeKb_()); return; }
    tgSetState_(uid,{type:picked, step:TG_STEP.CATEGORY});
    tgSend_(chatId,'Избери категория:', tgCategoriesKb_(picked)); return;
  }

  if (st.step === TG_STEP.CATEGORY){
    const cats = getMeta().categories[st.type] || [];
    if (!cats.includes(text)){ tgSend_(chatId,'Избери валидна категория:', tgCategoriesKb_(st.type)); return; }
    if (st.type === 'EXPENSE'){ tgSetState_(uid,{category:text, step:TG_STEP.SUPPLIER}); tgSend_(chatId,'Въведи доставчик (име):'); return; }
    tgSetState_(uid,{category:text, step:TG_STEP.AMOUNT}); tgSend_(chatId,'Въведи сума (точка за десетични):'); return;
  }

  if (st.step === TG_STEP.SUPPLIER){
    const sup = String(text).trim(); if (!sup){ tgSend_(chatId,'Въведи доставчик:'); return; }
    tgSetState_(uid,{supplier:sup, step:TG_STEP.DOC_TYPE}); tgSend_(chatId,'Избери тип документ:', tgDocTypesKb_()); return;
  }

  if (st.step === TG_STEP.DOC_TYPE){
    const d = String(text).toUpperCase();
    if (!DOC_TYPES.includes(d)){ tgSend_(chatId,'Избери валиден тип документ:', tgDocTypesKb_()); return; }
    if (['INVOICE','CREDIT_NOTE','DEBIT_NOTE','VAT_PROTOCOL'].includes(d)){
      tgSetState_(uid,{doc_type:d, step:TG_STEP.DOC_NUMBER}); tgSend_(chatId,'Въведи номер на документ:'); return;
    } else {
      tgSetState_(uid,{doc_type:d, doc_number:'', step:TG_STEP.DOC_DATE}); tgSend_(chatId,'Въведи дата на документа (ГГГГ-ММ-ДД):'); return;
    }
  }

  if (st.step === TG_STEP.DOC_NUMBER){
    const num = String(text).trim(); if (!num){ tgSend_(chatId,'Въведи номер на документ:'); return; }
    tgSetState_(uid,{doc_number:num, step:TG_STEP.DOC_DATE}); tgSend_(chatId,'Въведи дата на документа (ГГГГ-ММ-ДД):'); return;
  }

  if (st.step === TG_STEP.DOC_DATE){
    tgSetState_(uid,{doc_date:String(text).trim(), step:TG_STEP.AMOUNT}); tgSend_(chatId,'Въведи сума (точка за десетични):'); return;
  }

  if (st.step === TG_STEP.AMOUNT){
    const a = parseFloat(String(text).replace(',','.')); if (!(a>0)){ tgSend_(chatId,'Невалидна сума. Опитай пак:'); return; }
    tgSetState_(uid,{amount:a, step:TG_STEP.METHOD}); tgSend_(chatId,'Метод на плащане:', tgMethodsKb_()); return;
  }

  if (st.step === TG_STEP.METHOD){
    const m = String(text).toUpperCase(); if (!DEFAULT_METHODS.includes(m)){ tgSend_(chatId,'Избери валиден метод:', tgMethodsKb_()); return; }
    tgSetState_(uid,{method:m, step:TG_STEP.NOTE}); tgSend_(chatId,'Бележка (по избор) – напиши текст или „-”:'); return;
  }

  if (st.step === TG_STEP.NOTE){
    const note = (text === '-' ? '' : String(text));
    tgSetState_(uid,{note, step:TG_STEP.CONFIRM});
    const s = tgGetState_(uid);
    const review = [
      `Тип: ${s.type}`, `Категория: ${s.category||''}`, `Доставчик: ${s.supplier||''}`,
      `Документ: ${s.doc_type||''} №${s.doc_number||''} ${s.doc_date?('('+s.doc_date+')'):''}`,
      `Сума: ${s.amount}`, `Метод: ${s.method}`, `Описание: ${note||''}`
    ].join('\n');
    tgSend_(chatId,'Провери и потвърди:\n\n'+review, tgKb_([['✅ Потвърди','❌ Отмени']])); return;
  }

  if (st.step === TG_STEP.CONFIRM){
    if (text === '✅ Потвърди'){
      try{
        const s = tgGetState_(uid);
        const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
        const payload = {
          date: today, type: s.type, method: s.method,
          category: s.category || '', description: s.note || '', amount: s.amount,
          supplier: s.type==='EXPENSE' ? s.supplier : '',
          doc_type: s.type==='EXPENSE' ? (s.doc_type||'') : '',
          doc_number: s.type==='EXPENSE' ? (s.doc_number||'') : '',
          doc_date: s.type==='EXPENSE' ? (s.doc_date||'') : ''
        };
        addTransaction(payload);
        if (payload.supplier) { try{ addSupplier(payload.supplier); }catch(e){} }
        tgSend_(chatId,'✅ Записано. Можеш да започнеш нова операция.', tgMainKb_());
        tgReset_(uid);
      }catch(err){ tgSend_(chatId,'❌ Грешка: '+err.message); }
      return;
    }
    if (text === '❌ Отмени'){ tgReset_(uid); tgSend_(chatId,'❌ Отменено. Започни наново.', tgMainKb_()); return; }
    tgSend_(chatId,'Натисни „✅ Потвърди“ или „❌ Отмени“.', tgKb_([['✅ Потвърди','❌ Отмени']])); return;
  }

  tgSetState_(uid,{step:TG_STEP.TYPE});
  tgSend_(chatId,'Избери операция:', tgTypeKb_());
}

/**************************************************
 * COMMON HELPERS
 **************************************************/
function getHdr_(hdrs, name){
  if (!hdrs) return '';
  if (hdrs[name] != null) return hdrs[name];
  const low = name.toLowerCase();
  for (var k in hdrs){
    if (!Object.prototype.hasOwnProperty.call(hdrs,k)) continue;
    if (String(k).toLowerCase() === low) return hdrs[k];
  }
  return '';
}

/**************************************************
 * Единен doPost (с проверка на secret + лог)
 **************************************************/
// helper: case-insensitive header
function getHdr_(hdrs, name){
  if (!hdrs) return '';
  if (hdrs[name] != null) return hdrs[name];
  const low = name.toLowerCase();
  for (var k in hdrs){
    if (Object.prototype.hasOwnProperty.call(hdrs,k) && String(k).toLowerCase() === low) return hdrs[k];
  }
  return '';
}

/** ====== doPost (с проверка на secret + лог) ====== */
function getHdr_(hdrs, name){
  if (!hdrs) return '';
  if (hdrs[name] != null) return hdrs[name];
  const low = name.toLowerCase();
  for (var k in hdrs){
    if (!Object.prototype.hasOwnProperty.call(hdrs,k)) continue;
    if (String(k).toLowerCase() === low) return hdrs[k];
  }
  return '';
}

function doPost(e){
  ensureSheets_();

  const body   = e && e.postData && e.postData.contents ? e.postData.contents : '';
  const hdrs   = (e && e.postData && e.postData.headers) ? e.postData.headers : {};
  const hjson  = JSON.stringify(hdrs || {}).slice(0, 800);
  const bfrag  = String(body || '').slice(0, 800);

  SP.setProperty('TG_LOG', ((SP.getProperty('TG_LOG')||'')+
    `\nHIT ${new Date().toISOString()} HDRS:${hjson} BODY:${bfrag}`).split('\n').slice(-300).join('\n'));

  if (!body){
    SP.setProperty('TG_LOG', ((SP.getProperty('TG_LOG')||'')+'\nEMPTY_BODY').split('\n').slice(-300).join('\n'));
    return ContentService.createTextOutput('ok');
  }

  // Telegram?
  let obj=null; try { obj = JSON.parse(body); } catch(_){ obj = null; }
  const isTelegram = obj && Object.prototype.hasOwnProperty.call(obj, 'update_id');

  if (isTelegram){
    const tgSecretHdr = getHdr_(hdrs, 'X-Telegram-Bot-Api-Secret-Token');
    if (tgSecretHdr !== TG_SECRET){
      SP.setProperty('TG_LOG', ((SP.getProperty('TG_LOG')||'')+
        `\nBAD_SECRET got="${tgSecretHdr}" expected="${TG_SECRET}"`).split('\n').slice(-300).join('\n'));
      return ContentService.createTextOutput('ok');
    }
    try{
      tgHandleUpdate_(obj);
      SP.setProperty('TG_LOG', ((SP.getProperty('TG_LOG')||'')+'\nTG_HANDLED').split('\n').slice(-300).join('\n'));
    }catch(err){
      SP.setProperty('TG_LOG', ((SP.getProperty('TG_LOG')||'')+'\nTG_ERR '+(err && err.stack || err)).split('\n').slice(-300).join('\n'));
    }
    return ContentService.createTextOutput('ok');
  }

  // Viber?
  const viberSig = getHdr_(hdrs, 'X-Viber-Content-Signature');
  if (viberSig){
    if (!vbrVerifySig_(body, viberSig)) {
      vbrLog_('INVALID_SIG');
      return ContentService.createTextOutput('invalid signature');
    }
    try{
      const data = JSON.parse(body);
      vbrLog_('IN', data.event);

      switch (data.event) {
        case 'webhook': return ContentService.createTextOutput('webhook ok');
        case 'conversation_started': {
          const uid = data.user && data.user.id;
          if (uid){ vbrReset_(uid); vbrSend_(uid,'Здравей! Избери операция:', vbrMainKb_()); }
          return ContentService.createTextOutput('ok');
        }
        case 'subscribed': {
          const uid = data.user && data.user.id;
          if (uid){ vbrReset_(uid); vbrSend_(uid,'Абонамент активен. Избери операция:', vbrMainKb_()); }
          return ContentService.createTextOutput('ok');
        }
        case 'message': {
          const uid = data.sender && data.sender.id;
          const text = (data.message && data.message.text || '').trim();
          if (!uid) return ContentService.createTextOutput('ok');
          if (text.toLowerCase()==='/reset' || text==='📤 Reset'){ vbrReset_(uid); vbrSend_(uid,'Сесията е нулирана. Избери операция:', vbrMainKb_()); return ContentService.createTextOutput('ok'); }
          if (text.toLowerCase()==='/logs'  || text==='🧾 Logs'){ vbrSend_(uid, vbrGetLogs_() || 'Няма логове.'); return ContentService.createTextOutput('ok'); }
          vbrHandleWizard_(uid, text);
          return ContentService.createTextOutput('ok');
        }
        default: return ContentService.createTextOutput('ok');
      }
    }catch(err){
      vbrLog_('VBR_ERR', err && err.stack || err);
      return ContentService.createTextOutput('ok');
    }
  }

  // Unknown
  SP.setProperty('TG_LOG', ((SP.getProperty('TG_LOG')||'')+'\nUNKNOWN_PAYLOAD').split('\n').slice(-300).join('\n'));
  return ContentService.createTextOutput('ok');
}


/**************************************************
 * УТИЛИТИ: байпас и диагностика
 **************************************************/
function tgBypassOn(){ PropertiesService.getScriptProperties().setProperty('TG_SILENT','1'); }
function tgBypassOff(){ PropertiesService.getScriptProperties().setProperty('TG_SILENT','0'); }

function tgGetWebhookInfo(){
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot'+TG_TOKEN+'/getWebhookInfo', {muteHttpExceptions:true});
  Logger.log(r.getResponseCode()+' '+r.getContentText());
}

function dbgShowLogs(){ Logger.log(PropertiesService.getScriptProperties().getProperty('TG_LOG') || '(empty)'); }
function dbgClearLogs(){ PropertiesService.getScriptProperties().deleteProperty('TG_LOG'); Logger.log('cleared'); }

