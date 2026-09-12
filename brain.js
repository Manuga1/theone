/* Scroll-driven WebGL brain: a stylized neural point-cloud brain that
   assembles on load, rotates as the page scrolls, drifts toward the empty
   side of content slides, and breaks apart into anatomical chunks on the
   divider and closing slides. */
import * as THREE from "./vendor/three.module.min.js";

const canvas = document.getElementById("brain-canvas");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (canvas && !reducedMotion) {
  try {
    init();
  } catch (e) {
    canvas.remove(); // no WebGL — page works fine without the background
  }
} else if (canvas) {
  canvas.remove();
}

function init() {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 7;

  const group = new THREE.Group();
  scene.add(group);

  /* ---------- Build the brain point cloud ---------- */
  const teal = new THREE.Color("#0f766e");
  const blue = new THREE.Color("#0369a1");
  const base = [];      // resting positions
  const colors = [];
  const clusterOf = []; // which "part" each point belongs to
  const jitter = [];    // per-point scatter direction

  function wrinkle(x, y, z) {
    return (
      1 +
      0.07 * Math.sin(6 * x + 9 * z) * Math.sin(7 * y + 5 * x) +
      0.05 * Math.sin(11 * z + 4 * y) +
      0.03 * Math.sin(15 * x - 8 * z)
    );
  }

  function pushPoint(px, py, pz, cluster) {
    base.push(px, py, pz);
    clusterOf.push(cluster);
    const c = teal.clone().lerp(blue, THREE.MathUtils.clamp(pz / 2.6 + 0.5, 0, 1));
    colors.push(c.r, c.g, c.b);
    const j = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    jitter.push(j.x, j.y, j.z);
  }

  // Cerebrum: fibonacci-sampled deformed sphere, split into hemispheres
  const N = 1300;
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * GA * 2;
    let x = Math.cos(th) * r;
    let z = Math.sin(th) * r;
    const rad = wrinkle(x, y, z);
    let px = x * rad;
    let py = y * rad * 0.82;
    let pz = z * rad * 1.28;
    px += Math.sign(px) * 0.12;               // longitudinal fissure
    if (py < -0.42) py = -0.42 + (py + 0.42) * 0.35; // flatten underside
    // cluster: hemisphere (L/R) x lobe (front/mid/back) = 6 parts
    const hemi = px < 0 ? 0 : 1;
    const lobe = pz < -0.5 ? 0 : pz < 0.5 ? 1 : 2;
    pushPoint(px, py, pz, hemi * 3 + lobe);
  }

  // Cerebellum: smaller deformed sphere at the back-underside (7th part)
  const N2 = 230;
  for (let i = 0; i < N2; i++) {
    const y = 1 - (2 * (i + 0.5)) / N2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * GA * 2;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    const rad = 1 + 0.09 * Math.sin(14 * x + 10 * y) * Math.sin(12 * z);
    pushPoint(x * rad * 0.5, y * rad * 0.34 - 0.62, z * rad * 0.46 - 1.02, 6);
  }

  const total = base.length / 3;

  // Each part flies apart along the direction of its own centroid
  const clusterDirs = [];
  {
    const sums = Array.from({ length: 7 }, () => new THREE.Vector3());
    const counts = new Array(7).fill(0);
    for (let i = 0; i < total; i++) {
      sums[clusterOf[i]].add(new THREE.Vector3(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]));
      counts[clusterOf[i]]++;
    }
    for (let k = 0; k < 7; k++) clusterDirs.push(sums[k].divideScalar(counts[k] || 1).normalize());
  }

  const positions = new Float32Array(base);
  const pointsGeo = new THREE.BufferGeometry();
  pointsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  pointsGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const points = new THREE.Points(
    pointsGeo,
    new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.85, sizeAttenuation: true })
  );
  group.add(points);

  // Synapse lines between nearby points (same cluster, capped)
  const pairs = [];
  const MAX_PAIRS = 2600;
  outer: for (let i = 0; i < total; i += 1) {
    for (let j = i + 1; j < Math.min(i + 40, total); j++) {
      if (clusterOf[i] !== clusterOf[j]) continue;
      const dx = base[i * 3] - base[j * 3];
      const dy = base[i * 3 + 1] - base[j * 3 + 1];
      const dz = base[i * 3 + 2] - base[j * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < 0.06) {
        pairs.push(i, j);
        if (pairs.length / 2 >= MAX_PAIRS) break outer;
      }
    }
  }
  const linePositions = new Float32Array(pairs.length * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  const lines = new THREE.LineSegments(
    lineGeo,
    new THREE.LineBasicMaterial({ color: new THREE.Color("#0e7490"), transparent: true, opacity: 0.16 })
  );
  group.add(lines);

  /* ---------- Scroll-driven state ---------- */
  const slides = Array.from(document.querySelectorAll(".slide"));
  let explode = 1.9; // start scattered, assemble on load
  let offsetX = 0;
  let offsetY = -0.9;
  let fade = 0;      // canvas opacity
  let lastExplodeDrawn = -1;

  function centerSlide() {
    const cy = window.innerHeight / 2;
    for (const s of slides) {
      const r = s.getBoundingClientRect();
      if (r.top <= cy && r.bottom > cy) return s;
    }
    return slides[0];
  }

  function targets() {
    const s = centerSlide();
    const narrow = window.innerWidth < 760;
    let e = 0, x = 0, y = 0, f = narrow ? 0.22 : 0.5;
    if (s.classList.contains("slide-divider")) e = 1.1;
    else if (s.id === "s16") { e = 1.5; f = narrow ? 0.3 : 0.75; }
    else if (s.id === "s1") { f = narrow ? 0.3 : 0.6; y = -0.9; }
    else if (!narrow && !s.classList.contains("slide-title")) x = 2.1;
    return { e, x, y, f };
  }

  function applyPositions() {
    for (let i = 0; i < total; i++) {
      const d = clusterDirs[clusterOf[i]];
      positions[i * 3] = base[i * 3] + (d.x * 1.9 + jitter[i * 3] * 0.7) * explode;
      positions[i * 3 + 1] = base[i * 3 + 1] + (d.y * 1.9 + jitter[i * 3 + 1] * 0.7) * explode;
      positions[i * 3 + 2] = base[i * 3 + 2] + (d.z * 1.9 + jitter[i * 3 + 2] * 0.7) * explode;
    }
    pointsGeo.attributes.position.needsUpdate = true;
    for (let p = 0; p < pairs.length / 2; p++) {
      const a = pairs[p * 2], b = pairs[p * 2 + 1];
      linePositions[p * 6] = positions[a * 3];
      linePositions[p * 6 + 1] = positions[a * 3 + 1];
      linePositions[p * 6 + 2] = positions[a * 3 + 2];
      linePositions[p * 6 + 3] = positions[b * 3];
      linePositions[p * 6 + 4] = positions[b * 3 + 1];
      linePositions[p * 6 + 5] = positions[b * 3 + 2];
    }
    lineGeo.attributes.position.needsUpdate = true;
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  function tick() {
    const t = clock.getElapsedTime();
    const doc = document.documentElement;
    const p = doc.scrollHeight > window.innerHeight
      ? window.scrollY / (doc.scrollHeight - window.innerHeight)
      : 0;

    const tg = targets();
    explode += (tg.e - explode) * 0.055;
    offsetX += (tg.x - offsetX) * 0.06;
    offsetY += (tg.y - offsetY) * 0.06;
    fade += (tg.f - fade) * 0.06;

    group.rotation.y = p * Math.PI * 4 + t * 0.06;
    group.rotation.x = 0.25 + Math.sin(p * Math.PI * 2) * 0.12;
    group.position.x = offsetX;
    group.position.y = offsetY + Math.sin(t * 0.5) * 0.08;
    canvas.style.opacity = fade.toFixed(3);

    if (Math.abs(explode - lastExplodeDrawn) > 0.0008) {
      applyPositions();
      lastExplodeDrawn = explode;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
