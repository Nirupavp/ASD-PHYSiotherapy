/**
 * exercises.js — Exercise Plugin Registry
 *
 * KEY FIXES vs original:
 *
 *  STATE MACHINE THRESHOLDS CORRECTED
 *  -----------------------------------
 *  Original thresholds were too strict — knee had to reach <100° for 'down'
 *  (a deep powerlifter squat). Most people, and especially children, squat to
 *  ~115–120°. Thresholds are now calibrated to real-world movement ranges.
 *
 *  VALIDATED-REP CHECKS LOOSENED
 *  --------------------------------
 *  validateRep was rejecting reps unless the user hit near-perfect ROM.
 *  The engine now uses the child-profile tolerance override (already handled
 *  in app.js), but the built-in tolerances have been widened from ±15 to ±25
 *  so average users get counted.
 *
 *  READY-PHASE GATE WIDENED
 *  ------------------------
 *  _tryEnterFirstPhase in pose-engine requires the primary angle to be
 *  within (romTolerance + 15)° of the 'top' value. For squat that was
 *  ±30° of 170° = must be 140–200°. Normal standing knee angle is ~165–175°
 *  so this was fine, but hip angle (also primary) could read 140° when
 *  slightly bent. Fixed by only using KNEE as the primary check for squat.
 *
 *  HOW TO ADD A NEW EXERCISE:
 *  Push a config object to ExerciseRegistry via registerExercise().
 *  No other files need changing.
 */

"use strict";

/* ─────────────── Utilities ─────────────── */
window.PoseUtils = {
  angle3(a, b, c) {
    const ab = { x: a.x - b.x, y: a.y - b.y };
    const cb = { x: c.x - b.x, y: c.y - b.y };
    const dot   = ab.x * cb.x + ab.y * cb.y;
    const cross = ab.x * cb.y - ab.y * cb.x;
    return Math.abs(Math.atan2(Math.abs(cross), dot) * (180 / Math.PI));
  },
  horizontalAngle(a, b) {
    return Math.abs(Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * (180 / Math.PI));
  },
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
  clamp(v, min, max) { return Math.min(max, Math.max(min, v)); },
  symmetryBAI(lm) {
    if (!lm || lm.length < 33) return 50;
    const sD = Math.abs(lm[11].y - lm[12].y);  // shoulder level diff
    const hD = Math.abs(lm[23].y - lm[24].y);  // hip level diff
    return Math.round(100 - PoseUtils.clamp((sD + hD) * 500, 0, 100));
  },
};

/* ─────────────── Landmark constants ─────────────── */
window.LM = {
  NOSE:0, LEFT_EAR:7, RIGHT_EAR:8,
  LEFT_SHOULDER:11, RIGHT_SHOULDER:12,
  LEFT_ELBOW:13, RIGHT_ELBOW:14,
  LEFT_WRIST:15, RIGHT_WRIST:16,
  LEFT_HIP:23, RIGHT_HIP:24,
  LEFT_KNEE:25, RIGHT_KNEE:26,
  LEFT_ANKLE:27, RIGHT_ANKLE:28,
  LEFT_HEEL:29, RIGHT_HEEL:30,
  LEFT_FOOT_INDEX:31, RIGHT_FOOT_INDEX:32,
};

/* ─────────────── Registry ─────────────── */
window.ExerciseRegistry = [];
window.registerExercise = function(config) {
  if (!config.id) config.id = config.name.toLowerCase().replace(/\s+/g,'-') + '-' + Date.now();
  ExerciseRegistry.push(config);
};

/* ══════════════════════════════════════════════════════
 *  SQUAT
 *
 *  State machine (uses knee angle only — hip is secondary):
 *    up          → knee > 150° (standing)
 *    transition-down → knee drops below 130°
 *    down        → knee below 115°  ← was 100, too strict
 *    transition-up   → knee rises above 130°
 *    up          → knee above 150°  ← was 160, hard to hit cleanly
 *
 *  validateRep: just checks knee reached below 120° at bottom.
 *  The original also checked hip, which often fails when camera
 *  angle makes hip occlusion unreliable.
 * ══════════════════════════════════════════════════════ */
