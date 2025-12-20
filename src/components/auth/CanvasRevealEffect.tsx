import React, { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export const CanvasRevealEffect = ({
    animationSpeed = 0.4,
    opacities = [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1],
    colors = [[0, 255, 255]],
    containerClassName,
    dotSize = 3,
    showGradient = true,
}: {
    animationSpeed?: number;
    opacities?: number[];
    colors?: number[][];
    containerClassName?: string;
    dotSize?: number;
    showGradient?: boolean;
}) => {
    return (
        <div className={`h-full w-full relative bg-black ${containerClassName}`}>
            <div className="h-full w-full">
                <DotMatrix
                    colors={colors ?? [[0, 255, 255]]}
                    dotSize={dotSize ?? 3}
                    opacities={
                        opacities ?? [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1]
                    }
                    shader={`
              float animation_speed_factor = ${animationSpeed.toFixed(1)};
              float intro_offset = distance(u_resolution / 2.0 / u_total_size, st2);
              float step_x = 0.002;  // Reduced density
              float step_y = 0.002;  // Reduced density
              float steps_x = 5.0;  // 5 steps calculation
              float steps_y = 5.0;

              return smoothstep(0.0, 1.0, 1.0 - intro_offset);
            `}
                    center={["x", "y"]}
                />
            </div>
            {showGradient && (
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10" />
            )}
        </div>
    );
};

const DotMatrix = ({
    colors,
    opacities,
    shader,
    center,
}: {
    colors: number[][];
    opacities: number[];
    shader?: string;
    dotSize?: number;
    center?: ("x" | "y")[];
}) => {
    const ref = useRef<THREE.Mesh>(null);

    // Custom Shader Material
    const uniforms = useMemo(
        () => ({
            u_time: { value: 0.0 },
            u_resolution: { value: new THREE.Vector2() },
            u_colors: { value: colors.map((c) => new THREE.Vector3(c[0], c[1], c[2])) },
            u_opacities: { value: opacities },
            u_total_size: { value: 4.0 }, // Scale factor
            u_dot_size: { value: 3.0 },
        }),
        [colors, opacities]
    );

    return (
        <Canvas
            className="h-full w-full"
            resize={{ scroll: false }}
            gl={{ alpha: true, antialias: true }}
        >
            <ShaderPlane
                uniforms={uniforms}
                shader={shader}
                center={center}
            />
        </Canvas>
    );
};

const ShaderPlane = ({ uniforms, shader, center }: { uniforms: any; shader?: string; center?: ("x" | "y")[] }) => {
    const { size, viewport, clock } = useThree();
    const ref = useRef<THREE.ShaderMaterial>(null);

    useFrame((state) => {
        if (ref.current) {
            ref.current.uniforms.u_time.value = state.clock.getElapsedTime();
            ref.current.uniforms.u_resolution.value.set(size.width * 2, size.height * 2); // Retina support
        }
    });

    const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

    const fragmentShader = `
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform vec3 u_colors[5];
    uniform float u_opacities[10];
    uniform float u_total_size;
    uniform float u_dot_size;

    varying vec2 vUv;

    // Pseudo-random function
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main() {
        vec2 st = gl_FragCoord.xy / u_resolution.xy;
        st.x *= u_resolution.x / u_resolution.y; // Aspect ratio correction

        vec2 grid = vec2(30.0, 30.0) * u_total_size; // Grid density
        vec2 ipos = floor(st * grid);  // integer
        vec2 fpos = fract(st * grid);  // fraction

        vec2 st2 = st * grid;
        
        // Dot Shape
        float d = distance(fpos, vec2(0.5));
        float radius = 0.4;
        
        // Randomized pulse based on time and position
        float time_offset = random(ipos) * 10.0;
        float pulse = sin(u_time * 2.0 + time_offset);
        
        // Use shader string passed from prop if we wanted dynamic logic, 
        // but for now hardcode a nice "wave" effect
        float wave = sin(st.x * 10.0 + u_time) * cos(st.y * 10.0 + u_time);
        
        // Color selection
        vec3 color = u_colors[0] / 255.0; // Base color

        // Alpha calculation
        // Smooth circle
        float alpha = 1.0 - smoothstep(radius-0.05, radius+0.05, d);
        
        // Apply random opacity variation
        float noise = random(ipos);
        alpha *= (0.2 + 0.8 * abs(sin(u_time + noise * 10.0)));

        if (d > radius) discard; // Strict circle

        gl_FragColor = vec4(color, alpha);
    }
  `;

    return (
        <mesh scale={[viewport.width, viewport.height, 1]}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
                ref={ref}
                uniforms={uniforms}
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                transparent={true}
            />
        </mesh>
    );
};
