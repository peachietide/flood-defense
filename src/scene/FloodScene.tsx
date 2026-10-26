import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { N } from '../sim/terrain';
import { frameCamera } from './framing';
import type { GameSim, PlaceResult, Stats, Tool } from '../sim/game';

interface Props {
  sim: GameSim;
  tool: Tool;
  /** 播放倍速：用"多跑几步"实现，保证物理和 1× 完全一致 */
  speed: number;
  onStats: (stats: Stats) => void;
  onPlace: (result: PlaceResult, cell: { x: number; z: number }) => void;
}

// ---------- 配色（与地形高程、水深绑定） ----------
const C_SAND = [0.72, 0.66, 0.48];
const C_GRASS = [0.3, 0.48, 0.28];
const C_FOREST = [0.18, 0.33, 0.2];
const C_ROCK = [0.42, 0.4, 0.38];
const C_WET = [0.16, 0.22, 0.3];
const C_SKIRT = [0.23, 0.2, 0.18];
const W_SHALLOW = [0.5, 0.83, 0.91];
const W_DEEP = [0.05, 0.28, 0.48];

function mix(a: number[], b: number[], t: number, out: Float32Array, i: number): void {
  out[i * 3] = a[0] + (b[0] - a[0]) * t;
  out[i * 3 + 1] = a[1] + (b[1] - a[1]) * t;
  out[i * 3 + 2] = a[2] + (b[2] - a[2]) * t;
}

/**
 * 按高程着色。lo/hi 是当前场景的实际高程范围——
 * 不能用固定值，峡谷的高程是 -17~20，固定基准会把整片压成沙色。
 */
function terrainColorAt(h: number, wet: number, lo: number, hi: number): number[] {
  const span = Math.max(1e-6, hi - lo);
  const t = Math.min(1, Math.max(0, (h - lo) / span));
  let c: number[];
  if (t < 0.22) {
    const k = t / 0.22;
    c = [C_SAND[0] + (C_GRASS[0] - C_SAND[0]) * k, C_SAND[1] + (C_GRASS[1] - C_SAND[1]) * k, C_SAND[2] + (C_GRASS[2] - C_SAND[2]) * k];
  } else if (t < 0.55) {
    const k = (t - 0.22) / 0.33;
    c = [C_GRASS[0] + (C_FOREST[0] - C_GRASS[0]) * k, C_GRASS[1] + (C_FOREST[1] - C_GRASS[1]) * k, C_GRASS[2] + (C_FOREST[2] - C_GRASS[2]) * k];
  } else {
    const k = Math.min(1, (t - 0.55) / 0.45);
    c = [C_FOREST[0] + (C_ROCK[0] - C_FOREST[0]) * k, C_FOREST[1] + (C_ROCK[1] - C_FOREST[1]) * k, C_FOREST[2] + (C_ROCK[2] - C_FOREST[2]) * k];
  }
  if (wet > 0) {
    const k = Math.min(0.72, wet);
    c = [c[0] + (C_WET[0] - c[0]) * k, c[1] + (C_WET[1] - c[1]) * k, c[2] + (C_WET[2] - c[2]) * k];
  }
  return c;
}

