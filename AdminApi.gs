/**
 * Admin API for managing users, panels, transactions and logs.
 */
function listUsers(token) {
  ensureAdminSheets_();
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_ADMIN_USERS);
  const values = sh.getDataRange().getValues();
  values.shift();
  return values.map((r,i)=>({
    row: i+2,
    name: r[0]||'',
    email: r[1]||'',
    hasPassword: !!(r[2] && String(r[2]).length>0)
  }));
}

function upsertUser(token, row, name, email, plainPasswordOrEmpty) {
  ensureAdminSheets_();
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_ADMIN_USERS);
  if (!name || !email) throw new Error('Име и email са задължителни.');
  let passHash = '';
  if (plainPasswordOrEmpty) passHash = sha256_(plainPasswordOrEmpty);
  if (row && row > 1) {
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
  ensureAdminSheets_();
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_ADMIN_USERS);
  if (!row || row < 2) throw new Error('Невалиден ред.');
  sh.deleteRow(row);
  log_(caller, 'USER_DELETE', `row=${row}, email=${emailForLog||''}`);
  return true;
}

function listPanels(token) {
  ensureAdminSheets_();
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_PANELS);
  const values = sh.getDataRange().getValues();
  values.shift();
  return values.map((r,i)=>({
    row: i+2,
    key: String(r[0]||''),
    title: String(r[1]||''),
    visible: String(r[2]).toLowerCase() === 'true'
  }));
}

function setPanelVisibility(token, row, visible) {
  ensureAdminSheets_();
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_PANELS);
  if (!row || row < 2) throw new Error('Невалиден ред.');
  sh.getRange(row,3).setValue(!!visible);
  const key = sh.getRange(row,1).getValue();
  log_(caller, 'PANEL_VISIBILITY', `key=${key}, visible=${!!visible}`);
  return true;
}

function getTransactions(token, page, pageSize, filters) {
  ensureAdminSheets_();
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_TX);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) {
    return { header: values[0]||[], rows: [], total: 0, page, pageSize };
  }
  const header = values[0];
  const rows = values.slice(1).map((r,idx)=>{
    const obj = { _row: idx+2 };
    header.forEach((h,ci)=> obj[String(h||`C${ci+1}`)] = r[ci]);
    return obj;
  });
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
  ensureAdminSheets_();
  const caller = assertAuth_(token);
  const sh = SS.getSheetByName(SH_TX);
  const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  if (!row || row < 2) throw new Error('Невалиден ред.');
  if (!changes || typeof changes !== 'object') throw new Error('Няма промени.');
  const current = sh.getRange(row,1,1,header.length).getValues()[0];
  const map = {};
  header.forEach((h,i)=> map[h] = i);
  Object.keys(changes).forEach(k=>{
    if (map.hasOwnProperty(k)) {
      current[map[k]] = changes[k];
    }
  });
  sh.getRange(row,1,1,header.length).setValues([current]);
  log_(caller, 'TX_UPDATE', `row=${row}, changes=${JSON.stringify(changes)}`);
  return true;
}

function getLogs(token, page, pageSize) {
  ensureAdminSheets_();
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

// === Added role-aware admin API ===

function listUsers(token) {
  ensureSheets_();
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = SS.getSheetByName(SH_USERS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  values.shift();
  return values.map((r,i)=>({
    row: i+2,
    name: r[0]||'',
    email: r[1]||'',
    role: r[3]||'',
    hasPassword: !!(r[2])
  }));
}

function upsertUser(token,row,name,email,passwordOrEmpty,role) {
  ensureSheets_();
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role !== 'ADMIN') throw new Error('Нямате права.');
  const sh = SS.getSheetByName(SH_USERS);
  if (!name || !email) throw new Error('Име и email са задължителни.');
  let passHash = '';
  if (passwordOrEmpty) passHash = sha256_(passwordOrEmpty);
  const data = [name, email, passHash, role || 'VIEWER'];
  if (row && row > 1) {
    sh.getRange(row,1,1,4).setValues([data]);
    log_(auth.email,'USER_UPDATE',`row=${row}, email=${email}`);
  } else {
    sh.getRange(sh.getLastRow()+1,1,1,4).setValues([data]);
    log_(auth.email,'USER_CREATE',`email=${email}`);
  }
  return true;
}

function deleteUser(token,row,emailForLog) {
  ensureSheets_();
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role !== 'ADMIN') throw new Error('Нямате права.');
  const sh = SS.getSheetByName(SH_USERS);
  if (!row || row < 2) throw new Error('Невалиден ред.');
  sh.deleteRow(row);
  log_(auth.email,'USER_DELETE',`row=${row}, email=${emailForLog||''}`);
  return true;
}

