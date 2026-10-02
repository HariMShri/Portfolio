import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const AGENTS = [
  {
    id: 'role-scout', name: 'Mira Patel', role: 'Role Scout',
    shirt: 0x2f6f66, trousers: 0x37414a, skin: 0xc08a62, hair: 0x241c1b,
    accent: 0xe0ad55, hairStyle: 'bun', build: 1.0, wears: ['lanyard'], screen: 'search',
  },
  {
    id: 'fit-analyst', name: 'Arjun Rao', role: 'Fit Analyst',
    shirt: 0x3c6490, trousers: 0x343842, skin: 0xcf9a6f, hair: 0x2a211d,
    accent: 0x6f9fd0, hairStyle: 'short', build: 1.08, wears: ['glasses', 'lanyard'], screen: 'chart',
  },
  {
    id: 'resume-tailor', name: 'Leena Das', role: 'Resume Tailor',
    shirt: 0xa8584a, trousers: 0x3a3b46, skin: 0xb8795a, hair: 0x2b2020,
    accent: 0xd6bd61, hairStyle: 'long', build: 0.96, wears: ['cardigan'], screen: 'doc',
  },
  {
    id: 'application-writer', name: 'Kabir Shah', role: 'Application Writer',
    shirt: 0x62793f, trousers: 0x33363d, skin: 0xd8a87f, hair: 0x3d2a20,
    accent: 0xd88e50, hairStyle: 'curly', build: 1.03, wears: ['headphones'], screen: 'code',
  },
  {
    id: 'application-reviewer', name: 'Nisha Menon', role: 'Application Reviewer',
    shirt: 0x8a6240, trousers: 0x2f3a3f, skin: 0xc08365, hair: 0x201c1e,
    accent: 0xd8bf6a, hairStyle: 'ponytail', build: 0.98, wears: ['glasses', 'lanyard'], screen: 'checklist',
  },
  {
    id: 'application-coordinator', name: 'Dev Malhotra', role: 'Application Coordinator',
    shirt: 0x36707d, trousers: 0x2f333b, skin: 0xd09b76, hair: 0x332724,
    accent: 0xe0ad55, hairStyle: 'short', build: 1.05, wears: ['blazer', 'lanyard'], screen: 'mail',
  },
  {
    id: 'feedback-analyst', name: 'Tara Iyer', role: 'Feedback Analyst',
    shirt: 0x6f5a86, trousers: 0x383a45, skin: 0xc58a6a, hair: 0x271d20,
    accent: 0xb98fd0, hairStyle: 'braid', build: 0.97, wears: ['glasses'], screen: 'metrics',
  },
];

const canvas = document.getElementById('agentNetworkCanvas');
const fallback = document.getElementById('agentNetworkFallback');
const sceneRoot = document.getElementById('agentNetwork');
if (!canvas || !sceneRoot) throw new Error('Agent network scene elements are missing.');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e13);

const camera = new THREE.OrthographicCamera(-8, 8, 5.5, -5.5, 0.1, 110);
camera.position.set(0, 11.6, 14.5);
camera.lookAt(0, 0, 0);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
} catch (error) {
  canvas.hidden = true;
  fallback.hidden = false;
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;

scene.add(new THREE.HemisphereLight(0xf2f7ff, 0x8d8477, 1.45));
const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.35);
keyLight.position.set(-8, 14, 7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -15;
keyLight.shadow.camera.right = 15;
keyLight.shadow.camera.top = 14;
keyLight.shadow.camera.bottom = -14;
keyLight.shadow.camera.far = 40;
keyLight.shadow.bias = -0.0012;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight);
const windowLight = new THREE.DirectionalLight(0xdcebff, 0.85);
windowLight.position.set(6, 8, -9);
scene.add(windowLight);

const world = new THREE.Group();
scene.add(world);
const roomRoot = new THREE.Group();
world.add(roomRoot);
const linkRoot = new THREE.Group();
world.add(linkRoot);
const propRoot = new THREE.Group();
world.add(propRoot);

/* ---------- shared geometry + material caches ---------- */

const geometryCache = new Map();
const materialCache = new Map();

function geometry(key, make) {
  let item = geometryCache.get(key);
  if (!item) {
    item = make();
    geometryCache.set(key, item);
  }
  return item;
}

function box(x, y, z) {
  return geometry(`box:${x},${y},${z}`, () => new THREE.BoxGeometry(x, y, z));
}

function cylinder(top, bottom, height, segments = 14) {
  return geometry(`cyl:${top},${bottom},${height},${segments}`, () => new THREE.CylinderGeometry(top, bottom, height, segments));
}

function sphere(radius, widthSegments = 14, heightSegments = 10) {
  return geometry(`sph:${radius},${widthSegments},${heightSegments}`, () => new THREE.SphereGeometry(radius, widthSegments, heightSegments));
}

function capsule(radius, length, radialSegments = 10) {
  return geometry(`cap:${radius},${length},${radialSegments}`, () => new THREE.CapsuleGeometry(radius, length, 4, radialSegments));
}

function torus(radius, tube, radialSegments = 8, tubularSegments = 28) {
  return geometry(`tor:${radius},${tube},${radialSegments},${tubularSegments}`, () => new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments));
}

function plane(width, height) {
  return geometry(`pln:${width},${height}`, () => new THREE.PlaneGeometry(width, height));
}

function material(color, options = {}) {
  const { roughness = 0.78, metalness = 0, transparent = false, opacity = 1, side = THREE.FrontSide } = options;
  const key = `${color}:${roughness}:${metalness}:${transparent}:${opacity}:${side}`;
  let item = materialCache.get(key);
  if (!item) {
    item = new THREE.MeshStandardMaterial({ color, roughness, metalness, transparent, opacity, side });
    materialCache.set(key, item);
  }
  return item;
}

function mesh(geo, mat, parent, position = [0, 0, 0], options = {}) {
  const item = new THREE.Mesh(geo, mat);
  item.position.set(...position);
  if (options.rotation) item.rotation.set(...options.rotation);
  if (options.scale) item.scale.set(...options.scale);
  item.castShadow = options.cast !== false;
  item.receiveShadow = options.receive !== false;
  parent.add(item);
  return item;
}

/* ---------- procedural textures (no external assets) ---------- */

let randomSeed = 20260213;
function random() {
  randomSeed = (randomSeed * 1664525 + 1013904223) % 4294967296;
  return randomSeed / 4294967296;
}

function drawTexture(size, draw, repeat) {
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  draw(element.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
  }
  texture.anisotropy = 4;
  return texture;
}

const carpetTexture = drawTexture(128, (ctx, size) => {
  ctx.fillStyle = '#9ca89d';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2400; i += 1) {
    ctx.fillStyle = i % 3 ? 'rgba(255,255,255,0.055)' : 'rgba(40,52,44,0.07)';
    ctx.fillRect(random() * size, random() * size, 2, 2);
  }
  ctx.strokeStyle = 'rgba(48,60,52,0.1)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
}, [26, 18]);

const skylineTexture = drawTexture(256, (ctx, size) => {
  const sky = ctx.createLinearGradient(0, 0, 0, size);
  sky.addColorStop(0, '#9fc6e4');
  sky.addColorStop(0.62, '#cfe2ee');
  sky.addColorStop(1, '#e6eee9');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, size, size);
  const tones = ['#b6c6cd', '#a8bac3', '#c2cfd4', '#9db1bb'];
  for (let i = 0; i < 26; i += 1) {
    const width = 14 + random() * 26;
    const height = 36 + random() * 92;
    const x = random() * size;
    ctx.fillStyle = tones[Math.floor(random() * tones.length)];
    ctx.fillRect(x, size - height, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let wy = size - height + 8; wy < size - 8; wy += 11) {
      for (let wx = x + 4; wx < x + width - 5; wx += 9) {
        if (random() > 0.45) ctx.fillRect(wx, wy, 4, 5);
      }
    }
  }
});

const whiteboardTexture = drawTexture(256, (ctx, size) => {
  ctx.fillStyle = '#f7f8f4';
  ctx.fillRect(0, 0, size, size);
  const inks = ['#2f6f66', '#9c4f3a', '#3c6490', '#5f6a4a'];
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i += 1) {
    ctx.strokeStyle = inks[i % inks.length];
    const x = 22 + random() * 60;
    const y = 30 + i * 42;
    ctx.strokeRect(x, y, 48 + random() * 34, 24);
    ctx.beginPath();
    ctx.moveTo(x + 96, y + 12);
    ctx.lineTo(x + 140, y + 12);
    ctx.lineTo(x + 132, y + 5);
    ctx.moveTo(x + 140, y + 12);
    ctx.lineTo(x + 132, y + 19);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(70,86,76,0.5)';
  for (let i = 0; i < 16; i += 1) {
    ctx.fillRect(170 + random() * 50, 34 + i * 12, 30 + random() * 40, 3);
  }
});

const SCREEN_BACKGROUND = '#17222b';

