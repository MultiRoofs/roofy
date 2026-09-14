import {
  walkthroughStore,
  useWalkthroughStore,
} from "../../features/walkthrough/walkthroughStore";
import { useHeaderMenu } from "./useHeaderMenu";

export function WalkthroughHelp() {
  const menu = useHeaderMenu();
  const canResume = useWalkthroughStore((state) => state.canResume);
  const run = (resume: boolean) => {
    menu.setOpen(false);
    if (resume) walkthroughStore.getState().resume();
    else walkthroughStore.getState().start();
  };
  return (
    <div className="header-menu" ref={menu.rootRef}>
      <button
        type="button"
        className="tb-btn"
        ref={menu.triggerRef}
        aria-label="Walkthrough help"
        aria-expanded={menu.open}
        aria-haspopup="dialog"
        data-tooltip="Walkthrough help"
        onClick={() => menu.toggle()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16v1" />
        </svg>
      </button>
      {menu.open && (
        <div
          className="header-popover"
          role="dialog"
          aria-label="Walkthrough help"
        >
          {canResume && (
            <button
              className="menu-item"
              type="button"
              onClick={() => run(true)}
            >
              Resume walkthrough
            </button>
          )}
          <button
            className="menu-item"
            type="button"
            onClick={() => run(false)}
          >
            {canResume ? "Restart walkthrough" : "Start walkthrough"}
          </button>
        </div>
      )}
    </div>
  );
}
