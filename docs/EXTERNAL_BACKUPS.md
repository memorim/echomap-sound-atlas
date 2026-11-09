# External database and audio backups

The scheduled worker belongs to the separate free `portfolio-backups` project.
Its `echomap-backups` bucket is private. Source database access must use a
read-only login; grant SELECT only on `sounds`, `field_notes`,
`request_budgets` and `user_recordings`, with CONNECT on the database and USAGE
on their schema. Do not grant the broad `pg_read_all_data` role. The source audio
credential needs only `storage:read`.

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

CI run `42638814683` passed real PostgreSQL restoration, complete media manifests,
existing-database refusal, corruption rejection, browser and upgrade checks.
PR #13 was merged as `87531d08f7c13971b87a92c3e329414da5585669`.

Live verification completed on 2026-11-09 at 14:56:02 UTC:

- Dedicated source role `echomap_backup`: SELECT on the four named tables;
  INSERT, UPDATE and DELETE denied; no broad `pg_read_all_data` membership.
- Source object credential has only `storage:read`.
- Backup function `echomapbackup`, deployment 1, runs in `portfolio-backups`.
  Unsigned invocation returned HTTP 401.
- Snapshot contains 9 sounds, 2 notes and 1 uploaded recording, including the
  marked one-second persistence-check WAV. Metadata: 1772 compressed bytes.
- Snapshot key: `snapshots/2026-11-09T14-56-01.314Z-483e9d5c2a8464d3.json.gz`
- Metadata SHA-256:
  `483e9d5c2a8464d38983141ff15c2babc680017d28d70c588188ab2c115750bf`.
- The copied WAV was downloaded and verified; PostgreSQL rows were restored into
  temporary tables and compared. Only then was the verified marker published.
- Enabled daily trigger `echomap-backup`: `30 0 * * *`, next run
  2026-11-10 00:30 UTC (03:30 Europe/Moscow). The temporary one-minute initial
  verification schedule has been replaced.

The first live archive and automated restore comparison succeeded. A subsequent
unattended nightly run and an interactive recovered app instance have not yet
been observed. Original owner/uploader secrets are still required separately.