function screenTexture(kind) {
  return drawTexture(128, (ctx, size) => {
    ctx.fillStyle = SCREEN_BACKGROUND;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#243541';
    ctx.fillRect(0, 0, size, 11);
    ctx.fillStyle = '#4f6b78';
    ctx.fillRect(5, 4, 22, 4);

    if (kind === 'code') {
      const inks = ['#7fd4b4', '#e0ad55', '#9fc6e4', '#c9d6cf'];
      for (let i = 0; i < 16; i += 1) {
        ctx.fillStyle = inks[i % inks.length];
        ctx.fillRect(9 + (i % 3) * 7, 20 + i * 6.4, 30 + random() * 62, 3);
      }
    } else if (kind === 'chart') {
      ctx.fillStyle = '#2b3f4b';
      ctx.fillRect(10, 86, 108, 2);
      for (let i = 0; i < 7; i += 1) {
        const height = 14 + random() * 56;
        ctx.fillStyle = i % 2 ? '#7fd4b4' : '#e0ad55';
        ctx.fillRect(14 + i * 15, 86 - height, 10, height);
      }
      ctx.fillStyle = '#9fc6e4';
      ctx.fillRect(10, 98, 70, 3);
      ctx.fillRect(10, 106, 46, 3);
    } else if (kind === 'doc') {
      ctx.fillStyle = '#eef2ec';
      ctx.fillRect(18, 18, 92, 100);
      ctx.fillStyle = '#3d4f46';
      ctx.fillRect(26, 26, 46, 5);
      ctx.fillStyle = '#8c9a92';
      for (let i = 0; i < 11; i += 1) ctx.fillRect(26, 40 + i * 7, 60 + random() * 16, 3);
    } else if (kind === 'checklist') {
      for (let i = 0; i < 8; i += 1) {
        ctx.strokeStyle = '#7fd4b4';
        ctx.lineWidth = 2;
        ctx.strokeRect(14, 22 + i * 12, 8, 8);
        if (i % 3 !== 2) {
          ctx.beginPath();
          ctx.moveTo(16, 26 + i * 12);
          ctx.lineTo(18, 29 + i * 12);
          ctx.lineTo(21, 23 + i * 12);
          ctx.stroke();
        }
        ctx.fillStyle = '#b4c3bb';
        ctx.fillRect(28, 24 + i * 12, 40 + random() * 50, 4);
      }
    } else if (kind === 'mail') {
      for (let i = 0; i < 6; i += 1) {
        ctx.fillStyle = i === 1 ? '#24404a' : '#1d2f39';
        ctx.fillRect(10, 20 + i * 17, 108, 14);
        ctx.fillStyle = '#e0ad55';
        ctx.fillRect(14, 24 + i * 17, 6, 6);
        ctx.fillStyle = '#a9bcc4';
        ctx.fillRect(25, 25 + i * 17, 50 + random() * 40, 4);
      }
    } else if (kind === 'metrics') {
      ctx.strokeStyle = '#7fd4b4';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i <= 10; i += 1) {
        const x = 12 + i * 10.6;
        const y = 80 - Math.sin(i * 0.72) * 22 - i * 2.4;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = '#2b3f4b';
      ctx.fillRect(12, 92, 104, 2);
      ctx.fillStyle = '#e0ad55';
      for (let i = 0; i < 3; i += 1) ctx.fillRect(12, 100 + i * 8, 40 + random() * 50, 4);
    } else {
      ctx.fillStyle = '#20313c';
      ctx.fillRect(10, 18, 108, 18);
      ctx.fillStyle = '#7fd4b4';
      ctx.fillRect(14, 24, 36, 5);
      for (let i = 0; i < 7; i += 1) {
        ctx.fillStyle = '#1e2f39';
        ctx.fillRect(10, 42 + i * 11, 108, 8);
        ctx.fillStyle = '#9fc6e4';
        ctx.fillRect(14, 44 + i * 11, 30 + random() * 60, 4);
      }
    }
  });
}

const screenTextures = new Map();

function screenMaterial(kind) {
  let texture = screenTextures.get(kind);
  if (!texture) {
    texture = screenTexture(kind);
    screenTextures.set(kind, texture);
  }
  return new THREE.MeshStandardMaterial({
    map: texture,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: 0.55,
    roughness: 0.42,
    metalness: 0,
  });
}

/* ---------- room shell ---------- */

const WALL_HEIGHT = 2.6;
const wallPanels = [];

function roomSize(mobile) {
  return mobile ? { width: 8.8, depth: 15.0 } : { width: 20.5, depth: 13.6 };
}

function buildWall(width, offset, angle, kind) {
  const group = new THREE.Group();
  group.position.set(offset.x, 0, offset.z);
  group.rotation.y = angle;
  group.userData.facing = new THREE.Vector2(Math.sin(angle), Math.cos(angle));
  roomRoot.add(group);
  wallPanels.push(group);

  const paint = material(0xe9e6dd, { roughness: 0.94 });
  const trim = material(0xcfcabd, { roughness: 0.86 });

  if (kind === 'window') {
    const sill = 0.9;
    const header = 2.25;
    mesh(box(width, sill, 0.18), paint, group, [0, sill / 2, 0], { cast: false });
    mesh(box(width, WALL_HEIGHT - header, 0.18), paint, group, [0, header + (WALL_HEIGHT - header) / 2, 0], { cast: false });
    mesh(box(width, 0.1, 0.26), trim, group, [0, sill + 0.03, 0.02], { cast: false });
    const panes = Math.max(3, Math.round(width / 2.6));
    for (let i = 0; i <= panes; i += 1) {
      const x = -width / 2 + (width / panes) * i;
      mesh(box(0.11, header - sill, 0.2), trim, group, [x, (sill + header) / 2, 0], { cast: false });
    }
    const glass = mesh(plane(width - 0.1, header - sill), new THREE.MeshStandardMaterial({
      color: 0xd8e9f2, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.32,
    }), group, [0, (sill + header) / 2, 0.02], { cast: false, receive: false });
    glass.renderOrder = 2;
    mesh(plane(width + 1.6, 4.6), new THREE.MeshBasicMaterial({ map: skylineTexture }), group,
      [0, 1.9, -1.1], { cast: false, receive: false });
    // Blinds, raised: a thin slatted band tucked under the header.
    for (let i = 0; i < 5; i += 1) {
      mesh(box(width - 0.3, 0.035, 0.07), trim, group, [0, header - 0.09 - i * 0.055, 0.06], { cast: false });
    }
  } else {
    mesh(box(width, WALL_HEIGHT, 0.18), paint, group, [0, WALL_HEIGHT / 2, 0], { cast: false });
  }
  mesh(box(width, 0.14, 0.24), trim, group, [0, 0.07, 0.03], { cast: false });
  return group;
}

function buildWhiteboard(parent, x) {
  const frame = mesh(box(2.6, 1.5, 0.08), material(0xbfc6bd, { roughness: 0.6, metalness: 0.2 }), parent, [x, 1.65, 0.12]);
  mesh(plane(2.44, 1.34), new THREE.MeshStandardMaterial({ map: whiteboardTexture, roughness: 0.52 }), frame,
    [0, 0, 0.05], { cast: false, receive: false });
  mesh(box(2.6, 0.06, 0.14), material(0xa9b0a6, { roughness: 0.6 }), frame, [0, -0.78, 0.06], { cast: false });
  mesh(box(0.16, 0.04, 0.04), material(0xc0503f), frame, [-0.5, -0.78, 0.1], { cast: false });
  mesh(box(0.16, 0.04, 0.04), material(0x3c6490), frame, [-0.28, -0.78, 0.1], { cast: false });
}

function buildWallClock(parent, x) {
  const face = mesh(cylinder(0.26, 0.26, 0.05, 20), material(0xf4f2ea, { roughness: 0.5 }), parent,
    [x, 2.3, 0.14], { rotation: [Math.PI / 2, 0, 0] });
  mesh(torus(0.26, 0.022, 6, 22), material(0x4a5048, { roughness: 0.5, metalness: 0.3 }), face,
    [0, 0.03, 0], { rotation: [Math.PI / 2, 0, 0], cast: false });
  mesh(box(0.016, 0.016, 0.17), material(0x33382f), face, [0, 0.04, -0.06], { cast: false });
  mesh(box(0.11, 0.015, 0.015), material(0x33382f), face, [0.04, 0.04, 0], { cast: false });
}

function buildPoster(parent, x, color) {
  const frame = mesh(box(0.92, 1.18, 0.06), material(0x6c6256, { roughness: 0.7 }), parent, [x, 1.9, 0.12]);
  mesh(plane(0.78, 1.04), material(color, { roughness: 0.75 }), frame, [0, 0, 0.04], { cast: false, receive: false });
  mesh(plane(0.5, 0.26), material(0xf2efe6, { roughness: 0.8 }), frame, [0, -0.3, 0.05], { cast: false, receive: false });
}

function buildCeilingPanel(x, z) {
  const panel = mesh(box(1.9, 0.06, 0.42), material(0xb9bdb6, { roughness: 0.5 }), roomRoot, [x, 2.86, z], { cast: false, receive: false });
  mesh(plane(1.74, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff4de }), panel,
    [0, -0.035, 0], { rotation: [Math.PI / 2, 0, 0], cast: false, receive: false });
}

function buildRoom(mobile) {
  roomRoot.clear();
  wallPanels.length = 0;
  const { width, depth } = roomSize(mobile);

  const floorTexture = carpetTexture.clone();
  floorTexture.needsUpdate = true;
  floorTexture.repeat.set(width / 1.05, depth / 1.05);
  mesh(plane(width, depth), new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.96 }), roomRoot,
    [0, 0.002, 0], { rotation: [-Math.PI / 2, 0, 0], cast: false });
  mesh(box(width, 0.26, depth), material(0x7f8a81, { roughness: 0.9 }), roomRoot, [0, -0.13, 0], { cast: false });

  buildWall(width, { x: 0, z: -depth / 2 }, 0, 'window');
  buildWall(width, { x: 0, z: depth / 2 }, Math.PI, 'solid');
  const left = buildWall(depth, { x: -width / 2, z: 0 }, Math.PI / 2, mobile ? 'solid' : 'window');
  const right = buildWall(depth, { x: width / 2, z: 0 }, -Math.PI / 2, 'solid');

  if (!mobile) {
    buildWhiteboard(right, -2.4);
    buildWallClock(right, 1.2);
    buildPoster(right, 4.0, 0x55796d);
    buildPoster(left, 4.6, 0x8a6a4a);
    buildCeilingPanel(-4.6, -6.1);
    buildCeilingPanel(4.6, -6.1);
  } else {
    buildWhiteboard(right, -2.6);
    buildWallClock(right, 2.4);
  }
}