export default function FloodScene({ sim, tool, speed, onStats, onPlace }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const toolRef = useRef<Tool>(tool);
  const speedRef = useRef(speed);
  const statsRef = useRef(onStats);
  const placeRef = useRef(onPlace);

  toolRef.current = tool;
  speedRef.current = speed;
  statsRef.current = onStats;
  placeRef.current = onPlace;

  useEffect(() => {
    const containerOrNull = containerRef.current;
    if (!containerOrNull) return;
    const container: HTMLDivElement = containerOrNull;

    // ---------- 基础三件套 ----------
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1220');
    scene.fog = new THREE.Fog('#0b1220', 190, 340);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 40;
    controls.maxDistance = 400;
    controls.maxPolarAngle = Math.PI * 0.46;

    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2418, 1.15));

    const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
    sun.position.set(70, 120, 45);
    scene.add(sun);

    const rim = new THREE.DirectionalLight(0x6f9bd8, 0.55);
    rim.position.set(-80, 40, -70);
    scene.add(rim);

    // ---------- 网格索引（地形与水面共用拓扑） ----------
    const indexCount = (N - 1) * (N - 1) * 6;
    const indices = new Uint32Array(indexCount);
    {
      let p = 0;
      for (let z = 0; z < N - 1; z++) {
        for (let x = 0; x < N - 1; x++) {
          const a = z * N + x;
          const b = a + 1;
          const c = a + N;
          const d = c + 1;
          indices[p++] = a;
          indices[p++] = c;
          indices[p++] = b;
          indices[p++] = b;
          indices[p++] = c;
          indices[p++] = d;
        }
      }
    }

    const vertCount = N * N;
    const gridX = new Float32Array(vertCount);
    const gridZ = new Float32Array(vertCount);
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        gridX[i] = x - N / 2 + 0.5;
        gridZ[i] = z - N / 2 + 0.5;
      }
    }

    function makeGeometry(): THREE.BufferGeometry {
      const g = new THREE.BufferGeometry();
      g.setIndex(new THREE.BufferAttribute(indices, 1));
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
      return g;
    }

    const terrainGeo = makeGeometry();
    const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.frustumCulled = false;
    scene.add(terrainMesh);

    const waterGeo = makeGeometry();
    const waterMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      shininess: 90,
      specular: 0x9fd4ff,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.frustumCulled = false;
    scene.add(waterMesh);

    // ---------- 地形侧壁（裙边） ----------
    // 地形是一张没有厚度的曲面，从侧面看会透出铺在下方的水面，形成一圈蓝边。
    // 给四条边各加一道向下的墙，把地形变成有厚度的"地台"，蓝边就没了。
    const SKIRT_WALLS = 4;
    const skirtVerts = SKIRT_WALLS * N * 2;
    const skirtGeo = new THREE.BufferGeometry();
    const skirtPos = new Float32Array(skirtVerts * 3);
    const skirtNrm = new Float32Array(skirtVerts * 3);
    const skirtCol = new Float32Array(skirtVerts * 3);
    const skirtIdx = new Uint16Array(SKIRT_WALLS * (N - 1) * 6);

    {
      let p = 0;
      for (let w = 0; w < SKIRT_WALLS; w++) {
        const base = w * N * 2;
        for (let i = 0; i < N - 1; i++) {
          const a = base + i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          skirtIdx[p++] = a; skirtIdx[p++] = b; skirtIdx[p++] = c;
          skirtIdx[p++] = c; skirtIdx[p++] = b; skirtIdx[p++] = d;
        }
      }
    }

    skirtGeo.setIndex(new THREE.BufferAttribute(skirtIdx, 1));
    skirtGeo.setAttribute('position', new THREE.BufferAttribute(skirtPos, 3));
    skirtGeo.setAttribute('normal', new THREE.BufferAttribute(skirtNrm, 3));
    skirtGeo.setAttribute('color', new THREE.BufferAttribute(skirtCol, 3));

    const skirtPosAttr = skirtGeo.getAttribute('position') as THREE.BufferAttribute;
    const skirtNrmAttr = skirtGeo.getAttribute('normal') as THREE.BufferAttribute;
    const skirtColAttr = skirtGeo.getAttribute('color') as THREE.BufferAttribute;

    const skirtMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    skirtMesh.frustumCulled = false;
    scene.add(skirtMesh);

    // ---------- 变电站 ----------
    const facilityGroup = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 2.6, 4.4),
      new THREE.MeshStandardMaterial({ color: 0xf0c040, emissive: 0x4a3500, roughness: 0.55, metalness: 0.15 }),
    );
    body.position.y = 1.3;
    facilityGroup.add(body);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.32, 5.2),
      new THREE.MeshStandardMaterial({ color: 0xfff0a0, emissive: 0x2a2000, roughness: 0.7 }),
    );
    roof.position.y = 2.76;
    facilityGroup.add(roof);
    scene.add(facilityGroup);

    // ---------- 场地范围光圈 ----------
    // 玩家最常见的失误是在离变电站很远的地方施工（半径只有 4 格，够不着）。
    // 用一圈呼吸的光带把"该在哪儿施工"画出来。
    //
    // 注意：不能用 RingGeometry —— 那是一块平板，放在一个高度上，
    // 地形一起伏就被埋掉，园区场景（场地四周比厂址高）会完全看不见。
    // 这里逐点采样地形高度，做一条贴着地面的高地带。
    const RING_SEG = 128;
    // 光圈必须画在"可点范围"之内。原来画在 4.4–5.9 格，而允许范围只有 4 格，
    // 于是玩家照着光圈点、每次都被判"太远了"——一份试玩数据里 63% 的操作被拒。
    const RING_INNER = 2.9;
    const RING_OUTER = 4.0;
    /** 一圈上分布多少段虚线 */
    const RING_DASHES = 26;
    const ringPos = new Float32Array((RING_SEG + 1) * 2 * 3);
    const ringUv = new Float32Array((RING_SEG + 1) * 2 * 2);
    const ringIdx: number[] = [];
    for (let k = 0; k < RING_SEG; k++) {
      const a = k * 2;
      const b = k * 2 + 1;
      const c = (k + 1) * 2;
      const d = (k + 1) * 2 + 1;
      ringIdx.push(a, c, b, b, c, d);
    }
    // uv.u 沿圆周铺 RING_DASHES 遍，配合虚线贴图就成了刻度状的光带
    for (let k = 0; k <= RING_SEG; k++) {
      const u = (k / RING_SEG) * RING_DASHES;
      ringUv[(k * 2) * 2] = u;
      ringUv[(k * 2) * 2 + 1] = 0;
      ringUv[(k * 2 + 1) * 2] = u;
      ringUv[(k * 2 + 1) * 2 + 1] = 1;
    }

    // 虚线贴图：一段实、一段空，横向循环
    const dashCanvas = document.createElement('canvas');
    dashCanvas.width = 64;
    dashCanvas.height = 4;
    const dctx = dashCanvas.getContext('2d');
    if (dctx) {
      dctx.clearRect(0, 0, 64, 4);
      dctx.fillStyle = '#ffffff';
      dctx.fillRect(0, 0, 38, 4);
    }
    const dashTex = new THREE.CanvasTexture(dashCanvas);
    dashTex.wrapS = THREE.RepeatWrapping;
    dashTex.wrapT = THREE.ClampToEdgeWrapping;
    dashTex.needsUpdate = true;

    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
    ringGeo.setAttribute('uv', new THREE.BufferAttribute(ringUv, 2));
    ringGeo.setIndex(ringIdx);
    const ringMat = new THREE.MeshBasicMaterial({
      // 冷白偏蓝：和暖色地形是不同色相家族，又不像品红那样和绿色打架；
      // 比洪水的蓝淡得多，不会被误认成水面。
      color: 0xd8e6ff,
      map: dashTex,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      // 关掉深度测试：光圈是操作指引，不是场景实物。
      // 开着的话，视角一低，前面的坡就会把光圈挡掉一半（峡谷尤其明显）。
      depthTest: false,
    });
    const siteRing = new THREE.Mesh(ringGeo, ringMat);
    siteRing.renderOrder = 20;
    scene.add(siteRing);

    /** 双线性采样地形高度，让光带顺着坡面走 */
    function sampleTerrainHeight(gx: number, gz: number): number {
      const x0 = Math.floor(gx);
      const z0 = Math.floor(gz);
      const tx = gx - x0;
      const tz = gz - z0;
      const xa = Math.max(0, Math.min(N - 1, x0));
      const xb = Math.max(0, Math.min(N - 1, x0 + 1));
      const za = Math.max(0, Math.min(N - 1, z0));
      const zb = Math.max(0, Math.min(N - 1, z0 + 1));
      const h00 = sim.height[za * N + xa];
      const h10 = sim.height[za * N + xb];
      const h01 = sim.height[zb * N + xa];
      const h11 = sim.height[zb * N + xb];
      return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
    }

    function updateSiteRing() {
      const fx = sim.facility.cx;
      const fz = sim.facility.cz;
      for (let k = 0; k <= RING_SEG; k++) {
        const ang = (k / RING_SEG) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        for (let j = 0; j < 2; j++) {
          const r = j === 0 ? RING_INNER : RING_OUTER;
          const gx = fx + ca * r;
          const gz = fz + sa * r;
          const i = (k * 2 + j) * 3;
          ringPos[i] = gx - N / 2 + 0.5;
          ringPos[i + 1] = sampleTerrainHeight(gx, gz) + 0.22;
          ringPos[i + 2] = gz - N / 2 + 0.5;
        }
      }
      ringGeo.attributes.position.needsUpdate = true;
      ringGeo.computeBoundingSphere();
    }

    // ---------- 水泵标记 ----------
    // 原来只是一个 r=0.9 的小圆柱，在 112 格宽的场景里几乎看不见。
    // 现在做成"泵房 + 地面作用范围 + 竖直光柱"三件套，
    // 让玩家一眼看出：这里有一台泵，它管多大一片地方，它是否还在工作。
    const pumpGroup = new THREE.Group();
    const pumpBodyGeo = new THREE.CylinderGeometry(1.35, 1.6, 2.6, 16);
    const pumpCapGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.7, 10);
    const pumpDiscGeo = new THREE.CircleGeometry(4, 40);
    const pumpBeamGeo = new THREE.CylinderGeometry(0.1, 0.18, 3.4, 8);

    const pumpMat = new THREE.MeshStandardMaterial({ color: 0x38d9d9, emissive: 0x0b4a4a, roughness: 0.4 });
    const pumpCapMat = new THREE.MeshStandardMaterial({ color: 0xbdf6f6, emissive: 0x1a5c5c, roughness: 0.5 });
    const pumpDiscMat = new THREE.MeshBasicMaterial({
      color: 0x46e0ff,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    const pumpBeamMat = new THREE.MeshBasicMaterial({
      color: 0x46e0ff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      depthTest: false,
    });

    // 被淹停机的泵换一套暗红色，一眼能看出这台不工作了
    const pumpMatOff = new THREE.MeshStandardMaterial({ color: 0x9c5a52, emissive: 0x3a1512, roughness: 0.75 });
    const pumpCapMatOff = new THREE.MeshStandardMaterial({ color: 0xd8a8a0, emissive: 0x3a1512, roughness: 0.8 });
    const pumpDiscMatOff = new THREE.MeshBasicMaterial({
      color: 0xff6b6b,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    const pumpBeamMatOff = new THREE.MeshBasicMaterial({
      color: 0xff6b6b,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      depthTest: false,
    });

    scene.add(pumpGroup);
    let pumpMeshCount = 0;

    // ---------- 交互：区分拖拽与点击 ----------
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let downTime = 0;

    function onPointerDown(e: PointerEvent) {
      downX = e.clientX;
      downY = e.clientY;
      downTime = performance.now();
    }

    function onPointerUp(e: PointerEvent) {
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved > 6 || performance.now() - downTime > 600) return;

      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      const hits = raycaster.intersectObject(terrainMesh, false);
      if (hits.length === 0) return;
      const p = hits[0].point;
      const cx = Math.round(p.x + N / 2 - 0.5);
      const cz = Math.round(p.z + N / 2 - 0.5);
      if (cx < 0 || cz < 0 || cx >= N || cz >= N) return;

      const t = toolRef.current;
      const result =
        t === 'levee'
          ? sim.placeLevee(cx, cz)
          : t === 'ring'
            ? sim.placeRing(cx, cz)
            : sim.placePump(cx, cz);
      placeRef.current(result, { x: cx, z: cz });
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // ---------- 自动取景 ----------
    // 用地形的实际顶点（隔一个取一个，约 3 千个）而不是包围盒角点：
    // 地形是起伏曲面，用角点取景会明显偏上，展示不全。
    let framingPoints: THREE.Vector3[] = [];
    let framedFor: string | null = null;
    // 当前场景的高程范围，配色用它做归一化
    let hLo = 0;
    let hHi = 1;

    function reframe(): void {
      framingPoints = [];
      hLo = Infinity;
      hHi = -Infinity;
      for (let z = 0; z < N; z += 2) {
        for (let x = 0; x < N; x += 2) {
          const hh = sim.height[z * N + x];
          if (hh < hLo) hLo = hh;
          if (hh > hHi) hHi = hh;
          framingPoints.push(new THREE.Vector3(x - N / 2 + 0.5, hh, z - N / 2 + 0.5));
        }
      }
      frameCamera(camera, framingPoints, controls.target, {
        azimuth: 2.05,
        elevation: 0.6,
        margin: 0.8,
        offsetX: 0.03,
        offsetY: 0.02,
      });
      controls.update();
      framedFor = sim.scenarioId;
    }

    // ---------- 尺寸自适应 ----------
    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      // 第三个参数默认 true：同时更新 canvas 的 CSS 尺寸。
      // 传 false 会让 canvas 保持"设备像素"尺寸、溢出容器，画面被裁掉一角。
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // ---------- 主循环 ----------
    const clock = new THREE.Clock();
    let raf = 0;
    let hudTimer = 0;

    const tPos = terrainGeo.getAttribute('position') as THREE.BufferAttribute;
    const tNrm = terrainGeo.getAttribute('normal') as THREE.BufferAttribute;
    const tCol = terrainGeo.getAttribute('color') as THREE.BufferAttribute;
    const wPos = waterGeo.getAttribute('position') as THREE.BufferAttribute;
    const wNrm = waterGeo.getAttribute('normal') as THREE.BufferAttribute;
    const wCol = waterGeo.getAttribute('color') as THREE.BufferAttribute;

    const tPosArr = tPos.array as Float32Array;
    const tNrmArr = tNrm.array as Float32Array;
    const tColArr = tCol.array as Float32Array;
    const wPosArr = wPos.array as Float32Array;
    const wNrmArr = wNrm.array as Float32Array;
    const wColArr = wCol.array as Float32Array;

    function updateGeometry() {
      const H = sim.height;
      const D = sim.depth;
      const WET = sim.wet;
      const NRM = sim.normals;

      for (let i = 0; i < vertCount; i++) {
        const i3 = i * 3;

        // 地形
        tPosArr[i3] = gridX[i];
        tPosArr[i3 + 1] = H[i];
        tPosArr[i3 + 2] = gridZ[i];
        tNrmArr[i3] = NRM[i3];
        tNrmArr[i3 + 1] = NRM[i3 + 1];
        tNrmArr[i3 + 2] = NRM[i3 + 2];
        const c = terrainColorAt(H[i], WET[i], hLo, hHi);
        tColArr[i3] = c[0];
        tColArr[i3 + 1] = c[1];
        tColArr[i3 + 2] = c[2];

        // 水面（没有水时压到地面以下，形成"看不见"的效果）
        const d = D[i];
        wPosArr[i3] = gridX[i];
        wPosArr[i3 + 1] = d > 0.02 ? H[i] + d : H[i] - 0.9;
        wPosArr[i3 + 2] = gridZ[i];
        wNrmArr[i3] = NRM[i3];
        wNrmArr[i3 + 1] = NRM[i3 + 1];
        wNrmArr[i3 + 2] = NRM[i3 + 2];
        mix(W_SHALLOW, W_DEEP, Math.min(1, d / 2.4), wColArr, i);
      }

      updateSkirt(H);

      tPos.needsUpdate = true;
      tNrm.needsUpdate = true;
      tCol.needsUpdate = true;
      wPos.needsUpdate = true;
      wNrm.needsUpdate = true;
      wCol.needsUpdate = true;
      skirtPosAttr.needsUpdate = true;
      skirtColAttr.needsUpdate = true;
    }

    /**
     * 四条边各生成一道向下的墙。底面统一落在最低高程之下，
     * 看起来就是一块有厚度的地台。
     */
    function updateSkirt(H: Float32Array): void {
      const bottom = hLo - 6;

      // 四条边的顶点索引顺序：北(z=0) / 南(z=N-1) / 西(x=0) / 东(x=N-1)
      for (let w = 0; w < SKIRT_WALLS; w++) {
        const base = w * N * 2;
        for (let i = 0; i < N; i++) {
          let gx: number;
          let gz: number;
          let h: number;
          if (w === 0) {
            gx = i; gz = 0; h = H[i];
          } else if (w === 1) {
            gx = i; gz = N - 1; h = H[(N - 1) * N + i];
          } else if (w === 2) {
            gx = 0; gz = i; h = H[i * N];
          } else {
            gx = N - 1; gz = i; h = H[i * N + N - 1];
          }

          const top = base + i * 2;
          const bot = top + 1;

          skirtPos[top * 3] = gx - N / 2 + 0.5;
          skirtPos[top * 3 + 1] = h;
          skirtPos[top * 3 + 2] = gz - N / 2 + 0.5;
          skirtPos[bot * 3] = gx - N / 2 + 0.5;
          skirtPos[bot * 3 + 1] = bottom;
          skirtPos[bot * 3 + 2] = gz - N / 2 + 0.5;

          // 顶部沿用地形色，越往下越暗
          const c = terrainColorAt(h, 0, hLo, hHi);
          skirtCol[top * 3] = c[0];
          skirtCol[top * 3 + 1] = c[1];
          skirtCol[top * 3 + 2] = c[2];
          skirtCol[bot * 3] = C_SKIRT[0];
          skirtCol[bot * 3 + 1] = C_SKIRT[1];
          skirtCol[bot * 3 + 2] = C_SKIRT[2];

          // 法线朝外（水平）
          const nx = w === 2 ? -1 : w === 3 ? 1 : 0;
          const nz = w === 0 ? -1 : w === 1 ? 1 : 0;
          skirtNrm[top * 3] = nx;
          skirtNrm[top * 3 + 1] = 0;
          skirtNrm[top * 3 + 2] = nz;
          skirtNrm[bot * 3] = nx;
          skirtNrm[bot * 3 + 1] = 0;
          skirtNrm[bot * 3 + 2] = nz;
        }
      }
      skirtNrmAttr.needsUpdate = true;
    }

    /** 一台泵 = 泵房 + 顶部小烟囱 + 地面作用光圈 + 竖直光柱 */
    function makePumpGroup(): THREE.Group {
      const g = new THREE.Group();

      const body = new THREE.Mesh(pumpBodyGeo, pumpMat);
      body.position.y = 1.3;
      g.add(body);

      const cap = new THREE.Mesh(pumpCapGeo, pumpCapMat);
      cap.position.y = 2.95;
      g.add(cap);

      const disc = new THREE.Mesh(pumpDiscGeo, pumpDiscMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.12;
      disc.renderOrder = 18;
      g.add(disc);

      const beam = new THREE.Mesh(pumpBeamGeo, pumpBeamMat);
      beam.position.y = 4.2;
      beam.renderOrder = 19;
      g.add(beam);

      return g;
    }

    function syncPumps() {
      const want = sim.pumps.length;
      while (pumpMeshCount < want) {
        pumpGroup.add(makePumpGroup());
        pumpMeshCount++;
      }
      while (pumpMeshCount > want) {
        const m = pumpGroup.children[pumpGroup.children.length - 1];
        pumpGroup.remove(m);
        pumpMeshCount--;
      }
      for (let k = 0; k < want; k++) {
        const p = sim.pumps[k];
        const g = pumpGroup.children[k] as THREE.Group;
        const off = p.flooded;
        g.position.set(p.x - N / 2 + 0.5, sim.height[p.z * N + p.x], p.z - N / 2 + 0.5);
        (g.children[0] as THREE.Mesh).material = off ? pumpMatOff : pumpMat;
        (g.children[1] as THREE.Mesh).material = off ? pumpCapMatOff : pumpCapMat;
        (g.children[2] as THREE.Mesh).material = off ? pumpDiscMatOff : pumpDiscMat;
        (g.children[3] as THREE.Mesh).material = off ? pumpBeamMatOff : pumpBeamMat;
      }
    }

    // 固定步长：物理永远以 1/60 秒推进，与帧率和倍速无关。
    // 之前直接把帧间隔当步长，实测同一套方案在不同帧率下峰值能差 28%
    // （园区 1.171 m @60fps vs 0.838 m @10fps），卡在阈值附近时胜负会翻。
    const FIXED_DT = 1 / 60;
    let acc = 0;

    function animate() {
      raf = requestAnimationFrame(animate);
      // 单帧最多补 0.1 秒，避免切回标签页时一口气补几千步
      const frameDt = Math.min(0.1, clock.getDelta());
      const speed = Math.max(1, Math.round(speedRef.current));
      acc += frameDt * speed;

      let steps = 0;
      while (acc >= FIXED_DT && steps < 16) {
        sim.step(FIXED_DT);
        acc -= FIXED_DT;
        steps++;
      }
      // 追不上就丢掉欠的时间，而不是让 acc 无限增长。
      // 4× 在很慢的机器上（<15fps）会撞到单帧 16 步的上限，
      // 这里兜住之后表现为"比 4× 慢一点"，但轨迹和 1× 仍然一致。
      if (acc > FIXED_DT * 8) acc = FIXED_DT * 8;

      // 切换场景后地形变了，需要重新取景
      if (framedFor !== sim.scenarioId && container.clientWidth > 0) reframe();

      controls.update();

      updateGeometry();
      syncPumps();

      const fi = sim.facility.cz * N + sim.facility.cx;
      // 不能对高程做 Math.max(..., 0)：峡谷场景厂址在 -14 米，
      // 夹到 0 会让变电站悬在半空，和水面脱离。
      facilityGroup.position.set(
        sim.facility.cx - N / 2 + 0.5,
        sim.height[fi],
        sim.facility.cz - N / 2 + 0.5,
      );

      // 场地光圈：贴着地形起伏，缓慢呼吸；布防结束后收敛，不干扰看洪水
      const preparing = sim.phase === 'prepare';
      // 建了围堰之后，光圈和堰顶会叠在一起，直接收掉
      siteRing.visible = !sim.hasRing;
      if (preparing) updateSiteRing();
      const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.0);
      ringMat.opacity = (preparing ? 0.55 : 0.16) + (preparing ? 0.35 : 0.08) * pulse;
      // 虚线沿圆周缓慢流动：动的东西更像"界面"，静止的容易看成地面的纹理
      dashTex.offset.x = (dashTex.offset.x + frameDt * 0.06) % 1;

      hudTimer += frameDt;
      if (hudTimer > 0.1) {
        hudTimer = 0;
        statsRef.current(sim.stats());
      }

      renderer.render(scene, camera);
    }
    animate();

    // ---------- 清理 ----------
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      terrainGeo.dispose();
      waterGeo.dispose();
      terrainMat.dispose();
      waterMat.dispose();
      facilityGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      pumpGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
      });
      pumpBodyGeo.dispose();
      pumpCapGeo.dispose();
      pumpDiscGeo.dispose();
      pumpBeamGeo.dispose();
      pumpMat.dispose();
      pumpMatOff.dispose();
      pumpCapMat.dispose();
      pumpCapMatOff.dispose();
      pumpDiscMat.dispose();
      pumpDiscMatOff.dispose();
      pumpBeamMat.dispose();
      pumpBeamMatOff.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      dashTex.dispose();
      skirtGeo.dispose();
      skirtMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [sim]);

  return <div ref={containerRef} className="scene" />;
}
