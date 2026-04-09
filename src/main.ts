/// <reference types="@webgpu/types" />

import "./style.css";
import shaderCode from "./shader.wgsl?raw";
import { ArcballController } from "./arcball";
import {
  gui,
  hexToRgb,
  initGUI,
  type MaterialState,
  type PipelineMode,
  type TransformState,
} from "./gui";
import { mat4, type Mat4, type Vec3 } from "./math";
import {
  createCubeIndexedMesh,
  createSphereIndexedMesh,
  parseOBJToIndexedMesh,
  type Bounds,
  type IndexedMesh,
} from "./mesh";

if (!navigator.gpu) throw new Error("WebGPU not supported");

const canvas = document.querySelector("#gfx-main") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas #gfx-main not found");

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No GPU adapter found");

const device = await adapter.requestDevice();
const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
if (!context) throw new Error("Could not get webgpu context");
const gpuContext: GPUCanvasContext = context;

const runtimeErrorEl = document.createElement("div");
runtimeErrorEl.style.position = "fixed";
runtimeErrorEl.style.left = "12px";
runtimeErrorEl.style.bottom = "12px";
runtimeErrorEl.style.maxWidth = "55vw";
runtimeErrorEl.style.padding = "8px 10px";
runtimeErrorEl.style.background = "rgba(120,0,0,0.86)";
runtimeErrorEl.style.color = "#fff";
runtimeErrorEl.style.font = "12px/1.4 monospace";
runtimeErrorEl.style.border = "1px solid rgba(255,255,255,0.2)";
runtimeErrorEl.style.borderRadius = "8px";
runtimeErrorEl.style.zIndex = "220";
runtimeErrorEl.style.display = "none";
document.body.appendChild(runtimeErrorEl);

let haltedByGpuError = false;

function showRuntimeError(msg: string) {
  runtimeErrorEl.style.display = "block";
  runtimeErrorEl.textContent = msg;
}

function submitWithValidation(encoder: GPUCommandEncoder) {
  device.pushErrorScope("validation");
  let cmd: GPUCommandBuffer;
  try {
    cmd = encoder.finish();
  } catch (err) {
    void device.popErrorScope();
    throw err;
  }

  device.queue.submit([cmd]);
  void device.popErrorScope().then(err => {
    if (err) {
      haltedByGpuError = true;
      showRuntimeError(`WebGPU validation: ${err.message}`);
      console.error("WebGPU validation scope error", err);
    }
  });
}

device.addEventListener("uncapturederror", ev => {
  haltedByGpuError = true;
  showRuntimeError(`WebGPU error: ${ev.error.message}`);
  console.error("WebGPU uncaptured error", ev.error);
});

const swapchainFormat = navigator.gpu.getPreferredCanvasFormat();
const normalFormat: GPUTextureFormat = "rgba8unorm";

let depthTexture: GPUTexture | null = null;
let normalTexture: GPUTexture | null = null;

function recreateTargets() {
  canvas.width = Math.max(1, Math.floor(window.innerWidth * devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * devicePixelRatio));

  gpuContext.configure({ device, format: swapchainFormat, alphaMode: "premultiplied" });

  depthTexture?.destroy();
  normalTexture?.destroy();

  depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  normalTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: normalFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
}

recreateTargets();
window.addEventListener("resize", recreateTargets);

const UNIFORM_SIZE = 320;
const uniformRaw = new ArrayBuffer(UNIFORM_SIZE);
const uniformF32 = new Float32Array(uniformRaw);

const shader = device.createShaderModule({ code: shaderCode, label: "pipeline-shader" });
const shaderInfo = await shader.getCompilationInfo();
const shaderErrors = shaderInfo.messages.filter(m => m.type === "error");
if (shaderErrors.length > 0) {
  const msg = shaderErrors.slice(0, 6).map(m => `L${m.lineNum}: ${m.message}`).join(" | ");
  showRuntimeError(`Shader compile error: ${msg}`);
  throw new Error(`WGSL compilation failed: ${msg}`);
}

