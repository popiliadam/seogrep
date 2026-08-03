import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DISPOSABLE_EMAIL_DOMAINS,
  DOT_INSENSITIVE_DOMAINS,
  isDisposableEmailDomain,
  trialEmailIdentity,
} from "./trial-identity.js";

/**
 * The normaliser's job is to answer ONE question: do two signup addresses reach the same
 * real mailbox? Every rule is therefore tested in BOTH directions —
 *   * the merge direction  (aliases of one mailbox collapse to one fingerprint), and
 *   * the FALSE-POSITIVE direction (addresses belonging to two different real people do
 *     NOT collapse), which is the direction that costs a legitimate user their advertised
 *     trial and so gets the larger half of this file.
 */

function fp(email: string): string {
  const identity = trialEmailIdentity(email);
  if (!identity) throw new Error(`expected a parseable address: ${email}`);
  return identity.fingerprint;
}

describe("trialEmailIdentity — the merge direction (aliases of ONE mailbox)", () => {
  it("folds case (measured: GoTrue stores the address lowercased, so case cannot make two accounts)", () => {
    expect(fp("Person@Example.com")).toBe(fp("person@example.com"));
    expect(fp("PERSON@EXAMPLE.COM")).toBe(fp("person@example.com"));
  });

  it("strips a plus-alias (RFC 5233 sub-addressing) on any provider", () => {
    expect(fp("person+free2@example.com")).toBe(fp("person@example.com"));
    expect(fp("person+a+b+c@fastmail.com")).toBe(fp("person@fastmail.com"));
  });

  it("ignores dots on gmail — and gmail is where dots are actually insensitive", () => {
    expect(fp("john.smith@gmail.com")).toBe(fp("johnsmith@gmail.com"));
    expect(fp("j.o.h.n.s.m.i.t.h@gmail.com")).toBe(fp("johnsmith@gmail.com"));
  });

  it("treats googlemail.com as gmail.com (Google's documented alias domain)", () => {
    expect(fp("johnsmith@googlemail.com")).toBe(fp("johnsmith@gmail.com"));
    expect(fp("john.smith+x@googlemail.com")).toBe(fp("johnsmith@gmail.com"));
  });

  it("collapses the full farming pattern to a single fingerprint", () => {
    const one = fp("victim@gmail.com");
    for (const alias of [
      "Victim@Gmail.com",
      "v.i.c.t.i.m@gmail.com",
      "victim+1@gmail.com",
      "victim+2@googlemail.com",
      "V.icti.m+99@GoogleMail.COM",
      "victim@gmail.com.", // FQDN root form of the same domain
    ]) {
      expect(fp(alias)).toBe(one);
    }
  });
});

describe("trialEmailIdentity — the FALSE-POSITIVE direction (two DIFFERENT real people)", () => {
  it("keeps dots SIGNIFICANT on non-gmail providers (the over-normalisation trap)", () => {
    // john.smith@ and johnsmith@ are two different mailboxes almost everywhere. Merging
    // them would deny the second person the trial they were advertised.
    for (const domain of ["outlook.com", "hotmail.com", "yahoo.com", "fastmail.com", "acme.co"]) {
      expect(fp(`john.smith@${domain}`)).not.toBe(fp(`johnsmith@${domain}`));
    }
  });

  it("does not merge the Microsoft domains with each other (separate namespaces)", () => {
    expect(fp("person@hotmail.com")).not.toBe(fp("person@outlook.com"));
    expect(fp("person@outlook.com")).not.toBe(fp("person@live.com"));
  });

  it("does not strip a hyphen suffix (a hyphen is far likelier to be part of a real name)", () => {
    expect(fp("mary-jane@yahoo.com")).not.toBe(fp("mary@yahoo.com"));
  });

  it("does not collapse every +tag address on a domain into one identity", () => {
    // Stripping would empty the local part, so the original is kept instead.
    expect(fp("+alpha@example.com")).not.toBe(fp("+beta@example.com"));
  });

  it("does not collapse an all-dots gmail local part", () => {
    expect(fp("...@gmail.com")).not.toBe(fp("....@gmail.com"));
  });

  it("leaves a QUOTED local part literal (quoting means the characters are not special)", () => {
    expect(fp('"john.smith"@gmail.com')).not.toBe(fp('"johnsmith"@gmail.com'));
    expect(fp('"a+b"@example.com')).not.toBe(fp('"a"@example.com'));
  });

  it("splits on the LAST @, so a quoted local part containing @ stays intact", () => {
    const identity = trialEmailIdentity('"weird@local"@example.com');
    expect(identity?.domain).toBe("example.com");
    expect(identity?.localPart).toBe('"weird@local"');
  });

  it("keeps different domains apart even when the local parts match", () => {
    expect(fp("person@example.com")).not.toBe(fp("person@example.org"));
  });
});

