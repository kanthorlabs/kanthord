import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requireBodyString,
  optionalBodyString,
  optionalBodyStringArray,
  optionalBodyBool,
  requireBodyObject,
  requireBodyObjectArray,
  optionalBodyRecord,
  requireBodyRepositoryAuth,
  optionalBodyRepositoryAuth,
} from "./body.ts";
import { InvalidInputError } from "./errors.ts";
import { mapError } from "./error-registry.ts";

test("requireBodyString: happy path trims surrounding whitespace", () => {
  assert.equal(requireBodyString({ name: " a " }, "name"), "a");
});

test("requireBodyString: missing field throws naming the field, message matches /must be a string/", () => {
  assert.throws(
    () => requireBodyString({}, "name"),
    (err: unknown) => {
      assert.ok(err instanceof InvalidInputError);
      assert.equal(err.field, "name");
      assert.match(err.message, /must be a string/);
      return true;
    },
  );
});

test("requireBodyString: blank string throws /must not be blank/", () => {
  assert.throws(
    () => requireBodyString({ name: "   " }, "name"),
    /must not be blank/,
  );
});

test("requireBodyString: a number throws /must be a string/", () => {
  assert.throws(
    () => requireBodyString({ name: 1 }, "name"),
    /must be a string/,
  );
});

test("optionalBodyString: absent field is undefined", () => {
  assert.equal(optionalBodyString({}, "name"), undefined);
});

test("optionalBodyString: blank string throws", () => {
  assert.throws(
    () => optionalBodyString({ name: "   " }, "name"),
    /must not be blank/,
  );
});

test("optionalBodyString: trims", () => {
  assert.equal(optionalBodyString({ name: " a " }, "name"), "a");
});

test("optionalBodyStringArray: absent field is undefined", () => {
  assert.equal(optionalBodyStringArray({}, "tags"), undefined);
});

test("optionalBodyStringArray: happy path trims each entry", () => {
  assert.deepEqual(optionalBodyStringArray({ tags: ["a", " b "] }, "tags"), [
    "a",
    "b",
  ]);
});

test("optionalBodyStringArray: empty array passes through", () => {
  assert.deepEqual(optionalBodyStringArray({ tags: [] }, "tags"), []);
});

test("optionalBodyStringArray: a scalar throws /must be an array of strings/", () => {
  assert.throws(
    () => optionalBodyStringArray({ tags: "a" }, "tags"),
    /must be an array of strings/,
  );
});

test("optionalBodyStringArray: a non-string entry throws /must be an array of strings/", () => {
  assert.throws(
    () => optionalBodyStringArray({ tags: [1] }, "tags"),
    /must be an array of strings/,
  );
});

test("optionalBodyStringArray: a blank entry throws /entries must not be blank/", () => {
  assert.throws(
    () => optionalBodyStringArray({ tags: [""] }, "tags"),
    /entries must not be blank/,
  );
});

test("optionalBodyBool: absent field is undefined", () => {
  assert.equal(optionalBodyBool({}, "paused"), undefined);
});

test("optionalBodyBool: happy path passes through true", () => {
  assert.equal(optionalBodyBool({ paused: true }, "paused"), true);
});

test("optionalBodyBool: a string throws /must be a boolean/", () => {
  assert.throws(
    () => optionalBodyBool({ paused: "true" }, "paused"),
    /must be a boolean/,
  );
});

test("requireBodyObject: happy path returns the object", () => {
  assert.deepEqual(requireBodyObject({ auth: {} }, "auth"), {});
});

test("requireBodyObject: missing field throws", () => {
  assert.throws(() => requireBodyObject({}, "auth"), /must be an object/);
});

test("requireBodyObject: an array throws /must be an object/", () => {
  assert.throws(
    () => requireBodyObject({ auth: [] }, "auth"),
    /must be an object/,
  );
});

test("requireBodyObject: null throws /must be an object/", () => {
  assert.throws(
    () => requireBodyObject({ auth: null }, "auth"),
    /must be an object/,
  );
});

test("requireBodyObjectArray: happy path passes objects through", () => {
  assert.deepEqual(
    requireBodyObjectArray({ entries: [{}, { a: 1 }] }, "entries"),
    [{}, { a: 1 }],
  );
});

test("requireBodyObjectArray: empty array is legal", () => {
  assert.deepEqual(requireBodyObjectArray({ entries: [] }, "entries"), []);
});

test("requireBodyObjectArray: missing field throws", () => {
  assert.throws(
    () => requireBodyObjectArray({}, "entries"),
    /must be an array of objects/,
  );
});

test("requireBodyObjectArray: a non-object entry throws", () => {
  assert.throws(
    () => requireBodyObjectArray({ entries: [1] }, "entries"),
    /must be an array of objects/,
  );
});

