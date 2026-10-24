/**
 * The families row's own geometry must WIN over `.layer-types-item`'s.
 *
 * The rows reuse `.layer-types-item` (the two blocks stack in the details panel
 * and have to read as one list), but a family row is not a label: it needs the
 * 8px control spacing `docs/ui-consistency.md` asks for and a default cursor,
 * because the checkbox, the state and two buttons each answer for themselves.
 *
 * `.layer-types-item` is declared LATER in `app.css` at equal specificity, so a
 * single-class `.layer-families-item` lost both declarations to source order
 * alone and the rows shipped at 0.35rem under a pointer — invisible to every
 * jsdom test, because jsdom applies no stylesheet. This suite reads the
 * stylesheet as TEXT and pins the two things that keep the rule alive: it is
 * spelt with both classes, and it is not written where the later block would
 * override it anyway.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// From the project root, not from `import.meta.url`: the jsdom environment
// serves modules over an http URL, so `new URL(…, import.meta.url)` is not a
// file path here.
const css = readFileSync(resolve(process.cwd(), "src/app/app.css"), "utf8");

describe("the families row's style", () => {
  it("is spelt with BOTH classes, so specificity decides rather than order", () => {
    expect(css).toContain(".layer-types-item.layer-families-item {");
    // The single-class spelling is exactly the bug: a plain
    // `.layer-families-item { … }` rule would tie with `.layer-types-item` and
    // lose to whichever comes last.
    expect(css).not.toMatch(/^\.layer-families-item\s*\{/m);
  });

  it("keeps the 8px row spacing and the non-label cursor the block exists for", () => {
    const rule = css.slice(
      css.indexOf(".layer-types-item.layer-families-item {"),
    );
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("gap: 8px");
    expect(body).toContain("cursor: default");
  });

  it("is declared after `.layer-types-item`, so the two read in stacking order", () => {
    expect(css.indexOf(".layer-types-item {")).toBeLessThan(
      css.indexOf(".layer-types-item.layer-families-item {"),
    );
  });
});
