---
title: Storage Vocabulary
---

# Storage Vocabulary

This file holds the values and the examples of the terms that [storage.md](storage.md) owns.
This file is not a design document, and `storage.md` stays the single source of truth.

## storage component

The shared component through which the Intake Service reaches object storage after Mission Service authorization.
For "Add password reset", the Intake Service calls the Storage component to sign the presigned PUT of a video in the bucket `atlas-evidence`.

## platform implementation

A platform implementation exposes the operations of its storage platform under the names and the parameters of that platform.
The set is open.
The first version holds one value.

- **S3 implementation**

The S3 implementation exposes the operations of an S3-compatible store, for example Amazon S3 or Cloudflare R2.
For example, it signs a presigned PUT for the video of "Add password reset", reads the metadata of that object and deletes it.
It derives the endpoint and the bucket `atlas-evidence` from the storage binding.