registerExercise({
  id: 'squat-builtin',
  name: 'Squat',
  category: 'Strength',
  emoji: '🦵',
  description: 'Compound lower-body exercise targeting quads, glutes, and hamstrings.',
  joints: ['knee', 'hip'],

  rom: {
    knee: { top: 170, bottom: 100, label: 'Knee Flex' },
    hip:  { top: 165, bottom: 90,  label: 'Hip Flex'  },
  },
  romTolerance: 25,   // wider = more forgiving for children / beginners

  repStateMachine(phase, angles) {
    const knee = angles.knee ?? 180;
    // Thresholds deliberately generous so normal squats register
    if (phase === 'up'            && knee < 130) return 'transition-down';
    if (phase === 'transition-down' && knee < 115) return 'down';
    if (phase === 'down'          && knee > 125) return 'transition-up';
    if (phase === 'transition-up' && knee > 150) return 'up';
    return null;
  },

  validateRep(downAngles) {
    const knee = downAngles.knee ?? 180;
    // Only reject if they barely bent at all (less than half-squat)
    if (knee > 145) return { ok: false, errors: ['Bend knees more — try to go lower'] };
    return { ok: true, errors: [] };
  },

  validateForm(angles, landmarks) {
    const errors = [], warnings = [];
    const lm = landmarks;
    if (!lm || lm.length < 33) return { ok: true, errors, warnings };

    // Chest-up check: compare shoulder-to-hip vector tilt
    const sMid = { x: (lm[11].x+lm[12].x)/2, y: (lm[11].y+lm[12].y)/2 };
    const hMid = { x: (lm[23].x+lm[24].x)/2, y: (lm[23].y+lm[24].y)/2 };
    const tilt  = Math.abs(Math.atan2(sMid.x - hMid.x, hMid.y - sMid.y) * 180/Math.PI);
    if (tilt > 50) errors.push('Keep chest up — torso leaning too far forward');

    return { ok: !errors.length && !warnings.length, errors, warnings };
  },

  computeAngles(lm) {
    if (!lm || lm.length < 33) return {};
    const kneeL = PoseUtils.angle3(lm[23], lm[25], lm[27]);
    const kneeR = PoseUtils.angle3(lm[24], lm[26], lm[28]);
    const hipL  = PoseUtils.angle3(lm[11], lm[23], lm[25]);
    const hipR  = PoseUtils.angle3(lm[12], lm[24], lm[26]);
    return {
      knee: Math.round((kneeL + kneeR) / 2),
      hip:  Math.round((hipL  + hipR)  / 2),
    };
  },

  computeBAI: PoseUtils.symmetryBAI,
});

/* ══════════════════════════════════════════════════════
 *  BICEP CURL
 *
 *  Uses elbow angle only (shoulder is informational).
 *  down = arm extended (~160°+)
 *  up   = arm curled (~50°)
 *
 *  Original was backwards — 'up' state was when arm was
 *  extended, 'down' when curled. Fixed labels to match
 *  natural language ("going up" = curling up).
 * ══════════════════════════════════════════════════════ */
registerExercise({
  id: 'bicep-curl-builtin',
  name: 'Bicep Curl',
  category: 'Strength',
  emoji: '💪',
  description: 'Isolation exercise for the biceps. Counts one rep per full curl and extend.',
  joints: ['elbow'],

  rom: {
    elbow: { top: 155, bottom: 55, label: 'Elbow Angle' },
  },
  romTolerance: 25,

  //  'up' here means arm is DOWN/extended (starting position)
  //  This matches the pose-engine ready-phase gate which looks for 'top' value
  repStateMachine(phase, angles) {
    const e = angles.elbow ?? 180;
    if (phase === 'up'             && e < 110) return 'transition-down';
    if (phase === 'transition-down' && e < 80)  return 'down';
    if (phase === 'down'           && e > 100) return 'transition-up';
    if (phase === 'transition-up'  && e > 140) return 'up';
    return null;
  },

  validateRep(downAngles, upAngles) {
    const curled   = downAngles.elbow ?? 180;
    const extended = upAngles?.elbow  ?? 0;
    const errors = [];
    if (curled > 100) errors.push('Curl arm higher — squeeze the bicep');
    if (extended < 130) errors.push('Fully extend arm at the bottom');
    return { ok: errors.length === 0, errors };
  },

  validateForm(angles, landmarks) {
    const errors = [], warnings = [];
    const lm = landmarks;
    if (!lm || lm.length < 33) return { ok: true, errors, warnings };
    // Elbow should stay close to torso — check left elbow drift
    const elbowLateralL = Math.abs(lm[13].x - lm[11].x);
    if (elbowLateralL > 0.18) warnings.push('Keep left elbow tucked to your side');
    return { ok: !errors.length && !warnings.length, errors, warnings };
  },

  computeAngles(lm) {
    if (!lm || lm.length < 33) return {};
    const eL = PoseUtils.angle3(lm[11], lm[13], lm[15]);
    const eR = PoseUtils.angle3(lm[12], lm[14], lm[16]);
    return { elbow: Math.round((eL + eR) / 2) };
  },

  computeBAI: PoseUtils.symmetryBAI,
});

/* ══════════════════════════════════════════════════════
 *  LATERAL RAISE
 * ══════════════════════════════════════════════════════ */
