


// Глобални променливи
var countdownTime = 30; // 30 секунди
var countdownTriggerId; // Идентификатор на тригера за обратния брояч

// Глобална променлива за предишната стойност на оборота
var last_оборот = ""; // Запомня предишната стойност на оборота

function onEdit(e) {
  if (!e || !e.range) return;

  var sheet = e.source.getActiveSheet();
  var editedCell = e.range;
  var rowIndex = editedCell.getRow();
  
  // Проверка дали променената клетка е H4, I4, J4 или K4
  if (rowIndex === 4 && (editedCell.getA1Notation() == 'H4' || editedCell.getA1Notation() == 'I4' || editedCell.getA1Notation() == 'J4' || editedCell.getA1Notation() == 'K4')) {
    var searchDate = sheet.getRange('H4').getValue();
    Logger.log("Въведена дата: " + searchDate);
    
    if (searchDate instanceof Date) {
      // Намираме диапазона с датите в колона A
      var dateRange = sheet.getRange('A:A');
      var values = dateRange.getValues();
      Logger.log("Търсене на съвпадение в колона A");

      // Търсим съвпадение на датата
      for (var i = 0; i < values.length; i++) {
        if (values[i][0] instanceof Date && values[i][0].getTime() === searchDate.getTime()) {
          Logger.log("Намерена дата на ред: " + (i + 1));
          
          // Вземаме стойностите от ред 4 (H4, I4, J4, K4)
          var valueI = sheet.getRange(4, 9).getValue(); // Колона I, ред 4
          var valueJ = sheet.getRange(4, 10).getValue(); // Колона J, ред 4
          var valueK = sheet.getRange(4, 11).getValue(); // Колона K, ред 4
          
          Logger.log("Стойности - I: " + valueI + ", J: " + valueJ + ", K: " + valueK);
          
          // Проверка и прехвърляне на стойности в C, D и F
          if (sheet.getRange(i + 1, 3).getValue() !== valueI) {
            sheet.getRange(i + 1, 3).setValue(valueI); // Колона C
          }
          if (sheet.getRange(i + 1, 4).getValue() !== valueJ) {
            sheet.getRange(i + 1, 4).setValue(valueJ); // Колона D
          }
          if (sheet.getRange(i + 1, 6).getValue() !== valueK) {
            sheet.getRange(i + 1, 6).setValue(valueK); // Колона F
          }

          // Записване на текущото време в Z1
          sheet.getRange('Z1').setValue(new Date().getTime()); // Време на последната редакция

          // Проверка дали I4 и J4 имат стойности
          if (valueI && valueJ) {
            clearCells(); // Изчистване на клетките H4:K4
          }

          break; // Прекратяване на цикъла след прехвърлянето
        }
      }
    } else {
      Logger.log("Не е въведена дата.");
    }
  }
  
  // Проверка дали O11 или O12 са променени
  if (editedCell.getA1Notation() === 'O11' || editedCell.getA1Notation() === 'O12') {
    transferData(); // Прехвърляне на данни
  }

  // Проверка за днешната дата от K1 и извеждане на информация в H15
  if (editedCell.getA1Notation() === 'K1') {
    var today = new Date(sheet.getRange('K1').getValue()); // Преобразуване на стойността в дата
    Logger.log("Днешната дата: " + today);
    
    var dateRange = sheet.getRange('A:A');
    var values = dateRange.getValues();
    var found = false;

    for (var i = 0; i < values.length; i++) {
      if (values[i][0] instanceof Date && values[i][0].getTime() === today.getTime()) {
        Logger.log("Намерена дата на ред: " + (i + 1)); // Добавен лог
        var оборот = sheet.getRange(i + 1, 2).getValue(); // Взимаме стойността от колона B на съответния ред
        Logger.log("Оборот от колона B: " + оборот); // Добавен лог
        sheet.getRange('H15').setValue("Вашия оборот за " + today.toLocaleDateString() + " е: " + оборот);
        sheet.getRange('J15').setValue(оборот); // Прехвърляне на стойността в J15
        sheet.getRange('K15').setValue(оборот); // Прехвърляне на стойността в K15
        last_оборот = оборот; // Запомняне на последната стойност на оборота
        found = true;
        break;
      }
    }

    if (!found) {
      sheet.getRange('H15').setValue("Няма данни");
      sheet.getRange('J15').setValue(""); // Изчистване на J15
      sheet.getRange('K15').setValue(""); // Изчистване на K15
    }
  }

  // Проверка за промяна в колоната B
  if (editedCell.getColumn() === 2 && editedCell.getRow() > 0) { // Проверка дали е променена колоната B
    var currentRow = editedCell.getRow(); // Запомняне на текущия ред
    var dateToCheck = sheet.getRange(currentRow, 1).getValue(); // Вземаме датата от колона A на текущия ред

    // Проверка дали текущата дата в K1 съвпада с датата от колона A
    if (dateToCheck instanceof Date && dateToCheck.getTime() === today.getTime()) {
      var new_оборот = editedCell.getValue(); // Вземаме новия оборот
      if (new_оборот !== last_оборот) { // Проверка за промяна
        sheet.getRange('H15').setValue("Вашия оборот за " + today.toLocaleDateString() + " е: " + new_оборот);
        sheet.getRange('J15').setValue(new_оборот); // Актуализиране на J15
        sheet.getRange('K15').setValue(new_оборот); // Актуализиране на K15
        last_оборот = new_оборот; // Обновяване на последната стойност
      }
    }
  }
  
  // Проверка за разходите
  if (editedCell.getA1Notation() === 'K1' || editedCell.getA1Notation() === 'H4') {
    var expenseDate = sheet.getRange('K1').getValue(); // Вземаме днешната дата от K1
    var searchDate = sheet.getRange('H4').getValue(); // Вземаме датата от H4
    if (searchDate instanceof Date) {
      var dateRange = sheet.getRange('B:B');
      var values = dateRange.getValues();
      var expenseFound = false;

      for (var i = 36; i < values.length; i++) { // Започваме от ред 37 (индекс 36)
        if (values[i][0] instanceof Date && values[i][0].getTime() === searchDate.getTime()) {
          var expenseValue = sheet.getRange(i + 1, 8).getValue(); // Взимаме стойността от колона H
          sheet.getRange('H16').setValue("Вашия разход е: " + expenseValue);
          sheet.getRange('J16').setValue(expenseValue); // Прехвърляне на стойността в J16
          sheet.getRange('K16').setValue(expenseValue); // Прехвърляне на стойността в K16
          expenseFound = true;
          break;
        }
      }

      if (!expenseFound) {
        sheet.getRange('H16').setValue("Няма данни за разхода");
        sheet.getRange('J16').setValue(""); // Изчистване на J16
        sheet.getRange('K16').setValue(""); // Изчистване на K16
      }
    }
  }
}

