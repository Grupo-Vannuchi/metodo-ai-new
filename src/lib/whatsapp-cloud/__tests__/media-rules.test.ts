import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkOutboundMedia, extensionFor, kindForMime, sniffMime } from "../media-rules";

const bytes = (...b: number[]) => Uint8Array.from(b);
const ascii = (s: string, pad = 16) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)).concat(Array(pad).fill(0x20)));

describe("sniffMime", () => {
  test("JPEG", () => assert.equal(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0), "image/png"), "image/jpeg"));
  test("PNG", () => assert.equal(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d), ""), "image/png"));
  test("GIF é detectado (para ser recusado)", () => assert.equal(sniffMime(ascii("GIF89a"), "image/gif"), "image/gif"));
  test("PDF", () => assert.equal(sniffMime(ascii("%PDF-1.7"), "application/octet-stream"), "application/pdf"));
  test("OGG", () => assert.equal(sniffMime(ascii("OggS"), ""), "audio/ogg"));
  test("AAC (ADTS)", () => assert.equal(sniffMime(bytes(0xff, 0xf1, 0x50, 0x80), ""), "audio/aac"));
  test("MP3 com ID3", () => assert.equal(sniffMime(ascii("ID3"), ""), "audio/mpeg"));
  test("MP4 de vídeo", () => assert.equal(sniffMime(bytes(0, 0, 0, 0x18, ...ascii("ftypisom", 4)), ""), "video/mp4"));
  test("M4A", () => assert.equal(sniffMime(bytes(0, 0, 0, 0x18, ...ascii("ftypM4A ", 4)), ""), "audio/mp4"));
  test("3GP", () => assert.equal(sniffMime(bytes(0, 0, 0, 0x18, ...ascii("ftyp3gp4", 4)), ""), "video/3gpp"));
  test("DOCX (zip) usa o tipo declarado se for Office", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    assert.equal(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04, 0), docx), docx);
  });
  test("zip qualquer é recusado", () => assert.equal(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04, 0), "application/zip"), null));
  test("texto puro declarado", () => assert.equal(sniffMime(ascii("olá mundo"), "text/plain"), "text/plain"));
  test("binário declarado como texto é recusado", () => assert.equal(sniffMime(bytes(0x41, 0x00, 0x42), "text/plain"), null));
  test("desconhecido", () => assert.equal(sniffMime(bytes(1, 2, 3, 4), "image/jpeg"), null));
});

describe("checkOutboundMedia", () => {
  test("JPEG pequeno ok", () => assert.deepEqual(checkOutboundMedia("image/jpeg", 1000), { ok: true, kind: "image", mime: "image/jpeg" }));
  test("GIF não é aceito", () => assert.deepEqual(checkOutboundMedia("image/gif", 1000), { ok: false, reason: "unsupported_type" }));
  test("imagem acima de 5 MB", () =>
    assert.deepEqual(checkOutboundMedia("image/png", 5 * 1024 * 1024 + 1), { ok: false, reason: "too_large" }));
  test("vazio", () => assert.deepEqual(checkOutboundMedia("image/png", 0), { ok: false, reason: "file_empty" }));
  test("sem tipo", () => assert.deepEqual(checkOutboundMedia(null, 10), { ok: false, reason: "unsupported_type" }));
  test("PDF de 90 MB ok", () => assert.equal(checkOutboundMedia("application/pdf", 90 * 1024 * 1024).ok, true));
});

describe("kindForMime e extensionFor", () => {
  test("áudio", () => assert.equal(kindForMime("audio/ogg"), "audio"));
  test("mime com parâmetros", () => assert.equal(extensionFor("audio/ogg; codecs=opus"), "ogg"));
  test("docx", () =>
    assert.equal(extensionFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx"));
  test("desconhecido", () => assert.equal(extensionFor("application/x-foo"), "bin"));
  test("nulo", () => assert.equal(extensionFor(null), "bin"));
});
