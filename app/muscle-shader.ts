import type * as T from 'three';

/**
 * Muscle look: every muscle gets its own shade so neighbours read as separate shapes, the two ends fade to pale tendon, and
 * the silhouette darkens a little. (A fibre texture was tried and dropped: at body scale it looked like noisy stripes.)
 * The long axis of each muscle and how far it reaches along it come from fiberState (see fiber-axis.ts).
 */
const VERTEX_DECLARATIONS = 'uniform sampler2D fiberState; varying vec3 vFiberPos; varying vec4 vFiberAxis; varying vec2 vFiberRange;\n';
const VERTEX_LOOKUP = ' vFiberPos = position; vec2 fiberUv = vec2((partIndex + 0.5) / stateWidth, 0.25); vFiberAxis = texture2D(fiberState, fiberUv); vFiberRange = texture2D(fiberState, fiberUv + vec2(0.0, 0.5)).xy;';

const FRAGMENT_DECLARATIONS = 'varying vec3 vFiberPos; varying vec4 vFiberAxis; varying vec2 vFiberRange;\n';

const COLOR = `
vec3 fiberAxis = vFiberAxis.xyz;
if (dot(fiberAxis, fiberAxis) > 0.25) {
 float s = vFiberAxis.w;
 diffuseColor.rgb *= vec3(0.72 + 0.56 * s, 0.76 + 0.48 * fract(s * 7.31), 0.8 + 0.4 * fract(s * 3.77));
 float t = (dot(vFiberPos, fiberAxis) - vFiberRange.x) / max(vFiberRange.y - vFiberRange.x, 0.0001);
 float tendon = max(smoothstep(0.82, 1.0, t), 1.0 - smoothstep(0.0, 0.18, t));
 diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.66, 0.5), tendon * 0.8);
}`;

const EDGE = '\nfloat edgeFacing = abs(dot(normalize(normal), normalize(vViewPosition)));\ngl_FragColor.rgb *= mix(0.6, 1.0, smoothstep(0.05, 0.55, edgeFacing));';

/** Adds the muscle look to a part material's shader (called after the shared part-state changes). */
export function muscleShader(shader:T.WebGLProgramParametersWithUniforms, fiberState:T.Texture) {
 shader.uniforms.fiberState = {value: fiberState};
 shader.vertexShader = VERTEX_DECLARATIONS + shader.vertexShader;
 shader.vertexShader = shader.vertexShader.replace('transformed += state.xyz;', 'transformed += state.xyz;' + VERTEX_LOOKUP);
 shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader;
 shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>' + COLOR);
 shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>' + EDGE);
}
