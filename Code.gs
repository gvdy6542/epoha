/** ===================== CONFIG ===================== **/
const TZ      = 'Europe/Sofia';
const SS      = SpreadsheetApp.getActive();
const SS_ID   = SS.getId();

const SH_USERS   = 'Users';       // A:Name, B:Email, C:PasswordHash
const SH_PANELS  = 'Panels';      // A:Key,  B:Title, C:Visible (TRUE/FALSE)
const SH_LOG     = 'AuditLog';    // A:Timestamp, B:Email, C:Action, D:Details
const SH_TX      = 'Transactions';// Динамични колони по твоя header

/** ===================== INIT ===================== **/
function ensureSheets_() {
  const need = [
    [SH_USERS,  ['Name','Email','PasswordHash']],
    [SH_PANELS, ['PanelKey','Title','Visible']],
    [SH_LOG,    ['Timestamp','Email','Action','Details']],
    [SH_TX,     ['Date','Type','Amount','Method','Supplier','Note','DocType','DocNo']] // примерен header; ако имаш твой, скриптът ще го чете динамично
  ];
  need.forEach(([name, header])=>{
    let sh = SS.getSheetByName(name);
    if (!sh) {
      sh = SS.insertSheet(name);
      sh.getRange(1,1,1,header.length).setValues([header]);
    } else {
      // гарантирай, че има заглавен ред
      if (sh.getLastRow() === 0) {
        sh.getRange(1,1,1,header.length).setValues([header]);
      }
    }
  });
  // Ако Panels е празен – сложи примерни панели
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
ensureSheets_();

/** ===================== HTML ENTRY ===================== **/
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.appName = 'Админ панел';
  return t.evaluate()
    .setTitle('Admin')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

function include_(name){ return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/** ===================== UTILS ===================== **/
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

/** ===================== AUTH ===================== **/
/**
 * В лист Users:
 *  A: Name
 *  B: Email
 *  C: PasswordHash  (ако някой е въвел чист текст — няма да съвпадне; препоръчва се през UI да се добавят/редактират)
 */
function login(email, password) {
  if (!email || !password) throw new Error('Липсват email/парола.');
  const sh = SS.getSheetByName(SH_USERS);
  const values = sh.getDataRange().getValues();
  const header = values.shift(); // remove header
  const hash = sha256_(password);
  let user = null;
  values.forEach(row=>{
    const e = String(row[1]||'').trim().toLowerCase();
    const h = String(row[2]||'').trim();
    if (e && e === String(email).toLowerCase()) {
      // приемаме или точен hash, или (backward-compat) чист текст, равен на password
      if (h && h.length === 64 && h === hash) user = {name: row[0], email: e};
      else if (h && h === password)           user = {name: row[0], email: e}; // ако в C е чист текст (не препоръчваме)
    }
  });
  if (!user) throw new Error('Невалидни данни за вход.');
  // Създай еднократен токен (кратко живущ) - запис в Cache 15 мин
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

/** ===================== USERS CRUD ===================== **/
function listUsers(token) {
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_USERS);
  const values = sh.getDataRange().getValues();
  const header = values.shift();
  const rows = values.map((r,i)=>({
    row: i+2,
    name: r[0]||'',
    email: r[1]||'',
    hasPassword: !!(r[2] && String(r[2]).length>0)
  }));
  return rows;
}

function upsertUser(token, row, name, email, plainPasswordOrEmpty) {
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_USERS);
  if (!name || !email) throw new Error('Име и email са задължителни.');
  // ако row == null → insert
  let passHash = '';
  if (plainPasswordOrEmpty) passHash = sha256_(plainPasswordOrEmpty);

  if (row && row>1) {
    if (passHash) sh.getRange(row,1,1,3).setValues([[name, email, passHash]]);
    else          sh.getRange(row,1,1,2).setValues([[name, email]]);
    log_(caller, 'USER_UPDATE', `row=${row}, email=${email}`);
  } else {
    const last = sh.getLastRow();
    const vals = passHash ? [[name,email,passHash]] : [[name,email,'']];
    sh.getRange(last+1,1,1,3).setValues(vals);
    log_(caller, 'USER_CREATE', `email=${email}`);
  }
  return true;
}

function deleteUser(token, row, emailForLog) {
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_USERS);
  if (!row || row<2) throw new Error('Невалиден ред.');
  sh.deleteRow(row);
  log_(caller, 'USER_DELETE', `row=${row}, email=${emailForLog||''}`);
  return true;
}

