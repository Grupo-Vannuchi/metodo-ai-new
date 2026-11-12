/**
 * Self-check for the development guard of outgoing WhatsApp
 * (src/lib/whatsapp/dev-guard.ts). No DB, no network, no env: every number
 * below is made up and never leaves this process. Run with
 * `npm run check:devguard`; exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { cloudSendBlocked, destinationKeys, devGuardBlocks, parseDevAllowlist } from "../src/lib/whatsapp/dev-guard";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const VPS = "https://evolution.example.com";
const NONE = parseDevAllowlist(undefined);
const MINE = parseDevAllowlist("(11) 90000-0001, 5511900000002; 120363000000000001@g.us");

const blocks = (target: string, opts: { nodeEnv?: string; baseUrl?: string; allowed?: ReadonlySet<string> } = {}) =>
  devGuardBlocks({
    nodeEnv: "nodeEnv" in opts ? opts.nodeEnv : "development",
    baseUrl: opts.baseUrl ?? VPS,
    target,
    allowed: opts.allowed ?? MINE,
  });

check("production is never held back, even with an empty list", () => {
  assert.equal(blocks("5511988887777", { nodeEnv: "production", allowed: NONE }), false);
});

check("outside production an empty list holds every number back", () => {
  assert.equal(blocks("5511900000001", { allowed: NONE }), true);
});

check("an unset NODE_ENV (tsx scripts) and NODE_ENV=test are guarded too", () => {
  assert.equal(blocks("5511988887777", { nodeEnv: undefined }), true);
  assert.equal(blocks("5511988887777", { nodeEnv: "test" }), true);
});

check("a listed number goes out in any format WhatsApp may use", () => {
  assert.equal(blocks("5511900000001"), false);
  assert.equal(blocks("11900000001"), false);
  assert.equal(blocks("551100000001"), false); // without the 9th digit
  assert.equal(blocks("5511900000001@s.whatsapp.net"), false); // a reaction's remoteJid
});

check("a list entry without the 9th digit also lets the 13-digit form through", () => {
  const old = parseDevAllowlist("551100000003");
  assert.equal(blocks("5511900000003", { allowed: old }), false);
});

check("a number that is not listed is held back", () => {
  assert.equal(blocks("5511988887777"), true);
});

check("a group goes out only when its JID is listed", () => {
  assert.equal(blocks("120363000000000001@g.us"), false);
  assert.equal(blocks("120363000000000999@g.us"), true);
});

check("a LID remoteJid is held back (no phone to match)", () => {
  assert.equal(blocks("123456789012345@lid"), true);
});

check("an empty destination is held back", () => {
  assert.equal(blocks(""), true);
  assert.deepEqual(destinationKeys("  "), []);
});

check("a loopback Evolution (local fake of the e2e scripts) is let through", () => {
  for (const baseUrl of ["http://localhost:4999", "http://127.0.0.1:4999", "http://[::1]:4999"]) {
    assert.equal(blocks("5511988887777", { baseUrl, allowed: NONE }), false, baseUrl);
  }
});

check("a host that only looks local is still guarded", () => {
  assert.equal(blocks("5511988887777", { baseUrl: "http://localhost.example.com", allowed: NONE }), true);
  assert.equal(blocks("5511988887777", { baseUrl: "not a url", allowed: NONE }), true);
});

check("the list splits on commas and semicolons and skips empty entries", () => {
  const list = parseDevAllowlist(" 5511900000001 ,, ;5511900000002  ");
  assert.equal(list.has("5511900000001"), true);
  assert.equal(list.has("5511900000002"), true);
  assert.equal(list.has(""), false);
});

check("a formatted entry with spaces stays one number", () => {
  const list = parseDevAllowlist("(11) 90000-0001");
  assert.equal(list.has("5511900000001"), true);
  assert.equal(list.size, 2); // with and without the 9th digit, nothing else
});

// Official WhatsApp (Cloud API): the body of POST /{phone-number-id}/messages.
const cloudBlocks = (payload: Record<string, unknown>, opts: { nodeEnv?: string; allowed?: ReadonlySet<string> } = {}) =>
  cloudSendBlocked({ nodeEnv: "nodeEnv" in opts ? opts.nodeEnv : "development", payload, allowed: opts.allowed ?? MINE });
const template = (to: string) => ({ messaging_product: "whatsapp", to, type: "template", template: { name: "x" } });

check("official: a phone on the list goes out (with or without the 9th digit)", () => {
  assert.equal(cloudBlocks(template("5511900000001")), false);
  assert.equal(cloudBlocks(template("551100000001")), false); // the Meta may answer a Brazilian mobile without the 9
  assert.equal(cloudBlocks(template("5511900000002")), false);
});

check("official: a phone off the list, or an empty list, is held outside production", () => {
  assert.equal(cloudBlocks(template("5511988887777")), true);
  assert.equal(cloudBlocks(template("5511900000001"), { allowed: NONE }), true);
  assert.equal(cloudBlocks(template("5511900000001"), { nodeEnv: undefined, allowed: NONE }), true);
});

check("official: production is never held back", () => {
  assert.equal(cloudBlocks(template("5511988887777"), { nodeEnv: "production", allowed: NONE }), false);
  assert.equal(cloudBlocks({ messaging_product: "whatsapp", recipient: "BR.abc" }, { nodeEnv: "production" }), false);
});

check("official: a BSUID-only destination is held outside production, a read receipt passes", () => {
  assert.equal(cloudBlocks({ messaging_product: "whatsapp", recipient: "BR.5511900000001" }), true);
  assert.equal(cloudBlocks({ messaging_product: "whatsapp", status: "read", message_id: "wamid.x" }), false);
});

console.log(`\n✅ whatsapp-dev-guard: ${passed} checks passed.`);