test("requireBodyObjectArray: an array entry throws", () => {
  assert.throws(
    () => requireBodyObjectArray({ entries: [[]] }, "entries"),
    /must be an array of objects/,
  );
});

test("optionalBodyRecord: absent field is undefined", () => {
  assert.equal(optionalBodyRecord({}, "bindings"), undefined);
});

test("optionalBodyRecord: happy path returns a fresh object with the same entries", () => {
  const input = { bindings: { a: "b" } };
  const result = optionalBodyRecord(input, "bindings");
  assert.deepEqual(result, { a: "b" });
  assert.notEqual(result, input.bindings);
});

test("optionalBodyRecord: a non-string value throws", () => {
  assert.throws(
    () => optionalBodyRecord({ bindings: { a: 1 } }, "bindings"),
    /must be an object of strings/,
  );
});

test("optionalBodyRecord: an array throws", () => {
  assert.throws(
    () => optionalBodyRecord({ bindings: [] }, "bindings"),
    /must be an object of strings/,
  );
});

test("body-level rejection: a null body throws /request body must be a JSON object/ (requireBodyString)", () => {
  assert.throws(
    () => requireBodyString(null, "name"),
    /request body must be a JSON object/,
  );
});

test("body-level rejection: an array body throws (optionalBodyBool)", () => {
  assert.throws(
    () => optionalBodyBool([], "paused"),
    /request body must be a JSON object/,
  );
});

test("body-level rejection: a scalar string body throws (requireBodyObjectArray)", () => {
  assert.throws(
    () => requireBodyObjectArray("str", "entries"),
    /request body must be a JSON object/,
  );
});

test("requireBodyRepositoryAuth: kind 'ambient' gives exactly {kind}", () => {
  const auth = requireBodyRepositoryAuth({ auth: { kind: "ambient" } }, "auth");
  assert.deepEqual(auth, { kind: "ambient" });
  assert.deepEqual(Object.keys(auth), ["kind"]);
});

test("requireBodyRepositoryAuth: kind 'ssh-agent' gives exactly {kind}", () => {
  const auth = requireBodyRepositoryAuth(
    { auth: { kind: "ssh-agent" } },
    "auth",
  );
  assert.deepEqual(auth, { kind: "ssh-agent" });
  assert.deepEqual(Object.keys(auth), ["kind"]);
});

test("requireBodyRepositoryAuth: kind 'https-token' gives exactly {kind,credentialId}", () => {
  const auth = requireBodyRepositoryAuth(
    { auth: { kind: "https-token", credentialId: "c1" } },
    "auth",
  );
  assert.deepEqual(auth, { kind: "https-token", credentialId: "c1" });
  assert.deepEqual(Object.keys(auth).sort(), ["credentialId", "kind"]);
});

test("requireBodyRepositoryAuth: an unknown kind throws InvalidInputError naming the field", () => {
  assert.throws(
    () => requireBodyRepositoryAuth({ auth: { kind: "bogus" } }, "auth"),
    (err: unknown) => {
      assert.ok(err instanceof InvalidInputError);
      assert.equal(err.field, "auth");
      return true;
    },
  );
});

test("requireBodyRepositoryAuth: 'https-token' with no credentialId throws InvalidInputError", () => {
  assert.throws(
    () => requireBodyRepositoryAuth({ auth: { kind: "https-token" } }, "auth"),
    (err: unknown) => {
      assert.ok(err instanceof InvalidInputError);
      assert.equal(err.field, "credentialId");
      return true;
    },
  );
});

test("requireBodyRepositoryAuth: a non-object auth throws InvalidInputError", () => {
  assert.throws(
    () => requireBodyRepositoryAuth({ auth: "x" }, "auth"),
    (err: unknown) => {
      assert.ok(err instanceof InvalidInputError);
      assert.equal(err.field, "auth");
      return true;
    },
  );
});

test("requireBodyRepositoryAuth: an absent auth throws InvalidInputError", () => {
  assert.throws(
    () => requireBodyRepositoryAuth({}, "auth"),
    (err: unknown) => {
      assert.ok(err instanceof InvalidInputError);
      assert.equal(err.field, "auth");
      return true;
    },
  );
});

test("optionalBodyRepositoryAuth: absent field is undefined", () => {
  assert.equal(optionalBodyRepositoryAuth({}, "auth"), undefined);
});

test("optionalBodyRepositoryAuth: delegates to requireBodyRepositoryAuth when present", () => {
  const auth = optionalBodyRepositoryAuth(
    { auth: { kind: "ambient" } },
    "auth",
  );
  assert.deepEqual(auth, { kind: "ambient" });
});

test("every thrown InvalidInputError maps to invalid_input/400", () => {
  try {
    requireBodyString({}, "name");
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof InvalidInputError);
    const mapping = mapError(err);
    assert.equal(mapping.code, "invalid_input");
    assert.equal(mapping.status, 400);
  }
});
