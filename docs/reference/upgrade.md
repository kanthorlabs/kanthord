# Upgrade configuration and data

[Reference index](README.md)

## Function description

Bring the stored server configuration, the operational database `kanthord.db` and the tracking database `tracking.db` to the versions of the installed binary. Run it after you install a new binary and before you start the server. Stop the server first.

The binary is the reference of every version:

- The configuration version is the root field `version` of `kanthord.yaml`. A file without the field is version 1. [`config init`](config/init.md) writes the version of the binary.
- The database version is the migration history of each service in `kanthord.db` and `tracking.db`.
- Before the first tag, each service that owns tables holds exactly one migration, version 1. `gateway` and `workbench` hold no migration and record no row. A schema change edits that migration, and the command offers no upgrade path for a database of an earlier text.

The server refuses to start when one of them differs from the binary:

| Condition                                                                                                                                                               | Diagnostic                                       | Action                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| The configuration version is older than the binary.                                                                                                                     | `system.config.version_behind`                   | Run `kanthord upgrade`.                                   |
| The configuration version is newer than the binary.                                                                                                                     | `system.config.version_ahead`                    | Install the newer binary, or restore the backups.         |
| The database has a pending migration.                                                                                                                                   | `system.database.migration.pending`              | Run `kanthord upgrade`.                                   |
| The database records a service that the binary does not know, a gap or a duplicate in its versions, or a version newer than the binary.                                 | `system.database.migration.incompatible_history` | Install the matching binary, or restore the backups.      |
| The schema of a recorded service differs from its migration text. The `object` row names the first differing schema object, in the order of the type and then the name. | `system.database.migration.schema_mismatch`      | Run the [reset procedure](#reset-a-pre-release-database). |
| `master_key` does not match the database.                                                                                                                               | `system.config.master_key_mismatch`              | Restore the matching configuration file or backup.        |

`config validate`, `config show` and `auth jwt generate` refuse a configuration version other than the version of the binary with the same diagnostics. A new installation needs no upgrade: the first start creates both databases and applies every migration.

The command runs these steps in this order:

1. Read the configuration and apply each configuration step from its version in memory, then validate the result.
2. Open `kanthord.db` of the data directory with its exclusive lock, if the file exists. Validate its migration history, then check its schema against its migration text. Do the same for `tracking.db`, if the file exists. A missing `tracking.db` stays missing. A running server holds the lock, so the command fails with `system.database.initialization_failed` (`database is locked`) before it writes anything. A history that the binary does not hold, for example an unknown service, a gap or a newer version, fails with `system.database.migration.incompatible_history` before it writes anything. A schema that differs fails with `system.database.migration.schema_mismatch` before it writes anything. Then check that `master_key` matches `kanthord.db`. A mismatch fails with `system.config.master_key_mismatch` before it writes anything.
3. Write the configuration backup, when a configuration step applies.
4. Take `kanthord.db`, then `tracking.db`. For each file with a pending migration, write its backup, then apply its pending migrations.
5. Replace the configuration file atomically.

## Expected response

Success prints one `name: value` row for each change to stdout and exits `0`. Each row prints when its step happens, so the backup rows print before a later failure. The backup row of a database prints before the migrated rows of that database. The rows of one run align, and every value starts in column 17, after the longest row name `config_version:` and one space:

```text
backup:         /home/user/.config/kanthord/kanthord.yaml.bak-20261010T080000
renamed:        mission.consecutive_loss_limit -> mission.consecutive_failure_limit
removed:        agent.prompt.host_file
upgraded:       /home/user/.config/kanthord/kanthord.yaml
config_version: 1 -> 3
```

| Output / property                    | Purpose                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `backup: <path>`                     | A private `0600` copy of the original configuration or of the database, written before any change. The command deletes none.        |
| `migrated: <service> <from> -> <to>` | The migrations that the command applied to one service, from one version to another. A pending migration exists from the first tag. |
| `renamed: <old> -> <new>`            | A configuration key that a configuration step renamed. Values and comments stay.                                                    |
| `removed: <key>`                     | A configuration key that a configuration step deleted, for example `agent.prompt.system_file`. Other keys and comments stay.        |
| `upgraded: <path>`                   | The configuration file that the command replaced.                                                                                   |
| `config_version: <from> -> <to>`     | The configuration versions before and after the upgrade.                                                                            |
| `up_to_date: <path>`                 | Nothing changed, and the command wrote nothing.                                                                                     |
| Exit code `0`                        | The configuration and the databases match the binary.                                                                               |

Failures exit `1` with a [diagnostic](errors.md#cli-diagnostics). A later failure keeps the earlier rows on stdout, for example the backup paths. A configuration that holds an old key and its new key fails with `system.config.rename_conflict` and the rows `old_key` and `new_key`. An existing backup path fails with `system.database.backup_failed` and the row `path`. A failure after the backups keeps each committed migration. Run `kanthord upgrade` again to complete the remaining part.

### Reset a pre-release database

Before the first tag, a schema change edits the one migration of a service. The command offers no upgrade path for that data. Reset the data of a pre-release build:

1. Stop the server.
2. Delete `kanthord.db` and `tracking.db` of the data directory, with their `-wal` and `-shm` files.
3. Start the server. The first start creates both files.

The reset deletes every project, credential, binding, mission, execution and trace. The configuration file stays.

The worker instance model needs this reset. A worker binding of an older build holds `instance_count` and `placement`, and the new build stores each `server` and `container` instance as a named [worker instance](worker/instance.md). After the reset, create one instance for each unit of each old count, and list the instances in the binding. For example, a `coder` binding with `instance_count: 2` at the `server` placement becomes the instances `coder-1` and `coder-2` at the `server` placement and `"worker_instances": ["coder-1", "coder-2"]`. Run `kanthord upgrade` before the start: a configuration step renames `worker.server_slot_limit` to `worker.server_instance_limit`. The first start records the verifier of its `master_key` in the new database, so the same `master_key` stays valid.

### Restore the backups

To go back to the previous binary:

1. Stop the server.
2. Delete `kanthord.db-wal`, `kanthord.db-shm`, `tracking.db-wal` and `tracking.db-shm` in the data directory, if they exist.
3. Copy each database backup to its database file and the configuration backup to the configuration file. Keep mode `0600` on every copied file, for example with `cp -p`.
4. Install the previous binary and start the server.

### Other state

- The worker application refuses a server of another package version. Upgrade each worker binary together with the server.
- A release note states a change that invalidates every JWT and client secret. Then generate new human tokens with [`auth jwt generate`](auth/jwt.md). A worker instance takes new tokens itself. An instance whose client secret changed exits with `worker.instance.secret_changed`; start it again.
- In a container, stop the server container, then run `upgrade` as a one-off container on the same volume with the same `XDG_*` variables, for example `podman run --rm -v kanthord:/var/lib/kanthord kanthord:<version> upgrade`.

## API shape

Not available. The upgrade is a local filesystem and database operation, with no API endpoint or cURL equivalent.

## CLI shape

```text
kanthord upgrade [--config <path>]
```

```sh
kanthord upgrade --config /absolute/path/kanthord.yaml
```

There are no positional arguments.

| Option            | Default / resolution                                      | Purpose                                             |
| ----------------- | --------------------------------------------------------- | --------------------------------------------------- |
| `--config <path>` | `KANTHORD_CONFIG` → XDG/default server configuration path | Selects the stored server configuration to upgrade. |

The data directory comes from `XDG_DATA_HOME`, as for [`serve`](serve.md).
