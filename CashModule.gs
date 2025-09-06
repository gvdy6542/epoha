/**
 * Модул за касови операции - приходи, разходи и обороти.
 */

/**
 * Уверява се, че съществува лист "Cash" с подходящи заглавки.
 * @return {GoogleAppsScript.Spreadsheet.Sheet} Листа с касовите записи.
 */
function getCashSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Cash');
  if (!sheet) {
    sheet = ss.insertSheet('Cash');
    sheet.appendRow(['Дата', 'Тип', 'Описание', 'Сума']);
  }
  return sheet;
}

/**
 * Запис на оборот.
 * @param {number} amount Сума на оборота.
 * @param {Date} [date] Дата (по избор).
 */
function addTurnover(amount, date) {
  var sheet = getCashSheet();
  sheet.appendRow([date || new Date(), 'Оборот', '', amount]);
}

/**
 * Запис на приход.
 * @param {string} desc Описание на прихода.
 * @param {number} amount Сума.
 * @param {Date} [date] Дата (по избор).
 */
function addIncome(desc, amount, date) {
  var sheet = getCashSheet();
  sheet.appendRow([date || new Date(), 'Приход', desc, amount]);
}

/**
 * Запис на разход.
 * @param {string} desc Описание на разхода.
 * @param {number} amount Сума.
 * @param {Date} [date] Дата (по избор).
 */
function addExpense(desc, amount, date) {
  var sheet = getCashSheet();
  sheet.appendRow([date || new Date(), 'Разход', desc, amount]);
}

/**
 * Връща отчет за приходите, разходите и баланса.
 * @return {{income:number, expense:number, balance:number}}
 */
function getCashReport() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Cash');
  if (!sheet) {
    return { income: 0, expense: 0, balance: 0 };
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { income: 0, expense: 0, balance: 0 };
  }
  var data = sheet.getRange(2, 2, lastRow - 1, 3).getValues();
  var income = 0;
  var expense = 0;
  data.forEach(function(row) {
    var type = row[0];
    var amount = parseFloat(row[2]) || 0;
    if (type === 'Приход' || type === 'Оборот') {
      income += amount;
    } else if (type === 'Разход') {
      expense += amount;
    }
  });
  return { income: income, expense: expense, balance: income - expense };
}

