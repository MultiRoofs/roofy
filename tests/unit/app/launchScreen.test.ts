import { afterEach, expect, it, vi } from "vitest";
import { revealAppAfterLaunch } from "../../../src/app/launchScreen";
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});
it("holds the launch screen for 2200ms after readiness, then reveals the app", () => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<div id="launch-screen"></div><div id="root" inert aria-hidden="true"></div>';
  revealAppAfterLaunch();
  vi.advanceTimersByTime(2199);
  expect(document.getElementById("root")?.hasAttribute("inert")).toBe(true);
  vi.advanceTimersByTime(1);
  expect(document.getElementById("root")?.hasAttribute("inert")).toBe(false);
  expect(document.getElementById("root")?.hasAttribute("aria-hidden")).toBe(
    false,
  );
  expect(
    document
      .getElementById("launch-screen")
      ?.classList.contains("launch-screen--leaving"),
  ).toBe(true);
  vi.advanceTimersByTime(180);
  expect(document.getElementById("launch-screen")).toBeNull();
});
it("cancels a discarded mount so StrictMode cannot reveal the app early", () => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<div id="launch-screen"></div><div id="root" inert></div>';
  const cancel = revealAppAfterLaunch();
  cancel();
  vi.runAllTimers();
  expect(document.getElementById("root")?.hasAttribute("inert")).toBe(true);
});
