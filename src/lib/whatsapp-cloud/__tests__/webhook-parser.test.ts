import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseCloudWebhook, type CloudEvent } from "../webhook-parser";
import * as f from "./fixtures";

const one = (payload: unknown): CloudEvent => {
  const events = parseCloudWebhook(payload);
  assert.equal(events.length, 1);
  return events[0];
};

describe("mensagens recebidas", () => {
  test("texto com telefone, BSUID, nome e usuário", () => {
    const e = one(f.inboundText({ username: "maria.c" }));
    assert.equal(e.kind, "message");
    if (e.kind !== "message") return;
    assert.equal(e.phoneNumberId, f.PHONE_NUMBER_ID);
    assert.equal(e.wamid, "wamid.IN.0001");
    assert.equal(e.type, "TEXT");
    assert.equal(e.body, "Olá, quero um orçamento");
    assert.equal(e.waId, "5511999990001");
    assert.equal(e.bsuid, "BR.1349120865530274191");
    assert.equal(e.profileName, "Maria Cliente");
    assert.equal(e.username, "maria.c");
    assert.equal(e.timestamp.toISOString(), new Date(1790000000 * 1000).toISOString());
    assert.equal(e.media, null);
  });

  test("cliente só com BSUID (sem telefone)", () => {
    const e = one(f.inboundText({ waId: null }));
    assert.equal(e.kind, "message");
    if (e.kind !== "message") return;
    assert.equal(e.waId, null);
    assert.equal(e.bsuid, "BR.1349120865530274191");
  });

  test("sem telefone e sem BSUID é descartada", () => {
    assert.deepEqual(parseCloudWebhook(f.inboundText({ waId: null, bsuid: null })), []);
  });

  test("imagem com legenda", () => {
    const e = one(f.inboundMedia("image", { caption: "foto da peça" }));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "IMAGE");
    assert.equal(e.body, "foto da peça");
    assert.deepEqual(e.media, { id: "media-image-1", mime: "image/jpeg", filename: null, voice: false });
  });

  test("áudio de voz", () => {
    const e = one(f.inboundMedia("audio"));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "AUDIO");
    assert.equal(e.media?.voice, true);
    assert.equal(e.media?.mime, "audio/ogg; codecs=opus");
  });

  test("documento com nome de arquivo", () => {
    const e = one(f.inboundMedia("document"));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "DOCUMENT");
    assert.equal(e.media?.filename, "orcamento.pdf");
  });

  test("figurinha", () => {
    const e = one(f.inboundMedia("sticker"));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "STICKER");
  });

  test("localização com nome e endereço", () => {
    const e = one(f.inboundLocation({ name: "Loja", address: "Av. Paulista, 1000" }));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "LOCATION");
    assert.equal(e.body, "Loja — Av. Paulista, 1000");
    assert.deepEqual(e.extra.location, { latitude: -23.55, longitude: -46.63, name: "Loja", address: "Av. Paulista, 1000" });
  });

  test("localização sem nome usa coordenadas", () => {
    const e = one(f.inboundLocation());
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.body, "-23.55,-46.63");
  });

  test("resposta citando outra mensagem", () => {
    const e = one(f.inboundText({ contextId: "wamid.OUT.9" }));
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.quotedWamid, "wamid.OUT.9");
  });

  test("tipo desconhecido vira UNSUPPORTED com o tipo cru", () => {
    const payload = f.inboundText();
    const value = (payload.entry as { changes: { value: { messages: Record<string, unknown>[] } }[] }[])[0].changes[0].value;
    value.messages[0] = { ...value.messages[0], type: "contacts", text: undefined, contacts: [] };
    const e = one(payload);
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "UNSUPPORTED");
    assert.equal(e.extra.rawType, "contacts");
  });

  test("resposta de botão de modelo vira TEXT", () => {
    const payload = f.inboundText();
    const value = (payload.entry as { changes: { value: { messages: Record<string, unknown>[] } }[] }[])[0].changes[0].value;
    value.messages[0] = { ...value.messages[0], type: "button", text: undefined, button: { text: "Parar de receber", payload: "STOP" } };
    const e = one(payload);
    if (e.kind !== "message") return assert.fail("esperava message");
    assert.equal(e.type, "TEXT");
    assert.equal(e.body, "Parar de receber");
  });
});

