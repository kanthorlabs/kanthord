import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount React trees between tests so the DOM never leaks across cases.
afterEach(() => {
  cleanup();
});

// jsdom lacks the pointer-capture / scroll / resize APIs that Radix UI
// (vendored shadcn Select, Dialog, etc.) calls during pointer interactions.
// Without these, user-event clicks on Radix portal items (e.g. SelectItem)
// throw or no-op in jsdom. Polyfill them so component tests can drive the
// vendored primitives the same way a real browser would. (Maintainer test
// infra — DESIGN §2 vendored primitives must be usable in the hermetic tests.)
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