const bindGroupLayout = device.createBindGroupLayout({
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform" },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      sampler: { type: "filtering" },
    },
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "float" },
    },
  ],
});

const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

async function createPipelineChecked(label: string, desc: GPURenderPipelineDescriptor): Promise<GPURenderPipeline> {
  device.pushErrorScope("validation");
  let popped = false;
  try {
    const pipeline = await device.createRenderPipelineAsync({ ...desc, label });
    const err = await device.popErrorScope();
    popped = true;
    if (err) throw new Error(`${label}: ${err.message}`);
    return pipeline;
  } catch (e) {
    if (!popped) {
      const err = await device.popErrorScope();
      if (err) showRuntimeError(`Pipeline validation: ${label}: ${err.message}`);
    }
    if (e instanceof Error) showRuntimeError(`Pipeline creation failed: ${e.message}`);
    throw e;
  }
}

const vertexLayout: GPUVertexBufferLayout = {
  arrayStride: 8 * 4,
  attributes: [
    { shaderLocation: 0, offset: 0, format: "float32x3" },
    { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
    { shaderLocation: 2, offset: 6 * 4, format: "float32x2" },
  ],
};

const solidPipeline = await createPipelineChecked("solid-pipeline", {
  layout: pipelineLayout,
  vertex: { module: shader, entryPoint: "vs_main", buffers: [vertexLayout] },
  fragment: {
    module: shader,
    entryPoint: "fs_main",
    targets: [{ format: swapchainFormat }, { format: normalFormat }],
  },
  primitive: { topology: "triangle-list", cullMode: "none" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
});

const wirePipeline = await createPipelineChecked("wire-pipeline", {
  layout: pipelineLayout,
  vertex: { module: shader, entryPoint: "vs_main", buffers: [vertexLayout] },
  fragment: {
    module: shader,
    entryPoint: "fs_main",
    targets: [
      {
        format: swapchainFormat,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      },
      { format: normalFormat, writeMask: 0 },
    ],
  },
  primitive: { topology: "line-list", cullMode: "none" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less-equal" },
});

const wireXrayPipeline = await createPipelineChecked("wire-xray-pipeline", {
  layout: pipelineLayout,
  vertex: { module: shader, entryPoint: "vs_main", buffers: [vertexLayout] },
  fragment: {
    module: shader,
    entryPoint: "fs_main",
    targets: [
      {
        format: swapchainFormat,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      },
      { format: normalFormat, writeMask: 0 },
    ],
  },
  primitive: { topology: "line-list", cullMode: "none" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "always" },
});

const occluderPipeline = await createPipelineChecked("occluder-pipeline", {
  layout: pipelineLayout,
  vertex: { module: shader, entryPoint: "vs_main", buffers: [vertexLayout] },
  fragment: {
    module: shader,
    entryPoint: "fs_main",
    targets: [
      { format: swapchainFormat, writeMask: 0 },
      { format: normalFormat, writeMask: 0 },
    ],
  },
  primitive: { topology: "triangle-list", cullMode: "back" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
});

function createCheckerTexture(size = 256): GPUTexture {
  const data = new Uint8Array(size * size * 4);
  const checks = 16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cx = Math.floor((x / size) * checks);
      const cy = Math.floor((y / size) * checks);
      const dark = (cx + cy) % 2 === 0;
      data[i + 0] = dark ? 210 : 34;
      data[i + 1] = dark ? 140 : 176;
      data[i + 2] = dark ? 82 : 68;
      data[i + 3] = 255;
    }
  }

  const tex = device.createTexture({
    size: [size, size],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: size * 4 }, { width: size, height: size });
  return tex;
}

const defaultTexture = createCheckerTexture(512);
const texSampler = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });

