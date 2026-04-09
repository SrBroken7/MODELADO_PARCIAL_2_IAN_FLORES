import type { Vec3 } from "./math";
import { vec3 } from "./math";

export type Bounds = {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  radius: number;
};

export type IndexedMesh = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  lineIndices: Uint32Array;
  interleaved: Float32Array;
  bounds: Bounds;
  faceNormals: Float32Array;
};

function parseIndex(token: string, vertexCount: number): number {
  const idx = Number.parseInt(token, 10);
  if (Number.isNaN(idx) || idx === 0) throw new Error(`Invalid OBJ index: ${token}`);
  return idx > 0 ? idx - 1 : vertexCount + idx;
}

function computeBounds(positions: Float32Array): Bounds {
  if (positions.length < 3) {
    return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 1 };
  }

  let minX = positions[0], minY = positions[1], minZ = positions[2];
  let maxX = positions[0], maxY = positions[1], maxZ = positions[2];

  for (let i = 3; i < positions.length; i += 3) {
    const x = positions[i + 0];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const center: Vec3 = [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5];
  let radius = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const d = Math.hypot(positions[i] - center[0], positions[i + 1] - center[1], positions[i + 2] - center[2]);
    if (d > radius) radius = d;
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center,
    radius: radius > 1e-6 ? radius : 1,
  };
}

