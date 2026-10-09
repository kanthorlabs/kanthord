---
title: Storage Implementation
---

# Storage Implementation

This file holds the mechanisms that realize [storage.md](storage.md).
This file is not a design document, and `storage.md` stays the single source of truth.
A mechanism here never overrides a rule there.

The module lives in `src/storage/`.

## Platform validators

The component owns a dedicated platform validator for every platform of the Storage component.

| Platform | Secret shape | Metadata | Validation |
| --- | --- | --- | --- |
| `s3` | `s3_access_key` | `endpoint`, `bucket`, `region` | `HeadBucket` on the metadata bucket, signed for the metadata region |

- The S3 probe sends `HeadBucketCommand` of `@aws-sdk/client-s3` to the metadata `endpoint` and `region`, so it serves every S3-compatible provider, for example Cloudflare R2.
- S3 metadata serves the healthcheck, not work destinations.
- [Storage configuration](project-service.impl.md#storage-configuration) owns work destinations.
- `HeadBucket` maps 200 to `ok`, 404 to a missing bucket and 403 to `unknown`.
- A write-only key can work despite a 403 from `HeadBucket`.
- The [credential healthcheck](architecture.impl.md#the-credential-healthcheck) rules apply.

## Operations

- The component declares the [credential route group](architecture.impl.md#the-credential-route-group-of-a-component) under the prefix `storage`.
- `storage.credential.create` accepts a record of every platform of the component.
- `storage.credential.get` answers the record with `bindings`, the list of `{ project_id, project_name, binding_id, name }` of every binding revision that names the credential and that is a dependent. The Project collaboration `bindingsNaming(tx, credentialName)` answers that read.

## The S3 implementation

The S3 implementation uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, each at 3.1139.0.

- The S3 client addresses the bucket in path style, `<endpoint>/<bucket>/<key>`, for every call and every presigned URL.
- A presigned PUT and a presigned GET sign locally and answer no result class.
- The object metadata read calls `HeadObject`, and the object delete calls `DeleteObject`, each at the recorded version when one exists.
- The read-back of `s3.delete_object` reads the recorded object version, and a not-found answer is a match.
- The S3 credential holds `s3:ListBucket` on the bucket, so a `HeadObject` of an absent object answers 404. The object metadata read maps only 404 to an absent object.
- A 403 from `HeadObject` answers HTTP 502 for the object check, and the read-back of `s3.delete_object` does not match.
- A result class that an operation answers as its error is HTTP 502 `storage.platform.s3.<class>` with `details: { status }`. `status` holds the HTTP status of the store when the failure carries one, and null otherwise, for example for a lost answer or for a returned stored error that keeps no status.

A platform implementation is a TypeScript module with its own method signatures and no shared interface.
Every method returns a discriminated union: the success with the result of the operation, or the result class.
The [retry rules](storage.md#result-classes) use the deadline that the caller supplies.

## Tests

- Tests cover the presigned PUT and GET at the recorded version, the metadata read, the delete and the not-found read-back.
- Tests map a store failure with a status and a lost answer to `storage.platform.s3.<class>` with the status or null.
- Tests cover the S3 probe and its status mapping.
