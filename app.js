/**
 * app.js — MotionIQ Application Controller
 *
 * Autism-friendly features added:
 *  - Calm Mode: disables all flashing/pulsing animations
 *  - Child Mode: hides technical data, shows stars + big rep counter
 *  - Voice Cues: Web Speech API counts reps and gives encouragement
 *  - 3-2-1 Countdown: visual preparation before session starts
 *  - Social Story panel: step-by-step visual guide before exercise
 *  - Star reward system: one star per good rep, up to rep goal
 *  - Rep Goal progress bar: thin bar across top of camera
 *  - Congrats banner: shown when rep goal is reached
 *  - Amber feedback overlay: replaces red/flashing with gentle border
 *  - Picture cues: emoji pictograms alongside error text
 *  - Child Profile: saved per-child settings (name, tolerance, goal, audio)
 *  - Simplified phase labels: "Go down!" instead of "TRANSITION-DOWN"
 */

"use strict";

/* ─────────────────── DOM HELPERS ─────────────────── */
const $ = (id) => document.getElementById(id);
const navBtns = document.querySelectorAll('.nav-btn');

/* ─────────────────── CHILD PROFILE (persisted) ─────────────────── */
let childProfile = JSON.parse(localStorage.getItem('motioniq_child_profile') || JSON.stringify({
  name: '',
  repGoal: 10,
  romTolerance: 25,
  audioPref: 'voice',
  socialStory: '1',
}));

function loadChildProfileUI() {
  $('child-name').value           = childProfile.name        || '';
  $('child-rep-goal').value       = childProfile.repGoal     || 10;
  $('child-rom-tolerance').value  = childProfile.romTolerance || 25;
  $('child-audio-pref').value     = childProfile.audioPref   || 'voice';
  $('child-social-story').value   = childProfile.socialStory || '1';
}

$('btn-save-child-profile').addEventListener('click', () => {
  childProfile = {
    name:         $('child-name').value.trim(),
    repGoal:      parseInt($('child-rep-goal').value)      || 10,
    romTolerance: parseInt($('child-rom-tolerance').value) || 25,
    audioPref:    $('child-audio-pref').value,
    socialStory:  $('child-social-story').value,
  };
  localStorage.setItem('motioniq_child_profile', JSON.stringify(childProfile));
  $('child-profile-feedback').textContent = '✓ Child profile saved!';
  setTimeout(() => { $('child-profile-feedback').textContent = ''; }, 2500);
});

/* ─────────────────── ACCESSIBILITY TOGGLES ─────────────────── */
let calmMode  = false;
let childMode = false;
let audioMode = false;

$('toggle-calm').addEventListener('change', (e) => {
  calmMode = e.target.checked;
  document.body.classList.toggle('calm-mode', calmMode);
});

$('toggle-child').addEventListener('change', (e) => {
  childMode = e.target.checked;
  document.body.classList.toggle('child-mode', childMode);
  // When switching to child mode, load child profile into rep goal
  if (childMode) {
    $('rep-goal-input').value = childProfile.repGoal || 10;
    // Also apply calm mode if profile prefers it
    if (!calmMode) {
      calmMode = true;
      $('toggle-calm').checked = true;
      document.body.classList.add('calm-mode');
    }
  }
});

$('toggle-audio').addEventListener('change', (e) => {
  audioMode = e.target.checked;
});

/* ─────────────────── NAVIGATION ─────────────────── */
const Views = {
  home:    $('view-home'),
  admin:   $('view-admin'),
  session: $('view-session'),
  reports: $('view-reports'),
};

function showView(name) {
  Object.entries(Views).forEach(([key, el]) => {
    if (el) el.classList.toggle('active', key === name);
  });
  navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'session') return;
    showView(btn.dataset.view);
    if (btn.dataset.view === 'admin') {
      renderAdminList();
      loadChildProfileUI();
    }
    if (btn.dataset.view === 'reports') {
      if ($('report-user-select')) renderReportUserSelect();
    }
  });
});

