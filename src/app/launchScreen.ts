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
  }, 2200);
  return () => {
    clearTimeout(reveal);
    clearTimeout(removal);
  };
}
