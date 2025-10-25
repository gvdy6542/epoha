/**
 * Admin auth & audit – без дубли на константи, без SH_*.
 * Разчита, че в Code.gs имаш `const SS_ID` и `const TZ`.
 */

function SS_(){ return SpreadsheetApp.openById(SS_ID); }


// помощни
function _sha256_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0'+(b & 0xFF).toString(16)).slice(-2)).join('');
}
function _nowStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function ensureAdminSheets_() {
  // Users (Name,Email,PasswordHash,Role)
  let shU = SS_().getSheetByName('Users');
  if (!shU) {
    shU = SS_().insertSheet('Users');
    shU.getRange(1,1,1,4).setValues([['Name','Email','PasswordHash','Role']]);
    shU.setFrozenRows(1);
  } else if (shU.getLastRow() === 0) {
    shU.getRange(1,1,1,4).setValues([['Name','Email','PasswordHash','Role']]);
  }

  // Panels (PanelKey,Title,Visible)
  let shP = SS_().getSheetByName('Panels');
  if (!shP) {
    shP = SS_().insertSheet('Panels');
    shP.getRange(1,1,1,3).setValues([['PanelKey','Title','Visible']]);
    shP.setFrozenRows(1);
    shP.getRange(2,1,5,3).setValues([
      ['dashboard','Табло', true],
      ['users','Потребители', true],
      ['panels','Панели', true],
      ['transactions','Транзакции', true],
      ['logs','Логове', true]
    ]);
  } else if (shP.getLastRow() === 0) {
    shP.getRange(1,1,1,3).setValues([['PanelKey','Title','Visible']]);
  }

  // AuditLog (Timestamp,Email,Action,Details,IP,UserAgent)
  let shL = SS_().getSheetByName('AuditLog');
  if (!shL) {
    shL = SS_().insertSheet('AuditLog');
    shL.getRange(1,1,1,6).setValues([['Timestamp','Email','Action','Details','IP','UserAgent']]);
    shL.setFrozenRows(1);
  } else if (shL.getLastRow() === 0) {
    shL.getRange(1,1,1,6).setValues([['Timestamp','Email','Action','Details','IP','UserAgent']]);
  }
}

function log_(email, action, details, ip, ua) {
  ensureAdminSheets_();
  const sh = SS_().getSheetByName('AuditLog');
  sh.appendRow([_nowStr_(), email || '', action || '', details || '', ip || '', ua || '']);
}

function login(email, password) {
  ensureAdminSheets_();
  if (!email || !password) throw new Error('Липсват email/парола.');
  const sh = SS_().getSheetByName('Users');
  let values = sh.getDataRange().getValues();
  if (values.length < 2) {
    if (typeof seedAdminUser_ === 'function') {
      seedAdminUser_();
      values = sh.getDataRange().getValues();
    }
    if (values.length < 2) {
      throw new Error('Няма регистрирани потребители.');
    }
  }
  const hash = _sha256_(password);
  let user = null;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const mail = String(row[1] || '').toLowerCase();
    const pass = String(row[2] || '');
    if (mail && mail === String(email).toLowerCase() && pass === hash) {
      user = { name: row[0], email: row[1], role: row[3] || 'VIEWER' };
      break;
    }
  }
  if (!user) throw new Error('Невалидни данни за вход.');
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(`sess_${token}`, user.email, 60 * 15);
  log_(user.email, 'LOGIN', 'Успешен вход');
  return { token, user };
}

function logout(token, email) {
  if (token) CacheService.getScriptCache().remove(`sess_${token}`);
  log_(email || '', 'LOGOUT', 'Изход');
  return true;
}

function assertAuth_(token) {
  const email = CacheService.getScriptCache().get(`sess_${token}`);
  if (!email) throw new Error('Сесията е изтекла. Влез отново.');
  const sh = SS_().getSheetByName('Users');
  const values = sh.getDataRange().getValues();
  let role = 'VIEWER';
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1] || '').toLowerCase() === String(email).toLowerCase()) {
      role = values[i][3] || 'VIEWER';
      break;
    }
  }
  return { email, role };
}

// по желание – ако пазиш токен на клиента:
function resumeSessionWithToken(token){
  const auth = assertAuth_(token);
  const sh = SS_().getSheetByName('Users');
  const values = sh.getDataRange().getValues();
  let user = {name:'',email:auth.email,role:'VIEWER'};
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]||'').toLowerCase() === String(auth.email).toLowerCase()) {
      user = {name: values[i][0], email: values[i][1], role: values[i][3]||'VIEWER'};
      break;
    }
  }
  return { token, user };
}
