import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// next/font/google only works inside the Next.js compiler (it turns the call into
// self-hosted font CSS at build time). Under vitest it is a plain module with no
// runtime, so stub the two loaders we use to return inert class/variable handles.
vi.mock("next/font/google", () => ({
  Newsreader: () => ({ className: "font-newsreader", variable: "--font-newsreader" }),
  IBM_Plex_Mono: () => ({ className: "font-plex-mono", variable: "--font-plex-mono" }),
}));

// Unmount rendered React trees between tests so repeated render() calls in a
// single file do not accumulate in document.body (which would make getByText
// throw "multiple elements found").
afterEach(() => {
  cleanup();
});
