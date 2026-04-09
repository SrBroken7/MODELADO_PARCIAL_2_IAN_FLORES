export type PipelineMode = "gouraud" | "phong" | "normals" | "wireframe" | "depth" | "texture" | "uv";

export type TransformState = {
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
};

export type MaterialState = {
  ambient: number;
  diffuse: number;
  specular: number;
  shininess: number;
  objectColor: string;
  useTexture: boolean;
};

export type SceneItem = {
  id: number;
  label: string;
};

export const gui = {
  pipelineMode: "phong" as PipelineMode,
  lightColor: "#ffffff",
  wireColor: "#ffffff",
  wireIntensity: 1.0,
  wireOpacity: 1.0,
  wireThickness: 1.0,
  wireHiddenSurface: true,
};

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

function slider(id: string, label: string, min: number, max: number, step: number, val: number) {
  return `
  <div class="slider-row">
    <span class="slider-label">${label}</span>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
    <span class="slider-val" id="${id}-val">${val}</span>
  </div>`;
}

export function initGUI(callbacks: {
  onAddSphere: () => void;
  onAddCube: () => void;
  onAddObjFile: (file: File) => void;
  onSelectObject: (id: number) => void;
  onDeselect: () => void;
  onRemoveSelected: () => void;
  onResetArcball: () => void;
  onTransformChange: (patch: Partial<TransformState>) => void;
  onMaterialChange: (patch: Partial<MaterialState>) => void;
  onTextureFile: (file: File) => void;
  onPipelineMode: (mode: PipelineMode) => void;
}) {
  const root = document.createElement("div");
  root.id = "gui-root";
  root.innerHTML = `
  <div class="gui-column left">
    <div class="gui-panel">
      <div class="gui-title">SCENE</div>

      <div id="scene-list" class="scene-list"></div>

      <div class="model-btns">
        <button id="deselect-btn" class="render-btn">Deselect</button>
      </div>
      <div class="model-btns">
        <button id="remove-btn" class="danger-btn">Remove</button>
      </div>

      <div class="model-desc" id="selection-hint">No selection -- camera orbit mode</div>

      <div class="gui-section">
        <div class="gui-label">Transform</div>
        ${slider("tx", "Translate X", -12, 12, 0.1, 0)}
        ${slider("ty", "Translate Y", -12, 12, 0.1, 0)}
        ${slider("tz", "Translate Z", -12, 12, 0.1, 0)}
        ${slider("rx", "Rotate X", -180, 180, 1, 0)}
        ${slider("ry", "Rotate Y", -180, 180, 1, 0)}
        ${slider("rz", "Rotate Z", -180, 180, 1, 0)}
        ${slider("sx", "Scale X", 0.1, 5, 0.1, 1)}
        ${slider("sy", "Scale Y", 0.1, 5, 0.1, 1)}
        ${slider("sz", "Scale Z", 0.1, 5, 0.1, 1)}
      </div>

      <div class="gui-section">
        <div class="gui-label">Material</div>
        ${slider("ambient", "Ambient (Ka)", 0, 1, 0.01, 0.12)}
        ${slider("diffuse", "Diffuse (Kd)", 0, 1, 0.01, 0.75)}
        ${slider("specular", "Specular (Ks)", 0, 1, 0.01, 0.55)}
        ${slider("shininess", "Shininess (n)", 1, 256, 1, 48)}
        <div class="color-row"><span>Object color</span><input type="color" id="objectColor" value="#4a9eff"></div>
      </div>

      <div class="gui-section">
        <div class="gui-label">Texture (Spherical UV)</div>
        <input id="texture-file" type="file" accept="image/*" class="file-input">
        <label class="checkbox-row">
          <input type="checkbox" id="useTexture"> Use texture
        </label>
      </div>
    </div>
  </div>

  <div class="gui-column right">
    <div class="gui-panel">
      <div class="gui-title">PIPELINE</div>

      <div class="gui-section">
        <div class="gui-label">Add Object</div>
        <div class="model-btns">
          <button id="add-sphere" class="mesh-btn">Sphere</button>
          <button id="add-cube" class="mesh-btn">Cube</button>
        </div>
      </div>

      <div class="gui-section">
        <div class="gui-label">Add OBJ Model</div>
        <input id="obj-file" type="file" accept=".obj" class="file-input">
      </div>

      <div class="gui-section">
        <div class="gui-label">Render Mode (Global)</div>
        <div class="model-btns" id="pipeline-mode-buttons">
          <button class="model-btn" data-mode="gouraud">Gouraud</button>
          <button class="model-btn active" data-mode="phong">Phong</button>
          <button class="model-btn" data-mode="normals">Normals</button>
          <button class="model-btn" data-mode="wireframe">Wireframe</button>
          <button class="model-btn" data-mode="depth">Depth</button>
          <button class="model-btn" data-mode="texture">Texture</button>
          <button class="model-btn" data-mode="uv">UV Coords</button>
        </div>
        <div class="model-desc" id="pipeline-desc">Phong: normals interpolated per fragment, lighting per pixel.</div>
      </div>

      <div class="gui-section">
        <div class="gui-label">Global Light Color</div>
        <div class="color-row"><span>Light</span><input type="color" id="lightColor" value="#ffffff"></div>
      </div>

      <div class="gui-section">
        <div class="gui-label">Wireframe</div>
        <div class="color-row"><span>Line</span><input type="color" id="wireColor" value="#ffffff"></div>
        ${slider("wireIntensity", "Intensity", 0.1, 2.0, 0.05, 1.0)}
        ${slider("wireOpacity", "Opacity", 0.1, 1.0, 0.05, 1.0)}
        ${slider("wireThickness", "Thickness", 1.0, 8.0, 0.5, 1.0)}
        <label class="checkbox-row">
          <input type="checkbox" id="wireHiddenSurface" checked> Hidden-surface removal
        </label>
      </div>

      <button id="resetArcball" class="reset-btn">Reset Arcball</button>
      <div class="gui-hint">No selection: drag orbits camera · Object selected: drag rotates object · Scroll: zoom toward target</div>
    </div>
  </div>`;

  document.body.appendChild(root);

  const sceneListEl = document.getElementById("scene-list") as HTMLDivElement;
  const selectionHintEl = document.getElementById("selection-hint") as HTMLDivElement;

  const pipelineDesc: Record<PipelineMode, string> = {
    gouraud: "Gouraud: lighting per vertex, interpolated over each triangle.",
    phong: "Phong: normals interpolated per fragment, lighting per pixel.",
    normals: "Normals: visualize transformed normals in RGB.",
    wireframe: "Wireframe: edge rendering with optional hidden surface removal.",
    depth: "Depth: grayscale depth visualization relative to camera.",
    texture: "Texture: texture-only view using spherical UV mapping.",
    uv: "UV Coords: displays UV as color gradients.",
  };

  function bindSlider(id: string, onValue: (v: number) => void) {
    const el = document.getElementById(id) as HTMLInputElement;
    const valEl = document.getElementById(`${id}-val`) as HTMLSpanElement;
    el.addEventListener("input", () => {
      const v = parseFloat(el.value);
      valEl.textContent = el.value;
      onValue(v);
    });
  }

  (document.getElementById("add-sphere") as HTMLButtonElement).addEventListener("click", callbacks.onAddSphere);
  (document.getElementById("add-cube") as HTMLButtonElement).addEventListener("click", callbacks.onAddCube);
  (document.getElementById("deselect-btn") as HTMLButtonElement).addEventListener("click", callbacks.onDeselect);
  (document.getElementById("remove-btn") as HTMLButtonElement).addEventListener("click", callbacks.onRemoveSelected);
  (document.getElementById("resetArcball") as HTMLButtonElement).addEventListener("click", callbacks.onResetArcball);

  (document.getElementById("obj-file") as HTMLInputElement).addEventListener("change", e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) callbacks.onAddObjFile(file);
  });

  (document.getElementById("texture-file") as HTMLInputElement).addEventListener("change", e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) callbacks.onTextureFile(file);
  });

  bindSlider("tx", v => callbacks.onTransformChange({ tx: v }));
  bindSlider("ty", v => callbacks.onTransformChange({ ty: v }));
  bindSlider("tz", v => callbacks.onTransformChange({ tz: v }));
  bindSlider("rx", v => callbacks.onTransformChange({ rx: v }));
  bindSlider("ry", v => callbacks.onTransformChange({ ry: v }));
  bindSlider("rz", v => callbacks.onTransformChange({ rz: v }));
  bindSlider("sx", v => callbacks.onTransformChange({ sx: v }));
  bindSlider("sy", v => callbacks.onTransformChange({ sy: v }));
  bindSlider("sz", v => callbacks.onTransformChange({ sz: v }));

  bindSlider("ambient", v => callbacks.onMaterialChange({ ambient: v }));
  bindSlider("diffuse", v => callbacks.onMaterialChange({ diffuse: v }));
  bindSlider("specular", v => callbacks.onMaterialChange({ specular: v }));
  bindSlider("shininess", v => callbacks.onMaterialChange({ shininess: v }));

  bindSlider("wireIntensity", v => { gui.wireIntensity = v; });
  bindSlider("wireOpacity", v => { gui.wireOpacity = v; });
  bindSlider("wireThickness", v => { gui.wireThickness = v; });

  (document.getElementById("objectColor") as HTMLInputElement)
    .addEventListener("input", e => callbacks.onMaterialChange({ objectColor: (e.target as HTMLInputElement).value }));

  (document.getElementById("useTexture") as HTMLInputElement)
    .addEventListener("change", e => callbacks.onMaterialChange({ useTexture: (e.target as HTMLInputElement).checked }));

  (document.getElementById("lightColor") as HTMLInputElement)
    .addEventListener("input", e => { gui.lightColor = (e.target as HTMLInputElement).value; });

  (document.getElementById("wireColor") as HTMLInputElement)
    .addEventListener("input", e => { gui.wireColor = (e.target as HTMLInputElement).value; });

  (document.getElementById("wireHiddenSurface") as HTMLInputElement)
    .addEventListener("change", e => { gui.wireHiddenSurface = (e.target as HTMLInputElement).checked; });

  document.querySelectorAll<HTMLButtonElement>("#pipeline-mode-buttons .model-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode as PipelineMode;
      gui.pipelineMode = mode;
      document.querySelectorAll("#pipeline-mode-buttons .model-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      (document.getElementById("pipeline-desc") as HTMLDivElement).textContent = pipelineDesc[mode];
      callbacks.onPipelineMode(mode);
    });
  });

  function setSlider(id: string, v: number) {
    const el = document.getElementById(id) as HTMLInputElement;
    const valEl = document.getElementById(`${id}-val`) as HTMLSpanElement;
    el.value = String(v);
    valEl.textContent = String(v);
  }

  function setSelectionEnabled(enabled: boolean) {
    const ids = [
      "tx", "ty", "tz", "rx", "ry", "rz", "sx", "sy", "sz",
      "ambient", "diffuse", "specular", "shininess", "objectColor", "useTexture", "texture-file",
    ];
    for (const id of ids) {
      const el = document.getElementById(id) as HTMLInputElement;
      el.disabled = !enabled;
    }
  }

  return {
    updateScene(items: SceneItem[], selectedId: number | null) {
      sceneListEl.innerHTML = "";
      for (const item of items) {
        const b = document.createElement("button");
        b.className = `scene-item-btn ${selectedId === item.id ? "active" : ""}`;
        b.textContent = item.label;
        b.addEventListener("click", () => callbacks.onSelectObject(item.id));
        sceneListEl.appendChild(b);
      }
    },
    updateSelection(transform: TransformState | null, material: MaterialState | null) {
      const has = !!transform && !!material;
      setSelectionEnabled(has);
      selectionHintEl.textContent = has
        ? "Object selected -- drag rotates object"
        : "No selection -- camera orbit mode";

      if (!has || !transform || !material) return;
      setSlider("tx", transform.tx);
      setSlider("ty", transform.ty);
      setSlider("tz", transform.tz);
      setSlider("rx", transform.rx);
      setSlider("ry", transform.ry);
      setSlider("rz", transform.rz);
      setSlider("sx", transform.sx);
      setSlider("sy", transform.sy);
      setSlider("sz", transform.sz);

      setSlider("ambient", material.ambient);
      setSlider("diffuse", material.diffuse);
      setSlider("specular", material.specular);
      setSlider("shininess", material.shininess);

      (document.getElementById("objectColor") as HTMLInputElement).value = material.objectColor;
      (document.getElementById("useTexture") as HTMLInputElement).checked = material.useTexture;
    },
  };
}