/* ─────────────────── LIBRARY ─────────────────── */
function renderLibrary() {
  const grid = $('exercise-grid');
  grid.innerHTML = '';

  if (ExerciseRegistry.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🏋</div>
      <p>No exercises yet. Ask an admin to add some.</p>
    </div>`;
    return;
  }

  ExerciseRegistry.forEach((ex, idx) => {
    const card = document.createElement('div');
    card.className = 'ex-card';
    card.style.animationDelay = `${idx * 0.05}s`;

    const catClass = (ex.category || 'strength').toLowerCase();
    const thumbHTML = ex.videoDataUrl
      ? `<video src="${ex.videoDataUrl}" muted autoplay loop playsinline style="width:100%;height:140px;object-fit:cover;"></video>`
      : `<div class="ex-card-thumb" style="height:140px;display:flex;align-items:center;justify-content:center;font-size:3rem;background:var(--surface2);">${ex.emoji || '🏋'}</div>`;

    const romSummary = ex.rom
      ? Object.entries(ex.rom).map(([j, v]) => `${j}: ${v.bottom}–${v.top}°`).join(' · ')
      : '';

    card.innerHTML = `
      ${thumbHTML}
      <div class="ex-card-body">
        <div class="ex-card-name">${ex.name}</div>
        <div class="ex-card-meta">
          <span class="cat-pill ${catClass}">${ex.category}</span>
          ${ex.joints ? ex.joints.map(j => `<span class="cat-pill">${j}</span>`).join('') : ''}
        </div>
        ${romSummary ? `<div class="ex-card-rom">${romSummary}</div>` : ''}
      </div>`;

    card.addEventListener('click', () => startSession(ex));
    grid.appendChild(card);
  });
}

/* ─────────────────── ADMIN ─────────────────── */
let adminCapturedROM = {};
let adminVideoFile   = null;

$('video-upload').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  adminVideoFile = file;
  const preview = $('admin-video-preview');
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
  $('rom-capture-panel').style.display = 'block';
  adminCapturedROM = {};
  $('rom-display').innerHTML = '';
  $('capture-stats').textContent = '';
});

$('btn-capture-frame').addEventListener('click',  () => captureAdminFrame('top'));
$('btn-capture-bottom').addEventListener('click', () => captureAdminFrame('bottom'));

async function captureAdminFrame(position) {
  const videoEl  = $('admin-video-preview');
  const canvasEl = $('admin-canvas');
  $('capture-stats').textContent = 'Analysing pose…';

  const ctx = canvasEl.getContext('2d');
  canvasEl.width  = videoEl.videoWidth  || 480;
  canvasEl.height = videoEl.videoHeight || 320;
  ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

  const lm = await PoseEngine.captureFrameData(videoEl, canvasEl);
  if (!lm) {
    $('capture-stats').textContent = '⚠ No pose detected. Make sure the full body is visible.';
    return;
  }

  const jointAngleMap = {
    knee:     () => Math.round((PoseUtils.angle3(lm[LM.LEFT_HIP],lm[LM.LEFT_KNEE],lm[LM.LEFT_ANKLE])+PoseUtils.angle3(lm[LM.RIGHT_HIP],lm[LM.RIGHT_KNEE],lm[LM.RIGHT_ANKLE]))/2),
    hip:      () => Math.round((PoseUtils.angle3(lm[LM.LEFT_SHOULDER],lm[LM.LEFT_HIP],lm[LM.LEFT_KNEE])+PoseUtils.angle3(lm[LM.RIGHT_SHOULDER],lm[LM.RIGHT_HIP],lm[LM.RIGHT_KNEE]))/2),
    shoulder: () => Math.round((PoseUtils.angle3(lm[LM.LEFT_ELBOW],lm[LM.LEFT_SHOULDER],lm[LM.LEFT_HIP])+PoseUtils.angle3(lm[LM.RIGHT_ELBOW],lm[LM.RIGHT_SHOULDER],lm[LM.RIGHT_HIP]))/2),
    elbow:    () => Math.round((PoseUtils.angle3(lm[LM.LEFT_SHOULDER],lm[LM.LEFT_ELBOW],lm[LM.LEFT_WRIST])+PoseUtils.angle3(lm[LM.RIGHT_SHOULDER],lm[LM.RIGHT_ELBOW],lm[LM.RIGHT_WRIST]))/2),
    ankle:    () => Math.round((PoseUtils.angle3(lm[LM.LEFT_KNEE],lm[LM.LEFT_ANKLE],lm[LM.LEFT_FOOT_INDEX])+PoseUtils.angle3(lm[LM.RIGHT_KNEE],lm[LM.RIGHT_ANKLE],lm[LM.RIGHT_FOOT_INDEX]))/2),
  };

  const checked = [...document.querySelectorAll('#joint-checkboxes input:checked')].map(i => i.value);
  const toCapture = checked.length ? checked : Object.keys(jointAngleMap);

  toCapture.forEach(j => {
    if (!jointAngleMap[j]) return;
    if (!adminCapturedROM[j]) adminCapturedROM[j] = {};
    adminCapturedROM[j][position] = jointAngleMap[j]();
  });

  const bai = PoseUtils.symmetryBAI(lm);
  $('capture-stats').textContent = `✓ ${position === 'top' ? 'Top' : 'Bottom'} frame captured. BAI: ${bai}/100`;
  $('rom-display').innerHTML = Object.entries(adminCapturedROM).map(([j, a]) =>
    `<div class="rom-chip">${j}: ${Object.entries(a).map(([p,d])=>`${p}: ${d}°`).join(', ')}</div>`
  ).join('');
}

$('btn-save-exercise').addEventListener('click', saveExercise);

function saveExercise() {
  const name = $('ex-name').value.trim();
  if (!name) { $('save-feedback').textContent = '⚠ Please enter an exercise name.'; return; }

  const checked      = [...document.querySelectorAll('#joint-checkboxes input:checked')].map(i => i.value);
  const category     = $('ex-category').value;
  const repDirection = $('ex-rep-direction').value;
  const tolerance    = parseInt($('rom-tolerance').value) || 15;

  const rom = {};
  Object.entries(adminCapturedROM).forEach(([joint, angles]) => {
    rom[joint] = { top: angles.top ?? 170, bottom: angles.bottom ?? 90, label: joint.charAt(0).toUpperCase()+joint.slice(1)+' Angle' };
  });

  const primaryJoint = checked[0] || Object.keys(rom)[0] || 'knee';
  const topAngle     = rom[primaryJoint]?.top    ?? 170;
  const bottomAngle  = rom[primaryJoint]?.bottom ?? 90;
  const mid          = Math.round((topAngle + bottomAngle) / 2);

  const stateMachineBody = `
    var angle = angles['${primaryJoint}'] ?? 180;
    if (phase === 'up' && angle < ${mid + 10}) return 'transition-down';
    if (phase === 'transition-down' && angle < ${bottomAngle - tolerance}) return 'down';
    if (phase === 'down' && angle > ${mid - 10}) return 'transition-up';
    if (phase === 'transition-up' && angle > ${topAngle - tolerance}) return 'up';
    return null;
  `;
  const computeAnglesBody = `
    if (!lm || lm.length < 33) return {};
    var m = {
      knee: function(){return Math.round((PoseUtils.angle3(lm[23],lm[25],lm[27])+PoseUtils.angle3(lm[24],lm[26],lm[28]))/2);},
      hip: function(){return Math.round((PoseUtils.angle3(lm[11],lm[23],lm[25])+PoseUtils.angle3(lm[12],lm[24],lm[26]))/2);},
      elbow: function(){return Math.round((PoseUtils.angle3(lm[11],lm[13],lm[15])+PoseUtils.angle3(lm[12],lm[14],lm[16]))/2);},
      shoulder: function(){return Math.round((PoseUtils.angle3(lm[13],lm[11],lm[23])+PoseUtils.angle3(lm[14],lm[12],lm[24]))/2);},
    };
    var r = {};
    ${JSON.stringify(checked)}.forEach(function(j){if(m[j])r[j]=m[j]();});
    if(!Object.keys(r).length && m['${primaryJoint}'])r['${primaryJoint}']=m['${primaryJoint}']();
    return r;
  `;

  const config = {
    id: name.toLowerCase().replace(/\s+/g,'-')+'-'+Date.now(),
    name, category, emoji: categoryEmoji(category),
    joints: checked, rom, romTolerance: tolerance, repDirection,
    repStateMachine: stateMachineBody,
    validateForm: 'return { ok: true, errors: [], warnings: [] };',
    computeAngles: computeAnglesBody,
    videoDataUrl: null,
  };

  if (adminVideoFile) {
    const reader = new FileReader();
    reader.onload = (e) => { config.videoDataUrl = e.target.result; persistAndRegister(config); };
    reader.readAsDataURL(adminVideoFile);
  } else {
    persistAndRegister(config);
  }
}

function generateValidateRepBody(config) {
  // Generate validateRep function based on exercise ROM and rep direction
  const primaryJoint = Object.keys(config.rom || {})[0];
  if (!primaryJoint || !config.rom[primaryJoint]) {
    // No ROM data — just accept the rep
    return 'return { ok: true, errors: [] };';
  }
  
  const tolerance = config.romTolerance || 15;
  const topAngle = config.rom[primaryJoint].top;
  const bottomAngle = config.rom[primaryJoint].bottom;
  const minBottom = bottomAngle - tolerance;
  
  // Validate that the user reached near the bottom ROM
  // Return validation object with ok flag and errors array
  return `
    var errors = [];
    if (downAngles && downAngles['${primaryJoint}'] !== undefined) {
      var angle = downAngles['${primaryJoint}'];
      if (angle > ${minBottom}) {
        errors.push('Reach deeper — complete the full range of motion');
      }
    }
    return { ok: errors.length === 0, errors: errors };
  `;
}

function persistAndRegister(config) {
  const live = { ...config };
  live.repStateMachine = new Function('phase','angles','config', config.repStateMachine);
  live.validateForm    = new Function('angles','landmarks','config', config.validateForm);
  live.computeAngles   = new Function('lm', config.computeAngles);
  live.computeBAI      = PoseUtils.symmetryBAI;
  
  // Generate validateRep based on captured ROM and rep direction
  const validateRepBody = generateValidateRepBody(config);
  live.validateRep = new Function('downAngles', 'upAngles', 'config', validateRepBody);
  
  ExerciseRegistry.push(live);

  const persisted = JSON.parse(localStorage.getItem('motioniq_exercises') || '[]');
  persisted.push(config);
  try {
    localStorage.setItem('motioniq_exercises', JSON.stringify(persisted));
  } catch (e) {
    config.videoDataUrl = null;
    persisted[persisted.length-1] = config;
    try { localStorage.setItem('motioniq_exercises', JSON.stringify(persisted)); } catch(_) {}
  }

  $('save-feedback').textContent = `✓ "${config.name}" added to the library!`;
  $('ex-name').value = '';
  adminCapturedROM = {};
  $('rom-display').innerHTML = '';
  $('capture-stats').textContent = '';
  $('admin-video-preview').style.display = 'none';
  $('rom-capture-panel').style.display = 'none';
  renderAdminList();
  renderLibrary();
}

function categoryEmoji(cat) {
  return { Strength:'🏋', Flexibility:'🧘', Cardio:'🏃', Rehabilitation:'🩺', Balance:'⚖' }[cat] || '💪';
}

function renderAdminList() {
  const list = $('admin-exercise-list');
  $('ex-count').textContent = ExerciseRegistry.length;
  list.innerHTML = ExerciseRegistry.map((ex, idx) => `
    <div class="admin-ex-item">
      <div>
        <div class="admin-ex-item-name">${ex.emoji||''} ${ex.name}</div>
        <div class="admin-ex-item-meta">${ex.category} · ${ex.joints?.join(', ')||'—'}</div>
      </div>
      ${idx >= 4
        ? `<button class="btn-delete" data-idx="${idx}">Remove</button>`
        : '<span style="color:var(--muted);font-size:.7rem;">built-in</span>'}
    </div>`
  ).join('') || '<p style="color:var(--muted);font-size:.85rem;">No exercises yet.</p>';

  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const ex  = ExerciseRegistry[idx];
      ExerciseRegistry.splice(idx, 1);
      const persisted = JSON.parse(localStorage.getItem('motioniq_exercises')||'[]');
      const pi = persisted.findIndex(p => p.id === ex.id);
      if (pi >= 0) persisted.splice(pi, 1);
      localStorage.setItem('motioniq_exercises', JSON.stringify(persisted));
      renderAdminList();
      renderLibrary();
    });
  });
}

/* ─────────────────── VOICE CUES ─────────────────── */
const CHEERS = ['Amazing!', 'Keep going!', 'Fantastic!', 'Great job!', 'You got it!', 'Superstar!'];

function speak(text) {
  if (!audioMode) return;
  if (!window.speechSynthesis) return;
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate   = 0.92;
  utt.pitch  = childMode ? 1.2 : 1.0;
  utt.volume = 1;
  window.speechSynthesis.cancel(); // don't queue up
  window.speechSynthesis.speak(utt);
}

/* ─────────────────── COUNTDOWN ─────────────────── */
function runCountdown(onDone) {
  const overlay = $('countdown-overlay');
  const numEl   = $('countdown-number');
  const lblEl   = $('countdown-label');
  overlay.style.display = 'flex';

  const steps = [
    { n: '3', l: 'Get ready…' },
    { n: '2', l: 'Stand in frame!' },
    { n: '1', l: 'Almost…' },
    { n: 'GO!', l: "Let's do it!" },
  ];
  let i = 0;

  function tick() {
    if (i >= steps.length) {
      overlay.style.display = 'none';
      onDone();
      if (window._sessionStartHook) {
        window._sessionStartHook();
        delete window._sessionStartHook;
      }
      return;
    }
    const s = steps[i++];
    numEl.textContent = s.n;
    lblEl.textContent = s.l;
    // Reset animation
    numEl.style.animation = 'none';
    void numEl.offsetWidth;
    numEl.style.animation = '';
    if (audioMode) speak(s.n === 'GO!' ? "Let's go!" : s.n);
    setTimeout(tick, 900);
  }
  tick();
}

/* ─────────────────── SOCIAL STORY ─────────────────── */
function showSocialStory(exercise, onDone) {
  const panel = $('social-story-panel');
  const greeting = childProfile.name
    ? `Hi ${childProfile.name}! Let's do ${exercise.name}!`
    : `Let's do ${exercise.name}!`;
  $('story-greeting').textContent = greeting;
  panel.style.display = 'flex';

  if (audioMode) speak(greeting);

  $('btn-story-ok').onclick = () => {
    panel.style.display = 'none';
    onDone();
  };
}

/* ─────────────────── FEEDBACK PICTURE CUES ─────────────────── */
// Maps keywords in error messages to simple pictogram emojis
const PICTURE_CUES = {
  'knee':     '🦵',
  'squat':    '⬇️',
  'elbow':    '💪',
  'hip':      '🧍',
  'back':     '🔙',
  'chest':    '🫁',
  'arm':      '💪',
  'deeper':   '⬇️',
  'lower':    '⬇️',
  'raise':    '⬆️',
  'shoulder': '🫱',
  'straight': '📏',
  'hips':     '⚖',
  'plank':    '📏',
};

function getPictureCue(errorText) {
  const lower = errorText.toLowerCase();
  for (const [keyword, emoji] of Object.entries(PICTURE_CUES)) {
    if (lower.includes(keyword)) return emoji;
  }
  return '👀';
}

// Child-friendly rewrite of technical error messages
const CHILD_FRIENDLY = [
  { match: /squat deeper|knee angle/i,        text: 'Bend knees more' },
  { match: /hinge hip/i,                       text: 'Push hips back' },
  { match: /chest up|torso leaning/i,          text: 'Stand tall!' },
  { match: /knees.*forward/i,                  text: 'Knees behind toes' },
  { match: /extend.*arm|fully extend/i,        text: 'Straighten your arm' },
  { match: /curl all the way/i,                text: 'Curl arm up high' },
  { match: /elbow.*side/i,                     text: 'Keep elbow tucked' },
  { match: /lock out/i,                        text: 'Push all the way up' },
  { match: /lower chest/i,                     text: 'Go lower down' },
  { match: /hips level|straight plank/i,       text: 'Keep body straight' },
  { match: /raise.*shoulder height/i,          text: 'Lift arms higher' },
];

function simplifyError(text) {
  if (!childMode) return text;
  for (const rule of CHILD_FRIENDLY) {
    if (rule.match.test(text)) return rule.text;
  }
  // Fallback: take first 5 words
  return text.split(' ').slice(0, 5).join(' ');
}

/* ─────────────────── SESSION STATE ─────────────────── */
let sessionActive   = false;
let currentExercise = null;
let sessionReps     = 0;
let sessionSets     = 0;
let repGoal         = 10;
let repAccuracy     = { good: 0, bad: 0 };
let goalReached     = false;
let starCount       = 0;
let sessionFrameCount = 0;
let sessionBaiTotal = 0;
let sessionRomScoreTotal = 0;
let sessionRomFrameCount = 0;

function startSession(exercise) {
  currentExercise = exercise;
  sessionReps     = 0;
  sessionSets     = 0;
  repAccuracy     = { good: 0, bad: 0 };
  goalReached     = false;
  starCount       = 0;
  sessionFrameCount = 0;
  sessionBaiTotal = 0;
  sessionRomScoreTotal = 0;
  sessionRomFrameCount = 0;

  // Apply child profile ROM tolerance override
  if (childMode && childProfile.romTolerance) {
    exercise._originalTolerance  = exercise.romTolerance;
    exercise.romTolerance        = childProfile.romTolerance;
  }

  // Load rep goal
  repGoal = childMode
    ? (childProfile.repGoal || 10)
    : (parseInt($('rep-goal-input').value) || 10);
  $('rep-goal-input').value = repGoal;

  // Reset UI
  $('stat-reps').textContent     = '0';
  $('stat-sets').textContent     = '0';
  $('stat-accuracy').textContent = '–';
  $('form-tips').innerHTML       = '';
  $('feedback-overlay').style.display  = 'none';
  $('congrats-banner').style.display   = 'none';
  $('star-container').innerHTML        = '';
  $('rep-goal-bar').style.width        = '0%';
  $('phase-pill').textContent          = 'READY';
  $('btn-set-done').style.display      = 'none';

  // Reference video
  const refVid = $('reference-video');
  if (exercise.videoDataUrl) { refVid.src = exercise.videoDataUrl; refVid.style.display='block'; }
  else { refVid.style.display = 'none'; }

  $('session-exercise-name').textContent  = exercise.name;
  $('session-category-badge').textContent = exercise.category;
  $('session-category-badge').className   = `cat-badge ${(exercise.category||'').toLowerCase()}`;

  buildRomGauges(exercise);
  PoseEngine.setExercise(exercise);
  PoseEngine.init($('user-video'), $('pose-canvas'), {
    onFrame:       handleFrame,
    onRep:         handleRep,
    onPhaseChange: handlePhaseChange,
    onPoseStatus:  handlePoseStatus,
    onReset:       handleReset,
    onError:       handlePoseError,
  });

  showView('session');

  // Social story first (if child mode + preference set)
  if (childMode && childProfile.socialStory === '1') {
    showSocialStory(exercise, () => {
      // After story, start session automatically
      beginSession();
    });
  }
}

function buildRomGauges(exercise) {
  const container = $('rom-gauges');
  container.innerHTML = '';
  if (!exercise.rom) {
    container.innerHTML = '<p style="color:var(--muted);font-size:.78rem;">No ROM data.</p>';
    return;
  }
  Object.entries(exercise.rom).forEach(([joint, def]) => {
    const row = document.createElement('div');
    row.className = 'rom-gauge-row';
    row.innerHTML = `
      <div class="rom-gauge-label">
        <span>${def.label || joint}</span>
        <span id="gauge-val-${joint}">–</span>
      </div>
      <div class="rom-gauge-track">
        <div class="rom-gauge-fill" id="gauge-fill-${joint}" style="width:50%"></div>
      </div>`;
    container.appendChild(row);
  });
}

/* ─────────────────── POSE CALLBACKS ─────────────────── */
function handleFrame({ angles, bai, formResult, phase }) {
  // ROM gauges
  if (currentExercise?.rom) {
    Object.entries(angles).forEach(([joint, deg]) => {
      const fill = $(`gauge-fill-${joint}`);
      const val  = $(`gauge-val-${joint}`);
      if (!fill || !val) return;
      const def = currentExercise.rom[joint];
      if (def) {
        const rMin = Math.min(def.top, def.bottom);
        const rMax = Math.max(def.top, def.bottom);
        const pct  = PoseUtils.clamp(((deg-rMin)/(rMax-rMin))*100, 0, 100);
        fill.style.width = `${pct}%`;
        fill.classList.toggle('out-of-range',
          deg < rMin - currentExercise.romTolerance || deg > rMax + currentExercise.romTolerance);
      }
      val.textContent = `${deg}°`;
    });
  }

  // BAI
  $('bai-bar').style.width  = `${bai}%`;
  $('bai-label').textContent = `${bai}/100 — ${bai>75?'Good alignment':bai>50?'Moderate':'Improve posture'}`;

  if (sessionActive && currentExercise) {
    sessionFrameCount += 1;
    sessionBaiTotal += bai;
    if (currentExercise.rom) {
      const jointScores = Object.entries(currentExercise.rom).map(([joint, def]) => {
        const current = angles[joint];
        if (current === undefined) return null;
        const ideal = phase === 'up' || phase === 'transition-up'
          ? def.top
          : phase === 'down' || phase === 'transition-down'
            ? def.bottom
            : (def.top + def.bottom) / 2;
        const range = Math.max(1, Math.abs(def.top - def.bottom));
        const diff = Math.min(range, Math.abs(current - ideal));
        return Math.max(0, 100 - (diff / range) * 100);
      }).filter(v => v !== null);
      if (jointScores.length) {
        sessionRomScoreTotal += jointScores.reduce((sum, value) => sum + value, 0) / jointScores.length;
        sessionRomFrameCount += 1;
      }
    }
  }

  // Live form tips
  const tips = $('form-tips');
  if (formResult.errors.length || formResult.warnings.length) {
    const items = [
      ...formResult.errors.map(e   => `<li class="error">❌ ${simplifyError(e)}</li>`),
      ...formResult.warnings.map(w => `<li class="warn">⚠ ${simplifyError(w)}</li>`),
    ];
    tips.innerHTML = items.join('');

    if (formResult.errors.length && !goalReached) {
      const msg = simplifyError(formResult.errors[0]);
      $('feedback-overlay').style.display = 'flex';
      $('feedback-icon').textContent       = '💛';
      $('feedback-text').textContent       = msg;
      $('feedback-picture').textContent    = childMode ? getPictureCue(formResult.errors[0]) : '';
    } else {
      $('feedback-overlay').style.display = 'none';
    }
  } else {
    if (phase === 'down' || phase === 'transition-up') {
      tips.innerHTML = '<li class="ok">✓ Looking good — keep it up!</li>';
    } else {
      tips.innerHTML = '';
    }
    $('feedback-overlay').style.display = 'none';
  }

  const matchWrap = $('yoga-match-wrap');
  if (matchWrap && !_yogaRunning) {
    if (sessionActive && currentExercise) {
      const match = computeExerciseMatchScore(angles, phase, currentExercise);
      const matchPercent = $('yoga-match-percent');
      const matchDetail  = $('yoga-match-details');
      matchWrap.style.display = 'flex';
      if (matchPercent) matchPercent.textContent = `${match.matchPct}%`;
      if (matchDetail) matchDetail.textContent = match.details;
      if (matchPercent) {
        matchPercent.style.color = match.matchPct > 75
          ? '#4ade80' : match.matchPct > 40 ? '#fbbf24' : '#f87171';
      }
    } else {
      matchWrap.style.display = 'none';
    }
  }
}

function handleRep(repCount, isGood, errors) {
  if (isGood) {
    repAccuracy.good++;
    sessionReps++;
    $('stat-reps').textContent = sessionReps;

    // Star reward
    addStar();

    // Voice cue
    if (childMode) {
      // Say the number, occasionally add cheer
      const cheer = sessionReps % 5 === 0
        ? ` ${CHEERS[Math.floor(Math.random()*CHEERS.length)]}`
        : '';
      speak(`${sessionReps}${cheer}`);
    } else {
      if (sessionReps % 5 === 0) speak(CHEERS[Math.floor(Math.random()*CHEERS.length)]);
    }

    // Flash
    if (!calmMode) triggerRepFlash();

    // Phase pill
    $('phase-pill').textContent = childMode ? `⭐ ${sessionReps}!` : `REP ${sessionReps} ✓`;

    // Update goal bar
    updateGoalBar();

    // Check if goal reached
    if (sessionReps >= repGoal && !goalReached) {
      goalReached = true;
      showCongratsAndStop();
    }

    if (sessionReps >= 8) $('btn-set-done').style.display = '';
  } else {
    repAccuracy.bad++;
    if (errors.length && !goalReached) {
      const msg = simplifyError(errors[0]);
      $('feedback-overlay').style.display = 'flex';
      $('feedback-icon').textContent       = '💛';
      $('feedback-text').textContent       = msg;
      $('feedback-picture').textContent    = childMode ? getPictureCue(errors[0]) : '';
      setTimeout(() => { $('feedback-overlay').style.display = 'none'; }, 2200);
      if (childMode) speak(msg);
    }
  }

  const total = repAccuracy.good + repAccuracy.bad;
  if (total > 0) {
    $('stat-accuracy').textContent = `${Math.round((repAccuracy.good/total)*100)}%`;
  }
}

function handlePhaseChange(phase) {
  if (goalReached) return;
  // Child-friendly phase labels
  const childLabels = {
    'up':             'Stand up!',
    'transition-down':'Go down!',
    'down':           'Hold it!',
    'transition-up':  'Come up!',
  };
  const normalLabels = {
    'up':             'TOP',
    'transition-down':'GOING DOWN',
    'down':           'HOLD',
    'transition-up':  'GOING UP',
  };
  const labels = childMode ? childLabels : normalLabels;
  $('phase-pill').textContent = labels[phase] || phase.toUpperCase();
}

function handlePoseStatus(detected) {
  if (!detected) $('phase-pill').textContent = childMode ? 'Come closer! 👋' : 'STEP INTO FRAME';
}
function handleReset()      { $('stat-reps').textContent = '0'; }
function handlePoseError(m) { $('phase-pill').textContent = m; }

/* ─────────────────── STAR REWARDS ─────────────────── */
function addStar() {
  starCount++;
  const container = $('star-container');
  const star = document.createElement('span');
  star.className   = 'star';
  star.textContent = '⭐';
  star.style.animationDelay = '0ms';
  container.appendChild(star);
}

function updateGoalBar() {
  const pct = Math.min(100, (sessionReps / repGoal) * 100);
  $('rep-goal-bar').style.width = `${pct}%`;
}

/* ─────────────────── CONGRATS ─────────────────── */
function showCongratsAndStop() {
  const name  = childProfile.name ? `, ${childProfile.name}` : '';
  const texts = [
    `You did it${name}! 🎉`,
    `Awesome work${name}!`,
    `${repGoal} reps — incredible!`,
  ];
  $('congrats-text').textContent = texts[Math.floor(Math.random()*texts.length)];
  $('congrats-sub').textContent  = `${repGoal} reps completed!`;
  $('congrats-banner').style.display = 'flex';
  $('feedback-overlay').style.display = 'none';

  speak(childProfile.name
    ? `Amazing ${childProfile.name}! You did all ${repGoal} reps!`
    : `Amazing! You finished all ${repGoal} reps!`
  );

  // Auto-dismiss after 4 seconds
  setTimeout(() => { $('congrats-banner').style.display = 'none'; }, 4000);
}

/* ─────────────────── REP FLASH ─────────────────── */
function triggerRepFlash() {
  const flash = $('rep-flash');
  flash.classList.remove('flash');
  void flash.offsetWidth;
  flash.classList.add('flash');
}

/* ─────────────────── SESSION CONTROLS ─────────────────── */
$('btn-start-session').addEventListener('click', () => {
  if (!sessionActive) {
    if (childMode && childProfile.socialStory === '1') {
      // Already handled in startSession, this is the direct-press path
      showSocialStory(currentExercise || { name: 'this exercise' }, beginSession);
    } else {
      beginSession();
    }
  }
});

function beginSession() {
  if (sessionActive) return;
  sessionActive = true;
  $('btn-start-session').textContent = 'Session Running…';
  $('btn-start-session').disabled    = true;

  runCountdown(() => {
    PoseEngine.start();
    $('phase-pill').textContent = childMode ? 'Ready? Go! 🏃' : 'DETECTING POSE…';
    if (audioMode) speak('Go!');
  });
}

$('btn-reset-session').addEventListener('click', () => {
  sessionReps     = 0;
  repAccuracy     = { good: 0, bad: 0 };
  goalReached     = false;
  starCount       = 0;
  $('stat-reps').textContent     = '0';
  $('stat-accuracy').textContent = '–';
  $('star-container').innerHTML  = '';
  $('rep-goal-bar').style.width  = '0%';
  $('btn-set-done').style.display = 'none';
  $('congrats-banner').style.display = 'none';
  PoseEngine.resetSession();
});

$('btn-set-done').addEventListener('click', () => {
  sessionSets++;
  sessionReps     = 0;
  repAccuracy     = { good: 0, bad: 0 };
  goalReached     = false;
  starCount       = 0;
  $('stat-sets').textContent     = sessionSets;
  $('stat-reps').textContent     = '0';
  $('stat-accuracy').textContent = '–';
  $('star-container').innerHTML  = '';
  $('rep-goal-bar').style.width  = '0%';
  $('btn-set-done').style.display = 'none';
  $('phase-pill').textContent    = childMode ? `REST TIME 😴 Set ${sessionSets} done!` : `SET ${sessionSets} DONE — REST`;
  PoseEngine.resetSession();
  if (audioMode) speak(childMode ? 'Great set! Time to rest.' : 'Set complete. Rest now.');
});

$('btn-back').addEventListener('click', () => {
  PoseEngine.stop();
  // Restore original tolerance if overridden
  if (currentExercise && currentExercise._originalTolerance !== undefined) {
    currentExercise.romTolerance     = currentExercise._originalTolerance;
    delete currentExercise._originalTolerance;
  }
  if (currentExercise && sessionActive) {
    const total = repAccuracy.good + repAccuracy.bad;
    const accuracyPct = total ? Math.round((repAccuracy.good / total) * 100) : 0;
    const avgBai = sessionFrameCount ? Math.round(sessionBaiTotal / sessionFrameCount) : 0;
    const avgRomScore = sessionRomFrameCount ? Math.round(sessionRomScoreTotal / sessionRomFrameCount) : null;
    const scoreValues = [accuracyPct, avgBai];
    if (avgRomScore !== null) scoreValues.push(avgRomScore);
    const improvementIndex = Math.round(scoreValues.reduce((sum, v) => sum + v, 0) / scoreValues.length);
    saveExerciseSession({
      id:             Date.now(),
      userName:       childProfile.name || 'Unknown',
      exerciseId:     currentExercise.id || currentExercise.name,
      exerciseName:   currentExercise.name,
      date:           new Date().toISOString(),
      reps:           sessionReps,
      sets:           sessionSets,
      accuracyPct,
      avgBai,
      avgRomScore,
      improvementIndex,
    });
  }
  sessionActive = false;
  $('btn-start-session').textContent = 'Start Session';
  $('btn-start-session').disabled    = false;
  $('social-story-panel').style.display = 'none';
  showView('home');
});

/* ─────────────────── YOGA POSE FEATURE ─────────────────── */

// ── Storage helpers ──
function getYogaConfig()   { return JSON.parse(localStorage.getItem('yoga_config')  || 'null'); }
function getYogaUsers()    { return JSON.parse(localStorage.getItem('yoga_users')   || '[]'); }
function getYogaSessions() { return JSON.parse(localStorage.getItem('yoga_sessions')|| '[]'); }
function getExerciseSessions() { return JSON.parse(localStorage.getItem('exercise_sessions')|| '[]'); }

function saveYogaSessions(sessions) {
  localStorage.setItem('yoga_sessions', JSON.stringify(sessions));
}
function saveExerciseSessions(sessions) {
  localStorage.setItem('exercise_sessions', JSON.stringify(sessions));
}

// ── Admin: upload reference pose image ──
if ($('yoga-pose-upload')) $('yoga-pose-upload').addEventListener('change', async function () {
  const file = this.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = async () => {
    const canvas = $('yoga-pose-canvas');
    canvas.style.display = 'block';
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);

    $('yoga-pose-feedback').textContent = 'Detecting pose…';

    // Reuse PoseEngine's one-shot capture
    const fakeLandmarks = await PoseEngine.captureFrameData(img, canvas);
    if (!fakeLandmarks) {
      $('yoga-pose-feedback').textContent = '⚠ No pose detected. Try a clearer full-body image.';
      return;
    }
    // Save to config (landmarks + image dataURL + timer)
    const timerSecs   = parseInt($('yoga-timer-input').value) || 30;
    const repeatCount = parseInt($('yoga-repeat-input').value) || 1;
    const config = {
      referenceLandmarks: fakeLandmarks,
      referenceImageDataUrl: canvas.toDataURL('image/jpeg', 0.7),
      timerSeconds: timerSecs,
      repeatCount,
    };
    localStorage.setItem('yoga_config', JSON.stringify(config));
    $('yoga-pose-feedback').textContent = `✓ Pose saved! Timer: ${timerSecs}s × ${repeatCount}`;
  };
  img.src = URL.createObjectURL(file);
});

