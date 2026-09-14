/* Browser regression checks. Load Delft, select a building, open a scene
   sheet, then run: agent-browser eval --stdin < scripts/smoke/map-polish.js
   Repeat at 1440x900, 1280x720 and 1024x768, light/dark, drawer open/closed. */
(() => {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const rect = (element) => element.getBoundingClientRect();
  const overlaps = (a, b) => {
    const x = rect(a),
      y = rect(b);
    return (
      x.left < y.right &&
      x.right > y.left &&
      x.top < y.bottom &&
      x.bottom > y.top
    );
  };
  const shell = document.querySelector(".viewer-shell");
  if (!shell) throw new Error("Load the Delft sample first.");
  const fonts = new Set(
    [...shell.querySelectorAll("button, input, select, h3, .attr-value")].map(
      (element) => getComputedStyle(element).fontFamily,
    ),
  );
  check(
    fonts.size === 1 && [...fonts][0].includes("Source Sans 3"),
    "Workspace controls must consistently use Source Sans 3.",
  );
  const workspaceName = shell.querySelector(".workspace-name-btn");
  if (workspaceName) {
    const style = getComputedStyle(workspaceName);
    check(
      style.fontFamily.split(",")[0].replace(/["']/g, "").trim() ===
        "Source Sans 3" &&
        parseFloat(style.fontSize) === 14 &&
        style.fontWeight === "500",
      "Workspace name must retain the accepted Source Sans 3 typography.",
    );
  }
  const map = document.querySelector(".map-area");
  const camera = document.querySelector(".camera-cluster");
  const legend = document.querySelector(".legend-overlay");
  if (camera && legend)
    check(!overlaps(camera, legend), "Legend covers camera controls.");
  const select = document.querySelector(".select-mode-control");
  const triggers = document.querySelector(".scene-buttons__triggers");
  const search = document.querySelector(".address-search");
  if (search) {
    check(
      !overlaps(search, select),
      "Place search covers Feature/Surface selection.",
    );
    check(
      rect(search).height === 32 && rect(select).height === 32,
      "Search and selection must use matching 32px control heights.",
    );
    check(
      search.scrollWidth <= search.clientWidth,
      "Place search overflows horizontally.",
    );
  }

  check(
    !overlaps(select, triggers),
    "Scene triggers overlap the selection controls.",
  );
  const details = document.querySelector(".details-panel");
  if (details) {
    check(
      details.scrollWidth <= details.clientWidth,
      "Details overflow horizontally.",
    );
    check(
      getComputedStyle(details).backgroundColor !== "rgba(0, 0, 0, 0)",
      "Details need an opaque surface.",
    );
  }
  const sheet = document.querySelector(".map-sheet");
  if (sheet) {
    if (search)
      check(!overlaps(search, sheet), "Scene sheet covers place search.");
    const body = sheet.querySelector(".map-sheet__body");
    check(
      body.clientHeight >= 48,
      "The sheet body is clipped below a usable control height.",
    );
    check(
      body.scrollWidth <= body.clientWidth,
      "Sheet body overflows horizontally.",
    );
    check(
      sheet.parentElement.scrollHeight <= sheet.parentElement.clientHeight,
      "Sheet host introduces a second scroll container.",
    );
    check(!overlaps(sheet, camera), "Sheet covers camera controls.");
    check(
      rect(sheet).left >= rect(map).left &&
        rect(sheet).right <= rect(map).right,
      "Sheet escapes map column.",
    );
    const time = sheet.querySelector("input[type=time]");
    if (time)
      check(
        parseFloat(getComputedStyle(time).fontSize) <= 14,
        "Time field is oversized.",
      );
    const expectedScheme = document.documentElement.dataset.theme;
    check(
      getComputedStyle(sheet).colorScheme === expectedScheme,
      "Native date/time controls do not follow the theme.",
    );
  }
  if (failures.length) throw new Error(failures.join("\n"));
  return {
    passed: true,
    viewport: [innerWidth, innerHeight],
    theme: document.documentElement.dataset.theme,
    details: Boolean(details),
    sheet: Boolean(sheet),
  };
})();