/** ===================== PANELS ===================== **/
function listPanels(token) {
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_PANELS);
  const values = sh.getDataRange().getValues();
  const header = values.shift();
  const res = values.map((r,i)=>({
    row: i+2,
    key: String(r[0]||''),
    title: String(r[1]||''),
    visible: String(r[2]).toLowerCase() === 'true'
  }));
  return res;
}

function setPanelVisibility(token, row, visible) {
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_PANELS);
  if (!row || row<2) throw new Error('Невалиден ред.');
  sh.getRange(row,3).setValue(!!visible);
  const key = sh.getRange(row,1).getValue();
  log_(caller, 'PANEL_VISIBILITY', `key=${key}, visible=${!!visible}`);
  return true;
}

/** ===================== TRANSACTIONS ===================== **/
function getTransactions(token, page, pageSize, filters) {
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_TX);
  const rng = sh.getDataRange();
  const values = rng.getValues();
  if (values.length < 2) {
    return { header: values[0]||[], rows: [], total: 0, page, pageSize };
  }
  const header = values[0];
  const rows = values.slice(1).map((r,idx)=>{
    const obj = { _row: idx+2 };
    header.forEach((h,ci)=> obj[String(h||`C${ci+1}`)] = r[ci]);
    return obj;
  });

  // прости филтри (по header име = точен мач)
  let filtered = rows;
  if (filters && typeof filters === 'object') {
    Object.keys(filters).forEach(k=>{
      const v = filters[k];
      if (v!=='' && v!=null) {
        filtered = filtered.filter(row => String(row[k]||'').toLowerCase().indexOf(String(v).toLowerCase()) !== -1);
      }
    });
  }

  const total = filtered.length;
  const p = Math.max(1, parseInt(page||1,10));
  const ps = Math.max(1, parseInt(pageSize||20,10));
  const start = (p-1)*ps;
  const slice = filtered.slice(start, start+ps);
  return { header, rows: slice, total, page: p, pageSize: ps };
}

function updateTransaction(token, row, changes) {
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_TX);
  const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  if (!row || row<2) throw new Error('Невалиден ред.');
  if (!changes || typeof changes!=='object') throw new Error('Няма промени.');

  // Прочети целия ред
  const current = sh.getRange(row,1,1,header.length).getValues()[0];
  const map = {};
  header.forEach((h,i)=> map[h] = i);

  // Приложи промените
  Object.keys(changes).forEach(k=>{
    if (map.hasOwnProperty(k)) {
      current[map[k]] = changes[k];
    }
  });
  sh.getRange(row,1,1,header.length).setValues([current]);
  log_(caller, 'TX_UPDATE', `row=${row}, changes=${JSON.stringify(changes)}`);
  return true;
}

/** ===================== LOGS ===================== **/
function getLogs(token, page, pageSize) {
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_LOG);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { rows: [], total: 0, page: 1, pageSize: 50 };
  const rows = values.slice(1).map(r=>({
    ts: r[0], email: r[1], action: r[2], details: r[3]
  }));
  const total = rows.length;
  const p = Math.max(1, parseInt(page||1,10));
  const ps = Math.max(1, parseInt(pageSize||50,10));
  const start = (p-1)*ps;
  return { rows: rows.slice(start, start+ps), total, page: p, pageSize: ps };
}
