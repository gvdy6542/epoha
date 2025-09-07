
/** ===================== TELEGRAM BOT ===================== **/
/** ===================== TELEGRAM BOT ===================== **/
// Ползва глобалния SP отгоре в файла: const SP = PropertiesService.getScriptProperties();

const TG_TOKEN = (SP.getProperty('TG_TOKEN') || '').trim();
const TG_API   = TG_TOKEN ? `https://api.telegram.org/bot${TG_TOKEN}` : '';
const STATE_PREFIX = 'STATE_';

/** --- Helpers --- **/
function parseCsvProp_(key){
  return (SP.getProperty(key) || '').split(',').map(s=>s.trim()).filter(Boolean);
}
function isAdmin_(id){ return parseCsvProp_('TG_ADMINS').includes(String(id)); }
function isAllowed_(id){
  const allowed = parseCsvProp_('TG_ALLOWED');
  const admins  = parseCsvProp_('TG_ADMINS');
  const ok = !allowed.length ? admins.includes(String(id)) : allowed.includes(String(id)) || admins.includes(String(id));
  Logger.log(`isAllowed chatId=${id} ok=${ok} allowed=${JSON.stringify(allowed)} admins=${JSON.stringify(admins)}`);
  return ok;
}
function rateLimitOk_(id){
  const cache = CacheService.getScriptCache();
  const key = 'RL_'+id;
  const hit = !!cache.get(key);
  Logger.log(`rateLimit chatId=${id} hit=${hit}`);
  if(hit) return false;
  cache.put(key,'1',20);
  return true;
}
function getState_(id){ const v = SP.getProperty(STATE_PREFIX+id); return v?JSON.parse(v):null; }
function setState_(id,st){ SP.setProperty(STATE_PREFIX+id,JSON.stringify(st)); }
function clearState_(id){ SP.deleteProperty(STATE_PREFIX+id); }

/** sendMessage – reply_markup се подава като JSON-стринг (по изискване на Telegram) */
function tgSend_(chatId,text,opts){
  if(!TG_API) return;
  if(String(SP.getProperty('TG_SILENT')||'')==='1') return;

  const payload = { chat_id: String(chatId), text: String(text) };

  if (opts) {
    if (opts.reply_markup) payload.reply_markup = JSON.stringify(opts.reply_markup);
    Object.keys(opts).forEach(k=>{ if(k!=='reply_markup') payload[k] = opts[k]; });
  }

  try {
    const resp = UrlFetchApp.fetch(`${TG_API}/sendMessage`,{
      method:'post',
      contentType:'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions:true
    });
    Logger.log("tgSend payload: " + JSON.stringify(payload));
    Logger.log("tgSend resp: " + resp.getContentText());
  } catch (err) {
    Logger.log("tgSend ERROR: " + err);
  }
}

function answerCallback_(id){
  if(!TG_API) return;
  UrlFetchApp.fetch(`${TG_API}/answerCallbackQuery`,{
    method:'post',
    payload:{callback_query_id:id},
    muteHttpExceptions:true
  });
}
function notifyBlocked_(chatId){
  const admins = parseCsvProp_('TG_ADMINS');
  if(!admins.length) return;
  const key = 'BLOCK_'+chatId;
  const last = Number(SP.getProperty(key)||0);
  if(Date.now()-last < 3600*1000) return;
  SP.setProperty(key,String(Date.now()));
  admins.forEach(a=>tgSend_(a,`Chat ${chatId} опита достъп.`));
}
function startKeyboard_(){
  return {
    keyboard:[
      [{text:'➕ Приход'},{text:'➖ Разход'}],
      [{text:'📊 Справка'}]
    ],
    resize_keyboard:true
  };
}

