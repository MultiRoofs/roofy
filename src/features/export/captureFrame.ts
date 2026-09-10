/** Copies inside postRender, before WebGL may discard its drawing buffer. */
export function captureFrame<T>(source: {
  subscribe(callback: () => void): () => void;
  requestRender(): void;
  copy(): T;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(
          "The scene did not render. Try again when the view is ready.",
        ),
      );
    }, 5000);
    const clean = () => {
      clearTimeout(timer);
      unsubscribe();
    };
    try {
      unsubscribe = source.subscribe(() => {
        try {
          resolve(source.copy());
        } catch (error) {
          reject(error);
        } finally {
          clean();
        }
      });
      source.requestRender();
    } catch (error) {
      clean();
      reject(error);
    }
  });
}
