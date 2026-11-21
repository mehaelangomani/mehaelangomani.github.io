import * as THREE from 'three';
import { MATCAP_DATA_URI } from './matcap';
import {
  ADVECT_FRAG,
  CLEAR_PRESSURE_FRAG,
  COPY_FRAG,
  CURL_FRAG,
  DIVERGENCE_FRAG,
  FLUID_MASK_FRAG,
  GRADIENT_SUBTRACT_FRAG,
  PARTICLE_SIM_FRAG,
  POINTS_FRAG,
  POINTS_VERT,
  PRESSURE_FRAG,
  QUAD_VERT,
  SPLAT_FRAG,
  VORTICITY_FRAG,
} from './shaders';

interface DoubleFBO {
  read: THREE.WebGLRenderTarget;
  write: THREE.WebGLRenderTarget;
  swap: () => void;
  dispose: () => void;
}

export interface AxonDiagnostics {
  webglVersion: 'webgl2' | 'webgl1' | 'none';
  gpuRenderer: string;
  isSoftwareGl: boolean;
  tier: 'full-float' | 'half-float' | 'cpu-fallback';
  particleCount: number;
  simResolution: number;
  fluidSimRes: number;
  fluidDyeRes: number;
  fboComplete: boolean;
  shadersCompiled: boolean;
}

export interface AxonSceneOptions {
  onError?: (err: Error) => void;
  onDiagnostics?: (diag: AxonDiagnostics) => void;
}

const CPU_POINTS_VERT = `
attribute vec4 random;
uniform float uDpr;
varying vec4 vRandom;
varying float vScale;

void main() {
  vec3 pos = position * mix(1.0, 1.5, pow(random.y, 150.0));
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float distToCamera = -mvPosition.z;
  float scale = smoothstep(1.5, 12.0, distToCamera) * mix(0.5, 1.0, random.z);

  vScale = scale;
  vRandom = random;
  float sizeVariation = mix(0.68, 1.18, random.x);
  gl_PointSize = 0.024 * uDpr * 2.0 * scale * sizeVariation
    * (1000.0 / max(distToCamera, 0.1));
  gl_Position = projectionMatrix * mvPosition;
}
`;

