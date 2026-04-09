# 2nd Midterm - Object-Order Graphics Pipeline

This project implements the requested midterm features on top of WebGPU + TypeScript.

## Run

```bash
npm install
npm run dev
```

## Mesh Files

Put the provided OBJ files inside:

- `public/data/beacon.obj`
- `public/data/teapot.obj`

If a file is missing, the app falls back to `cube`.

## Requirement Checklist

### 1) OBJ loading into indexed mesh data structure (10%)
Implemented in `src/mesh.ts`:

- `parseOBJToIndexedMesh()` parses OBJ `v` and `f` records.
- Faces are triangulated (fan triangulation for n-gons).
- Result is an indexed mesh (`indices`) with buffers for triangle and wireframe iteration.

### 2) Fit beacon/teapot into camera frustum using provided bounds (10%)
Implemented in `src/main.ts`:

- `BOUNDS_OVERRIDES` contains:
  - beacon sphere center `[125,125,125]`, radius `125`
  - teapot center `[0.217,1.575,0]` with radius derived from the given AABB
- `composeModelMatrix()` recenters and rescales so the object fits view.

### 3) Per-face and per-vertex normals (10%)
Implemented in `src/mesh.ts`:

- `computeNormals()` computes face normal using normalized cross product.
- Vertex normals are accumulated from face normals and normalized.
- Face normals are stored in `faceNormals`.

### 4) Arcball controls around object center (35%)
Implemented in `src/arcball.ts` and used in `src/main.ts`:

- Mouse drag arcball rotation (quaternion based).
- Rotation applied to model transform around object center.
- Entire object remains visible with fit transform and camera distance.

### 5) Triangle rasterization with barycentric interpolation (5%)
Implemented by GPU rasterizer in `triangle-list` pipeline:

- WebGPU rasterization performs per-fragment interpolation of varyings.
- Vertex outputs (`worldPos`, `worldNormal`, `uv`) are interpolated per triangle fragment.

### 6) Normal buffer creation and storage (10%)
Implemented in `src/main.ts` and `src/shader.wgsl`:

- Second render target (`normalTexture`) is allocated.
- Fragment shader stores transformed world normal encoded as RGB:
  - `out.normal = vec4(N * 0.5 + 0.5, 1.0)`

### 8) Gouraud and Phong shading with light above camera (10%)
Implemented in `src/shader.wgsl` and `src/main.ts`:

- Gouraud: per-vertex lighting (`gouraudLighting`).
- Phong: per-fragment lighting (`phongCore` path).
- Light is placed above camera each frame:
  - `lightPos = camPos + [0, 2, 1]`
- Shaded result is written to color output rendered on screen.

### 9) Zoom and clipping (5%)
Implemented in `src/arcball.ts` and `src/main.ts`:

- Mouse wheel controls zoom (`ArcballController.zoom`).
- Perspective near/far planes are updated from zoom each frame.
- Triangle clipping is handled by standard GPU clip-space frustum clipping.

### 10) Spherical texture parameterization and mapping (15%)
Implemented in `src/mesh.ts` and `src/shader.wgsl`:

- `computeSphericalUVs()` generates spherical UVs from mesh positions.
- Texture sampled in fragment shader and combined with base color.

### 11) Wireframe with hidden surface removal (10%)
Implemented in `src/main.ts`:

- Mesh edges generated as `lineIndices`.
- Wireframe rendering uses `line-list` pipeline.
- Hidden surface removal option uses depth testing and optional occluder prepass.
- Additional controls: wire color, intensity, opacity, thickness, and hidden-surface toggle.

## Main Files

- `src/main.ts`: WebGPU setup, pipelines, passes, mesh switching, per-frame uniforms.
- `src/mesh.ts`: OBJ importer, indexed mesh build, normals, spherical UVs, line indices.
- `src/arcball.ts`: arcball rotation + zoom controls.
- `src/shader.wgsl`: flat/gouraud/phong/blinn shading + normal buffer output + wire path.
- `src/gui.ts`: UI controls for mesh, shading, render mode, material, wireframe options.
