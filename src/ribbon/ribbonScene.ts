import * as THREE from 'three';

export interface RibbonDomRefs {
  track: HTMLElement;
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  l1: HTMLElement;
  l2: HTMLElement;
  cap: HTMLElement;
  hint: HTMLElement;
  glow: HTMLElement;
  name: HTMLElement;
}

interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
  vw: number;
  vh: number;
  c: number;
  r: number;
}

interface RibbonCard {
  i: number;
  title: string;
  url: string;
  v: HTMLVideoElement;
  tex: THREE.VideoTexture;
  geo: THREE.PlaneGeometry;
  mat: THREE.ShaderMaterial;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  rect: GridRect | null;
  failed: boolean;
  onLoadedData: () => void;
  onError: () => void;
}

const R2 = 'https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/';

export const WORK: ReadonlyArray<readonly [string, string]> = [
  ['Roadster 3D', 'designs/roadster-3d-car-landing.mp4'],
  ['Living Portrait', 'aaaf/living-portrait-hero.mp4'],
  ['Particle Self', 'aaaf/oraciteslArea.mp4'],
  ['Robot Jellyfish', 'aaaf/medusa-jellyfish-hero.mp4'],
  ['Ink Reveal', 'designs/ink-reveal-hover.mp4'],
  ['Space Voyage', 'designs/space-voyage-video.mp4'],
  ['Helion Dispatch', 'designs/helion-dispatch-landing.mp4'],
  ['Honey Bee', 'designs/honey-bee-melli-landing.mp4'],
];

const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const ease = (t: number): number => t * t * (3 - 2 * t);
const out = (t: number): number => 1 - (1 - t) ** 3;
const span = (p: number, a: number, b: number): number => clamp((p - a) / (b - a));

const FOV = 35;
const SAMPLES = 1200;
const PH0 = -1.5;
const PH1 = Math.PI * 2 + 1.35;

const CARD_W = 2.1;
const CARD_H = 1.32;
const GAP = 0.03;
const STEP = CARD_W + GAP;
const NX = 28;
const NY = 3;
const GZ = 8;
const RIB_A = 0.14;
const RIB_B = 0.63;

const vs = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fs = `uniform sampler2D map;uniform vec2 cover;uniform float aspect,ready,radius;varying vec2 vUv;
void main(){
  vec2 q=(abs(vUv-.5)-.5)*vec2(aspect,1.)+radius;
  float d=length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
  float px=fwidth(d),a=1.-smoothstep(-px,px,d);
  if(a<.01)discard;
  vec2 uv=vUv;if(!gl_FrontFacing)uv.x=1.-uv.x;
  vec3 c=mix(vec3(.075),texture2D(map,(uv-.5)*cover+.5).rgb,ready);
  float edge=smoothstep(-.012-px,-.012,d);
  gl_FragColor=vec4(mix(c,vec3(1.),edge*.1),a);
}`;

function detectSoftwareWebGL(): boolean {
  const probeCanvas = document.createElement('canvas');
  const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param) ?? '');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
}

// Reusable math vectors outside the frame loop to prevent per-frame GC
const _op = new THREE.Vector3();
const _ot = new THREE.Vector3();
const _up = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const _vp = new THREE.Vector3();

