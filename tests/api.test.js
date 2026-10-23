import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
process.env.NODE_ENV='test';
const { createApp, createDb } = await import('../server.js');
const app=createApp(createDb(':memory:'));
describe('EchoMap API',()=>{
  it('returns the sound archive',async()=>{const r=await request(app).get('/api/sounds');assert.equal(r.status,200);assert.equal(r.body.length,8)});
  it('filters recordings by mood',async()=>{const r=await request(app).get('/api/sounds?mood=calm');assert.equal(r.body.length,2)});
  it('returns aggregate archive stats',async()=>{const r=await request(app).get('/api/stats');assert.equal(r.body.summary.cities,3)});
  it('adds a field note',async()=>{const r=await request(app).post('/api/notes').send({soundId:1,author:'Роман',note:'Очень атмосферная запись'});assert.equal(r.status,201)});
});

describe('Input validation and missing records', () => {
  it('rejects invalid input', async () => { assert.equal((await request(app).post('/api/notes').send({})).status, 400); });
  it('returns 404 for a missing record', async () => { assert.equal((await request(app).get('/api/sounds/999')).status, 404); });
});