function listPanels(token) {
  ensureSheets_();
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = SS.getSheetByName(SH_PANELS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  values.shift();
  return values.map((r,i)=>({
    row: i+2,
    key: String(r[0]||''),
    title: String(r[1]||''),
    visible: String(r[2]).toLowerCase()==='true'
  }));
}

function setPanelVisibility(token,row,visible) {
  ensureSheets_();
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role === 'VIEWER') throw new Error('Нямате права.');
  const sh = SS.getSheetByName(SH_PANELS);
  if (!row || row < 2) throw new Error('Невалиден ред.');
  sh.getRange(row,3).setValue(!!visible);
  const key = sh.getRange(row,1).getValue();
  log_(auth.email,'PANEL_VISIBILITY',`key=${key}, visible=${!!visible}`);
  return true;
}

function getTransactions(token,page,pageSize,filters) {
  ensureSheets_();
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = getSheet_(SH_TX);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) {
    return { header: values[0]||[], rows: [], total:0, page:1, pageSize:pageSize||20 };
  }
  const header = values[0];
  let rows = values.slice(1).map((r,i)=>{
    const obj = { _row: i+2 };
    header.forEach((h,ci)=> obj[h] = r[ci]);
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

function updateTransaction(token,row,changes) {
  ensureSheets_();
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role === 'VIEWER') throw new Error('Нямате права.');
  const sh = getSheet_(SH_TX);
  const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  if (!row || row < 2) throw new Error('Невалиден ред.');
  if (!changes || typeof changes !== 'object') throw new Error('Няма промени.');
  const current = sh.getRange(row,1,1,header.length).getValues()[0];
  const map = {};
  header.forEach((h,i)=> map[h] = i);
  Object.keys(changes).forEach(k=>{ if (map.hasOwnProperty(k)) current[map[k]] = changes[k]; });
  sh.getRange(row,1,1,header.length).setValues([current]);
  log_(auth.email,'TX_UPDATE',`row=${row}, changes=${JSON.stringify(changes)}`);
  return true;
}

function getLogs(token,page,pageSize) {
  ensureSheets_();
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = SS.getSheetByName(SH_LOG);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { rows: [], total: 0, page: 1, pageSize: 50 };
  const rows = values.slice(1).map(r=>({ ts:r[0], email:r[1], action:r[2], details:r[3], ip:r[4], ua:r[5] })).reverse();
  const total = rows.length;
  const ps = Math.max(1, parseInt(pageSize||50,10));
  const p = Math.max(1, parseInt(page||1,10));
  const start = (p-1)*ps;
  return { rows: rows.slice(start,start+ps), total, page:p, pageSize:ps };
}

function ensureAdminSheets_() {
  const ss = SpreadsheetApp.openById(SS_ID);
  // Users sheet
  let sh = ss.getSheetByName(SH_USERS);
  if (!sh) {
    sh = ss.insertSheet(SH_USERS);
    sh.getRange(1,1,1,4).setValues([['Name','Email','PasswordHash','Role']]);
  } else {
    const header = sh.getRange(1,1,1,Math.max(4, sh.getLastColumn())).getValues()[0];
    if (header[0] !== 'Name' || header[1] !== 'Email' || header[2] !== 'PasswordHash') {
      sh.getRange(1,1,1,4).setValues([['Name','Email','PasswordHash','Role']]);
    }
    if (header.length < 4 || header[3] !== 'Role') {
      sh.getRange(1,4).setValue('Role');
    }
    const last = sh.getLastRow();
    if (last > 1) {
      const roles = sh.getRange(2,4,last-1,1).getValues();
      const need = roles.some(r=>!r[0]);
      if (need) sh.getRange(2,4,last-1,1).setValue('ADMIN');
    }
  }
  // Panels
  let shP = ss.getSheetByName(SH_PANELS);
  if (!shP) {
    shP = ss.insertSheet(SH_PANELS);
    shP.getRange(1,1,1,3).setValues([['PanelKey','Title','Visible']]);
    const rows = [
      ['dashboard','Dashboard',true],
      ['users','Users',true],
      ['panels','Panels',true],
      ['transactions','Transactions',true],
      ['logs','Logs',true]
    ];
    shP.getRange(2,1,rows.length,3).setValues(rows);
  } else if (shP.getLastRow() === 0) {
    shP.getRange(1,1,1,3).setValues([['PanelKey','Title','Visible']]);
  }

  // AuditLog
  let shL = ss.getSheetByName(SH_LOG);
  if (!shL) {
    shL = ss.insertSheet(SH_LOG);
    shL.getRange(1,1,1,6).setValues([['Timestamp','Email','Action','Details','IP','UserAgent']]);
  } else if (shL.getLastRow() === 0) {
    shL.getRange(1,1,1,6).setValues([['Timestamp','Email','Action','Details','IP','UserAgent']]);
  }
}