function clampMap(
  val: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const t = Math.max(0, Math.min(1, (val - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

function createSynchronousMatcapCanvas(): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = 1 - ((y + 0.5) / size) * 2;
      const r2 = nx * nx + ny * ny;
      let v = 0;
      let a = 0;
      if (r2 <= 1.0) {
        const nz = Math.sqrt(Math.max(0, 1 - r2));
        const l1 = Math.max(0, nx * -0.45 + ny * 0.55 + nz * 0.7);
        const spec = Math.pow(Math.max(0, nx * -0.35 + ny * 0.45 + nz * 0.82), 16);
        const rim = Math.pow(1 - nz, 2.2) * 0.25;
        const lum = Math.min(1, 0.2 + l1 * 0.65 + spec * 0.35 + rim);
        const edge = Math.min(1, Math.max(0, (1 - Math.sqrt(r2)) * 10));
        v = Math.round(lum * 255);
        a = Math.round(edge * 255);
      }
      const idx = (y * size + x) * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = a;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export class AxonParticleScene {
  private canvas: HTMLCanvasElement;
  private options: AxonSceneOptions;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private pointsGroup!: THREE.Group;
  private quadScene!: THREE.Scene;
  private quadCamera!: THREE.OrthographicCamera;
  private quadMesh!: THREE.Mesh;

  private isSoftwareGl = false;
  private isMobile = false;
  private dpr = 1;
  private disposed = false;
  private frameId = 0;
  private scrollProgress = 0;

  // Capability tier
  private tier: 'full-float' | 'half-float' | 'cpu-fallback' = 'full-float';
  private simSize = 512;
  private simRes = 256;
  private dyeRes = 512;
  private posTargetType: THREE.TextureDataType = THREE.FloatType;
  private fluidTargetType: THREE.TextureDataType = THREE.HalfFloatType;
  private fluidFilter: THREE.MagnificationTextureFilter = THREE.LinearFilter;

  // Fluid targets
  private velocity: DoubleFBO | null = null;
  private density: DoubleFBO | null = null;
  private pressure: DoubleFBO | null = null;
  private divergence: THREE.WebGLRenderTarget | null = null;
  private curl: THREE.WebGLRenderTarget | null = null;
  private fluidMask: THREE.WebGLRenderTarget | null = null;

  // Fluid materials
  private splatMat: THREE.ShaderMaterial | null = null;
  private curlMat: THREE.ShaderMaterial | null = null;
  private vorticityMat: THREE.ShaderMaterial | null = null;
  private divergenceMat: THREE.ShaderMaterial | null = null;
  private clearPressureMat: THREE.ShaderMaterial | null = null;
  private pressureMat: THREE.ShaderMaterial | null = null;
  private gradSubtractMat: THREE.ShaderMaterial | null = null;
  private advectMat: THREE.ShaderMaterial | null = null;
  private fluidMaskMat: THREE.ShaderMaterial | null = null;
  private simTexel = new THREE.Vector2();
  private dyeTexel = new THREE.Vector2();

  // Particle simulation & rendering
  private posTargets: DoubleFBO | null = null;
  private originTex: THREE.DataTexture | null = null;
  private copyMat: THREE.ShaderMaterial | null = null;
  private particleSimMat: THREE.ShaderMaterial | null = null;
  private pointsMat!: THREE.ShaderMaterial;
  private pointsGeom!: THREE.BufferGeometry;
  private pointsObj!: THREE.Points;
  private matcapTex!: THREE.Texture;

  // CPU fallback state (only used when float & half-float FBOs are unsupported)
  private cpuPos: Float32Array | null = null;
  private cpuOrigin: Float32Array | null = null;
  private cpuVelX = 0;
  private cpuVelY = 0;
  private cpuDensity = 0;

  // Interaction & timing state
  private baseCamPos = new THREE.Vector3(-1.17, 0, 6);
  private targetCamPos = new THREE.Vector3(-1.17, 0, 6);
  private sceneProjView = new THREE.Matrix4();
  private invModelMatrix = new THREE.Matrix4();
  private mouseNormX = 0;
  private mouseNormY = 0;
  private hasPointer = false;
  private lastMousePx = { x: 0, y: 0 };
  private curMousePx = { x: 0, y: 0 };
  private prevSplatPx = { x: 0, y: 0 };
  private lastSplatTime = 0;
  private clockStart = performance.now();
  private lastFrameTime = performance.now();

  // Reusable math vectors
  private pointA = new THREE.Vector2();
  private pointB = new THREE.Vector2();
  private splatColor = new THREE.Vector3();
  private tmpVec3 = new THREE.Vector3();

  // Bound listeners
  private onMouseMoveBound: (e: MouseEvent) => void;
  private onTouchStartBound: (e: TouchEvent) => void;
  private onTouchMoveBound: (e: TouchEvent) => void;
  private onResizeBound: () => void;
  private onContextLostBound: (e: Event) => void;
  private onContextRestoredBound: () => void;

  constructor(canvas: HTMLCanvasElement, options: AxonSceneOptions = {}) {
    this.canvas = canvas;
    this.options = options;
    this.isMobile =
      window.innerWidth <= 760 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    this.onMouseMoveBound = this.handleMouseMove.bind(this);
    this.onTouchStartBound = this.handleTouchStart.bind(this);
    this.onTouchMoveBound = this.handleTouchMove.bind(this);
    this.onResizeBound = this.handleResize.bind(this);
    this.onContextLostBound = (e: Event) => {
      e.preventDefault();
      this.stopLoop();
    };
    this.onContextRestoredBound = () => {
      this.disposeResources();
      this.initResources();
      this.startLoop();
    };

    try {
      this.initRenderer();
      this.initResources();
      this.bindEvents();
      this.startLoop();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (import.meta.env.DEV) {
        console.error('[AXON WebGL] Initialization error:', error);
      }
      this.options.onError?.(error);
    }
  }

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });

    const gl = this.renderer.getContext();
    if (!gl) {
      throw new Error('WebGL context unavailable on this device.');
    }

    const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererParam = debugExt ? debugExt.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpuRenderer = String(gl.getParameter(rendererParam) || 'Unknown GPU');
    this.isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpuRenderer);

    this.dpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.setClearColor(0x000000, 1);

    // Enable floating-point FBO & texture extensions
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('WEBGL_color_buffer_float');
    gl.getExtension('OES_texture_float');
    gl.getExtension('OES_texture_float_linear');
    gl.getExtension('OES_texture_half_float');
    gl.getExtension('OES_texture_half_float_linear');

    const floatNearestOk = this.testRenderTargetCompleteness(
      THREE.FloatType,
      THREE.NearestFilter,
    );
    const halfFloatLinearOk = this.testRenderTargetCompleteness(
      THREE.HalfFloatType,
      THREE.LinearFilter,
    );
    const halfFloatNearestOk =
      halfFloatLinearOk ||
      this.testRenderTargetCompleteness(THREE.HalfFloatType, THREE.NearestFilter);

    if (floatNearestOk && halfFloatNearestOk) {
      this.tier = 'full-float';
      this.posTargetType = THREE.FloatType;
      this.fluidTargetType = THREE.HalfFloatType;
      this.fluidFilter = halfFloatLinearOk ? THREE.LinearFilter : THREE.NearestFilter;
      this.simSize = this.isMobile ? 128 : 512;
      this.simRes = 256;
      this.dyeRes = 512;
    } else if (halfFloatNearestOk) {
      this.tier = 'half-float';
      this.posTargetType = THREE.HalfFloatType;
      this.fluidTargetType = THREE.HalfFloatType;
      this.fluidFilter = halfFloatLinearOk ? THREE.LinearFilter : THREE.NearestFilter;
      this.simSize = this.isMobile ? 128 : 256;
      this.simRes = 128;
      this.dyeRes = 256;
    } else {
      this.tier = 'cpu-fallback';
      this.simSize = this.isMobile ? 64 : 128;
      this.simRes = 0;
      this.dyeRes = 0;
    }

    const diag: AxonDiagnostics = {
      webglVersion: this.renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl1',
      gpuRenderer,
      isSoftwareGl: this.isSoftwareGl,
      tier: this.tier,
      particleCount: this.simSize * this.simSize,
      simResolution: this.simSize,
      fluidSimRes: this.simRes,
      fluidDyeRes: this.dyeRes,
      fboComplete: this.tier !== 'cpu-fallback',
      shadersCompiled: true,
    };

    if (import.meta.env.DEV) {
      console.info('[AXON WebGL] Diagnostics:', diag);
    }
    this.options.onDiagnostics?.(diag);
  }

  private testRenderTargetCompleteness(
    type: THREE.TextureDataType,
    filter: THREE.MagnificationTextureFilter,
  ): boolean {
    const gl = this.renderer.getContext();
    let rt: THREE.WebGLRenderTarget | null = null;
    try {
      rt = new THREE.WebGLRenderTarget(4, 4, {
        minFilter: filter,
        magFilter: filter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        format: THREE.RGBAFormat,
        type,
        depthBuffer: false,
        stencilBuffer: false,
      });
      this.renderer.setRenderTarget(rt);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      this.renderer.setRenderTarget(null);
      return status === gl.FRAMEBUFFER_COMPLETE;
    } catch {
      this.renderer.setRenderTarget(null);
      return false;
    } finally {
      rt?.dispose();
    }
  }

  private createFBO(
    w: number,
    h: number,
    type: THREE.TextureDataType,
    filter: THREE.MagnificationTextureFilter,
  ): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: filter,
      magFilter: filter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private createDoubleFBO(
    w: number,
    h: number,
    type: THREE.TextureDataType,
    filter: THREE.MagnificationTextureFilter,
  ): DoubleFBO {
    let fbo1 = this.createFBO(w, h, type, filter);
    let fbo2 = this.createFBO(w, h, type, filter);
    return {
      get read() {
        return fbo1;
      },
      get write() {
        return fbo2;
      },
      swap() {
        const tmp = fbo1;
        fbo1 = fbo2;
        fbo2 = tmp;
      },
      dispose() {
        fbo1.dispose();
        fbo2.dispose();
      },
    };
  }

  private initResources(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 1000);
    this.camera.position.copy(this.baseCamPos);
    this.camera.lookAt(0, 0, 0);

    this.pointsGroup = new THREE.Group();
    this.pointsGroup.position.set(-0.08, -0.2, -1);
    this.pointsGroup.rotation.set(
      THREE.MathUtils.degToRad(-28.4),
      THREE.MathUtils.degToRad(390),
      THREE.MathUtils.degToRad(4.92),
    );
    this.pointsGroup.scale.set(5, 5, 6);
    this.scene.add(this.pointsGroup);

    // Synchronous matcap texture on Frame 0, then upgrade with embedded MATCAP_DATA_URI
    const matcapCanvas = createSynchronousMatcapCanvas();
    this.matcapTex = new THREE.CanvasTexture(matcapCanvas);
    this.matcapTex.wrapS = THREE.ClampToEdgeWrapping;
    this.matcapTex.wrapT = THREE.ClampToEdgeWrapping;
    this.matcapTex.minFilter = THREE.LinearFilter;
    this.matcapTex.magFilter = THREE.LinearFilter;
    this.matcapTex.needsUpdate = true;

    const matcapImg = new Image();
    matcapImg.onload = () => {
      if (!this.disposed) {
        this.matcapTex.image = matcapImg;
        this.matcapTex.needsUpdate = true;
      }
    };
    matcapImg.src = MATCAP_DATA_URI;

    if (this.tier === 'cpu-fallback') {
      this.initCpuFallbackParticles();
      return;
    }

    // Fullscreen quad scene for simulation passes
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    const quadGeom = new THREE.PlaneGeometry(2, 2);
    this.quadMesh = new THREE.Mesh(quadGeom, new THREE.MeshBasicMaterial());
    this.quadScene.add(this.quadMesh);

    // Fluid FBOs
    this.velocity = this.createDoubleFBO(
      this.simRes,
      this.simRes,
      this.fluidTargetType,
      this.fluidFilter,
    );
    this.density = this.createDoubleFBO(
      this.dyeRes,
      this.dyeRes,
      this.fluidTargetType,
      this.fluidFilter,
    );
    this.pressure = this.createDoubleFBO(
      this.simRes,
      this.simRes,
      this.fluidTargetType,
      THREE.NearestFilter,
    );
    this.divergence = this.createFBO(
      this.simRes,
      this.simRes,
      this.fluidTargetType,
      THREE.NearestFilter,
    );
    this.curl = this.createFBO(
      this.simRes,
      this.simRes,
      this.fluidTargetType,
      THREE.NearestFilter,
    );
    this.fluidMask = this.createFBO(w, h, this.fluidTargetType, this.fluidFilter);

    this.simTexel.set(1 / this.simRes, 1 / this.simRes);
    this.dyeTexel.set(1 / this.dyeRes, 1 / this.dyeRes);

    // Fluid shader materials
    this.splatMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SPLAT_FRAG,
      uniforms: {
        uTarget: { value: null },
        uAspect: { value: w / h },
        uPointA: { value: this.pointA },
        uPointB: { value: this.pointB },
        uColor: { value: this.splatColor },
        uRadius: { value: 0.05 },
        uIsDensity: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.curlMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: CURL_FRAG,
      uniforms: {
        uVelocity: { value: null },
        uTexelSize: { value: this.simTexel },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.vorticityMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: VORTICITY_FRAG,
      uniforms: {
        uVelocity: { value: null },
        uCurl: { value: null },
        uTexelSize: { value: this.simTexel },
        uCurlStrength: { value: 30.0 },
        uDt: { value: 1 / 60 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.divergenceMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: DIVERGENCE_FRAG,
      uniforms: {
        uVelocity: { value: null },
        uTexelSize: { value: this.simTexel },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.clearPressureMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: CLEAR_PRESSURE_FRAG,
      uniforms: {
        uTexture: { value: null },
        uValue: { value: 0.95 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.pressureMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: PRESSURE_FRAG,
      uniforms: {
        uPressure: { value: null },
        uDivergence: { value: null },
        uTexelSize: { value: this.simTexel },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.gradSubtractMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: GRADIENT_SUBTRACT_FRAG,
      uniforms: {
        uPressure: { value: null },
        uVelocity: { value: null },
        uTexelSize: { value: this.simTexel },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.advectMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: ADVECT_FRAG,
      uniforms: {
        uVelocity: { value: null },
        uSource: { value: null },
        uTexelSize: { value: this.simTexel.clone() },
        uDt: { value: 1 / 60 },
        uDissipation: { value: 0.98 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.fluidMaskMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: FLUID_MASK_FRAG,
      uniforms: {
        uDensity: { value: null },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Particle ping-pong position FBOs
    this.posTargets = this.createDoubleFBO(
      this.simSize,
      this.simSize,
      this.posTargetType,
      THREE.NearestFilter,
    );

    const count = this.simSize * this.simSize;
    const originData = new Float32Array(count * 4);
    const uvPositions = new Float32Array(count * 3);
    const randomAttribs = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
      const col = i % this.simSize;
      const row = Math.floor(i / this.simSize);

      originData[i * 4] = Math.random() * 2 - 1;
      originData[i * 4 + 1] = Math.random() * 2 - 1;
      originData[i * 4 + 2] = Math.random() * 2 - 1;
      originData[i * 4 + 3] = 1.0;

      uvPositions[i * 3] = (col + 0.5) / this.simSize;
      uvPositions[i * 3 + 1] = (row + 0.5) / this.simSize;
      uvPositions[i * 3 + 2] = 0;

      randomAttribs[i * 4] = Math.random();
      randomAttribs[i * 4 + 1] = Math.random();
      randomAttribs[i * 4 + 2] = Math.random();
      randomAttribs[i * 4 + 3] = Math.random();
    }

    this.originTex = new THREE.DataTexture(
      originData,
      this.simSize,
      this.simSize,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.originTex.minFilter = THREE.NearestFilter;
    this.originTex.magFilter = THREE.NearestFilter;
    this.originTex.needsUpdate = true;

    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: COPY_FRAG,
      uniforms: {
        uTex: { value: this.originTex },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.blit(this.copyMat, this.posTargets.read);
    this.blit(this.copyMat, this.posTargets.write);

    this.pointsGroup.updateMatrixWorld();
    this.invModelMatrix.copy(this.pointsGroup.matrixWorld).invert();

    this.particleSimMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: PARTICLE_SIM_FRAG,
      uniforms: {
        uPositions: { value: this.posTargets.read.texture },
        uOrigin: { value: this.originTex },
        uFluidVelocity: { value: this.velocity.read.texture },
        uFluidDensity: { value: this.fluidMask.texture },
        uTime: { value: 0 },
        uHz: { value: 1 },
        uSceneProjView: { value: this.sceneProjView },
        uModelMatrix: { value: this.pointsGroup.matrixWorld },
        uInvModelMatrix: { value: this.invModelMatrix },
        uCameraWorld: { value: this.camera.matrixWorld },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.pointsGeom = new THREE.BufferGeometry();
    this.pointsGeom.setAttribute('position', new THREE.BufferAttribute(uvPositions, 3));
    this.pointsGeom.setAttribute('random', new THREE.BufferAttribute(randomAttribs, 4));

    this.pointsMat = new THREE.ShaderMaterial({
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      uniforms: {
        uPositions: { value: this.posTargets.read.texture },
        uDpr: { value: this.dpr },
        uTime: { value: 0 },
        uMatcap: { value: this.matcapTex },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });

    this.pointsObj = new THREE.Points(this.pointsGeom, this.pointsMat);
    this.pointsObj.frustumCulled = false;
    this.pointsGroup.add(this.pointsObj);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    if (import.meta.env.DEV) {
      const gl = this.renderer.getContext();
      this.stepFluid(performance.now());
      this.blit(this.particleSimMat, this.posTargets.write);
      this.posTargets.swap();
      const glErr = gl.getError();
      if (glErr !== gl.NO_ERROR) {
        console.warn('[AXON WebGL] Post-compile GL error code:', glErr);
      }
    }
  }

  private initCpuFallbackParticles(): void {
    const count = this.simSize * this.simSize;
    this.cpuPos = new Float32Array(count * 3);
    this.cpuOrigin = new Float32Array(count * 3);
    const randomAttribs = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
      const ox = Math.random() * 2 - 1;
      const oy = Math.random() * 2 - 1;
      const oz = Math.random() * 2 - 1;
      this.cpuOrigin[i * 3] = ox;
      this.cpuOrigin[i * 3 + 1] = oy;
      this.cpuOrigin[i * 3 + 2] = oz;
      this.cpuPos[i * 3] = ox * 0.5;
      this.cpuPos[i * 3 + 1] = oy * 0.5;
      this.cpuPos[i * 3 + 2] = oz * 0.5;

      randomAttribs[i * 4] = Math.random();
      randomAttribs[i * 4 + 1] = Math.random();
      randomAttribs[i * 4 + 2] = Math.random();
      randomAttribs[i * 4 + 3] = Math.random();
    }

    this.pointsGeom = new THREE.BufferGeometry();
    this.pointsGeom.setAttribute('position', new THREE.BufferAttribute(this.cpuPos, 3));
    this.pointsGeom.setAttribute('random', new THREE.BufferAttribute(randomAttribs, 4));

    this.pointsMat = new THREE.ShaderMaterial({
      vertexShader: CPU_POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      uniforms: {
        uDpr: { value: this.dpr },
        uTime: { value: 0 },
        uMatcap: { value: this.matcapTex },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });

    this.pointsObj = new THREE.Points(this.pointsGeom, this.pointsMat);
    this.pointsObj.frustumCulled = false;
    this.pointsGroup.add(this.pointsObj);
  }

  private stepCpuFallback(elapsed: number, hz: number): void {
    if (!this.cpuPos || !this.cpuOrigin) return;

    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);

    if (this.hasPointer) {
      const dx = this.curMousePx.x - this.lastMousePx.x;
      const dy = this.curMousePx.y - this.lastMousePx.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.01) {
        const mult = clampMap(len, 0, 15, 0, 10);
        this.cpuVelX += dx * mult * 0.002;
        this.cpuVelY += -dy * mult * 0.002;
        this.cpuDensity = 1.0;
      }
      this.lastMousePx.x = this.curMousePx.x;
      this.lastMousePx.y = this.curMousePx.y;
    }

    this.cpuVelX *= 0.96;
    this.cpuVelY *= 0.96;
    this.cpuDensity *= 0.96;

    const pointerNdcX = (this.curMousePx.x / w) * 2 - 1;
    const pointerNdcY = -(this.curMousePx.y / h) * 2 + 1;

    const smin = (a: number, b: number, k: number) => {
      const hm = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
      return b * (1 - hm) + a * hm - k * hm * (1 - hm);
    };

    const sdf = (px: number, py: number, pz: number) => {
      const lp = Math.hypot(px, py, pz);
      if (lp > 0.8) return lp - 0.7;
      const mz = Math.sqrt(pz * pz + 0.0215) - Math.sqrt(0.012);
      const nx = mz;
      const ny = px;
      const nz = py;
      const twist = ny * 1.8;
      const ct = Math.cos(twist);
      const st = Math.sin(twist);
      const rx = ct * nx - st * nz;
      const ry = ny;
      const rz = st * nx + ct * nz;
      const dTor = Math.hypot(Math.hypot(rx, rz) - 0.255, ry + 0.035 * Math.sin(rx * 6.0)) - 0.082;
      const p2x = rx * 0.85 - ry * 0.52;
      const p2y = rx * 0.52 + ry * 0.85;
      const dLob = Math.hypot(Math.hypot(p2x, p2y) - 0.215, rz) - 0.062;
      const d = smin(dTor, dLob, 0.085);
      const sn =
        (Math.sin(rx * 9 + ry * 5) * Math.cos(ry * 8 + rz * 6) + Math.sin(rz * 10 - rx * 4)) *
        0.018;
      return d + sn;
    };

    const count = this.cpuPos.length / 3;
    const eps = 0.002;
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      let px = this.cpuPos[idx];
      let py = this.cpuPos[idx + 1];
      let pz = this.cpuPos[idx + 2];

      if (Math.hypot(px, py, pz) > 0.7) {
        px *= 0.5;
        py *= 0.5;
        pz *= 0.5;
      }

      const d = sdf(px, py, pz);
      const gx = (sdf(px + eps, py, pz) - sdf(px - eps, py, pz)) / (2 * eps);
      const gy = (sdf(px, py + eps, pz) - sdf(px, py - eps, pz)) / (2 * eps);
      const gz = (sdf(px, py, pz + eps) - sdf(px, py, pz - eps)) / (2 * eps);
      const gl = Math.hypot(gx, gy, gz) || 1;
      const nx = gx / gl;
      const ny = gy / gl;
      const nz = gz / gl;

      // Subtle swirl & cursor disturbance
      const pl = Math.hypot(px, py, pz) || 1;
      px += ((py * nz - pz * ny) / pl) * 0.0005 * hz;
      py += ((pz * nx - px * nz) / pl) * 0.0005 * hz;
      pz += ((px * ny - py * nx) / pl) * 0.0005 * hz;

      if (this.cpuDensity > 0.01) {
        this.tmpVec3.set(px, py, pz).applyMatrix4(this.pointsGroup.matrixWorld).project(this.camera);
        const distCursor = Math.hypot(this.tmpVec3.x - pointerNdcX, this.tmpVec3.y - pointerNdcY);
        const mask = Math.exp(-distCursor * distCursor * 8.0) * this.cpuDensity;
        px += this.cpuVelX * mask * hz;
        py += this.cpuVelY * mask * hz;
      }

      const pull = 0.45 * (1 - 0.75 * this.cpuDensity);
      px += -nx * d * pull + (this.cpuOrigin[idx] - px) * 0.0002 * hz;
      py += -ny * d * pull + (this.cpuOrigin[idx + 1] - py) * 0.0002 * hz;
      pz += -nz * d * pull + (this.cpuOrigin[idx + 2] - pz) * 0.0002 * hz;

      // Subtle curl drift
      px += Math.sin(py * 3 + elapsed) * 0.0002 * hz;
      py += Math.cos(pz * 3 + elapsed) * 0.0002 * hz;
      pz += Math.sin(px * 3 + elapsed) * 0.0002 * hz;

      this.cpuPos[idx] = px;
      this.cpuPos[idx + 1] = py;
      this.cpuPos[idx + 2] = pz;
    }

    const attr = this.pointsGeom.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }

  private blit(material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quadMesh.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.setRenderTarget(null);
  }

  private bindEvents(): void {
    window.addEventListener('mousemove', this.onMouseMoveBound, { passive: true });
    window.addEventListener('touchstart', this.onTouchStartBound, { passive: true });
    window.addEventListener('touchmove', this.onTouchMoveBound, { passive: true });
    window.addEventListener('resize', this.onResizeBound);
    this.canvas.addEventListener('webglcontextlost', this.onContextLostBound);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestoredBound);
  }

  private unbindEvents(): void {
    window.removeEventListener('mousemove', this.onMouseMoveBound);
    window.removeEventListener('touchstart', this.onTouchStartBound);
    window.removeEventListener('touchmove', this.onTouchMoveBound);
    window.removeEventListener('resize', this.onResizeBound);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLostBound);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestoredBound);
  }

  private updatePointer(clientX: number, clientY: number): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);

    this.mouseNormX = (clientX / w) * 2 - 1;
    this.mouseNormY = (clientY / h) * 2 - 1;

    if (!this.hasPointer) {
      this.hasPointer = true;
      this.lastMousePx.x = clientX;
      this.lastMousePx.y = clientY;
      this.prevSplatPx.x = clientX;
      this.prevSplatPx.y = clientY;
    }
    this.curMousePx.x = clientX;
    this.curMousePx.y = clientY;
  }

  private handleMouseMove(e: MouseEvent): void {
    this.updatePointer(e.clientX, e.clientY);
  }

  private handleTouchStart(e: TouchEvent): void {
    if (e.touches.length > 0) {
      const t = e.touches[0];
      this.hasPointer = false;
      this.updatePointer(t.clientX, t.clientY);
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    if (e.touches.length > 0) {
      const t = e.touches[0];
      this.updatePointer(t.clientX, t.clientY);
    }
  }

  private handleResize(): void {
    if (this.disposed) return;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);

    this.dpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    if (this.fluidMask) {
      this.fluidMask.setSize(w, h);
    }
    if (this.splatMat) {
      this.splatMat.uniforms.uAspect.value = w / h;
    }
    if (this.pointsMat) {
      this.pointsMat.uniforms.uDpr.value = this.dpr;
    }
  }

  private stepFluid(now: number): void {
    if (
      !this.velocity ||
      !this.density ||
      !this.pressure ||
      !this.divergence ||
      !this.curl ||
      !this.fluidMask ||
      !this.splatMat ||
      !this.curlMat ||
      !this.vorticityMat ||
      !this.divergenceMat ||
      !this.clearPressureMat ||
      !this.pressureMat ||
      !this.gradSubtractMat ||
      !this.advectMat ||
      !this.fluidMaskMat
    ) {
      return;
    }

    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dt = 1 / 60;

    if (this.hasPointer) {
      const dx = this.curMousePx.x - this.lastMousePx.x;
      const dy = this.curMousePx.y - this.lastMousePx.y;
      const len = Math.hypot(dx, dy);

      if (len > 0.01) {
        const startX = now - this.lastSplatTime > 50 ? this.curMousePx.x : this.prevSplatPx.x;
        const startY = now - this.lastSplatTime > 50 ? this.curMousePx.y : this.prevSplatPx.y;

        const splatRadius =
          clampMap(len, 0, 5, 0, 60) * 0.6 * (this.isMobile ? 0.8 : 1.0);
        const mult = clampMap(len, 0, 15, 0, 10);
        const radiusUv = Math.max(0.02, splatRadius / 200);

        this.pointA.set(startX / w, 1 - startY / h);
        this.pointB.set(this.curMousePx.x / w, 1 - this.curMousePx.y / h);

        // Splat velocity (additive, scaled for rich fluid swirl)
        this.splatColor.set(dx * mult * 3.5, -dy * mult * 3.5, 1.0);
        this.splatMat.uniforms.uTarget.value = this.velocity.read.texture;
        this.splatMat.uniforms.uRadius.value = radiusUv;
        this.splatMat.uniforms.uIsDensity.value = 0.0;
        this.blit(this.splatMat, this.velocity.write);
        this.velocity.swap();

        // Splat white into density
        this.splatColor.set(1.0, 1.0, 1.0);
        this.splatMat.uniforms.uTarget.value = this.density.read.texture;
        this.splatMat.uniforms.uIsDensity.value = 1.0;
        this.blit(this.splatMat, this.density.write);
        this.density.swap();

        this.prevSplatPx.x = this.curMousePx.x;
        this.prevSplatPx.y = this.curMousePx.y;
        this.lastSplatTime = now;
      }

      this.lastMousePx.x = this.curMousePx.x;
      this.lastMousePx.y = this.curMousePx.y;
    }

    // 1. Curl
    this.curlMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.curlMat, this.curl);

    // 2. Vorticity
    this.vorticityMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.vorticityMat.uniforms.uCurl.value = this.curl.texture;
    this.vorticityMat.uniforms.uDt.value = dt;
    this.blit(this.vorticityMat, this.velocity.write);
    this.velocity.swap();

    // 3. Divergence
    this.divergenceMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.divergenceMat, this.divergence);

    // 4. Pressure dissipation + Jacobi iterations (5)
    this.clearPressureMat.uniforms.uTexture.value = this.pressure.read.texture;
    this.clearPressureMat.uniforms.uValue.value = 0.95;
    this.blit(this.clearPressureMat, this.pressure.write);
    this.pressure.swap();

    this.pressureMat.uniforms.uDivergence.value = this.divergence.texture;
    for (let i = 0; i < 5; i++) {
      this.pressureMat.uniforms.uPressure.value = this.pressure.read.texture;
      this.blit(this.pressureMat, this.pressure.write);
      this.pressure.swap();
    }

    // 5. Gradient subtract
    this.gradSubtractMat.uniforms.uPressure.value = this.pressure.read.texture;
    this.gradSubtractMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.gradSubtractMat, this.velocity.write);
    this.velocity.swap();

    // 6. Advect velocity
    this.advectMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectMat.uniforms.uSource.value = this.velocity.read.texture;
    this.advectMat.uniforms.uTexelSize.value.copy(this.simTexel);
    this.advectMat.uniforms.uDt.value = dt;
    this.advectMat.uniforms.uDissipation.value = 0.98;
    this.blit(this.advectMat, this.velocity.write);
    this.velocity.swap();

    // 7. Advect density
    this.advectMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectMat.uniforms.uSource.value = this.density.read.texture;
    this.advectMat.uniforms.uTexelSize.value.copy(this.dyeTexel);
    this.advectMat.uniforms.uDt.value = dt;
    this.advectMat.uniforms.uDissipation.value = 0.97;
    this.blit(this.advectMat, this.density.write);
    this.density.swap();

    // 8. Render density mask into viewport-sized target
    this.fluidMaskMat.uniforms.uDensity.value = this.density.read.texture;
    this.blit(this.fluidMaskMat, this.fluidMask);
  }

  private tick = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;
    const elapsed = (now - this.clockStart) / 1000;
    const hz = Math.max(0.1, dt * 60);

    // Gaze camera update (scroll progress overrides Z for cinematic zoom)
    const zoomZ = this.baseCamPos.z - this.scrollProgress * 3.5;
    this.targetCamPos.set(
      this.baseCamPos.x + this.mouseNormX * -1,
      this.baseCamPos.y + this.mouseNormY * 2,
      zoomZ,
    );
    const lerpAlpha = 1 - Math.pow(1 - 0.05, hz);
    this.camera.position.lerp(this.targetCamPos, lerpAlpha);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.pointsGroup.updateMatrixWorld();

    this.sceneProjView.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );

    if (this.tier === 'cpu-fallback') {
      this.stepCpuFallback(elapsed, hz);
    } else if (this.posTargets && this.particleSimMat && this.velocity && this.fluidMask) {
      this.stepFluid(now);

      this.particleSimMat.uniforms.uPositions.value = this.posTargets.read.texture;
      this.particleSimMat.uniforms.uFluidVelocity.value = this.velocity.read.texture;
      this.particleSimMat.uniforms.uFluidDensity.value = this.fluidMask.texture;
      this.particleSimMat.uniforms.uTime.value = elapsed;
      this.particleSimMat.uniforms.uHz.value = hz;
      this.blit(this.particleSimMat, this.posTargets.write);
      this.posTargets.swap();

      this.pointsMat.uniforms.uPositions.value = this.posTargets.read.texture;
    }

    this.pointsMat.uniforms.uTime.value = elapsed;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private startLoop(): void {
    this.stopLoop();
    this.lastFrameTime = performance.now();
    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(this.tick, 0);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
  }

  private disposeResources(): void {
    this.velocity?.dispose();
    this.density?.dispose();
    this.pressure?.dispose();
    this.divergence?.dispose();
    this.curl?.dispose();
    this.fluidMask?.dispose();
    this.posTargets?.dispose();
    this.originTex?.dispose();
    this.matcapTex?.dispose();

    this.splatMat?.dispose();
    this.curlMat?.dispose();
    this.vorticityMat?.dispose();
    this.divergenceMat?.dispose();
    this.clearPressureMat?.dispose();
    this.pressureMat?.dispose();
    this.gradSubtractMat?.dispose();
    this.advectMat?.dispose();
    this.fluidMaskMat?.dispose();
    this.copyMat?.dispose();
    this.particleSimMat?.dispose();
    this.pointsMat?.dispose();
    this.pointsGeom?.dispose();
    this.quadMesh?.geometry?.dispose();
    if (this.quadMesh?.material && !Array.isArray(this.quadMesh.material)) {
      this.quadMesh.material.dispose();
    }
  }

  public setScrollProgress(p: number): void {
    this.scrollProgress = Math.min(1, Math.max(0, p));
  }

  public dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.unbindEvents();
    this.disposeResources();
    this.renderer?.dispose();
  }
}