/* ---------- office furniture ---------- */

function buildOfficeChair(parent, position, facing) {
  const chair = new THREE.Group();
  chair.position.set(position[0], 0, position[1]);
  chair.rotation.y = facing;
  parent.add(chair);

  const frame = material(0x3a3f44, { roughness: 0.55, metalness: 0.35 });
  const fabric = material(0x4c5358, { roughness: 0.92 });

  mesh(cylinder(0.05, 0.05, 0.34, 10), frame, chair, [0, 0.17, 0], { cast: false });
  for (let i = 0; i < 5; i += 1) {
    const angle = (Math.PI * 2 * i) / 5;
    const leg = mesh(box(0.07, 0.045, 0.34), frame, chair,
      [Math.sin(angle) * 0.17, 0.05, Math.cos(angle) * 0.17], { rotation: [0, angle, 0], cast: false });
    mesh(cylinder(0.035, 0.035, 0.05, 8), material(0x25292d), leg, [0, -0.03, 0.16], { rotation: [Math.PI / 2, 0, 0], cast: false });
  }
  mesh(box(0.46, 0.1, 0.44), fabric, chair, [0, 0.4, 0]);
  const back = mesh(box(0.44, 0.52, 0.09), fabric, chair, [0, 0.69, -0.21]);
  back.rotation.x = -0.14;
  mesh(box(0.38, 0.08, 0.05), material(0x33383c, { roughness: 0.7 }), back, [0, 0.12, -0.06], { cast: false });
  for (const side of [-1, 1]) {
    mesh(box(0.05, 0.2, 0.05), frame, chair, [side * 0.25, 0.54, -0.04], { cast: false });
    mesh(box(0.07, 0.05, 0.26), material(0x2e3338, { roughness: 0.8 }), chair, [side * 0.25, 0.65, 0.01], { cast: false });
  }
  return chair;
}

function buildMonitor(parent, position, angle, kind, scale = 1) {
  const group = new THREE.Group();
  group.position.set(position[0], position[1], position[2]);
  group.rotation.y = angle;
  group.scale.setScalar(scale);
  parent.add(group);

  const shell = material(0x2c3136, { roughness: 0.55, metalness: 0.25 });
  mesh(box(0.2, 0.025, 0.14), shell, group, [0, 0.012, 0], { cast: false });
  mesh(box(0.05, 0.2, 0.04), shell, group, [0, 0.11, -0.01], { cast: false });
  const panel = mesh(box(0.66, 0.4, 0.035), shell, group, [0, 0.42, 0]);
  panel.rotation.x = -0.07;
  const face = mesh(plane(0.62, 0.355), screenMaterial(kind), panel, [0, 0, 0.022], { cast: false, receive: false });
  return { group, panel, screen: face };
}

function buildDeskProps(parent, agent, mobile) {
  const metal = material(0x6f7a72, { roughness: 0.5, metalness: 0.35 });
  const paper = material(0xf4f1e6, { roughness: 0.9 });

  mesh(box(0.42, 0.018, 0.15), material(0x2f343a, { roughness: 0.6 }), parent, [0, 0.755, 0.0], { cast: false });
  for (let row = 0; row < 3; row += 1) {
    mesh(box(0.36, 0.006, 0.022), material(0x454c52, { roughness: 0.7 }), parent, [0, 0.766, -0.04 + row * 0.04], { cast: false });
  }
  mesh(box(0.08, 0.022, 0.12), material(0x2f343a, { roughness: 0.6 }), parent, [0.33, 0.757, 0.02], { cast: false });

  const mug = mesh(cylinder(0.045, 0.04, 0.085, 12), material(agent.accent, { roughness: 0.5 }), parent, [-0.44, 0.788, 0.1]);
  mesh(torus(0.028, 0.011, 5, 10), material(agent.accent, { roughness: 0.5 }), mug, [0.055, 0, 0], { cast: false });

  mesh(box(0.22, 0.012, 0.3), paper, parent, [0.5, 0.752, 0.18], { rotation: [0, 0.22, 0], cast: false });
  mesh(box(0.2, 0.01, 0.28), paper, parent, [0.52, 0.762, 0.2], { rotation: [0, -0.1, 0], cast: false });

  if (mobile) return;

  const laptop = new THREE.Group();
  laptop.position.set(-0.58, 0.748, 0.24);
  laptop.rotation.y = 0.42;
  parent.add(laptop);
  mesh(box(0.34, 0.016, 0.24), metal, laptop, [0, 0, 0]);
  const lid = mesh(box(0.34, 0.22, 0.014), metal, laptop, [0, 0.1, -0.115], { rotation: [-0.32, 0, 0] });
  mesh(plane(0.3, 0.18), new THREE.MeshStandardMaterial({
    color: 0x1b2a33, emissive: 0x2d4a56, emissiveIntensity: 0.4, roughness: 0.4,
  }), lid, [0, 0, 0.009], { cast: false, receive: false });

  const pot = mesh(cylinder(0.08, 0.065, 0.11, 10), material(0xb0785a, { roughness: 0.85 }), parent, [0.63, 0.8, -0.1]);
  for (let i = 0; i < 5; i += 1) {
    const leaf = mesh(sphere(0.055, 8, 6), material(0x5e7f4f, { roughness: 0.85 }), pot,
      [Math.sin(i * 1.3) * 0.045, 0.08 + (i % 2) * 0.045, Math.cos(i * 1.3) * 0.045], { cast: false });
    leaf.scale.set(1, 0.65, 1.25);
  }
}

function buildWorkstation(agent, layout, mobile) {
  const station = new THREE.Group();
  station.position.set(layout.position.x, 0, layout.position.z);
  station.rotation.y = layout.angle;
  station.userData.agentId = agent.id;
  world.add(station);

  const topWood = material(0xc9a981, { roughness: 0.62 });
  const frameMetal = material(0x5a6168, { roughness: 0.5, metalness: 0.4 });

  const desk = mesh(box(1.62, 0.055, 0.78), topWood, station, [0, 0.72, 0.26]);
  desk.userData.agentId = agent.id;
  mesh(box(1.5, 0.3, 0.035), material(0xb59a76, { roughness: 0.75 }), station, [0, 0.54, 0.6], { cast: false });
  for (const side of [-1, 1]) {
    mesh(box(0.07, 0.69, 0.06), frameMetal, station, [side * 0.73, 0.35, 0.02]);
    mesh(box(0.07, 0.69, 0.06), frameMetal, station, [side * 0.73, 0.35, 0.52]);
    mesh(box(0.07, 0.05, 0.56), frameMetal, station, [side * 0.73, 0.03, 0.27], { cast: false });
    mesh(box(0.05, 0.05, 0.5), frameMetal, station, [side * 0.73, 0.66, 0.27], { cast: false });
  }

  const primary = buildMonitor(station, [0, 0.747, 0.42], Math.PI, agent.screen);
  let secondary = null;
  if (!mobile) {
    secondary = buildMonitor(station, [0.66, 0.747, 0.4], Math.PI - 0.5, 'terminal', 0.86);
  }
  buildDeskProps(station, agent, mobile);

  if (!mobile) {
    const pedestal = mesh(box(0.38, 0.52, 0.46), material(0x6d7670, { roughness: 0.68 }), station, [0.52, 0.26, 0.34]);
    for (let drawer = 0; drawer < 3; drawer += 1) {
      mesh(box(0.34, 0.015, 0.02), material(0x515a56, { roughness: 0.6 }), pedestal,
        [0, 0.17 - drawer * 0.17, -0.232], { cast: false });
      mesh(box(0.12, 0.022, 0.02), material(0xb9c0b9, { roughness: 0.4, metalness: 0.4 }), pedestal,
        [0, 0.1 - drawer * 0.17, -0.235], { cast: false });
    }
    const bag = mesh(box(0.3, 0.36, 0.2), material(0x4a4f57, { roughness: 0.9 }), station, [-0.86, 0.18, 0.24], { rotation: [0, 0.3, 0] });
    mesh(box(0.22, 0.05, 0.03), material(0x393d44, { roughness: 0.9 }), bag, [0, 0.2, 0.02], { cast: false });
  }

  const pool = mesh(torus(0.86, 0.028, 6, 36), new THREE.MeshStandardMaterial({
    color: agent.accent, emissive: agent.accent, emissiveIntensity: 0.25, roughness: 0.6, transparent: true, opacity: 0.4,
  }), station, [0, 0.012, -0.12], { rotation: [Math.PI / 2, 0, 0], cast: false });

  const chair = buildOfficeChair(station, [0, -0.42], Math.PI);
  chair.userData.agentId = agent.id;

  return { station, chair, pool, primary, secondary };
}

/* ---------- break + utility zones ---------- */

function buildRug(parent, x, z, width, depth, color) {
  mesh(plane(width, depth), material(color, { roughness: 0.95 }), parent, [x, 0.006, z],
    { rotation: [-Math.PI / 2, 0, 0], cast: false });
}

function buildCouch(parent, x, z, angle) {
  const couch = new THREE.Group();
  couch.position.set(x, 0, z);
  couch.rotation.y = angle;
  parent.add(couch);
  const fabric = material(0x9a8f7f, { roughness: 0.96 });
  const cushion = material(0xa89b89, { roughness: 0.96 });
  const legs = material(0x5f4a35, { roughness: 0.8 });
  mesh(box(1.96, 0.2, 0.94), fabric, couch, [0, 0.3, 0]);
  mesh(box(1.96, 0.4, 0.22), fabric, couch, [0, 0.54, -0.37], { rotation: [-0.14, 0, 0] });
  for (const side of [-1, 1]) {
    mesh(box(0.18, 0.22, 0.94), fabric, couch, [side * 0.89, 0.51, 0], { cast: false });
    mesh(box(0.1, 0.2, 0.1), legs, couch, [side * 0.8, 0.1, 0.34], { cast: false });
    mesh(box(0.1, 0.2, 0.1), legs, couch, [side * 0.8, 0.1, -0.34], { cast: false });
  }
  for (const offset of [-0.47, 0.47]) {
    mesh(box(0.84, 0.14, 0.78), cushion, couch, [offset, 0.47, 0.04], { cast: false });
    mesh(box(0.74, 0.3, 0.12), cushion, couch, [offset, 0.66, -0.33], { rotation: [-0.16, 0, 0], cast: false });
  }
  return couch;
}

