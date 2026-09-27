const minimumZoom = 1;
const maximumZoom = 200;
const zoomStep = 10;
const actions = new Set(["fit", "actual", "in", "out"]);

export function diagramZoom(action, naturalWidth, renderedWidth) {
  if (!Number.isFinite(naturalWidth) || naturalWidth <= 0)
    throw new RangeError("Diagram width must be positive and finite");
  if (!Number.isFinite(renderedWidth) || renderedWidth <= 0)
    throw new RangeError("Rendered width must be positive and finite");
  if (!actions.has(action)) throw new RangeError("Unknown diagram zoom action");
  if (action === "fit") return { width: "100%", label: "Fit" };

  const current = (renderedWidth / naturalWidth) * 100;
  const requested =
    action === "actual"
      ? 100
      : current + (action === "in" ? zoomStep : -zoomStep);
  const percent = Math.round(
    Math.max(minimumZoom, Math.min(maximumZoom, requested)),
  );
  return { width: `${(naturalWidth * percent) / 100}px`, label: `${percent}%` };
}

function enableDiagramPan(panel) {
  if (!panel?.classList.contains("mermaid-outer"))
    throw new Error("Pan requires a diagram scroll panel");
  if (typeof panel.setPointerCapture !== "function")
    throw new Error("Pan requires pointer capture support");

  let start = null;
  let dragged = false;

  panel.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || !event.isPrimary)
      return;
    if (event.target.closest("a, button")) return;
    if (panel.scrollWidth <= panel.clientWidth && panel.scrollHeight <= panel.clientHeight)
      return;

    start = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: panel.scrollLeft,
      top: panel.scrollTop,
    };
    dragged = false;
    panel.setPointerCapture(event.pointerId);
    panel.classList.add("is-panning");
    event.preventDefault();
  });

  panel.addEventListener("pointermove", (event) => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
    panel.scrollLeft = start.left - dx;
    panel.scrollTop = start.top - dy;
    event.preventDefault();
  });

  function endPan(event) {
    if (!start || event.pointerId !== start.id) return;
    start = null;
    panel.classList.remove("is-panning");
    if (panel.hasPointerCapture(event.pointerId))
      panel.releasePointerCapture(event.pointerId);
  }

  panel.addEventListener("pointerup", endPan);
  panel.addEventListener("pointercancel", (event) => {
    endPan(event);
    dragged = false;
  });
  panel.addEventListener("lostpointercapture", (event) => {
    if (!start) return;
    endPan(event);
    dragged = false;
  });
  panel.addEventListener("click", (event) => {
    if (!dragged) return;
    event.preventDefault();
    event.stopPropagation();
    dragged = false;
  }, true);
}

export function enableDiagramZoom(diagram) {
  const panel = diagram.parentElement;
  const svg = diagram.querySelector("svg");
  if (!panel?.classList.contains("mermaid-outer"))
    throw new Error("Diagram must belong to a scroll panel");
  if (!svg || !Number.isFinite(svg.viewBox.baseVal.width))
    throw new Error("Diagram must have an SVG viewBox");
  const naturalWidth = svg.viewBox.baseVal.width;
  const initial = diagramZoom("fit", naturalWidth, naturalWidth);

  const controls = document.createElement("div");
  controls.className = "mermaid-controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Diagram zoom");
  controls.innerHTML = `
    <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
    <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
    <button type="button" data-zoom="fit">Fit width</button>
    <button type="button" data-zoom="actual">100%</button>
    <output aria-live="polite" aria-label="Diagram zoom level">Fit</output>`;
  const status = controls.querySelector("output");
  svg.style.maxWidth = "none";
  panel.style.setProperty("--diagram-width", initial.width);
  panel.before(controls);
  enableDiagramPan(panel);

  // The toolbar owns its listener; no window listener or resize observer is needed.
  controls.addEventListener("click", function onZoom(event) {
    const button = event.target.closest("button[data-zoom]");
    if (!button) return;
    if (!controls.contains(button)) throw new Error("Unknown zoom control");
    if (!panel.contains(svg))
      throw new Error("Diagram is no longer in its panel");
    const layout = diagramZoom(
      button.dataset.zoom,
      naturalWidth,
      svg.getBoundingClientRect().width,
    );
    panel.style.setProperty("--diagram-width", layout.width);
    status.textContent = layout.label;
    if (button.dataset.zoom === "fit") panel.scrollLeft = 0;
  });
}