// Also update timer when input changes (without re-uploading)
if ($('yoga-timer-input')) $('yoga-timer-input').addEventListener('change', () => {
  const cfg = getYogaConfig();
  if (!cfg) return;
  cfg.timerSeconds = parseInt($('yoga-timer-input').value) || 30;
  localStorage.setItem('yoga_config', JSON.stringify(cfg));
});

if ($('yoga-repeat-input')) $('yoga-repeat-input').addEventListener('change', () => {
  const cfg = getYogaConfig();
  if (!cfg) return;
  cfg.repeatCount = parseInt($('yoga-repeat-input').value) || 1;
  localStorage.setItem('yoga_config', JSON.stringify(cfg));
});

// ── Angle utility (same formula as PoseUtils) ──
function yogaAngle(A, B, C) {
  const ab = { x: A.x - B.x, y: A.y - B.y };
  const cb = { x: C.x - B.x, y: C.y - B.y };
  const dot   = ab.x * cb.x + ab.y * cb.y;
  const cross = ab.x * cb.y - ab.y * cb.x;
  return Math.abs(Math.atan2(Math.abs(cross), dot) * (180 / Math.PI));
}

// Joint definitions: [name, idxA, idxB (vertex), idxC]
const YOGA_JOINTS = [
  ['Left Elbow',    11, 13, 15],
  ['Right Elbow',   12, 14, 16],
  ['Left Shoulder', 13, 11, 23],
  ['Right Shoulder',14, 12, 24],
  ['Left Hip',      11, 23, 25],
  ['Right Hip',     12, 24, 26],
  ['Left Knee',     23, 25, 27],
  ['Right Knee',    24, 26, 28],
];
const YOGA_DEVIATION_THRESHOLD = 20; // degrees

