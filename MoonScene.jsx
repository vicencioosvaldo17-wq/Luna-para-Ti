import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ---------- Procedural texture helpers ----------

// Build a stylized moon surface (color + bump share the same canvas).
function makeMoonTextures() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext("2d");

  // Base moon body — soft bluish white
  const base = ctx.createLinearGradient(0, 0, 0, canvas.height);
  base.addColorStop(0, "#f2f5ff");
  base.addColorStop(0.5, "#dfe6f2");
  base.addColorStop(1, "#c3cddd");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle maria (dark seas)
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = 60 + Math.random() * 160;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(120,134,160,0.28)");
    g.addColorStop(1, "rgba(120,134,160,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Craters
  const craters = 240;
  for (let i = 0; i < craters; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = 3 + Math.random() * 26;

    // shadowed bowl
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, "rgba(90,100,120,0.35)");
    g.addColorStop(0.6, "rgba(150,160,180,0.18)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // bright rim
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1 + r * 0.06;
    ctx.beginPath();
    ctx.arc(x + r * 0.15, y + r * 0.15, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Fine grain
  const grain = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = grain.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(grain, 0, 0);

  const colorTex = new THREE.CanvasTexture(canvas);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.wrapS = THREE.RepeatWrapping;

  // Bump map = grayscale version of same canvas
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = canvas.width;
  bumpCanvas.height = canvas.height;
  const bctx = bumpCanvas.getContext("2d");
  bctx.drawImage(canvas, 0, 0);
  bctx.globalCompositeOperation = "saturation";
  bctx.fillStyle = "hsl(0,0%,50%)";
  bctx.fillRect(0, 0, bumpCanvas.width, bumpCanvas.height);
  const bumpTex = new THREE.CanvasTexture(bumpCanvas);
  bumpTex.wrapS = THREE.RepeatWrapping;

  return { colorTex, bumpTex };
}

function makeGlowTexture() {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(214,232,255,0.9)");
  g.addColorStop(0.25, "rgba(180,214,255,0.4)");
  g.addColorStop(0.6, "rgba(140,180,255,0.12)");
  g.addColorStop(1, "rgba(140,180,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

function makeStreakTexture() {
  const w = 256;
  const h = 32;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.7, "rgba(196,215,255,0.35)");
  g.addColorStop(0.95, "rgba(255,255,255,0.95)");
  g.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = g;
  // taper the streak
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

// ---------- Star field shader ----------
const starVertex = `
  attribute float aScale;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSize;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.55 + 0.45 * sin(uTime * 2.0 + aPhase);
    vTwinkle = tw;
    gl_PointSize = uSize * aScale * uPixelRatio * tw * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const starFragment = `
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    float d = distance(gl_PointCoord, vec2(0.5));
    float alpha = smoothstep(0.5, 0.0, d);
    alpha *= alpha;
    gl_FragColor = vec4(vColor * (0.7 + 0.6 * vTwinkle), alpha);
  }
`;

export default function MoonScene() {
  const mountRef = useRef(null);
  const fireStarRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02040f, 0.006);

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 2000);
    camera.position.set(0, 4, 26);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    const pr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pr);
    renderer.setClearColor(0x02040f, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    // Deep space gradient backdrop (big inverted sphere)
    const bgGeo = new THREE.SphereGeometry(900, 32, 32);
    const bgMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color(0x1a1740) }, bottom: { value: new THREE.Color(0x02040f) } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bottom; void main(){ float h = normalize(vP).y*0.5+0.5; gl_FragColor = vec4(mix(bottom, top, pow(h,1.3)),1.0);} `,
    });
    scene.add(new THREE.Mesh(bgGeo, bgMat));

    // ---- Stars ----
    const STAR_COUNT = 3000;
    const positions = new Float32Array(STAR_COUNT * 3);
    const scales = new Float32Array(STAR_COUNT);
    const phases = new Float32Array(STAR_COUNT);
    const colors = new Float32Array(STAR_COUNT * 3);
    const palette = [
      new THREE.Color(0xffffff),
      new THREE.Color(0xbfe0ff),
      new THREE.Color(0xa5b4fc),
      new THREE.Color(0xfff4d6),
    ];
    for (let i = 0; i < STAR_COUNT; i++) {
      // distribute on a large sphere shell
      const r = 120 + Math.random() * 500;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      scales[i] = 0.5 + Math.random() * 2.2;
      phases[i] = Math.random() * Math.PI * 2;
      const col = palette[Math.floor(Math.random() * palette.length)];
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
    starGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    starGeo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    const starMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pr },
        uSize: { value: 6.0 },
      },
      vertexShader: starVertex,
      fragmentShader: starFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // ---- Moon ----
    const { colorTex, bumpTex } = makeMoonTextures();
    const moonGeo = new THREE.SphereGeometry(6, 128, 128);
    const moonMat = new THREE.MeshStandardMaterial({
      map: colorTex,
      bumpMap: bumpTex,
      bumpScale: 0.35,
      roughness: 0.95,
      metalness: 0.0,
    });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    scene.add(moon);

    // Atmospheric glow sprite behind moon
    const glowTex = makeGlowTexture();
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.scale.set(26, 26, 1);
    scene.add(glow);

    // ---- Lighting (creates the terminator / phase) ----
    scene.add(new THREE.AmbientLight(0x33406a, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(18, 8, 14);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6f8bff, 0.38);
    rim.position.set(-16, -4, -10);
    scene.add(rim);

    // ---- Controls (orbit + zoom, works on touch & mouse) ----
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 9;
    controls.maxDistance = 90;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.8;
    controls.autoRotate = false;

    // ---- Shooting stars ----
    const streakTex = makeStreakTexture();
    const shootingStars = [];
    function spawnShootingStar() {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: streakTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 1,
        })
      );
      const len = 10 + Math.random() * 14;
      sprite.scale.set(len, len * 0.12, 1);
      // random start on a shell in front-ish of camera
      const start = new THREE.Vector3(
        (Math.random() - 0.5) * 120,
        20 + Math.random() * 50,
        (Math.random() - 0.5) * 40 - 20
      );
      const dir = new THREE.Vector3(
        -0.5 - Math.random(),
        -0.6 - Math.random() * 0.5,
        0.1 + Math.random() * 0.3
      ).normalize();
      sprite.position.copy(start);
      sprite.material.rotation = Math.atan2(dir.y, dir.x);
      scene.add(sprite);
      shootingStars.push({ sprite, dir, speed: 60 + Math.random() * 50, life: 0, max: 2.2 });
    }
    fireStarRef.current = spawnShootingStar;

    // periodic + initial
    const initTimers = [
      setTimeout(spawnShootingStar, 700),
      setTimeout(spawnShootingStar, 1900),
      setTimeout(spawnShootingStar, 3400),
    ];
    const interval = setInterval(() => {
      if (Math.random() > 0.5) spawnShootingStar();
    }, 3000);

    // keyboard
    const onKey = (e) => {
      if (e.key === " " || e.key === "Enter") spawnShootingStar();
    };
    window.addEventListener("keydown", onKey);

    // ---- Resize ----
    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    setReady(true);

    // ---- Animate ----
    const clock = new THREE.Clock();
    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      const t = clock.getElapsedTime();

      moon.rotation.y += dt * 0.08; // moon spins on its own axis
      starMat.uniforms.uTime.value = t;
      stars.rotation.y += dt * 0.004;
      glow.material.opacity = 0.7 + Math.sin(t * 0.8) * 0.15;
      const gs = 26 + Math.sin(t * 0.8) * 1.6;
      glow.scale.set(gs, gs, 1);

      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const s = shootingStars[i];
        s.life += dt;
        s.sprite.position.addScaledVector(s.dir, s.speed * dt);
        s.sprite.material.opacity = Math.max(0, 1 - s.life / s.max);
        if (s.life >= s.max) {
          scene.remove(s.sprite);
          s.sprite.material.dispose();
          shootingStars.splice(i, 1);
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ---- Cleanup ----
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
      initTimers.forEach(clearTimeout);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      controls.dispose();
      renderer.dispose();
      moonGeo.dispose();
      moonMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="moon-experience" data-testid="moon-experience">
      <div ref={mountRef} className="moon-canvas" data-testid="moon-canvas" />

      {/* Floating UI overlay */}
      <div className="moon-overlay" data-testid="moon-overlay">
        <div className="moon-title-block">
          <h1 className="moon-title" data-testid="moon-title">La Luna</h1>
          <p className="moon-subtitle" data-testid="moon-subtitle">
            <span>✧</span> rodeada de estrellas <span>✧</span>
          </p>
        </div>

        <div className="moon-hint" data-testid="moon-hint">
          <span className="dot" /> Arrastra para orbitar · pellizca o rueda para acercarte
        </div>

        <button
          className="moon-shoot-btn"
          data-testid="shoot-star-button"
          onClick={() => fireStarRef.current && fireStarRef.current()}
        >
          🌠 Lanza una estrella fugaz
        </button>
      </div>

      {!ready && (
        <div className="moon-loading" data-testid="moon-loading">Cargando el cielo…</div>
      )}
    </div>
  );
}