function buildArmchair(parent, x, z, angle) {
  const chair = new THREE.Group();
  chair.position.set(x, 0, z);
  chair.rotation.y = angle;
  parent.add(chair);
  const fabric = material(0x9a8f7f, { roughness: 0.96 });
  mesh(box(0.82, 0.2, 0.8), fabric, chair, [0, 0.3, 0]);
  mesh(box(0.82, 0.42, 0.2), fabric, chair, [0, 0.52, -0.32], { rotation: [-0.14, 0, 0] });
  mesh(box(0.7, 0.13, 0.66), material(0xa89b89, { roughness: 0.96 }), chair, [0, 0.46, 0.04], { cast: false });
  for (const side of [-1, 1]) {
    mesh(box(0.16, 0.2, 0.8), fabric, chair, [side * 0.33, 0.5, 0], { cast: false });
    mesh(box(0.08, 0.2, 0.08), material(0x5f4a35, { roughness: 0.8 }), chair, [side * 0.28, 0.1, 0.26], { cast: false });
  }
  return chair;
}

function buildCoffeeTable(parent, x, z) {
  const table = new THREE.Group();
  table.position.set(x, 0, z);
  parent.add(table);
  mesh(box(1.0, 0.06, 0.6), material(0xb58d63, { roughness: 0.6 }), table, [0, 0.42, 0]);
  for (const sx of [-0.42, 0.42]) {
    for (const sz of [-0.22, 0.22]) {
      mesh(box(0.06, 0.42, 0.06), material(0x6b5540, { roughness: 0.7 }), table, [sx, 0.21, sz], { cast: false });
    }
  }
  mesh(box(0.3, 0.02, 0.22), material(0xeae4d6, { roughness: 0.9 }), table, [0.18, 0.46, 0.04], { rotation: [0, 0.3, 0], cast: false });
  const cup = mesh(cylinder(0.04, 0.035, 0.08, 10), material(0xf0ebe0, { roughness: 0.5 }), table, [-0.28, 0.49, -0.06]);
  mesh(torus(0.024, 0.009, 5, 10), material(0xf0ebe0, { roughness: 0.5 }), cup, [0.05, 0, 0], { cast: false });
  return table;
}

function buildPlant(parent, x, z, scale = 1) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  parent.add(group);
  mesh(cylinder(0.21, 0.17, 0.36, 12), material(0xa9734f, { roughness: 0.85 }), group, [0, 0.18, 0]);
  mesh(cylinder(0.2, 0.2, 0.05, 12), material(0x4f3f30, { roughness: 0.95 }), group, [0, 0.37, 0], { cast: false });
  for (let i = 0; i < 9; i += 1) {
    const angle = i * 1.4;
    const height = 0.46 + (i % 3) * 0.2;
    const leaf = mesh(sphere(0.15, 8, 6), material(i % 2 ? 0x55774a : 0x628a53, { roughness: 0.88 }), group,
      [Math.sin(angle) * 0.17, height, Math.cos(angle) * 0.17], { cast: false });
    leaf.scale.set(0.8, 1.5, 0.5);
    leaf.rotation.set(0.3, angle, Math.sin(angle) * 0.35);
  }
  return group;
}

function buildWaterCooler(parent, x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  parent.add(group);
  mesh(box(0.38, 0.95, 0.36), material(0xe4e6e1, { roughness: 0.6 }), group, [0, 0.48, 0]);
  mesh(cylinder(0.15, 0.17, 0.42, 14), new THREE.MeshStandardMaterial({
    color: 0x9fd4e4, roughness: 0.25, transparent: true, opacity: 0.7,
  }), group, [0, 1.15, 0]);
  mesh(box(0.1, 0.06, 0.08), material(0x4b5156, { roughness: 0.5 }), group, [0, 0.62, 0.21], { cast: false });
  return group;
}

function buildKitchenette(parent, x, z, angle) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = angle;
  parent.add(group);
  mesh(box(2.4, 0.86, 0.66), material(0xdfdbd0, { roughness: 0.75 }), group, [0, 0.43, 0]);
  mesh(box(2.46, 0.07, 0.72), material(0x55504a, { roughness: 0.45, metalness: 0.2 }), group, [0, 0.89, 0]);
  for (const door of [-0.6, 0.6]) {
    mesh(box(0.02, 0.06, 0.3), material(0x8d8578, { roughness: 0.5, metalness: 0.3 }), group, [door, 0.5, 0.34], { cast: false });
  }
  const machine = mesh(box(0.34, 0.42, 0.3), material(0x33383c, { roughness: 0.5 }), group, [-0.7, 1.13, 0]);
  mesh(box(0.26, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0x7fd4b4 }), machine, [0, 0.1, 0.16], { cast: false, receive: false });
  mesh(cylinder(0.07, 0.07, 0.2, 10), material(0xe6e2d8, { roughness: 0.6 }), group, [0.1, 0.99, 0.02]);
  mesh(box(0.3, 0.26, 0.24), material(0xbdc4bb, { roughness: 0.6 }), group, [0.75, 1.02, 0]);
  return group;
}

const serverSignTexture = drawTexture(256, (ctx, size) => {
  ctx.fillStyle = '#20282e';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#7fd4b4';
  ctx.fillRect(16, 96, 224, 4);
  ctx.fillStyle = '#e8eeea';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MODEL', size / 2, 84);
  ctx.fillText('RUNTIME', size / 2, 146);
});

function buildServerRack(parent, x, z, angle, leds) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = angle;
  parent.add(group);
  mesh(box(0.72, 1.7, 0.66), material(0x33383d, { roughness: 0.6, metalness: 0.2 }), group, [0, 0.85, 0]);
  for (let i = 0; i < 7; i += 1) {
    mesh(box(0.62, 0.14, 0.02), material(0x1f2428, { roughness: 0.7 }), group, [0, 0.3 + i * 0.2, 0.34], { cast: false });
    const led = mesh(
      box(0.05, 0.03, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x7fd4b4 }),
      group,
      [0.22, 0.3 + i * 0.2, 0.36],
      { cast: false, receive: false },
    );
    leds.push(led);
  }
  return group;
}

// The local model is the one piece of infrastructure the agents depend on, so
// it gets a room rather than a desk: a glazed bay the Application Writer sends
// work to, lit by whatever the status feed reports.
function buildServerRoom(parent, x, z, angle) {
  const room = new THREE.Group();
  room.position.set(x, 0, z);
  room.rotation.y = angle;
  parent.add(room);

  const leds = [];
  mesh(plane(3.6, 2.8), material(0x97a3a4, { roughness: 0.84 }), room, [0, 0.008, 0],
    { rotation: [-Math.PI / 2, 0, 0], cast: false });
  for (let i = -3; i <= 3; i += 1) {
    mesh(box(0.02, 0.004, 2.8), material(0x7f8b8d, { roughness: 0.8 }), room, [i * 0.5, 0.012, 0], { cast: false });
  }

  const frame = material(0x9aa5a2, { roughness: 0.4, metalness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xcfe4ea, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.22,
  });
  // Two sides only, so the bay stays readable from the camera.
  for (const [px, pz, rot, width] of [[0, 1.4, 0, 3.6], [-1.8, 0, Math.PI / 2, 2.8]]) {
    const pane = mesh(plane(width, 2.0), glass, room, [px, 1.0, pz], { rotation: [0, rot, 0], cast: false, receive: false });
    pane.renderOrder = 2;
    mesh(box(width, 0.06, 0.06), frame, room, [px, 2.0, pz], { rotation: [0, rot, 0], cast: false });
    mesh(box(0.06, 2.0, 0.06), frame, room, [
      px + Math.cos(rot) * (width / 2), 1.0, pz - Math.sin(rot) * (width / 2),
    ], { cast: false });
  }

  buildServerRack(room, -0.95, -0.35, 0, leds);
  buildServerRack(room, -0.05, -0.35, 0, leds);
  buildServerRack(room, 0.85, -0.35, 0, leds);

  const sign = mesh(plane(0.72, 0.72), new THREE.MeshBasicMaterial({ map: serverSignTexture }), room,
    [1.55, 1.25, 0.5], { rotation: [0, -0.55, 0], cast: false, receive: false });
  sign.renderOrder = 3;

  mesh(box(0.46, 0.42, 0.38), material(0x4a5257, { roughness: 0.6 }), room, [1.3, 0.21, -0.4]);

  return { group: room, leds, anchor: new THREE.Vector3(x, 0.5, z) };
}

function buildPrinter(parent, x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  parent.add(group);
  mesh(box(0.8, 0.52, 0.62), material(0x9ca29c, { roughness: 0.7 }), group, [0, 0.52, 0]);
  mesh(box(0.8, 0.5, 0.62), material(0x7e847e, { roughness: 0.75 }), group, [0, 0.25, 0], { cast: false });
  mesh(box(0.5, 0.02, 0.4), material(0xf4f1e6, { roughness: 0.9 }), group, [0, 0.79, 0.06], { cast: false });
  return group;
}

