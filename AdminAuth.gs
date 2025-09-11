/**
 * Admin authentication and logging utilities.
 */
// Use the active spreadsheet to avoid relying on constants from other files
const SS = SpreadsheetApp.getActive();
const SH_ADMIN_USERS = 'AdminUsers';
const SH_PANELS = 'Panels';
const SH_LOG = 'AuditLog';

function ensureAdminSheets_() {
  const need = [
    [SH_ADMIN_USERS, ['Name','Email','PasswordHash']],
    [SH_PANELS, ['PanelKey','Title','Visible']],
    [SH_LOG, ['Timestamp','Email','Action','Details']]
  ];
  need.forEach(([name, header]) => {
    let sh = SS.getSheetByName(name);
    if (!sh) {
      sh = SS.insertSheet(name);
      sh.getRange(1,1,1,header.length).setValues([header]);
    } else if (sh.getLastRow() === 0) {
      sh.getRange(1,1,1,header.length).setValues([header]);
    }
  });
  const pSh = SS.getSheetByName(SH_PANELS);
  if (pSh.getLastRow() < 2) {
    const rows = [
      ['dashboard','Табло', true],
      ['users','Потребители', true],
      ['panels','Панели', true],
      ['transactions','Транзакции', true],
      ['logs','Логове', true]
    ];
    pSh.getRange(2,1,rows.length,3).setValues(rows);
  }
}
ensureAdminSheets_();

function sha256_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0'+(b & 0xFF).toString(16)).slice(-2)).join('');
}

function nowStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function log_(email, action, details) {
  const sh = SS.getSheetByName(SH_LOG);
  sh.appendRow([nowStr_(), email || '', action || '', details || '']);
}

function login(email, password) {
  if (!email || !password) throw new Error('Липсват email/парола.');
  const sh = SS.getSheetByName(SH_ADMIN_USERS);
  const values = sh.getDataRange().getValues();
  values.shift();
  const hash = sha256_(password);
  let user = null;
  values.forEach(row => {
    const e = String(row[1]||'').trim().toLowerCase();
    const h = String(row[2]||'').trim();
    if (e && e === String(email).toLowerCase()) {
      if (h && h.length === 64 && h === hash) user = {name: row[0], email: e};
      else if (h && h === password) user = {name: row[0], email: e};
    }
  });
  if (!user) throw new Error('Невалидни данни за вход.');
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(`sess_${token}`, user.email, 60*15);
  log_(user.email, 'LOGIN', 'Успешен вход');
  return { token, user };
}

function logout(token, email) {
  if (token) CacheService.getScriptCache().remove(`sess_${token}`);
  log_(email||'', 'LOGOUT', 'Изход');
  return true;
}

function assertAuth_(token) {
  const email = CacheService.getScriptCache().get(`sess_${token}`);
  if (!email) throw new Error('Сесията е изтекла. Влез отново.');
  return email;
}