function computeYogaDeviations(currentLM, referenceLM) {
  const deviated = [];
  YOGA_JOINTS.forEach(([name, a, b, c]) => {
    const lmOk = [a, b, c].every(i => currentLM[i] && referenceLM[i]);
    if (!lmOk) return;
    const currentAngle   = yogaAngle(currentLM[a],   currentLM[b],   currentLM[c]);
    const referenceAngle = yogaAngle(referenceLM[a], referenceLM[b], referenceLM[c]);
    if (Math.abs(currentAngle - referenceAngle) > YOGA_DEVIATION_THRESHOLD) {
      deviated.push({ joint: name, diff: Math.round(Math.abs(currentAngle - referenceAngle)) });
    }
  });
  return deviated;
}

function computeYogaMatchScore(currentLM, referenceLM) {
  const diffs = YOGA_JOINTS.map(([name, a, b, c]) => {
    if (![a, b, c].every(i => currentLM[i] && referenceLM[i])) return null;
    const currentAngle   = yogaAngle(currentLM[a],   currentLM[b],   currentLM[c]);
    const referenceAngle = yogaAngle(referenceLM[a], referenceLM[b], referenceLM[c]);
    return Math.abs(currentAngle - referenceAngle);
  }).filter(v => v !== null);

  if (!diffs.length) return { matchPct: 0, avgDiff: 0 };
  const avgDiff = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  const matchPct = Math.round(Math.max(0, Math.min(100, 100 - avgDiff)));
  return { matchPct, avgDiff };
}

