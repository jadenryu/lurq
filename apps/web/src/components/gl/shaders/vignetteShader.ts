import { Effect } from "postprocessing";
import { Uniform } from "three";

// Post-process vignette: darken screen edges by squared distance from centre.
// Exact formula from the spec, expressed as a postprocessing Effect so it runs
// in the project's existing @react-three/postprocessing EffectComposer.
const fragmentShader = /* glsl */ `
uniform float offset;
uniform float darkness;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 p = (uv - 0.5) * 2.0;
  float dist = dot(p, p);
  float vignette = 1.0 - smoothstep(offset, offset + darkness, dist);
  outputColor = vec4(inputColor.rgb * vignette, inputColor.a);
}
`;

export class VignetteEffectImpl extends Effect {
  constructor({ offset = 0.4, darkness = 1.5 } = {}) {
    super("VignetteEffect", fragmentShader, {
      uniforms: new Map([
        ["offset", new Uniform(offset)],
        ["darkness", new Uniform(darkness)],
      ]),
    });
  }
}
