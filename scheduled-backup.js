import pg from 'pg';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { parseTriggerDelivery } from '@neon/functions/triggers';
import { gzipSync, gunzipSync } from 'node:zlib';
import { postgresOptions } from './database.js';
import { exportSnapshot, restoreRows, bytesHash } from './postgres-snapshot.js';
const bucket='echomap-backups', sourceBucket='echomap-audio';
let cached;
function resources() {
 if(cached)return cached;
 const source=new pg.Pool({...postgresOptions(process.env.SOURCE_DATABASE_URL),max:1});
 const verification=new pg.Pool({...postgresOptions(process.env.DATABASE_URL),max:1});
 for(const pool of [source,verification]) pool.on('error',()=>console.error({event:'backup_database_unavailable'}));
 return cached={source,verification,s3:new S3Client({forcePathStyle:true}),audio:new S3Client({forcePathStyle:true,
  endpoint:process.env.SOURCE_S3_ENDPOINT,region:'eu-central-1',credentials:{accessKeyId:process.env.SOURCE_S3_KEY,secretAccessKey:process.env.SOURCE_S3_SECRET}})};
}
async function get(client,bucket,key) {
 const r=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}));
 return Buffer.from(await r.Body.transformToByteArray());
}
export async function backupOnce({source,verification,s3,audio},now=new Date()) {
 const target=await verification.connect(); let reader;
 try {
  await target.query('BEGIN');
  if(!(await target.query('SELECT pg_try_advisory_xact_lock(39180244) AS locked')).rows[0].locked)return {status:'busy'};
  let used=0,token;
  do {const page=await s3.send(new ListObjectsV2Command({Bucket:bucket,ContinuationToken:token})); used+=(page.Contents||[]).reduce((n,o)=>n+(o.Size||0),0);token=page.IsTruncated?page.NextContinuationToken:undefined;}while(token);
  const put=async(key,body,contentType)=>{
   if(used+body.length>2*1024*1024*1024)throw new Error('Backup storage budget reached');
   await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:contentType}));used+=body.length;
  };
  reader=await source.connect(); const snapshot=await exportSnapshot(reader);reader.release();reader=undefined;
  for(const recording of snapshot.rows.user_recordings) {
   if(!/^[a-f0-9-]{36}\.wav$/.test(recording.file) || recording.size>20*1024*1024)throw new Error('Invalid source recording');
   const body=await get(audio,sourceBucket,'uploads/'+recording.file);
   if(body.length!==recording.size)throw new Error('Source recording size differs');
   const sha256=bytesHash(body),key='audio/'+sha256+'.wav'; let existing;
   try {existing=await get(s3,bucket,key);}catch(error){if(error.name!=='NoSuchKey' && error.$metadata?.httpStatusCode!==404)throw error;}
   if(!existing){await put(key,body,'audio/wav');existing=await get(s3,bucket,key);}
   if(bytesHash(existing)!==sha256)throw new Error('Stored audio differs');
   snapshot.audio.push({file:recording.file,key,bytes:body.length,sha256});
  }
  const body=gzipSync(Buffer.from(JSON.stringify(snapshot))),checksum=bytesHash(body);
  const key='snapshots/'+now.toISOString().replaceAll(':','-')+'-'+checksum.slice(0,16)+'.json.gz';
  await put(key,body,'application/gzip');
  const downloaded=await get(s3,bucket,key);
  if(bytesHash(downloaded)!==checksum)throw new Error('Stored metadata differs');
  const restored=await restoreRows(target,JSON.parse(gunzipSync(downloaded,{maxOutputLength:16*1024*1024})),{temporary:true});
  const result={status:'verified',key,sha256:checksum,bytes:body.length,...restored,verifiedAt:new Date().toISOString()};
  await put(key+'.verified.json',Buffer.from(JSON.stringify(result)),'application/json');
  return result;
 }finally{reader?.release();try{await target.query('ROLLBACK');}finally{target.release();}}
}
export default {async fetch(request){
 if(new URL(request.url).pathname!=='/cron')return new Response('Not found',{status:404});
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 const parsed=await parseTriggerDelivery(request);if(!parsed.ok)return new Response('Unauthorized',{status:401});
 if(parsed.invocation.type!=='schedule'||parsed.invocation.trigger.name!=='echomap-backup')return new Response('Unexpected trigger',{status:403});
 try{const result=await backupOnce(resources());console.log(JSON.stringify({event:'backup',...result}));return Response.json(result);}
 catch{console.error(JSON.stringify({event:'backup',status:'failed'}));
  if(process.env.NTFY_TOPIC)await fetch('https://ntfy.sh/',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:process.env.NTFY_TOPIC,title:'EchoMap backup',message:'Scheduled archive backup failed. Check the private worker.'})}).catch(()=>{});
  return Response.json({status:'failed'},{status:503});
 }
}};
