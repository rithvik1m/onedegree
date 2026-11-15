// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * Shared shader patches.
 *
 * 1. SUN GATE — the shadow map only covers ~±1.5 km around the player, so a ridge
 *    30 km away could never shade them. Each frame the world computes how much of
 *    the Sun's disc clears the *distant* terrain horizon at the player's position
 *    (terrain3d.farHorizon) and multiplies direct sunlight by that fraction for
 *    everything within ~2 km of the player. Far terrain keeps full sunlight, so
 *    distant peaks can glow while your valley is dark — as on the real Moon.
 *
 * 2. REGOLITH DETAIL (terrain only) — procedural albedo variation and bump detail
 *    at metre scales the 10 m DEM cannot resolve. It changes shading only, never
 *    geometry, so it cannot affect any computed horizon. Labelled in the UI as
 *    "visual detail, not measured".
 */

import * as THREE from "three";

export const shared = {
  sunGate: { value: 1 },
  player: { value: new THREE.Vector3() },
  detail: { value: 1 },
};

const NOISE = /* glsl */ `
vec2 odHash(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return -1.0 + 2.0*fract(sin(p)*43758.5453123); }
float odNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(dot(odHash(i+vec2(0,0)), f-vec2(0,0)), dot(odHash(i+vec2(1,0)), f-vec2(1,0)), u.x),
             mix(dot(odHash(i+vec2(0,1)), f-vec2(0,1)), dot(odHash(i+vec2(1,1)), f-vec2(1,1)), u.x), u.y);
}
float odFbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<3;i++){ s+=a*odNoise(p); p*=2.03; a*=0.5; } return s; }
// sparse small-crater field: only some cells hold a crater (bowl + soft raised rim)
float odCraters(vec2 p, float density){
  vec2 i = floor(p), f = fract(p); float h = 0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g = vec2(float(x),float(y));
    vec2 o = 0.5 + 0.5*odHash(i+g);
    if (fract(o.x*17.31 + o.y*5.13) > density) continue;
    float rad = 0.12 + 0.33*pow(fract(o.y*9.71), 2.0);
    float d = length(g + o - f) / rad;
    if (d < 1.5) h += (d < 1.0 ? (d*d - 1.0) * 0.5 : 0.0) + 0.18*exp(-pow((d-1.0)*4.0,2.0));
  }
  return h;
}
`;

function patchSunGate(shader: THREE.WebGLProgramParametersWithUniforms, lunar = false): void {
  shader.uniforms.odSunGate = shared.sunGate;
  shader.uniforms.odPlayer = shared.player;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vOdWorld;")
    .replace("#include <project_vertex>", "#include <project_vertex>\nvOdWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
  const lights = THREE.ShaderChunk.lights_fragment_begin.replace(
    "getDirectionalLightInfo( directionalLight, directLight );",
    "getDirectionalLightInfo( directionalLight, directLight );\n\t\t#if UNROLLED_LOOP_INDEX == 0\n\t\tdirectLight.color *= odGate;\n\t\t#endif" +
      (lunar
        ? // Lunar-Lambert photometric function (McEwen 1991): radiance ∝ (1−L)·μ0 + 2L·μ0/(μ0+μ).
          // Three's Lambert term already supplies μ0, so scale by (1−L) + 2L/(μ0+μ).
          "\n\t\t{ float mu0 = max(dot(geometryNormal, directLight.direction), 0.0); float mu = max(dot(geometryNormal, geometryViewDir), 0.05);\n\t\t  directLight.color *= min(6.0, (1.0 - 0.7) + 1.4 / (mu0 + mu)); }"
        : ""),
  );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vOdWorld;\nuniform float odSunGate;\nuniform vec3 odPlayer;")
    .replace("#include <lights_fragment_begin>", "float odGate = mix(odSunGate, 1.0, smoothstep(1800.0, 2600.0, distance(vOdWorld.xz, odPlayer.xz)));\n" + lights);
}

/** Any lit material in the world: gate the Sun by the distant horizon. */
export function gated<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (s) => patchSunGate(s);
  m.customProgramCacheKey = () => "od-gate";
  return m;
}

/** Regolith: gated sunlight + procedural metre-scale detail that fades with distance. */
export function regolithMaterial(far = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x9a968f, roughness: 0.97, metalness: 0 });
  m.onBeforeCompile = (s) => {
    patchSunGate(s, true);
    s.uniforms.odDetail = shared.detail;
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float odDetail;\n${NOISE}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float odDist = length(vOdWorld - cameraPosition);
        vec2 wp = vOdWorld.xz;
        float big = odFbm(wp / 900.0);
        float mid = odFbm(wp / 70.0);
        float fine = odFbm(wp / 3.0) * (1.0 - smoothstep(30.0, 160.0, odDist));
        float alb = 1.0 + 0.16*big + 0.10*mid + 0.08*fine * odDetail;
        diffuseColor.rgb *= alb;
        ${far ? "" : ""}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        if (odDetail > 0.0) {
          float fade = 1.0 - smoothstep(25.0, 220.0, odDist);
          if (fade > 0.0) {
            float e = 0.08;
            vec2 q = wp / 2.2;
            #define ODH(w) (odFbm((w) / 2.2) * 0.22 + odCraters((w) / 7.0, 0.22) * 0.55 + odCraters((w) / 1.8, 0.18) * 0.16)
            float h0 = ODH(wp);
            float hx = ODH(wp + vec2(e, 0.0));
            float hz = ODH(wp + vec2(0.0, e));
            vec3 bw = vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.16 * fade * odDetail;
            normal = normalize(normal + (viewMatrix * vec4(bw, 0.0)).xyz);
          }
        }`,
      );
  };
  m.customProgramCacheKey = () => (far ? "od-regolith-far" : "od-regolith");
  return m;
}