type GPUMesh = {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexFormat: GPUIndexFormat;
  lineIndexBuffer: GPUBuffer;
  lineIndexFormat: GPUIndexFormat;
  indexCount: number;
  lineIndexCount: number;
  bounds: Bounds;
  name: string;
};

type SceneObject = {
  id: number;
  label: string;
  mesh: GPUMesh;
  transform: TransformState;
  material: MaterialState;
  uniformBufferSolid: GPUBuffer;
  uniformBufferWire: GPUBuffer;
  bindGroupSolid: GPUBindGroup;
  bindGroupWire: GPUBindGroup;
  texture: GPUTexture;
  fitOverride: { center: Vec3; radius: number } | null;
};

function makeBuffer(data: ArrayBufferView, usage: GPUBufferUsageFlags): GPUBuffer {
  const buf = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
  const src = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  const copy = new Uint8Array(data.byteLength);
  copy.set(src);
  device.queue.writeBuffer(buf, 0, copy.buffer);
  return buf;
}

function toIndexBufferData(data: Uint32Array): { view: Uint16Array; format: GPUIndexFormat } {
  let max = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
  if (max > 65535) throw new Error("Mesh index exceeds uint16 range (65535)");
  return { view: new Uint16Array(data), format: "uint16" };
}

function toGPUMesh(mesh: IndexedMesh, name: string): GPUMesh {
  const tri = toIndexBufferData(mesh.indices);
  const lines = toIndexBufferData(mesh.lineIndices);
  return {
    vertexBuffer: makeBuffer(mesh.interleaved, GPUBufferUsage.VERTEX),
    indexBuffer: makeBuffer(tri.view, GPUBufferUsage.INDEX),
    indexFormat: tri.format,
    lineIndexBuffer: makeBuffer(lines.view, GPUBufferUsage.INDEX),
    lineIndexFormat: lines.format,
    indexCount: tri.view.length,
    lineIndexCount: lines.view.length,
    bounds: mesh.bounds,
    name,
  };
}

function defaultTransform(): TransformState {
  return { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
}

function spawnTransform(index: number): TransformState {
  const t = defaultTransform();
  if (index <= 0) return t;

  const spacing = 2.4;
  // 0, +1, -1, +2, -2, +3, -3 ... around the center line
  const step = Math.ceil(index / 2);
  const sign = index % 2 === 1 ? 1 : -1;
  t.tx = sign * step * spacing;
  t.tz = 0;
  return t;
}

function defaultMaterial(): MaterialState {
  return {
    ambient: 0.12,
    diffuse: 0.75,
    specular: 0.55,
    shininess: 48,
    objectColor: "#4a9eff",
    useTexture: false,
  };
}

function createObjectBindings(uniformSolid: GPUBuffer, uniformWire: GPUBuffer, texture: GPUTexture) {
  const view = texture.createView();
  const bindGroupSolid = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformSolid } },
      { binding: 1, resource: texSampler },
      { binding: 2, resource: view },
    ],
  });
  const bindGroupWire = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformWire } },
      { binding: 1, resource: texSampler },
      { binding: 2, resource: view },
    ],
  });
  return { bindGroupSolid, bindGroupWire };
}

