import { createHash } from 'node:crypto';
import { schemaSql } from './schema.js';
export const tables = { sounds: 'id', field_notes: 'id', request_budgets: 'key', user_recordings: 'sound_id' };
export const digest = value => createHash('sha256').update(JSON.stringify(value,(_,v)=>v && !Array.isArray(v) && typeof v==='object' ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v)).digest('hex');
export const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function exportSnapshot(client) {
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try {
  const rows={};
  for(const [name,order] of Object.entries(tables)) {
   rows[name]=(await client.query(`SELECT * FROM ${name} ORDER BY ${order} LIMIT 100001`)).rows;
   if(rows[name].length>100000) throw new Error('Snapshot row limit');
  }
  if(Buffer.byteLength(JSON.stringify(rows))>10*1024*1024) throw new Error('Snapshot size limit');
  await client.query('COMMIT'); return {version:1,createdAt:new Date().toISOString(),rows,sha256:digest(rows),audio:[]};
 } catch(error) {await client.query('ROLLBACK');throw error;}
}
export function validateSnapshot(snapshot) {
 if(snapshot?.version!==1 || !snapshot.rows || digest(snapshot.rows)!==snapshot.sha256 || !Array.isArray(snapshot.audio)) throw new Error('Invalid snapshot');
 if(Object.keys(snapshot.rows).sort().join()!==Object.keys(tables).sort().join()) throw new Error('Unexpected tables');
 for(const name of Object.keys(tables)) if(!Array.isArray(snapshot.rows[name]) || snapshot.rows[name].length>100000) throw new Error('Invalid rows');
 const audio=new Map();
 for(const entry of snapshot.audio) {
  if(!/^[a-f0-9-]{36}\.wav$/.test(entry.file) || !/^[a-f0-9]{64}$/.test(entry.sha256) || entry.key!=='audio/'+entry.sha256+'.wav' || !Number.isSafeInteger(entry.bytes) || entry.bytes<44 || entry.bytes>20*1024*1024 || audio.has(entry.file)) throw new Error('Invalid audio manifest');
  audio.set(entry.file,entry);
 }
 for(const row of snapshot.rows.user_recordings) if(audio.get(row.file)?.bytes!==row.size) throw new Error('Missing recording');
 if(audio.size!==snapshot.rows.user_recordings.length) throw new Error('Unexpected recording');
}
// Caller owns the transaction. Temp verification is always rolled back by the worker.
export async function restoreRows(client,snapshot,{temporary=false}={}) {
 validateSnapshot(snapshot);
 if(!temporary) for(const name of Object.keys(tables)) if((await client.query('SELECT to_regclass($1) AS table_name',[name])).rows[0].table_name) throw new Error('Restore requires an empty database');
 await client.query(temporary ? schemaSql.replaceAll('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE').replaceAll(');',') ON COMMIT DROP;') : schemaSql);
 for(const [name,order] of Object.entries(tables)) {
  const columns=(await client.query(`SELECT * FROM ${name} LIMIT 0`)).fields.map(f=>f.name);
  const rows=snapshot.rows[name];
  for(let i=0;i<rows.length;i+=200) await client.query(`INSERT INTO ${name} SELECT * FROM json_populate_recordset(NULL::${name},$1::json)`,[JSON.stringify(rows.slice(i,i+200))]);
  const actual=(await client.query(`SELECT * FROM ${name} ORDER BY ${order}`)).rows;
  if(digest(actual)!==digest(rows) || rows.some(row=>Object.keys(row).sort().join()!==columns.slice().sort().join())) throw new Error('Restored rows differ');
 }
 for(const name of ['sounds','field_notes']) await client.query(`SELECT setval(pg_get_serial_sequence('${name}','id'),COALESCE((SELECT max(id) FROM ${name}),1),(SELECT count(*)>0 FROM ${name}))`);
 return {sounds:snapshot.rows.sounds.length,notes:snapshot.rows.field_notes.length,recordings:snapshot.audio.length};
}
