# PostgreSQL runtime execution evidence

Executed 13 October 2026 in the Windows implementation workspace.

| Check | Actual result |
|---|---|
| Official binary link | EDB portable-distribution page published Windows x64 17.11 `fileid=1260616`; server redirected to `postgresql-17.11-5-windows-x64-binaries.zip` |
| Archive download | 381,531,864 bytes downloaded and extracted under `.runtime/pgsql` |
| Executable | `postgres (PostgreSQL) 17.11` |
| Fresh cluster initialization | Completed `initdb` bootstrap, post-bootstrap initialization and disk synchronization |
| Server readiness | Log: listening on IPv4 `127.0.0.1`, port `55432`; database system ready to accept connections |
| Actual Node pg connection | Authenticated as `astra_app` to `astra`; UTF-8; `rolsuper=false`, `rolbypassrls=false` |
| Script syntax | PowerShell parser returned zero errors for install/start/stop scripts |
| Existing-cluster start | Repeated start returned ready with existing database/account data preserved |

Default-sandbox `initdb` could not create its required child processes, and a default-sandbox Node connection returned `EACCES`. Scoped execution approval allowed workspace-only database initialization/startup and the real authentication check. No system service, global environment setting or existing database was modified. An incomplete empty initial cluster was preserved as `.runtime/postgres-data-incomplete-20261013`.

PostgreSQL credentials and raw runtime logs remain in ignored `.runtime/`. This file records safe execution results only. Stop/start recovery, backup/restore and application migration correctness require their own tests; this runtime check does not claim those tests passed.
