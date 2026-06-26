"use client";

import { useFBO } from "@react-three/drei";
import { createPortal, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { SimulationMaterial } from "./shaders/simulationMaterial";
import { DofPointsMaterial } from "./shaders/pointMaterial";

// Production defaults (the spec's Leva panel, hardcoded — no dev UI in prod).
const PARAMS = {
  speed: 1.0,
  noiseScale: 0.6,
  noiseIntensity: 0.52,
  timeScale: 1,
  focus: 3.8,
  aperture: 1.79,
  pointSize: 10.0,
  opacity: 0.5,
  planeScale: 10.0,
  size: 512,
};

export function Particles({ introspect = false }: { introspect?: boolean }) {
  const SIZE = PARAMS.size;

  const simulationMaterial = useMemo(
    () => new SimulationMaterial(PARAMS.planeScale, SIZE),
    [SIZE],
  );

  // half-float + nearest: we store raw positions, no interpolation.
  // HalfFloatType (RGBA16F), not FloatType (RGBA32F): rendering into a 32-bit
  // float color buffer needs EXT_color_buffer_float, which is commonly missing
  // under Windows' ANGLE/D3D11 backend — there the FBO is incomplete and the
  // whole field renders black. RGBA16F is widely color-renderable and its
  // precision is ample for particle positions in the ±planeScale range.
  const target = useFBO(SIZE, SIZE, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
  });

  const dofPointsMaterial = useMemo(() => {
    const m = new DofPointsMaterial();
    m.uniforms.positions.value = target.texture;
    m.uniforms.initialPositions.value =
      simulationMaterial.uniforms.positions.value;
    return m;
  }, [target, simulationMaterial]);

  // offscreen simulation scene + fullscreen quad + ortho camera
  const scene = useMemo(() => new THREE.Scene(), []);
  const camera = useMemo(
    () => new THREE.OrthographicCamera(-1, 1, 1, -1, 1 / Math.pow(2, 53), 1),
    [],
  );
  const quadPositions = useMemo(
    () =>
      new Float32Array([
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0,
      ]),
    [],
  );
  const quadUvs = useMemo(
    () => new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]),
    [],
  );

  // points geometry: each particle stores its texture UV in position.xy
  const particles = useMemo(() => {
    const len = SIZE * SIZE;
    const arr = new Float32Array(len * 3);
    for (let i = 0; i < len; i++) {
      const i3 = i * 3;
      arr[i3 + 0] = (i % SIZE) / SIZE;
      arr[i3 + 1] = Math.floor(i / SIZE) / SIZE;
      arr[i3 + 2] = 0;
    }
    return arr;
  }, [SIZE]);

  const revealStart = useRef<number | null>(null);

  useFrame((state, delta) => {
    const { gl, clock } = state;

    // 1. run the simulation -> FBO
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(null);

    const t = clock.elapsedTime;

    // 2. one-shot center-out reveal: 3.5s, ease-out cubic
    if (revealStart.current === null) revealStart.current = t;
    const progress = Math.min((t - revealStart.current) / 3.5, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const revealFactor = eased * 4.0;

    // 3. point uniforms
    const u = dofPointsMaterial.uniforms;
    u.uTime.value = t;
    u.uFocus.value = PARAMS.focus;
    u.uBlur.value = PARAMS.aperture;
    u.uPointSize.value = PARAMS.pointSize;
    u.uOpacity.value = PARAMS.opacity;
    u.uRevealFactor.value = revealFactor;
    u.uRevealProgress.value = eased;

    // smooth hover "introspect" transition (inline exponential damp)
    const goal = introspect ? 1 : 0;
    const smoothTime = introspect ? 0.35 : 0.2;
    u.uTransition.value +=
      (goal - u.uTransition.value) * (1 - Math.exp(-delta / smoothTime));

    // 4. simulation uniforms
    const s = simulationMaterial.uniforms;
    s.uTime.value = t;
    s.uNoiseScale.value = PARAMS.noiseScale;
    s.uNoiseIntensity.value = PARAMS.noiseIntensity;
    s.uTimeScale.value = PARAMS.timeScale * PARAMS.speed;
  });

  return (
    <>
      {createPortal(
        <mesh material={simulationMaterial} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[quadPositions, 3]}
            />
            <bufferAttribute attach="attributes-uv" args={[quadUvs, 2]} />
          </bufferGeometry>
        </mesh>,
        scene,
      )}
      <points material={dofPointsMaterial} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles, 3]} />
        </bufferGeometry>
      </points>
    </>
  );
}
