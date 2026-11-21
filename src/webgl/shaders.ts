export const QUAD_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const COPY_FRAG = `
precision highp float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
}
`;

export const SPLAT_FRAG = `
precision highp float;
uniform sampler2D uTarget;
uniform float uAspect;
uniform vec2 uPointA;
uniform vec2 uPointB;
uniform vec3 uColor;
uniform float uRadius;
uniform float uIsDensity;
varying vec2 vUv;

void main() {
  vec2 p = vUv - uPointA;
  vec2 ba = uPointB - uPointA;
  p.x *= uAspect;
  ba.x *= uAspect;
  float baDot = dot(ba, ba);
  float h = baDot > 1e-8 ? clamp(dot(p, ba) / baDot, 0.0, 1.0) : 0.0;
  vec2 d = p - ba * h;
  float dist2 = dot(d, d);
  float r = max(uRadius, 1e-4);
  float splat = exp(-4.5 * dist2 / (r * r));
  vec3 base = texture2D(uTarget, vUv).xyz;
  vec3 result = base + splat * uColor;
  if (uIsDensity > 0.5) {
    result = min(result, vec3(1.0));
  }
  gl_FragColor = vec4(result, 1.0);
}
`;

export const CURL_FRAG = `
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
varying vec2 vUv;

void main() {
  float L = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
  float R = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
  float T = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
  float B = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
  float vorticity = R - L - T + B;
  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`;

export const VORTICITY_FRAG = `
precision highp float;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexelSize;
uniform float uCurlStrength;
uniform float uDt;
varying vec2 vUv;

void main() {
  float L = texture2D(uCurl, vUv - vec2(uTexelSize.x, 0.0)).x;
  float R = texture2D(uCurl, vUv + vec2(uTexelSize.x, 0.0)).x;
  float T = texture2D(uCurl, vUv + vec2(0.0, uTexelSize.y)).x;
  float B = texture2D(uCurl, vUv - vec2(0.0, uTexelSize.y)).x;
  float C = texture2D(uCurl, vUv).x;

  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uCurlStrength * C;
  force.y *= -1.0;

  vec2 vel = texture2D(uVelocity, vUv).xy;
  gl_FragColor = vec4(vel + force * uDt, 0.0, 1.0);
}
`;

export const DIVERGENCE_FRAG = `
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
varying vec2 vUv;

void main() {
  vec2 vL = vUv - vec2(uTexelSize.x, 0.0);
  vec2 vR = vUv + vec2(uTexelSize.x, 0.0);
  vec2 vT = vUv + vec2(0.0, uTexelSize.y);
  vec2 vB = vUv - vec2(0.0, uTexelSize.y);

  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;

  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;

  float div = 0.5 * (R - L + T - B);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

export const CLEAR_PRESSURE_FRAG = `
precision highp float;
uniform sampler2D uTexture;
uniform float uValue;
varying vec2 vUv;

void main() {
  gl_FragColor = uValue * texture2D(uTexture, vUv);
}
`;

export const PRESSURE_FRAG = `
precision highp float;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexelSize;
varying vec2 vUv;

