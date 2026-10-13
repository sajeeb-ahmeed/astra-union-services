# Workspace-local PostgreSQL on Windows

These scripts use the official EDB Windows x64 PostgreSQL 17.11 portable distribution. They install no global program and register no service. The cluster listens only on `127.0.0.1:55432`, uses UTF-8 and SCRAM passwords, and remains under ignored `.runtime/`.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/runtime/install-postgres.ps1
powershell -ExecutionPolicy Bypass -File scripts/runtime/start-postgres.ps1
# Run the application migration and seed commands from the repository README.
powershell -ExecutionPolicy Bypass -File scripts/runtime/stop-postgres.ps1
```

`install-postgres.ps1` requires network access to the [official portable distribution page](https://www.enterprisedb.com/download-postgresql-binaries) and its current 17.11 Windows x64 archive link. Downloads are recorded with source URL and SHA-256 in `.runtime/postgres-download.json`. This digest records the downloaded archive; it is not a publisher-signed supply-chain attestation.

`start-postgres.ps1` initializes only when no cluster exists. It creates separate administrator (`astra_admin`) and restricted application (`astra_app`, `NOSUPERUSER NOBYPASSRLS`) accounts. `.runtime/postgres.json` holds `adminUrl` for migrations and `appUrl` for request handling. Never commit this file, echo it in logs, or pass credentials on command lines. The migration grants table access to the application role and installs row-level policies.

Generated credentials are development-only and file-local. These scripts do not provide production secret management, backups, TLS, monitoring or high availability. Do not expose this database port outside the local machine.

For another operating system, provide a real PostgreSQL server and administrator/restricted application connection strings as described in the repository README. The Windows runtime scripts are the executed setup.