/** --- Общи списъци / клавиатури --- **/
const DOC_TYPE_LABELS = [
  {code:'INVOICE',label:'Фактура'},
  {code:'CREDIT_NOTE',label:'Кредитно'},
  {code:'DEBIT_NOTE',label:'Дебитно'},
  {code:'DELIVERY_NOTE',label:'Стокова'},
  {code:'FISCAL_RECEIPT',label:'Фискален'},
  {code:'CASH_VOUCHER_OUT',label:'РКО'},
  {code:'BANK_PAYMENT',label:'Превод'},
  {code:'BANK_FEE',label:'Банкова такса'},
  {code:'VAT_PROTOCOL',label:'Протокол'},
  {code:'RECEIPT',label:'Разписка'},
  {code:'CONTRACT',label:'Договор'},
  {code:'OTHER',label:'Друг'}
];
function docTypeKeyboard_(){
  const kb=[]; for(let i=0;i<DOC_TYPE_LABELS.length;i+=3){
    kb.push(DOC_TYPE_LABELS.slice(i,i+3).map(d=>({text:d.label,callback_data:'doc:'+d.code})));
  }
  return {inline_keyboard:kb};
}
function supplierKeyboard_(page){
  const all = listSuppliers();
  const PAGE = 6;
  const p = Math.max(0, Number(page)||0);
  const start = p*PAGE;
  const arr = all.slice().sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase())).slice(start,start+PAGE);
  const kb = arr.map(s=>[{text:s,callback_data:'sup:'+encodeURIComponent(s)}]);
  if(all.length>PAGE){
    const nav=[]; if(p>0) nav.push({text:'◀️',callback_data:'sup_page:'+(p-1)});
    if(start+PAGE<all.length) nav.push({text:'▶️',callback_data:'sup_page:'+(p+1)});
    if(nav.length) kb.push(nav);
  }
  kb.push([{text:'🆕 Нов доставчик',callback_data:'sup_new'}]);
  return {inline_keyboard:kb};
}
function methodKeyboard_(){
  return {inline_keyboard:[
    [{text:'💵 Cash',callback_data:'method:CASH'}],
    [{text:'💳 Card',callback_data:'method:CARD'}],
    [{text:'🏦 Bank',callback_data:'method:BANK'}]
  ]};
}

