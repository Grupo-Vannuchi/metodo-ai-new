import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { safeEqualString, verifySignature } from "../signature";

const secret = "app-secret-de-teste";
const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', "utf8");
const sign = (b: Uint8Array, s = secret) => `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;

describe("verifySignature", () => {
  test("assinatura correta passa", () => assert.equal(verifySignature(body, sign(body), secret), true));
  test("segredo errado falha", () => assert.equal(verifySignature(body, sign(body, "outro"), secret), false));
  test("corpo alterado falha", () =>
    assert.equal(verifySignature(Buffer.from(`${body.toString()} `), sign(body), secret), false));
  test("sem cabeçalho falha", () => assert.equal(verifySignature(body, null, secret), false));
  test("sem segredo configurado falha (fail-closed)", () =>
    assert.equal(verifySignature(body, sign(body), undefined), false));
  test("sem o prefixo sha256= falha", () =>
    assert.equal(verifySignature(body, sign(body).replace("sha256=", ""), secret), false));
  test("hex inválido falha sem lançar", () => assert.equal(verifySignature(body, "sha256=zz", secret), false));
});

describe("safeEqualString", () => {
  test("iguais", () => assert.equal(safeEqualString("abc", "abc"), true));
  test("diferentes", () => assert.equal(safeEqualString("abc", "abd"), false));
  test("tamanhos diferentes", () => assert.equal(safeEqualString("abc", "abcd"), false));
});
