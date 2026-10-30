/**
 * The Evolution API (v2) of scripts/check-whatsapp-group-add-e2e.ts, on loopback: it answers the calls of "Adicionar a
 * grupo do WhatsApp" in the shapes the real one answers them, writes down every call it gets and lets a check swap what
 * any route answers (an error, a refusal for privacy, a body that is not JSON, a connection dropped without a word).
 * Nothing reaches WhatsApp.
 * It lives outside the check script only to keep that readable.
 *
 * Every route has a default answer; `set` replaces it for the rest of that fake's life. A path or method the fake
 * doesn't serve gets a 404, and the call is recorded with `route: null`, so a check can prove nothing else was asked.
 */
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";

/** The number the fake instance is linked to: the superadmin of FAKE_EVO_GROUP. */
export const FAKE_EVO_OWNER_JID = "5511987654321@s.whatsapp.net";
export const FAKE_EVO_GROUP_JID = "120363000000000001@g.us";
export const FAKE_EVO_INVITE_CODE = "AbC";

/** The one group the fake knows, as v2 gives it: three members, the last a LID with no number to read. */
export const FAKE_EVO_GROUP = {
  id: FAKE_EVO_GROUP_JID,
  subject: "Ofertas",
  subjectOwner: FAKE_EVO_OWNER_JID,
  subjectTime: 1_700_000_000,
  size: 3,
  creation: 1_700_000_000,
  owner: FAKE_EVO_OWNER_JID,
  desc: "Ofertas da semana",
  restrict: false,
  announce: true,
  participants: [
    { id: FAKE_EVO_OWNER_JID, admin: "superadmin" },
    { id: "1@lid", phoneNumber: "5511912345678@s.whatsapp.net", admin: null },
    { id: "2@lid", admin: null },
  ],
};

export type FakeEvoRoute =
  | "fetchAllGroups"
  | "findGroupInfos"
  | "fetchInstances"
  | "connectionState"
  | "updateParticipant"
  | "whatsappNumbers"
  | "inviteCode"
  | "sendText";

export type FakeEvoCall = {
  /** The route it matched; null for a path or method the fake doesn't serve. */
  route: FakeEvoRoute | null;
  method: string;
  /** As it came on the wire (so still percent-encoded), without the query. */
  path: string;
  /** The instance the call names, decoded: the last segment of the path, or `instanceName` for fetchInstances. */
  instance: string | null;
  /** The query string, decoded. */
  query: Record<string, string>;
  /** The JSON body, parsed; the text itself when it isn't JSON; undefined when there is none. */
  body: unknown;
  /** The `apikey` header. */
  apikey: string | null;
};

/**
 * What a route answers: a JSON body with a status; a body that is not JSON (`text`, sent as it is, as a proxy's error page
 * would be); or "drop" to close the connection without a word.
 */
export type FakeEvoReply = { status: number; json?: unknown } | { status: number; text: string } | "drop";
export type FakeEvoHandler = (call: FakeEvoCall) => FakeEvoReply | Promise<FakeEvoReply>;

export type FakeEvolution = {
  port: number;
  /** Every call the fake got, in order. The array is live: it grows as the calls come. */
  calls: FakeEvoCall[];
  /** Changes what a route answers: a reply, or a function of the call. */
  set: (route: FakeEvoRoute, answer: FakeEvoReply | FakeEvoHandler) => void;
  close: () => Promise<void>;
};

const ROUTES: { route: FakeEvoRoute; method: "GET" | "POST"; pattern: RegExp }[] = [
  { route: "fetchAllGroups", method: "GET", pattern: /^\/group\/fetchAllGroups\/([^/]+)$/ },
  { route: "findGroupInfos", method: "GET", pattern: /^\/group\/findGroupInfos\/([^/]+)$/ },
  { route: "fetchInstances", method: "GET", pattern: /^\/instance\/fetchInstances$/ },
  { route: "connectionState", method: "GET", pattern: /^\/instance\/connectionState\/([^/]+)$/ },
  { route: "updateParticipant", method: "POST", pattern: /^\/group\/updateParticipant\/([^/]+)$/ },
  { route: "whatsappNumbers", method: "POST", pattern: /^\/chat\/whatsappNumbers\/([^/]+)$/ },
  { route: "inviteCode", method: "GET", pattern: /^\/group\/inviteCode\/([^/]+)$/ },
  { route: "sendText", method: "POST", pattern: /^\/message\/sendText\/([^/]+)$/ },
];