export function initVanteRibbonScene(refs: RibbonDomRefs): () => void {
  const isSoftwareGl = detectSoftwareWebGL();
  const renderer = new THREE.WebGLRenderer({
    canvas: refs.canvas,
    antialias: !isSoftwareGl,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

  /* ---------- ribbon path ---------- */
  let pathLength = 1;
  const pathP: THREE.Vector3[] = [];
  const pathT: THREE.Vector3[] = [];

  function buildPath(): void {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) {
      const t = i / 160;
      const ph = mix(PH0, PH1, t);
      const cs = Math.cos(ph);
      const u = 2 * t - 1;
      // a shallow arc close to the camera, then long runs far behind it
      const depth = cs > 0 ? 7.6 + 16.4 * cs ** 0.9 : 7.6 + 2.2 * cs;
      const edge = 0.84 + 0.5 * span(0.14 - t, 0, 0.14) + 0.8 * span(t, 0.84, 1);
      pts.push(
        new THREE.Vector3(
          edge * Math.sin(ph) * depth * 0.561,
          0.5 * Math.sign(u) * Math.abs(u) ** 1.4 * depth * 0.63,
          -depth,
        ),
      );
    }
    const path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    path.arcLengthDivisions = 1500;
    pathLength = path.getLength();
    pathP.length = 0;
    pathT.length = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const u = i / SAMPLES;
      pathP.push(path.getPointAt(u));
      pathT.push(path.getTangentAt(u));
    }
  }

  function at(s: number, op: THREE.Vector3, ot: THREE.Vector3): void {
    const f = clamp(s / pathLength) * SAMPLES;
    const i = Math.min(SAMPLES - 1, Math.floor(f));
    const k = f - i;
    op.lerpVectors(pathP[i], pathP[i + 1], k);
    ot.lerpVectors(pathT[i], pathT[i + 1], k).normalize();
  }

  /* ---------- cards ---------- */
  const cards: RibbonCard[] = WORK.map(([title, src], i) => {
    const url = R2 + src;
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('playsinline', '');
    v.src = url;

    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;

    const geo = new THREE.PlaneGeometry(1, 1, NX, NY);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: fs,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: tex },
        cover: { value: new THREE.Vector2(1, 1) },
        aspect: { value: CARD_W / CARD_H },
        ready: { value: 0 },
        radius: { value: 0.018 },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);

    const card: RibbonCard = {
      i,
      title,
      url,
      v,
      tex,
      geo,
      mat,
      mesh,
      rect: null,
      failed: false,
      onLoadedData: () => {
        if (v.videoWidth > 0 && v.videoHeight > 0) {
          const va = v.videoWidth / v.videoHeight;
          const ca = CARD_W / CARD_H;
          mat.uniforms.cover.value.set(va > ca ? ca / va : 1, va > ca ? 1 : va / ca);
          mat.uniforms.ready.value = 1;
          card.failed = false;
        }
      },
      onError: () => {
        card.failed = true;
        mat.uniforms.ready.value = 0;
        const code = v.error?.code ?? 'unknown';
        const message = v.error?.message ?? 'Media load failed';
        console.error(`[Vante] Video failed to load (${title}): ${url} (code ${code}: ${message})`);
      },
    };

    v.addEventListener('loadeddata', card.onLoadedData);
    v.addEventListener('error', card.onError);
    return card;
  });

  /* ---------- layout ---------- */
  let W = 1;
  let H = 1;
  let asp = 1;
  let cols = 3;
  let rows = 2;
  let tanH = 0.3153;

  function resize(): void {
    W = window.innerWidth;
    H = window.innerHeight;
    asp = W / Math.max(1, H);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H, false);
    camera.aspect = asp;
    camera.fov = asp < 16 / 9 ? (Math.atan(0.561 / asp) * 360) / Math.PI : FOV;
    camera.updateProjectionMatrix();
    tanH = Math.tan((camera.fov * Math.PI) / 360);
    cols = asp < 0.9 ? 2 : 3;
    rows = asp < 0.9 ? 3 : 2;
  }

  window.addEventListener('resize', resize);
  resize();
  buildPath();

  function grid(i: number): GridRect {
    const vh = 2 * GZ * tanH;
    const vw = vh * asp;
    const gw = vw * (cols === 3 ? 0.74 : 0.88);
    const gap = gw * 0.017;
    const cw = (gw - gap * (cols - 1)) / cols;
    const ch = cw / (CARD_W / CARD_H);
    const gh = ch * rows + gap * 1.6 * (rows - 1);
    const c = i % cols;
    const r = Math.floor(i / cols);
    return {
      x: -gw / 2 + cw / 2 + c * (cw + gap),
      y: gh / 2 - ch / 2 - r * (ch + gap * 1.6),
      w: cw,
      h: ch,
      vw,
      vh,
      c,
      r,
    };
  }

  /* ---------- scroll ---------- */
  let target = 0;
  let p = 0;

  const readScroll = (): void => {
    // Progress is local to this gallery section, not the whole document.
    // This lets the ribbon begin at 0 when the visitor reaches this section.
    const rect = refs.track.getBoundingClientRect();
    const maxScroll = Math.max(1, refs.track.offsetHeight - window.innerHeight);
    target = clamp(-rect.top / maxScroll);
  };
  window.addEventListener('scroll', readScroll, { passive: true });
  readScroll();

  /* ---------- pose ---------- */
  function poseRibbon(c: RibbonCard, head: number): void {
    const pos = c.geo.attributes.position as THREE.BufferAttribute;
    const centre = head - c.i * STEP;
    for (let iy = 0; iy <= NY; iy++) {
      for (let ix = 0; ix <= NX; ix++) {
        const k = iy * (NX + 1) + ix;
        const lu = ix / NX - 0.5;
        const lv = 0.5 - iy / NY;
        at(centre + lu * CARD_W, _op, _ot);
        // keep the sheet upright, leaning a little into the turn
        _up.copy(_Y).addScaledVector(_ot, -_Y.dot(_ot)).normalize();
        _vp.copy(_op).addScaledVector(_up, lv * CARD_H);
        pos.setXYZ(k, _vp.x, _vp.y, _vp.z);
      }
    }
    pos.needsUpdate = true;
  }

  function poseGrid(c: RibbonCard, q: number): void {
    const g = grid(c.i);
    const pos = c.geo.attributes.position as THREE.BufferAttribute;
    const dx = (g.c - (cols - 1) / 2) * 1.2;
    const dy = g.r < rows / 2 ? 1 : -1;
    const ox = dx * g.vw * 0.62 * (1 - q);
    const oy = dy * g.vh * (g.c === 1 ? 0.95 : 0.34) * (1 - q);
    const tilt = (1 - q) * 0.22 * (g.c - 1 || 0.5) * dy;
    const cs = Math.cos(tilt);
    const sn = Math.sin(tilt);
    for (let iy = 0; iy <= NY; iy++) {
      for (let ix = 0; ix <= NX; ix++) {
        const k = iy * (NX + 1) + ix;
        const x = (ix / NX - 0.5) * g.w;
        const y = (0.5 - iy / NY) * g.h;
        pos.setXYZ(
          k,
          g.x + ox + x * cs - y * sn,
          g.y + oy + x * sn + y * cs,
          -GZ - (1 - q) * 0.6 * Math.sin((ix / NX) * Math.PI),
        );
      }
    }
    pos.needsUpdate = true;
    c.rect = g;
  }

  function render(): void {
    const pp = p;
    // headline runs right across the page in opposite directions
    const rise = 1 - out(span(pp, 0, 0.12));
    const run = mix(-50, 76, span(pp, 0, 0.58));
    refs.l1.style.transform = `translate3d(${run}vw,${rise * 34}vh,0)`;
    refs.l2.style.transform = `translate3d(${-run}vw,${rise * 34}vh,0)`;

    const capA = 1 - span(pp, 0.52, 0.57);
    refs.cap.style.opacity = String(capA);
    refs.cap.style.transform = `translate(-50%,calc(-50% + ${rise * 34}vh))`;

    const intro = String(1 - span(pp, 0, 0.05));
    refs.hint.style.opacity = intro;
    refs.glow.style.opacity = intro;

    // ribbon, then the grid
    const pr = span(pp, RIB_A, RIB_B);
    const head = mix(0, pathLength + cards.length * STEP, pr);
    for (const c of cards) {
      const s = head - c.i * STEP;
      const end = pathLength - CARD_W;
      if (s < end) {
        c.mesh.visible = s > CARD_W;
        c.rect = null;
        if (c.mesh.visible) poseRibbon(c, head);
      } else if (c.i < cols * rows) {
        // each card flies to its slot the moment it leaves the rail
        const st = mix(RIB_A, RIB_B, (end + c.i * STEP) / (pathLength + cards.length * STEP));
        const q = out(span(pp, st, st + 0.13));
        c.mesh.visible = q > 0.001;
        if (c.mesh.visible) poseGrid(c, q);
      } else {
        c.mesh.visible = false;
        c.rect = null;
      }
    }
    renderer.render(scene, camera);
  }

  /* ---------- hover ---------- */
  const onPointerMove = (e: PointerEvent): void => {
    let hit: RibbonCard | null = null;
    if (p > 0.86) {
      const nx = e.clientX / W - 0.5;
      const ny = 0.5 - e.clientY / H;
      for (const c of cards) {
        const g = c.rect;
        if (!g) continue;
        const x = nx * g.vw;
        const y = ny * g.vh;
        if (Math.abs(x - g.x) < g.w / 2 && Math.abs(y - g.y) < g.h / 2) hit = c;
      }
    }
    refs.name.style.opacity = hit ? '1' : '0';
    if (hit) {
      refs.name.textContent = hit.title;
      refs.name.style.transform = `translate(${e.clientX + 14}px,${e.clientY + 16}px)`;
    }
  };

  const onPointerLeave = (): void => {
    refs.name.style.opacity = '0';
  };

  refs.stage.addEventListener('pointermove', onPointerMove);
  refs.stage.addEventListener('pointerleave', onPointerLeave);

  if (!isSoftwareGl) {
    renderer.compile(scene, camera);
  }

  /* ---------- loop ---------- */
  let disposed = false;
  let rafId = 0;
  let lastTime = 0;

  function loop(now: number): void {
    if (disposed) return;

    const dt = lastTime > 0 ? Math.min(1000, now - lastTime) : 1000 / 60;
    lastTime = now;
    const alpha = 1 - Math.pow(1 - 0.09, dt / (1000 / 60));

    p += (target - p) * alpha;
    if (Math.abs(target - p) < 0.00005) p = target;

    for (const c of cards) {
      if (c.mesh.visible && !c.failed && c.v.paused) {
        c.v.play().catch(() => {
          // Autoplay or transient load interruption; keep placeholder visible without crashing
        });
      } else if (!c.mesh.visible && !c.v.paused) {
        c.v.pause();
      }
    }

    render();
    rafId = requestAnimationFrame(loop);
  }

  rafId = requestAnimationFrame(loop);

  /* ---------- cleanup ---------- */
  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);

    window.removeEventListener('resize', resize);
    window.removeEventListener('scroll', readScroll);
    refs.stage.removeEventListener('pointermove', onPointerMove);
    refs.stage.removeEventListener('pointerleave', onPointerLeave);

    for (const c of cards) {
      c.v.removeEventListener('loadeddata', c.onLoadedData);
      c.v.removeEventListener('error', c.onError);
      c.v.pause();
      c.v.removeAttribute('src');
      c.v.load();
      scene.remove(c.mesh);
      c.geo.dispose();
      c.mat.dispose();
      c.tex.dispose();
    }

    renderer.dispose();
  };
}


