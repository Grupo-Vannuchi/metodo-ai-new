/**
 * Which addresses an SMTP account's server may resolve to (spec 2026-10-21,
 * 4.2). Whoever fills the form picks the host, so a name that lands on the
 * platform's own network (loopback, private ranges, the cloud metadata
 * address...) must never be dialed. Pure, but it needs node:net: the server and
 * check:email import it, the client does not.
 */
import { BlockList, isIP } from "node:net";

/**
 * IPv4 ranges that are not the public internet: "this" network, private,
 * shared (CGNAT), loopback, link-local (the cloud metadata address lives here),
 * protocol assignments, documentation, the deprecated 6to4 relay anycast,
 * benchmarking, multicast and reserved (which includes the broadcast address).
 */
const BLOCKED_IPV4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/**
 * The IPv6 side: unspecified, loopback, the transition ranges that embed an
 * IPv4 address (the deprecated IPv4-compatible ::/96, NAT64, Teredo and 6to4),
 * discard, documentation, unique-local, link-local, the deprecated site-local
 * and multicast.
 */
const BLOCKED_IPV6: readonly (readonly [string, number])[] = [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

const blocked = new BlockList();
for (const [network, prefix] of BLOCKED_IPV4) {
  blocked.addSubnet(network, prefix, "ipv4");
  // The same range as an IPv4-mapped IPv6 address (::ffff:a.b.c.d, in any notation): 96 bits of prefix, then the
  // IPv4 ones. So ::ffff:127.0.0.1 is judged by the 127.0.0.0/8 it carries, whatever the Node version does itself.
  blocked.addSubnet(`::ffff:${network}`, 96 + prefix, "ipv6");
}
for (const [network, prefix] of BLOCKED_IPV6) blocked.addSubnet(network, prefix, "ipv6");

/** Whether the server must refuse to connect to this IP. Anything that isn't a plain IP is refused. */
export function isBlockedSmtpAddress(ip: string): boolean {
  const family = isIP(ip);
  // Not an IP, or one with a zone id ("fe80::1%eth0", which BlockList.check() reads as "not blocked"): a scoped
  // address is never a public mail server.
  if (family === 0 || ip.includes("%")) return true;
  return blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * The address to connect to out of everything a name resolved to (what
 * `dns.lookup(host, { all: true })` returns; the family is read from the
 * address itself). One internal address is enough to refuse the name: a host
 * that also answers with the inner network can be steered there. Otherwise the
 * first IPv4 wins, then the first IPv6.
 */
export function pickSmtpAddress(
  list: { address: string; family: number }[],
): { ok: true; ip: string; family: 4 | 6 } | { ok: false; error: "host_not_found" | "host_not_allowed" } {
  if (list.length === 0) return { ok: false, error: "host_not_found" };
  if (list.some((entry) => isBlockedSmtpAddress(entry.address))) return { ok: false, error: "host_not_allowed" };
  const chosen = list.find((entry) => isIP(entry.address) === 4) ?? list[0];
  return { ok: true, ip: chosen.address, family: isIP(chosen.address) === 4 ? 4 : 6 };
}
