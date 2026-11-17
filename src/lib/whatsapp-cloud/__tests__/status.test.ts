import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { nextMessageStatus } from "../status";

describe("status só anda para frente", () => {
  test("sem status → SENT", () => assert.equal(nextMessageStatus(null, "SENT"), "SENT"));
  test("SENT → DELIVERED", () => assert.equal(nextMessageStatus("SENT", "DELIVERED"), "DELIVERED"));
  test("READ não volta para DELIVERED", () => assert.equal(nextMessageStatus("READ", "DELIVERED"), null));
  test("SENT → FAILED", () => assert.equal(nextMessageStatus("SENT", "FAILED"), "FAILED"));
  test("entregue não vira FAILED", () => assert.equal(nextMessageStatus("DELIVERED", "FAILED"), null));
  test("FAILED não ressuscita", () => assert.equal(nextMessageStatus("FAILED", "READ"), null));
  test("PENDING recebido é ignorado", () => assert.equal(nextMessageStatus("SENT", "PENDING"), null));
  test("mesmo status é ignorado", () => assert.equal(nextMessageStatus("READ", "READ"), null));
});
