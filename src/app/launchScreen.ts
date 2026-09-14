/** Called after React commits. The HTML launch screen also covers bundle loading. */
export function revealAppAfterLaunch(): () => void {
  let removal: ReturnType<typeof setTimeout> | undefined;
  const reveal = setTimeout(() => {
    const root = document.getElementById("root");
    const splash = document.getElementById("launch-screen");
    root?.removeAttribute("inert");
    root?.removeAttribute("aria-hidden");
    splash?.classList.add("launch-screen--leaving");
    removal = setTimeout(() => splash?.remove(), 180);
    // The center-out tagline finishes at 2.1 s, leaving 1.4 s to read it.
  }, 3500);
  return () => {
    clearTimeout(reveal);
    clearTimeout(removal);
  };
}
