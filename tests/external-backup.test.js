import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createPostgres,postgresOptions} from '../database.js';
import handler,{backupOnce} from '../scheduled-backup.js';
import {bytesHash,restoreRows,validateSnapshot} from '../postgres-snapshot.js';
import {gunzipSync} from 'node:zlib';
test('backup endpoint rejects unsigned callers',async()=>{
 assert.equal((await handler.fetch(new Request('https://backup.invalid/cron',{method:'POST'}))).status,401);
});
test('external backup copies audio, restores PostgreSQL rows and rejects corrupt storage', {skip:!process.env.POSTGRES_TEST_URL},async()=>{
 const admin=new pg.Client(postgresOptions(process.env.POSTGRES_TEST_URL));await admin.connect();
 const schema='backup_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(process.env.POSTGRES_TEST_URL);url.searchParams.set('options','-c search_path='+schema);
 const db=await createPostgres(url.toString()); const objects=new Map();let corrupt=false;
 const s3={async send(command){const {Bucket,Key,Body}=command.input;const k=Bucket+'/'+Key;
  if(command.constructor.name==='ListObjectsV2Command')return {Contents:[...objects].filter(([p])=>p.startsWith(Bucket+'/')).map(([Key,b])=>({Key,Size:b.length}))};
  if(command.constructor.name==='PutObjectCommand'){objects.set(k,Buffer.from(Body));return {};}
  if(command.constructor.name==='GetObjectCommand'){if(!objects.has(k))throw Object.assign(new Error('Missing'),{name:'NoSuchKey'});
   const b=objects.get(k);return {Body:{transformToByteArray:async()=>corrupt&&Bucket==='echomap-backups'?Buffer.concat([b,Buffer.from('corrupt')]):b}};}
  throw new Error('Unexpected command');
 }};
 try{
  const file=randomUUID()+'.wav',audio=Buffer.alloc(16044,1);
  const out=await db.pool.query("INSERT INTO sounds(title,city,district,mood,lat,lng,duration,color,description,frequency,texture,recorded_at) VALUES('Test','Test','Test','calm',1,2,1,'#ffffff','Test',0,'user','2026-11-09') RETURNING id");
  await db.pool.query("INSERT INTO user_recordings(sound_id,owner_id,file,status,size,created_at) VALUES($1,'tester',$2,'pending',$3,'2026-11-09')",[out.rows[0].id,file,audio.length]);
  objects.set('echomap-audio/uploads/'+file,audio);
  const result=await backupOnce({source:db.pool,verification:db.pool,s3,audio:s3});
  assert.equal(result.status,'verified');assert.equal(result.recordings,1);assert.equal(result.sounds,9);
  const stored=objects.get('echomap-backups/'+result.key);assert.equal(bytesHash(stored),result.sha256);
  const snapshot=JSON.parse(gunzipSync(stored));validateSnapshot(snapshot);
  assert.deepEqual(objects.get('echomap-backups/'+snapshot.audio[0].key),audio);
  const broken=structuredClone(snapshot);broken.audio=[];assert.throws(()=>validateSnapshot(broken),/Missing recording/);
  const client=await db.pool.connect();try{await client.query('BEGIN');await assert.rejects(restoreRows(client,snapshot),/empty database/);await client.query('ROLLBACK');}finally{client.release();}
  const markers=[...objects.keys()].filter(k=>k.endsWith('.verified.json')).length;corrupt=true;
  await assert.rejects(backupOnce({source:db.pool,verification:db.pool,s3,audio:s3}),/Stored audio differs/);
  assert.equal([...objects.keys()].filter(k=>k.endsWith('.verified.json')).length,markers);
  assert.equal((await db.pool.query('SELECT count(*) FROM sounds')).rows[0].count,9);
 }finally{await db.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
