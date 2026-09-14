import type { SceneImage } from "./sceneImage";

export type SceneExportFormat = "png" | "print";

/** Browser-only delivery; capture itself stays behind the scene's typed handle. */
export async function exportScene(
  format: SceneExportFormat,
  capture: () => Promise<SceneImage>,
): Promise<void> {
  const image = await capture();
  if (format === "png") {
    const link = document.createElement("a");
    link.href = image.dataUrl;
    link.download = `roofy-scene-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    link.click();
    return;
  }
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.id = "roofy-scene-print";
  dialog.setAttribute("aria-label", "Scene print preview");
  const style = document.createElement("style");
  style.textContent = `
    #roofy-scene-print{position:fixed;inset:0;margin:auto;width:min(1100px,95vw);max-height:92vh;padding:20px;border:0;background:#fff;color:#202820;font:14px system-ui;overflow:auto}
    #roofy-scene-print::backdrop{background:#0008}
    #roofy-scene-print button{padding:10px 16px;margin-right:8px;cursor:pointer;background:#e8ede1;color:#202820;border:0;font:inherit}
    #roofy-scene-print button:focus-visible{outline:2px solid #436e27;outline-offset:2px}
    #roofy-scene-print img{display:block;max-width:100%;height:auto;margin-top:16px}
    @media print{
      @page{size:landscape;margin:10mm}
      body > :not(#roofy-scene-print){display:none!important}
      #roofy-scene-print{position:static;width:100%;max-width:none;max-height:none;margin:0;padding:0;overflow:visible}
      #roofy-scene-print button,#roofy-scene-print p{display:none}
      #roofy-scene-print img{width:100%;height:175mm;margin:0;object-fit:contain;object-position:top left}
      #roofy-scene-print::backdrop{display:none}
    }`;
  const print = document.createElement("button");
  print.textContent = "Print / Save as PDF";
  print.disabled = true;
  print.onclick = () => window.print();
  const close = document.createElement("button");
  close.textContent = "Close preview";
  close.onclick = () => dialog.close();
  const hint = document.createElement("p");
  hint.textContent =
    "Choose Save as PDF in the print dialog to save a PDF copy.";
  const img = document.createElement("img");
  img.alt = "Captured Roofy scene with map attribution";
  img.onload = () => {
    print.disabled = false;
  };
  img.onerror = () => {
    hint.textContent =
      "The captured image could not be displayed. Close this preview and try again.";
  };
  img.src = image.dataUrl;
  dialog.append(style, print, close, hint, img);
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
}
