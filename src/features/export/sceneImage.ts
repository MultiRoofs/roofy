/** A scene raster; DOM controls are deliberately outside the image. */
export interface SceneImage {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

export function copySceneImage(
  canvas: HTMLCanvasElement,
  credits: readonly string[],
): SceneImage {
  if (!canvas.width || !canvas.height)
    throw new Error("The scene is not ready to capture.");
  const output = document.createElement("canvas");
  const context = output.getContext("2d");
  if (!context) throw new Error("Image export is unavailable in this browser.");
  const fontSize = Math.max(12, Math.round(canvas.width / 120));
  context.font = `${fontSize}px sans-serif`;
  const lines: string[] = [];
  const maxWidth = Math.max(1, canvas.width - 24);
  // Wrap by character as well as word so long provider URLs cannot be clipped.
  for (const credit of ["Roofy · Current scene", ...credits]) {
    let line = "";
    for (const char of credit) {
      if (line && context.measureText(line + char).width > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    if (line) lines.push(line);
  }
  output.width = canvas.width;
  output.height = canvas.height + 24 + lines.length * (fontSize + 4);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(canvas, 0, 0);
  context.font = `${fontSize}px sans-serif`;
  context.fillStyle = "#263020";
  lines.forEach((line, index) =>
    context.fillText(line, 12, canvas.height + 18 + index * (fontSize + 4)),
  );
  return {
    dataUrl: output.toDataURL("image/png"),
    width: output.width,
    height: output.height,
  };
}
