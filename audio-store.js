import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
const validFile = /^[a-f0-9-]{36}\.wav$/;
const key = file => { if (!validFile.test(file)) throw new Error('Invalid recording key'); return 'uploads/' + file; };
export function localAudioStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return {
    async put(file, bytes) { key(file); writeFileSync(resolve(directory, file), bytes, { flag: 'wx', mode: 0o600 }); },
    async remove(file) { key(file); unlinkSync(resolve(directory, file)); },
    send(req, res, file) { key(file); res.sendFile(resolve(directory, file)); },
  };
}
export function s3AudioStore({ bucket, client = new S3Client({ forcePathStyle: true }) }) {
  if (!bucket) throw new Error('Private audio bucket required');
  return {
    async put(file, bytes) { await client.send(new PutObjectCommand({ Bucket: bucket, Key: key(file), Body: bytes,
      ContentType: 'audio/wav', CacheControl: 'private, no-store' })); },
    async remove(file) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key(file) })); },
    async send(req, res, file) {
      const range = req.get('range');
      if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return res.status(416).end();
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key(file), ...(range ? {Range: range} : {}) }));
        const bytes = Buffer.from(await object.Body.transformToByteArray());
        if (bytes.length > 20 * 1024 * 1024) throw new Error('Unexpected object size');
        res.set('Accept-Ranges', 'bytes');
        if (object.ContentRange) res.status(206).set('Content-Range', object.ContentRange);
        res.send(bytes);
      } catch (error) {
        if (error.name === 'InvalidRange' || error.$metadata?.httpStatusCode === 416) return res.status(416).end();
        // Missing referenced media is a storage failure, not a successful empty recording.
        throw new Error('Audio storage unavailable');
      }
    },
  };
}
export function createAudioStore() {
  if (process.env.ECHOMAP_AUDIO_BUCKET) {
    if (!process.env.DATABASE_URL) throw new Error('External audio requires persistent PostgreSQL metadata');
    if (!process.env.AWS_ENDPOINT_URL_S3?.startsWith('https://')) throw new Error('HTTPS storage endpoint required');
    return s3AudioStore({ bucket: process.env.ECHOMAP_AUDIO_BUCKET });
  }
  if (process.env.DATABASE_URL) throw new Error('PostgreSQL requires external audio storage');
}
