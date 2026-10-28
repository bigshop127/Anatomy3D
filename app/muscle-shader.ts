import type * as T from 'three';

/**
 * Muscle look: every muscle gets its own shade, fibres run along its long axis (colour, a little relief and gloss), the ends
 * fade to pale tendon, and the silhouette darkens so neighbouring muscles read as separate shapes. The fibre detail fades out
 * when a pixel is wider than the fibre, so it only shows once zoomed in and does not shimmer from far away.
 */
const FIBRE_PERIODS = [0.005, 0.0018];

const VERTEX_DECLARATIONS = 'uniform sampler2D fiberState; varying vec3 vFiberPos; varying vec4 vFiberAxis; varying vec2 vFiberRange;\n';
const VERTEX_LOOKUP = ' vFiberPos = position; vec2 fiberUv = vec2((partIndex + 0.5) / stateWidth, 0.25); vFiberAxis = texture2D(fiberState, fiberUv); vFiberRange = texture2D(fiberState, fiberUv + vec2(0.0, 0.5)).xy;';

const FRAGMENT_DECLARATIONS = `varying vec3 vFiberPos; varying vec4 vFiberAxis; varying vec2 vFiberRange;
float fiberH = 0.5; float fiberAmp = 0.0;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
 vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
 return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Noise that changes quickly across the fibre direction and slowly along it, which reads as strands.
float fibers(vec3 p, vec3 a, float period) { float along = dot(p, a); return vnoise((p - a * along) / period + a * along / (period * 14.0)); }
`;

const COLOR = `
vec3 fiberAxis = vFiberAxis.xyz;
if (dot(fiberAxis, fiberAxis) > 0.25) {
 float s = vFiberAxis.w, foot = length(fwidth(vFiberPos));
 float fade1 = 1.0 - smoothstep(${FIBRE_PERIODS[0] * 0.25}, ${FIBRE_PERIODS[0] * 0.7}, foot), fade2 = 1.0 - smoothstep(${FIBRE_PERIODS[1] * 0.25}, ${FIBRE_PERIODS[1] * 0.7}, foot);
 fiberH = 0.5 + (fibers(vFiberPos, fiberAxis, ${FIBRE_PERIODS[0]}) - 0.5) * fade1 * 0.6 + (fibers(vFiberPos, fiberAxis, ${FIBRE_PERIODS[1]}) - 0.5) * fade2 * 0.4;
 fiberAmp = max(fade1, fade2);
 diffuseColor.rgb *= vec3(0.8 + 0.4 * s, 0.82 + 0.36 * fract(s * 7.31), 0.86 + 0.28 * fract(s * 3.77));
 diffuseColor.rgb *= 1.0 + (fiberH - 0.5) * 0.9;
 float t = (dot(vFiberPos, fiberAxis) - vFiberRange.x) / max(vFiberRange.y - vFiberRange.x, 0.0001);
 float tendon = max(smoothstep(0.86, 1.0, t), 1.0 - smoothstep(0.0, 0.14, t));
 diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.58, 0.42), tendon * 0.55);
}`;

const ROUGHNESS = '\nroughnessFactor = clamp(roughnessFactor * (0.82 + 0.34 * (1.0 - fiberH)), 0.2, 1.0);';

// Bump mapping from the fibre height, using screen-space derivatives (no UVs needed).
const NORMAL = `
if (fiberAmp > 0.01) {
 vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
 vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
 float det = dot(dpdx, r1);
 vec3 grad = sign(det) * (dFdx(fiberH) * r1 + dFdy(fiberH) * r2);
 normal = normalize(abs(det) * normal - 0.003 * fiberAmp * grad);
}`;

const EDGE = '\nfloat edgeFacing = abs(dot(normalize(normal), normalize(vViewPosition)));\ngl_FragColor.rgb *= mix(0.62, 1.0, smoothstep(0.05, 0.6, edgeFacing));';

/** Adds the muscle look to a part material's shader (called after the shared part-state changes). */
export function muscleShader(shader:T.WebGLProgramParametersWithUniforms, fiberState:T.Texture) {
 shader.uniforms.fiberState = {value: fiberState};
 shader.vertexShader = VERTEX_DECLARATIONS + shader.vertexShader;
 shader.vertexShader = shader.vertexShader.replace('transformed += state.xyz;', 'transformed += state.xyz;' + VERTEX_LOOKUP);
 shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader;
 shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>' + COLOR);
 shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>' + ROUGHNESS);
 shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + NORMAL);
 shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>' + EDGE);
}
