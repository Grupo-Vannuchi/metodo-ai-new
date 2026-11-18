/**
 * Self-check of how a document/photo sent from Conversas reports a failure
 * (src/lib/integrations/channels/evolution.ts → sendMedia). Runs against a fake
 * Evolution on 127.0.0.1 (the dev guard lets loopback through), so nothing
 * leaves this machine; the numbers are made up. Run with
 * `npm run check:inbox-media`; exits non-zero on the first failure.
 *
 * Why it exists: on 17/11/2026 a send failed in production and the hPanel log
 * had no line about it, because a dropped connection to Evolution was swallowed
 * without logging, and the screen could not tell "refused" from "may have gone
 * out" (a retry then risks sending the file twice).
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import adapter from "../src/lib/integrations/channels/evolution";

type Mode = "ok" | "refuse" | "drop";
let mode: Mode = "ok";

const server: Server = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (mode === "drop") {
      req.socket.destroy(); // the call reached Evolution and no answer came back
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (mode === "refuse") {
      res.statusCode = 400;
      res.end(JSON.stringify({ status: 400, error: "Bad Request", response: { message: ["Media inválida"] } }));
      return;
    }
    res.end(JSON.stringify({ key: { id: "FAKE-ID-1" } }));
  });
});

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** Captures what the adapter writes to console.error during `fn`. */
async function capture<T>(fn: () => Promise<T>): Promise<{ value: T; logged: string }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    return { value: await fn(), logged: lines.join("\n") };
  } finally {
    console.error = original;
  }
}

async function main(): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const creds = { baseUrl: `http://127.0.0.1:${port}`, apiKey: "fake-key", instance: "fake instance" };
  const input = {
    to: "5511900000009",
    mediatype: "document" as const,
    media: "https://storage.example.com/file.pdf",
    mimetype: "application/pdf",
    fileName: "proposta.pdf",
  };
  const send = () => adapter.sendMedia!(creds, input);

  await check("an accepted send returns the provider id and is not uncertain", async () => {
    mode = "ok";
    const r = await send();
    assert.equal(r.ok, true);
    assert.equal(r.providerMessageId, "FAKE-ID-1");
    assert.notEqual(r.uncertain, true);
  });

  await check("a refusal is a plain failure (safe to retry), with Evolution's reason", async () => {
    mode = "refuse";
    const { value: r, logged } = await capture(send);
    assert.equal(r.ok, false);
    assert.notEqual(r.uncertain, true);
    assert.match(r.error ?? "", /Media inválida/);
    assert.match(logged, /\[evolution\] sendMedia 400/);
  });

  await check("a dropped connection is uncertain and leaves a log line without the phone", async () => {
    mode = "drop";
    const { value: r, logged } = await capture(send);
    assert.equal(r.ok, false);
    assert.equal(r.uncertain, true);
    assert.match(logged, /\[evolution\] sendMedia no response/);
    assert.doesNotMatch(logged, /900000009/);
  });

  server.close();
  console.log(`\ncheck:inbox-media — ${passed} checks passed`);
}

main().catch((error) => {
  server.close();
  console.error(error);
  process.exit(1);
});
