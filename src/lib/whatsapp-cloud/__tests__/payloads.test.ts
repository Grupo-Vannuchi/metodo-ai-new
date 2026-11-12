import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mediaPayload, reactionPayload, readPayload, recipientFields, templatePayload, textPayload } from "../payloads";

const phone = { waId: "5511999990001", bsuid: "BR.1" };
const onlyBsuid = { waId: null, bsuid: "BR.1" };

describe("destinatário", () => {
  test("telefone tem prioridade", () => assert.deepEqual(recipientFields(phone), { to: "5511999990001" }));
  test("sem telefone usa o BSUID em recipient", () => assert.deepEqual(recipientFields(onlyBsuid), { recipient: "BR.1" }));
  test("sem nenhum lança", () => assert.throws(() => recipientFields({ waId: null, bsuid: null })));
});

describe("payloads", () => {
  test("texto com citação", () => {
    assert.deepEqual(textPayload(phone, "Oi", "wamid.X"), {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5511999990001",
      type: "text",
      text: { preview_url: false, body: "Oi" },
      context: { message_id: "wamid.X" },
    });
  });

  test("texto sem citação não tem context", () => {
    assert.equal("context" in textPayload(onlyBsuid, "Oi"), false);
  });

  test("imagem com legenda", () => {
    const p = mediaPayload(phone, "image", "m1", { caption: "foto" });
    assert.deepEqual(p.image, { id: "m1", caption: "foto" });
    assert.equal(p.type, "image");
  });

  test("áudio descarta legenda", () => {
    assert.deepEqual(mediaPayload(phone, "audio", "m2", { caption: "x" }).audio, { id: "m2" });
  });

  test("documento com nome de arquivo", () => {
    assert.deepEqual(mediaPayload(phone, "document", "m3", { filename: "a.pdf" }).document, { id: "m3", filename: "a.pdf" });
  });

  test("reação", () => {
    assert.deepEqual(reactionPayload(phone, "wamid.Y", "👍").reaction, { message_id: "wamid.Y", emoji: "👍" });
  });

  test("modelo com componentes", () => {
    const p = templatePayload(phone, "boas_vindas", "pt_BR", [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }]);
    assert.deepEqual(p.template, {
      name: "boas_vindas",
      language: { code: "pt_BR" },
      components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
    });
  });

  test("modelo sem componentes omite a chave", () => {
    assert.deepEqual(templatePayload(phone, "oi", "pt_BR", []).template, { name: "oi", language: { code: "pt_BR" } });
  });

  test("confirmação de leitura", () => {
    assert.deepEqual(readPayload("wamid.Z"), { messaging_product: "whatsapp", status: "read", message_id: "wamid.Z" });
  });
});
