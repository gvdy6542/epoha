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