/** ===================== EXPENSE WIZARD ===================== **/
function startExpenseWizard_(chatId){
  const st={step:'docType'};
  setState_(chatId,st);
  askDocType_(chatId);
}
function askDocType_(chatId){
  try {
    tgSend_(chatId,'Избери тип документ:',{reply_markup:docTypeKeyboard_()});
  } catch (err) {
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}
function askDocNumberChoice_(chatId){
  try {
    tgSend_(chatId,'Избери опция за номер:',{reply_markup:{inline_keyboard:[
      [{text:'Без номер',callback_data:'docnum:none'}],
      [{text:'Въведи номер',callback_data:'docnum:custom'}]
    ]}});
  } catch (err) {
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}
function askSupplier_(chatId,state){
  try {
    tgSend_(chatId,'Избери доставчик:',{reply_markup:supplierKeyboard_(state.page||0)});
  } catch (err) {
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}
function askAmountChoice_(chatId){
  try {
    const amounts=[5,10,20,50,100];
    const rows = amounts.map(v=>[{text:`${v} лв`,callback_data:`amount:${v}`}]);
    rows.push([{text:'Въведи друга',callback_data:'amount:custom'}]);
    tgSend_(chatId,'Избери сума:',{reply_markup:{inline_keyboard:rows}});
  } catch (err) {
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}
function askMethod_(chatId){
  try {
    tgSend_(chatId,'Избери метод на плащане:',{reply_markup:methodKeyboard_()});
  } catch (err) {
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}
function askDocDate_(chatId){
  try {
    tgSend_(chatId,'Избери дата на документа:',{reply_markup:{inline_keyboard:[
      [{text:'📅 Днес',callback_data:'date_today'}],
      [{text:'📅 Въведи друга',callback_data:'date_custom'}]
    ]}});
  } catch (err) {
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}
function showConfirmExpense_(chatId,state){
  try {
    const docLabel = DOC_TYPE_LABELS.find(d=>d.code===state.docType)?.label||state.docType;
    const txt = `Разход\n№: ${state.docNumber||'—'}\nДоставчик: ${state.supplier}\nТип: ${docLabel}\nМетод: ${state.method}\nДата: ${state.docDate}\nСума: ${Number(state.amount||0).toFixed(2)} лв`;
    tgSend_(chatId,txt,{reply_markup:{inline_keyboard:[
      [{text:'✅ Запиши',callback_data:'wiz_save_exp'}]
    ]}});
  } catch (err) {
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}

/** ===================== INCOME WIZARD ===================== **/
function startIncomeWizard_(chatId){
  const st={step:'incomeCat'}; setState_(chatId,st); askIncomeCat_(chatId);
}
function askIncomeCat_(chatId){
  try{
    const cats=getMeta().categories.INCOME||[];
    if(!cats.length){ tgSend_(chatId,'Няма дефинирани категории за приход.'); return; }
    const kb = cats.map(c=>[{text:c,callback_data:'inc_cat:'+encodeURIComponent(c)}]);
    tgSend_(chatId,'Избери категория:',{reply_markup:{inline_keyboard:kb}});
  }catch(err){
    tgSend_(chatId,'Грешка при зареждане на категории: '+(err.message||err));
  }
}
function askIncomeAmountChoice_(chatId){
  try {
    const amounts=[5,10,20,50,100];
    const rows = amounts.map(v=>[{text:`${v} лв`,callback_data:`inc_amount:${v}`}]);
    rows.push([{text:'Въведи друга',callback_data:'inc_amount:custom'}]);
    tgSend_(chatId,'Избери сума:',{reply_markup:{inline_keyboard:rows}});
  } catch (err) {
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}
function askIncomeMethod_(chatId){
  try {
    tgSend_(chatId,'Избери метод на плащане:',{reply_markup:methodKeyboard_()});
  } catch (err) {
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}
function askIncomeDate_(chatId){
  try {
    tgSend_(chatId,'Избери дата:',{reply_markup:{inline_keyboard:[
      [{text:'📅 Днес',callback_data:'inc_date_today'}],
      [{text:'📅 Въведи друга',callback_data:'inc_date_custom'}]
    ]}});
  } catch (err) {
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}
function showConfirmIncome_(chatId,state){
  try {
    const txt = `Приход\nКатегория: ${state.category}\nМетод: ${state.method}\nДата: ${state.date}\nСума: ${Number(state.amount||0).toFixed(2)} лв`;
    tgSend_(chatId,txt,{reply_markup:{inline_keyboard:[
      [{text:'✅ Запиши',callback_data:'wiz_save_inc'}]
    ]}});
  } catch (err) {
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}

/** ===================== HANDLERS ===================== **/
function handleMessage_(chatId,text){
  const state=getState_(chatId);
  Logger.log(`handleMessage chatId=${chatId} text=${text} state=${JSON.stringify(state)}`);

  try{
    if(state){
      if(state.step==='waitDocNum'){ state.docNumber=String(text||'').trim(); state.step='supplier'; setState_(chatId,state); askSupplier_(chatId,state); return; }
      if(state.step==='waitAmount'){ const n=Number(String(text).replace(',','.')); if(isNaN(n)){tgSend_(chatId,'Невалидна сума');return;} state.amount=n; state.step='method'; setState_(chatId,state); askMethod_(chatId); return; }
      if(state.step==='waitDocDate'){ state.docDate=String(text||'').trim(); state.step='confirmExp'; setState_(chatId,state); showConfirmExpense_(chatId,state); return; }
      if(state.step==='waitIncAmount'){ const n=Number(String(text).replace(',','.')); if(isNaN(n)){tgSend_(chatId,'Невалидна сума');return;} state.amount=n; state.step='incMethod'; setState_(chatId,state); askIncomeMethod_(chatId); return; }
      if(state.step==='waitIncDate'){ state.date=String(text||'').trim(); state.step='confirmInc'; setState_(chatId,state); showConfirmIncome_(chatId,state); return; }
      if(state.step==='waitNewSupplier'){ // нов доставчик
        try{ addSupplier(text); tgSend_(chatId,'✅ Доставчик добавен.'); state.step='supplier'; setState_(chatId,state); askSupplier_(chatId,state); }
        catch(e){ tgSend_(chatId,'Грешка при добавяне на доставчик: '+(e.message||e)); }
        return;
      }
    }

    if(text==='/start'){ clearState_(chatId); tgSend_(chatId,'Изберете действие:',{reply_markup:startKeyboard_()}); }
    else if(text==='➖ Разход'){ startExpenseWizard_(chatId); }
    else if(text==='➕ Приход'){ startIncomeWizard_(chatId); }
    else if(text==='📊 Справка'){ tgSend_(chatId,'Използвай /spravka YYYY-MM-DD YYYY-MM-DD'); }
    else if(text==='/whoami'){ tgSend_(chatId,`Вашият chat_id: ${chatId}`); }
  }catch(err){
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}

function handleCallback_(chatId,data){
  const state=getState_(chatId)||{};
  Logger.log(`handleCallback chatId=${chatId} data=${data} state=${JSON.stringify(state)}`);

  try{
    // Expense wizard
    if(data.startsWith('doc:')){ state.docType=data.slice(4); state.step='docNumChoice'; setState_(chatId,state); askDocNumberChoice_(chatId); return; }
    if(data==='docnum:none'){ state.docNumber=''; state.step='supplier'; setState_(chatId,state); askSupplier_(chatId,state); return; }
    if(data==='docnum:custom'){ state.step='waitDocNum'; setState_(chatId,state); tgSend_(chatId,'Въведи номер на документ:'); return; }
    if(data.startsWith('sup:')){ state.supplier=decodeURIComponent(data.slice(4)); state.step='amountChoice'; setState_(chatId,state); askAmountChoice_(chatId); return; }
    if(data==='sup_new'){ state.step='waitNewSupplier'; setState_(chatId,state); tgSend_(chatId,'Въведи име на нов доставчик:'); return; }
    if(data.startsWith('sup_page:')){ state.page = Math.max(0, Number(data.split(':')[1])||0); setState_(chatId,state); askSupplier_(chatId,state); return; }
    if(data.startsWith('amount:')){ const v=data.split(':')[1]; if(v==='custom'){state.step='waitAmount';setState_(chatId,state);tgSend_(chatId,'Въведи сума:');return;} state.amount=+v; state.step='method'; setState_(chatId,state); askMethod_(chatId); return; }

    // Income wizard
    if(data.startsWith('inc_cat:')){ state.category=decodeURIComponent(data.slice(8)); state.step='incAmount'; setState_(chatId,state); askIncomeAmountChoice_(chatId); return; }
    if(data.startsWith('inc_amount:')){ const v=data.split(':')[1]; if(v==='custom'){state.step='waitIncAmount';setState_(chatId,state);tgSend_(chatId,'Въведи сума:');return;} state.amount=+v; state.step='incMethod'; setState_(chatId,state); askIncomeMethod_(chatId); return; }

    // Common method handler
    if(data.startsWith('method:')){
      state.method=data.split(':')[1];
      if(state.step==='method'){ state.step='docDate'; setState_(chatId,state); askDocDate_(chatId); return; }
      if(state.step==='incMethod'){ state.step='incDate'; setState_(chatId,state); askIncomeDate_(chatId); return; }
      tgSend_(chatId,'Грешен етап при избор на метод.');
      return;
    }

    // Expense dates and save
    if(data==='date_today'){ state.docDate=new Date().toISOString().slice(0,10); state.step='confirmExp'; setState_(chatId,state); showConfirmExpense_(chatId,state); return; }
    if(data==='date_custom'){ state.step='waitDocDate'; setState_(chatId,state); tgSend_(chatId,'Въведи дата YYYY-MM-DD:'); return; }
    if(data==='wiz_save_exp'){
      try{
        addTransaction({
          date:new Date().toISOString().slice(0,10),
          type:'EXPENSE',
          method:state.method,
          amount:state.amount,
          supplier:state.supplier,
          doc_type:state.docType,
          doc_number:state.docNumber||'',
          doc_date:state.docDate
        });
        tgSend_(chatId,'✅ Разход записан');
      }catch(e){ tgSend_(chatId,'Грешка: '+(e.message||e)); }
      clearState_(chatId); return;
    }

    // Income dates and save
    if(data==='inc_date_today'){ state.date=new Date().toISOString().slice(0,10); state.step='confirmInc'; setState_(chatId,state); showConfirmIncome_(chatId,state); return; }
    if(data==='inc_date_custom'){ state.step='waitIncDate'; setState_(chatId,state); tgSend_(chatId,'Въведи дата YYYY-MM-DD:');return; }
    if(data==='wiz_save_inc'){
      try{
        addTransaction({
          date:new Date().toISOString().slice(0,10),
          type:'INCOME',
          method:state.method,
          amount:state.amount,
          category:state.category
        });
        tgSend_(chatId,'✅ Приход записан');
      }catch(e){ tgSend_(chatId,'Грешка: '+(e.message||e)); }
      clearState_(chatId); return;
    }
  }catch(err){
    tgSend_(chatId,'Грешка: '+(err.message||err));
  }
}

/** --- doPost --- **/
function doPost(e) {
  try {
    Logger.log("RAW update: " + (e?.postData?.contents || 'no body'));

    const token = SP.getProperty('TG_TOKEN');
    if (!token) return ContentService.createTextOutput('missing token');

    const update = JSON.parse(e?.postData?.contents || '{}');
    const updId = Number(update.update_id || 0);
    const last  = Number(SP.getProperty('TG_LAST_UPDATE') || 0);
    if (updId && updId <= last) return ContentService.createTextOutput('ok');
    if (updId) SP.setProperty('TG_LAST_UPDATE', String(updId));

    const msg   = update.message || update.callback_query?.message;
    if (!msg) return ContentService.createTextOutput('ok');

    const chatId = String(msg.chat.id);
    const text   = update.message?.text || '';
    const data   = update.callback_query?.data || '';

    Logger.log(`doPost chatId=${chatId} text=${text} data=${data}`);

    if (update.callback_query) answerCallback_(update.callback_query.id);

    if (text && /^\/whoami\b/i.test(text)) { tgSend_(chatId, `Вашият chat_id: ${chatId}`); return ContentService.createTextOutput('ok'); }
    if (!isAllowed_(chatId)) { notifyBlocked_(chatId); tgSend_(chatId,'Нямате права за достъп. ID: '+chatId); return ContentService.createTextOutput('ok'); }
    if (!isAdmin_(chatId) && !rateLimitOk_(chatId)) return ContentService.createTextOutput('ok');

    if (data) handleCallback_(chatId,data); else handleMessage_(chatId,text||'');
    return ContentService.createTextOutput('ok');
  } catch (err) {
    Logger.log('Error in doPost: ' + err);
    return ContentService.createTextOutput('ok');
  }
}

/** ===== Helpers за CSV properties (админ команди ги ползват) ===== */
function getCsvProp_(key){
  return (PropertiesService.getScriptProperties().getProperty(key) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}
function setCsvProp_(key, arr){
  PropertiesService.getScriptProperties().setProperty(key, (arr||[]).join(','));
}
function addToCsvProp_(key, val){
  const arr = getCsvProp_(key);
  if (!arr.includes(String(val))) arr.push(String(val));
  setCsvProp_(key, arr);
}
function removeFromCsvProp_(key, val){
  const arr = getCsvProp_(key).filter(v => v !== String(val));
  setCsvProp_(key, arr);
}

/** ========= WEBHOOK UTILITIES (работят с ОБИКНОВЕНИЯ script.google.com URL) ========= **/
function setWebhook_TG(){
  const token = SP.getProperty('TG_TOKEN');
  const url   = SP.getProperty('WEBAPP_URL'); // https://script.google.com/macros/s/.../exec
  if(!token) throw new Error('Няма TG_TOKEN в Script Properties');
  if(!url) throw new Error('Няма WEBAPP_URL в Script Properties');

  // чистим стария уебхук и pending updates
  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/deleteWebhook`,{
    method:'post',
    payload:{ drop_pending_updates:true },
    muteHttpExceptions:true
  });

  const resp = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/setWebhook`,{
    method:'post',
    payload:{ url },
    muteHttpExceptions:true
  });
  Logger.log(resp.getContentText());
  return resp.getContentText();
}
function unsetWebhook_TG(){
  const token = SP.getProperty('TG_TOKEN');
  if(!token) throw new Error('Няма TG_TOKEN в Script Properties');
  const resp = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/deleteWebhook`,{
    method:'post',
    payload:{ drop_pending_updates:true },
    muteHttpExceptions:true
  });
  Logger.log(resp.getContentText());
  return resp.getContentText();
}
function getWebhookInfo_TG(){
  const token = SP.getProperty('TG_TOKEN');
  if(!token) throw new Error('Няма TG_TOKEN в Script Properties');
  const resp = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`,{muteHttpExceptions:true});
  Logger.log(resp.getContentText());
  return resp.getContentText();
}
=======
/**
 * Telegram bot wizard draft extracted from user proposal.
 *
 * TODOs:
 *  - Replace hard-coded sheet names with configuration or constants.
 *  - Add validation and error handling around spreadsheet operations.
 *  - Integrate with existing authorization mechanisms and callbacks.
 *  - Write automated tests for message and callback handlers.
 */

// === CONFIG ===
const SP = PropertiesService.getScriptProperties();
const TG_TOKEN = SP.getProperty('TG_TOKEN') || '';
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const STATE_PREFIX = 'STATE_';

const SS = SpreadsheetApp.getActiveSpreadsheet();
const SH_TX = 'Transactions';
const SH_SUP = 'Suppliers';

// === HELPERS ===
function tgSend(chatId, text, opts = {}) {
  const payload = { chat_id: chatId, text, ...opts };
  UrlFetchApp.fetch(`${TG_API}/sendMessage`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

function setState(id, state) {
  SP.setProperty(STATE_PREFIX + id, JSON.stringify(state));
}
function getState(id) {
  const raw = SP.getProperty(STATE_PREFIX + id);
  return raw ? JSON.parse(raw) : null;
}
function clearState(id) {
  SP.deleteProperty(STATE_PREFIX + id);
}

// === START MENU ===
function startKeyboard() {
  return {
    keyboard: [
      [{ text: '➕ Приход' }, { text: '➖ Разход' }],
      [{ text: '📊 Справка' }]
    ],
    resize_keyboard: true
  };
}

// === WIZARD LOGIC ===
function handleMessage(chatId, text) {
  const state = getState(chatId);

  if (text === '/start') {
    clearState(chatId);
    tgSend(chatId, 'Изберете действие:', { reply_markup: startKeyboard() });
    return;
  }

  if (!state) {
    if (text === '➕ Приход') {
      const st = { type: 'INCOME', step: 'waitAmount' };
      setState(chatId, st);
      tgSend(chatId, 'Въведи сума за приход:');
    } else if (text === '➖ Разход') {
      const st = { type: 'EXPENSE', step: 'waitAmount' };
      setState(chatId, st);
      tgSend(chatId, 'Въведи сума за разход:');
    } else if (text === '📊 Справка') {
      tgSend(chatId, 'Използвай /spravka YYYY-MM-DD YYYY-MM-DD');
    }
    return;
  }

  // === Приход ===
  if (state.type === 'INCOME') {
    if (state.step === 'waitAmount') {
      const amt = parseFloat(text.replace(',', '.'));
      if (isNaN(amt)) return tgSend(chatId, 'Невалидна сума. Въведи число.');
      state.amount = amt;
      state.step = 'waitMethod';
      setState(chatId, state);
      return tgSend(chatId, 'Метод на плащане (CASH / CARD / BANK):');
    }

    if (state.step === 'waitMethod') {
      const method = text.trim().toUpperCase();
      if (!['CASH', 'CARD', 'BANK'].includes(method)) return tgSend(chatId, 'Невалиден метод. Използвай CASH, CARD или BANK.');
      state.method = method;
      state.step = 'waitDate';
      setState(chatId, state);
      return tgSend(chatId, 'Дата на операция (YYYY-MM-DD):');
    }

    if (state.step === 'waitDate') {
      const d = new Date(text);
      if (isNaN(d.getTime())) return tgSend(chatId, 'Невалидна дата. Формат YYYY-MM-DD');
      state.date = text;
      state.step = 'confirm';
      setState(chatId, state);

      const msg = `Потвърди приход:\nСума: ${state.amount} лв\nМетод: ${state.method}\nДата: ${state.date}`;
      return tgSend(chatId, msg, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Запиши', callback_data: 'save_income' }]] }
      });
    }
  }

  // === Разход ===
  if (state.type === 'EXPENSE') {
    if (state.step === 'waitAmount') {
      const amt = parseFloat(text.replace(',', '.'));
      if (isNaN(amt)) return tgSend(chatId, 'Невалидна сума. Въведи число.');
      state.amount = amt;
      state.step = 'waitMethod';
      setState(chatId, state);
      return tgSend(chatId, 'Метод на плащане (CASH / CARD / BANK):');
    }

    if (state.step === 'waitMethod') {
      const method = text.trim().toUpperCase();
      if (!['CASH', 'CARD', 'BANK'].includes(method)) return tgSend(chatId, 'Невалиден метод. Използвай CASH, CARD или BANK.');
      state.method = method;
      state.step = 'waitSupplier';
      setState(chatId, state);
      return tgSend(chatId, 'Име на доставчик:');
    }

    if (state.step === 'waitSupplier') {
      const supplier = text.trim();
      state.supplier = supplier;
      state.step = 'waitDate';
      setState(chatId, state);
      return tgSend(chatId, 'Дата на операция (YYYY-MM-DD):');
    }

    if (state.step === 'waitDate') {
      const d = new Date(text);
      if (isNaN(d.getTime())) return tgSend(chatId, 'Невалидна дата. Формат YYYY-MM-DD');
      state.date = text;
      state.step = 'confirm';
      setState(chatId, state);

      const msg = `Потвърди разход:\nСума: ${state.amount} лв\nМетод: ${state.method}\nДоставчик: ${state.supplier}\nДата: ${state.date}`;
      return tgSend(chatId, msg, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Запиши', callback_data: 'save_expense' }]] }
      });
    }
  }
}

// === CALLBACK ===
function handleCallback(chatId, data) {
  const state = getState(chatId);
  if (!state) return tgSend(chatId, 'Няма активна операция.');

  if (data === 'save_income') {
    const sh = SS.getSheetByName(SH_TX);
    sh.appendRow([new Date(), state.date, 'INCOME', state.method, '', '', '', '', '', '', '', state.amount, chatId]);
    clearState(chatId);
    return tgSend(chatId, '✅ Приходът е записан.');
  }

  if (data === 'save_expense') {
    const sh = SS.getSheetByName(SH_TX);
    const supSh = SS.getSheetByName(SH_SUP);
    const suppliers = supSh.getRange(2, 1, supSh.getLastRow() - 1).getValues().flat();
    if (!suppliers.includes(state.supplier)) supSh.appendRow([state.supplier, new Date(), chatId]);

    sh.appendRow([new Date(), state.date, 'EXPENSE', state.method, '', state.supplier, '', '', '', '', '', state.amount, chatId]);
    clearState(chatId);
    return tgSend(chatId, '✅ Разходът е записан.');
  }
}

// === POST HANDLER ===
function doPost(e) {
  const update = JSON.parse(e.postData.contents);
  const msg = update.message || update.callback_query?.message;
  if (!msg) return ContentService.createTextOutput('ok');

  const chatId = String(msg.chat.id);
  const text = update.message?.text || '';
  const data = update.callback_query?.data || '';

  if (update.callback_query) {
    handleCallback(chatId, data);
  } else if (text) {
    handleMessage(chatId, text);
  }

  return ContentService.createTextOutput('ok');
}