// Функция за прехвърляне на данни от G11:O12 в A39:I40
function transferData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // Намираме следващия свободен ред в A39:I40
  var nextRow = findNextRow();

  // Прехвърляне на данните
  sheet.getRange(nextRow, 1).setValue(nextRow - 38); // Задаване на номер в A39:A40
  sheet.getRange(nextRow, 2).setValue(sheet.getRange('H11').getValue()); // B39:B40
  sheet.getRange(nextRow, 3).setValue(sheet.getRange('I11').getValue()); // C39:C40
  sheet.getRange(nextRow, 4).setValue(sheet.getRange('J11').getValue()); // D39:D40
  sheet.getRange(nextRow, 5).setValue(sheet.getRange('K11').getValue()); // E39:G40
  sheet.getRange(nextRow, 6).setValue(sheet.getRange('L11').getValue()); // E39:G40
  sheet.getRange(nextRow, 7).setValue(sheet.getRange('M11').getValue()); // E39:G40
  sheet.getRange(nextRow, 8).setValue(sheet.getRange('N11').getValue()); // H39:H40
  sheet.getRange(nextRow, 9).setValue(sheet.getRange('O11').getValue()); // I39:I40

  // Изчистване на клетките G11:O12
  clearSourceCells();
}

// Функция за намиране на следващия свободен ред
function findNextRow() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var range = sheet.getRange('A39:A400');
  var values = range.getValues();

  for (var i = 0; i < values.length; i++) {
    if (!values[i][0]) {
      return 39 + i; // Връща реда с индекс 39 или 40
    }
  }
  
  return 41; // Ако и двете редове са заети, връща следващия свободен ред
}

// Функция за изчистване на клетките G11:O12
function clearSourceCells() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.getRange('G11:O12').clearContent(); // Изчистване на клетките G11:O12
  Logger.log("Клетките G11:O12 са изчистени.");
}

// Функция за изчистване на клетките H4:K4
function clearCells() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.getRange('H4:K4').clearContent(); // Изчистване на клетките H4:K4
  Logger.log("Клетките H4:K4 са изчистени.");
}

// Функция за изтриване на всички тригери
function deleteAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  Logger.log("Всички тригери са изтрити.");
}
