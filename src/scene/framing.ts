import * as THREE from 'three';

export interface FrameOptions {
  /** 方位角（弧度） */
  azimuth: number;
  /** 仰角（弧度） */
  elevation: number;
  /** 模型在屏幕上的半宽/半高占 NDC 的比例，0.8 表示四周留约 20% 边距 */
  margin: number;
  /** 模型中心希望的屏幕位置（NDC，-1..1），默认正中 */
  offsetX?: number;
  offsetY?: number;
}

/**
 * 把相机摆到"模型完整可见且居中"的位置。
 *
 * 两个容易踩的坑：
 * 1. 透视投影下近端更大，只对准三维中心会让模型整体偏下；
 * 2. 用包围盒角点取景，和模型的实际轮廓不是一回事——地形是起伏的曲面，
 *    它的屏幕包围盒比包围盒角点的投影更靠上。
 * 所以这里直接对**模型的实际顶点**做屏幕包围盒，再据此定距离和位置。
 *
 * 纯数学，不依赖渲染器，可以在 Node 里验证。
 */
export function frameCamera(
  camera: THREE.PerspectiveCamera,
  points: THREE.Vector3[],
  target: THREE.Vector3,
  opts: FrameOptions,
): void {
  const box = new THREE.Box3().setFromPoints(points);
  const center = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(
    Math.cos(opts.elevation) * Math.cos(opts.azimuth),
    Math.sin(opts.elevation),
    Math.cos(opts.elevation) * Math.sin(opts.azimuth),
  ).normalize();

  const ox = opts.offsetX ?? 0;
  const oy = opts.offsetY ?? 0;

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const shift = new THREE.Vector3();
  const probe = new THREE.Vector3();

  const place = (distance: number): void => {
    camera.position.copy(center).addScaledVector(dir, distance);
    target.copy(center);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
  };

  const bounds = (): { cx: number; cy: number; half: number } => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const pt of points) {
      probe.copy(pt).project(camera);
      if (probe.x < minX) minX = probe.x;
      if (probe.x > maxX) maxX = probe.x;
      if (probe.y < minY) minY = probe.y;
      if (probe.y > maxY) maxY = probe.y;
    }
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      half: Math.max((maxX - minX) / 2, (maxY - minY) / 2),
    };
  };

  /** 平移相机与目标点，使屏幕包围盒中心落到 (ox, oy) */
  const centerOnScreen = (): void => {
    for (let k = 0; k < 6; k++) {
      const b = bounds();
      const ex = ox - b.cx;
      const ey = oy - b.cy;
      if (Math.abs(ex) < 5e-4 && Math.abs(ey) < 5e-4) return;

      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      const dist = camera.position.distanceTo(target);
      const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const halfW = halfH * camera.aspect;

      shift.copy(right).multiplyScalar(-ex * halfW).addScaledVector(up, -ey * halfH);
      camera.position.add(shift);
      target.add(shift);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
    }
  };

  // 距离与尺寸互相影响，迭代收敛：摆位 → 居中 → 按实际半宽修正距离
  let distance = Math.max(box.getSize(new THREE.Vector3()).length(), 60);
  for (let iter = 0; iter < 8; iter++) {
    place(distance);
    centerOnScreen();

    const b = bounds();
    if (!Number.isFinite(b.half) || b.half <= 0) break;
    if (Math.abs(b.half - opts.margin) < 0.004) break;
    distance *= b.half / opts.margin;
  }

  place(distance);
  centerOnScreen();
  camera.updateProjectionMatrix();
}
