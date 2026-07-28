(function () {
  "use strict";

  // ============================================================
  //  Canvas — DPR-aware, fills the window, resizes responsively
  // ============================================================
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const BASE_W = 400;
  const BASE_H = 600;

  let W = BASE_W, H = BASE_H;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Lifted magic numbers into named constants (see .sarvam/skills/clean-code/SKILL.md).
  const TAU = Math.PI * 2;          // full circle — end angle for every ellipse()/arc() call below
  const PIPE_MARGIN = 60;           // min base-px gap between a pipe opening and the playfield edges
  const BEST_KEY = "flappy_best";   // localStorage key for the persisted high score

  function resize() {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = cssW;
    H = cssH;
    scale = Math.min(W / BASE_W, H / BASE_H);
    if (scale < 0.45) scale = 0.45;
    applyScale();
    const m = PIPE_MARGIN * scale;
    if (bird) {
      if (bird.y + BIRD_R > PLAY_H) bird.y = PLAY_H - BIRD_R;
      if (bird.y - BIRD_R < 0) bird.y = BIRD_R;
    }
    if (pipes) {
      for (const p of pipes) {
        if (p.gapBottom > PLAY_H - m) { p.gapBottom = PLAY_H - m; p.gapTop = p.gapBottom - PIPE_GAP; }
        if (p.gapTop < m) { p.gapTop = m; p.gapBottom = p.gapTop + PIPE_GAP; }
      }
    }
  }
  window.addEventListener("resize", resize);

  // ---- Config: base (unscaled) constants ----
  const BASE = { GROUND_H: 96, GRAVITY: 0.45, FLAP: -7.8, MAX_FALL: 11, PIPE_W: 62, PIPE_GAP: 158, PIPE_SPEED: 2.3, PIPE_SPACING: 220, BIRD_X: 92, BIRD_R: 13, BIRD_W: 34 };

  let scale = 1;
  let GROUND_H = BASE.GROUND_H, PLAY_H = BASE_H - BASE.GROUND_H;
  let GRAVITY = BASE.GRAVITY, FLAP = BASE.FLAP, MAX_FALL = BASE.MAX_FALL;
  let PIPE_W = BASE.PIPE_W, PIPE_GAP = BASE.PIPE_GAP, PIPE_SPEED = BASE.PIPE_SPEED, PIPE_SPACING = BASE.PIPE_SPACING;
  let BIRD_X = BASE.BIRD_X, BIRD_R = BASE.BIRD_R, BIRD_W = BASE.BIRD_W;

  function applyScale() {
    GROUND_H = BASE.GROUND_H * scale;
    PLAY_H = H - GROUND_H;
    GRAVITY = BASE.GRAVITY * scale;
    FLAP = BASE.FLAP * scale;
    MAX_FALL = BASE.MAX_FALL * scale;
    PIPE_W = BASE.PIPE_W * scale;
    PIPE_GAP = BASE.PIPE_GAP * scale;
    PIPE_SPEED = BASE.PIPE_SPEED * scale;
    PIPE_SPACING = BASE.PIPE_SPACING * scale;
    BIRD_X = Math.max(60, Math.min(BASE.BIRD_X * scale, W * 0.28));
    BIRD_R = BASE.BIRD_R * scale;
    BIRD_W = BASE.BIRD_W * scale;
  }

  const STATE = { START: 0, PLAYING: 1, OVER: 2 };

  // ---- DOM refs ----
  const startScreen = document.getElementById("start-screen");
  const overScreen  = document.getElementById("over-screen");
  const liveScoreEl = document.getElementById("live-score");
  const finalScoreEl = document.getElementById("final-score");
  const finalBestEl  = document.getElementById("final-best");
  const bestStartEl  = document.getElementById("best-start");
  const seasonTagEl  = document.getElementById("season-tag");
  const toastEl      = document.getElementById("season-toast");

  // ============================================================
  //  Seasons
  // ============================================================
  const SEASONS = ["spring", "summer", "autumn", "winter"];
  const SEASON_SCORES = [0, 8, 18, 30];

  // Sky/grass/dirt colors blend smoothly across the season transition (see
  // getSeason). The bird and pipe *material* cannot blend, so they are keyed
  // off the crisp season index instead and switch at the threshold.
  const BIRD_STYLES = ["songbird", "parrot", "owl", "penguin"];   // spring → winter
  const PIPE_STYLES = ["wood", "concrete", "brick", "ice"];       // spring → winter

  const PALETTES = {
    spring: { skyTop: "#9be7d6", skyBot: "#c9f5e7", grassTop: "#9ed866", grassBot: "#7cc24f", dirt: "#e6d9a0" },
    summer: { skyTop: "#4ec0ca", skyBot: "#8fe0e6", grassTop: "#6fbf1a", grassBot: "#4f9e10", dirt: "#ded895" },
    autumn: { skyTop: "#ffb073", skyBot: "#ffd9a8", grassTop: "#d6a23a", grassBot: "#a9792a", dirt: "#cdb98e" },
    winter: { skyTop: "#8fb4d6", skyBot: "#d8e8f5", grassTop: "#cfd8e0", grassBot: "#aab4bf", dirt: "#dde2e6" },
  };

  function hexToRgb(h) {
    h = h.replace("#", "");
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    const n = parseInt(h, 16);
    return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Season palettes are static, so parse each hex → RGB once at init instead of
  // re-parsing on every blend. Blends then do only integer arithmetic and emit
  // the same "rgb(r,g,b)" string shape that drawSky/drawGround expect.
  const PALETTES_RGB = {};
  for (let pi = 0; pi < SEASONS.length; pi++) {
    const key = SEASONS[pi], src = PALETTES[key], out = PALETTES_RGB[key] = {};
    for (const ck in src) { if (Object.prototype.hasOwnProperty.call(src, ck)) out[ck] = hexToRgb(src[ck]); }
  }
  function rgbStr(c) { return "rgb(" + c.r + "," + c.g + "," + c.b + ")"; }
  function blendColor(a, b, t) {
    return rgbStr({ r: Math.round(lerp(a.r, b.r, t)),
                    g: Math.round(lerp(a.g, b.g, t)),
                    b: Math.round(lerp(a.b, b.b, t)) });
  }

  // Returns blended palette for current score + dominant season index.
  // Pure function of `score`, so it is cached in `seasonCache` and recomputed
  // only when the score changes (scoring path + resetGame) — never per frame.
  function getSeason(scoreVal) {
    let i = 0;
    while (i < SEASON_SCORES.length - 1 && scoreVal >= SEASON_SCORES[i + 1]) i++;
    const blend = 4;
    let a = i, b = i, t = 0;
    if (i < SEASON_SCORES.length - 1) {
      const end = SEASON_SCORES[i + 1];
      if (scoreVal >= end - blend) {
        a = i; b = i + 1;
        t = (scoreVal - (end - blend)) / blend;
        if (t > 1) t = 1;
      }
    }
    const pa = PALETTES_RGB[SEASONS[a]], pb = PALETTES_RGB[SEASONS[b]];
    const palette = {
      skyTop: blendColor(pa.skyTop, pb.skyTop, t),
      skyBot: blendColor(pa.skyBot, pb.skyBot, t),
      grassTop: blendColor(pa.grassTop, pb.grassTop, t),
      grassBot: blendColor(pa.grassBot, pb.grassBot, t),
      dirt: blendColor(pa.dirt, pb.dirt, t),
    };
    // Index tracks the "official" current season (the one whose threshold
    // the score has reached): colors blend toward the *next* season in the
    // final few points as a visual lead-in, but the badge/toast/particles
    // only switch over when the season truly arrives.
    return { palette: palette, index: i };
  }

  // Cached { palette, index }. Updated only when the score changes; draw() and
  // checkSeasonChange() read this instead of recomputing the blend every frame.
  let seasonCache = getSeason(0);

  // ---- Season-change toast ----
  let toastTimer = 0;
  let lastSeasonIndex = 0;

  function showSeasonToast(seasonIndex) {
    toastEl.textContent = SEASONS[seasonIndex].toUpperCase();
    toastEl.classList.add("show");
    toastEl.classList.remove("hidden");
    toastTimer = 150;
  }
  function updateToast(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) { toastEl.classList.remove("show"); toastEl.classList.add("hidden"); }
    }
  }
  function setSeasonBadge(seasonIndex) { seasonTagEl.textContent = SEASONS[seasonIndex].toUpperCase(); }

  // ============================================================
  //  Particles — seasonal ambient effects
  // ============================================================
  const PARTICLE_KINDS = { spring: "petal", summer: "pollen", autumn: "leaf", winter: "snow" };
  let particles = [];
  let particleKind = "petal";

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function spawnParticle(kind) {
    const x = Math.random() * W;
    const y = -20 - Math.random() * 60;
    const s = scale;
    if (kind === "petal") {
      return { kind: kind, x: x, y: y, vx: -0.3*s+Math.random()*0.4*s, vy: 0.5*s+Math.random()*0.6*s,
               size: 5*s+Math.random()*4*s, rot: Math.random()*TAU, vrot: (Math.random()-0.5)*0.05,
               sway: Math.random()*TAU, color: pick(["#ffc0cb","#ffd1dc","#ffb6c1","#ffe0ec"]) };
    }
    if (kind === "pollen") {
      return { kind: kind, x: x, y: y, vx: 0.4*s+Math.random()*0.5*s, vy: 0.2*s+Math.random()*0.3*s,
               size: 2*s+Math.random()*2.5*s, sway: Math.random()*TAU, color: pick(["#fff3a0","#ffe066","#fff0b3"]) };
    }
    if (kind === "leaf") {
      return { kind: kind, x: x, y: y, vx: -0.5*s+Math.random()*0.3*s, vy: 0.6*s+Math.random()*0.8*s,
               size: 7*s+Math.random()*6*s, rot: Math.random()*TAU, vrot: (Math.random()-0.5)*0.08,
               sway: Math.random()*TAU, color: pick(["#d2691e","#e8870b","#c0392b","#b5651d","#cd7f32"]) };
    }
    return { kind: "snow", x: x, y: y, vx: -0.2*s+Math.random()*0.4*s, vy: 0.4*s+Math.random()*0.7*s,
             size: 2.5*s+Math.random()*3.5*s, sway: Math.random()*TAU, color: "#ffffff" };
  }

  function ensureParticles() {
    const target = Math.round(36 * Math.min(1, scale));
    particles = particles.filter(function (p) { return p.kind === particleKind; });
    while (particles.length < target) particles.push(spawnParticle(particleKind));
    while (particles.length > target * 1.6) particles.shift();
  }

  function spawnAmbient(dt) {
    if (Math.random() < 0.25 * dt) particles.push(spawnParticle(particleKind));
  }

  function updateParticles(dt) {
    const s = scale;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.sway += 0.03 * dt;
      p.x += (p.vx + Math.sin(p.sway) * 0.8 * s) * dt;
      p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += p.vrot * dt * 2;
      if (p.y > H + 30 || p.x < -40 || p.x > W + 40) particles.splice(i, 1);
    }
  }

  // Lookup table instead of a per-particle if/else string chain (≈36 draws/frame).
  const PARTICLE_DRAWERS = { petal: drawPetal, pollen: drawPollen, leaf: drawLeaf, snow: drawSnow };
  function drawParticles() {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      (PARTICLE_DRAWERS[p.kind] || drawSnow)(p);
    }
  }
  function drawPetal(p) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.color; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size*0.55, 0, 0, TAU); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }
  function drawPollen(p) {
    ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = p.color;
    ctx.shadowColor = p.color; ctx.shadowBlur = 6 * scale;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }
  function drawLeaf(p) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.color; ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -p.size);
    ctx.quadraticCurveTo(p.size, -p.size*0.3, 0, p.size);
    ctx.quadraticCurveTo(-p.size, -p.size*0.3, 0, -p.size);
    ctx.fill();
    ctx.strokeStyle = "rgba(80,40,10,0.4)"; ctx.lineWidth = 1 * scale;
    ctx.beginPath(); ctx.moveTo(0, -p.size*0.9); ctx.lineTo(0, p.size*0.9); ctx.stroke();
    ctx.restore(); ctx.globalAlpha = 1;
  }
  function drawSnow(p) {
    ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }

  // ============================================================
  //  State
  // ============================================================
  let state = STATE.START;
  let bird, pipes, groundX, score, best, frames, flash, flapAnim;

  best = loadBest();
  bestStartEl.textContent = best;
  resize();
  resetGame();

  // ---- Input ----
  function onFlap() {
    if (state === STATE.START) { startGame(); }
    if (state === STATE.PLAYING) { bird.vy = FLAP; flapAnim = 1; }
    if (state === STATE.OVER) return;
  }
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); onFlap(); }
  });
  canvas.addEventListener("mousedown", function (e) { e.preventDefault(); onFlap(); });
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); onFlap(); }, { passive: false });
  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("restart-btn").addEventListener("click", startGame);

  // ---- Game flow ----
  function resetGame() {
    bird = { x: BIRD_X, y: PLAY_H / 2, vy: 0, rot: 0 };
    pipes = [];
    pipes.push(makePipe(W + 60));
    groundX = 0; score = 0; frames = 0; flash = 0; flapAnim = 0;
    liveScoreEl.textContent = "0";
    lastSeasonIndex = 0;
    particleKind = PARTICLE_KINDS.spring;
    particles = [];
    setSeasonBadge(0);
    seasonCache = getSeason(score);   // score just reset to 0 → spring palette
    ensureParticles();
  }
  function startGame() {
    resetGame();
    state = STATE.PLAYING;
    startScreen.classList.add("hidden");
    overScreen.classList.add("hidden");
    liveScoreEl.classList.remove("hidden");
    seasonTagEl.classList.remove("hidden");
    bird.vy = FLAP;
  }
  function gameOver() {
    state = STATE.OVER;
    flash = 1;
    if (score > best) { best = score; saveBest(best); }
    finalScoreEl.textContent = score;
    finalBestEl.textContent = best;
    bestStartEl.textContent = best;
    liveScoreEl.classList.add("hidden");
    overScreen.classList.remove("hidden");
  }
  function makePipe(x) {
    const margin = PIPE_MARGIN * scale;
    const gapTop = margin + Math.random() * (PLAY_H - PIPE_GAP - margin * 2);
    return { x: x, gapTop: gapTop, gapBottom: gapTop + PIPE_GAP, scored: false };
  }

  // ---- Update ----
  function update(dt) {
    frames++;
    if (state === STATE.PLAYING) {
      groundX = (groundX - PIPE_SPEED * dt) % (24 * scale);
    }
    if (state !== STATE.OVER) { spawnAmbient(dt); }
    else if (Math.random() < 0.1 * dt) { particles.push(spawnParticle(particleKind)); }
    updateParticles(dt);
    ensureParticles();
    updateToast(dt);

    if (state === STATE.START) {
      bird.y = PLAY_H / 2 + Math.sin(frames * 0.08) * 8 * scale;
      bird.rot = 0;
      return;
    }
    if (state === STATE.OVER) {
      if (bird.y + BIRD_R < PLAY_H) {
        bird.vy = Math.min(bird.vy + GRAVITY * 2 * dt, MAX_FALL + 4 * scale);
        bird.y += bird.vy * dt;
        bird.rot = Math.min(bird.rot + 0.12 * dt, Math.PI / 2);
      }
      if (flash > 0) flash = Math.max(0, flash - 0.04 * dt);
      return;
    }

    // PLAYING
    bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
    bird.y += bird.vy * dt;
    const targetRot = bird.vy < 0 ? -0.45 : Math.min(bird.vy * 0.08, Math.PI / 2);
    bird.rot += (targetRot - bird.rot) * 0.18 * dt;
    if (flapAnim > 0) flapAnim = Math.max(0, flapAnim - 0.12 * dt);

    for (let i = pipes.length - 1; i >= 0; i--) {
      const p = pipes[i];
      p.x -= PIPE_SPEED * dt;
      if (!p.scored && p.x + PIPE_W / 2 < bird.x) {
        p.scored = true;
        score++;
        liveScoreEl.textContent = score;
        seasonCache = getSeason(score);   // recompute blended palette on score change
        checkSeasonChange(seasonCache.index);
      }
      if (p.x + PIPE_W < -10) pipes.splice(i, 1);
      if (hitsPipe(p)) { gameOver(); return; }
    }
    const last = pipes[pipes.length - 1];
    if (last.x < W - PIPE_SPACING) pipes.push(makePipe(W + 20));
    if (bird.y - BIRD_R < 0) { bird.y = BIRD_R; bird.vy = 0; }
    if (bird.y + BIRD_R >= PLAY_H) { bird.y = PLAY_H - BIRD_R; gameOver(); }
  }

  // Takes the current season index as an explicit parameter so the caller's
  // obligation to refresh seasonCache first is visible, not hidden.
  function checkSeasonChange(si) {
    if (si !== lastSeasonIndex) {
      lastSeasonIndex = si;
      particleKind = PARTICLE_KINDS[SEASONS[si]];
      particles = [];
      ensureParticles();
      setSeasonBadge(si);
      showSeasonToast(si);
    }
  }

  function hitsPipe(p) {
    const overlapX = bird.x + BIRD_R > p.x && bird.x - BIRD_R < p.x + PIPE_W;
    const overlapY = bird.y - BIRD_R < p.gapTop || bird.y + BIRD_R > p.gapBottom;
    return overlapX && overlapY;
  }

  // ---- Render ----
  function draw() {
    const seas = seasonCache;
    drawSky(seas.palette);
    drawClouds();
    drawParticles();
    drawPipes(seas.index);
    drawGround(seas.palette);
    drawBird(seas.index);
    if (flash > 0) { ctx.fillStyle = "rgba(255,255,255," + flash + ")"; ctx.fillRect(0, 0, W, H); }
  }

  function drawSky(palette) {
    const g = ctx.createLinearGradient(0, 0, 0, PLAY_H);
    g.addColorStop(0, palette.skyTop);
    g.addColorStop(1, palette.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, PLAY_H);
  }

  const clouds = [ { x: 60, y: 90, s: 1.0 }, { x: 250, y: 140, s: 0.7 }, { x: 330, y: 60, s: 0.85 } ];
  function drawClouds() {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const s = scale;
    for (const c of clouds) {
      let cx = (c.x * s - frames * 0.2 * s) % (W + 120 * s);
      if (cx < -60 * s) cx += W + 120 * s;
      drawCloud(cx, c.y * s, c.s * s);
    }
  }
  function drawCloud(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 18*s, 0, TAU); ctx.arc(x+20*s, y+4*s, 22*s, 0, TAU);
    ctx.arc(x+44*s, y, 16*s, 0, TAU); ctx.arc(x+22*s, y-10*s, 16*s, 0, TAU);
    ctx.fill();
  }

  function drawPipes(index) {
    const style = PIPE_STYLES[index];
    for (const p of pipes) {
      drawPipe(p.x, 0, PIPE_W, p.gapTop, true, style);
      drawPipe(p.x, p.gapBottom, PIPE_W, PLAY_H - p.gapBottom, false, style);
    }
  }
  const PIPE_DRAWERS = { wood: drawWoodPipe, concrete: drawConcretePipe, brick: drawBrickPipe, ice: drawIcePipe };
  function drawPipe(x, y, w, h, isTop, style) {
    (PIPE_DRAWERS[style] || drawIcePipe)(x, y, w, h, isTop);
  }

  // Shared lip geometry so every material has the same opening shape/hitbox.
  function pipeLipGeom(x, y, w, h, isTop) {
    const s = scale;
    const lipH = 26 * s, lipOver = 4 * s;
    return { lipH: lipH, lipY: isTop ? y + h - lipH : y, lipX: x - lipOver, lipW: w + lipOver * 2 };
  }

  // ---- Spring: wooden pipe (planks + grain) ----
  function drawWoodPipe(x, y, w, h, isTop) {
    const s = scale;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#6b4220"); g.addColorStop(0.5, "#8a5a2b"); g.addColorStop(1, "#6b4220");
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = "#4a2e15"; ctx.lineWidth = 1.5 * s;
    const seams = Math.max(1, Math.round(w / (22 * s)));
    for (let i = 1; i < seams; i++) { const sx = x + (w / seams) * i; ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx, y + h); ctx.stroke(); }
    ctx.strokeStyle = "#5a3818"; ctx.lineWidth = 1 * s; ctx.globalAlpha = 0.6;
    for (let gy = y + 14 * s; gy < y + h; gy += 14 * s) { ctx.beginPath(); ctx.moveTo(x + 2 * s, gy); ctx.lineTo(x + w - 2 * s, gy); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.restore();
    ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 2 * s; ctx.strokeRect(x + 0.5, y, w - 1, h);
    const lip = pipeLipGeom(x, y, w, h, isTop);
    const lg = ctx.createLinearGradient(lip.lipX, 0, lip.lipX + lip.lipW, 0);
    lg.addColorStop(0, "#6b4220"); lg.addColorStop(0.5, "#9a6a33"); lg.addColorStop(1, "#6b4220");
    ctx.fillStyle = lg; ctx.fillRect(lip.lipX, lip.lipY, lip.lipW, lip.lipH);
    ctx.strokeStyle = "#4a2e15"; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(lip.lipX, lip.lipY + lip.lipH / 2); ctx.lineTo(lip.lipX + lip.lipW, lip.lipY + lip.lipH / 2); ctx.stroke();
    ctx.strokeStyle = "#3a2410"; ctx.lineWidth = 2 * s; ctx.strokeRect(lip.lipX + 0.5, lip.lipY + 0.5, lip.lipW - 1, lip.lipH - 1);
  }

  // ---- Summer: concrete pipe (cast seams + speckle) ----
  function drawConcretePipe(x, y, w, h, isTop) {
    const s = scale;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#8a8f96"); g.addColorStop(0.5, "#b4b9c0"); g.addColorStop(1, "#7c8188");
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const joint = 34 * s;
    for (let jy = y + joint; jy < y + h; jy += joint) {
      ctx.strokeStyle = "#646a72"; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.moveTo(x, jy); ctx.lineTo(x + w, jy); ctx.stroke();
      ctx.strokeStyle = "#cdd2d8"; ctx.lineWidth = 1 * s;
      ctx.beginPath(); ctx.moveTo(x, jy - 1 * s); ctx.lineTo(x + w, jy - 1 * s); ctx.stroke();
    }
    ctx.fillStyle = "rgba(60,66,74,0.25)";
    for (let py = y + 6 * s; py < y + h; py += 11 * s) { ctx.fillRect(x + 4 * s, py, 2 * s, 2 * s); ctx.fillRect(x + w - 8 * s, py + 5 * s, 2 * s, 2 * s); }
    ctx.restore();
    ctx.strokeStyle = "#5a6068"; ctx.lineWidth = 2 * s; ctx.strokeRect(x + 0.5, y, w - 1, h);
    const lip = pipeLipGeom(x, y, w, h, isTop);
    const lg = ctx.createLinearGradient(lip.lipX, 0, lip.lipX + lip.lipW, 0);
    lg.addColorStop(0, "#7c8188"); lg.addColorStop(0.5, "#c0c5cc"); lg.addColorStop(1, "#7c8188");
    ctx.fillStyle = lg; ctx.fillRect(lip.lipX, lip.lipY, lip.lipW, lip.lipH);
    ctx.strokeStyle = "#646a72"; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(lip.lipX, lip.lipY + lip.lipH - 4 * s); ctx.lineTo(lip.lipX + lip.lipW, lip.lipY + lip.lipH - 4 * s); ctx.stroke();
    ctx.strokeRect(lip.lipX + 0.5, lip.lipY + 0.5, lip.lipW - 1, lip.lipH - 1);
  }

  // ---- Autumn: brick pipe (offset courses + mortar) ----
  function drawBrickPipe(x, y, w, h, isTop) {
    const s = scale;
    const bh = 12 * s, gap = 2 * s, bw = 26 * s;
    ctx.fillStyle = "#c9a978"; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    let row = 0;
    for (let by = y; by < y + h; by += bh + gap) {
      const offset = (row % 2 === 0) ? 0 : bw / 2;
      for (let bx = x - bw + offset; bx < x + w; bx += bw + gap) {
        ctx.fillStyle = "#9e4b2f"; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fillRect(bx, by, bw, 2 * s);
        ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(bx, by + bh - 2 * s, bw, 2 * s);
      }
      row++;
    }
    ctx.restore();
    ctx.strokeStyle = "#5a3320"; ctx.lineWidth = 2 * s; ctx.strokeRect(x + 0.5, y, w - 1, h);
    const lip = pipeLipGeom(x, y, w, h, isTop);
    ctx.fillStyle = "#c9a978"; ctx.fillRect(lip.lipX, lip.lipY, lip.lipW, lip.lipH);
    ctx.save(); ctx.beginPath(); ctx.rect(lip.lipX, lip.lipY, lip.lipW, lip.lipH); ctx.clip();
    let lrow = 0;
    for (let by = lip.lipY; by < lip.lipY + lip.lipH; by += bh + gap) {
      const offset = (lrow % 2 === 0) ? 0 : bw / 2;
      for (let bx = lip.lipX - bw + offset; bx < lip.lipX + lip.lipW; bx += bw + gap) { ctx.fillStyle = "#9e4b2f"; ctx.fillRect(bx, by, bw, bh); }
      lrow++;
    }
    ctx.restore();
    ctx.strokeRect(lip.lipX + 0.5, lip.lipY + 0.5, lip.lipW - 1, lip.lipH - 1);
  }

  // ---- Winter: ice pipe (crystal facets + highlight) ----
  function drawIcePipe(x, y, w, h, isTop) {
    const s = scale;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#9fc8e0"); g.addColorStop(0.4, "#cfe8f5"); g.addColorStop(1, "#8ab2cc");
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1.5 * s;
    const fac = 16 * s;
    for (let fx = x - h; fx < x + w + h; fx += fac) { ctx.beginPath(); ctx.moveTo(fx, y); ctx.lineTo(fx + h, y + h); ctx.stroke(); }
    ctx.strokeStyle = "rgba(120,160,190,0.5)"; ctx.lineWidth = 1 * s;
    for (let fx = x - h + fac / 2; fx < x + w + h; fx += fac) { ctx.beginPath(); ctx.moveTo(fx, y); ctx.lineTo(fx + h, y + h); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(x + 4 * s, y, 5 * s, h);
    ctx.strokeStyle = "#5f88a0"; ctx.lineWidth = 2 * s; ctx.strokeRect(x + 0.5, y, w - 1, h);
    const lip = pipeLipGeom(x, y, w, h, isTop);
    const lg = ctx.createLinearGradient(lip.lipX, 0, lip.lipX + lip.lipW, 0);
    lg.addColorStop(0, "#8ab2cc"); lg.addColorStop(0.4, "#dff0fa"); lg.addColorStop(1, "#8ab2cc");
    ctx.fillStyle = lg; ctx.fillRect(lip.lipX, lip.lipY, lip.lipW, lip.lipH);
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(lip.lipX + 3 * s, lip.lipY, 5 * s, lip.lipH);
    ctx.strokeStyle = "#5f88a0"; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(lip.lipX + lip.lipW * 0.5, lip.lipY); ctx.lineTo(lip.lipX + lip.lipW, lip.lipY + lip.lipH * 0.6); ctx.stroke();
    ctx.strokeRect(lip.lipX + 0.5, lip.lipY + 0.5, lip.lipW - 1, lip.lipH - 1);
  }

  function drawGround(palette) {
    ctx.fillStyle = palette.dirt; ctx.fillRect(0, PLAY_H, W, GROUND_H);
    const g = ctx.createLinearGradient(0, PLAY_H, 0, PLAY_H + 26 * scale);
    g.addColorStop(0, palette.grassTop); g.addColorStop(1, palette.grassBot);
    ctx.fillStyle = g; ctx.fillRect(0, PLAY_H, W, 26 * scale);
    ctx.fillStyle = palette.dirt; ctx.fillRect(0, PLAY_H + 26 * scale, W, GROUND_H - 26 * scale);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    const tile = 24 * scale;
    for (let i = -1; i < W / tile + 1; i++) {
      const gx = i * tile + groundX;
      ctx.beginPath();
      ctx.moveTo(gx, PLAY_H + 8*scale);
      ctx.lineTo(gx + 12*scale, PLAY_H + 18*scale);
      ctx.lineTo(gx + 24*scale, PLAY_H + 8*scale);
      ctx.lineTo(gx + 24*scale, PLAY_H + 4*scale);
      ctx.lineTo(gx, PLAY_H + 4*scale);
      ctx.closePath(); ctx.fill();
    }
  }

  const BIRD_DRAWERS = { songbird: drawSongbird, parrot: drawParrot, owl: drawOwl, penguin: drawPenguin };
  function drawBird(index) {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);
    (BIRD_DRAWERS[BIRD_STYLES[index]] || drawPenguin)();
    ctx.restore();
  }

  // ---- Spring bird: pink songbird with a little crest + cheek blush ----
  function drawSongbird() {
    const s = scale, R = BIRD_W / 2;
    ctx.strokeStyle = "#e07ab0"; ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(-2 * s, -R); ctx.lineTo(-6 * s, -R - 8 * s);
    ctx.moveTo(3 * s, -R); ctx.lineTo(5 * s, -R - 9 * s); ctx.stroke();
    const bg = ctx.createLinearGradient(0, -R, 0, R);
    bg.addColorStop(0, "#ffc2dd"); bg.addColorStop(1, "#ff8fc0");
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.ellipse(0, 0, R, R - 1 * s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#c76aa0"; ctx.lineWidth = 2 * s; ctx.stroke();
    ctx.fillStyle = "#fff0f6";
    ctx.beginPath(); ctx.ellipse(2 * s, 6 * s, 12 * s, 7 * s, 0, 0, TAU); ctx.fill();
    const wingY = flapAnim > 0 ? -4 * s : 4 * s;
    ctx.fillStyle = "#ff9ec4"; ctx.strokeStyle = "#c76aa0"; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.ellipse(-5 * s, wingY, 9 * s, 6 * s, -0.3, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ff6f9a"; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(6 * s, 0, 3 * s, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(9 * s, -5 * s, 6 * s, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#c76aa0"; ctx.lineWidth = 1.5 * s; ctx.stroke();
    ctx.fillStyle = "#222";
    ctx.beginPath(); ctx.arc(11 * s, -5 * s, 3 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = "#ff9a4a"; ctx.strokeStyle = "#c75d12"; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(15 * s, -2 * s); ctx.lineTo(25 * s, 1 * s); ctx.lineTo(15 * s, 4 * s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // ---- Summer bird: yellow parrot with long tail + big toucan beak ----
  function drawParrot() {
    const s = scale, R = BIRD_W / 2;
    ctx.fillStyle = "#3aa64a";
    ctx.beginPath(); ctx.moveTo(-R + 2 * s, -2 * s); ctx.lineTo(-R - 10 * s, -6 * s); ctx.lineTo(-R - 8 * s, 6 * s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#2a7ae0";
    ctx.beginPath(); ctx.moveTo(-R + 2 * s, 2 * s); ctx.lineTo(-R - 9 * s, 2 * s); ctx.lineTo(-R - 6 * s, 9 * s); ctx.closePath(); ctx.fill();
    const bg = ctx.createLinearGradient(0, -R, 0, R);
    bg.addColorStop(0, "#ffe24a"); bg.addColorStop(1, "#f0a818");
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.ellipse(0, 0, R, R - 1 * s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#b5730f"; ctx.lineWidth = 2 * s; ctx.stroke();
    ctx.fillStyle = "#7cc23a";
    ctx.beginPath(); ctx.ellipse(3 * s, 7 * s, 11 * s, 6 * s, 0, 0, TAU); ctx.fill();
    const wingY = flapAnim > 0 ? -4 * s : 4 * s;
    ctx.fillStyle = "#e8362f"; ctx.strokeStyle = "#8a1f1a"; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.ellipse(-4 * s, wingY, 10 * s, 7 * s, -0.3, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(8 * s, -6 * s, 6 * s, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#b5730f"; ctx.lineWidth = 1.5 * s; ctx.stroke();
    ctx.fillStyle = "#222";
    ctx.beginPath(); ctx.arc(10 * s, -6 * s, 3 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = "#ff8a2a"; ctx.strokeStyle = "#c75d12"; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(13 * s, -5 * s); ctx.quadraticCurveTo(30 * s, -3 * s, 28 * s, 3 * s);
    ctx.quadraticCurveTo(28 * s, 6 * s, 13 * s, 6 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#3a2410";
    ctx.beginPath(); ctx.moveTo(24 * s, 1 * s); ctx.lineTo(28 * s, 3 * s); ctx.lineTo(24 * s, 5 * s); ctx.closePath(); ctx.fill();
  }

  // ---- Autumn bird: amber owl with ear tufts + big forward eyes ----
  function drawOwl() {
    const s = scale, R = BIRD_W / 2;
    ctx.fillStyle = "#8a4212";
    ctx.beginPath(); ctx.moveTo(-7 * s, -R + 2 * s); ctx.lineTo(-10 * s, -R - 8 * s); ctx.lineTo(-2 * s, -R); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(7 * s, -R + 2 * s); ctx.lineTo(10 * s, -R - 8 * s); ctx.lineTo(2 * s, -R); ctx.closePath(); ctx.fill();
    const bg = ctx.createLinearGradient(0, -R, 0, R);
    bg.addColorStop(0, "#e8a24a"); bg.addColorStop(1, "#a6601e");
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.ellipse(0, 0, R, R - 1 * s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#6a3a10"; ctx.lineWidth = 2 * s; ctx.stroke();
    ctx.strokeStyle = "#704012"; ctx.lineWidth = 1.2 * s; ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(-6 * s, 2 * s); ctx.lineTo(0, 6 * s); ctx.lineTo(6 * s, 2 * s);
    ctx.moveTo(-6 * s, 8 * s); ctx.lineTo(0, 12 * s); ctx.lineTo(6 * s, 8 * s);
    ctx.stroke(); ctx.globalAlpha = 1;
    const wingY = flapAnim > 0 ? -3 * s : 4 * s;
    ctx.fillStyle = "#8a4f1a"; ctx.strokeStyle = "#6a3a10"; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.ellipse(-5 * s, wingY, 9 * s, 7 * s, -0.2, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(-5 * s, -4 * s, 6 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(5 * s, -4 * s, 6 * s, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#6a3a10"; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.arc(-5 * s, -4 * s, 6 * s, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(5 * s, -4 * s, 6 * s, 0, TAU); ctx.stroke();
    ctx.fillStyle = "#1a1208";
    ctx.beginPath(); ctx.arc(-5 * s, -4 * s, 3 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(5 * s, -4 * s, 3 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = "#ff9a3a"; ctx.strokeStyle = "#8a4212"; ctx.lineWidth = 1.2 * s;
    ctx.beginPath(); ctx.moveTo(1 * s, 0); ctx.lineTo(4 * s, 6 * s); ctx.lineTo(-2 * s, 6 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // ---- Winter bird: penguin — black back, white belly, orange beak + feet ----
  function drawPenguin() {
    const s = scale, R = BIRD_W / 2;
    ctx.fillStyle = "#2a3038";
    ctx.beginPath(); ctx.ellipse(0, 0, R, R - 1 * s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#10151a"; ctx.lineWidth = 2 * s; ctx.stroke();
    ctx.fillStyle = "#fffdf6";
    ctx.beginPath(); ctx.ellipse(1 * s, 3 * s, 11 * s, 12 * s, 0, 0, TAU); ctx.fill();
    const wingY = flapAnim > 0 ? -3 * s : 4 * s;
    ctx.fillStyle = "#2a3038"; ctx.strokeStyle = "#10151a"; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.ellipse(-R + 2 * s, wingY, 5 * s, 9 * s, 0.3, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(-3 * s, -7 * s, 4 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(5 * s, -7 * s, 4 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = "#10151a";
    ctx.beginPath(); ctx.arc(-2 * s, -7 * s, 2 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(6 * s, -7 * s, 2 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = "#ff8a2a"; ctx.strokeStyle = "#c75d12"; ctx.lineWidth = 1.2 * s;
    ctx.beginPath(); ctx.moveTo(1 * s, -3 * s); ctx.lineTo(11 * s, -1 * s); ctx.lineTo(1 * s, 1 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ff8a2a"; ctx.strokeStyle = "#c75d12"; ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.moveTo(-6 * s, R); ctx.lineTo(-9 * s, R + 5 * s); ctx.lineTo(-2 * s, R); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4 * s, R); ctx.lineTo(8 * s, R + 5 * s); ctx.lineTo(10 * s, R - 1 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // ---- Loop ----
  let last = performance.now();
  // Reset the frame clock when the tab returns to the foreground, so the first
  // visible frame doesn't apply a huge clamped dt that jumps bird/pipes/particles.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) last = performance.now();
  });
  function loop(now) {
    let dt = (now - last) / (1000 / 60);
    last = now;
    if (dt < 0) dt = 0;
    if (dt > 3) dt = 3;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---- Persistence ----
  function loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; }
    catch (e) { console.error("loadBest failed", e); return 0; } // localStorage unavailable → start fresh at 0
  }
  function saveBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); }
    catch (e) { console.error("saveBest failed", e); } // best-effort: persistence must never crash the game loop
  }
})();
