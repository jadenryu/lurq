import * as THREE from "three";
import { periodicNoiseGLSL } from "./utils";

// Build a size×size RGBA float DataTexture of base (undisplaced) positions.
// Particle i sits on a flat XZ grid centred at the origin, spanning
// [-scale, scale] on both axes at Y=0.
function getPlane(count: number, components: number, size: number, scale: number) {
  const data = new Float32Array(count * components);
  for (let i = 0; i < count; i++) {
    const k = i * components;
    const x = (i % size) / (size - 1);
    const z = Math.floor(i / size) / (size - 1);
    data[k + 0] = (x - 0.5) * 2 * scale;
    data[k + 1] = 0;
    data[k + 2] = (z - 0.5) * 2 * scale;
    if (components === 4) data[k + 3] = 1;
  }
  return data;
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D positions;
uniform float uTime;
uniform float uNoiseScale;
uniform float uNoiseIntensity;
uniform float uTimeScale;
uniform float uLoopPeriod;
varying vec2 vUv;

${periodicNoiseGLSL}

void main() {
  vec3 originalPos = texture2D(positions, vUv).rgb;
  float continuousTime = uTime * uTimeScale * (6.28318530718 / uLoopPeriod);
  vec3 noiseInput = originalPos * uNoiseScale;
  // same noise per axis, phase-offset by 120° / 240° and spatially offset by 50
  float dX = periodicNoise(noiseInput + vec3(0.0, 0.0, 0.0), continuousTime);
  float dY = periodicNoise(noiseInput + vec3(50.0, 0.0, 0.0), continuousTime + 2.094);
  float dZ = periodicNoise(noiseInput + vec3(0.0, 50.0, 0.0), continuousTime + 4.188);
  vec3 finalPos = originalPos + vec3(dX, dY, dZ) * uNoiseIntensity;
  gl_FragColor = vec4(finalPos, 1.0);
}
`;

export class SimulationMaterial extends THREE.ShaderMaterial {
  constructor(planeScale = 10, size = 512) {
    const positions = getPlane(size * size, 4, size, planeScale);
    const positionsTexture = new THREE.DataTexture(
      positions,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    positionsTexture.needsUpdate = true;

    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        positions: { value: positionsTexture },
        uTime: { value: 0 },
        uNoiseScale: { value: 1 },
        uNoiseIntensity: { value: 0.5 },
        uTimeScale: { value: 1 },
        uLoopPeriod: { value: 24 },
      },
    });
  }
}