describe("reações", () => {
  test("reação com emoji", () => {
    const e = one(f.inboundReaction({ targetWamid: "wamid.OUT.1", emoji: "❤️" }));
    assert.deepEqual(
      { kind: e.kind, target: e.kind === "reaction" ? e.targetWamid : "", emoji: e.kind === "reaction" ? e.emoji : "" },
      { kind: "reaction", target: "wamid.OUT.1", emoji: "❤️" },
    );
  });

  test("reação removida (sem emoji) vira emoji vazio", () => {
    const e = one(f.inboundReaction({ targetWamid: "wamid.OUT.1", emoji: null }));
    if (e.kind !== "reaction") return assert.fail("esperava reaction");
    assert.equal(e.emoji, "");
  });
});

describe("status", () => {
  test("entregue com cobrança", () => {
    const e = one(f.statusUpdate({ wamid: "wamid.OUT.1", status: "delivered", pricingCategory: "service" }));
    if (e.kind !== "status") return assert.fail("esperava status");
    assert.equal(e.status, "DELIVERED");
    assert.equal(e.pricingCategory, "service");
    assert.equal(e.pricingType, "regular");
    assert.equal(e.waId, "5511999990001");
    assert.equal(e.bsuid, "BR.1349120865530274191");
    assert.equal(e.errorCode, null);
  });

  test("falha com código e detalhe", () => {
    const e = one(f.statusUpdate({ wamid: "wamid.OUT.2", status: "failed", errorCode: 131047, errorDetails: "Mais de 24h." }));
    if (e.kind !== "status") return assert.fail("esperava status");
    assert.equal(e.status, "FAILED");
    assert.equal(e.errorCode, 131047);
    assert.equal(e.errorMessage, "Mais de 24h.");
  });

  test("played é ignorado", () => {
    assert.deepEqual(parseCloudWebhook(f.statusUpdate({ wamid: "wamid.OUT.3", status: "played" })), []);
  });
});

describe("outros eventos", () => {
  test("modelo pausado", () => {
    const e = one(f.templateStatusUpdate({ name: "boas_vindas", event: "PAUSED", reason: "NONE" }));
    assert.deepEqual(e, {
      kind: "template_status",
      wabaId: f.WABA_ID,
      metaTemplateId: "594425479261596",
      name: "boas_vindas",
      language: "pt_BR",
      status: "PAUSED",
      reason: null,
    });
  });

  test("modelo rejeitado guarda o motivo", () => {
    const e = one(f.templateStatusUpdate({ name: "promo", event: "REJECTED", reason: "PROMOTIONAL" }));
    if (e.kind !== "template_status") return assert.fail("esperava template_status");
    assert.equal(e.reason, "PROMOTIONAL");
  });

  test("troca de BSUID", () => {
    const e = one(f.userIdUpdate({ previous: "BR.1", current: "BR.2" }));
    assert.deepEqual(e, {
      kind: "user_id_update",
      phoneNumberId: f.PHONE_NUMBER_ID,
      waId: "5511999990001",
      previousBsuid: "BR.1",
      currentBsuid: "BR.2",
    });
  });

  test("objeto que não é do WhatsApp é ignorado", () => {
    assert.deepEqual(parseCloudWebhook({ object: "page", entry: [] }), []);
    assert.deepEqual(parseCloudWebhook(null), []);
  });

  test("mensagem sem id é ignorada", () => {
    const payload = f.inboundText();
    const value = (payload.entry as { changes: { value: { messages: Record<string, unknown>[] } }[] }[])[0].changes[0].value;
    delete value.messages[0].id;
    assert.deepEqual(parseCloudWebhook(payload), []);
  });
});
