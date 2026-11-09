import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { createPostgres, postgresOptions } from '../database.js';
import { s3AudioStore } from '../audio-store.js';
process.env.NODE_ENV = 'test';
const { createApp } = await import('../server.js');
function wav() { const b = Buffer.alloc(16044); b.write('RIFF'); b.writeUInt32LE(b.length-8,4); b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(8000,24);
  b.writeUInt32LE(16000,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(16000,40); return b; }
function memoryS3() {
 const objects = new Map();
 return {objects, async send(command) {
  const p=command.input;
  if(command.constructor.name === 'PutObjectCommand') { objects.set(p.Key, Buffer.from(p.Body)); return {}; }
  if(command.constructor.name === 'GetObjectCommand') {
   const all=objects.get(p.Key); if(!all) throw new Error('Missing');
   let b=all, result={}; if(p.Range) { const [,start,end] = /bytes=(\d+)-(\d*)/.exec(p.Range); const last=end ? Number(end) : all.length-1;
    b=all.subarray(Number(start),last+1); result.ContentRange=`bytes ${start}-${last}/${all.length}`; }
   return {...result, Body:{transformToByteArray:async()=>b}};
  }
  if(command.constructor.name === 'DeleteObjectCommand') return {removed:objects.delete(p.Key)};
  throw new Error('Unexpected operation');
 }};
}
test('remote PostgreSQL always verifies TLS even with a disabling URI flag',()=>{
 assert.equal(postgresOptions('postgresql://u:p@example.com/db?sslmode=disable').ssl.rejectUnauthorized,true);
 assert.equal(new URL(postgresOptions('postgresql://u:p@example.com/db?sslmode=disable').connectionString).search,'');
});
test('PostgreSQL persists moderated metadata, budgets and private S3 audio across reconnect', {skip:!process.env.POSTGRES_TEST_URL},async()=>{
 const owner='o'.repeat(40), author='a'.repeat(40), name='test_'+randomUUID().replaceAll('-','');
 const previous={APP_UPLOADERS:process.env.APP_UPLOADERS, APP_OWNER_TOKEN:process.env.APP_OWNER_TOKEN};
 process.env.APP_UPLOADERS=JSON.stringify({[createHash('sha256').update(author).digest('hex')]:name}); process.env.APP_OWNER_TOKEN=owner;
 const client=memoryS3(), store=s3AudioStore({bucket:'private-audio', client});
 let db=await createPostgres(process.env.POSTGRES_TEST_URL), id, noteId;
 try {
  let app=createApp(db,{audioStore:store});
  assert.equal((await request(app).get('/api/sounds?city=Москва&mood=calm')).status,200);
  const made=await request(app).post('/api/uploads?title=Persistence&city=Test&lat=1&lng=2&license=CC0-1.0').auth(author,{type:'bearer'}).type('audio/wav').send(wav());
  assert.equal(made.status,201); id=made.body.id; assert.ok(id>8);
  assert.equal((await request(app).get('/api/audio/'+id)).status,404);
  assert.equal((await request(app).get('/api/owner/uploads/'+id+'/audio')).status,401);
  const preview=await request(app).get('/api/owner/uploads/'+id+'/audio').auth(owner,{type:'bearer'});
  assert.equal(preview.status,200); assert.deepEqual(preview.body,wav()); assert.equal(preview.headers['cache-control'],'no-store');
  assert.equal((await request(app).patch('/api/owner/uploads/'+id).auth(owner,{type:'bearer'}).send({status:'approved'})).status,200);
  const note=await request(app).post('/api/notes').send({soundId:id,author:'Test',note:'Persistent field note'});
  assert.equal(note.status,201); noteId=note.body.id;
  const {consumeBudget}=await import('../request-budget.js');
  assert.equal((await consumeBudget(db,name,1,Date.now())).allowed,true);
  await db.close(); db=await createPostgres(process.env.POSTGRES_TEST_URL); app=createApp(db,{audioStore:store});
  assert.equal((await consumeBudget(db,name,1,Date.now())).allowed,false);
  const details=await request(app).get('/api/sounds/'+id); assert.equal(details.body.notes[0].id,noteId);
  assert.deepEqual((await request(app).get('/api/audio/'+id)).body,wav());
  const partial=await request(app).get('/api/audio/'+id).set('Range','bytes=0-43');
  assert.equal(partial.status,206); assert.deepEqual(partial.body,wav().subarray(0,44));
  assert.equal((await request(app).get('/api/audio/'+id).set('Range','bytes=0-2,5-9')).status,416);
  // Concurrent uploads cannot both pass a quota at the boundary.
  await db.pool.query('UPDATE user_recordings SET size=$1 WHERE sound_id=$2',[100*1024*1024-wav().length,id]);
  const upload=()=>request(app).post('/api/uploads?title=Quota&city=Test&lat=1&lng=2&license=CC0-1.0').auth(author,{type:'bearer'}).type('audio/wav').send(wav());
  const results=await Promise.all([upload(),upload()]); assert.deepEqual(results.map(r=>r.status).sort(),[201,429]);
 } finally {
  await db.pool.query('DELETE FROM field_notes WHERE sound_id IN (SELECT sound_id FROM user_recordings WHERE owner_id=$1)',[name]);
  const ids=(await db.pool.query('DELETE FROM user_recordings WHERE owner_id=$1 RETURNING sound_id',[name])).rows.map(r=>r.sound_id);
  await db.pool.query('DELETE FROM sounds WHERE id=ANY($1::int[])',[ids]); await db.pool.query('DELETE FROM request_budgets WHERE key=$1',[name]);
  await db.close(); for(const [k,v] of Object.entries(previous)) if(v===undefined) delete process.env[k]; else process.env[k]=v;
 }
});
