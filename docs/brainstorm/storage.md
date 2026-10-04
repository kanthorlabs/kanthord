---
title: Storage
---

# Storage

## Scope

The [Storage component](storage.vocabulary.md#storage-component) is a [shared component](architecture.md#shared-components), like custody and the [Repository component](repository.md).
It is no service, and no service owns it.
It holds the platform implementations of object storage.

## Boundary

- The component holds no authority.
- The [Intake Service](intake-service.md#outbound-requests) is its one caller. It calls the component after the Mission Service authorizes the operation, with the material of a custody release.
- [Custody](custody.md#secret-use-and-handover) owns the credential boundary and follows the authorization check.
- The [storage binding](project-service.vocabulary.md#storage-binding) of the Project Service names the endpoint, the bucket and the credential of a call.
- The kanthord component of a worker uploads and downloads through a presigned grant, and it calls no Storage method.

## Platform implementations

- The component holds one [platform implementation](storage.vocabulary.md#platform-implementation) for each storage platform.
- A platform implementation exposes the operations of its platform under the names and the parameters of that platform.
- The set of platform implementations is open.
- The platform implementation derives the endpoint and the bucket from the storage binding.
- A caller supplies the object key and the recorded object version, and no other resource selector.
- A platform implementation declares the read-back of each write operation, or it declares none.

## Write operations

- The component exposes one write operation: the delete of an object.
- The [Intake Service](intake-service.impl.md#the-authorization-of-each-operation) records the delete as the outbound request `s3.delete_object` and rules its authorization.
- An upload is no write of the component, because the kanthord component uploads through a presigned PUT.

## Placement

- The component runs in the process of its caller.
- The storage credential stays inside the server process.

## Result classes

- A call that succeeds returns the result of the operation.
- A call that does not succeed reports a [result class](repository.vocabulary.md#result-class) of the Repository vocabulary.
- A platform implementation retries a read on a transport error within the deadline of the caller.
- It retries no write.

## Resource healthcheck

[Custody](custody.md) owns the check of an `s3` credential.
The Storage component owns no external resource of its own.
