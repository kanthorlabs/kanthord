---
title: Overview Implementation
---

# Overview Implementation

This file holds the implementation rulings for the mechanisms that realize [overview.md](viewer.html?p=overview.md).
This file is not a design document, and `overview.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
A change to it changes the startup of the daemon.

The implementation adds no package.
Node.js 24.15.0 and the installed set satisfy every requirement.

## The configuration file

- The daemon reads one configuration file in YAML.
- `yaml` at 2.9.0 parses the file, and `convict` at 6.2.5 receives that parser through `convict.addParser` for the `yaml` and the `yml` extension.
- The parser rejects a duplicate key and a second document, so the file is one mapping document.
- This file replaces `kanthord.config.json` of the engine checkout, which the repository ignores, and the implementation epic deletes that local file.

## Schema and validation

- One `convict` schema declares every field with its documentation, its format and its default.
- The daemon calls `validate({allowed: "strict"})` at startup, so an undeclared field stops the start.
- `convict` is the configuration mechanism of the daemon, and `zod` stays the request-validation mechanism of the Gateway Service.
  This is because a request arrives at each call and the configuration arrives once.

## The directories of the daemon

- The daemon follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/).
- It derives four directories, and each one is the `kanthord` subdirectory of a directory of the specification.
- The configuration directory is `kanthord` inside `XDG_CONFIG_HOME`, and that variable defaults to `$HOME/.config`.
- The data directory is `kanthord` inside `XDG_DATA_HOME`, and that variable defaults to `$HOME/.local/share`.
- The state directory is `kanthord` inside `XDG_STATE_HOME`, and that variable defaults to `$HOME/.local/state`.
- The cache directory is `kanthord` inside `XDG_CACHE_HOME`, and that variable defaults to `$HOME/.cache`.
- A variable of the specification that holds a relative path is invalid, so the daemon uses the default of that variable.

## The kind of file of each directory

- The configuration file uses the configuration directory.
- A database uses the data directory, and the account store of the Gateway Service is such a database.
- A log, a history and a session record use the state directory.
- A rebuildable artifact uses the cache directory, because the deletion of that directory costs nothing.
- The daemon writes no file in the state directory and no file in the cache directory today.
- A later mechanism places each of its files by this rule, and it adds no directory of its own.

## The operational database

- The daemon holds one operational database, the file `kanthord.db` of the data directory.
- The Gateway Service, the Project Service, the Mission Service and the Scheduler Service use that database.
- The Tracking Service uses its own file, and [tracking-service.impl.md](viewer.html?p=tracking-service.impl.md) rules that file.
- `node:sqlite` `DatabaseSync` opens the operational database in WAL mode, and one store module owns that connection.
- A service owns its own tables, and it reads no table of another service.
- The name of a table carries the prefix of its service, so no two services collide.
- A table that more than one service uses carries no prefix. It names one owning service, and every other service reaches a row through that service and never through a read of the table.
- The table `credential(id, type, remote_identity, nonce, ciphertext, created_at, updated_at)` is such a table. The Project Service owns it through custody, and the section below rules its envelope.
- The table `migration(service, version, applied_at)` records each migration that ran.
- The migrations run at startup, in a fixed order of the services.
- One file gives a write of two services one transaction, because a transaction across attached files holds no atomic commit in WAL mode.

## The credential table

- `credential` holds one record for one secret, and it holds no project identity, because a record serves more than one project.
- The column `type` is an opaque string at this level. The service that registers a type owns its meaning, and [project-service.impl.md](viewer.html?p=project-service.impl.md) names the types of the Project Service.
- The column `remote_identity` records the identity that the secret acts as at its remote. The daemon enforces nothing from it, so it sits outside the authenticated data below.
- `crypto.createCipheriv` encrypts the material with AES-256-GCM, a 12-byte nonce from `crypto.randomBytes` and a 16-byte tag.
- The plaintext is the JSON of the material of the type, so one record holds several fields under one ciphertext.
- The column `nonce` holds the nonce as 12 bytes, and the column `ciphertext` holds the ciphertext followed by the 16-byte tag. A read that meets another length fails the record.
- The additional authenticated data is the concatenation of two length-prefixed fields, the record identity and the type, so the encoding admits no second reading.
- `createDecipheriv` verifies the tag before any caller reads the plaintext.
- The cipher key is `HKDF(masterKey, info = "custody/aes-256-gcm/v1")`. The daemon derives it at startup and holds it for the life of the process.
- A nonce is random for each write of a record, and the count of the writes of this daemon stays far below the birthday bound of a 12-byte nonce.
- AES-256-GCM detects a modified record and a record moved to another identity. It detects no restoration of an older valid record under the same identity, so the daemon claims no freshness.
- The record carries no version of the cipher and no version of the key, because one key and one envelope serve every record. A change of either one re-wraps every row in one transaction at the first start of the new binary, and a tag failure identifies a row that the change did not reach.
- A backup of the operational database is useless without the configuration file of the same daemon. The encryption protects a copy of the database that carries no configuration file, and it protects nothing against a party that holds both files or that controls the host of the daemon.

## The path of the configuration file

- The daemon resolves the path in this order: the `--config` option, the `KANTHORD_CONFIG` environment variable, then `kanthord.yaml` inside the configuration directory.
- A relative path inside the configuration file resolves against the data directory.

## Precedence

- A non-secret value resolves in this order: the command-line option, the environment variable, the file, then the default of the schema.
- The CLI parses the command line with `commander` at 15.0.0 and applies an override with `convict.set()`, so one parser reads the command line.

## One source for a secret

- A secret field declares no environment binding, no command-line override and no usable default.
- The file is the only source of a secret of the daemon.
- An absent secret field stops the start, so no other source supplies a secret silently.

## The daemon writes no configuration file

- The daemon reads the configuration file and writes it never.
- An absent file stops the start, and the daemon prints the resolved path and the command of the CLI that creates one.
- An invalid file stops the start, and the daemon prints one record for each invalid field.
- Each of those two starts exits with a non-zero status.
- Neither the start of the daemon nor a command of the CLI repairs a file.
- This rule covers the configuration file.
  The daemon writes its databases, and the bootstrap seed of [gateway-service.impl.md](viewer.html?p=gateway-service.impl.md) creates the one human account.

## Permissions and the opened file

- The configuration file holds mode `0600`, the configuration directory holds mode `0700`, and the data directory holds mode `0700`.
- The daemon opens the file with the `O_NOFOLLOW` flag, checks the mode with `fstat` on that descriptor, and reads the same descriptor.
- No replacement of the file happens between the check and the read.
- The daemon requires a regular file that the running user owns.
- A wider mode stops the start.
- The checks apply on a POSIX filesystem, and the daemon states that assumption.

## Reload

- The daemon reads the file at startup only.
- A change of the file takes effect at the next start.

## The sections of the file

- The file holds the shared sections `http` and `log`, and one section for each service.
- The schema holds no directory field, because the specification and its variables carry that override.
- This sibling names the fields of the shared sections, and the implementation sibling of a service names the fields of the section of that service.
- This is the configuration of the daemon process.
  It is not the project configuration that `overview.md` describes.

The shared sections hold the fields below.

- `http.bind` holds the bind address, as a string, it defaults to `127.0.0.1`, and the format accepts a loopback address only.
- `http.port` holds the port, in the `port` format of `convict`, and it defaults to `31415`.
- `http.allowedHosts` holds the host allowlist, as an array of strings, and it defaults to `127.0.0.1:31415` and `localhost:31415`.
- `http.allowedOrigins` holds the origin allowlist, as an array of strings, and it defaults to an empty array.
- `log.level` holds the level of the `pino` logger, as one of `trace`, `debug`, `info`, `warn`, `error` and `fatal`, and it defaults to `info`.
- `masterKey` holds 32 bytes encoded in base64, it carries `sensitive: true`, it holds no default, and the format rejects a value that decodes to another length.

`masterKey` is the one secret of the daemon.

- A service derives every key that it needs from `masterKey`, and it uses `masterKey` directly for nothing.
- The derivation is `crypto.hkdfSync` with SHA-256, an empty salt and one label for each purpose.
- A label is unique across the daemon, and the implementation sibling of a service names the labels of that service.
- The Gateway Service derives its JWT signing key, and the Project Service derives its record cipher key and every webhook secret.

## Secret material and the diagnostic contract

- A secret of the daemon is a field of the configuration file and no row of a database.
- Every secret field carries `sensitive: true`, so `convict.toString()` masks it.
- A diagnostic names the path of a field and the reason of the failure, and it prints no value and no excerpt of the file.
- This contract covers a parse error, a validation error, a failed start, every log record, and the `config validate` and `config show` commands.
- The review display of `config init` is the one exception, because a human reads the content before the write.
- The CLI holds no rotation command, and the daemon rotates no secret.
- A rotation of a secret is a hand edit of the file and a restart of the daemon.
- A rotation of `masterKey` invalidates every issued JWT, so a human authenticates again. It makes every credential store record of the Project Service unreadable, and it makes every derived webhook secret stale.

## Scope

- This sibling specifies the configuration of the daemon process.
- The custody of a credential of a resource that a project binds belongs to the Project Service, and [project-service.md](viewer.html?p=project-service.md) governs it.

## The CLI writes after a human review

- `kanthord config init` builds the document in memory with every default and every generated secret.
- It generates `masterKey` from 32 bytes of `crypto.randomBytes`, encoded in base64.
- It validates the document before it displays it.
- It prints the resolved destination and the complete document, and it reads a confirmation through `node:readline/promises`.
- It requires a terminal on the standard input and on the standard output, because a human reviews the content before the write.
- It writes the exact bytes that it displayed, and it generates nothing and changes nothing between the display and the write.
- The destination of `kanthord config init` is the path that the resolution order of the configuration file gives.
- The command creates the configuration directory with mode `0700` when that directory is absent.
- It writes a temporary file in the directory of the destination with mode `0600`, links that file to the destination, and unlinks the temporary file.
- A link fails when the destination exists, so the command overwrites no file and leaves no partial file.
- `kanthord config validate` loads the stored file with no environment binding and no command-line override, reports each invalid field, and writes nothing.
- `kanthord config show` prints the effective configuration with every sensitive field masked.
- A later change of the file is a hand edit by a human, and the CLI manages no edit.
- `kanthord config init` reaches no daemon and calls no route of the RESTful API, so it opens no second entry path into the daemon.

## Tests

- A test covers an absent secret field, and an attempted environment override of a secret.
- A test covers a mode wider than `0600`, and a symlink at the path of the file.
- A test covers a redirected review output, a declined confirmation and an existing destination.
- A test covers a failed write, and it asserts that no partial file remains.
- A test covers a parse error on a line that holds a secret, and it asserts that the diagnostic prints no value.
- A test asserts that the start of the daemon and the `config validate` command create no file.
- A test covers the AES-256-GCM round trip of a `credential` record, a ciphertext moved between two records, and a truncated ciphertext.
- A test covers the derivation of the cipher key, and it asserts that two labels produce two different keys.
