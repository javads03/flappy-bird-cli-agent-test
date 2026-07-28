(function () {
  "use strict";

  // ============================================================
  //  Canvas — DPR-aware, fills the window, resizes responsively
  // ============================================================
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const BASE_W = 400;
  const BASE_H = 600;

  const MAX_DPR = 3; // clamp device pixel ratio so huge retina screens don't crush perf
  let W = BASE_W, H = BASE_H;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  // Lifted magic numbers into named constants (see .sarvam/skills/clean-code/SKILL.md).
  const TAU = Math.PI * 2;          // full circle — end angle for every ellipse()/arc() call below
  const PIPE_MARGIN = 60;           // min base-px gap between a pipe opening and the playfield edges
  const BEST_KEY = "flappy_best";   // localStorage key for the persisted high score

  /**
   * Resize the canvas to the window, apply DPR scaling, and clamp entities to the new playfield.
   */
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
    if (scale < MIN_SCALE) scale = MIN_SCALE;
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

  // ============================================================
  //  Configuration — base constants & scale-derived values
  // ============================================================
  const BASE = { GROUND_H: 96, GRAVITY: 0.45, FLAP: -7.8, MAX_FALL: 11, PIPE_W: 62, PIPE_GAP: 158, PIPE_SPEED: 2.3, PIPE_SPACING: 220, BIRD_X: 92, BIRD_R: 13, BIRD_W: 34 };

  // Scale/layout tuning (see applyScale / resize).
  const MIN_SCALE = 0.45;     // smallest allowed downscale so the game stays playable on tiny screens
  const MIN_BIRD_X = 60;      // floor for the bird's x so it never hugs the left edge at low scale
  const BIRD_X_FRAC = 0.28;   // cap the bird's x at 28% of the playfield width
  let scale = 1;
  let GROUND_H = BASE.GROUND_H, PLAY_H = BASE_H - BASE.GROUND_H;
  let GRAVITY = BASE.GRAVITY, FLAP = BASE.FLAP, MAX_FALL = BASE.MAX_FALL;
  let PIPE_W = BASE.PIPE_W, PIPE_GAP = BASE.PIPE_GAP, PIPE_SPEED = BASE.PIPE_SPEED, PIPE_SPACING = BASE.PIPE_SPACING;
  let BIRD_X = BASE.BIRD_X, BIRD_R = BASE.BIRD_R, BIRD_W = BASE.BIRD_W;

  /**
   * Recompute all scale-derived gameplay/layout values from the current scale factor.
   */
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
    BIRD_X = Math.max(MIN_BIRD_X, Math.min(BASE.BIRD_X * scale, W * BIRD_X_FRAC));
    BIRD_R = BASE.BIRD_R * scale;
    BIRD_W = BASE.BIRD_W * scale;
  }

  const STATE = { START: 0, PLAYING: 1, OVER: 2 };

  // ============================================================
  //  DOM references (overlay / score / season UI elements)
  // ============================================================
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

  const SEASON_BLEND_POINTS = 4; // points over which two seasons' colors blend before the badge switches
  const TOAST_DURATION = 150;    // frames the season-change toast stays visible
  const PALETTES = {
    spring: { skyTop: "#9be7d6", skyBot: "#c9f5e7", grassTop: "#9ed866", grassBot: "#7cc24f", dirt: "#e6d9a0" },
    summer: { skyTop: "#4ec0ca", skyBot: "#8fe0e6", grassTop: "#6fbf1a", grassBot: "#4f9e10", dirt: "#ded895" },
    autumn: { skyTop: "#ffb073", skyBot: "#ffd9a8", grassTop: "#d6a23a", grassBot: "#a9792a", dirt: "#cdb98e" },
    winter: { skyTop: "#8fb4d6", skyBot: "#d8e8f5", grassTop: "#cfd8e0", grassBot: "#aab4bf", dirt: "#dde2e6" },
  };

  /**
   * Parse a #rrggbb (or #rgb) hex string into an {r,g,b} object.
   * @returns {{r:number,g:number,b:number}}
   */
  function hexToRgb(h) {
    h = h.replace("#", "");
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    const n = parseInt(h, 16);
    return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
  }
  /**
   * Linear interpolation between a and b by t.
   * @param {number} a
   * @param {number} b
   * @param {number} t
   * @returns {number}
   */
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Season palettes are static, so parse each hex → RGB once at init instead of
  // re-parsing on every blend. Blends then do only integer arithmetic and emit
  // the same "rgb(r,g,b)" string shape that drawSky/drawGround expect.
  const PALETTES_RGB = {};
  for (let pi = 0; pi < SEASONS.length; pi++) {
    const key = SEASONS[pi], src = PALETTES[key], out = PALETTES_RGB[key] = {};
    for (const ck in src) { if (Object.prototype.hasOwnProperty.call(src, ck)) out[ck] = hexToRgb(src[ck]); }
  }
  /**
   * Format an {r,g,b} object as an "rgb(r,g,b)" CSS color string.
   * @returns {string}
   */
  function rgbStr(c) { return "rgb(" + c.r + "," + c.g + "," + c.b + ")"; }
  /**
   * Blend two {r,g,b} colors by t and return an "rgb(r,g,b)" string.
   * @param {{r:number,g:number,b:number}} a
   * @param {{r:number,g:number,b:number}} b
   * @param {number} t
   * @returns {string}
   */
  function blendColor(a, b, t) {
    return rgbStr({ r: Math.round(lerp(a.r, b.r, t)),
                    g: Math.round(lerp(a.g, b.g, t)),
                    b: Math.round(lerp(a.b, b.b, t)) });
  }

  // Returns blended palette for current score + dominant season index.
  // Pure function of `score`, so it is cached in `seasonCache` and recomputed
  // only when the score changes (scoring path + resetGame) — never per frame.
  /**
   * Return the blended palette + dominant season index for a score.
   * @param {number} scoreVal
   * @returns {{palette:Object,index:number}}
   */
  function getSeason(scoreVal) {
    let i = 0;
    while (i < SEASON_SCORES.length - 1 && scoreVal >= SEASON_SCORES[i + 1]) i++;
    let a = i, b = i, t = 0;
    if (i < SEASON_SCORES.length - 1) {
      const end = SEASON_SCORES[i + 1];
      if (scoreVal >= end - SEASON_BLEND_POINTS) {
        a = i; b = i + 1;
        t = (scoreVal - (end - SEASON_BLEND_POINTS)) / SEASON_BLEND_POINTS;
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

  /**
   * Show the season-change toast for the given season index.
   * @param {number} seasonIndex
   */
  function showSeasonToast(seasonIndex) {
    toastEl.textContent = SEASONS[seasonIndex].toUpperCase();
    toastEl.classList.add("show");
    toastEl.classList.remove("hidden");
    toastTimer = TOAST_DURATION;
  }
  /**
   * Advance the toast timer and hide it when it expires.
   * @param {number} dt
   */
  function updateToast(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) { toastEl.classList.remove("show"); toastEl.classList.add("hidden"); }
    }
  }
  /**
   * Set the season badge text to the given season name.
   * @param {number} seasonIndex
   */
  function setSeasonBadge(seasonIndex) { seasonTagEl.textContent = SEASONS[seasonIndex].toUpperCase(); }

  // ============================================================
  //  Particles — seasonal ambient effects
  // ============================================================
  // Ambient particle tuning.
  const PARTICLE_TARGET_COUNT = 36;  // desired ambient particle count at full scale
  const PARTICLE_MAX_RATIO = 1.6;    // hard cap on particles before excess are recycled
  const PARTICLE_SPAWN_Y = -20;      // top spawn offset (above the visible area)
  const PARTICLE_SPAWN_SPREAD = 60; // random extra height above the top for spawns
  const PARTICLE_SWAY_STEP = 0.03;   // sway phase advanced per frame
  const PARTICLE_SWAY_AMP = 0.8;    // horizontal sway amplitude, in scale units
  const PARTICLE_ROT_MULT = 2;      // multiplier on particle rotation speed
  const PARTICLE_CULL_Y = 30;       // bottom margin past which particles are recycled
  const PARTICLE_CULL_X = 40;       // side margins past which particles are recycled
  const AMBIENT_SPAWN_CHANCE = 0.25; // per-frame chance (scaled by dt) to add a particle while playing
  const OVER_SPAWN_CHANCE = 0.1;    // lower ambient spawn chance on the game-over screen
  const PETAL_COLORS = ["#ffc0cb", "#ffd1dc", "#ffb6c1", "#ffe0ec"];
  const POLLEN_COLORS = ["#fff3a0", "#ffe066", "#fff0b3"];
  const LEAF_COLORS = ["#d2691e", "#e8870b", "#c0392b", "#b5651d", "#cd7f32"];
  const SNOW_COLOR = "#ffffff";
  const PARTICLE_KINDS = { spring: "petal", summer: "pollen", autumn: "leaf", winter: "snow" };
  let particles = [];
  let particleKind = "petal";

  /**
   * Return a random element from an array.
   * @param {Array} arr
   * @returns {*} the chosen element
   */
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /** Filter predicate keeping particles of the active kind.
   * @param {Object} p particle to test
   * @returns {boolean} */
  function isParticleOfKind(p) { return p.kind === particleKind; }
  /**
   * Create one ambient particle of the given kind at a random top-of-screen position.
   * @param {string} kind
   * @returns {Object} the new particle
   */
  function spawnParticle(kind) {
    const x = Math.random() * W;
    const y = PARTICLE_SPAWN_Y - Math.random() * PARTICLE_SPAWN_SPREAD;
    const s = scale;
    if (kind === "petal") {
      return { kind: kind, x: x, y: y, vx: -0.3*s+Math.random()*0.4*s, vy: 0.5*s+Math.random()*0.6*s,
               size: 5*s+Math.random()*4*s, rot: Math.random()*TAU, vrot: (Math.random()-0.5)*0.05,
               sway: Math.random()*TAU, color: pick(PETAL_COLORS) };
    }
    if (kind === "pollen") {
      return { kind: kind, x: x, y: y, vx: 0.4*s+Math.random()*0.5*s, vy: 0.2*s+Math.random()*0.3*s,
               size: 2*s+Math.random()*2.5*s, sway: Math.random()*TAU, color: pick(POLLEN_COLORS) };
    }
    if (kind === "leaf") {
      return { kind: kind, x: x, y: y, vx: -0.5*s+Math.random()*0.3*s, vy: 0.6*s+Math.random()*0.8*s,
               size: 7*s+Math.random()*6*s, rot: Math.random()*TAU, vrot: (Math.random()-0.5)*0.08,
               sway: Math.random()*TAU, color: pick(LEAF_COLORS) };
    }
    return { kind: "snow", x: x, y: y, vx: -0.2*s+Math.random()*0.4*s, vy: 0.4*s+Math.random()*0.7*s,
             size: 2.5*s+Math.random()*3.5*s, sway: Math.random()*TAU, color: SNOW_COLOR };
  }

  /**
   * Keep the particle list near its target count, recycling changed kinds.
   */
  function ensureParticles() {
    const target = Math.round(PARTICLE_TARGET_COUNT * Math.min(1, scale));
    particles = particles.filter(isParticleOfKind);
    while (particles.length < target) particles.push(spawnParticle(particleKind));
    while (particles.length > target * PARTICLE_MAX_RATIO) particles.shift();
  }

  /**
   * Occasionally spawn an extra ambient particle, scaled by dt.
   * @param {number} dt
   */
  function spawnAmbient(dt) {
    if (Math.random() < AMBIENT_SPAWN_CHANCE * dt) particles.push(spawnParticle(particleKind));
  }

  /**
   * Advance particle motion, sway, and rotation; cull off-screen ones.
   * @param {number} dt
   */
  function updateParticles(dt) {
    const s = scale;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.sway += PARTICLE_SWAY_STEP * dt;
      p.x += (p.vx + Math.sin(p.sway) * PARTICLE_SWAY_AMP * s) * dt;
      p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += p.vrot * dt * PARTICLE_ROT_MULT;
      if (p.y > H + PARTICLE_CULL_Y || p.x < -PARTICLE_CULL_X || p.x > W + PARTICLE_CULL_X) particles.splice(i, 1);
    }
  }

  // Lookup table instead of a per-particle if/else string chain (≈36 draws/frame).
  const PARTICLE_DRAWERS = { petal: drawPetal, pollen: drawPollen, leaf: drawLeaf, snow: drawSnow };
  /**
   * Render every active particle via its kind's drawer.
   */
  function drawParticles() {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      (PARTICLE_DRAWERS[p.kind] || drawSnow)(p);
    }
  }
  /**
   * Draw a spring petal particle.
   * @param {Object} p
   */
  function drawPetal(p) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.color; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size*0.55, 0, 0, TAU); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }
  /**
   * Draw a summer pollen particle.
   * @param {Object} p
   */
  function drawPollen(p) {
    ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = p.color;
    ctx.shadowColor = p.color; ctx.shadowBlur = 6 * scale;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }
  /**
   * Draw an autumn leaf particle.
   * @param {Object} p
   */
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
  /**
   * Draw a winter snow particle.
   * @param {Object} p
   */
  function drawSnow(p) {
    ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }

  // ============================================================
  //  Game state — data & lifecycle
  // ============================================================
  let state = STATE.START;
  let bird, pipes, groundX, score, best, frames, flash, flapAnim;

  // ============================================================
  //  Input handling — keyboard, mouse & touch flaps
  // ============================================================
  /** Keyboard flap handler for Space / ArrowUp.
   * @param {KeyboardEvent} e */
  function onKeyFlap(e) {
    if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); onFlap(); }
  }
  /** Mouse-press flap handler.
   * @param {MouseEvent} e */
  function onMouseDown(e) { e.preventDefault(); onFlap(); }
  /** Touch-start flap handler.
   * @param {TouchEvent} e */
  function onTouchStart(e) { e.preventDefault(); onFlap(); }
  /**
   * Handle a flap input depending on the current game state.
   */
  function onFlap() {
    if (state === STATE.START) { startGame(); }
    if (state === STATE.PLAYING) { bird.vy = FLAP; flapAnim = 1; }
    if (state === STATE.OVER) return;
  }
  window.addEventListener("keydown", onKeyFlap);
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("restart-btn").addEventListener("click", startGame);

  
  // ============================================================
  //  Game state transitions — reset / start / game over
  // ============================================================
  /**
   * Reset all gameplay state to a fresh start configuration.
   */
  function resetGame() {
    bird = { x: BIRD_X, y: PLAY_H / 2, vy: 0, rot: 0 };
    pipes = [];
    pipes.push(makePipe(W + PIPE_INIT_OFFSET));
    groundX = 0; score = 0; frames = 0; flash = 0; flapAnim = 0;
    liveScoreEl.textContent = "0";
    lastSeasonIndex = 0;
    particleKind = PARTICLE_KINDS.spring;
    particles = [];
    setSeasonBadge(0);
    seasonCache = getSeason(score);   // score just reset to 0 → spring palette
    ensureParticles();
  }
  /**
   * Begin a new run: reset, switch to PLAYING, and show the HUD.
   */
  function startGame() {
    resetGame();
    state = STATE.PLAYING;
    startScreen.classList.add("hidden");
    overScreen.classList.add("hidden");
    liveScoreEl.classList.remove("hidden");
    seasonTagEl.classList.remove("hidden");
    bird.vy = FLAP;
  }
  /**
   * End the run: switch to OVER, persist best score, show the game-over screen.
   */
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
  /**
   * Create a pipe pair at column x with a random gap position.
   * @param {number} x
   * @returns {Object} the new pipe
   */
  function makePipe(x) {
    const margin = PIPE_MARGIN * scale;
    const gapTop = margin + Math.random() * (PLAY_H - PIPE_GAP - margin * 2);
    return { x: x, gapTop: gapTop, gapBottom: gapTop + PIPE_GAP, scored: false };
  }

  // ============================================================
  //  Update — physics, spawning & collisions
  // ============================================================
  // Physics & motion tuning (all values scaled at runtime via applyScale()/dt).
  const FLAP_PITCH = -0.45;        // upward pitch angle while rising
  const ROT_VELOCITY_SLOPE = 0.08; // how strongly fall speed tilts the bird down
  const ROT_LERP = 0.18;           // per-frame easing toward the target rotation
  const FLAP_ANIM_DECAY = 0.12;    // how fast the flap-wing animation settles
  const OVER_GRAVITY_MULT = 2;     // gravity multiplier after death (bird drops faster)
  const OVER_FALL_BOOST = 4;       // extra terminal-velocity boost after death, in scale units
  const OVER_ROT_SPEED = 0.12;     // nose-dive rotation speed after death
  const FLASH_DECAY = 0.04;        // per-frame decay of the death flash overlay
  const BOB_FREQ = 0.08;           // start-screen hover frequency
  const BOB_AMP = 8;               // start-screen hover amplitude, in scale units
  const PIPE_CULL_PAD = 10;        // pixels a pipe must clear the left edge before recycling
  const PIPE_SPAWN_OFFSET = 20;    // x offset past the right edge where new pipes enter
  const PIPE_INIT_OFFSET = 60;     // x offset of the first pipe at reset
  const GROUND_TILE_W = 24;        // ground scroll/mound tile width, in base units
  /**
   * Advance one simulation step: physics, spawns, scoring, collisions.
   * @param {number} dt frame-scaled timestep
   */
  function update(dt) {
    frames++;
    if (state === STATE.PLAYING) {
      groundX = (groundX - PIPE_SPEED * dt) % (GROUND_TILE_W * scale);
    }
    if (state !== STATE.OVER) { spawnAmbient(dt); }
    else if (Math.random() < OVER_SPAWN_CHANCE * dt) { particles.push(spawnParticle(particleKind)); }
    updateParticles(dt);
    ensureParticles();
    updateToast(dt);

    if (state === STATE.START) {
      bird.y = PLAY_H / 2 + Math.sin(frames * BOB_FREQ) * BOB_AMP * scale;
      bird.rot = 0;
      return;
    }
    if (state === STATE.OVER) {
      if (bird.y + BIRD_R < PLAY_H) {
        bird.vy = Math.min(bird.vy + GRAVITY * OVER_GRAVITY_MULT * dt, MAX_FALL + OVER_FALL_BOOST * scale);
        bird.y += bird.vy * dt;
        bird.rot = Math.min(bird.rot + OVER_ROT_SPEED * dt, Math.PI / 2);
      }
      if (flash > 0) flash = Math.max(0, flash - FLASH_DECAY * dt);
      return;
    }

    // PLAYING
    bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
    bird.y += bird.vy * dt;
    const targetRot = bird.vy < 0 ? FLAP_PITCH : Math.min(bird.vy * ROT_VELOCITY_SLOPE, Math.PI / 2);
    bird.rot += (targetRot - bird.rot) * ROT_LERP * dt;
    if (flapAnim > 0) flapAnim = Math.max(0, flapAnim - FLAP_ANIM_DECAY * dt);

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
      if (p.x + PIPE_W < -PIPE_CULL_PAD) pipes.splice(i, 1);
      if (hitsPipe(p)) { gameOver(); return; }
    }
    const last = pipes[pipes.length - 1];
    if (last.x < W - PIPE_SPACING) pipes.push(makePipe(W + PIPE_SPAWN_OFFSET));
    if (bird.y - BIRD_R < 0) { bird.y = BIRD_R; bird.vy = 0; }
    if (bird.y + BIRD_R >= PLAY_H) { bird.y = PLAY_H - BIRD_R; gameOver(); }
  }

  // Takes the current season index as an explicit parameter so the caller's
  // obligation to refresh seasonCache first is visible, not hidden.
  /**
   * Switch particle kind, badge, and toast when the season index changes.
   * @param {number} si current season index
   */
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

  /**
   * Test whether the bird overlaps the gap edges of a pipe.
   * @param {Object} p
   * @returns {boolean}
   */
  function hitsPipe(p) {
    const overlapX = bird.x + BIRD_R > p.x && bird.x - BIRD_R < p.x + PIPE_W;
    const overlapY = bird.y - BIRD_R < p.gapTop || bird.y + BIRD_R > p.gapBottom;
    return overlapX && overlapY;
  }

  // ============================================================
  //  Render — sky, clouds, particles, pipes, ground, bird, flash
  // ============================================================
  // Render tuning constants (aesthetic spacing, in base/scaled units).
  const CLOUD_SCROLL_SPEED = 0.2;   // clouds drift left this many px per frame at scale 1
  const CLOUD_WRAP_PX = 120;         // horizontal wrap distance for cloud recycling
  const CLOUD_REPOSITION_PX = 60;   // off-screen left threshold before a cloud wraps
  const PIPE_LIP_H = 26;            // pipe lip/flare height, in base units
  const PIPE_LIP_OVER = 4;          // pipe lip horizontal overhang, in base units
  const WOOD_SEAM_SPACING = 22;     // vertical plank seam spacing
  const WOOD_GRAIN_SPACING = 14;    // horizontal wood-grain line spacing
  const CONCRETE_JOINT = 34;        // concrete cast-joint spacing
  const CONCRETE_SPECKLE_SPACING = 11; // concrete speckle row spacing
  const BRICK_H = 12;               // brick course height
  const BRICK_GAP = 2;              // mortar gap between bricks
  const BRICK_W = 26;               // brick width
  const ICE_FACET_SPACING = 16;     // ice crystal facet spacing
  const GRASS_STRIP_H = 26;         // grass strip height at the top of the ground
  /**
   * Render the whole frame: sky, clouds, particles, pipes, ground, bird, flash.
   */
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

  /**
   * Paint the vertical sky gradient.
   * @param {Object} palette season palette
   */
  function drawSky(palette) {
    const g = ctx.createLinearGradient(0, 0, 0, PLAY_H);
    g.addColorStop(0, palette.skyTop);
    g.addColorStop(1, palette.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, PLAY_H);
  }

  const clouds = [ { x: 60, y: 90, s: 1.0 }, { x: 250, y: 140, s: 0.7 }, { x: 330, y: 60, s: 0.85 } ];
  /**
   * Draw and slowly scroll the parallax clouds.
   */
  function drawClouds() {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const s = scale;
    for (const c of clouds) {
      let cx = (c.x * s - frames * CLOUD_SCROLL_SPEED * s) % (W + CLOUD_WRAP_PX * s);
      if (cx < -CLOUD_REPOSITION_PX * s) cx += W + CLOUD_WRAP_PX * s;
      drawCloud(cx, c.y * s, c.s * s);
    }
  }
  /**
   * Draw a single fluffy cloud at (x,y) scaled by s.
   * @param {number} x
   * @param {number} y
   * @param {number} s
   */
  function drawCloud(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 18*s, 0, TAU); ctx.arc(x+20*s, y+4*s, 22*s, 0, TAU);
    ctx.arc(x+44*s, y, 16*s, 0, TAU); ctx.arc(x+22*s, y-10*s, 16*s, 0, TAU);
    ctx.fill();
  }

  /**
   * Render every pipe using the current season's material style.
   * @param {number} index season index
   */
  function drawPipes(index) {
    const style = PIPE_STYLES[index];
    for (const p of pipes) {
      drawPipe(p.x, 0, PIPE_W, p.gapTop, true, style);
      drawPipe(p.x, p.gapBottom, PIPE_W, PLAY_H - p.gapBottom, false, style);
    }
  }
  const PIPE_DRAWERS = { wood: drawWoodPipe, concrete: drawConcretePipe, brick: drawBrickPipe, ice: drawIcePipe };
  /**
   * Render one pipe segment by dispatching to its material drawer.
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {boolean} isTop
   * @param {string} style
   */
  function drawPipe(x, y, w, h, isTop, style) {
    (PIPE_DRAWERS[style] || drawIcePipe)(x, y, w, h, isTop);
  }

  // Shared lip geometry so every material has the same opening shape/hitbox.
  /**
   * Compute the shared lip geometry (height, overhang, position) for a pipe.
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {boolean} isTop
   * @returns {Object}
   */
  function pipeLipGeom(x, y, w, h, isTop) {
    const s = scale;
    const lipH = PIPE_LIP_H * s, lipOver = PIPE_LIP_OVER * s;
    return { lipH: lipH, lipY: isTop ? y + h - lipH : y, lipX: x - lipOver, lipW: w + lipOver * 2 };
  }

  // ---- Spring: wooden pipe (planks + grain) ----
  /**
   * Draw the spring wooden pipe (planks + grain).
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {boolean} isTop
   */
  function drawWoodPipe(x, y, w, h, isTop) {
    const s = scale;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#6b4220"); g.addColorStop(0.5, "#8a5a2b"); g.addColorStop(1, "#6b4220");
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = "#4a2e15"; ctx.lineWidth = 1.5 * s;
    const seams = Math.max(1, Math.round(w / (WOOD_SEAM_SPACING * s)));
    for (let i = 1; i < seams; i++) { const sx = x + (w / seams) * i; ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx, y + h); ctx.stroke(); }
    ctx.strokeStyle = "#5a3818"; ctx.lineWidth = 1 * s; ctx.globalAlpha = 0.6;
    for (let gy = y + WOOD_GRAIN_SPACING * s; gy < y + h; gy += WOOD_GRAIN_SPACING * s) { ctx.beginPath(); ctx.moveTo(x + 2 * s, gy); ctx.lineTo(x + w - 2 * s, gy); ctx.stroke(); }
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
  /**
   * Draw the summer concrete pipe (cast joints + speckle).
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {boolean} isTop
   */
  function drawConcretePipe(x, y, w, h, isTop) {
    const s = scale;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#8a8f96"); g.addColorStop(0.5, "#b4b9c0"); g.addColorStop(1, "#7c8188");
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const joint = CONCRETE_JOINT * s;
    for (let jy = y + joint; jy < y + h; jy += joint) {
      ctx.strokeStyle = "#646a72"; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.moveTo(x, jy); ctx.lineTo(x + w, jy); ctx.stroke();
      ctx.strokeStyle = "#cdd2d8"; ctx.lineWidth = 1 * s;
      ctx.beginPath(); ctx.moveTo(x, jy - 1 * s); ctx.lineTo(x + w, jy - 1 * s); ctx.stroke();
    }
    ctx.fillStyle = "rgba(60,66,74,0.25)";
    for (let py = y + 6 * s; py < y + h; py += CONCRETE_SPECKLE_SPACING * s) { ctx.fillRect(x + 4 * s, py, 2 * s, 2 * s); ctx.fillRect(x + w - 8 * s, py + 5 * s, 2 * s, 2 * s); }
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
  /**
   * Draw the autumn brick pipe (offset courses + mortar).
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {boolean} isTop
   */
  function drawBrickPipe(x, y, w, h, isTop) {
    const s = scale;
    const bh = BRICK_H * s, gap = BRICK_GAP * s, bw = BRICK_W * s;
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
  /**
   * Draw the winter ice pipe (crystal facets + highlight).
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {boolean} isTop
   */
  function drawIcePipe(x, y, w, h, isTop) {
    const s = scale;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#9fc8e0"); g.addColorStop(0.4, "#cfe8f5"); g.addColorStop(1, "#8ab2cc");
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1.5 * s;
    const fac = ICE_FACET_SPACING * s;
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

  /**
   * Draw the ground band: dirt, grass strip, and scrolling mounds.
   * @param {Object} palette season palette
   */
  function drawGround(palette) {
    ctx.fillStyle = palette.dirt; ctx.fillRect(0, PLAY_H, W, GROUND_H);
    const g = ctx.createLinearGradient(0, PLAY_H, 0, PLAY_H + GRASS_STRIP_H * scale);
    g.addColorStop(0, palette.grassTop); g.addColorStop(1, palette.grassBot);
    ctx.fillStyle = g; ctx.fillRect(0, PLAY_H, W, GRASS_STRIP_H * scale);
    ctx.fillStyle = palette.dirt; ctx.fillRect(0, PLAY_H + GRASS_STRIP_H * scale, W, GROUND_H - GRASS_STRIP_H * scale);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    const tile = GROUND_TILE_W * scale;
    for (let i = -1; i < W / tile + 1; i++) {
      const gx = i * tile + groundX;
      ctx.beginPath();
      ctx.moveTo(gx, PLAY_H + 8*scale);
      ctx.lineTo(gx + 12*scale, PLAY_H + 18*scale);
      ctx.lineTo(gx + GROUND_TILE_W*scale, PLAY_H + 8*scale);
      ctx.lineTo(gx + GROUND_TILE_W*scale, PLAY_H + 4*scale);
      ctx.lineTo(gx, PLAY_H + 4*scale);
      ctx.closePath(); ctx.fill();
    }
  }

  const BIRD_DRAWERS = { songbird: drawSongbird, parrot: drawParrot, owl: drawOwl, penguin: drawPenguin };
  /**
   * Render the bird sprite for the current season.
   * @param {number} index season index
   */
  function drawBird(index) {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);
    (BIRD_DRAWERS[BIRD_STYLES[index]] || drawPenguin)();
    ctx.restore();
  }

  // ---- Spring bird: pink songbird with a little crest + cheek blush ----
  /**
   * Draw the spring pink songbird.
   */
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
    ctx.beginPath(); ctx.arc(CONCRETE_SPECKLE_SPACING * s, -5 * s, 3 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = "#ff9a4a"; ctx.strokeStyle = "#c75d12"; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(15 * s, -2 * s); ctx.lineTo(25 * s, 1 * s); ctx.lineTo(15 * s, 4 * s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // ---- Summer bird: yellow parrot with long tail + big toucan beak ----
  /**
   * Draw the summer yellow parrot with a toucan beak.
   */
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
    ctx.beginPath(); ctx.ellipse(3 * s, 7 * s, CONCRETE_SPECKLE_SPACING * s, 6 * s, 0, 0, TAU); ctx.fill();
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
  /**
   * Draw the autumn amber owl with ear tufts.
   */
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
  /**
   * Draw the winter penguin.
   */
  function drawPenguin() {
    const s = scale, R = BIRD_W / 2;
    ctx.fillStyle = "#2a3038";
    ctx.beginPath(); ctx.ellipse(0, 0, R, R - 1 * s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#10151a"; ctx.lineWidth = 2 * s; ctx.stroke();
    ctx.fillStyle = "#fffdf6";
    ctx.beginPath(); ctx.ellipse(1 * s, 3 * s, CONCRETE_SPECKLE_SPACING * s, 12 * s, 0, 0, TAU); ctx.fill();
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
    ctx.beginPath(); ctx.moveTo(1 * s, -3 * s); ctx.lineTo(CONCRETE_SPECKLE_SPACING * s, -1 * s); ctx.lineTo(1 * s, 1 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ff8a2a"; ctx.strokeStyle = "#c75d12"; ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.moveTo(-6 * s, R); ctx.lineTo(-9 * s, R + 5 * s); ctx.lineTo(-2 * s, R); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4 * s, R); ctx.lineTo(8 * s, R + 5 * s); ctx.lineTo(10 * s, R - 1 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // ============================================================
  //  Main game loop — update + render orchestration
  // ============================================================
  const MS_PER_FRAME = 1000 / 60; // convert elapsed ms to 60fps-normalized frame units
  const MAX_DT = 3;               // clamp giant frame gaps (tab switches) so nothing jumps
  /** Reset the frame clock when the tab becomes visible again. */
  function onVisibilityChange() {
    if (!document.hidden) last = performance.now();
  }
  let last = performance.now();
  // Reset the frame clock when the tab returns to the foreground, so the first
  // visible frame doesn't apply a huge clamped dt that jumps bird/pipes/particles.
  document.addEventListener("visibilitychange", onVisibilityChange);
  /**
   * Main rAF loop: compute dt, update, render, and schedule the next frame.
   * @param {number} now current timestamp from rAF
   */
  function loop(now) {
    let dt = (now - last) / MS_PER_FRAME;
    last = now;
    if (dt < 0) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ============================================================
  //  Scoring & persistence — localStorage best score
  // ============================================================
  /**
   * Load the persisted best score from localStorage (0 on failure).
   * @returns {number}
   */
  function loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; }
    catch (e) { console.error("loadBest failed", e); return 0; } // localStorage unavailable → start fresh at 0
  }
  /**
   * Persist the best score to localStorage, best-effort.
   * @param {number} v score to save
   */
  function saveBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); }
    catch (e) { console.error("saveBest failed", e); } // best-effort: persistence must never crash the game loop
  }
  // ============================================================
  //  Initialization — bootstrapping (load best, size, reset, start loop)
  // ============================================================
  best = loadBest();
  bestStartEl.textContent = best;
  resize();
  resetGame();
  requestAnimationFrame(loop);
})();
