
// Admin API – без дубли на константи/помощни; ползва AdminAuth.gs и Code.gs.

function listUsers(token) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = SS_().getSheetByName('Users');
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  values.shift();
  return values.map((r,i)=>({
    row: i+2,
    name: r[0]||'',
    email: r[1]||'',
    role: r[3]||'VIEWER',
    hasPassword: !!(r[2] && String(r[2]).length>0)
  }));
}

function upsertUser(token,row,name,email,passwordOrEmpty,role) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role !== 'ADMIN') throw new Error('Нямате права.');
  if (!name || !email) throw new Error('Име и email са задължителни.');
  const sh = SS_().getSheetByName('Users');
  let passHash = '';
  if (passwordOrEmpty) passHash = _sha256_(passwordOrEmpty);
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
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role !== 'ADMIN') throw new Error('Нямате права.');
  const sh = SS_().getSheetByName('Users');
  if (!row || row < 2) throw new Error('Невалиден ред.');
  sh.deleteRow(row);
  log_(auth.email,'USER_DELETE',`row=${row}, email=${emailForLog||''}`);
  return true;
}

function listPanels(token) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = SS_().getSheetByName('Panels');
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
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role === 'VIEWER') throw new Error('Нямате права.');
  const sh = SS_().getSheetByName('Panels');
  if (!row || row < 2) throw new Error('Невалиден ред.');
  sh.getRange(row,3).setValue(!!visible);
  const key = sh.getRange(row,1).getValue();
  log_(auth.email,'PANEL_VISIBILITY',`key=${key}, visible=${!!visible}`);
  return true;
}

function getTransactions(token,page,pageSize,filters) {
  ensureSheets_(); ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = getSheet_('Transactions');
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
  ensureSheets_(); ensureAdminSheets_();
  const auth = assertAuth_(token);
  if (auth.role === 'VIEWER') throw new Error('Нямате права.');
  const sh = getSheet_('Transactions');
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

function getLogs(token,page,pageSize) {
  ensureAdminSheets_();
  const auth = assertAuth_(token);
  const sh = SS_().getSheetByName('AuditLog');
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { rows: [], total: 0, page: 1, pageSize: 50 };
  const rows = values.slice(1).map(r=>({ ts:r[0], email:r[1], action:r[2], details:r[3], ip:r[4], ua:r[5] })).reverse();
  const total = rows.length;
  const ps = Math.max(1, parseInt(pageSize||50,10));
  const p = Math.max(1, parseInt(page||1,10));
  const start = (p-1)*ps;
  return { rows: rows.slice(start,start+ps), total, page:p, pageSize:ps };
}
=======
 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/AdminApi.gs b/AdminApi.gs
index ad32b512827a8f48e32575056bfd5911c623eefe..536ba48b63563d8119c6a8a78476c91e91dd0501 100644
--- a/AdminApi.gs
+++ b/AdminApi.gs
@@ -1,95 +1,95 @@
 /**
  * Admin API – без дубли на константи/помощни; ползва AdminAuth.gs и Code.gs.
  */
 
 function listUsers(token) {
   ensureAdminSheets_();
   const auth = assertAuth_(token);
-  const sh = SS.getSheetByName('Users');
+  const sh = SS_().getSheetByName('Users');
   const values = sh.getDataRange().getValues();
   if (values.length < 2) return [];
   values.shift();
   return values.map((r,i)=>({
     row: i+2,
     name: r[0]||'',
     email: r[1]||'',
     role: r[3]||'VIEWER',
     hasPassword: !!(r[2] && String(r[2]).length>0)
   }));
 }
 
 function upsertUser(token,row,name,email,passwordOrEmpty,role) {
   ensureAdminSheets_();
   const auth = assertAuth_(token);
   if (auth.role !== 'ADMIN') throw new Error('Нямате права.');
   if (!name || !email) throw new Error('Име и email са задължителни.');
-  const sh = SS.getSheetByName('Users');
+  const sh = SS_().getSheetByName('Users');
   let passHash = '';
   if (passwordOrEmpty) passHash = _sha256_(passwordOrEmpty);
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
   ensureAdminSheets_();
   const auth = assertAuth_(token);
   if (auth.role !== 'ADMIN') throw new Error('Нямате права.');
-  const sh = SS.getSheetByName('Users');
+  const sh = SS_().getSheetByName('Users');
   if (!row || row < 2) throw new Error('Невалиден ред.');
   sh.deleteRow(row);
   log_(auth.email,'USER_DELETE',`row=${row}, email=${emailForLog||''}`);
   return true;
 }
 
 function listPanels(token) {
   ensureAdminSheets_();
   const auth = assertAuth_(token);
-  const sh = SS.getSheetByName('Panels');
+  const sh = SS_().getSheetByName('Panels');
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
   ensureAdminSheets_();
   const auth = assertAuth_(token);
   if (auth.role === 'VIEWER') throw new Error('Нямате права.');
-  const sh = SS.getSheetByName('Panels');
+  const sh = SS_().getSheetByName('Panels');
   if (!row || row < 2) throw new Error('Невалиден ред.');
   sh.getRange(row,3).setValue(!!visible);
   const key = sh.getRange(row,1).getValue();
   log_(auth.email,'PANEL_VISIBILITY',`key=${key}, visible=${!!visible}`);
   return true;
 }
 
 function getTransactions(token,page,pageSize,filters) {
   ensureSheets_(); ensureAdminSheets_();
   const auth = assertAuth_(token);
   const sh = getSheet_('Transactions');
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
diff --git a/AdminApi.gs b/AdminApi.gs
index ad32b512827a8f48e32575056bfd5911c623eefe..536ba48b63563d8119c6a8a78476c91e91dd0501 100644
--- a/AdminApi.gs
+++ b/AdminApi.gs
@@ -99,34 +99,35 @@ function getTransactions(token,page,pageSize,filters) {
   const p = Math.max(1, parseInt(page||1,10));
   const ps = Math.max(1, parseInt(pageSize||20,10));
   const start = (p-1)*ps;
   return { header, rows: rows.slice(start,start+ps), total, page:p, pageSize:ps };
 }
 
 function updateTransaction(token,row,changes) {
   ensureSheets_(); ensureAdminSheets_();
   const auth = assertAuth_(token);
   if (auth.role === 'VIEWER') throw new Error('Нямате права.');
   const sh = getSheet_('Transactions');
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
 
 function getLogs(token,page,pageSize) {
   ensureAdminSheets_();
   const auth = assertAuth_(token);
-  const sh = SS.getSheetByName('AuditLog');
+  const sh = SS_().getSheetByName('AuditLog');
   const values = sh.getDataRange().getValues();
   if (values.length < 2) return { rows: [], total: 0, page: 1, pageSize: 50 };
   const rows = values.slice(1).map(r=>({ ts:r[0], email:r[1], action:r[2], details:r[3], ip:r[4], ua:r[5] })).reverse();
   const total = rows.length;
   const ps = Math.max(1, parseInt(pageSize||50,10));
   const p = Math.max(1, parseInt(page||1,10));
   const start = (p-1)*ps;
-  return { rows: rows.slice(start,start+ps), total, page:p,
+  return { rows: rows.slice(start,start+ps), total, page:p, pageSize:ps };
+}
 
EOF
)

