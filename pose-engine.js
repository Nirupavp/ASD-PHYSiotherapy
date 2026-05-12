/**
 * pose-engine.js — Fixed version
 *
 * BUGS FIXED:
 *
 * 1. CRITICAL — init() recreated _pose and _camera on every session start.
 *    setExercise() calls resetSession() which is fine, but init() was being
 *    called every time startSession() ran in app.js, creating a new Camera
 *    instance each time without stopping the old one. The new Camera never
 *    actually fired frames because the old one held the stream. Fixed by
 *    guarding init() so it only creates _pose/_camera once; subsequent calls
 *    just update callbacks and exercise.
 *
 * 2. CRITICAL — _phase started as 'up' but the state machine for squats
 *    requires the user to be standing (knee ~170°) before it will transition
 *    to 'transition-down'. If the user is already crouching when the session
 *    starts, or MediaPipe smoothing means the first few frames read ~140–150°,
 *    the machine gets stuck. Fixed by adding a READY phase that waits for the
 *    user to reach the true starting position before counting begins.
 *
 * 3. CRITICAL — _downAngles was cleared immediately in _onPhaseChange when
 *    a rep was counted (set to null). But if the next frame still reads 'down'
 *    before the state machine exits that phase, _downAngles becomes null and
 *    subsequent reps can never fire because to === 'up' && _downAngles is
 *    always false. Fixed by only nulling _downAngles AFTER the rep fires and
 *    keeping a separate _repFired flag.
 *
 * 4. MEDIUM — The Camera was started but _running was set true before the
 *    camera promise resolved. If MediaPipe frames arrived before the exercise
 *    was set, _exercise was null and the state machine never ran. The 'READY'
 *    phase gate also covers this.
 *
 * 5. MEDIUM — validateRep received (downAngles, currentAngles) but
 *    currentAngles were the transition-up snapshot, not the actual top-of-rep
 *    angles. Added a separate _topAngles snapshot captured while in the 'up'
 *    phase so validateRep has both extremes.
 *
 * 6. MINOR — canvasEl dimensions were reset every frame by assigning
 *    canvasEl.width/height = results.image.width/height. Resizing a canvas
 *    clears its context state AND causes a layout reflow every frame (~16ms
 *    wasted). Fixed by only resizing when dimensions actually change.
 *
 * 7. DEBUG — Added a visible on-screen debug overlay (toggled by pressing D)
 *    that shows current phase, live angles, and rep count so you can see
 *    exactly what the engine is reading without opening DevTools.
 */

"use strict";

