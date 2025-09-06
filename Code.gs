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

function addTransaction(payload){
  ensureSheets_();
  // payload: {date, store, type, method, category, description, amount}
  const required = ['date','store','type','method','amount'];
  required.forEach(k => { if(payload[k] === undefined || payload[k] === null || payload[k] === '') throw new Error('Липсва поле: '+k); });

  const type = String(payload.type||'').toUpperCase();
  if(!DEFAULT_TYPES.includes(type)) throw new Error('Невалиден тип (INCOME/EXPENSE)');

  const method = String(payload.method||'').toUpperCase();
  if(!getMeta().methods.includes(method)) throw new Error('Невалиден метод на плащане');

  const amount = Number(payload.amount);
  if(isNaN(amount)) throw new Error('Сумата не е число');

  const dateOnly = toDateOnly_(payload.date);
  const user = Session.getActiveUser().getEmail() || 'anonymous';

  const sh = getSheet_(SH_TX);
  sh.appendRow([
    new Date(),                    // timestamp
    dateOnly,                      // date (yyyy-mm-dd)
    payload.store || 'Основен',    // store
    type,                          // type
    method,                        // method
    payload.category || '',        // category
    payload.description || '',     // description
    round2_(amount),               // amount
    user                           // user
  ]);
  return {ok:true};
}

function listTransactions(query){
  // query: {dateFrom, dateTo, store, limit}
  ensureSheets_();
  const sh = getSheet_(SH_TX);
  const last = sh.getLastRow();
  if(last < 2) return [];
  const data = sh.getRange(2,1,last-1,9).getValues();
  const df = query?.dateFrom ? toDateOnly_(query.dateFrom) : null;
  const dt = query?.dateTo   ? toDateOnly_(query.dateTo)   : null;
  const store = query?.store || null;
  let rows = data.filter(r => {
    const date = r[1]; // yyyy-mm-dd
    const st = r[2];
    let ok = true;
    if(df && date < df) ok = false;
    if(dt && date > dt) ok = false;
    if(store && st !== store) ok = false;
    return ok;
  });
  // по-новите най-отгоре
  rows.sort((a,b)=> new Date(b[0]).getTime()-new Date(a[0]).getTime());
  const lim = Math.min(Number(query?.limit||200), 1000);
  rows = rows.slice(0, lim);

  // map към обекти
  return rows.map(r=>({
    timestamp: r[0], date: r[1], store: r[2], type: r[3], method: r[4],
    category: r[5], description: r[6], amount: r[7], user: r[8]
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

  // Подредба на деноминациите според meta.denoms
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

/** ===================== INTERNALS ===================== **/
function ensureSheets_(){
  const ss = SpreadsheetApp.openById(SS_ID);

  // Transactions
  ensureSheetWithHeader_(ss, SH_TX, [
    'timestamp','date','store','type','method','category','description','amount','user'
  ]);

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
  // връща yyyy-mm-dd в TZ Europe/Sofia
  const d = typeof v === 'string' ? new Date(v) : new Date(v);
  const tz = Session.getScriptTimeZone() || TZ;
  const y = Utilities.formatDate(d, tz, 'yyyy');
  const m = Utilities.formatDate(d, tz, 'MM');
  const day = Utilities.formatDate(d, tz, 'dd');
  return `${y}-${m}-${day}`;
}

function round2_(n){
  return Math.round((Number(n)||0)*100)/100;
}
