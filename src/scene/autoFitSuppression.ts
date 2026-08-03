/**
 * Restore-scoped suppression of the viewport's automatic fit-on-layer-add.
 *
 * `NavaraViewport` frames the scene whenever a NEW layer appears — the right
 * behaviour when a user opens a file, and the only thing that stops a `.fcb`
 * opened as the first layer from sitting on a whole-globe camera forever.
 *
 * A RESTORE, though, is nothing but new layers arriving, and it carries its
 * OWN camera. That makes the fit exactly wrong: it races the restore's
 * `setCameraState` and, whenever it lands second, silently replaces the
 * viewpoint the user saved. Task C26's browser smoke caught this — two
 * snapshots whose saved cameras were 65° of longitude and 2 km of altitude
 * apart both restored to a camera identical to 15 significant digits, because
 * neither saved camera was ever really applied: the fit was.
 *
 * ## Why module scope rather than a `CitySceneHandle` method
 *
 * Because of WHEN a restore needs this. A restore runs from the LANDING page:
 * there is no viewport, and therefore no handle, until the first restored
 * layer lands. A handle-bound API could only be awaited *after* the layer adds
 * it is supposed to be wrapping — that is, after the very fit it exists to
 * suppress, and `awaitSceneHandle()` would deadlock waiting for a viewport
 * that only mounts once those layers exist. The suppression therefore has to
 * pre-date, and outlive, any one viewport instance. Exactly one viewport is
 * mounted at a time, so a single module-level depth is unambiguous.
 *
 * ## Why a counter rather than a boolean
 *
 * So that overlapping restores cannot have the inner one's exit re-enable
 * fitting while the outer is still adding layers.
 */
let suppressionDepth = 0;

/**
 * Suppress the viewport's automatic fit-on-layer-add until the returned
 * release is called.
 *
 * Open the scope around the WHOLE restore — the layer adds *and* the camera
 * set — so the restored camera is the last thing to touch the view. Suppressed
 * fits are dropped, not queued: a restore that has supplied its own camera
 * never wants a deferred fit arriving afterwards.
 *
 * Call the release from a `finally`, so a restore that throws part-way cannot
 * leave auto-fit disabled for the rest of the session. The release is
 * idempotent, so calling it twice cannot un-suppress somebody else's scope.
 */
export function suppressAutoFit(): () => void {
  suppressionDepth++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suppressionDepth--;
  };
}

/** True while a {@link runWithoutAutoFit} scope is open. */
export function isAutoFitSuppressed(): boolean {
  return suppressionDepth > 0;
}
