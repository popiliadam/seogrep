import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount rendered React trees between tests so repeated render() calls in a
// single file do not accumulate in document.body (which would make getByText
// throw "multiple elements found").
afterEach(() => {
  cleanup();
});
