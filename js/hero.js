import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

/* Procedural hero backdrop: a cold, slow-drifting haze field with a low warm
   horizon. One fullscreen quad and one fragment shader -- no video, no image
   downloads, and it runs on the GPU.

   Under prefers-reduced-motion it renders a single frame and holds it, so the
   page still opens on a composed image rather than a blank panel. */

const mount = document.getElementById('heroCanvas');
const stage = document.querySelector('.hero__bg');
if (!mount || !stage) throw new Error('Hero canvas is missing.');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: mount, antialias: false, alpha: true, powerPreference: 'low-power' });
} catch (error) {
  stage.dataset.heroFallback = 'true';
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uTime: { value: 0 },
  uAspect: { value: 1 },
  uScroll: { value: 0 },
  uPointer: { value: new THREE.Vector2(0, 0) },
};

const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform float uAspect;
    uniform float uScroll;
    uniform vec2 uPointer;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p);
        p *= 2.02;
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec2 uv = vUv;
      vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y - 0.5);

      // Parallax: pointer nudges the field, scroll sinks it.
      p += uPointer * 0.035;
      p.y += uScroll * 0.12;

      float drift = uTime * 0.012;

      // Two haze layers moving at different speeds give the field depth.
      float far = fbm(p * 1.6 + vec2(drift, -drift * 0.4));
      float near = fbm(p * 3.1 + vec2(-drift * 1.7, drift * 0.8) + far * 0.4);
      float haze = mix(far, near, 0.45);

      // Cold mist gathers toward the top, ground falls away into dark --
      // the tonal range the reference gets from real mountain haze.
      float sky = smoothstep(-0.30, 0.48, p.y);
      float ground = 1.0 - smoothstep(-0.50, 0.02, p.y);

      vec3 deep = vec3(0.031, 0.042, 0.063);
      vec3 cold = vec3(0.140, 0.191, 0.244);
      vec3 mist = vec3(0.560, 0.650, 0.716);
      vec3 warm = vec3(0.776, 0.576, 0.286);

      vec3 colour = mix(deep, cold, sky);
      // Haze is strongest where the mist sits, and reads as drifting banks.
      float bank = haze * (0.35 + 0.95 * sky);
      colour = mix(colour, mist, clamp(bank * 0.72, 0.0, 0.85));

      // Low warm light catching the underside of the haze.
      colour += warm * ground * (0.22 + 0.38 * haze) * 0.55;

      // Soft shaft from the upper right so the frame is never flat.
      float shaft = smoothstep(0.95, 0.0, distance(uv, vec2(0.80, 0.95)));
      colour += mist * shaft * 0.16;

      float vignette = smoothstep(1.35, 0.30, length(p * vec2(0.80, 1.15)));
      colour *= 0.42 + 0.58 * vignette;
      colour += (hash(uv * 900.0 + fract(uTime)) - 0.5) * 0.022;

      gl_FragColor = vec4(colour, 1.0);
    }
  `,
});

scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

let frame = 0;
let visible = true;

function resize() {
  const rect = stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  renderer.setSize(rect.width, rect.height, false);
  uniforms.uAspect.value = rect.width / rect.height;
  renderer.render(scene, camera);
}

function render(time) {
  uniforms.uTime.value = time / 1000;
  renderer.render(scene, camera);
  frame = visible && !reducedMotion.matches ? window.requestAnimationFrame(render) : 0;
}

function start() {
  if (frame) window.cancelAnimationFrame(frame);
  if (reducedMotion.matches) {
    // One composed frame, then hold it.
    uniforms.uTime.value = 12.0;
    renderer.render(scene, camera);
    return;
  }
  frame = window.requestAnimationFrame(render);
}

// Stop drawing once the hero scrolls away; the page is long.
const observer = new IntersectionObserver((entries) => {
  visible = entries[0].isIntersecting;
  if (visible) start();
  else if (frame) {
    window.cancelAnimationFrame(frame);
    frame = 0;
  }
}, { threshold: 0.01 });
observer.observe(stage);

window.addEventListener('scroll', () => {
  const rect = stage.getBoundingClientRect();
  uniforms.uScroll.value = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height)));
}, { passive: true });

window.addEventListener('pointermove', (event) => {
  if (reducedMotion.matches) return;
  uniforms.uPointer.value.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    (event.clientY / window.innerHeight) * 2 - 1,
  );
}, { passive: true });

new ResizeObserver(resize).observe(stage);
window.addEventListener('resize', resize, { passive: true });
reducedMotion.addEventListener('change', start);

resize();
start();
window.heroReady = true;