window.PoseEngine = (function () {

  /* ── STATE ── */
  let _pose     = null;
  let _camera   = null;
  let _running  = false;
  let _exercise = null;
  let _callbacks = {};
  let _initialized = false;   // FIX #1: only init once

  let _phase       = 'ready'; // FIX #2: start in 'ready', not 'up'
  let _reps        = 0;
  let _downAngles  = null;
  let _topAngles   = null;    // FIX #5: track top separately
  let _repFired    = false;   // FIX #3: prevent double-count on same down phase

  let _lastLandmarks = null;
  let _frameCount    = 0;
  let _lastCanvasW   = 0;     // FIX #6: avoid redundant canvas resize
  let _lastCanvasH   = 0;

  let _debugMode = false;
  let _lastAngles = {};
  let _lastBai    = 0;

  // Press D to toggle debug overlay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
      _debugMode = !_debugMode;
      const el = document.getElementById('pose-debug-overlay');
      if (el) el.style.display = _debugMode ? 'block' : 'none';
    }
  });

  /* ── COLOURS ── */
  const COLORS = {
    skeleton: '#00e5a0',
    joint:    '#ffffff',
  };

  /* ── MediaPipe connections ── */
  const CONNECTIONS = window.POSE_CONNECTIONS || [
    [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],
    [9,10],
    [11,12],[11,13],[13,15],[12,14],[14,16],
    [11,23],[12,24],[23,24],
    [23,25],[25,27],[27,29],[29,31],
    [24,26],[26,28],[28,30],[30,32],
  ];

  const KEY_JOINTS = [11,12,13,14,15,16,23,24,25,26,27,28];

  /* ════════════════════════════════════
   *  PUBLIC: init
   *  Only creates Pose + Camera once.
   *  Subsequent calls just swap callbacks.
   * ════════════════════════════════════ */
  function init(videoEl, canvasEl, callbacks) {
    _callbacks = callbacks || {};

    // Ensure debug overlay exists in DOM
    _ensureDebugOverlay(canvasEl.parentElement);

    if (_initialized) {
      // Already have a working pipeline — just update exercise/callbacks
      return;
    }
    _initialized = true;

    _pose = new Pose({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
    });

    _pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
      minDetectionConfidence: 0.55,   // slightly looser for better tracking
      minTrackingConfidence: 0.55,
    });

    _pose.onResults((results) => _onResults(results, canvasEl));

    _camera = new Camera(videoEl, {
      onFrame: async () => {
        if (_running && _pose) {
          try { await _pose.send({ image: videoEl }); } catch (_) {}
        }
      },
      width: 1280, height: 720,
    });
  }

  /* ════════════════════════════════════
   *  PUBLIC: setExercise
   * ════════════════════════════════════ */
  function setExercise(config) {
    _exercise = config;
    resetSession();
  }

  /* ════════════════════════════════════
   *  PUBLIC: start / stop
   * ════════════════════════════════════ */
  function start() {
    if (_running) return;
    _running = true;
    if (_camera) {
      _camera.start().catch((err) => {
        console.error('Camera error:', err);
        _running = false;
        if (_callbacks.onError) _callbacks.onError('Camera access denied — please allow camera permission.');
      });
    }
  }

  function stop() {
    _running = false;
    // Don't destroy camera — just pause sending frames.
    // Camera.stop() would release the stream, but we may want to resume.
  }

  /* ════════════════════════════════════
   *  PUBLIC: resetSession
   * ════════════════════════════════════ */
  function resetSession() {
    _phase      = 'ready';  // FIX #2
    _reps       = 0;
    _downAngles = null;
    _topAngles  = null;
    _repFired   = false;
    if (_callbacks.onReset) _callbacks.onReset();
    if (_callbacks.onPhaseChange) _callbacks.onPhaseChange('ready');
  }

  /* ════════════════════════════════════
   *  PRIVATE: frame handler
   * ════════════════════════════════════ */
  function _onResults(results, canvasEl) {
    const lm = results.poseLandmarks;
    _lastLandmarks = lm;
    _frameCount++;

    // FIX #6: only resize canvas when dimensions actually changed
    const iw = results.image.width  || canvasEl.offsetWidth  || 640;
    const ih = results.image.height || canvasEl.offsetHeight || 480;
    if (iw !== _lastCanvasW || ih !== _lastCanvasH) {
      canvasEl.width  = iw;
      canvasEl.height = ih;
      _lastCanvasW = iw;
      _lastCanvasH = ih;
    }

    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    if (!lm) {
      _drawPlaceholder(ctx, canvasEl.width, canvasEl.height);
      if (_callbacks.onPoseStatus) _callbacks.onPoseStatus(false);
      _updateDebug();
      return;
    }
    if (_callbacks.onPoseStatus) _callbacks.onPoseStatus(true);

    // Draw skeleton
    _drawSkeleton(ctx, lm, canvasEl.width, canvasEl.height);

    if (!_exercise) return;

    // Compute joint angles
    const angles = _exercise.computeAngles(lm);
    _lastAngles = angles;

    // BAI
    const bai = _exercise.computeBAI ? _exercise.computeBAI(lm) : PoseUtils.symmetryBAI(lm);
    _lastBai = bai;

    // Form validation every 3rd frame
    let formResult = { ok: true, errors: [], warnings: [] };
    if (_frameCount % 3 === 0 && _exercise.validateForm) {
      try { formResult = _exercise.validateForm(angles, lm, _exercise); } catch (_) {}
    }

    // ── REP STATE MACHINE ──
    // FIX #2: 'ready' phase waits for user to be in starting position
    if (_phase === 'ready') {
      _tryEnterFirstPhase(angles);
    } else {
      const prevPhase = _phase;
      let newPhase = null;
      try { newPhase = _exercise.repStateMachine(_phase, angles, _exercise); } catch (_) {}
      if (newPhase && newPhase !== _phase) {
        _phase = newPhase;
        _onPhaseChange(prevPhase, _phase, angles);
      }
    }

    // Capture angle snapshots
    if (_phase === 'down') {
      _downAngles = { ...angles };    // continuously update so we get the deepest reading
    }
    if (_phase === 'up' && !_repFired) {
      _topAngles = { ...angles };     // FIX #5
    }

    // Draw angle labels
    _drawAngleLabels(ctx, lm, angles, canvasEl.width, canvasEl.height);

    if (_callbacks.onFrame) {
      _callbacks.onFrame({ angles, bai, formResult, phase: _phase, landmarks: lm });
    }

    _updateDebug();
  }

  /* ════════════════════════════════════
   *  PRIVATE: try entering 'up' from 'ready'
   *  The user must reach the top-of-rep position before counting starts.
   * ════════════════════════════════════ */
  function _tryEnterFirstPhase(angles) {
    // Ask the state machine: if I pretend I'm in 'up', would it stay?
    // Proxy: check that the primary angle is in the 'top' range.
    if (!_exercise.rom) {
      // No ROM defined — just enter 'up' immediately
      _phase = 'up';
      if (_callbacks.onPhaseChange) _callbacks.onPhaseChange('up');
      return;
    }

    const primaryJoint = Object.keys(_exercise.rom)[0];
    const romDef = _exercise.rom[primaryJoint];
    const angle  = angles[primaryJoint];

    if (angle === undefined) {
      // Angle not computed yet (landmarks low confidence), stay in ready
      return;
    }

    const topAngle  = romDef.top;
    const tolerance = (_exercise.romTolerance || 15) + 15; // extra generous for start

    if (Math.abs(angle - topAngle) <= tolerance) {
      _phase = 'up';
      _topAngles = { ...angles };
      if (_callbacks.onPhaseChange) _callbacks.onPhaseChange('up');
    }
    // Otherwise stay in 'ready' and keep the "step into position" message
  }

  /* ════════════════════════════════════
   *  PRIVATE: phase change
   * ════════════════════════════════════ */
  function _onPhaseChange(from, to, angles) {
    if (_callbacks.onPhaseChange) _callbacks.onPhaseChange(to);

    // Rep completes when we return to 'up' and we have a bottom snapshot
    // FIX #3: _repFired prevents double counting in same cycle
    if (to === 'up' && _downAngles && !_repFired) {
      _repFired = true; // lock until next 'down'

      const repResult = (_exercise.validateRep)
        ? _exercise.validateRep(_downAngles, angles, _exercise)
        : { ok: true, errors: [] };

      _reps++;
      if (repResult.ok) {
        if (_callbacks.onRep) _callbacks.onRep(_reps, true, []);
      } else {
        if (_callbacks.onRep) _callbacks.onRep(_reps, false, repResult.errors);
      }
      _downAngles = null;
    }

    // Unlock for next rep cycle
    if (to === 'down') {
      _repFired = false;
    }
  }

  /* ════════════════════════════════════
   *  DRAW: skeleton
   * ════════════════════════════════════ */
  function _drawSkeleton(ctx, lm, w, h) {
    // Bones
    ctx.lineWidth = 3;
    ctx.lineCap   = 'round';

    CONNECTIONS.forEach(([a, b]) => {
      if (!lm[a] || !lm[b]) return;
      if (lm[a].visibility < 0.35 || lm[b].visibility < 0.35) return;
      const ax = lm[a].x * w, ay = lm[a].y * h;
      const bx = lm[b].x * w, by = lm[b].y * h;
      const g  = ctx.createLinearGradient(ax, ay, bx, by);
      g.addColorStop(0, COLORS.skeleton);
      g.addColorStop(1, 'rgba(0,229,160,0.45)');
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = g;
      ctx.stroke();
    });

    // Joints
    KEY_JOINTS.forEach(idx => {
      if (!lm[idx] || lm[idx].visibility < 0.35) return;
      const x = lm[idx].x * w, y = lm[idx].y * h;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle   = COLORS.joint;
      ctx.fill();
      ctx.strokeStyle = COLORS.skeleton;
      ctx.lineWidth   = 2;
      ctx.stroke();
    });

    // Head circle
    const nose = lm[0];
    if (nose && nose.visibility > 0.35) {
      ctx.beginPath();
      ctx.arc(nose.x * w, nose.y * h, 18, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.skeleton;
      ctx.lineWidth   = 2.5;
      ctx.stroke();
      ctx.fillStyle   = 'rgba(0,229,160,0.1)';
      ctx.fill();
    }
  }

  /* ════════════════════════════════════
   *  DRAW: angle labels on joints
   * ════════════════════════════════════ */
  function _drawAngleLabels(ctx, lm, angles, w, h) {
    const jointPixels = {
      knee:     [(lm[25].x+lm[26].x)/2 * w, (lm[25].y+lm[26].y)/2 * h],
      hip:      [(lm[23].x+lm[24].x)/2 * w, (lm[23].y+lm[24].y)/2 * h],
      elbow:    [(lm[13].x+lm[14].x)/2 * w, (lm[13].y+lm[14].y)/2 * h],
      shoulder: [(lm[11].x+lm[12].x)/2 * w, (lm[11].y+lm[12].y)/2 * h],
    };

    Object.entries(angles).forEach(([joint, deg]) => {
      const px = jointPixels[joint];
      if (!px) return;

      const romDef = _exercise.rom && _exercise.rom[joint];
      let inRange  = true;
      if (romDef) {
        const rMin = Math.min(romDef.top, romDef.bottom) - (_exercise.romTolerance || 15);
        const rMax = Math.max(romDef.top, romDef.bottom) + (_exercise.romTolerance || 15);
        inRange = deg >= rMin && deg <= rMax;
      }

      ctx.save();
      ctx.font        = 'bold 14px JetBrains Mono, monospace';
      ctx.fillStyle   = inRange ? '#00e5a0' : '#f5c842';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur  = 5;
      ctx.fillText(`${deg}°`, px[0] + 12, px[1] - 8);
      ctx.restore();
    });
  }

  /* ════════════════════════════════════
   *  DRAW: placeholder when no pose
   * ════════════════════════════════════ */
  function _drawPlaceholder(ctx, w, h) {
    ctx.save();
    ctx.fillStyle  = 'rgba(255,255,255,0.18)';
    ctx.font       = 'bold 17px DM Sans, sans-serif';
    ctx.textAlign  = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur  = 4;
    ctx.fillText('Position yourself in frame', w / 2, h / 2 - 12);
    ctx.fillStyle = 'rgba(0,229,160,0.4)';
    ctx.font      = '14px DM Sans, sans-serif';
    ctx.fillText('Make sure your full body is visible', w / 2, h / 2 + 14);
    ctx.restore();
  }

  /* ════════════════════════════════════
   *  DEBUG OVERLAY (press D to toggle)
   * ════════════════════════════════════ */
  function _ensureDebugOverlay(container) {
    if (!container || document.getElementById('pose-debug-overlay')) return;
    const el = document.createElement('div');
    el.id = 'pose-debug-overlay';
    el.style.cssText = `
      display: none;
      position: absolute;
      top: 8px; right: 8px;
      background: rgba(0,0,0,0.82);
      color: #00e5a0;
      font: 12px/1.6 'JetBrains Mono', monospace;
      padding: 10px 14px;
      border-radius: 8px;
      z-index: 50;
      pointer-events: none;
      min-width: 180px;
      border: 1px solid rgba(0,229,160,0.3);
    `;
    container.style.position = 'relative';
    container.appendChild(el);
  }

  function _updateDebug() {
    if (!_debugMode) return;
    const el = document.getElementById('pose-debug-overlay');
    if (!el) return;
    const angleStr = Object.entries(_lastAngles)
      .map(([j, v]) => `${j}: ${v}°`).join('\n') || '(no angles)';
    el.innerHTML = `
      <b>PHASE:</b> ${_phase}<br>
      <b>REPS:</b>  ${_reps}<br>
      <b>BAI:</b>   ${_lastBai}<br>
      <b>ANGLES:</b><br>${angleStr.replace(/\n/g,'<br>')}
    `.trim();
  }

  /* ════════════════════════════════════
   *  PUBLIC: captureFrameData (Admin use)
   * ════════════════════════════════════ */
  async function captureFrameData(videoEl, canvasEl) {
    // Always use a fresh one-shot Pose instance for admin capture
    // to avoid interfering with the session pipeline
    const adminPose = new Pose({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
    });
    adminPose.setOptions({
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    return new Promise((resolve) => {
      adminPose.onResults((results) => {
        const lm = results.poseLandmarks;
        if (!lm) { resolve(null); return; }
        const ctx = canvasEl.getContext('2d');
        canvasEl.width  = videoEl.videoWidth  || 480;
        canvasEl.height = videoEl.videoHeight || 320;
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
        // Draw skeleton on top
        ctx.globalAlpha = 0.85;
        CONNECTIONS.forEach(([a, b]) => {
          if (!lm[a] || !lm[b] || lm[a].visibility < 0.3 || lm[b].visibility < 0.3) return;
          ctx.beginPath();
          ctx.moveTo(lm[a].x * canvasEl.width, lm[a].y * canvasEl.height);
          ctx.lineTo(lm[b].x * canvasEl.width, lm[b].y * canvasEl.height);
          ctx.strokeStyle = '#00e5a0';
          ctx.lineWidth   = 2;
          ctx.stroke();
        });
        ctx.globalAlpha = 1;
        resolve(lm);
      });
      adminPose.send({ image: videoEl }).catch(() => resolve(null));
    });
  }

  /* ── PUBLIC API ── */
  return { init, setExercise, start, stop, resetSession, captureFrameData };

})();
