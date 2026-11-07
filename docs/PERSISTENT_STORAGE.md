# Persistent storage and complete archives

Set `ECHOMAP_DATA_DIRECTORY` to a private persistent mount, for example
`/var/lib/echomap`. Both `echomap.db` and `uploads/` use that directory. The default
remains the existing repository `data/` directory. A public static directory is
rejected. Keep a single writer service on the attached disk; a local disk is not
a shared multi-node storage service.

For an existing installation, stop the service and move the entire data directory,
including SQLite WAL/SHM files if present and every upload, to the persistent mount.
Keep the original copy until the migrated application has been checked. Set the
environment variable and verify notes, pending moderation and approved audio
before enabling traffic. No existing database is moved automatically.

## Backup and restore

```sh
node scripts/archive.mjs backup /var/lib/echomap /secure/echomap-backups/2026-11-07
node scripts/archive.mjs restore /secure/echomap-backups/2026-11-07 /secure/echomap-restored
```

The destination must not exist and must be outside the source. A consistent
SQLite snapshot is taken first. Every WAV referenced by that snapshot, including
pending and rejected recordings, is copied. Only complete archives become visible;
a missing file fails the command and removes the partial archive. Unreferenced
temporary files are not included. Uploaded WAVs must remain immutable while an
archive is copied, as in the current application.

The manifest records SHA-256 and size for the database and each WAV. Restore checks
the manifest against database references, checksums, SQLite integrity and foreign
keys before creating a new data directory. It never overwrites a live directory.
Base application audio in `public/audio` is version-controlled and is not duplicated
in these data archives; retain the matching application revision too.

Run the backup regularly with the service's OS user and a private umask (0077),
using unique destination names. Keep independent off-host copies and define backup
retention separately from live data retention. Perform a trial restore and start
the application against that new directory before declaring the server ready.
Do not serve archives or upload directories as static public files.

Repository tests exercise notes, all moderation states, byte-for-byte restored
audio, corrupted checksums, missing files and refusal to overwrite existing data.
The persistent disk, scheduler and independent storage still need installation
on the actual server; adding the configuration does not provision hosting.
