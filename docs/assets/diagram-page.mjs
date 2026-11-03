import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs";
import { enableDiagramZoom } from "./diagrams.mjs";

const diagrams = [...document.querySelectorAll("article pre.mermaid")];

for (const diagram of diagrams) {
  const hint = document.createElement("p");
  hint.className = "mermaid-hint";
  hint.textContent =
    "Fit width shows the whole diagram. Zoom in for detail; drag to pan when enlarged.";
  const panel = document.createElement("div");
  panel.className = "mermaid-outer";
  panel.tabIndex = 0;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Scrollable Mermaid diagram");
  diagram.replaceWith(hint, panel);
  panel.append(diagram);
}

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    fontFamily: '"DM Sans", system-ui, sans-serif',
    primaryColor: "#ffffff",
    primaryBorderColor: "#111111",
    primaryTextColor: "#111111",
    lineColor: "#111111",
    secondaryColor: "#c4b5fd",
    tertiaryColor: "#fafadf",
    clusterBkg: "#fafadf",
    clusterBorder: "#111111",
  },
});

for (const diagram of diagrams) {
  const source = diagram.textContent;
  try {
    await mermaid.run({ nodes: [diagram] });
    enableDiagramZoom(diagram);
  } catch (error) {
    const failure = document.createElement("pre");
    failure.className = "mermaid-error";
    failure.textContent = `[Diagram error: ${error.message}]\n\n${source}`;
    const panel = diagram.parentElement;
    panel.previousElementSibling?.remove();
    panel.replaceWith(failure);
  }
}