function buildLineIndices(triIndices: Uint32Array): Uint32Array {
  const edgeSet = new Set<string>();
  const lines: number[] = [];

  const addEdge = (a: number, b: number) => {
    const i0 = Math.min(a, b);
    const i1 = Math.max(a, b);
    const key = `${i0}_${i1}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    lines.push(i0, i1);
  };

  for (let i = 0; i < triIndices.length; i += 3) {
    const i0 = triIndices[i + 0];
    const i1 = triIndices[i + 1];
    const i2 = triIndices[i + 2];
    addEdge(i0, i1);
    addEdge(i1, i2);
    addEdge(i2, i0);
  }

  return new Uint32Array(lines);
}

function computeNormals(positions: Float32Array, indices: Uint32Array): { vertexNormals: Float32Array; faceNormals: Float32Array } {
  const vNormals = new Float32Array(positions.length);
  const fNormals = new Float32Array(indices.length);

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i + 0] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const p0: Vec3 = [positions[i0], positions[i0 + 1], positions[i0 + 2]];
    const p1: Vec3 = [positions[i1], positions[i1 + 1], positions[i1 + 2]];
    const p2: Vec3 = [positions[i2], positions[i2 + 1], positions[i2 + 2]];

    const e1 = vec3.sub(p1, p0);
    const e2 = vec3.sub(p2, p0);
    const n = vec3.normalize(vec3.cross(e1, e2));

    fNormals[i + 0] = n[0];
    fNormals[i + 1] = n[1];
    fNormals[i + 2] = n[2];

    vNormals[i0] += n[0];
    vNormals[i0 + 1] += n[1];
    vNormals[i0 + 2] += n[2];

    vNormals[i1] += n[0];
    vNormals[i1 + 1] += n[1];
    vNormals[i1 + 2] += n[2];

    vNormals[i2] += n[0];
    vNormals[i2 + 1] += n[1];
    vNormals[i2 + 2] += n[2];
  }

  for (let i = 0; i < vNormals.length; i += 3) {
    const n = vec3.normalize([vNormals[i], vNormals[i + 1], vNormals[i + 2]]);
    vNormals[i] = n[0];
    vNormals[i + 1] = n[1];
    vNormals[i + 2] = n[2];
  }

  return { vertexNormals: vNormals, faceNormals: fNormals };
}

function computeSphericalUVs(positions: Float32Array, bounds: Bounds): Float32Array {
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, uv = 0; i < positions.length; i += 3, uv += 2) {
    const dir = vec3.normalize([
      positions[i + 0] - bounds.center[0],
      positions[i + 1] - bounds.center[1],
      positions[i + 2] - bounds.center[2],
    ]);

    const u = 0.5 + Math.atan2(dir[2], dir[0]) / (Math.PI * 2);
    const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, dir[1]))) / Math.PI;
    uvs[uv + 0] = u;
    uvs[uv + 1] = v;
  }
  return uvs;
}

function buildInterleaved(positions: Float32Array, normals: Float32Array, uvs: Float32Array): Float32Array {
  const out = new Float32Array((positions.length / 3) * 8);
  for (let i = 0, o = 0, uv = 0; i < positions.length; i += 3, o += 8, uv += 2) {
    out[o + 0] = positions[i + 0];
    out[o + 1] = positions[i + 1];
    out[o + 2] = positions[i + 2];
    out[o + 3] = normals[i + 0];
    out[o + 4] = normals[i + 1];
    out[o + 5] = normals[i + 2];
    out[o + 6] = uvs[uv + 0];
    out[o + 7] = uvs[uv + 1];
  }
  return out;
}

export function buildIndexedMesh(positions: Float32Array, indices: Uint32Array): IndexedMesh {
  const bounds = computeBounds(positions);
  const { vertexNormals, faceNormals } = computeNormals(positions, indices);
  const uvs = computeSphericalUVs(positions, bounds);
  const interleaved = buildInterleaved(positions, vertexNormals, uvs);
  const lineIndices = buildLineIndices(indices);

  return {
    positions,
    normals: vertexNormals,
    uvs,
    indices,
    lineIndices,
    interleaved,
    bounds,
    faceNormals,
  };
}

export function parseOBJToIndexedMesh(objText: string): IndexedMesh {
  const vertices: number[] = [];
  const triIndices: number[] = [];

  const lines = objText.split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("v ")) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      vertices.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
      continue;
    }

    if (line.startsWith("f ")) {
      const parts = line.split(/\s+/).slice(1);
      if (parts.length < 3) continue;

      const faceIndices: number[] = [];
      const vertexCount = vertices.length / 3;
      for (const p of parts) {
        const vTok = p.split("/")[0];
        faceIndices.push(parseIndex(vTok, vertexCount));
      }

      // Fan triangulation for n-gons.
      for (let i = 1; i < faceIndices.length - 1; i++) {
        triIndices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
      }
    }
  }

  if (vertices.length === 0 || triIndices.length === 0) {
    throw new Error("OBJ does not contain valid vertices/faces");
  }

  return buildIndexedMesh(new Float32Array(vertices), new Uint32Array(triIndices));
}

export function createCubeIndexedMesh(): IndexedMesh {
  const pos = new Float32Array([
    -1, -1, 1,   1, -1, 1,   1, 1, 1,   -1, 1, 1,
    1, -1, -1,  -1, -1, -1, -1, 1, -1,   1, 1, -1,
    -1, -1, -1, -1, -1, 1,  -1, 1, 1,   -1, 1, -1,
    1, -1, 1,   1, -1, -1,   1, 1, -1,   1, 1, 1,
    -1, 1, 1,    1, 1, 1,    1, 1, -1,  -1, 1, -1,
    -1, -1, -1,  1, -1, -1,  1, -1, 1,  -1, -1, 1,
  ]);

  const idx = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23,
  ]);

  return buildIndexedMesh(pos, idx);
}

export function createSphereIndexedMesh(stacks = 24, slices = 32): IndexedMesh {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= stacks; i++) {
    const v = i / stacks;
    const phi = Math.PI * v;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let j = 0; j <= slices; j++) {
      const u = j / slices;
      const theta = 2 * Math.PI * u;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      const x = sinPhi * cosTheta;
      const y = cosPhi;
      const z = sinPhi * sinTheta;
      positions.push(x, y, z);
    }
  }

  const row = slices + 1;
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const i0 = i * row + j;
      const i1 = i0 + 1;
      const i2 = i0 + row;
      const i3 = i2 + 1;

      if (i > 0) indices.push(i0, i2, i1);
      if (i < stacks - 1) indices.push(i1, i2, i3);
    }
  }

  return buildIndexedMesh(new Float32Array(positions), new Uint32Array(indices));
}