/** Every route the fake serves, for a check that swaps them all. */
export const FAKE_EVO_ROUTES: readonly FakeEvoRoute[] = ROUTES.map((r) => r.route);

const bodyOf = (call: FakeEvoCall): Record<string, unknown> =>
  typeof call.body === "object" && call.body !== null ? (call.body as Record<string, unknown>) : {};

const DEFAULT_HANDLERS: Record<FakeEvoRoute, FakeEvoHandler> = {
  fetchAllGroups: () => ({ status: 200, json: [FAKE_EVO_GROUP] }),
  findGroupInfos: (call) =>
    call.query.groupJid === FAKE_EVO_GROUP_JID
      ? { status: 200, json: FAKE_EVO_GROUP }
      : { status: 404, json: { status: 404, error: "Not Found", response: { message: ["Group not found"] } } },
  // The instance asked for, linked to FAKE_EVO_OWNER_JID.
  fetchInstances: (call) => ({ status: 200, json: [{ name: call.instance ?? "", ownerJid: FAKE_EVO_OWNER_JID }] }),
  connectionState: () => ({ status: 200, json: { instance: { state: "open" } } }),
  // One number per call, and it is added.
  updateParticipant: (call) => {
    const { participants } = bodyOf(call);
    const number = Array.isArray(participants) ? String(participants[0] ?? "") : "";
    return {
      status: 201,
      json: { updateParticipants: [{ status: "200", jid: `${number}@s.whatsapp.net`, content: null }] },
    };
  },
  // Every number has a WhatsApp account.
  whatsappNumbers: (call) => {
    const { numbers } = bodyOf(call);
    const list = Array.isArray(numbers) ? numbers.map(String) : [];
    return { status: 200, json: list.map((number) => ({ exists: true, jid: `${number}@s.whatsapp.net`, number })) };
  },
  inviteCode: () => ({
    status: 200,
    json: { inviteUrl: `https://chat.whatsapp.com/${FAKE_EVO_INVITE_CODE}`, inviteCode: FAKE_EVO_INVITE_CODE },
  }),
  sendText: (call) => {
    const { number, text } = bodyOf(call);
    return {
      status: 201,
      json: {
        key: { remoteJid: `${String(number)}@s.whatsapp.net`, fromMe: true, id: `FAKE${Date.now()}` },
        message: { conversation: text },
        status: "PENDING",
      },
    };
  },
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export async function listenFakeEvolution(): Promise<FakeEvolution> {
  const calls: FakeEvoCall[] = [];
  const handlers = new Map<FakeEvoRoute, FakeEvoHandler>(
    Object.entries(DEFAULT_HANDLERS) as [FakeEvoRoute, FakeEvoHandler][],
  );
  const sockets = new Set<Socket>();

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) chunks.push(chunk as Buffer);
    } catch {
      return; // the client went away while it was sending
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://fake-evolution");
    const method = req.method ?? "GET";
    const matched = ROUTES.find((r) => r.method === method && r.pattern.test(url.pathname));
    const segment = matched ? matched.pattern.exec(url.pathname)?.[1] : undefined;
    const call: FakeEvoCall = {
      route: matched?.route ?? null,
      method,
      path: url.pathname,
      instance: segment !== undefined ? decode(segment) : url.searchParams.get("instanceName"),
      query: Object.fromEntries(url.searchParams),
      body: text === "" ? undefined : parseJson(text),
      apikey: typeof req.headers.apikey === "string" ? req.headers.apikey : null,
    };
    calls.push(call);

    const handler = matched ? handlers.get(matched.route) : undefined;
    const reply: FakeEvoReply = handler
      ? await handler(call)
      : { status: 404, json: { status: 404, error: "Not Found", response: { message: ["Cannot " + method + " " + url.pathname] } } };
    if (reply === "drop") {
      req.socket.destroy();
      return;
    }
    if ("text" in reply) {
      res.writeHead(reply.status, { "Content-Type": "text/html" });
      res.end(reply.text);
      return;
    }
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(reply.json === undefined ? undefined : JSON.stringify(reply.json));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    calls,
    set: (route, answer) => {
      handlers.set(route, typeof answer === "function" ? answer : () => answer);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
