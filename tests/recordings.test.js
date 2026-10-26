import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import request from 'supertest';
process.env.NODE_ENV='test';
const {createApp,createDb}=await import('../server.js');
test('API exposes playable local recordings, correct duration and matching source hashes',async()=>{
 const db=createDb(':memory:');try{
  const app=createApp(db),response=await request(app).get('/api/sounds');
  const sources=JSON.parse(readFileSync(new URL('../public/audio/sources.json',import.meta.url)));
  assert.equal(response.body.length,8);
  for(const sound of response.body){
   const source=sources.find(item=>item.id===sound.id);
   assert.equal(sound.duration,Math.round(source.duration));assert.equal(sound.source_url,source.url);
   const audio=await request(app).get('/'+sound.audio_url);assert.equal(audio.status,200);assert.match(audio.headers['content-type'],/^audio\/mpeg/);
   assert.equal(createHash('sha256').update(readFileSync(new URL('../public/'+sound.audio_url,import.meta.url))).digest('hex'),source.sha256);
  }
  const stats=await request(app).get('/api/stats');assert.equal(stats.body.summary.minutes,Math.round(response.body.reduce((sum,s)=>sum+s.duration,0)/6)/10);
 }finally{db.close()}
});
