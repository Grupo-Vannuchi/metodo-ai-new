import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { previewFor, quotedLabel } from "../preview";

describe("prévia", () => {
  test("texto", () => assert.equal(previewFor("TEXT", "Olá"), "Olá"));
  test("imagem com legenda", () => assert.equal(previewFor("IMAGE", "peça"), "📷 Imagem: peça"));
  test("áudio sem legenda", () => assert.equal(previewFor("AUDIO", null), "🎧 Áudio"));
  test("modelo usa o texto", () => assert.equal(previewFor("TEMPLATE", "Oi Ana"), "Oi Ana"));
  test("limita a 200 caracteres", () => assert.equal(previewFor("TEXT", "a".repeat(300)).length, 200));
  test("citação de documento sem texto", () => assert.equal(quotedLabel("DOCUMENT", null), "📄 Documento"));
  test("citação de tipo desconhecido", () => assert.equal(quotedLabel("XYZ", ""), "[mensagem]"));
});