function computeExerciseMatchScore(angles, phase, exercise) {
  if (!exercise?.rom) return { matchPct: 0, details: 'No ROM data' };

  const jointScores = Object.entries(exercise.rom).map(([joint, def]) => {
    const current = angles[joint];
    if (current === undefined) return null;
    let targetAngle;
    if (phase === 'up' || phase === 'transition-up') targetAngle = def.top;
    else if (phase === 'down' || phase === 'transition-down') targetAngle = def.bottom;
    else targetAngle = (def.top + def.bottom) / 2;

    const diff = Math.abs(current - targetAngle);
    return { joint, diff };
  }).filter(Boolean);

  if (!jointScores.length) return { matchPct: 0, details: 'No tracked joints yet' };

  const avgDiff = jointScores.reduce((sum, item) => sum + item.diff, 0) / jointScores.length;
  const matchPct = Math.round(Math.max(0, Math.min(100, 100 - avgDiff)));
  const deviated = jointScores.filter(item => item.diff > 12);
  const details = deviated.length
    ? deviated.slice(0, 3).map(item => `${item.joint} ${item.diff}°`).join(', ')
    : 'Good alignment';
  return { matchPct, details };
}

// ── Visual timer state ──
let _yogaTimerInterval    = null;
let _yogaRepeatTimeout    = null;
let _yogaSessionStart     = null;
let _yogaDeviationLog     = [];   // [{ second, joints[] }]
let _yogaRunning          = false;
let _yogaRepeatTarget     = 1;
let _yogaRepeatCurrent    = 0;

