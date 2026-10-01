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
  test("131042 = problema de pagamento", () => assert.equal(categorizeMetaError(131042), "payment_issue"));
  test("131048 = limitado por spam", () => assert.equal(categorizeMetaError(131048), "spam_limited"));
  test("368 = bloqueado por política", () => assert.equal(categorizeMetaError(368), "policy_blocked"));
  test("131000 e 131016 = instabilidade da Meta", () => {
    assert.equal(categorizeMetaError(131000), "transient");
    assert.equal(categorizeMetaError(131016), "transient");
  });
  test("4 e 80007 = limite de velocidade", () => {
    assert.equal(categorizeMetaError(4), "rate_limited");
    assert.equal(categorizeMetaError(80007), "rate_limited");
  });
  test("sem código + HTTP 500 = instabilidade", () => assert.equal(categorizeMetaError(null, 500), "transient"));
  test("sem código + HTTP 503 = instabilidade", () => assert.equal(categorizeMetaError(null, 503), "transient"));
  test("sem código + falha de rede (0) = instabilidade", () => assert.equal(categorizeMetaError(null, 0), "transient"));
  test("sem código + HTTP 400 continua desconhecido", () => assert.equal(categorizeMetaError(null, 400), "unknown"));
  test("com código, o HTTP não muda a categoria", () => assert.equal(categorizeMetaError(131047, 500), "window_closed"));
});

describe("classificação", () => {
  test("token inválido é problema do número", () => assert.equal(isNumberLevelError("token_invalid"), true));
  test("não entregável não é problema do número", () => assert.equal(isNumberLevelError("undeliverable"), false));
  test("modelo pausado para a campanha", () => assert.equal(isCampaignStopper("template_paused"), true));
  test("não entregável não para a campanha", () => assert.equal(isCampaignStopper("undeliverable"), false));
  test("problema de pagamento para a campanha", () => assert.equal(isCampaignStopper("payment_issue"), true));
  test("limite por spam para a campanha", () => assert.equal(isCampaignStopper("spam_limited"), true));
  test("bloqueio por política para a campanha", () => assert.equal(isCampaignStopper("policy_blocked"), true));
  test("instabilidade não para a campanha", () => assert.equal(isCampaignStopper("transient"), false));
  test("problemas da conta não marcam o número com erro", () => {
    assert.equal(isNumberLevelError("payment_issue"), false);
    assert.equal(isNumberLevelError("spam_limited"), false);
    assert.equal(isNumberLevelError("policy_blocked"), false);
  });
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
  test("motivos de pausa dos problemas da conta", () => {
    assert.equal(pauseReasonText("payment_issue"), "Problema com a forma de pagamento da conta na Meta.");
    assert.equal(pauseReasonText("spam_limited"), "A Meta limitou o número por excesso de mensagens.");
    assert.equal(pauseReasonText("policy_blocked"), "A Meta bloqueou o envio por violação de política.");
  });
});
