import type { Mat4, Vec3 } from "./math";

type Quat = [number, number, number, number];

function quatIdentity(): Quat {
  return [0, 0, 0, 1];
}

function quatNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function quatMul(a: Quat, b: Quat): Quat {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const h = angle * 0.5;
  const s = Math.sin(h);
  return quatNormalize([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)]);
}

function quatToMat4(q: Quat): Mat4 {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  const out = new Float32Array(16);
  out[0] = 1 - (yy + zz); out[1] = xy + wz;     out[2] = xz - wy;     out[3] = 0;
  out[4] = xy - wz;       out[5] = 1 - (xx + zz); out[6] = yz + wx;   out[7] = 0;
  out[8] = xz + wy;       out[9] = yz - wx;     out[10] = 1 - (xx + yy); out[11] = 0;
  out[12] = 0;            out[13] = 0;          out[14] = 0;          out[15] = 1;
  return out;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export class ArcballController {
  private readonly canvas: HTMLCanvasElement;
  private dragging = false;
  private lastVec: Vec3 = [0, 0, 1];
  private q: Quat = quatIdentity();

  zoom = 1.0;
  minZoom = 0.5;
  maxZoom = 3.0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    canvas.addEventListener("mousedown", this.onDown);
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mouseup", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  dispose() {
    this.canvas.removeEventListener("mousedown", this.onDown);
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mouseup", this.onUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }

  getRotationMatrix(): Mat4 {
    return quatToMat4(this.q);
  }

  reset() {
    this.q = quatIdentity();
    this.zoom = 1.0;
  }

  private mapToSphere(clientX: number, clientY: number): Vec3 {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = 1 - ((clientY - rect.top) / rect.height) * 2;

    const d2 = x * x + y * y;
    if (d2 <= 1) {
      return [x, y, Math.sqrt(1 - d2)];
    }
    const inv = 1 / Math.sqrt(d2);
    return [x * inv, y * inv, 0];
  }

  private onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    this.dragging = true;
    this.lastVec = this.mapToSphere(e.clientX, e.clientY);
  };

  private onMove = (e: MouseEvent) => {
    if (!this.dragging) return;
    const cur = this.mapToSphere(e.clientX, e.clientY);

    const axis = cross(this.lastVec, cur);
    const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
    if (axisLen > 1e-6) {
      const a = normalize(axis);
      const d = Math.max(-1, Math.min(1, dot(this.lastVec, cur)));
      const angle = Math.acos(d);
      const dq = quatFromAxisAngle(a, angle);
      this.q = quatNormalize(quatMul(dq, this.q));
    }

    this.lastVec = cur;
  };

  private onUp = (_e: MouseEvent) => {
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0012);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
  };
}