function startYogaTimer(totalSeconds, onTick, onComplete) {
  let remaining = totalSeconds;
  const circumference = 327; // 2π × 52

  function update() {
    const pct    = remaining / totalSeconds;
    const offset = circumference * (1 - pct);
    if ($('yoga-timer-ring')) $('yoga-timer-ring').style.strokeDashoffset = offset;

    // Color: green → yellow → red
    const color = remaining > totalSeconds * 0.25
      ? '#22c55e'
      : remaining > totalSeconds * 0.10 ? '#f59e0b' : '#ef4444';
    if ($('yoga-timer-ring')) $('yoga-timer-ring').style.stroke = color;

    if ($('yoga-timer-number')) $('yoga-timer-number').textContent = remaining;
    onTick(remaining);
    remaining--;
    if (remaining < 0) {
      clearInterval(_yogaTimerInterval);
      onComplete();
    }
  }
  update();
  _yogaTimerInterval = setInterval(update, 1000);
}

function stopYogaTimer() {
  if (_yogaTimerInterval) clearInterval(_yogaTimerInterval);
  if (_yogaRepeatTimeout) clearTimeout(_yogaRepeatTimeout);
  _yogaTimerInterval = null;
  _yogaRepeatTimeout = null;
}

// ── Hook into existing session: beginSession wraps this ──
// We extend handleFrame to also run yoga deviation check when a config exists.