function makeSceneObject(
  id: number,
  label: string,
  mesh: GPUMesh,
  fitOverride: { center: Vec3; radius: number } | null = null,
  initialTransform: TransformState | null = null,
): SceneObject {
  const uniformBufferSolid = device.createBuffer({ size: UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uniformBufferWire = device.createBuffer({ size: UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const texture = defaultTexture;
  const bindings = createObjectBindings(uniformBufferSolid, uniformBufferWire, texture);
  return {
    id,
    label,
    mesh,
    transform: initialTransform ? { ...initialTransform } : defaultTransform(),
    material: defaultMaterial(),
    uniformBufferSolid,
    uniformBufferWire,
    bindGroupSolid: bindings.bindGroupSolid,
    bindGroupWire: bindings.bindGroupWire,
    texture,
    fitOverride,
  };
}

async function createTextureFromFile(file: File): Promise<GPUTexture> {
  const bitmap = await createImageBitmap(file);
  const tex = device.createTexture({
    size: [bitmap.width, bitmap.height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, { width: bitmap.width, height: bitmap.height });
  return tex;
}

const cubeMesh = toGPUMesh(createCubeIndexedMesh(), "cube");
const sphereMesh = toGPUMesh(createSphereIndexedMesh(), "sphere");

const BOUNDS_OVERRIDES: Record<string, { center: Vec3; radius: number } | null> = {
  beacon: { center: [125, 125, 125], radius: 125 },
  teapot: {
    center: [0.217, 1.575, 0],
    radius: Math.hypot((3.434 - -3) * 0.5, (3.15 - 0) * 0.5, (2.0 - -2) * 0.5),
  },
};

const arcball = new ArcballController(canvas);

let nextId = 1;
let scene: SceneObject[] = [makeSceneObject(nextId++, "1. Cube", cubeMesh)];
let selectedObjectId: number | null = scene[0].id;

function getSelectedObject(): SceneObject | null {
  return selectedObjectId == null ? null : scene.find(o => o.id === selectedObjectId) ?? null;
}

function refreshGui() {
  ui.updateScene(scene.map(o => ({ id: o.id, label: o.label })), selectedObjectId);
  const sel = getSelectedObject();
  ui.updateSelection(sel?.transform ?? null, sel?.material ?? null);
}

function addPrimitive(kind: "sphere" | "cube") {
  const mesh = kind === "sphere" ? sphereMesh : cubeMesh;
  const id = nextId++;
  scene.push(
    makeSceneObject(
      id,
      `${id}. ${kind === "sphere" ? "Sphere" : "Cube"}`,
      mesh,
      null,
      spawnTransform(scene.length),
    ),
  );
  selectedObjectId = id;
  arcball.reset();
  refreshGui();
}

async function addObjFromFile(file: File) {
  try {
    const text = await file.text();
    const meshData = parseOBJToIndexedMesh(text);
    const mesh = toGPUMesh(meshData, file.name);
    const id = nextId++;
    const key = file.name.toLowerCase().includes("beacon") ? "beacon" : file.name.toLowerCase().includes("teapot") ? "teapot" : "";
    const override = key ? BOUNDS_OVERRIDES[key] : null;
    scene.push(makeSceneObject(id, `${id}. ${file.name}`, mesh, override, spawnTransform(scene.length)));
    selectedObjectId = id;
    arcball.reset();
    refreshGui();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showRuntimeError(`OBJ load error: ${msg}`);
  }
}

async function setSelectedTexture(file: File) {
  const sel = getSelectedObject();
  if (!sel) return;
  try {
    const tex = await createTextureFromFile(file);
    sel.texture = tex;
    const bindings = createObjectBindings(sel.uniformBufferSolid, sel.uniformBufferWire, tex);
    sel.bindGroupSolid = bindings.bindGroupSolid;
    sel.bindGroupWire = bindings.bindGroupWire;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showRuntimeError(`Texture load error: ${msg}`);
  }
}

const ui = initGUI({
  onAddSphere: () => addPrimitive("sphere"),
  onAddCube: () => addPrimitive("cube"),
  onAddObjFile: file => { void addObjFromFile(file); },
  onSelectObject: id => {
    selectedObjectId = id;
    arcball.reset();
    refreshGui();
  },
  onDeselect: () => {
    selectedObjectId = null;
    arcball.reset();
    refreshGui();
  },
  onRemoveSelected: () => {
    if (selectedObjectId == null) return;
    scene = scene.filter(o => o.id !== selectedObjectId);
    selectedObjectId = scene.length > 0 ? scene[0].id : null;
    arcball.reset();
    refreshGui();
  },
  onResetArcball: () => arcball.reset(),
  onTransformChange: patch => {
    const sel = getSelectedObject();
    if (!sel) return;
    sel.transform = { ...sel.transform, ...patch };
  },
  onMaterialChange: patch => {
    const sel = getSelectedObject();
    if (!sel) return;
    sel.material = { ...sel.material, ...patch };
    refreshGui();
  },
  onTextureFile: file => { void setSelectedTexture(file); },
  onPipelineMode: (_mode: PipelineMode) => {},
});

refreshGui();

function transformVec3(m: Mat4, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
}

function composeObjectModel(obj: SceneObject, selectedRot: Mat4 | null): Mat4 {
  const bounds = obj.mesh.bounds;
  const center = obj.fitOverride?.center ?? bounds.center;
  const radius = obj.fitOverride?.radius ?? bounds.radius;

  const fit = mat4.multiply(
    mat4.scaling(1 / radius, 1 / radius, 1 / radius),
    mat4.translation(-center[0], -center[1], -center[2]),
  );

  const rx = mat4.rotationX((obj.transform.rx * Math.PI) / 180);
  const ry = mat4.rotationY((obj.transform.ry * Math.PI) / 180);
  const rz = mat4.rotationZ((obj.transform.rz * Math.PI) / 180);
  const s = mat4.scaling(obj.transform.sx, obj.transform.sy, obj.transform.sz);
  const t = mat4.translation(obj.transform.tx, obj.transform.ty, obj.transform.tz);

  let model = mat4.multiply(t, mat4.multiply(rz, mat4.multiply(ry, mat4.multiply(rx, s))));
  if (selectedRot && selectedObjectId === obj.id) {
    model = mat4.multiply(model, selectedRot);
  }
  model = mat4.multiply(model, fit);
  return model;
}

function modeToShading(mode: PipelineMode): number {
  switch (mode) {
    case "gouraud": return 1;
    case "phong": return 2;
    case "normals": return 4;
    case "depth": return 5;
    case "texture": return 6;
    case "uv": return 7;
    case "wireframe": return 2;
    default: return 2;
  }
}

function writeUniformsForObject(obj: SceneObject, model: Mat4, view: Mat4, proj: Mat4, camPos: Vec3, wirePass: 0 | 1) {
  const mvp = mat4.multiply(mat4.multiply(proj, view), model);
  const normalMat = mat4.normalMatrix(model);
  const [or, og, ob] = hexToRgb(obj.material.objectColor);
  const [lr, lg, lb] = hexToRgb(gui.lightColor);
  const [wr, wg, wb] = hexToRgb(gui.wireColor);
  const lightPos: Vec3 = [3, 3, 3];

  uniformF32.set(mvp, 0);
  uniformF32.set(model, 16);
  uniformF32.set(normalMat, 32);

  uniformF32[48] = lightPos[0];
  uniformF32[49] = lightPos[1];
  uniformF32[50] = lightPos[2];
  uniformF32[51] = 0;

  uniformF32[52] = camPos[0];
  uniformF32[53] = camPos[1];
  uniformF32[54] = camPos[2];
  uniformF32[55] = 0;

  uniformF32[56] = or;
  uniformF32[57] = og;
  uniformF32[58] = ob;
  uniformF32[59] = 0;

  uniformF32[60] = lr;
  uniformF32[61] = lg;
  uniformF32[62] = lb;
  uniformF32[63] = 0;

  uniformF32[64] = gui.lightAmbient * gui.lightIntensity;
  uniformF32[65] = gui.lightDiffuse * gui.lightIntensity;
  uniformF32[66] = gui.lightSpecular * gui.lightIntensity;
  uniformF32[67] = obj.material.shininess;

  uniformF32[68] = modeToShading(gui.pipelineMode);
  uniformF32[69] = obj.material.useTexture ? 1 : 0;
  uniformF32[70] = wirePass;
  uniformF32[71] = gui.wireOpacity;

  uniformF32[72] = wr;
  uniformF32[73] = wg;
  uniformF32[74] = wb;
  uniformF32[75] = gui.wireIntensity;

  uniformF32[76] = gui.wireThickness;
  uniformF32[77] = canvas.width;
  uniformF32[78] = canvas.height;
  uniformF32[79] = 0;

  device.queue.writeBuffer(wirePass ? obj.uniformBufferWire : obj.uniformBufferSolid, 0, uniformRaw);
}

let lastTime = performance.now();

function frame(now: number) {
  if (haltedByGpuError) return;

  try {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    void dt;

    const fov = (60 * Math.PI) / 180;
    const aspect = canvas.width / canvas.height;
    const cameraDistance = 2.2 * arcball.zoom;
    const near = Math.max(0.01, cameraDistance - 3.0);
    const far = cameraDistance + 6.0;

    const proj = mat4.perspective(fov, aspect, near, far);
    const arcRot = arcball.getRotationMatrix();

    const selected = getSelectedObject();
    let camPos: Vec3 = [0, 0, cameraDistance];
    let up: Vec3 = [0, 1, 0];
    let target: Vec3 = [0, 0, 0];

    if (!selected) {
      camPos = transformVec3(arcRot, camPos);
      up = transformVec3(arcRot, up);
    } else {
      target = [selected.transform.tx, selected.transform.ty, selected.transform.tz];
      camPos = [target[0], target[1], target[2] + cameraDistance];
    }

    const view = mat4.lookAt(camPos, target, up);

    const doWire = gui.pipelineMode === "wireframe";
    const doSolid = !doWire;

    const selectedRot = selected ? arcRot : null;

    for (const obj of scene) {
      const model = composeObjectModel(obj, selectedRot);
      writeUniformsForObject(obj, model, view, proj, camPos, 0);
      writeUniformsForObject(obj, model, view, proj, camPos, 1);
    }

    const colorView = gpuContext.getCurrentTexture().createView();
    const depthView = depthTexture!.createView();
    const normalView = normalTexture!.createView();

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.04, g: 0.05, b: 0.09, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
        {
          view: normalView,
          clearValue: { r: 0.5, g: 0.5, b: 1.0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    for (const obj of scene) {
      pass.setVertexBuffer(0, obj.mesh.vertexBuffer);

      if (doSolid) {
        pass.setBindGroup(0, obj.bindGroupSolid);
        pass.setPipeline(solidPipeline);
        pass.setIndexBuffer(obj.mesh.indexBuffer, obj.mesh.indexFormat);
        pass.drawIndexed(obj.mesh.indexCount);
      }

      if (!doSolid && gui.wireHiddenSurface) {
        pass.setBindGroup(0, obj.bindGroupSolid);
        pass.setPipeline(occluderPipeline);
        pass.setIndexBuffer(obj.mesh.indexBuffer, obj.mesh.indexFormat);
        pass.drawIndexed(obj.mesh.indexCount);
      }

      if (doWire) {
        pass.setBindGroup(0, obj.bindGroupWire);
        pass.setPipeline(gui.wireHiddenSurface ? wirePipeline : wireXrayPipeline);
        pass.setIndexBuffer(obj.mesh.lineIndexBuffer, obj.mesh.lineIndexFormat);
        const wireInstanceCount = gui.wireThickness > 1.01 ? 9 : 1;
        pass.drawIndexed(obj.mesh.lineIndexCount, wireInstanceCount);
      }
    }

    pass.end();
    submitWithValidation(encoder);

    requestAnimationFrame(frame);
  } catch (err) {
    haltedByGpuError = true;
    const msg = err instanceof Error ? err.message : String(err);
    showRuntimeError(`Frame error: ${msg}`);
    console.error(err);
  }
}

requestAnimationFrame(frame);
