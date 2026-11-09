# Live external storage verification — 2026-11-09

The owner confirmed that this deployment contained only test data. Hosted storage
was switched to a fresh external PostgreSQL database and a private object bucket;
this was not a migration of an existing user archive.

- Render remains on the free plan, with no persistent disk.
- Neon project `echomap` (`bold-tree-62857327`), PostgreSQL 16, Frankfurt.
- Private bucket `echomap-audio`; Render has branch-scoped storage credentials.
- Application commit: `b7d54e4175c7319225733c0f011e3cc5e314c425` (PR #11).
- Full CI on implementation commit `2f38a6485659a2fe542757bf66c344f13a5aabcf`:
  run `42637223982`, successful PostgreSQL, upgrade, browser and contract tests.
- First configured deploy `dep-dbotou3hf81s73c2a2hg`: live at 14:46:28 UTC.
- Same-commit redeploy `dep-dbotpuui0phs73eq9eag`: live at 14:48:04 UTC.

Before and after redeployment, PostgreSQL contained 9 sound rows, 2 field notes
and 1 uploaded recording. The combined ordered-row fingerprint remained
`31db4c340536cfbc59277e83e2230686`.

The additional recording, ID 9, is explicitly labelled as a persistence check:
one second of silence, 16044 bytes. `/api/audio/9` returned HTTP 200 before and after the
restart, with SHA-256
`56d4af65701c26df20bd4021eda95b6e830348ce3a746086079fe89285548dc9`.
A byte-range request returned HTTP 206 and `bytes 0-43/16044`.
Anonymous direct bucket access returned HTTP 403 after the restart.
The file was uploaded directly to private storage and its test metadata inserted
for this infrastructure check; this is not a claim of a live author upload or
owner moderation session. Those application flows are covered by CI.

Independent PostgreSQL-plus-audio backups are now deployed and the first live
copy verified; see EXTERNAL_BACKUPS.md. The local SQLite archive command does
not back up this hosted installation.