// Override: after existing frame logic, also log yoga deviations
window._yogaFrameHook = function (frameData) {
  if (!_yogaRunning) return;
  const cfg = getYogaConfig();
  if (!cfg || !frameData.landmarks) return;

  const deviations = computeYogaDeviations(frameData.landmarks, cfg.referenceLandmarks);

  // Log once per second (keyed to elapsed second)
  const elapsed = Math.floor((Date.now() - _yogaSessionStart) / 1000);
  const lastLog  = _yogaDeviationLog[_yogaDeviationLog.length - 1];
  if (!lastLog || lastLog.second !== elapsed) {
    if (deviations.length > 0) {
      _yogaDeviationLog.push({ second: elapsed, joints: deviations.map(d => d.joint) });
    }
  }

  // Update pose match UI.
  const match = computeYogaMatchScore(frameData.landmarks, cfg.referenceLandmarks);
  const matchWrap    = $('yoga-match-wrap');
  const matchPercent = $('yoga-match-percent');
  const matchDetail  = $('yoga-match-details');
  if (matchWrap && matchPercent && matchDetail) {
    matchWrap.style.display = 'flex';
    matchPercent.textContent = `${match.matchPct}%`;
    matchDetail.textContent  = deviations.length
      ? `${deviations.map(d => d.joint).join(', ')} off`
      : 'Good alignment';
    matchPercent.style.color  = match.matchPct > 75 ? '#4ade80' : match.matchPct > 40 ? '#fbbf24' : '#f87171';
  }

  // Show amber deviation hint (reuse existing feedback overlay)
  if (deviations.length > 0 && !goalReached) {
    const msg = deviations.map(d => d.joint).join(', ') + ' off';
    $('feedback-overlay').style.display = 'flex';
    $('feedback-icon').textContent       = '💛';
    $('feedback-text').textContent       = msg;
  }
};

// ── Patch frame callback to also run yoga hook when active ──
const _originalHandleFrame = handleFrame;
window.handleFrame = function (frameData) {
  _originalHandleFrame(frameData);
  if (typeof window._yogaFrameHook === 'function') {
    window._yogaFrameHook(frameData);
  }
};

// ── Patch beginSession to start yoga timer if config exists ──
const _originalBeginSession = beginSession;

function _startYogaCycle(cfg) {
  if (!cfg) return;
  _yogaRunning = true;
  if (!_yogaSessionStart) _yogaSessionStart = Date.now();
  _yogaDeviationLog = [];

  if ($('yoga-timer-wrap')) {
    $('yoga-timer-wrap').style.display = 'block';
    if ($('yoga-timer-label')) $('yoga-timer-label').textContent = 'Hold';
    if ($('yoga-repeat-label')) $('yoga-repeat-label').textContent = `Hold ${_yogaRepeatCurrent + 1}/${_yogaRepeatTarget}`;
  }
  if ($('yoga-match-wrap')) $('yoga-match-wrap').style.display = 'flex';

  startYogaTimer(cfg.timerSeconds,
    (remaining) => {
      // every tick — nothing extra needed, UI already updated inside startYogaTimer
    },
    () => {
      _yogaRunning = false;
      if ($('yoga-timer-number')) $('yoga-timer-number').textContent = 'Done';
      if ($('yoga-timer-label')) $('yoga-timer-label').textContent = 'Hold complete';
      _yogaRepeatCurrent += 1;

      if (_yogaRepeatCurrent < _yogaRepeatTarget) {
        if ($('yoga-repeat-label')) $('yoga-repeat-label').textContent = `Get ready for ${_yogaRepeatCurrent + 1}/${_yogaRepeatTarget}`;
        _yogaRepeatTimeout = setTimeout(() => {
          if (!_yogaRunning) {
            if ($('yoga-timer-ring')) $('yoga-timer-ring').style.stroke = '#22c55e';
            if ($('yoga-timer-label')) $('yoga-timer-label').textContent = 'Hold';
            if ($('yoga-timer-number')) $('yoga-timer-number').textContent = cfg.timerSeconds;
            _startYogaCycle(cfg);
          }
        }, 2200);
      } else {
        if ($('yoga-repeat-label')) $('yoga-repeat-label').textContent = 'All holds complete';
        if ($('yoga-match-wrap')) $('yoga-match-wrap').style.display = 'none';
        const repeatCount = cfg.repeatCount || 1;
        saveYogaSession(cfg.timerSeconds * repeatCount, cfg.timerSeconds * repeatCount, repeatCount);
        speak(`Great job! You held the pose ${repeatCount} time${repeatCount > 1 ? 's' : ''}!`);
        if ($('yoga-timer-wrap')) {
          $('yoga-timer-wrap').style.display = 'block';
        }
      }
    }
  );
}

window.beginSession = function () {
  const cfg = getYogaConfig();
  if (cfg?.repeatCount) {
    _yogaRepeatTarget  = cfg.repeatCount;
    _yogaRepeatCurrent = 0;
  } else {
    _yogaRepeatTarget  = 1;
    _yogaRepeatCurrent = 0;
  }

  window._sessionStartHook = () => {
    if (cfg) _startYogaCycle(cfg);
  };

  _originalBeginSession();
};

function getExerciseSessionsForUser(user) {
  return getExerciseSessions().filter(s => s.userName === user);
}

function renderReportExerciseSelect(user) {
  const select = $('report-exercise-select');
  const output = $('report-charts');
  if (!select || !output) return;
  const sessions = getExerciseSessionsForUser(user);
  const exerciseMap = new Map();
  sessions.forEach(s => exerciseMap.set(s.exerciseId, s.exerciseName || 'Unknown')); 
  select.innerHTML = '<option value="">— choose an exercise —</option>';
  if (!sessions.length) {
    select.disabled = true;
    output.innerHTML = '<p style="color:var(--muted);">No exercise history found for this user.</p>';
    return;
  }
  select.disabled = false;
  exerciseMap.forEach((exerciseName, exerciseId) => {
    const opt = document.createElement('option');
    opt.value = exerciseId;
    opt.textContent = exerciseName;
    select.appendChild(opt);
  });
  output.innerHTML = '<p style="color:var(--muted);">Select an exercise to view charts.</p>';
}

function renderExerciseReport(user, exerciseId) {
  const output = $('report-charts');
  if (!output) return;
  const sessions = getExerciseSessionsForUser(user)
    .filter(s => s.exerciseId === exerciseId)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!sessions.length) {
    output.innerHTML = '<p style="color:var(--muted);">No exercise history found for this exercise.</p>';
    return;
  }

  const labels = sessions.map(s => new Date(s.date).toLocaleDateString());
  const roms = sessions.map(s => s.avgRomScore === null ? null : Math.round(s.avgRomScore));
  const bais = sessions.map(s => Math.round(s.avgBai));
  const improvements = sessions.map(s => Math.round(s.improvementIndex));

  function chartHtml(title, values) {
    return `
      <div class="report-chart-card">
        <h3>${title}</h3>
        ${values.map((value, idx) => {
          const label = labels[idx];
          const pct = Math.max(0, Math.min(100, value));
          const displayValue = value === null ? 'N/A' : `${pct}%`;
      const fillWidth = value === null ? 0 : pct;
      return `
            <div class="report-chart-row">
              <div class="report-chart-label">${label}</div>
              <div class="report-chart-bar-wrap">
                <div class="report-chart-bar"><div class="report-chart-bar-fill" style="width:${fillWidth}%"></div></div>
              </div>
              <div class="report-chart-value">${displayValue}</div>
            </div>`;
        }).join('')}
      </div>`;
  }

  output.innerHTML = `
    <div class="report-summary-card">
      <h2>${sessions[0].exerciseName}</h2>
      <p>${sessions.length} session${sessions.length > 1 ? 's' : ''} recorded</p>
    </div>
    ${chartHtml('ROM Score', roms)}
    ${chartHtml('BAI', bais)}
    ${chartHtml('Improvement Index', improvements)}
  `;
}

