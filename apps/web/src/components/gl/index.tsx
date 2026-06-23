"use client";

import { Canvas } from "@react-three/fiber";
import { EffectComposer, wrapEffect } from "@react-three/postprocessing";
import { Particles } from "./particles";
import { VignetteEffectImpl } from "./shaders/vignetteShader";

const Vignette = wrapEffect(VignetteEffectImpl);

// GPU-driven FBO particle field on a black background, with a vignette pass.
export default function GL({ hovering = false }: { hovering?: boolean }) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: false }}
      camera={{
        position: [
          1.2629783123314589, 2.664606471394044, -1.8178993743288914,
        ],
        fov: 50,
        near: 0.01,
        far: 300,
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#000000"]} />
      <Particles introspect={hovering} />
      <EffectComposer multisampling={0}>
        <Vignette offset={0.4} darkness={1.5} />
      </EffectComposer>
    </Canvas>
  );
}
