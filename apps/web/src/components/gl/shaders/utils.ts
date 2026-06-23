// Seamlessly-looping 3D noise: a sum of sine/cosine waves where every time
// multiplier is an integer, so the whole function has a period of exactly 2π
// in `time`. Injected into both the simulation and point materials.
export const periodicNoiseGLSL = /* glsl */ `
float periodicNoise(vec3 p, float time) {
  float noise = 0.0;
  noise += sin(p.x * 2.0 + time) * cos(p.z * 1.5 + time);              // period 2π
  noise += sin(p.x * 3.2 + time * 2.0) * cos(p.z * 2.1 + time) * 0.6;  // period π
  noise += sin(p.x * 1.7 + time) * cos(p.z * 2.8 + time * 3.0) * 0.4;  // period 2π/3
  noise += sin(p.x * p.z * 0.5 + time * 2.0) * 0.3;                    // cross term
  return noise * 0.3;
}
`;
