import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { postgresOptions } from '../database.js';
import { validateSnapshot, restoreRows, bytesHash } from '../postgres-snapshot.js';
// AWS_* refers to the backup project. RESTORE_* must identify new, empty resources.
if(!process.env.RESTORE_DATABASE_URL || !process.env.RESTORE_AUDIO_BUCKET || !process.env.RESTORE_S3_ENDPOINT || !process.env.RESTORE_S3_KEY || !process.env.RESTORE_S3_SECRET)throw new Error('Separate empty restore database and private bucket are required');
const bytes=await readFile(process.argv[2]);
const marker=JSON.parse(await readFile(process.argv[3],'utf8'));
if(marker.status!=='verified'||bytesHash(bytes)!==marker.sha256)throw new Error('Snapshot checksum mismatch');
const snapshot=JSON.parse(gunzipSync(bytes,{maxOutputLength:16*1024*1024}));validateSnapshot(snapshot);
const source=new S3Client({forcePathStyle:true});
const target=new S3Client({forcePathStyle:true,endpoint:process.env.RESTORE_S3_ENDPOINT,region:process.env.RESTORE_S3_REGION||'eu-central-1',credentials:{accessKeyId:process.env.RESTORE_S3_KEY,secretAccessKey:process.env.RESTORE_S3_SECRET}});
const bucket=process.env.RESTORE_AUDIO_BUCKET;
if((await target.send(new ListObjectsV2Command({Bucket:bucket,MaxKeys:1}))).Contents?.length)throw new Error('Restore bucket must be empty');
const client=new pg.Client(postgresOptions(process.env.RESTORE_DATABASE_URL));await client.connect();
try{
 await client.query('BEGIN');const result=await restoreRows(client,snapshot);
 for(const entry of snapshot.audio){
  const r=await source.send(new GetObjectCommand({Bucket:'echomap-backups',Key:entry.key}));const body=Buffer.from(await r.Body.transformToByteArray());
  if(body.length!==entry.bytes||bytesHash(body)!==entry.sha256)throw new Error('Backup audio checksum mismatch');
  await target.send(new PutObjectCommand({Bucket:bucket,Key:'uploads/'+entry.file,Body:body,ContentType:'audio/wav',CacheControl:'private, no-store'}));
  const restored=await target.send(new GetObjectCommand({Bucket:bucket,Key:'uploads/'+entry.file}));
  if(bytesHash(Buffer.from(await restored.Body.transformToByteArray()))!==entry.sha256)throw new Error('Restored audio checksum mismatch');
 }
 await client.query('COMMIT');console.log(JSON.stringify({status:'restored',...result}));
}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
