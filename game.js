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
  const COIN_KEY = "flappy_coins";  // localStorage key for the persisted coin wallet
  const MUTE_KEY = "flappy_muted";  // localStorage key for the sound mute preference

  // ---- Lives, power-ups, coins & combos: tuning ----
  const LIFE_MAX = 5;               // starting lives per run
  const INVULN_FRAMES = 90;          // ~1.5s invulnerability grace after losing a life (60fps units)
  const COIN_R = 9;                  // coin radius in base units
  const POWERUP_R = 13;              // power-up pickup radius in base units
  const POWERUP_TYPES = ["shield", "slow", "magnet", "mini", "double"];
  const POWERUP_DUR = 360;           // ~6s duration for timed power-ups
  const POWERUP_COOLDOWN = 240;      // min frames between power-up spawns
  const SLOW_FACTOR = 0.45;          // world speed multiplier during slow-mo
  const MAGNET_RADIUS = 130;         // coin-attract radius in base units
  const MINI_SCALE = 0.62;           // bird render + hitbox scale during mini-bird
  const PERFECT_RADIUS = 16;         // gap-center distance (base) for a "perfect" pass
  const SHAKE_DECAY = 0.86;          // per-frame screen-shake decay (multiplicative)
  const CHEAT_CODE = "flyfly";       // typed sequence that toggles auto-pilot

  // Power-up metadata: emoji, label, HUD pill bar colour.
  const POWER_META = {
    shield: { icon: "🛡", label: "Shield",  bar: "#7fe3ff" },
    slow:   { icon: "⏱", label: "Slow-Mo", bar: "#ffd33f" },
    magnet: { icon: "🧲", label: "Magnet",  bar: "#ff8fc0" },
    mini:   { icon: "🔅", label: "Mini",    bar: "#ffe066" },
    double: { icon: "✨", label: "2× Score",bar: "#b08bff" }
  };
  // Medal tiers, lowest-priority last; first to match wins in medalFor().
  const MEDALS = [
    { name: "Platinum", min: 40, c1: "#e0f7ff", c2: "#7fe3ff", icon: "🏆" },
    { name: "Gold",     min: 25, c1: "#ffe066", c2: "#b5730f", icon: "🥇" },
    { name: "Silver",   min: 12, c1: "#e8e8e8", c2: "#9a9a9a", icon: "🥈" },
    { name: "Bronze",   min: 3,  c1: "#e68b3a", c2: "#7a3d12", icon: "🥉" }
  ];

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

  const STATE = { START: 0, PLAYING: 1, OVER: 2, PAUSED: 3 };

  // ============================================================
  //  DOM references (overlay / score / season / HUD / power-up UI)
  // ============================================================
  const startScreen = document.getElementById("start-screen");
  const overScreen  = document.getElementById("over-screen");
  const pauseScreen = document.getElementById("pause-screen");
  const liveScoreEl = document.getElementById("live-score");
  const finalScoreEl = document.getElementById("final-score");
  const finalBestEl  = document.getElementById("final-best");
  const finalCoinsEl = document.getElementById("final-coins");
  const finalComboEl = document.getElementById("final-combo");
  const bestStartEl  = document.getElementById("best-start");
  const seasonTagEl  = document.getElementById("season-tag");
  const toastEl      = document.getElementById("season-toast");
  const livesEl     = document.getElementById("lives");
  const coinsEl     = document.getElementById("coins");
  const hudLeftEl    = document.getElementById("hud-left");
  const hudRightEl   = document.getElementById("hud-right");
  const powerupBarEl = document.getElementById("powerup-bar");
  const autopilotTagEl = document.getElementById("autopilot-tag");
  const muteBtn    = document.getElementById("mute-btn");
  const pauseBtn   = document.getElementById("pause-btn");
  const resumeBtn  = document.getElementById("resume-btn");
  const medalEl     = document.getElementById("medal");
  const medalLabelEl = document.getElementById("medal-label");

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

  // New-system live state. See resetGame()/startGame() for (re)initialisation.
  let lives, invuln;                  // lives remaining + invulnerability countdown
  let runCoins, coinTotal;           // coins earned this run / persisted wallet
  let pickups;                        // active coins + power-up entities
  let combo, bestCombo;              // consecutive perfect passes / run peak
  let shield;                         // boolean: shield charge available
  let slowTimer, magnetTimer, miniTimer, doubleTimer;   // power-up timers (frames)
  let powerCooldown;                 // frames until a new power-up may spawn
  let popups;                         // floating text entries ("+1", "PERFECT")
  let bursts;                         // short-lived spark particles (coin/death fx)
  let shake;                          // current screen-shake intensity
  let autopilot;                      // cheat auto-pilot active?
  let cargo = "";                     // accumulated keypresses for cheat detection
  let muted = false;                  // sound muted (persisted via MUTE_KEY)

  // ============================================================
  //  Sound — synthesised Web Audio SFX (no asset files)
  // ============================================================
  // Browsers suspend AudioContext until a user gesture; resumeSfx() is called
  // from onFlap()/startGame() so the first tap unlocks audio.
  let actx = null;
  function getAudio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    return actx;
  }
  /** Play one synthesised tone with an optional frequency sweep.
   *  @param {Object} o {freq, freq2?, type?, dur?, vol?, delay?} */
  function tone(o) {
    if (muted) return;
    const ac = getAudio(); if (!ac || ac.state === "closed") return;
    const t0 = ac.currentTime + (o.delay || 0);
    const dur = o.dur || 0.15;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = o.type || "square";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freq2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(ac.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }
  /** Short filtered noise burst, for thuds / impacts. */
  function noiseBurst(dur, vol) {
    if (muted) return;
    const ac = getAudio(); if (!ac || ac.state === "closed") return;
    const t0 = ac.currentTime;
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource(); src.buffer = buf;
    const filt = ac.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 800;
    const g = ac.createGain(); g.gain.value = vol || 0.25;
    src.connect(filt); filt.connect(g); g.connect(ac.destination);
    src.start(t0);
  }
  /** Collection of named sound effects. */
  const SFX = {
    flap:   function () { tone({ freq: 520, freq2: 760, type: "square",  dur: 0.1,  vol: 0.12 }); },
    coin:   function () { tone({ freq: 988, freq2: 1480, type: "triangle", dur: 0.12, vol: 0.18 }); },
    score:  function (c) { const b = 660 + Math.min(c, 8) * 50; tone({ freq: b, freq2: b * 1.5, type: "triangle", dur: 0.13, vol: 0.16 }); },
    power:  function () { tone({ freq: 440, freq2: 990, type: "sawtooth", dur: 0.3, vol: 0.16 }); },
    season: function () { tone({ freq: 523, dur: 0.35, vol: 0.12, type: "triangle" }); tone({ freq: 659, dur: 0.35, vol: 0.12, type: "triangle", delay: 0.08 }); tone({ freq: 784, dur: 0.45, vol: 0.12, type: "triangle", delay: 0.16 }); },
    life:   function () { tone({ freq: 392, freq2: 130, type: "triangle", dur: 0.24, vol: 0.2 }); noiseBurst(0.12, 0.15); },
    brk:    function () { tone({ freq: 620, freq2: 200, type: "square", dur: 0.18, vol: 0.18 }); noiseBurst(0.1, 0.12); },
    over:   function () { tone({ freq: 330, freq2: 70, type: "sawtooth", dur: 0.5, vol: 0.22, delay: 0.05 }); },
    medal:  function () { tone({ freq: 784, dur: 0.15, vol: 0.18, type: "triangle" }); tone({ freq: 1047, dur: 0.3, vol: 0.18, type: "triangle", delay: 0.12 }); },
    pause:  function () { tone({ freq: 420, dur: 0.08, vol: 0.12, type: "square" }); }
  };
  /** Unlock the AudioContext on a user gesture. */
  function resumeSfx() { const ac = getAudio(); if (ac && ac.state === "suspended") ac.resume(); }

  // ============================================================
  //  Persistence helpers (best score, coin wallet, mute pref)
  // ============================================================
  function loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); }
    catch (e) { /* best-effort: persistence must never crash the game loop */ }
  }
  function loadCoins() { try { return parseInt(localStorage.getItem(COIN_KEY), 10) || 0; } catch (e) { return 0; } }
  function saveCoins(v) { try { localStorage.setItem(COIN_KEY, String(v)); } catch (e) { /* best-effort */ } }
  function loadMuted() { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { return false; } }
  function saveMuted(v) { try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch (e) { /* best-effort */ } }

  // ============================================================
  //  Lives, coins, pickups, power-ups, combos, juice, cheat
  // ============================================================
  /** Effective bird collision radius (shrinks while Mini is active). */
  function birdRadius() { return (miniTimer > 0) ? BIRD_R * MINI_SCALE : BIRD_R; }

  /** Return the medal earned for a given score, or null. */
  function medalFor(s) { for (let i = 0; i < MEDALS.length; i++) if (s >= MEDALS[i].min) return MEDALS[i]; return null; }

  /** Decide, for a freshly spawned pipe, whether to drop a coin or power-up. */
  function maybeSpawnPickup(pipe) {
    const cx = pipe.x + PIPE_W / 2;
    const cy = (pipe.gapTop + pipe.gapBottom) / 2;
    if (powerCooldown <= 0 && Math.random() < 0.22) {
      pickups.push({ kind: "power", type: POWERUP_TYPES[(Math.random() * POWERUP_TYPES.length) | 0], x: cx, y: cy, r: POWERUP_R * scale });
      powerCooldown = POWERUP_COOLDOWN;
    } else if (Math.random() < 0.55) {
      pickups.push({ kind: "coin", x: cx, y: cy, r: COIN_R * scale, bob: Math.random() * TAU });
    }
  }

  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const k = pickups[i];
      k.x -= PIPE_SPEED * dt;
      if (k.kind === "coin") { k.bob += 0.08 * dt; k.y += Math.sin(k.bob) * 0.5 * scale * dt; }
      if (k.x + k.r < -40) pickups.splice(i, 1);
    }
  }

  function collectPickups() {
    const r = birdRadius();
    if (magnetTimer > 0) {
      const mr = MAGNET_RADIUS * scale;
      for (const k of pickups) {
        if (k.dead) continue;
        const dx = bird.x - k.x, dy = bird.y - k.y, d = Math.hypot(dx, dy);
        if (d < mr && d > 0.1) { k.x += dx / d * 4 * scale; k.y += dy / d * 4 * scale; }
      }
    }
    for (let i = pickups.length - 1; i >= 0; i--) {
      const k = pickups[i];
      const d = Math.hypot(bird.x - k.x, bird.y - k.y);
      if (d < r + k.r) {
        if (k.kind === "coin") {
          runCoins++; coinsEl.textContent = "🪙 " + runCoins; SFX.coin(); spawnBurst(k.x, k.y, "#ffd33f", 10);
        } else {
          applyPowerup(k.type); SFX.power(); spawnBurst(k.x, k.y, (POWER_META[k.type] || POWER_META.shield).bar, 16);
        }
        pickups.splice(i, 1);
      }
    }
  }

  function applyPowerup(type) {
    if (type === "shield") shield = true;
    else if (type === "slow") slowTimer = POWERUP_DUR;
    else if (type === "magnet") magnetTimer = POWERUP_DUR;
    else if (type === "mini") miniTimer = POWERUP_DUR;
    else if (type === "double") doubleTimer = POWERUP_DUR;
    addPopup((POWER_META[type].label).toUpperCase() + "!", bird.x, bird.y - 24 * scale, (POWER_META[type]).bar);
  }

  function updatePowerHud() {
    let html = "";
    const pill = function (type, remaining) {
      const m = POWER_META[type];
      const pct = Math.max(0, remaining / POWERUP_DUR);
      html += '<div class="pu-pill bar-' + type + '"><span class="pu-icon">' + m.icon + '</span>' +
              '<span class="pu-name">' + m.label + '</span><span class="pu-time">' + Math.ceil(remaining / 60) + 's</span>' +
              '<span class="pu-bar" style="width:' + (pct * 100).toFixed(0) + '%"></span></div>';
    };
    if (shield) {
      const m = POWER_META.shield;
      html += '<div class="pu-pill bar-shield"><span class="pu-icon">' + m.icon + '</span><span class="pu-name">' + m.label + '</span><span class="pu-time">READY</span><span class="pu-bar" style="width:100%"></span></div>';
    }
    if (slowTimer > 0) pill("slow", slowTimer);
    if (magnetTimer > 0) pill("magnet", magnetTimer);
    if (miniTimer > 0) pill("mini", miniTimer);
    if (doubleTimer > 0) pill("double", doubleTimer);
    if (html) { powerupBarEl.classList.remove("hidden"); powerupBarEl.innerHTML = html; }
    else { powerupBarEl.classList.add("hidden"); powerupBarEl.innerHTML = ""; }
  }

  // ---- Floating text popups + spark bursts ----
  function addPopup(text, x, y, color) {
    popups.push({ text: text, x: x, y: y, vy: -1.2 * scale, life: 60, max: 60, color: color || "#fff" });
  }
  function updatePopups(dt) {
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i]; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) popups.splice(i, 1);
    }
  }
  function drawPopups() {
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold " + (16 * scale) + "px system-ui, sans-serif";
    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 3 * scale;
      ctx.strokeText(p.text, p.x, p.y); ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore(); ctx.globalAlpha = 1;
  }
  function spawnBurst(x, y, color, n) {
    const s = scale;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = (1 + Math.random() * 3) * s;
      bursts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 30 + Math.random() * 20, max: 50, color: color });
    }
  }
  function updateBursts(dt) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 0.15 * scale * dt; b.vx *= 0.96; b.life -= dt;
      if (b.life <= 0) bursts.splice(i, 1);
    }
  }
  function drawBursts() {
    for (const b of bursts) {
      ctx.globalAlpha = Math.max(0, b.life / b.max);
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, 3 * scale, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---- Damage / lives handling (replaces instant gameOver) ----
  /** Find the nearest pipe still in front of, or overlapping, the bird. */
  function nearestAheadPipe() {
    let best = null, bd = Infinity;
    for (const p of pipes) {
      if (p.x + PIPE_W < bird.x) continue;       // already fully behind the bird
      const d = p.x - bird.x;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  /** Handle a collision: shield absorbs it, else lose a life (+ grace), or game over. */
  function onHit(fromGround) {
    if (invuln > 0) return;                        // still inside grace window
    if (shield) {                                   // shield charge eats the hit
      shield = false; invuln = 36;
      shake = 6; SFX.brk(); spawnBurst(bird.x, bird.y, "#7fe3ff", 18);
      addPopup("SHIELD!", bird.x, bird.y - 22 * scale, "#7fe3ff");
      return;
    }
    lives--; updateLivesHud();
    shake = 11; SFX.life(); spawnBurst(bird.x, bird.y, "#ffd1dc", 16);
    combo = 0;
    if (lives <= 0) { gameOver(); return; }
    invuln = INVULN_FRAMES;                         // brief safety to recover
    if (fromGround) { bird.vy = FLAP * 0.8; }       // bounce off the ground
    else {
      const p = nearestAheadPipe();                  // nudge toward gap centre
      if (p) { const gc = (p.gapTop + p.gapBottom) / 2; bird.y += (gc - bird.y) * 0.25; }
      bird.vy = -2 * scale;
    }
  }

  /** Re-render the lives HUD (filled/lost hearts). */
  function updateLivesHud() {
    let html = "";
    for (let i = 0; i < LIFE_MAX; i++) html += '<span class="life-icon' + (i < lives ? "" : " lost") + '">❤</span>';
    livesEl.innerHTML = html;
  }

  // ---- Auto-pilot (cheat: type "flyfly") ----
  function toggleAutopilot() {
    autopilot = !autopilot;
    if (autopilot) { autopilotTagEl.classList.remove("hidden"); addPopup("AUTO-PILOT ON", bird.x, bird.y - 30 * scale, "#7fe3ff"); }
    else autopilotTagEl.classList.add("hidden");
  }
  /** Steer the bird through the next gap centre and (safely) scoop coins.
   *  Renders the bird collision-proof during auto-pilot: it targets the gap
   *  centre with a *gentle* flap (bounded overshoot ≈ 24px, well inside the
   *  ≈79px half-gap) and never detours toward a pipe edge. */
  function autoPilot() {
    const effR = birdRadius();
    // Nearest pipe the bird has not yet fully cleared.
    let target = null;
    for (const p of pipes) { if (p.x + PIPE_W > bird.x - effR) { target = p; break; } }
    const gapCenter = target ? (target.gapTop + target.gapBottom) / 2 : PLAY_H * 0.45;
    const gapBot = target ? target.gapBottom : PLAY_H;
    // Coins always spawn at the gap centre, so steering toward a nearby central
    // coin never pulls the bird toward a pipe edge — it just hones the centre.
    let ty = gapCenter;
    let bestCoin = null, bestDx = Infinity;
    for (const k of pickups) {
      if (k.kind !== "coin") continue;
      if (k.x < bird.x - effR || k.x > bird.x + 120 * scale) continue;     // ahead, within reach
      if (Math.abs(k.y - gapCenter) > 18 * scale) continue;                  // only central coins
      const dx = k.x - bird.x; if (dx < bestDx) { bestDx = dx; bestCoin = k; }
    }
    if (bestCoin) ty = bestCoin.y;
    // Flap line sits just below the target so the bird noses up to centre; the
    // gentle flap keeps oscillation inside ±24px and far from either edge.
    const flapLine = ty + 6 * scale;
    // Bottom danger net: if descending within ~32px of a pipe lip, flap early.
    const dangerBot = gapBot - effR - 32 * scale;
    if (bird.y > flapLine || (bird.vy > 0 && bird.y > dangerBot)) {
      bird.vy = FLAP * 0.6;
      flapAnim = 1;
    }
  }

  // ---- Medals + pause + mute ----
  function setMedal(s) {
    const m = medalFor(s);
    if (!m) { medalEl.className = "medal empty"; medalEl.textContent = "—"; medalLabelEl.textContent = "no medal"; return; }
    medalEl.className = "medal";
    medalEl.style.setProperty("--c1", m.c1);
    medalEl.style.setProperty("--c2", m.c2);
    medalEl.textContent = m.icon;
    medalLabelEl.textContent = m.name;
  }
  function togglePause() {
    if (state === STATE.PLAYING) { state = STATE.PAUSED; pauseScreen.classList.remove("hidden"); SFX.pause(); }
    else if (state === STATE.PAUSED) { state = STATE.PLAYING; pauseScreen.classList.add("hidden"); SFX.pause(); last = performance.now(); }
  }
  function toggleMute() {
    muted = !muted; saveMuted(muted);
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-label", muted ? "Unmute (M)" : "Mute (M)");
    if (!muted) resumeSfx();
  }

  // ============================================================
  //  Input handling — keyboard, mouse & touch flaps
  // ============================================================
  /** Keyboard handler: flap, pause, mute, and cheat-code typing.
   * @param {KeyboardEvent} e */
  function onKeyFlap(e) {
    // Capture letters for the "flyfly" cheat without interfering with action keys.
    if (e.key && e.key.length === 1 && /[a-z]/i.test(e.key)) {
      cargo = (cargo + e.key.toLowerCase()).slice(-CHEAT_CODE.length);
      if (cargo === CHEAT_CODE) { toggleAutopilot(); cargo = ""; return; }
    }
    if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); onFlap(); }
    else if (e.code === "KeyP" || e.code === "Escape") { e.preventDefault(); togglePause(); }
    else if (e.code === "KeyM") { e.preventDefault(); toggleMute(); }
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
    resumeSfx();                                   // unlock audio on first gesture
    if (state === STATE.START) { startGame(); return; }
    if (state === STATE.OVER) {
      // only restart on an explicit button press or Space (handled by onFlap path)
      return;
    }
    if (state === STATE.PAUSED) { togglePause(); return; }
    if (state === STATE.PLAYING) {
      if (autopilot) return;                      // auto-pilot ignores manual flaps
      bird.vy = FLAP; flapAnim = 1; SFX.flap();
    }
  }
  window.addEventListener("keydown", onKeyFlap);
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("restart-btn").addEventListener("click", startGame);
  resumeBtn.addEventListener("click", togglePause);
  pauseBtn.addEventListener("click", togglePause);
  muteBtn.addEventListener("click", toggleMute);

  
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

    // ---- New systems reset ----
    lives = LIFE_MAX; invuln = 0;
    runCoins = 0; coinsEl.textContent = "🪙 0";
    pickups = []; combo = 0; bestCombo = 0;
    shield = false; slowTimer = magnetTimer = miniTimer = doubleTimer = 0;
    powerCooldown = POWERUP_COOLDOWN;
    popups = []; bursts = []; shake = 0;
    autopilot = false; autopilotTagEl.classList.add("hidden");
    cargo = "";
    updateLivesHud();
    updatePowerHud();
  }
  /**
   * Begin a new run: reset, switch to PLAYING, and show the HUD.
   */
  function startGame() {
    resetGame();
    state = STATE.PLAYING;
    startScreen.classList.add("hidden");
    overScreen.classList.add("hidden");
    pauseScreen.classList.add("hidden");
    liveScoreEl.classList.remove("hidden");
    seasonTagEl.classList.remove("hidden");
    hudLeftEl.classList.remove("hidden");
    hudRightEl.classList.remove("hidden");
    bird.vy = FLAP;
    resumeSfx();
    SFX.flap();
  }
  /**
   * End the run: switch to OVER, persist best score, show the game-over screen.
   */
  function gameOver() {
    state = STATE.OVER;
    flash = 1;
    autopilotTagEl.classList.add("hidden");
    if (score > best) { best = score; saveBest(best); }
    coinTotal += runCoins; saveCoins(coinTotal);   // bank this run's coins
    if (combo > bestCombo) bestCombo = combo;
    setMedal(score);
    finalScoreEl.textContent = score;
    finalBestEl.textContent = best;
    finalCoinsEl.textContent = runCoins;
    finalComboEl.textContent = bestCombo;
    bestStartEl.textContent = best;
    liveScoreEl.classList.add("hidden");
    overScreen.classList.remove("hidden");
    hudLeftEl.classList.add("hidden");
    hudRightEl.classList.add("hidden");
    powerupBarEl.classList.add("hidden");
    seasonTagEl.classList.add("hidden");
    SFX.over();
    if (medalFor(score)) setTimeout(function () { SFX.medal(); }, 220);
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
    if (state === STATE.PAUSED) return;            // frozen: nothing advances while paused
    frames++;
    // Timers tick on REAL time so slow-mo doesn't extend itself or invuln.
    if (invuln > 0) invuln = Math.max(0, invuln - dt);
    if (slowTimer > 0) slowTimer = Math.max(0, slowTimer - dt);
    if (magnetTimer > 0) magnetTimer = Math.max(0, magnetTimer - dt);
    if (miniTimer > 0) miniTimer = Math.max(0, miniTimer - dt);
    if (doubleTimer > 0) doubleTimer = Math.max(0, doubleTimer - dt);
    if (powerCooldown > 0) powerCooldown = Math.max(0, powerCooldown - dt);
    if (shake > 0) shake *= Math.pow(SHAKE_DECAY, dt);

    // World motion runs at slow-mo speed while a Slow power-up is active.
    const sim = (slowTimer > 0 && state === STATE.PLAYING) ? dt * SLOW_FACTOR : dt;

    if (state === STATE.PLAYING) groundX = (groundX - PIPE_SPEED * sim) % (GROUND_TILE_W * scale);
    if (state !== STATE.OVER) spawnAmbient(sim);
    else if (Math.random() < OVER_SPAWN_CHANCE * dt) particles.push(spawnParticle(particleKind));
    updateParticles(sim);
    ensureParticles();
    updateToast(dt);
    updatePickups(sim);
    updatePopups(dt);
    updateBursts(dt);
    if (autopilot && state === STATE.PLAYING) autoPilot();

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
    const effR = birdRadius();
    bird.vy = Math.min(bird.vy + GRAVITY * sim, MAX_FALL);
    bird.y += bird.vy * sim;
    const targetRot = bird.vy < 0 ? FLAP_PITCH : Math.min(bird.vy * ROT_VELOCITY_SLOPE, Math.PI / 2);
    bird.rot += (targetRot - bird.rot) * ROT_LERP * sim;
    if (flapAnim > 0) flapAnim = Math.max(0, flapAnim - FLAP_ANIM_DECAY * sim);

    for (let i = pipes.length - 1; i >= 0; i--) {
      const p = pipes[i];
      p.x -= PIPE_SPEED * sim;
      if (!p.scored && p.x + PIPE_W / 2 < bird.x) {
        p.scored = true;
        score += (doubleTimer > 0) ? 2 : 1;
        // Perfect-pass combo: bonus + rising pitch when flying through the gap centre.
        const gapCenter = (p.gapTop + p.gapBottom) / 2;
        const dist = Math.abs(bird.y - gapCenter);
        if (dist < PERFECT_RADIUS * scale) {
          combo++; if (combo > bestCombo) bestCombo = combo;
          score += Math.min(combo, 5);
          addPopup("PERFECT x" + combo, p.x + PIPE_W / 2, gapCenter - 14 * scale, "#ffe066");
        } else { combo = 0; }
        liveScoreEl.textContent = score;
        seasonCache = getSeason(score);
        checkSeasonChange(seasonCache.index);
        SFX.score(combo);
        addPopup("+" + ((doubleTimer > 0) ? 2 : 1), p.x + PIPE_W / 2, gapCenter, "#ffffff");
      }
      if (p.x + PIPE_W < -PIPE_CULL_PAD) pipes.splice(i, 1);
      if (hitsPipe(p)) { onHit(false); if (state === STATE.OVER) return; }
    }

    collectPickups();

    const lp = pipes[pipes.length - 1];
    if (lp && lp.x < W - PIPE_SPACING) {
      const np = makePipe(W + PIPE_SPAWN_OFFSET);
      pipes.push(np);
      maybeSpawnPickup(np);
    }

    if (bird.y - effR < 0) { bird.y = effR; bird.vy = 0; }
    if (bird.y + effR >= PLAY_H) {
      if (invuln > 0) { bird.y = PLAY_H - effR; bird.vy = 0; }   // grace: clamp only
      else { bird.y = PLAY_H - effR; onHit(true); if (state === STATE.OVER) return; }
    }
    updatePowerHud();
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
      SFX.season();
    }
  }

  /**
   * Test whether the bird overlaps the gap edges of a pipe.
   * @param {Object} p
   * @returns {boolean}
   */
  function hitsPipe(p) {
    const r = birdRadius();
    const overlapX = bird.x + r > p.x && bird.x - r < p.x + PIPE_W;
    const overlapY = bird.y - r < p.gapTop || bird.y + r > p.gapBottom;
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
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawSky(seas.palette);
    drawClouds();
    drawParticles();
    drawPickups();
    drawPipes(seas.index);
    drawGround(seas.palette);
    // Shield / invulnerability glow ring.
    if (state === STATE.PLAYING && (invuln > 0 || shield)) {
      ctx.save(); ctx.globalAlpha = 0.55;
      ctx.strokeStyle = shield ? "#7fe3ff" : "#ffffff";
      ctx.lineWidth = 3 * scale;
      ctx.beginPath(); ctx.arc(bird.x, bird.y, birdRadius() + 6 * scale + Math.sin(frames * 0.3) * 2 * scale, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    const blink = (invuln > 0 && state === STATE.PLAYING && Math.floor(frames / 3) % 2 === 0) ? 0.45 : 1;
    ctx.globalAlpha = blink;
    drawBird(seas.index);
    ctx.globalAlpha = 1;
    drawBursts();
    drawPopups();
    ctx.restore();
    if (flash > 0) { ctx.fillStyle = "rgba(255,255,255," + flash + ")"; ctx.fillRect(0, 0, W, H); }
  }

  /** Render all coins + power-up pickups. */
  function drawPickups() {
    for (const k of pickups) {
      if (k.kind === "coin") {
        ctx.save(); ctx.translate(k.x, k.y);
        const g = ctx.createRadialGradient(-k.r * 0.3, -k.r * 0.3, k.r * 0.2, 0, 0, k.r);
        g.addColorStop(0, "#fff0a0"); g.addColorStop(1, "#f0a020");
        ctx.fillStyle = g; ctx.strokeStyle = "#a06010"; ctx.lineWidth = 1.5 * scale;
        ctx.beginPath(); ctx.arc(0, 0, k.r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#b5700a"; ctx.font = "bold " + (k.r * 1.1) + "px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("$", 0, k.r * 0.05);
        ctx.restore();
      } else {
        const meta = POWER_META[k.type] || POWER_META.shield;
        ctx.save(); ctx.translate(k.x, k.y);
        ctx.globalAlpha = 0.9;
        ctx.shadowColor = meta.bar; ctx.shadowBlur = 14 * scale;
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.beginPath(); ctx.arc(0, 0, k.r, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = meta.bar;
        ctx.beginPath(); ctx.arc(0, 0, k.r * 0.66, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.font = (k.r) + "px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(meta.icon, 0, 0);
        ctx.restore();
      }
    }
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
    if (miniTimer > 0) { ctx.scale(MINI_SCALE, MINI_SCALE); }
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
  /** Auto-pause when the tab is hidden; reset the frame clock on return. */
  function onVisibilityChange() {
    if (document.hidden) { if (state === STATE.PLAYING) togglePause(); }
    else { last = performance.now(); }
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
  //  Initialization — bootstrapping (load best/coins/mute, size, reset, loop)
  // ============================================================
  best = loadBest();
  coinTotal = loadCoins();
  muted = loadMuted();
  muteBtn.textContent = muted ? "🔇" : "🔊";
  muteBtn.setAttribute("aria-label", muted ? "Unmute (M)" : "Mute (M)");
  bestStartEl.textContent = best;
  resize();
  resetGame();
  requestAnimationFrame(loop);
})();
