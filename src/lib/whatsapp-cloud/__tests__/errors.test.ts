import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  categorizeMetaError,
  graphErrorFromBody,
  isCampaignStopper,
  isNumberLevelError,
  pauseReasonText,
  recipientErrorText,
} from "../errors";

describe("categorizeMetaError", () => {
  test("131047 = janela fechada", () => assert.equal(categorizeMetaError(131047), "window_closed"));
  test("190 = token inválido", () => assert.equal(categorizeMetaError(190), "token_invalid"));
  test("130429 = limite de velocidade", () => assert.equal(categorizeMetaError(130429), "rate_limited"));
  test("código desconhecido", () => assert.equal(categorizeMetaError(999999), "unknown"));
  test("sem código", () => assert.equal(categorizeMetaError(null), "unknown"));
});

describe("classificação", () => {
  test("token inválido é problema do número", () => assert.equal(isNumberLevelError("token_invalid"), true));
  test("não entregável não é problema do número", () => assert.equal(isNumberLevelError("undeliverable"), false));
  test("modelo pausado para a campanha", () => assert.equal(isCampaignStopper("template_paused"), true));
  test("não entregável não para a campanha", () => assert.equal(isCampaignStopper("undeliverable"), false));
});

describe("graphErrorFromBody", () => {
  test("usa error_data.details quando existe", () => {
    const e = graphErrorFromBody(400, {
      error: { message: "(#131047) Re-engagement message", code: 131047, error_data: { details: "Mais de 24h." } },
    });
    assert.deepEqual(e, { code: 131047, message: "Mais de 24h." });
  });

  test("cai para error.message", () => {
    const e = graphErrorFromBody(401, { error: { message: "Invalid OAuth access token.", code: 190 } });
    assert.deepEqual(e, { code: 190, message: "Invalid OAuth access token." });
  });

  test("corpo estranho vira 'Meta <status>'", () => {
    assert.deepEqual(graphErrorFromBody(500, "oops"), { code: null, message: "Meta 500" });
  });
});

describe("textos", () => {
  test("destinatário sem WhatsApp", () =>
    assert.equal(recipientErrorText("undeliverable", "x"), "Número não recebe WhatsApp."));
  test("categoria sem texto usa o detalhe da Meta", () =>
    assert.equal(recipientErrorText("invalid_params", "Parâmetro 2 vazio"), "Parâmetro 2 vazio"));
  test("sem detalhe usa texto genérico", () => assert.equal(recipientErrorText("unknown", null), "Falha no envio."));
  test("motivo de pausa do modelo pausado", () =>
    assert.equal(pauseReasonText("template_paused"), "A Meta pausou o modelo desta campanha."));
});