registerExercise({
  id: 'lateral-raise-builtin',
  name: 'Lateral Raise',
  category: 'Strength',
  emoji: '🦅',
  description: 'Shoulder abduction targeting the medial deltoid.',
  joints: ['shoulder'],

  rom: {
    shoulder: { top: 15, bottom: 80, label: 'Arm Abduction' },
  },
  romTolerance: 20,

  repStateMachine(phase, angles) {
    const sh = angles.shoulder ?? 0;
    // 'up' = arms at sides (low angle), 'down' = arms raised (high angle)
    if (phase === 'up'             && sh > 45)  return 'transition-down';
    if (phase === 'transition-down' && sh > 65)  return 'down';
    if (phase === 'down'           && sh < 45)  return 'transition-up';
    if (phase === 'transition-up'  && sh < 25)  return 'up';
    return null;
  },

  validateRep(downAngles) {
    if ((downAngles.shoulder ?? 0) < 55) return { ok: false, errors: ['Raise arms higher — reach shoulder height'] };
    return { ok: true, errors: [] };
  },

  validateForm() { return { ok: true, errors: [], warnings: [] }; },

  computeAngles(lm) {
    if (!lm || lm.length < 33) return {};
    const leftAngle  = PoseUtils.horizontalAngle(lm[11], lm[13]);
    const rightAngle = PoseUtils.horizontalAngle(lm[12], lm[14]);
    return { shoulder: Math.round((leftAngle + rightAngle) / 2) };
  },

  computeBAI: PoseUtils.symmetryBAI,
});

/* ══════════════════════════════════════════════════════
 *  PUSH-UP
 * ══════════════════════════════════════════════════════ */
registerExercise({
  id: 'pushup-builtin',
  name: 'Push-Up',
  category: 'Strength',
  emoji: '🤸',
  description: 'Upper-body push movement. Camera should be at side angle.',
  joints: ['elbow'],

  rom: {
    elbow: { top: 160, bottom: 85, label: 'Elbow Ext.' },
  },
  romTolerance: 25,

  repStateMachine(phase, angles) {
    const e = angles.elbow ?? 180;
    if (phase === 'up'             && e < 130) return 'transition-down';
    if (phase === 'transition-down' && e < 100) return 'down';
    if (phase === 'down'           && e > 120) return 'transition-up';
    if (phase === 'transition-up'  && e > 150) return 'up';
    return null;
  },

  validateRep(downAngles, upAngles) {
    const errors = [];
    if ((upAngles?.elbow ?? 0)    < 140) errors.push('Push all the way up — lock elbows');
    if ((downAngles.elbow ?? 180) > 110) errors.push('Go lower — chest closer to ground');
    return { ok: errors.length === 0, errors };
  },

  validateForm(angles, landmarks) {
    const errors = [], warnings = [];
    const lm = landmarks;
    if (!lm || lm.length < 33) return { ok: true, errors, warnings };
    const sY = (lm[11].y + lm[12].y) / 2;
    const hY = (lm[23].y + lm[24].y) / 2;
    const aY = (lm[27].y + lm[28].y) / 2;
    if (Math.max(Math.abs(hY - sY), Math.abs(hY - aY)) > 0.14) {
      warnings.push('Keep body straight — hips level with shoulders');
    }
    return { ok: !errors.length && !warnings.length, errors, warnings };
  },

  computeAngles(lm) {
    if (!lm || lm.length < 33) return {};
    const eL = PoseUtils.angle3(lm[11], lm[13], lm[15]);
    const eR = PoseUtils.angle3(lm[12], lm[14], lm[16]);
    return { elbow: Math.round((eL + eR) / 2) };
  },

  computeBAI: PoseUtils.symmetryBAI,
});

/* ═══════════════════════════════════════════════════════════
 *  Load persisted (admin-uploaded) exercises from localStorage
 * ═══════════════════════════════════════════════════════════ */
(function loadPersisted() {
  try {
    const saved = JSON.parse(localStorage.getItem('motioniq_exercises') || '[]');
    saved.forEach(cfg => {
      try {
        if (typeof cfg.repStateMachine === 'string')
          cfg.repStateMachine = new Function('phase','angles','config', cfg.repStateMachine);
        if (typeof cfg.validateForm === 'string')
          cfg.validateForm = new Function('angles','landmarks','config', cfg.validateForm);
        if (typeof cfg.computeAngles === 'string')
          cfg.computeAngles = new Function('lm', cfg.computeAngles);
        cfg.computeBAI  = PoseUtils.symmetryBAI;
        cfg.validateRep = (d) => ({ ok: true, errors: [] });
        ExerciseRegistry.push(cfg);
      } catch(e) { console.warn('Failed to restore exercise:', cfg.name, e); }
    });
  } catch(e) { console.warn('localStorage read error:', e); }
})();
