import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  makePinnedDispatcher,
  type PinnedRequestInit,
  pinnedConnectOptions,
  pinnedDispatcherFor,
  resolveAndPin,
} from "./pinned-fetch.ts";
import type { LookupFn } from "./ssrf.ts";

/**
 * Specs for the DNS-rebinding pin. The kill-shot binds a REAL loopback http server and
 * proves the pinned dispatcher connects to the pinned address rather than to whatever the
 * URL's hostname would really resolve to — with the original Host header intact. The rest
 * are pure units over a fake LookupFn, so these specs make ZERO real DNS or external calls.
 */

/** A one-address fake resolver. */
const one = (address: string, family = 4): LookupFn => async () => [{ address, family }];

describe("makePinnedDispatcher — the rebinding kill-shot", () => {
  let server: Server;
  let port: number;
  const hits: Array<{ url: string; host: string | undefined }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push({ url: req.url ?? "", host: req.headers.host });
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><title>pinned</title></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("connects to the PINNED ip (ignoring real DNS) and preserves the Host header", async () => {
    // The URL says example.com; the pin says 127.0.0.1. If the socket honored the URL's
    // real DNS, our loopback server would never be contacted. It IS contacted -> the
    // dispatcher, not the resolver, decided the peer. That is exactly what closes the
    // rebinding window: fetch() no longer performs its own independent resolution.
    const dispatcher = makePinnedDispatcher({ hostname: "example.com", ip: "127.0.0.1" });
    try {
      const res = await fetch(`http://example.com:${port}/pinned-path`, {
        dispatcher,
      } satisfies PinnedRequestInit);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("pinned");
    } finally {
      await dispatcher.destroy();
    }

    expect(hits).toHaveLength(1);
    expect(hits[0]?.url).toBe("/pinned-path");
    // Host preservation: the origin server still sees the name it was addressed by, so
    // virtual-hosted sites keep working (pinning changes the peer, not the request).
    expect(hits[0]?.host).toBe(`example.com:${port}`);
  });
});

describe("pinnedConnectOptions", () => {
  it("presents the hostname as the TLS servername (SNI survives pinning)", () => {
    // A real-TLS handshake would need a checked-in cert/key, so the SNI contract is
    // asserted on the connect options undici is built from (unit level).
    expect(pinnedConnectOptions({ hostname: "example.com", ip: "93.184.216.34" }).servername).toBe(
      "example.com",
    );
  });

  it("hands undici the pinned address for BOTH lookup callback shapes", () => {
    const { lookup } = pinnedConnectOptions({ hostname: "example.com", ip: "93.184.216.34" });

    // Node's autoSelectFamily path asks for `all` and wants an address array.
    const all = vi.fn();
    lookup("example.com", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);

    // The classic single-address shape: (err, address, family).
    const single = vi.fn();
    lookup("example.com", {}, single);
    expect(single).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  it("fails CLOSED rather than letting a non-IP pin reach the real resolver", () => {
    const { lookup } = pinnedConnectOptions({ hostname: "example.com", ip: "not-an-ip" });
    const cb = vi.fn();
    lookup("example.com", { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error), []);
  });

  it("reports family 6 for an IPv6 pin", () => {
    const { lookup } = pinnedConnectOptions({ hostname: "example.com", ip: "2606:4700::1111" });
    const cb = vi.fn();
    lookup("example.com", { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [{ address: "2606:4700::1111", family: 6 }]);
  });
});

describe("resolveAndPin", () => {
  it("pins the FIRST validated address and resolves EXACTLY ONCE", async () => {
    const lookup = vi.fn<LookupFn>(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "8.8.8.8", family: 4 },
    ]);
    const result = await resolveAndPin("https://example.com/a", lookup);
    expect(result).toEqual({ ip: "93.184.216.34" });
    // One resolution, full stop. A second lookup is the rebinding window itself.
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("blocks a host that resolves to a non-public address, after ONE lookup", async () => {
    const lookup = vi.fn<LookupFn>(one("10.0.0.5"));
    const result = await resolveAndPin("https://intranet.example.com/a", lookup);
    expect(result).toEqual({ blocked: expect.stringMatching(/non-public address/i) });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("blocks when ANY resolved address is non-public (mixed answer)", async () => {
    const lookup = vi.fn<LookupFn>(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    expect(await resolveAndPin("https://mixed.example.com/a", lookup)).toEqual({
      blocked: expect.any(String),
    });
  });

  it("blocks a non-public NAME without spending a lookup", async () => {
    const lookup = vi.fn<LookupFn>(one("93.184.216.34"));
    const result = await resolveAndPin("http://foo.internal/a", lookup);
    expect(result).toEqual({ blocked: expect.any(String) });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("fails closed when the resolver throws", async () => {
    const lookup = vi.fn<LookupFn>(async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await resolveAndPin("https://broken.example.com/a", lookup)).toEqual({
      blocked: expect.any(String),
    });
  });

  it("blocks an unparseable URL without touching DNS", async () => {
    const lookup = vi.fn<LookupFn>(one("93.184.216.34"));
    expect(await resolveAndPin("not a url", lookup)).toEqual({ blocked: expect.any(String) });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("pins an IP-literal host to itself, with NO lookup (nothing to rebind)", async () => {
    // An IP-literal host makes fetch() perform no name resolution at all, so there is no
    // rebinding window to close and no admissibility call to make here — the callers'
    // existing gates own literals (see the module docstring).
    const lookup = vi.fn<LookupFn>(one("93.184.216.34"));
    expect(await resolveAndPin("http://127.0.0.1:8080/a", lookup)).toEqual({ ip: "127.0.0.1" });
    expect(await resolveAndPin("http://[::1]:8080/a", lookup)).toEqual({ ip: "::1" });
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("pinnedDispatcherFor", () => {
  it("returns a dispatcher for a host that validates public", async () => {
    const result = await pinnedDispatcherFor("https://example.com/a", one("93.184.216.34"));
    expect("dispatcher" in result).toBe(true);
    if ("dispatcher" in result) await result.dispatcher.destroy();
  });

  it("returns the blocked reason and NO dispatcher for a refused host", async () => {
    const result = await pinnedDispatcherFor("https://intranet.example.com/a", one("10.0.0.5"));
    expect("dispatcher" in result).toBe(false);
    expect(result).toEqual({ blocked: expect.any(String) });
  });
});
