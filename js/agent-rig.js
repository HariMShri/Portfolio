import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

/* The agent engineers and their character rig, shared by the office scene
   (agent-world.js) and the site-wide roaming layer (agent-roam.js). */

export const AGENTS = [
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

/* ---------- shared geometry + material caches ---------- */

const geometryCache = new Map();
const materialCache = new Map();

export function geometry(key, make) {
  let item = geometryCache.get(key);
  if (!item) {
    item = make();
    geometryCache.set(key, item);
  }
  return item;
}

export function box(x, y, z) {
  return geometry(`box:${x},${y},${z}`, () => new THREE.BoxGeometry(x, y, z));
}

export function cylinder(top, bottom, height, segments = 14) {
  return geometry(`cyl:${top},${bottom},${height},${segments}`, () => new THREE.CylinderGeometry(top, bottom, height, segments));
}

export function sphere(radius, widthSegments = 14, heightSegments = 10) {
  return geometry(`sph:${radius},${widthSegments},${heightSegments}`, () => new THREE.SphereGeometry(radius, widthSegments, heightSegments));
}

export function capsule(radius, length, radialSegments = 10) {
  return geometry(`cap:${radius},${length},${radialSegments}`, () => new THREE.CapsuleGeometry(radius, length, 4, radialSegments));
}

export function torus(radius, tube, radialSegments = 8, tubularSegments = 28) {
  return geometry(`tor:${radius},${tube},${radialSegments},${tubularSegments}`, () => new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments));
}

export function plane(width, height) {
  return geometry(`pln:${width},${height}`, () => new THREE.PlaneGeometry(width, height));
}

export function material(color, options = {}) {
  const { roughness = 0.78, metalness = 0, transparent = false, opacity = 1, side = THREE.FrontSide } = options;
  const key = `${color}:${roughness}:${metalness}:${transparent}:${opacity}:${side}`;
  let item = materialCache.get(key);
  if (!item) {
    item = new THREE.MeshStandardMaterial({ color, roughness, metalness, transparent, opacity, side });
    materialCache.set(key, item);
  }
  return item;
}

export function mesh(geo, mat, parent, position = [0, 0, 0], options = {}) {
  const item = new THREE.Mesh(geo, mat);
  item.position.set(...position);
  if (options.rotation) item.rotation.set(...options.rotation);
  if (options.scale) item.scale.set(...options.scale);
  item.castShadow = options.cast !== false;
  item.receiveShadow = options.receive !== false;
  parent.add(item);
  return item;
}

export function buildHair(parent, agent, hairMat) {
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

export function createPerson(agent, parent) {
  const root = new THREE.Group();
  root.userData.agentId = agent.id;
  parent.add(root);

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

export const POSE = {
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

export function approach(current, target, delta, speed = 9) {
  return current + (target - current) * Math.min(1, delta * speed);
}

export function applyPose(rig, pose, delta) {
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
    // Optional sideways raise, used by gestures such as waving or a stretched tape.
    const spread = 0.06 + (key === 'left' ? (pose.spreadL ?? 0) : (pose.spreadR ?? 0));
    lerp(arm.shoulder.rotation, 'z', key === 'left' ? -spread : spread);
    lerp(arm.elbow.rotation, 'x', key === 'left' ? (pose.elbowL ?? pose.elbow) : (pose.elbowR ?? pose.elbow));
  }
}

export function walkPose(stride) {
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