function buildMeetingPod(parent, x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  parent.add(group);
  mesh(cylinder(0.66, 0.66, 0.06, 20), material(0xc3a37d, { roughness: 0.62 }), group, [0, 0.72, 0]);
  mesh(cylinder(0.08, 0.08, 0.68, 10), material(0x5a6168, { roughness: 0.5, metalness: 0.4 }), group, [0, 0.38, 0]);
  mesh(cylinder(0.34, 0.38, 0.05, 16), material(0x4b5259, { roughness: 0.5, metalness: 0.4 }), group, [0, 0.04, 0], { cast: false });
  for (let i = 0; i < 3; i += 1) {
    const angle = (Math.PI * 2 * i) / 3 + 0.5;
    buildOfficeChair(group, [Math.sin(angle) * 1.12, Math.cos(angle) * 1.12], angle + Math.PI);
  }
  return group;
}

/* ---------- central status hub ---------- */

const central = new THREE.Group();
world.add(central);
let core;
let gate;

function buildHub() {
  central.clear();
  mesh(cylinder(1.5, 1.56, 0.03, 36), material(0xa89a86, { roughness: 0.95 }), central, [0, 0.008, 0], { cast: false });
  mesh(cylinder(0.98, 0.98, 0.07, 28), material(0xc9a981, { roughness: 0.6 }), central, [0, 1.01, 0]);
  mesh(cylinder(0.11, 0.11, 0.98, 12), material(0x5a6168, { roughness: 0.5, metalness: 0.4 }), central, [0, 0.52, 0]);
  mesh(cylinder(0.44, 0.5, 0.06, 20), material(0x4b5259, { roughness: 0.5, metalness: 0.4 }), central, [0, 0.04, 0], { cast: false });

  core = new THREE.Group();
  core.position.y = 1.52;
  central.add(core);
  const totem = mesh(box(0.66, 0.9, 0.66), material(0x2c3136, { roughness: 0.55, metalness: 0.25 }), core, [0, 0, 0]);
  const kinds = ['chart', 'checklist', 'metrics', 'mail'];
  for (let i = 0; i < 4; i += 1) {
    const angle = (Math.PI / 2) * i;
    mesh(plane(0.56, 0.74), screenMaterial(kinds[i]), totem,
      [Math.sin(angle) * 0.335, 0.02, Math.cos(angle) * 0.335], { rotation: [0, angle, 0], cast: false, receive: false });
  }
  mesh(box(0.74, 0.06, 0.74), material(0x3a4046, { roughness: 0.6 }), core, [0, 0.48, 0], { cast: false });

  // A slim lit rail around the table rim rather than a pendant: anything
  // hung above the hub would occlude the desks behind it at this camera.
  gate = new THREE.Group();
  gate.position.y = 1.06;
  central.add(gate);
  mesh(torus(0.94, 0.016, 5, 40), material(0x6d7780, { roughness: 0.5, metalness: 0.4 }), gate,
    [0, 0, 0], { rotation: [Math.PI / 2, 0, 0], cast: false });
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8;
    mesh(sphere(0.028, 8, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffd79a : 0x9fe0cb }), gate,
      [Math.sin(angle) * 0.94, 0, Math.cos(angle) * 0.94], { cast: false, receive: false });
  }
}

/* ---------- character rig ---------- */

function buildHair(parent, agent, hairMat) {
  const style = agent.hairStyle;
  const cap = mesh(sphere(0.133, 14, 10), hairMat, parent, [0, 0.062, -0.006]);
  cap.scale.set(1.02, 1.0, 1.02);
  if (style === 'short' || style === 'curly') {
    cap.scale.set(1.03, 0.96, 1.03);
    cap.position.y = 0.072;
    if (style === 'curly') {
      for (let i = 0; i < 8; i += 1) {
        const angle = i * 0.82;
        mesh(sphere(0.04, 8, 6), hairMat, parent,
          [Math.sin(angle) * 0.108, 0.115 + Math.cos(i * 1.7) * 0.022, Math.cos(angle) * 0.1 - 0.012], { cast: false });
      }
    }
  } else if (style === 'bun') {
    mesh(sphere(0.07, 10, 8), hairMat, parent, [0, 0.13, -0.13]);
  } else if (style === 'ponytail') {
    const tail = mesh(capsule(0.045, 0.2), hairMat, parent, [0, 0.03, -0.17]);
    tail.rotation.x = -0.4;
  } else if (style === 'long') {
    const fall = mesh(capsule(0.1, 0.14), hairMat, parent, [0, -0.04, -0.045]);
    fall.scale.set(1.25, 1, 0.82);
  } else if (style === 'braid') {
    const braid = mesh(capsule(0.04, 0.26), hairMat, parent, [0, -0.06, -0.14]);
    braid.rotation.x = -0.18;
  }
}

function createPerson(agent) {
  const root = new THREE.Group();
  root.userData.agentId = agent.id;
  world.add(root);

  const skin = material(agent.skin, { roughness: 0.82 });
  const shirt = material(agent.shirt, { roughness: 0.88 });
  const trousers = material(agent.trousers, { roughness: 0.9 });
  const hairMat = material(agent.hair, { roughness: 0.94 });
  const shoes = material(0x2c2e33, { roughness: 0.7 });
  const scale = agent.build;

  const body = new THREE.Group();
  body.scale.setScalar(scale);
  root.add(body);

  const hips = new THREE.Group();
  hips.position.y = 0.91;
  body.add(hips);

  const torso = new THREE.Group();
  hips.add(torso);
  const pelvis = mesh(capsule(0.115, 0.07), trousers, torso, [0, 0.0, 0], { scale: [1.3, 1, 0.86] });
  pelvis.userData.agentId = agent.id;
  const chest = mesh(capsule(0.148, 0.2), shirt, torso, [0, 0.25, 0], { scale: [1.3, 1, 0.8] });
  chest.userData.agentId = agent.id;
  mesh(box(0.1, 0.24, 0.02), material(agent.shirt, { roughness: 0.7 }), torso, [0, 0.26, 0.122], { cast: false });
  const collar = mesh(torus(0.072, 0.022, 6, 16), shirt, torso, [0, 0.43, 0.01], { rotation: [Math.PI / 2, 0, 0], cast: false });
  collar.scale.set(1.3, 1, 0.9);

  if (agent.wears.includes('blazer') || agent.wears.includes('cardigan')) {
    const outer = material(agent.wears.includes('blazer') ? 0x343a44 : 0x8d7f6d, { roughness: 0.92 });
    for (const side of [-1, 1]) {
      const panel = mesh(capsule(0.072, 0.2), outer, torso, [side * 0.145, 0.25, 0.0], { scale: [0.9, 1, 1.1] });
      panel.rotation.z = side * 0.04;
    }
    mesh(capsule(0.12, 0.2), outer, torso, [0, 0.25, -0.05], { scale: [1.35, 1, 0.5] });
  }

  if (agent.wears.includes('lanyard')) {
    const strap = material(0x2f3a42, { roughness: 0.9 });
    for (const side of [-1, 1]) {
      const band = mesh(box(0.022, 0.26, 0.012), strap, torso, [side * 0.075, 0.3, 0.115], { cast: false });
      band.rotation.z = side * 0.18;
    }
    mesh(box(0.075, 0.1, 0.008), material(0xf2efe4, { roughness: 0.7 }), torso, [0, 0.16, 0.122], { cast: false });
    mesh(box(0.055, 0.022, 0.004), material(agent.accent, { roughness: 0.6 }), torso, [0, 0.185, 0.127], { cast: false });
  }

  mesh(cylinder(0.047, 0.055, 0.14, 10), skin, torso, [0, 0.53, -0.004], { cast: false });

  const head = new THREE.Group();
  head.position.y = 0.66;
  torso.add(head);
  const skull = mesh(sphere(0.128, 16, 12), skin, head, [0, 0.055, 0.004], { scale: [1, 1.08, 0.96] });
  skull.userData.agentId = agent.id;
  mesh(sphere(0.052, 8, 6), skin, head, [0, -0.025, 0.02], { scale: [1, 0.85, 1], cast: false });
  for (const side of [-1, 1]) {
    mesh(sphere(0.028, 8, 6), skin, head, [side * 0.122, 0.045, 0.0], { scale: [0.6, 1, 0.9], cast: false });
    mesh(sphere(0.018, 8, 6), material(0x241d1c, { roughness: 0.3 }), head, [side * 0.049, 0.055, 0.112], { cast: false, receive: false });
    mesh(box(0.042, 0.009, 0.01), hairMat, head, [side * 0.05, 0.088, 0.112], { cast: false });
  }
  buildHair(head, agent, hairMat);
  if (agent.wears.includes('glasses')) {
    const rim = material(0x33383c, { roughness: 0.4, metalness: 0.3 });
    for (const side of [-1, 1]) {
      mesh(torus(0.036, 0.007, 5, 14), rim, head, [side * 0.05, 0.053, 0.117], { cast: false });
      mesh(box(0.012, 0.006, 0.09), rim, head, [side * 0.105, 0.058, 0.072], { cast: false });
    }
    mesh(box(0.03, 0.006, 0.006), rim, head, [0, 0.053, 0.12], { cast: false });
  }
  if (agent.wears.includes('headphones')) {
    const band = material(0x2f3439, { roughness: 0.6 });
    mesh(torus(0.14, 0.014, 6, 18, Math.PI), band, head, [0, 0.07, 0], { rotation: [0, 0, 0], cast: false });
    for (const side of [-1, 1]) {
      mesh(cylinder(0.045, 0.045, 0.03, 12), band, head, [side * 0.135, 0.045, 0], { rotation: [0, 0, Math.PI / 2], cast: false });
    }
  }

  const arms = {};
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right';
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.195, 0.42, 0);
    torso.add(shoulder);
    mesh(sphere(0.066, 10, 8), shirt, shoulder, [0, 0.0, 0], { cast: false });
    mesh(capsule(0.062, 0.19), shirt, shoulder, [0, -0.152, 0]);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    mesh(capsule(0.054, 0.17), skin, elbow, [0, -0.135, 0]);
    const hand = new THREE.Group();
    hand.position.y = -0.27;
    elbow.add(hand);
    mesh(sphere(0.058, 10, 8), skin, hand, [0, -0.025, 0], { scale: [0.88, 1.08, 0.76] });
    const mug = mesh(cylinder(0.042, 0.037, 0.08, 10), material(0xf0ebe0, { roughness: 0.5 }), hand, [0, -0.08, 0.03], { cast: false });
    mug.visible = false;
    arms[key] = { shoulder, elbow, hand, mug };
  }

  const legs = {};
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right';
    const hip = new THREE.Group();
    hip.position.set(side * 0.092, 0, 0);
    hips.add(hip);
    const thigh = mesh(capsule(0.089, 0.25), trousers, hip, [0, -0.21, 0]);
    thigh.userData.agentId = agent.id;
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    mesh(capsule(0.07, 0.27), trousers, knee, [0, -0.2, 0]);
    const foot = new THREE.Group();
    foot.position.y = -0.4;
    knee.add(foot);
    mesh(box(0.12, 0.08, 0.25), shoes, foot, [0, -0.032, 0.05]);
    legs[key] = { hip, knee, foot };
  }

  return { root, body, hips, torso, head, arms, legs };
}

