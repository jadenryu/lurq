import * as THREE from "three";
import { periodicNoiseGLSL } from "./utils";

// Reads particle positions out of the simulation FBO and draws each as a soft,
// depth-blurred white dot with a center-out reveal and per-particle sparkle.
const vertexShader = /* glsl */ `
uniform sampler2D positions;
uniform sampler2D initialPositions;
uniform float uFocus;
uniform float uBlur;
uniform float uPointSize;

varying float vDistance;
varying float vPosY;
varying vec3 vWorldPosition;
varying vec3 vInitialPosition;

void main() {
  // points geometry stores the texture UV in position.xy
  vec3 pos = texture2D(positions, position.xy).xyz;
  vec3 initialPos = texture2D(initialPositions, position.xy).xyz;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  vDistance = abs(uFocus - -mvPosition.z);
  gl_PointSize = max(vDistance * uBlur * uPointSize, 3.0);

  vPosY = pos.y;
  vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;
  vInitialPosition = initialPos;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uRevealFactor;
uniform float uRevealProgress;
uniform float uTransition;

varying float vDistance;
varying float vPosY;
varying vec3 vWorldPosition;
varying vec3 vInitialPosition;

${periodicNoiseGLSL}

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

// per-particle sparkle: hash initial position -> phase, sum three sines, mask
// out ~70% of particles, then pow(.,4) to emphasise only the bright peaks.
float sparkle(vec3 pos, float time) {
  float hash = fract(sin(dot(pos, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float phase = hash * 6.28318530718;
  float s = sin(time * 2.0 + phase)
          + sin(time * 3.3 + phase * 1.7) * 0.7
          + sin(time * 1.5 + phase * 2.3) * 0.5;
  s = max(s / 2.2, 0.0);
  float mask = step(0.7, hash); // keep ~30% of particles
  s = pow(s, 4.0) * mask;
  return 0.7 + clamp(s, 0.0, 1.0) * 1.3; // [0.7, 2.0]
}

void main() {
  // circular mask -> round dots
  vec2 cxy = (gl_PointCoord - 0.5) * 2.0;
  if (sdCircle(cxy, 0.5) > 0.0) discard;

  // center-out reveal with a noise-perturbed threshold (organic edge)
  float threshold = uRevealFactor + periodicNoise(vInitialPosition * 4.0, 0.0) * 0.3;
  float distFromCenter = length(vWorldPosition.xz);
  float revealMask = 1.0 - smoothstep(threshold - 0.8, threshold, distFromCenter);

  float sparkleBrightness = sparkle(vInitialPosition, uTime);

  float alpha = (1.04 - clamp(vDistance, 0.0, 1.0))
              * clamp(smoothstep(-0.5, 0.25, vPosY), 0.0, 1.0)
              * uOpacity * revealMask * uRevealProgress * sparkleBrightness;

  gl_FragColor = vec4(vec3(1.0), mix(alpha, sparkleBrightness - 1.1, uTransition));
}
`;

export class DofPointsMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        positions: { value: null },
        initialPositions: { value: null },
        uTime: { value: 0 },
        uFocus: { value: 5.1 },
        uBlur: { value: 30 },
        uPointSize: { value: 2 },
        uOpacity: { value: 1 },
        uRevealFactor: { value: 0 },
        uRevealProgress: { value: 0 },
        uTransition: { value: 0 },
      },
    });
  }
}