void main() {
  float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
  float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  float divergence = texture2D(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

export const GRADIENT_SUBTRACT_FRAG = `
precision highp float;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
varying vec2 vUv;

void main() {
  float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
  float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

export const ADVECT_FRAG = `
precision highp float;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexelSize;
uniform float uDt;
uniform float uDissipation;
varying vec2 vUv;

void main() {
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vec2 coord = clamp(vUv - uDt * vel * uTexelSize, vec2(0.0), vec2(1.0));
  vec4 result = texture2D(uSource, coord);
  gl_FragColor = result * uDissipation;
}
`;

export const FLUID_MASK_FRAG = `
precision highp float;
uniform sampler2D uDensity;
varying vec2 vUv;

void main() {
  vec3 c = texture2D(uDensity, vUv).rgb;
  float a = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c, a);
}
`;

export const PARTICLE_SIM_FRAG = `
precision highp float;
uniform sampler2D uPositions;
uniform sampler2D uOrigin;
uniform sampler2D uFluidVelocity;
uniform sampler2D uFluidDensity;
uniform float uTime;
uniform float uHz;
uniform mat4 uSceneProjView;
uniform mat4 uModelMatrix;
uniform mat4 uInvModelMatrix;
uniform mat4 uCameraWorld;
varying vec2 vUv;

// Bridson-style analytic curl of three sine-sum potentials
vec3 curlNoise(vec3 p) {
  float x = p.x;
  float y = p.y;
  float z = p.z;

  float dPsi3_dy = 1.7 * cos(1.7 * y + 0.8 * z) - 2.3 * sin(1.1 * x - 2.3 * y);
  float dPsi2_dz = 2.1 * cos(2.1 * z + 1.3 * x) + 1.5 * cos(0.9 * y + 1.5 * z);

  float dPsi1_dz = 1.9 * cos(1.9 * z - 1.2 * y) - 1.4 * sin(2.2 * x + 1.4 * z);
  float dPsi3_dx = 1.1 * cos(1.1 * x - 2.3 * y) + 2.0 * cos(2.0 * x + 1.6 * z);

  float dPsi2_dx = 1.3 * cos(2.1 * z + 1.3 * x) - 1.8 * sin(1.8 * x - 1.2 * y);
  float dPsi1_dy = -1.2 * cos(1.9 * z - 1.2 * y) + 2.4 * cos(2.4 * y + 0.7 * x);

  vec3 c = vec3(
    dPsi3_dy - dPsi2_dz,
    dPsi1_dz - dPsi3_dx,
    dPsi2_dx - dPsi1_dy
  );
  float len = length(c);
  return len > 1e-5 ? c / len : vec3(0.0);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sdfShape(vec3 p) {
  float lenP = length(p);
  if (lenP > 0.8) return lenP - 0.7;

  // Mirror depth axis with soft seam
  p.z = sqrt(p.z * p.z + 0.0215) - sqrt(0.012);

  // Rotate by quaternion (0.5, 0.5, 0.5, 0.5)
  vec4 q = vec4(0.5, 0.5, 0.5, 0.5);
  vec3 t = 2.0 * cross(q.xyz, p);
  p = p + q.w * t + cross(q.xyz, t);

  // Gentle helical twist for sculpted hollow ring silhouette
  float twist = p.y * 1.8;
  float ct = cos(twist);
  float st = sin(twist);
  vec3 rp = vec3(ct * p.x - st * p.z, p.y, st * p.x + ct * p.z);

  // Uneven, gently twisted hollow ring. Vary the major and tube radii
  // around the ring so the silhouette is organic rather than a perfect donut.
  float ringAngle = atan(rp.z, rp.x);
  float majorRadius = 0.255
    + 0.026 * sin(ringAngle * 2.0 + rp.y * 3.2)
    + 0.014 * sin(ringAngle * 3.0 - rp.y * 4.5);
  float tubeRadius = 0.076
    + 0.012 * sin(ringAngle * 2.0 + rp.y * 7.0);
  vec2 qTor = vec2(length(rp.xz) - majorRadius,
                   rp.y + 0.035 * sin(rp.x * 6.0 + rp.z * 2.5));
  float dTorus = length(qTor) - tubeRadius;

  // A softer, offset lobe breaks the symmetry without closing the opening.
  vec3 p2 = vec3(rp.x * 0.85 - rp.y * 0.52,
                 rp.x * 0.52 + rp.y * 0.85,
                 rp.z);
  vec2 qTor2 = vec2(length(p2.xy) - 0.222,
                    p2.z + 0.018 * sin(p2.x * 7.0));
  float dLobe = length(qTor2) - 0.052;

  float d = smin(dTorus, dLobe, 0.065);

  // Layered low-amplitude deformation adds a natural, sculpted surface.
  float sineNet = (
    sin(rp.x * 9.0 + rp.y * 5.0) * cos(rp.y * 8.0 + rp.z * 6.0) +
    sin(rp.z * 10.0 - rp.x * 4.0) +
    0.45 * sin(ringAngle * 4.0 + rp.y * 9.0)
  ) * 0.012;

  return d + sineNet;
}

vec3 sdfNormal(vec3 p) {
  const float e = 0.001;
  float dx = sdfShape(p + vec3(e, 0.0, 0.0)) - sdfShape(p - vec3(e, 0.0, 0.0));
  float dy = sdfShape(p + vec3(0.0, e, 0.0)) - sdfShape(p - vec3(0.0, e, 0.0));
  float dz = sdfShape(p + vec3(0.0, 0.0, e)) - sdfShape(p - vec3(0.0, 0.0, e));
  vec3 n = vec3(dx, dy, dz);
  float len = length(n);
  return len > 1e-6 ? n / len : vec3(0.0, 1.0, 0.0);
}

void main() {
  vec3 pos = texture2D(uPositions, vUv).xyz;
  vec3 origin = texture2D(uOrigin, vUv).xyz;

  if (length(pos) > 0.7) pos /= 2.0;

  pos += curlNoise(pos * 0.1 + uTime * 0.05) * 1.0 * 0.0002 * uHz;

  vec3 gradient = sdfNormal(pos);
  float sdf = sdfShape(pos);

  float posLen = length(pos);
  if (posLen > 1e-5) {
    pos += cross(pos / posLen, gradient) * 0.0005 * uHz;
  }

  // Mouse fluid interaction
  float fluidDensity = 0.0;
  vec4 worldPos = uModelMatrix * vec4(pos, 1.0);
  vec4 clipPos = uSceneProjView * worldPos;
  if (abs(clipPos.w) > 1e-5) {
    vec2 screenUV = (clipPos.xy / clipPos.w) * 0.5 + 0.5;
    if (screenUV.x >= 0.0 && screenUV.x <= 1.0 && screenUV.y >= 0.0 && screenUV.y <= 1.0) {
      vec2 vel = texture2D(uFluidVelocity, screenUV).xy;
      fluidDensity = clamp(texture2D(uFluidDensity, screenUV).r, 0.0, 1.0);
      vec3 worldFlow = (uCameraWorld * vec4(vel, 0.0, 0.0)).xyz;
      vec3 localFlow = (uInvModelMatrix * vec4(worldFlow, 0.0)).xyz;
      pos += localFlow * 0.0003 * uHz * 0.4 * fluidDensity;
    }
  }

  // Pull back onto SDF surface (softened temporarily while disturbed by fluid, heals in ~1-2s)
  float sdfPull = mix(0.5, 0.08, fluidDensity);
  pos += -gradient * sdf * sdfPull;
  pos += (origin - pos) * 0.0002 * uHz;

  gl_FragColor = vec4(pos, 1.0);
}
`;

export const POINTS_VERT = `
attribute vec4 random;
uniform sampler2D uPositions;
uniform float uDpr;
varying vec4 vRandom;
varying float vScale;

void main() {
  vec3 pos = texture2D(uPositions, position.xy).xyz;
  pos *= mix(1.0, 1.5, pow(random.y, 150.0));

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float distToCamera = -mvPosition.z;
  float scale = smoothstep(1.5, 12.0, distToCamera) * mix(0.5, 1.0, random.z);

  vScale = scale;
  vRandom = random;
  // Fine points: keep the cloud airy and individually readable.
  float sizeVariation = mix(0.68, 1.18, random.x);
  gl_PointSize = 0.024 * uDpr * 2.0 * scale * sizeVariation
    * (1000.0 / max(distToCamera, 0.1));
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const POINTS_FRAG = `
precision highp float;
uniform float uTime;
uniform sampler2D uMatcap;
varying vec4 vRandom;
varying float vScale;

void main() {
  vec2 uv = gl_PointCoord;
  vec2 centered = uv - 0.5;
  float radius = length(centered);
  if (radius > 0.5) discard;
  if (vScale < 0.1) discard;

  // Classify particles into three brightness tiers.
  float isHighlight = step(0.88, vRandom.z);
  float isSparkle = step(0.96, vRandom.z);

  // Base silver-grey tone, varied by random.x.
  vec3 base = vec3(mix(0.05, 0.20, vRandom.x));
  // Highlight particles: brighter white-silver.
  base = mix(base, vec3(0.85, 0.88, 0.95), isHighlight * 0.7);
  // Sparkle particles: intense white.
  base = mix(base, vec3(1.0, 1.0, 1.0), isSparkle * 0.9);

  // Sparse lavender highlights (#aa88ff).
  float lavenderMask = pow(vRandom.z, 64.0);
  base = mix(base, vec3(0.67, 0.53, 1.0), lavenderMask * 0.55);

  // Subtle time-based twinkle for natural shimmer.
  float twinkle = 0.86 + 0.14 * sin(uTime * 3.0 + vRandom.y * 22.0);
  float sparkle = pow(vRandom.z, 12.0)
    * (0.45 + 0.55 * sin(uTime * 4.5 + vRandom.y * 18.0));
  sparkle = clamp(sparkle, 0.0, 1.0);
  float intensity = twinkle + sparkle * (1.0 + isSparkle * 0.8);

  // Matcap spherical shading for reflective silver appearance.
  float angle = sin(uTime + vRandom.z * 16.0) * 0.35 + 1.0;
  float ca = cos(angle);
  float sa = sin(angle);
  vec2 rotUv = vec2(centered.x * ca - centered.y * sa,
                    centered.x * sa + centered.y * ca) + 0.5;
  vec4 matcapSample = texture2D(uMatcap, rotUv);

  vec3 col = mix(base, matcapSample.rgb, 0.5);
  col *= intensity * matcapSample.a;

  // Crisp sprite: sharp circular edge with bright concentrated center.
  float edge = 1.0 - smoothstep(0.42, 0.50, radius);
  float core = 0.62 + 0.38 * exp(-30.0 * radius * radius);
  float alpha = (0.30 + isHighlight * 0.10 + isSparkle * 0.18 + sparkle * 0.20)
    * edge * core;
  gl_FragColor = vec4(col, alpha);
}
`;
