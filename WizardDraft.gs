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