/* ---------- poses ---------- */

const POSE = {
  sitWork: {
    hipsY: 0.57, torso: 0.08, head: 0.2,
    thigh: -1.37, knee: 1.33, foot: 0.04,
    shoulder: -0.56, elbow: -1.27,
  },
  sitRest: {
    hipsY: 0.52, torso: -0.07, head: -0.02,
    thigh: -1.3, knee: 1.12, foot: 0.1,
    shoulder: -0.3, elbow: -0.95,
  },
  stand: {
    hipsY: 0.91, torso: 0.0, head: 0.0,
    thigh: 0.0, knee: 0.02, foot: 0.0,
    shoulder: -0.06, elbow: -0.22,
  },
};

function approach(current, target, delta, speed = 9) {
  return current + (target - current) * Math.min(1, delta * speed);
}

function applyPose(rig, pose, delta) {
  const step = Math.min(1, delta * 9);
  const lerp = (object, axis, value) => {
    object[axis] += (value - object[axis]) * step;
  };
  rig.hips.position.y += (pose.hipsY - rig.hips.position.y) * step;
  lerp(rig.torso.rotation, 'x', pose.torso);
  lerp(rig.head.rotation, 'x', pose.head);
  lerp(rig.head.rotation, 'y', pose.headTurn || 0);
  for (const key of ['left', 'right']) {
    const leg = rig.legs[key];
    const swing = key === 'left' ? (pose.thighL ?? pose.thigh) : (pose.thighR ?? pose.thigh);
    const bend = key === 'left' ? (pose.kneeL ?? pose.knee) : (pose.kneeR ?? pose.knee);
    lerp(leg.hip.rotation, 'x', swing);
    lerp(leg.knee.rotation, 'x', bend);
    lerp(leg.foot.rotation, 'x', pose.foot);
    const arm = rig.arms[key];
    lerp(arm.shoulder.rotation, 'x', key === 'left' ? (pose.shoulderL ?? pose.shoulder) : (pose.shoulderR ?? pose.shoulder));
    lerp(arm.shoulder.rotation, 'z', key === 'left' ? -0.06 : 0.06);
    lerp(arm.elbow.rotation, 'x', key === 'left' ? (pose.elbowL ?? pose.elbow) : (pose.elbowR ?? pose.elbow));
  }
}

function deskPose(status, time, index) {
  const base = status === 'running' ? POSE.sitWork : POSE.sitRest;
  if (status !== 'running') {
    return { ...base, headTurn: Math.sin(time * 0.33 + index) * 0.22, elbow: -1.0, shoulder: -0.42 };
  }
  const typing = Math.sin(time * 9 + index * 1.7) * 0.05;
  return {
    ...base,
    headTurn: Math.sin(time * 0.6 + index) * 0.07,
    elbowL: base.elbow + typing,
    elbowR: base.elbow - typing,
    torso: base.torso + Math.sin(time * 2.2 + index) * 0.012,
  };
}

function walkPose(stride) {
  const swing = Math.sin(stride);
  const lift = Math.max(0, Math.sin(stride));
  return {
    ...POSE.stand,
    torso: 0.05,
    thighL: swing * 0.5,
    thighR: -swing * 0.5,
    kneeL: Math.max(0.04, lift * 0.75),
    kneeR: Math.max(0.04, Math.max(0, -Math.sin(stride)) * 0.75),
    shoulderL: -swing * 0.36,
    shoulderR: swing * 0.36,
    elbow: -0.38,
  };
}

function loungePose(seat, time, index) {
  if (seat && seat.sit) {
    return {
      ...POSE.sitRest,
      headTurn: Math.sin(time * 0.4 + index) * 0.3,
      shoulderR: -0.52, elbowR: -1.55,
      shoulderL: -0.26, elbowL: -0.85,
    };
  }
  return {
    ...POSE.stand,
    hipsY: POSE.stand.hipsY + Math.sin(time * 0.9 + index) * 0.008,
    headTurn: Math.sin(time * 0.45 + index * 1.3) * 0.35,
    shoulderR: -0.4, elbowR: -1.75,
    shoulderL: -0.1, elbowL: -0.3,
  };
}

/* ---------- layout ---------- */

function getPositions(mobile) {
  if (mobile) {
    return AGENTS.map((agent, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      return {
        position: { x: col === 0 ? -1.95 : 1.95, z: -3.1 + row * 2.2 },
        angle: col === 0 ? 1.1 : -1.1,
      };
    });
  }
  return AGENTS.map((agent, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / AGENTS.length;
    return {
      position: { x: Math.cos(angle) * 5.1, z: Math.sin(angle) * 4.2 },
      angle: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
    };
  });
}

function getBreakSeats(mobile) {
  if (mobile) {
    return [
      { x: -0.75, z: 4.8, facing: Math.PI, sit: true },
      { x: 0.75, z: 4.8, facing: Math.PI, sit: true },
      { x: 2.3, z: 3.9, facing: -2.2, sit: false },
      { x: -1.5, z: -6.0, facing: 0.4, sit: false },
      { x: 1.4, z: -6.0, facing: -0.4, sit: false },
    ];
  }
  return [
    { x: -8.0, z: 0.9, facing: Math.PI / 2, sit: true },
    { x: -8.0, z: 2.1, facing: Math.PI / 2, sit: true },
    { x: -6.7, z: 3.1, facing: -2.75, sit: true },
    { x: -6.7, z: -0.1, facing: -0.4, sit: true },
    { x: 7.0, z: 2.4, facing: 1.05, sit: false },
    { x: 7.3, z: 1.0, facing: 1.3, sit: false },
    { x: 7.6, z: -3.2, facing: 3.64, sit: true },
    { x: 5.9, z: -4.2, facing: 1.55, sit: true },
  ];
}

function buildProps(mobile) {
  propRoot.clear();
  if (mobile) {
    buildRug(propRoot, 0, 4.6, 3.8, 2.8, 0x9c8e7e);
    buildCouch(propRoot, 0, 5.2, Math.PI);
    buildCoffeeTable(propRoot, 0, 3.9);
    buildPlant(propRoot, -3.3, 4.4, 0.9);
    buildKitchenette(propRoot, 0, -6.6, 0);
    buildWaterCooler(propRoot, 3.2, -6.2);
    buildPlant(propRoot, -3.3, -6.2, 0.95);
    serverRoom = buildServerRoom(propRoot, 2.1, -4.3, -Math.PI / 2);
    serverRoom.group.scale.setScalar(0.72);
    return;
  }

  buildRug(propRoot, -7.4, 1.5, 4.2, 4.2, 0x9c8e7e);
  buildCouch(propRoot, -8.3, 1.5, Math.PI / 2);
  buildArmchair(propRoot, -6.7, 3.1, Math.PI + 0.4);
  buildArmchair(propRoot, -6.7, -0.1, -0.4);
  buildCoffeeTable(propRoot, -7.4, 1.5);
  buildPlant(propRoot, -8.6, 4.4, 1.15);
  buildPlant(propRoot, -8.9, -2.0);

  buildKitchenette(propRoot, 8.2, 3.0, -Math.PI / 2);
  buildWaterCooler(propRoot, 8.4, 0.5);
  buildPlant(propRoot, 8.6, 5.4, 1.05);

  serverRoom = buildServerRoom(propRoot, 7.1, -3.9, 0);
  buildRug(propRoot, -7.6, -4.5, 4.0, 3.6, 0x8d9a93);
  buildMeetingPod(propRoot, -7.6, -4.5);
  buildPrinter(propRoot, -9.4, -1.4);
  buildPlant(propRoot, -5.6, -6.2, 1.2);
}

/* ---------- scene assembly ---------- */

let serverRoom = null;
let modelLink = null;
let modelRuntime = { status: 'unknown', model: '' };
let mobileLayout = window.matchMedia('(max-width: 680px)').matches;
let stationLayouts = getPositions(mobileLayout);
const stationGroups = new Map();
const personRigs = new Map();
const agentMotion = new Map();
const statusBits = [];
const stationLinks = [];
const packetMeshes = [];
const linkMaterial = new THREE.LineBasicMaterial({ color: 0x6f8d80, transparent: true, opacity: 0.45 });
let stationNodes = [];

function buildStations() {
  for (const [id, group] of stationGroups) {
    world.remove(group);
    stationGroups.delete(id);
  }
  statusBits.length = 0;
  stationNodes = AGENTS.map((agent, index) => {
    const built = buildWorkstation(agent, stationLayouts[index], mobileLayout);
    stationGroups.set(agent.id, built.station);
    statusBits.push({
      id: agent.id,
      pool: built.pool,
      chair: built.chair,
      screens: [built.primary.screen, built.secondary && built.secondary.screen].filter(Boolean),
    });
    return built.station;
  });
}

