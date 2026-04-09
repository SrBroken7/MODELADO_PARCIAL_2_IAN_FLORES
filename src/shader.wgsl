struct Uniforms {
  mvp        : mat4x4<f32>,
  model      : mat4x4<f32>,
  normalMat  : mat4x4<f32>,

  lightPos   : vec3<f32>,
  _p0        : f32,

  camPos     : vec3<f32>,
  _p1        : f32,

  objectColor : vec3<f32>,
  _p2         : f32,

  lightColor : vec3<f32>,
  _p3        : f32,

  params     : vec4<f32>, // x ambient, y diffuse, z specular, w shininess
  flags      : vec4<f32>, // x shadingMode, y useTexture, z wirePass, w wireOpacity
  wireParams : vec4<f32>, // rgb wireColor, a wireIntensity
  wireCtrl   : vec4<f32>, // x thicknessPx, y viewportW, z viewportH, w reserved
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var texSampler : sampler;
@group(0) @binding(2) var baseTexture : texture_2d<f32>;

struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) uv       : vec2<f32>,
};

struct VSOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) worldPos      : vec3<f32>,
  @location(1) worldNormal   : vec3<f32>,
  @location(2) uv            : vec2<f32>,
  @location(3) gouraudColor  : vec3<f32>,
};

struct FSOut {
  @location(0) color  : vec4<f32>,
  @location(1) normal : vec4<f32>,
};

fn baseColorFS(uv: vec2<f32>) -> vec3<f32> {
  let tex = textureSample(baseTexture, texSampler, uv).rgb;
  let useTex = step(0.5, u.flags.y);
  return mix(u.objectColor, u.objectColor * tex, useTex);
}

fn phongCore(Nin: vec3<f32>, worldPos: vec3<f32>, albedo: vec3<f32>, useBlinn: bool) -> vec3<f32> {
  let N = normalize(Nin);
  let L = normalize(u.lightPos - worldPos);
  let V = normalize(u.camPos - worldPos);

  let ambientC = u.params.x * u.lightColor;
  let NdotL = max(dot(N, L), 0.0);
  let diffuseC = u.params.y * NdotL * u.lightColor;

  var specularC = vec3<f32>(0.0);
  if (NdotL > 0.0) {
    if (useBlinn) {
      let H = normalize(L + V);
      let NdotH = max(dot(N, H), 0.0);
      specularC = u.params.z * pow(NdotH, u.params.w) * u.lightColor;
    } else {
      let R = reflect(-L, N);
      let RdotV = max(dot(R, V), 0.0);
      specularC = u.params.z * pow(RdotV, u.params.w) * u.lightColor;
    }
  }

  return (ambientC + diffuseC + specularC) * albedo;
}

fn flatShading(worldPos: vec3<f32>, albedo: vec3<f32>) -> vec3<f32> {
  let dx = dpdx(worldPos);
  let dy = dpdy(worldPos);
  let faceN = normalize(cross(dx, dy));
  return phongCore(faceN, worldPos, albedo, false);
}

fn gouraudLighting(N: vec3<f32>, worldPos: vec3<f32>, albedo: vec3<f32>) -> vec3<f32> {
  return phongCore(N, worldPos, albedo, false);
}

@vertex
fn vs_main(input: VSIn, @builtin(instance_index) instanceIndex: u32) -> VSOut {
  var out: VSOut;

  let worldPos4 = u.model * vec4<f32>(input.position, 1.0);
  let worldNormal4 = u.normalMat * vec4<f32>(input.normal, 0.0);

  var clipPos = u.mvp * vec4<f32>(input.position, 1.0);
  if (u.flags.z > 0.5) {
    let r = max(0.0, u.wireCtrl.x - 1.0);
    let d = 0.70710678;
    var dir = vec2<f32>(0.0, 0.0);
    switch instanceIndex {
      case 1u: { dir = vec2<f32>(1.0, 0.0); }
      case 2u: { dir = vec2<f32>(-1.0, 0.0); }
      case 3u: { dir = vec2<f32>(0.0, 1.0); }
      case 4u: { dir = vec2<f32>(0.0, -1.0); }
      case 5u: { dir = vec2<f32>(d, d); }
      case 6u: { dir = vec2<f32>(-d, d); }
      case 7u: { dir = vec2<f32>(d, -d); }
      case 8u: { dir = vec2<f32>(-d, -d); }
      default: { dir = vec2<f32>(0.0, 0.0); }
    }
    let offsetPx = dir * r;
    let ndc = vec2<f32>(
      (offsetPx.x * 2.0) / max(1.0, u.wireCtrl.y),
      (-offsetPx.y * 2.0) / max(1.0, u.wireCtrl.z),
    );
    clipPos = vec4<f32>(clipPos.xy + ndc * clipPos.w, clipPos.z, clipPos.w);
  }

  out.clipPos = clipPos;
  out.worldPos = worldPos4.xyz;
  out.worldNormal = normalize(worldNormal4.xyz);
  out.uv = input.uv;

  if (i32(u.flags.x + 0.5) == 1) {
    out.gouraudColor = gouraudLighting(out.worldNormal, out.worldPos, u.objectColor);
  } else {
    out.gouraudColor = vec3<f32>(0.0);
  }

  return out;
}

@fragment
fn fs_main(input: VSOut) -> FSOut {
  var out: FSOut;

  if (u.flags.z > 0.5) {
    let wire = clamp(u.wireParams.rgb * u.wireParams.a, vec3<f32>(0.0), vec3<f32>(1.0));
    out.color = vec4<f32>(wire, u.flags.w);
    out.normal = vec4<f32>(0.5, 0.5, 1.0, 1.0);
    return out;
  }

  let N = normalize(input.worldNormal);
  let shadingMode = i32(u.flags.x + 0.5);
  let albedo = baseColorFS(input.uv);
  let texOnly = textureSample(baseTexture, texSampler, input.uv).rgb;

  var lit = vec3<f32>(0.0);
  switch shadingMode {
    case 0: {
      lit = flatShading(input.worldPos, albedo);
    }
    case 1: {
      lit = input.gouraudColor;
    }
    case 2: {
      lit = phongCore(N, input.worldPos, albedo, false);
    }
    case 4: {
      lit = N * 0.5 + 0.5;
    }
    case 5: {
      let d = clamp(length(u.camPos - input.worldPos) / 20.0, 0.0, 1.0);
      lit = vec3<f32>(1.0 - d);
    }
    case 6: {
      lit = phongCore(N, input.worldPos, texOnly, false);
    }
    case 7: {
      lit = vec3<f32>(fract(input.uv), 0.0);
    }
    default: {
      lit = phongCore(N, input.worldPos, albedo, true);
    }
  }

  out.color = vec4<f32>(lit, 1.0);
  out.normal = vec4<f32>(N * 0.5 + 0.5, 1.0);
  return out;
}
