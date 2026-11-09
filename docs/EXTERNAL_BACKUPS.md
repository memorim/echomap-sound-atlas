# External database and audio backups

The scheduled worker belongs to the separate free `portfolio-backups` project.
Its `echomap-backups` bucket is private. Source database access must use a
read-only login; the source audio credential needs only `storage:read`.

Each run exports all four PostgreSQL tables in a repeatable-read, read-only
transaction. Every referenced WAV, including pending and rejected recordings,
is copied by SHA-256 to the backup project and downloaded again for verification.
Content-addressed audio copies are reused only after their bytes are rechecked.
Metadata is compressed, uploaded, downloaded and checksum-verified, then restored
into temporary PostgreSQL tables with row comparisons and identity sequences.
Only successful verification creates the matching `.verified.json` marker.

The worker never changes application rows or deletes backups. It stops with an
ntfy alert before this bucket exceeds 2 GiB. Review capacity and archive copies
before reaching the limit; no paid upgrade is performed. This project shares the
same Neon account/provider, so it does not protect against loss of that account.
Daily target schedule: `30 0 * * *` (03:30 Europe/Moscow).

## Deploy

Run `node scripts/build-backup.mjs`; deploy `.neon-build/backup.zip` as Node.js 24
function `echomapbackup` in the backup project. Set these private environment values:
`SOURCE_DATABASE_URL`, `SOURCE_S3_ENDPOINT`, `SOURCE_S3_KEY`, `SOURCE_S3_SECRET`,
and `NTFY_TOPIC`. Target DATABASE_URL and AWS_* are injected by the backup project.
Only signed schedule trigger `echomap-backup`, path `/cron`, is accepted.
Enable the daily schedule after checking the first live verified archive.

## Restore into new resources

Download the metadata snapshot and its verified marker. Provide backup-project
AWS_* credentials to read its audio. Create a NEW empty PostgreSQL database and
NEW empty private audio bucket. Set `RESTORE_DATABASE_URL`, `RESTORE_AUDIO_BUCKET`,
`RESTORE_S3_ENDPOINT`, `RESTORE_S3_KEY`, `RESTORE_S3_SECRET` and optionally
`RESTORE_S3_REGION` (default eu-central-1), then run:

```sh
node scripts/restore-external.mjs /private/snapshot.json.gz /private/snapshot.json.gz.verified.json
```

The command refuses existing application tables or a nonempty target bucket.
It verifies the metadata checksum, recreates rows and sequences, copies every
WAV and verifies the copied bytes before committing database changes. Failed
restores roll back rows and can leave private objects in the fresh target bucket;
retry with new empty resources. Never point this command at production resources.
Start a separate app instance with the original owner/uploader configuration and
check notes, pending moderation and playback before switching traffic.

## Rollout evidence

CI covers PostgreSQL restoration, complete media manifests, existing-database
refusal and corruption that must not publish a verified marker. Live deployment
and the first scheduled archive are not yet verified in this document.
