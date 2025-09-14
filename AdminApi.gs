/**
 * Admin API — role-aware.
 * Разчита на TZ и SS_ID (в Code.gs) и на ensureAdminSheets_/assertAuth_/log_ (в AdminAuth.gs).
 */

function _SS(){ return SpreadsheetApp.openById(SS_ID); }

/* ===== USERS ===== */
function listUsers(token) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = _SS().getSheetByName('Users');
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  values.shift();
  return values.map((r,i)=>({
    row: i+2,
    name: r[0]||'',
    email: r[1]||'',
    role: r[3]||'VIEWER',
    hasPassword: !!(r[2] && String(r[2]).length === 64)
  }));
}

function upsertUser(token, row, name, email, plainPassOrEmpty, role) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role !== 'ADMIN') throw new Error('Нямате права.');
  const sh = _SS().getSheetByName('Users');
  if (!name || !email) throw new Error('Име и email са задължителни.');

  let passHash = '';
  if (plainPassOrEmpty) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, plainPassOrEmpty, Utilities.Charset.UTF_8);
    passHash = bytes.map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
  }

  if (row && row > 1) {
    const cur = sh.getRange(row,1,1,4).getValues()[0];
    const data = [
      name,
      email,
      passHash || cur[2] || '',
      role || cur[3] || 'VIEWER'
    ];
    sh.getRange(row,1,1,4).setValues([data]);
    log_(auth.email,'USER_UPDATE',`row=${row}, email=${email}`);
  } else {
    sh.getRange(sh.getLastRow()+1,1,1,4).setValues([[name,email,passHash, role||'VIEWER']]);
    log_(auth.email,'USER_CREATE',`email=${email}`);
  }
  return true;
}

function deleteUser(token, row, emailForLog) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role !== 'ADMIN') throw new Error('Нямате права.');
  const sh = _SS().getSheetByName('Users');
  if (!row || row < 2) throw new Error('Невалиден ред.');
  sh.deleteRow(row);
  log_(auth.email,'USER_DELETE',`row=${row}, email=${emailForLog||''}`);
  return true;
}

/* ===== PANELS ===== */
function listPanels(token) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = _SS().getSheetByName('Panels');
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  values.shift();
  return values.map((r,i)=>({
    row: i+2,
    key: String(r[0]||''),
    title: String(r[1]||''),
    visible: (String(r[2]).toLowerCase()==='true') || r[2]===true
  }));
}

function setPanelVisibility(token, row, visible) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role === 'VIEWER') throw new Error('Нямате права.');
  const sh = _SS().getSheetByName('Panels');
  if (!row || row < 2) throw new Error('Невалиден ред.');
  sh.getRange(row,3).setValue(!!visible);
  const key = sh.getRange(row,1).getValue();
  log_(auth.email,'PANEL_VISIBILITY',`key=${key}, visible=${!!visible}`);
  return true;
}

/* ===== TRANSACTIONS ===== */
function getTransactions(token, page, pageSize, filters) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = _SS().getSheetByName('Transactions');
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { header: values[0]||[], rows: [], total: 0, page: 1, pageSize: pageSize||20 };

  const header = values[0];
  let rows = values.slice(1).map((r,idx)=>{
    const obj = { _row: idx+2 };
    header.forEach((h,ci)=> obj[String(h||`C${ci+1}`)] = r[ci]);
    return obj;
  });

  if (filters && typeof filters === 'object') {
    Object.keys(filters).forEach(k=>{
      const v = String(filters[k]||'').toLowerCase();
      if (v) rows = rows.filter(row => String(row[k]||'').toLowerCase().indexOf(v) !== -1);
    });
  }

  const total = rows.length;
  const p = Math.max(1, parseInt(page||1,10));
  const ps = Math.max(1, parseInt(pageSize||20,10));
  const start = (p-1)*ps;
  return { header, rows: rows.slice(start,start+ps), total, page:p, pageSize:ps };
}

function updateTransaction(token, row, changes) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role === 'VIEWER') throw new Error('Нямате права.');
  const sh = _SS().getSheetByName('Transactions');
  const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  if (!row || row < 2) throw new Error('Невалиден ред.');
  if (!changes || typeof changes !== 'object') throw new Error('Няма промени.');
  const current = sh.getRange(row,1,1,header.length).getValues()[0];
  const map = {}; header.forEach((h,i)=> map[h] = i);
  Object.keys(changes).forEach(k=>{ if (map.hasOwnProperty(k)) current[map[k]] = changes[k]; });
  sh.getRange(row,1,1,header.length).setValues([current]);
  log_(auth.email,'TX_UPDATE',`row=${row}, changes=${JSON.stringify(changes)}`);
  return true;
}

/* ===== LOGS ===== */
function getLogs(token, page, pageSize) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = _SS().getSheetByName('AuditLog');
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { rows: [], total: 0, page: 1, pageSize: pageSize||50 };
  const rows = values.slice(1).map(r=>({ ts:r[0], email:r[1], action:r[2], details:r[3], ip:r[4], ua:r[5] })).reverse();
  const total = rows.length;
  const ps = Math.max(1, parseInt(pageSize||50,10));
  const p = Math.max(1, parseInt(page||1,10));
  const start = (p-1)*ps;
  return { rows: rows.slice(start,start+ps), total, page:p, pageSize:ps };
}
