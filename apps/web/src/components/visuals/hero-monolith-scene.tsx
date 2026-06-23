"use client";

import { useRef } from "react";
import { Canvas, useFrame, type ThreeElements } from "@react-three/fiber";
import {
  Float,
  Environment,
  Lightformer,
  MeshTransmissionMaterial,
} from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

// Neutral palette — the crystal reads as a grey/black gradient gem.
const STEEL = "#9aa0a6"; // mid grey — emissive lines / point light
const SLATE = "#6b7280"; // grey fill light
const PALE = "#d4d4d8"; // pale grey — core / ring / highlights
const ONYX = "#3a3a3d"; // dark grey — glass interior attenuation (black gradient)

// A faceted glass crystal shard with energy threading through its core.
// Outer shell: physically-based transmission (real refraction / Linear-style
// glass). Inner: an emissive wireframe twin + a glowing core + an orbiting
// ring, all lit so they read *through* the glass and bloom into a soft halo.
function Crystal() {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // extremely slow self-rotation only — no cursor interaction
    if (group.current) {
      group.current.rotation.y += 0.0006;
    }

    // the energy core breathes gently
    if (core.current) {
      const s = 1 + Math.sin(t * 1.1) * 0.07;
      core.current.scale.setScalar(s);
    }

    // tilted ring drifts slowly on its own axis
    if (ring.current) {
      ring.current.rotation.z = t * 0.12;
      ring.current.rotation.x = Math.PI / 2.6;
    }
  });

  // elongated octahedron => clean crystal facets
  const shardScale: [number, number, number] = [1.35, 2.05, 1.35];

  return (
    <Float speed={0.5} rotationIntensity={0.1} floatIntensity={0.3}>
      <group ref={group}>
        {/* glass shell */}
        <mesh scale={shardScale}>
          <octahedronGeometry args={[1, 0]} />
          <MeshTransmissionMaterial
            samples={6}
            resolution={512}
            transmission={1}
            thickness={1.4}
            roughness={0.1}
            ior={1.38}
            chromaticAberration={0.12}
            anisotropy={0.2}
            distortion={0.15}
            distortionScale={0.3}
            temporalDistortion={0.08}
            clearcoat={1}
            attenuationDistance={1.1}
            attenuationColor={ONYX}
            color="#e7e7ea"
            background={new THREE.Color("#000000")}
          />
        </mesh>

        {/* emissive wireframe twin — the energy lattice inside */}
        <mesh scale={shardScale.map((s) => s * 0.92) as [number, number, number]}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial
            color="#52525b"
            wireframe
            transparent
            opacity={0.14}
          />
        </mesh>

        {/* glowing core */}
        <mesh ref={core}>
          <icosahedronGeometry args={[0.42, 1]} />
          <meshStandardMaterial
            color={PALE}
            emissive={STEEL}
            emissiveIntensity={0.9}
            toneMapped={false}
          />
        </mesh>

        {/* energy threading: a bright ring orbiting the core */}
        <group ref={ring}>
          <mesh>
            <torusGeometry args={[0.95, 0.018, 16, 96]} />
            <meshStandardMaterial
              color={PALE}
              emissive={STEEL}
              emissiveIntensity={0.8}
              toneMapped={false}
            />
          </mesh>
        </group>

        {/* point light from the core so the glass picks up a soft grey from within */}
        <pointLight color={STEEL} intensity={2.4} distance={6} decay={1.5} />
      </group>
    </Float>
  );
}

export default function HeroMonolithScene(props: ThreeElements["group"]) {
  void props;
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0, 6.5], fov: 35 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%" }}
    >
      {/* key + fill so the glass facets catch clean white edges */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 6, 4]} intensity={1.2} />
      <directionalLight position={[-6, -2, 2]} intensity={0.6} color={SLATE} />

      <Crystal />

      {/* procedural env (no network) for realistic glass reflections */}
      <Environment resolution={256}>
        <Lightformer
          intensity={2.2}
          position={[0, 2, 4]}
          scale={[9, 9, 1]}
          color={PALE}
        />
        <Lightformer
          intensity={1.4}
          position={[-5, 1, 2]}
          scale={[4, 9, 1]}
          color="#ffffff"
        />
        <Lightformer
          intensity={1.6}
          position={[5, -2, 2]}
          scale={[4, 9, 1]}
          color={STEEL}
        />
      </Environment>

      <EffectComposer enableNormalPass={false}>
        <Bloom
          mipmapBlur
          intensity={0.65}
          luminanceThreshold={0.25}
          luminanceSmoothing={0.5}
          radius={0.7}
        />
      </EffectComposer>
    </Canvas>
  );
}