describe("trialEmailIdentity — shape, determinism and unparseable input", () => {
  it("produces a stable 64-char hex fingerprint suitable for storage", () => {
    const identity = trialEmailIdentity("person@example.com");
    expect(identity?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(identity?.canonical).toBe("person@example.com");
    expect(trialEmailIdentity("person@example.com")?.fingerprint).toBe(identity?.fingerprint);
  });

  it("returns null for anything that is not a parseable address (fail OPEN, never deny)", () => {
    for (const bad of ["", "   ", "no-at-sign", "@example.com", "person@", "person@   ", "  @  "]) {
      expect(trialEmailIdentity(bad)).toBeNull();
    }
  });

  it("trims surrounding whitespace", () => {
    expect(fp("  person@example.com \n")).toBe(fp("person@example.com"));
  });

  it("is idempotent: normalising an already-canonical address changes nothing", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9.+_-]{1,24}$/),
        fc.constantFrom("gmail.com", "googlemail.com", "outlook.com", "acme.co", "Example.COM"),
        (local, domain) => {
          const first = trialEmailIdentity(`${local}@${domain}`);
          if (!first) return; // unparseable inputs are covered above
          const second = trialEmailIdentity(first.canonical);
          expect(second?.canonical).toBe(first.canonical);
          expect(second?.fingerprint).toBe(first.fingerprint);
        },
      ),
    );
  });
});

describe("isDisposableEmailDomain — a SIGNAL, never a gate", () => {
  it("flags curated throwaway providers", () => {
    expect(isDisposableEmailDomain("mailinator.com")).toBe(true);
    expect(isDisposableEmailDomain("guerrillamail.com")).toBe(true);
  });

  it("flags subdomains, which are how several of these providers hand out inboxes", () => {
    expect(isDisposableEmailDomain("anything.mailinator.com")).toBe(true);
    expect(isDisposableEmailDomain("a.b.mailinator.com")).toBe(true);
  });

  it("does not flag a domain that merely ENDS with a listed one", () => {
    expect(isDisposableEmailDomain("notmailinator.com")).toBe(false);
    expect(isDisposableEmailDomain("mailinator.com.evil.co")).toBe(false);
  });

  it("does not flag real providers", () => {
    for (const domain of ["gmail.com", "outlook.com", "acme.co", "proton.me"]) {
      expect(isDisposableEmailDomain(domain)).toBe(false);
    }
  });

  it("still returns a full identity for a disposable address — the trial is NOT withheld", () => {
    const identity = trialEmailIdentity("throwaway@mailinator.com");
    expect(identity).not.toBeNull();
    expect(identity?.disposableDomain).toBe(true);
    expect(identity?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the curated list lowercase, de-duplicated and free of dot-insensitive providers", () => {
    const list = [...DISPOSABLE_EMAIL_DOMAINS];
    expect(list).toEqual(list.map((d) => d.toLowerCase()));
    expect(new Set(list).size).toBe(list.length);
    for (const real of DOT_INSENSITIVE_DOMAINS) expect(list).not.toContain(real);
  });
});
