/**
 * The IMAP servers of scripts/check-email-imap.ts, in loopback: a server that follows no protocol (listenScripted),
 * one that only greets and logs in (listenFakeImap) and a mailbox with a few e-mails (listenFakeMailbox). Real servers
 * can't be asked to drop a connection, hang or flood, and what imapflow does about it is not what it looks like, so
 * the checks run the code under test against these. They live outside the check script only to keep it readable.
 */
import net from "node:net";

/**
 * A plain-text IMAP server on loopback: counts its connections and keeps every byte its clients send. With
 * `loginOk` it lets any login through (and answers what a client asks right after it), so a test can see what
 * a connection asks for once it is logged in; it answers NO to everything else, COMPRESS included.
 */
export type FakeImap = { port: number; connections: () => number; received: () => string; close: () => Promise<void> };

export async function listenFakeImap(capabilities: string, opts: { loginOk?: boolean } = {}): Promise<FakeImap> {
  let connections = 0;
  let received = "";
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let pending = "";
    socket.write(`* OK [CAPABILITY ${capabilities}] fake IMAP ready\r\n`);
    socket.on("data", (chunk) => {
      const text = chunk.toString("latin1");
      received += text;
      pending += text;
      for (let end = pending.indexOf("\r\n"); end >= 0; end = pending.indexOf("\r\n")) {
        const [tag, command = ""] = pending.slice(0, end).split(" ");
        pending = pending.slice(end + 2);
        const word = command.toUpperCase();
        if (word === "CAPABILITY") socket.write(`* CAPABILITY ${capabilities}\r\n${tag} OK done\r\n`);
        else if (word === "ID") socket.write(`* ID NIL\r\n${tag} OK done\r\n`);
        else if (opts.loginOk && (word === "AUTHENTICATE" || word === "LOGIN")) socket.write(`${tag} OK logged in\r\n`);
        else if (opts.loginOk && word === "NAMESPACE") socket.write(`* NAMESPACE NIL NIL NIL\r\n${tag} OK done\r\n`);
        else if (opts.loginOk && word === "ENABLE") socket.write(`* ENABLED\r\n${tag} OK done\r\n`);
        else socket.write(`${tag} NO not here\r\n`);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: (server.address() as net.AddressInfo).port,
    connections: () => connections,
    received: () => received,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A server on loopback that runs `script` on every connection: for a hostile server that follows no protocol. */
export async function listenScripted(script: (socket: net.Socket) => void): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    script(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A command the fake mailbox received, and what it needs to answer it. */
export type FakeCommand = {
  /** Upper case, "UID" folded into the verb: "STATUS", "UID SEARCH", "FETCH", "UID FETCH", "UID STORE"... */
  name: string;
  line: string;
  tag: string;
  /** The message set the command names, for the ones that take one (FETCH, UID FETCH...). */
  set: string;
  /** The FETCH rows (without the tagged OK) the fake would send for the e-mails a message set names, as this command asks. */
  rows: (set: string) => string;
};

/** What a check wants to know of a fake mailbox once it was used: the server fills it in as it goes. */
export type FakeRecord = {
  /** Connections accepted. */
  connections: number;
  /** Every command line received, in order (the literal of an APPEND is not one). */
  lines: string[];
  /** The messages APPENDed: to which folder, with which flags (as written, `\Seen`), and the bytes. */
  appended: { destination: string; flags: string; bytes: Buffer }[];
};

export function newFakeRecord(): FakeRecord {
  return { connections: 0, lines: [], appended: [] };
}

export type FakeMailboxOptions = {
  /** Levels of the second e-mail's body structure (the first one's is a text and a PDF). */
  levels?: number;
  /** Takes over a command: true when it did (answered it its own way, hung on it or dropped the connection). */
  on?: (command: FakeCommand, socket: net.Socket) => boolean;
  /** The folders LIST names besides the INBOX, as a server writes them: `{ path: "INBOX.Sent", flags: "\\Sent" }`. */
  folders?: { path: string; flags?: string }[];
  /** The header block a FETCH of HEADER.FIELDS gets for an e-mail, in place of the built-in one (a Message-ID and, for the first, a References chain). */
  headerBlock?: (n: number) => string;
  /** Filled in as the server is used. */
  record?: FakeRecord;
};

/**
 * A plain-text IMAP server with an Inbox of two e-mails (UIDs 1 and 2, UIDVALIDITY 1000), "m1" and "m2". It answers what
 * imapflow sends to log in, open the Inbox, count, search, fetch and mark, with what is asked for: the first e-mail has a
 * PDF attached, the second's body structure is `levels` deep, and the source of each is a few lines of text. Each has a
 * Message-ID (`<m1@exemplo.com.br>`) and the first a References chain (`<raiz@exemplo.com.br> <meio@exemplo.com.br>`), for
 * the header block a FETCH of HEADER.FIELDS asks for. It lists the Inbox and the `folders` it was given, takes an APPEND
 * (answering with the UID it gets) and writes down what it was asked in `record`. A check that needs a server
 * misbehaving takes over the command it misbehaves on with `on`.
 */
export function listenFakeMailbox(options: FakeMailboxOptions = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const levels = options.levels ?? 2;
  const caps = "IMAP4rev1 AUTH=PLAIN SASL-IR ID NAMESPACE ENABLE";
  const leaf = '("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 8 1)';
  const pdf = '("APPLICATION" "PDF" ("NAME" "a.pdf") NIL NIL "BASE64" 100 NIL ("ATTACHMENT" ("FILENAME" "a.pdf")))';
  const structure = (n: number) => (n === 1 ? `(${leaf} ${pdf} "MIXED")` : `${"(".repeat(levels)}${leaf}${' "MIXED")'.repeat(levels)}`);
  const source = (n: number) => `From: Fulano <fulano@exemplo.com.br>\r\nSubject: m${n}\r\n\r\ncorpo da mensagem ${n}\r\n`;
  const envelope = (n: number) =>
    `("Mon, 26 Oct 2026 10:00:00 -0300" "m${n}" (("Fulano" NIL "fulano" "exemplo.com.br")) NIL NIL NIL NIL NIL NIL "<m${n}@exemplo.com.br>")`;
  const headerBlock = (n: number) =>
    options.headerBlock?.(n) ??
    `Message-ID: <m${n}@exemplo.com.br>\r\n${n === 1 ? "References: <raiz@exemplo.com.br>\r\n <meio@exemplo.com.br>\r\n" : ""}\r\n`;
  // The e-mails a message set names (1, 2, 1:*, 1,2), where "*" is the last one.
  const named = (set: string) =>
    [1, 2].filter((n) =>
      set.split(",").some((part) => {
        const [from, to = from] = part.split(":").map((end) => (end === "*" ? 2 : Number(end)));
        return n >= Math.min(from, to) && n <= Math.max(from, to);
      }),
    );
  const fetchRow = (n: number, asked: string) => {
    const items = [`UID ${n}`];
    if (/FLAGS/i.test(asked)) items.push("FLAGS ()");
    if (/INTERNALDATE/i.test(asked)) items.push('INTERNALDATE "26-Oct-2026 10:00:00 -0300"');
    if (/RFC822\.SIZE/i.test(asked)) items.push(`RFC822.SIZE ${source(n).length}`);
    if (/ENVELOPE/i.test(asked)) items.push(`ENVELOPE ${envelope(n)}`);
    if (/BODYSTRUCTURE/i.test(asked)) items.push(`BODYSTRUCTURE ${structure(n)}`);
    const body = /BODY(\.PEEK)?\[\]/i.test(asked) ? ` BODY[] {${source(n).length}}\r\n${source(n)}` : "";
    const fields = /BODY(?:\.PEEK)?\[HEADER\.FIELDS \(([^)]*)\)\]/i.exec(asked);
    const headers = fields ? ` BODY[HEADER.FIELDS (${fields[1]})] {${headerBlock(n).length}}\r\n${headerBlock(n)}` : "";
    return `* ${n} FETCH (${items.join(" ")}${body}${headers})\r\n`;
  };
  const folderLines = [{ path: "INBOX", flags: undefined as string | undefined }, ...(options.folders ?? [])]
    .map(({ path, flags }) => `* LIST (\\HasNoChildren${flags ? ` ${flags}` : ""}) "." "${path}"\r\n`)
    .join("");
  return listenScripted((socket) => {
    let pending = "";
    // An APPEND announces its message as a literal: that many bytes follow its continuation, whatever they contain.
    let literal: { tag: string; destination: string; flags: string; left: number; chunks: string[] } | null = null;
    // What follows the literal on the wire is the end of the APPEND command line, which is empty.
    let endOfAppendLine = false;
    if (options.record) options.record.connections++;
    socket.write(`* OK [CAPABILITY ${caps}] fake IMAP ready\r\n`);

    const onLine = (line: string) => {
      options.record?.lines.push(line);
      const [tag, command = "", second = "", third = ""] = line.split(" ");
      const word = command.toUpperCase();
      const name = word === "UID" ? `UID ${second.toUpperCase()}` : word;
      const set = word === "UID" ? third : second;
      const rows = (wanted: string) => named(wanted).map((n) => fetchRow(n, line)).join("");
      if (options.on?.({ name, line, tag, set, rows }, socket)) return;
      if (name === "CAPABILITY") socket.write(`* CAPABILITY ${caps}\r\n${tag} OK done\r\n`);
      else if (name === "ID") socket.write(`* ID NIL\r\n${tag} OK done\r\n`);
      else if (name === "AUTHENTICATE" || name === "LOGIN") socket.write(`${tag} OK logged in\r\n`);
      else if (name === "NAMESPACE") socket.write(`* NAMESPACE NIL NIL NIL\r\n${tag} OK done\r\n`);
      else if (name === "ENABLE") socket.write(`* ENABLED\r\n${tag} OK done\r\n`);
      else if (name === "LIST") socket.write(`${folderLines}${tag} OK done\r\n`);
      else if (name === "SELECT") {
        socket.write(
          `* FLAGS (\\Seen \\Answered)\r\n* 2 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 1000] ok\r\n* OK [UIDNEXT 3] ok\r\n${tag} OK [READ-WRITE] SELECT completed\r\n`,
        );
      } else if (name === "STATUS") socket.write(`* STATUS INBOX (UNSEEN 2)\r\n${tag} OK done\r\n`);
      else if (name === "UID SEARCH") socket.write(`* SEARCH 1 2\r\n${tag} OK done\r\n`);
      else if (name === "FETCH" || name === "UID FETCH") socket.write(`${rows(set)}${tag} OK done\r\n`);
      else if (name === "UID STORE") socket.write(`* 1 FETCH (UID 1 FLAGS (\\Seen))\r\n${tag} OK done\r\n`);
      else if (name === "APPEND") {
        // tag APPEND <folder> [(<flags>)] [<date>] {<size>}
        const parts = /^\S+ APPEND (?:"([^"]*)"|(\S+))(?: \(([^)]*)\))?(?: "[^"]*")? \{(\d+)\+?\}$/i.exec(line);
        if (!parts) socket.write(`${tag} BAD cannot read this APPEND\r\n`);
        else {
          literal = { tag, destination: parts[1] ?? parts[2], flags: parts[3] ?? "", left: Number(parts[4]), chunks: [] };
          socket.write("+ Ready for literal data\r\n");
        }
      } else if (name === "NOOP") socket.write(`${tag} OK done\r\n`);
      else if (name === "LOGOUT") socket.write(`* BYE bye\r\n${tag} OK done\r\n`);
      else socket.write(`${tag} NO not here\r\n`);
    };

    socket.on("data", (chunk) => {
      pending += chunk.toString("latin1");
      for (;;) {
        if (literal) {
          const take = pending.slice(0, literal.left);
          literal.chunks.push(take);
          literal.left -= take.length;
          pending = pending.slice(take.length);
          if (literal.left > 0) return;
          const { tag, destination, flags, chunks } = literal;
          literal = null;
          endOfAppendLine = true;
          options.record?.appended.push({ destination, flags, bytes: Buffer.from(chunks.join(""), "latin1") });
          const uid = (options.record?.appended.length ?? 0) + 100;
          socket.write(`${tag} OK [APPENDUID 1000 ${uid}] APPEND completed\r\n`);
        }
        const end = pending.indexOf("\r\n");
        if (end < 0) return;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (endOfAppendLine) {
          endOfAppendLine = false;
          if (line === "") continue;
        }
        onLine(line);
      }
    });
  });
}