function homeFor(index) {
  const layout = stationLayouts[index];
  return new THREE.Vector3(
    layout.position.x - Math.sin(layout.angle) * 0.42,
    0,
    layout.position.z - Math.cos(layout.angle) * 0.42,
  );
}

buildRoom(mobileLayout);
buildHub();
buildProps(mobileLayout);
buildStations();

AGENTS.forEach((agent, index) => {
  const rig = createPerson(agent);
  personRigs.set(agent.id, rig);
  const home = homeFor(index);
  rig.root.position.copy(home);
  rig.root.rotation.y = stationLayouts[index].angle;
  agentMotion.set(agent.id, {
    home,
    homeAngle: stationLayouts[index].angle,
    target: home.clone(),
    phase: 'home',
    pauseRemaining: 0.6 + (index % 4) * 0.7,
    seat: null,
    seatIndex: -1,
    stride: index * 1.1,
  });
});

const takenSeats = new Set();

function createLinks() {
  for (const child of linkRoot.children) {
    child.geometry?.dispose();
    if (child.material && child.material !== linkMaterial) child.material.dispose?.();
  }
  linkRoot.clear();
  stationLinks.length = 0;
  packetMeshes.length = 0;
  for (const [index, station] of stationNodes.entries()) {
    const p = station.position;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.05, 0),
      new THREE.Vector3(p.x * 0.35, 0.05, p.z * 0.3),
      new THREE.Vector3(p.x * 0.74, 0.05, p.z * 0.78),
      new THREE.Vector3(p.x * 0.96, 0.05, p.z * 0.94),
    ]);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(42)), linkMaterial.clone());
    line.material.transparent = true;
    line.material.opacity = 0.3;
    linkRoot.add(line);

    const packet = mesh(sphere(0.062, 8, 6), new THREE.MeshStandardMaterial({
      color: AGENTS[index].accent, emissive: AGENTS[index].accent, emissiveIntensity: 0.75, roughness: 0.4,
    }), linkRoot, [0, 0.12, 0], { cast: false, receive: false });
    packetMeshes.push({ packet, curve, agentId: AGENTS[index].id, phase: index / AGENTS.length });
    stationLinks.push({ line, agentId: AGENTS[index].id });
  }

  if (serverRoom) {
    const writerIndex = AGENTS.findIndex((agent) => agent.id === 'application-writer');
    const writer = stationNodes[writerIndex];
    const target = serverRoom.group.position;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(writer.position.x, 0.05, writer.position.z),
      new THREE.Vector3((writer.position.x + target.x) / 2, 0.05, (writer.position.z + target.z) / 2 - 0.6),
      new THREE.Vector3(target.x, 0.05, target.z + 1.6),
    ]);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(36)), linkMaterial.clone());
    line.material.transparent = true;
    line.material.opacity = 0.3;
    linkRoot.add(line);
    const packet = mesh(sphere(0.062, 8, 6), new THREE.MeshStandardMaterial({
      color: 0x7fd4b4, emissive: 0x7fd4b4, emissiveIntensity: 0.8, roughness: 0.4,
    }), linkRoot, [0, 0.12, 0], { cast: false, receive: false });
    modelLink = { line, packet, curve };
  }
}
createLinks();

/* ---------- selection + status ---------- */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedId = 'role-scout';
let pointerDown = null;
let sceneTime = 0;
let frameHandle = 0;
let workflowMode = 'unknown';

const cards = [...document.querySelectorAll('.agent-figure[data-agent]')];
const selectedName = document.getElementById('agentNetworkName');
const selectedRole = document.getElementById('agentNetworkRole');
const selectedStatus = document.getElementById('agentNetworkAgentStatus');
const iconByAgent = {
  'role-scout': 'fa-binoculars',
  'fit-analyst': 'fa-chart-simple',
  'resume-tailor': 'fa-file-lines',
  'application-writer': 'fa-pen-to-square',
  'application-reviewer': 'fa-clipboard-check',
  'application-coordinator': 'fa-user-check',
  'feedback-analyst': 'fa-arrows-rotate',
};
const statusById = new Map(AGENTS.map((agent) => [agent.id, 'unknown']));

function currentStatusLabel(id) {
  const status = statusById.get(id);
  return ({
    unknown: 'Status unavailable',
    planned: 'Planned role',
    idle: 'Ready for run',
    running: 'Working now',
    completed: 'Stage complete',
    failed: 'Needs attention',
  })[status] || 'Status unavailable';
}

function selectAgent(id) {
  const agent = AGENTS.find((entry) => entry.id === id);
  if (!agent) return;
  selectedId = id;
  selectedName.textContent = agent.name;
  selectedRole.textContent = agent.role;
  selectedStatus.textContent = currentStatusLabel(id);
  const icon = document.querySelector('.agent-network__selection-mark i');
  icon.className = `fa-solid ${iconByAgent[id]}`;
  cards.forEach((card) => {
    const selected = card.dataset.agent === id;
    card.classList.toggle('is-selected', selected);
    card.setAttribute('aria-pressed', String(selected));
  });
  window.dispatchEvent(new CustomEvent('agent-world-selected', { detail: { id } }));
  renderFrame(0);
}

window.addEventListener('agent-world-select-request', (event) => selectAgent(event.detail?.id));
const initiallySelected = cards.find((card) => card.getAttribute('aria-pressed') === 'true');
if (initiallySelected) selectedId = initiallySelected.dataset.agent;

window.addEventListener('agent-status-update', (event) => {
  const states = event.detail?.agents;
  if (!Array.isArray(states)) return;
  if (event.detail?.unavailable) {
    AGENTS.forEach((agent) => statusById.set(agent.id, 'unknown'));
    workflowMode = event.detail?.ambient === 'break' ? 'idle' : 'unknown';
  } else {
    const hasRunningAgent = states.some((state) => state.status === 'running');
    workflowMode = event.detail?.run_status === 'running' || hasRunningAgent
      ? 'active'
      : event.detail?.run_status === 'idle' || event.detail?.run_status === 'completed'
        ? 'idle'
        : 'unknown';
  }
  for (const state of states) {
    if (statusById.has(state.id)) statusById.set(state.id, state.status);
  }
  const runtime = event.detail?.runtime;
  modelRuntime = event.detail?.unavailable || !runtime
    ? { status: 'unknown', model: '' }
    : { status: runtime.status || 'unknown', model: runtime.model || '' };
  if (reducedMotion.matches && workflowMode === 'active') {
    agentMotion.forEach((motion, id) => {
      const rig = personRigs.get(id);
      if (rig) rig.root.position.copy(motion.home);
      motion.phase = 'home';
      motion.target.copy(motion.home);
      releaseSeat(motion);
    });
  }
  selectedStatus.textContent = currentStatusLabel(selectedId);
  renderFrame(0);
});

/* ---------- motion ---------- */

function releaseSeat(motion) {
  if (motion.seatIndex >= 0) takenSeats.delete(motion.seatIndex);
  motion.seatIndex = -1;
  motion.seat = null;
}

function chooseBreakTarget(motion, index) {
  const seats = getBreakSeats(mobileLayout);
  releaseSeat(motion);
  const free = seats.map((seat, seatIndex) => seatIndex).filter((seatIndex) => !takenSeats.has(seatIndex));
  if (!free.length) return;
  const seatIndex = free[(index + Math.floor(sceneTime)) % free.length];
  takenSeats.add(seatIndex);
  motion.seatIndex = seatIndex;
  motion.seat = seats[seatIndex];
  motion.target.set(motion.seat.x, 0, motion.seat.z);
  motion.phase = 'walking-to-break';
}

