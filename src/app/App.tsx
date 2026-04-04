import "./app.css";
import { CITYMODEL_ENCODING_PRIORITY } from "../domain/citymodel/supportedEncodings";

export function App() {
  return (
    <main className="app-shell">
      <div className="hero">
        <p className="eyebrow">MultiRoof Viewer</p>
        <h1>Rooftop analysis starts with a city-model-first foundation.</h1>
        <p className="summary">
          This repository is initialized for a browser-first viewer focused on
          visualization, rooftop analysis, solar exploration, and lightweight
          urban analytics.
        </p>
      </div>

      <section className="panel">
        <h2>Initial encoding priority</h2>
        <ol>
          {CITYMODEL_ENCODING_PRIORITY.map((encoding) => (
            <li key={encoding}>{encoding}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}

