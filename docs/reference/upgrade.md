# Upgrade configuration and data

[Reference index](README.md)

## Function description

Bring the stored server configuration and the operational database to the versions of the installed binary. Run it after you install a new binary and before you start the server. Stop the server first.

The binary is the reference of every version:

- The configuration version is the root field `version` of `kanthord.yaml`. A file without the field is version 1. [`config init`](config/init.md) writes the version of the binary.
- The database version is the migration history of each service in `kanthord.db`.

The server refuses to start when one of them differs from the binary:

| Condition                                                    | Diagnostic                                       | Action                                               |
| ------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------- |
| The configuration version is older than the binary.          | `system.config.version_behind`                   | Run `kanthord upgrade`.                              |
| The configuration version is newer than the binary.          | `system.config.version_ahead`                    | Install the newer binary, or restore the backups.    |
| The database has a pending migration.                        | `system.database.migration.pending`              | Run `kanthord upgrade`.                              |
| The database history is newer than the binary or is unknown. | `system.database.migration.incompatible_history` | Install the matching binary, or restore the backups. |
| `master_key` does not match the database.                    | `system.config.master_key_mismatch`              | Restore the matching configuration file or backup.   |

`config validate`, `config show` and `auth jwt generate` refuse a configuration version other than the version of the binary with the same diagnostics. A new installation needs no upgrade: the first start creates the database and applies every migration.

The command runs these steps in this order:

1. Read the configuration and apply each configuration step from its version in memory, then validate the result.
2. Open `kanthord.db` of the data directory with its exclusive lock, if the file exists, and validate its migration history. A running server holds the lock, so the command fails with `system.database.initialization_failed` (`database is locked`) before it writes anything. Then check that `master_key` matches the database. A mismatch fails with `system.config.master_key_mismatch` before it writes anything.
3. Write the backups.
4. Apply the pending migrations.
5. Replace the configuration file atomically.

## Expected response

Success prints one `name: value` row for each change to stdout and exits `0`. Each row prints when its step happens, so the backup rows print before a later failure. The rows of one run align, and every value starts in column 17, after the longest row name `config_version:` and one space:

```text
backup:         /home/user/.config/kanthord/kanthord.yaml.bak-20261010T080000
backup:         /home/user/.local/share/kanthord/kanthord.db.bak-20261010T080000
migrated:       scheduler 3 -> 4
renamed:        mission.consecutive_loss_limit -> mission.consecutive_failure_limit
upgraded:       /home/user/.config/kanthord/kanthord.yaml
config_version: 1 -> 2
```

| Output / property                    | Purpose                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `backup: <path>`                     | A private `0600` copy of the original configuration or of the database, written before any change. The command deletes none. |
| `migrated: <service> <from> -> <to>` | The migrations that the command applied to one service, from one version to another.                                         |
| `renamed: <old> -> <new>`            | A configuration key that a configuration step renamed. Values and comments stay.                                             |
| `upgraded: <path>`                   | The configuration file that the command replaced.                                                                            |
| `config_version: <from> -> <to>`     | The configuration versions before and after the upgrade.                                                                     |
| `up_to_date: <path>`                 | Nothing changed, and the command wrote nothing.                                                                              |
| Exit code `0`                        | The configuration and the database match the binary.                                                                         |

Failures exit `1` with a [diagnostic](errors.md#cli-diagnostics). A later failure keeps the earlier rows on stdout, for example the backup paths. A configuration that holds an old key and its new key fails with `system.config.rename_conflict` and the rows `old_key` and `new_key`. An existing backup path fails with `system.database.backup_failed` and the row `path`. A failure after the backups keeps each committed migration. Run `kanthord upgrade` again to complete the remaining part.

### Restore the backups

To go back to the previous binary:

1. Stop the server.
2. Delete `kanthord.db-wal` and `kanthord.db-shm` in the data directory, if they exist.
3. Copy the database backup to `kanthord.db` and the configuration backup to the configuration file. Keep mode `0600` on both, for example with `cp -p`.
4. Install the previous binary and start the server.

### Other state

- The worker application refuses a server of another package version. Upgrade each worker binary together with the server.
- A release note states a change that invalidates every JWT and client secret. Then generate new tokens with [`auth jwt generate`](auth/jwt.md).
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
