import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { newId, ID_PREFIX } from "./id.ts";

describe("src/foundations/id.ts", () => {
  describe("newId(prefix)", () => {
    it("returns <prefix>_<26-char Crockford base32>", () => {
      const id = newId("acc");
      assert.match(id, /^acc_[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    it("works for every in-scope prefix constant", () => {
      for (const [, prefix] of Object.entries(ID_PREFIX)) {
        const id = newId(prefix);
        assert.match(id, new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`));
      }
    });

    it("1000 sequential ids are strictly increasing lexicographically (monotonic, same-ms safe)", () => {
      const ids: string[] = [];
      for (let i = 0; i < 1000; i++) {
        ids.push(newId("op"));
      }
      for (let i = 1; i < ids.length; i++) {
        const prev = ids[i - 1] as string;
        const curr = ids[i] as string;
        assert.ok(prev < curr, `id[${i - 1}] "${prev}" >= id[${i}] "${curr}"`);
      }
    });
  });

  describe("ID_PREFIX constants", () => {
    it("account prefix is 'acc'", () => {
      assert.equal(ID_PREFIX.account, "acc");
    });

    it("op prefix is 'op'", () => {
      assert.equal(ID_PREFIX.op, "op");
    });

    it("event prefix is 'evt'", () => {
      assert.equal(ID_PREFIX.event, "evt");
    });

    it("call prefix is 'call'", () => {
      assert.equal(ID_PREFIX.call, "call");
    });

    it("reservation prefix is 'rsv'", () => {
      assert.equal(ID_PREFIX.reservation, "rsv");
    });
  });
});
