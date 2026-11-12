import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { WINDOW_MS, isWindowOpen, windowClosesAt } from "../window";

const now = new Date("2026-09-28T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("janela de 24h", () => {
  test("sem mensagem do cliente, está fechada", () => {
    assert.equal(isWindowOpen(null, now), false);
    assert.equal(windowClosesAt(null), null);
  });

  test("1h depois da última mensagem do cliente, está aberta", () => {
    assert.equal(isWindowOpen(ago(60 * 60 * 1000), now), true);
  });

  test("fecha exatamente 24h depois", () => {
    assert.equal(isWindowOpen(ago(WINDOW_MS), now), false);
    assert.equal(isWindowOpen(ago(WINDOW_MS - 1000), now), true);
  });

  test("aceita string ISO (JSON do polling)", () => {
    assert.equal(isWindowOpen(ago(1000).toISOString(), now), true);
  });

  test("data inválida conta como fechada", () => {
    assert.equal(isWindowOpen("não é data", now), false);
  });

  test("windowClosesAt soma 24h", () => {
    assert.equal(windowClosesAt(now)?.toISOString(), "2026-09-29T12:00:00.000Z");
  });
});