function updateAgentMotion(delta) {
  for (const [index, agentData] of AGENTS.entries()) {
    const rig = personRigs.get(agentData.id);
    const motion = agentMotion.get(agentData.id);
    const agentStatus = statusById.get(agentData.id);
    const shouldReturn = workflowMode === 'active';
    const walkSpeed = shouldReturn ? 2.6 : 1.3;

    if (shouldReturn) {
      if (motion.phase === 'at-break' || motion.phase === 'walking-to-break') releaseSeat(motion);
      motion.target.copy(motion.home);
      motion.phase = rig.root.position.distanceTo(motion.home) > 0.05 ? 'returning' : 'home';
    } else if (workflowMode === 'idle' && !reducedMotion.matches) {
      if (motion.phase === 'home' || motion.phase === 'at-break') {
        motion.pauseRemaining -= delta;
        if (motion.pauseRemaining <= 0) {
          if (motion.phase === 'at-break' && Math.random() < 0.35) {
            releaseSeat(motion);
            motion.target.copy(motion.home);
            motion.phase = 'returning';
            motion.pauseRemaining = 6 + index;
          } else {
            chooseBreakTarget(motion, index);
          }
        }
      }
    } else {
      releaseSeat(motion);
      motion.target.copy(motion.home);
      motion.phase = rig.root.position.distanceTo(motion.home) > 0.05 ? 'returning' : 'home';
    }

    if (reducedMotion.matches) {
      if (workflowMode === 'idle') {
        const seats = getBreakSeats(mobileLayout);
        const seat = seats[index % seats.length];
        motion.seat = seat;
        rig.root.position.set(seat.x, 0, seat.z);
        rig.root.rotation.y = seat.facing;
        motion.phase = 'at-break';
      } else {
        rig.root.position.copy(motion.home);
        rig.root.rotation.y = motion.homeAngle;
        motion.phase = 'home';
        motion.seat = null;
      }
      applyPose(rig, motion.phase === 'at-break'
        ? loungePose(motion.seat, 0, index)
        : deskPose(agentStatus === 'running' ? 'running' : 'idle', 0, index), 1);
      rig.arms.right.mug.visible = motion.phase === 'at-break';
      const staticCard = cards.find((item) => item.dataset.agent === agentData.id);
      if (staticCard && staticCard.dataset.motion !== motion.phase) staticCard.dataset.motion = motion.phase;
      continue;
    }

    const offsetX = motion.target.x - rig.root.position.x;
    const offsetZ = motion.target.z - rig.root.position.z;
    const distance = Math.hypot(offsetX, offsetZ);
    let moving = false;
    if (distance > 0.04) {
      const step = Math.min(distance, walkSpeed * delta);
      rig.root.position.x += (offsetX / distance) * step;
      rig.root.position.z += (offsetZ / distance) * step;
      rig.root.rotation.y = approach(rig.root.rotation.y, Math.atan2(offsetX, offsetZ), delta, 7);
      motion.stride += step * 7.5;
      moving = true;
      if (motion.phase === 'home' || motion.phase === 'at-break') {
        motion.phase = shouldReturn ? 'returning' : 'walking-to-break';
      }
    } else if (motion.phase === 'walking-to-break') {
      motion.phase = 'at-break';
      motion.pauseRemaining = 7 + ((index * 7) % 5) * 1.6;
    } else if (motion.phase === 'returning') {
      motion.phase = 'home';
      motion.pauseRemaining = 5 + index * 0.8;
    }

    const seated = motion.phase === 'home' || (motion.phase === 'at-break' && motion.seat?.sit);
    if (!moving) {
      const facing = motion.phase === 'at-break' && motion.seat ? motion.seat.facing : motion.homeAngle;
      rig.root.rotation.y = approach(rig.root.rotation.y, facing, delta, 6);
      if (seated) rig.root.position.lerp(motion.target, Math.min(1, delta * 8));
    }

    let pose;
    if (moving) pose = walkPose(motion.stride);
    else if (motion.phase === 'at-break') pose = loungePose(motion.seat, sceneTime, index);
    else pose = deskPose(agentStatus === 'running' ? 'running' : 'idle', sceneTime, index);
    applyPose(rig, pose, delta);
    rig.arms.right.mug.visible = motion.phase === 'at-break' && !moving;

    rig.body.position.y = moving ? Math.abs(Math.sin(motion.stride)) * 0.022 : 0;

    const card = cards.find((item) => item.dataset.agent === agentData.id);
    if (card && card.dataset.motion !== motion.phase) card.dataset.motion = motion.phase;
  }
}

const MODEL_LIGHT = {
  running: 0x7fd4b4,
  completed: 0x6fae8e,
  idle: 0x55707a,
  failed: 0xd4705f,
  unknown: 0x4e5a61,
};

function updateServerRoom() {
  if (modelLink) {
    const busy = modelRuntime.status === 'running';
    modelLink.line.material.opacity = busy ? 0.72 : 0.18;
    modelLink.line.material.color.setHex(busy ? 0x3d8a74 : 0x8aa093);
    modelLink.packet.visible = busy && !reducedMotion.matches;
    if (modelLink.packet.visible) {
      modelLink.packet.position.copy(modelLink.curve.getPointAt((sceneTime * 0.33) % 1));
      modelLink.packet.position.y += 0.07;
    }
  }
  if (!serverRoom) return;
  const colour = MODEL_LIGHT[modelRuntime.status] || MODEL_LIGHT.unknown;
  const busy = modelRuntime.status === 'running';
  serverRoom.leds.forEach((led, index) => {
    led.material.color.setHex(colour);
    // Only animate while the model is actually generating; otherwise the
    // lights sit steady so the scene does not imply activity that isn't there.
    if (busy && !reducedMotion.matches) {
      const pulse = 0.55 + 0.45 * Math.sin(sceneTime * 5 + index * 0.9);
      led.scale.setScalar(0.85 + pulse * 0.5);
      led.visible = pulse > 0.25;
    } else {
      led.scale.setScalar(1);
      led.visible = modelRuntime.status !== 'unknown';
    }
  });
}

function updateWallVisibility() {
  const angle = world.rotation.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (const wall of wallPanels) {
    const facing = wall.userData.facing;
    // `facing` is the wall's inward normal, so a wall that has swung between
    // the camera and the room points away from +z; hide that one.
    wall.visible = (-facing.x * sin + facing.y * cos) > -0.45;
  }
}

function renderFrame(delta) {
  sceneTime += delta;
  canvas.dataset.workflowMode = workflowMode;
  if (!reducedMotion.matches) {
    core.rotation.y += delta * 0.22;
    gate.rotation.y += delta * 0.1;
    updateAgentMotion(delta);
    for (const item of packetMeshes) {
      const active = statusById.get(item.agentId) === 'running';
      item.packet.visible = active;
      if (active) {
        const t = (sceneTime * 0.26 + item.phase) % 1;
        item.packet.position.copy(item.curve.getPointAt(t));
        item.packet.position.y += 0.07;
      }
    }
  } else {
    updateAgentMotion(delta);
    packetMeshes.forEach(({ packet }) => { packet.visible = false; });
  }

  for (const bit of statusBits) {
    const active = statusById.get(bit.id) === 'running';
    const selected = bit.id === selectedId;
    bit.pool.material.opacity = active ? 0.72 : selected ? 0.5 : 0.22;
    bit.pool.material.emissiveIntensity = active ? 0.85 : selected ? 0.45 : 0.18;
    bit.pool.scale.setScalar(active && !reducedMotion.matches ? 1 + Math.sin(sceneTime * 3.4) * 0.022 : 1);
    const glow = active ? 0.78 : 0.4;
    for (const screen of bit.screens) screen.material.emissiveIntensity = glow;
    const motion = agentMotion.get(bit.id);
    const away = motion.phase === 'at-break' || motion.phase === 'walking-to-break';
    bit.chair.rotation.y = approach(bit.chair.rotation.y, away ? Math.PI - 0.6 : Math.PI, delta || 1, 4);
  }
  for (const { line, agentId } of stationLinks) {
    const state = statusById.get(agentId);
    line.material.opacity = state === 'running' ? 0.72 : agentId === selectedId ? 0.5 : 0.22;
    line.material.color.setHex(state === 'running' ? 0x3d8a74 : state === 'completed' ? 0x74977c : 0x8aa093);
  }
  updateServerRoom();
  updateWallVisibility();
  renderer.render(scene, camera);
}

function startRenderLoop() {
  if (frameHandle) window.cancelAnimationFrame(frameHandle);
  let previousTime = 0;
  const animate = (time) => {
    const delta = Math.min((time - previousTime) / 1000 || 0, 0.05);
    previousTime = time;
    renderFrame(delta);
    if (!reducedMotion.matches) frameHandle = window.requestAnimationFrame(animate);
    else frameHandle = 0;
  };
  frameHandle = window.requestAnimationFrame(animate);
}

function resizeScene() {
  const rect = sceneRoot.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const isMobile = rect.width < 680;
  if (isMobile !== mobileLayout) {
    mobileLayout = isMobile;
    stationLayouts = getPositions(mobileLayout);
    takenSeats.clear();
    buildRoom(mobileLayout);
    buildProps(mobileLayout);
    buildStations();
    createLinks();
    AGENTS.forEach((agent, index) => {
      const motion = agentMotion.get(agent.id);
      const rig = personRigs.get(agent.id);
      motion.home.copy(homeFor(index));
      motion.homeAngle = stationLayouts[index].angle;
      motion.target.copy(motion.home);
      motion.phase = 'home';
      motion.seat = null;
      motion.seatIndex = -1;
      rig.root.position.copy(motion.home);
      rig.root.rotation.y = motion.homeAngle;
    });
  }
  const viewHeight = isMobile ? 12.6 : 8.1;
  const aspect = rect.width / rect.height;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  if (isMobile) {
    camera.position.set(0, 15, 7.8);
    camera.lookAt(0, 0.2, -0.8);
  } else {
    camera.position.set(0, 11.6, 13.3);
    camera.lookAt(0, 0.4, -1.2);
  }
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height, false);
  renderFrame(0);
}

function hitAgent(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(world.children, true);
  for (const hit of hits) {
    let target = hit.object;
    while (target && !target.userData.agentId) target = target.parent;
    if (target?.userData.agentId) {
      selectAgent(target.userData.agentId);
      return;
    }
  }
}

canvas.addEventListener('pointerdown', (event) => {
  pointerDown = { x: event.clientX, y: event.clientY, rotation: world.rotation.y };
  if (!mobileLayout) canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!pointerDown || mobileLayout) return;
  const distance = event.clientX - pointerDown.x;
  if (Math.abs(distance) > 4) world.rotation.y = pointerDown.rotation + distance * 0.004;
});
canvas.addEventListener('pointerup', (event) => {
  if (!pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6;
  pointerDown = null;
  if (!moved) hitAgent(event);
});
canvas.addEventListener('pointercancel', () => { pointerDown = null; });
canvas.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    const index = AGENTS.findIndex((agent) => agent.id === selectedId);
    selectAgent(AGENTS[(index + 1) % AGENTS.length].id);
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    const index = AGENTS.findIndex((agent) => agent.id === selectedId);
    selectAgent(AGENTS[(index - 1 + AGENTS.length) % AGENTS.length].id);
  }
});
canvas.tabIndex = 0;
canvas.setAttribute('role', 'application');
canvas.setAttribute('aria-label', '3D office scene with seven engineer agents at their desks. Use the agent buttons below, or arrow keys when focused, to select an engineer.');

const resizeObserver = new ResizeObserver(resizeScene);
resizeObserver.observe(sceneRoot);
window.addEventListener('resize', resizeScene, { passive: true });
reducedMotion.addEventListener('change', startRenderLoop);

resizeScene();
startRenderLoop();
selectAgent(selectedId);
window.agentWorldReady = true;