function saveExerciseSession(data) {
  const sessions = getExerciseSessions();
  sessions.push(data);
  saveExerciseSessions(sessions);
}

// ── Patch btn-back to also stop yoga timer & save incomplete session ──
$('btn-back').addEventListener('click', () => {
  if (_yogaRunning) {
    const cfg     = getYogaConfig();
    const elapsed = Math.floor((Date.now() - _yogaSessionStart) / 1000);
    stopYogaTimer();
    _yogaRunning = false;
    if ($('yoga-timer-wrap')) $('yoga-timer-wrap').style.display = 'none';
    if ($('yoga-match-wrap')) $('yoga-match-wrap').style.display = 'none';
    if (cfg) saveYogaSession(elapsed, cfg.timerSeconds, cfg.repeatCount || 1); // incomplete — saves actual time held
  }
}, true); // capture phase so it fires before the existing listener

// ── Save session to localStorage ──
function saveYogaSession(completedSeconds, totalSeconds, repeatCount = 1) {
  const userName = childProfile.name || 'Unknown';
  const sessions = getYogaSessions();
  sessions.push({
    id:               Date.now(),
    userName,
    date:             new Date().toISOString(),
    totalSeconds,
    completedSeconds, // actual time held (even if incomplete)
    repeatCount,
    completionPct:    Math.round((completedSeconds / totalSeconds) * 100),
    deviations:       _yogaDeviationLog,
  });
  saveYogaSessions(sessions);
  _yogaDeviationLog = [];
}

// ── Reports page ──
function renderReportUserSelect() {
  const sel = $('report-user-select');
  const output = $('report-output');
  if (!sel || !output) return;

  const yogaUsers = getYogaSessions().map(s => s.userName);
  const exerciseUsers = getExerciseSessions().map(s => s.userName);
  const users = [...new Set([...yogaUsers, ...exerciseUsers])];
  sel.innerHTML  = '<option value="">— choose a user —</option>';
  users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = u;
    sel.appendChild(opt);
  });
  output.innerHTML = '';
}

if ($('report-user-select')) $('report-user-select').addEventListener('change', function () {
  const user     = this.value;
  const output   = $('report-output');
  const exerciseSelect = $('report-exercise-select');
  if (!output || !exerciseSelect) return;
  if (!user) {
    output.innerHTML = '';
    exerciseSelect.innerHTML = '<option value="">— choose an exercise —</option>';
    exerciseSelect.disabled = true;
    $('report-charts').innerHTML = '';
    return;
  }

  renderReportExerciseSelect(user);

  const sessions = getYogaSessions().filter(s => s.userName === user);
  if (!sessions.length) {
    output.innerHTML = '<p style="color:var(--muted);">No yoga sessions found for this user.</p>';
    $('report-charts').innerHTML = '';
    return;
  }

  output.innerHTML = sessions.reverse().map(s => {
    const date     = new Date(s.date).toLocaleString();
    const held     = `${s.completedSeconds}s / ${s.totalSeconds}s`;
    const complete = s.completionPct >= 100
      ? '<span style="color:#22c55e;">✓ Complete</span>'
      : `<span style="color:#f59e0b;">${s.completionPct}% held</span>`;

    // Tally deviations per joint
    const tally = {};
    s.deviations.forEach(d => d.joints.forEach(j => { tally[j] = (tally[j] || 0) + 1; }));
    const tallyHTML = Object.entries(tally).length
      ? Object.entries(tally)
          .sort((a, b) => b[1] - a[1])
          .map(([j, n]) => `<span style="margin-right:10px;">🔸 ${j}: ${n}s</span>`)
          .join('')
      : '<span style="color:var(--muted);">No deviations recorded 🎉</span>';

    return `
      <div class="admin-card" style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${date}</strong> ${complete}
        </div>
        <div style="margin:6px 0;color:var(--muted);font-size:.85rem;">Time held: ${held}</div>
        <div style="font-size:.83rem;margin-top:6px;">${tallyHTML}</div>
      </div>`;
  }).join('');
});

if ($('report-exercise-select')) $('report-exercise-select').addEventListener('change', function () {
  const user = $('report-user-select')?.value;
  const exerciseId = this.value;
  if (!user || !exerciseId) {
    $('report-charts').innerHTML = '';
    return;
  }
  renderExerciseReport(user, exerciseId);
});

/* ─────────────────── FAKE DATA GENERATION ─────────────────── */
function generateFakeExerciseData() {
  const userName = 'Demo User';
  const exercises = [
    { id: 'push-up', name: 'Push Up' },
    { id: 'squat', name: 'Squat' }
  ];
  const sessions = [];

  exercises.forEach(exercise => {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - 20); // Start 20 days ago

    for (let i = 0; i < 5; i++) {
      const sessionDate = new Date(baseDate);
      sessionDate.setDate(sessionDate.getDate() + i * 4); // Every 4 days

      // Simulate improvement over time
      const progress = i / 4; // 0 to 1
      const accuracyPct = Math.round(60 + progress * 35); // 60% to 95%
      const avgBai = Math.round(70 + progress * 25); // 70% to 95%
      const avgRomScore = exercise.id === 'push-up' ? Math.round(65 + progress * 30) : Math.round(70 + progress * 25); // Different baselines
      const improvementIndex = Math.round((accuracyPct + avgBai + avgRomScore) / 3);

      sessions.push({
        id: Date.now() + Math.random(),
        userName,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        date: sessionDate.toISOString(),
        reps: 8 + Math.floor(Math.random() * 5), // 8-12 reps
        sets: 1,
        accuracyPct,
        avgBai,
        avgRomScore,
        improvementIndex,
      });
    }
  });

  const existing = getExerciseSessions();
  if (existing.length === 0) {
    saveExerciseSessions(sessions);
  }

  // Also add some fake yoga sessions
  const yogaSessions = [];
  const yogaBaseDate = new Date();
  yogaBaseDate.setDate(yogaBaseDate.getDate() - 15);
  for (let i = 0; i < 3; i++) {
    const yogaDate = new Date(yogaBaseDate);
    yogaDate.setDate(yogaDate.getDate() + i * 5);
    yogaSessions.push({
      id: Date.now() + Math.random(),
      userName,
      date: yogaDate.toISOString(),
      totalSeconds: 30,
      completedSeconds: 25 + i * 2, // Improving hold time
      repeatCount: 1,
      completionPct: Math.round((27 + i * 2) / 30 * 100),
      deviations: [{ joints: ['left_elbow', 'right_elbow'], seconds: 5 - i }],
    });
  }
  const existingYoga = getYogaSessions();
  if (existingYoga.length === 0) {
    saveYogaSessions(yogaSessions);
  }
}

/* ─────────────────── INIT ─────────────────── */
generateFakeExerciseData();
loadChildProfileUI();
renderLibrary();
renderAdminList();
showView('home');
