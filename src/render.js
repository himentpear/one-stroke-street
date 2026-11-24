import { clamp } from './level.js';

const COLORS = {
  paper: '#F7F2E8',
  ink: '#252724',
  target: '#2168A3',
  pin: '#BC491B',
  wash: '#EFEADE',
  fine: '#D8D3C7',
  edge: '#A6A296',
  darkEdge: '#575851',
  windowFace: '#D9E5E6',
  windowDark: '#87939C',
  pinFace: '#F8D3B4'
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let view = { width: 600, height: 328, scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
  let previewStroke = null;
  let previewHits = null;
  let debug = false;

  // Visual-only effects (never participate in Box2D collision)
  let shards = [];
  let dusts = [];
  let rings = [];
  let slashes = [];
  let poppedPins = [];
  let springBursts = [];
  let shake = { x: 0, y: 0, vx: 0, vy: 0 };

  function resize(level) {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const scale = Math.min(cssW / level.width, cssH / level.height);
    const offsetX = (cssW - level.width * scale) / 2;
    const offsetY = (cssH - level.height * scale) / 2;
    view = { width: cssW, height: cssH, scale, offsetX, offsetY, dpr };
  }

  function screenToWorld(clientX, clientY, level) {
    const rect = canvas.getBoundingClientRect();
    if (Math.abs(rect.width - view.width) > 1 || Math.abs(rect.height - view.height) > 1) {
      resize(level);
    }
    const x = (clientX - rect.left - view.offsetX) / view.scale;
    const y = (clientY - rect.top - view.offsetY) / view.scale;
    return { x: clamp(x, 0, level.width), y: clamp(y, 0, level.height) };
  }

  function worldToScreen(wx, wy, level) {
    const rect = canvas.getBoundingClientRect();
    if (Math.abs(rect.width - view.width) > 1 || Math.abs(rect.height - view.height) > 1) {
      resize(level);
    }
    return {
      x: rect.left + view.offsetX + wx * view.scale,
      y: rect.top + view.offsetY + wy * view.scale
    };
  }

  function getScale() {
    return view.scale || 1;
  }

  function setDebug(enabled) {
    debug = Boolean(enabled);
  }

  function getDebug() {
    return debug;
  }

  function setPreview(stroke, hits) {
    previewStroke = stroke;
    previewHits = hits;
  }

  function clearPreview() {
    previewStroke = null;
    previewHits = null;
  }

  function resetFX() {
    clearPreview();
    shards = [];
    dusts = [];
    rings = [];
    slashes = [];
    poppedPins = [];
    springBursts = [];
    shake = { x: 0, y: 0, vx: 0, vy: 0 };
  }

  function getFXCounts() {
    return { shards: shards.length, poppedPins: poppedPins.length };
  }

  function flashCut(stroke, reduced) {
    slashes.push({
      x1: stroke.start.x,
      y1: stroke.start.y,
      x2: stroke.end.x,
      y2: stroke.end.y,
      age: 0,
      life: reduced ? 0.14 : 0.22,
      reduced
    });
  }

  function spawnDust(x, y, count, spread, lift) {
    for (let i = 0; i < count; i++) {
      const f = count > 1 ? i / (count - 1) - 0.5 : 0;
      dusts.push({
        x: x + f * 18,
        y: y - 2 - (i % 2) * 4,
        vx: f * spread + (i % 2 ? 10 : -10),
        vy: -lift - (i % 3) * 14,
        r0: 3.5 + (i % 3) * 1.4,
        r1: 11 + (i % 3) * 4,
        age: 0,
        life: 0.36 + (i % 3) * 0.08
      });
    }
  }

  function handleEvent(event, reduced) {
    if (event.type === 'pin') {
      poppedPins.push({
        x: event.x,
        y: event.y,
        vx: event.index === 0 ? -56 : 60,
        vy: -150,
        angle: 0,
        omega: event.index === 0 ? -7.5 : 7.8,
        landed: false
      });
      if (!reduced) {
        rings.push({ x: event.x, y: event.y, r0: 6, r1: 22, age: 0, life: 0.18, color: COLORS.pin });
      }
      return;
    }

    if (event.type === 'break') {
      const imp = clamp((event.impulse || 2.5) / 3.5, 0.55, 2.2);
      if (!reduced) {
        rings.push({ x: event.x, y: event.y, r0: 8, r1: event.isFinal ? 54 : 38, age: 0, life: 0.24, color: COLORS.target });
        // Causality first: only the heaviest impact or final room gives brief subtle displacement
        if (event.isFinal || event.impulse > 5.8) {
          const mag = event.isFinal ? 55 : 32;
          shake.vx += clamp((event.vx || 0) * 0.15, -mag, mag);
          shake.vy += mag * 0.85;
        }
      }
      spawnDust(event.x, event.y, event.isFinal ? 6 : 4, 110 * imp, 42 * imp);

      // Strictly 6 visual-only small shards per broken room, flying farther with heavier impact
      const baseVx = clamp((event.vx || 0) * 0.26, -120, 120);
      const baseVy = clamp((event.vy || 0) * 0.14, -65, 50);
      for (let i = 0; i < 6; i++) {
        const large = i === 1 || i === 4;
        shards.push({
          x: event.x - 24 + i * 9.5,
          y: event.y + ((i % 2) ? 5 : -4),
          vx: (i - 2.5) * 32 * imp + baseVx,
          vy: (-64 - (i * 19) % 62) * imp + baseVy,
          angle: i * 0.45,
          omega: (i - 2.5) * 4.5 * imp,
          large,
          landed: false
        });
      }
      return;
    }

    if (event.type === 'spring') {
      spawnDust(event.x, event.y + 4, 4, 85, 48);
      if (!reduced) {
        for (let i = 0; i < 2; i++) {
          springBursts.push({ x: event.x + i * 10, y: event.y - 6 - i * 8, vx: 65, vy: -115, age: 0, life: 0.28 + i * 0.06 });
        }
      }
      return;
    }

    if (event.type === 'land') {
      const imp = clamp((event.impulse || 2) / 5, 0.25, 1.2);
      spawnDust(event.x, event.y, imp > 0.7 ? 4 : 2, 70 * imp, 30 * imp);
      if (!reduced && event.impulse > 6.5) {
        shake.vy += 38 * imp;
      }
    }
  }

  function stepFX(dt, level, reduced) {
    const g = level.gravity * level.scale;
    const floor = level.floor;

    for (const s of shards) {
      if (s.landed) continue;
      s.vy += g * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.angle += s.omega * dt;
      const half = s.large ? 6 : 3;
      if (s.x < half || s.x > level.width - half) {
        s.x = clamp(s.x, half, level.width - half);
        s.vx *= -0.35;
      }
      if (s.y + half >= floor) {
        s.y = floor - half;
        if (s.vy > 48) {
          s.vy = -s.vy * 0.32;
          s.vx *= 0.72;
          s.omega *= 0.65;
        } else {
          s.vy = 0;
          s.vx *= Math.exp(-10 * dt);
          s.omega *= Math.exp(-10 * dt);
          if (Math.abs(s.vx) < 4) s.landed = true;
        }
      }
    }

    for (const p of poppedPins) {
      if (p.landed) continue;
      p.vy += g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.omega * dt;
      const r = 7;
      if (p.x < r || p.x > level.width - r) {
        p.x = clamp(p.x, r, level.width - r);
        p.vx *= -0.4;
      }
      if (p.y + r >= floor) {
        p.y = floor - r;
        if (p.vy > 44) {
          p.vy = -p.vy * 0.38;
          p.vx *= 0.78;
        } else {
          p.vy = 0;
          p.vx *= Math.exp(-8 * dt);
          p.omega *= Math.exp(-8 * dt);
          if (Math.abs(p.vx) < 3) p.landed = true;
        }
      }
    }

    for (let i = dusts.length - 1; i >= 0; i--) {
      const d = dusts[i];
      d.age += dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= Math.exp(-3.4 * dt);
      d.vy *= Math.exp(-3.4 * dt);
      if (d.age >= d.life) dusts.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].age += dt;
      if (rings[i].age >= rings[i].life) rings.splice(i, 1);
    }
    for (let i = slashes.length - 1; i >= 0; i--) {
      slashes[i].age += dt;
      if (slashes[i].age >= slashes[i].life) slashes.splice(i, 1);
    }
    for (let i = springBursts.length - 1; i >= 0; i--) {
      const b = springBursts[i];
      b.age += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= Math.exp(-4 * dt);
      b.vy *= Math.exp(-4 * dt);
      if (b.age >= b.life) springBursts.splice(i, 1);
    }

    if (reduced) {
      shake.x = shake.y = shake.vx = shake.vy = 0;
    } else {
      shake.vx += (-320 * shake.x - 22 * shake.vx) * dt;
      shake.vy += (-320 * shake.y - 22 * shake.vy) * dt;
      shake.x = clamp(shake.x + shake.vx * dt, -3.5, 3.5);
      shake.y = clamp(shake.y + shake.vy * dt, -3.5, 3.5);
      if (Math.hypot(shake.x, shake.y) < 0.05 && Math.hypot(shake.vx, shake.vy) < 0.3) {
        shake.x = shake.y = shake.vx = shake.vy = 0;
      }
    }
  }

  function interp(entry, alpha) {
    return {
      x: lerp(entry.prev.x, entry.curr.x, alpha),
      y: lerp(entry.prev.y, entry.curr.y, alpha),
      angle: lerpAngle(entry.prev.angle, entry.curr.angle, alpha)
    };
  }

  function drawBackground(level) {
    // Paper white background
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, level.width, level.height);

    // Subtle drafting dot grid
    ctx.fillStyle = 'rgba(87, 88, 81, 0.16)';
    for (let y = 10; y < level.height; y += 14) {
      for (let x = 10; x < level.width; x += 14) {
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Far cardboard street silhouettes (15% ink tone)
    ctx.fillStyle = COLORS.wash;
    ctx.strokeStyle = COLORS.fine;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    const farShapes = [
      [[12, 309], [12, 254], [25, 254], [25, 248], [48, 248], [48, 239], [65, 239], [65, 309]],
      [[292, 309], [292, 276], [311, 276], [311, 264], [341, 264], [341, 309]],
      [[344, 309], [344, 244], [352, 244], [352, 237], [375, 237], [375, 244], [388, 244], [388, 309]],
      [[548, 309], [548, 258], [566, 258], [566, 251], [579, 251], [579, 272], [591, 272], [591, 309]]
    ];
    for (const pts of farShapes) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Main left building & hollow central well + right shop plinth
    ctx.fillStyle = COLORS.wash;
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 1.25;
    // Left tower facade
    ctx.fillRect(53, 122, 39, 187);
    ctx.strokeRect(53, 122, 39, 187);
    // Left tower roof bevel
    ctx.beginPath();
    ctx.moveTo(53, 122);
    ctx.lineTo(62, 113);
    ctx.lineTo(96, 113);
    ctx.lineTo(92, 122);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Central hollow well interior lines (shows the shaft clearly!)
    ctx.fillStyle = 'rgba(216, 211, 199, 0.25)';
    ctx.fillRect(96, 89, 96, 220);
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 1.1;
    ctx.strokeRect(102, 113, 84, 196);

    // Left tower decorative windows (1px inner detail)
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 1;
    for (let wy = 132; wy <= 204; wy += 24) {
      ctx.strokeRect(62, wy, 22, 14);
    }
    ctx.strokeRect(66, 240, 20, 69);

    // Awning top support bracket
    ctx.fillStyle = COLORS.paper;
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(86, 76);
    ctx.lineTo(86, 63);
    ctx.lineTo(202, 63);
    ctx.lineTo(202, 76);
    ctx.lineTo(194, 76);
    ctx.lineTo(194, 68);
    ctx.lineTo(94, 68);
    ctx.lineTo(94, 76);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Right shop plinth
    ctx.fillStyle = COLORS.wash;
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 1.25;
    ctx.fillRect(419, 276, 112, 33);
    ctx.strokeRect(419, 276, 112, 33);
    ctx.lineWidth = 1;
    ctx.strokeRect(427, 284, 21, 25);
    ctx.strokeRect(455, 285, 21, 15);
    ctx.strokeRect(483, 285, 21, 15);

    // Street floor & curb dashes
    ctx.strokeStyle = COLORS.darkEdge;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(18, level.floor);
    ctx.lineTo(582, level.floor);
    ctx.stroke();
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 1.2;
    for (const [x1, x2] of [[37, 105], [142, 287], [358, 426], [514, 567]]) {
      ctx.beginPath();
      ctx.moveTo(x1, level.floor + 6);
      ctx.lineTo(x2, level.floor + 6);
      ctx.stroke();
    }
  }

  function drawRoom(x, y, w, h, angle, highlighted) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const hw = w / 2;
    const hh = h / 2;
    const strokeCol = highlighted ? COLORS.pin : COLORS.target;
    const faceCol = highlighted ? COLORS.pinFace : COLORS.windowFace;

    // Cardboard side & top thickness fold
    ctx.fillStyle = COLORS.wash;
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-hw - 8, -hh + 4);
    ctx.lineTo(-hw, -hh);
    ctx.lineTo(-hw, hh);
    ctx.lineTo(-hw - 8, hh - 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-hw, -hh);
    ctx.lineTo(-hw + 8, -hh - 6);
    ctx.lineTo(hw + 7, -hh - 6);
    ctx.lineTo(hw, -hh);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Main room facade (2px main contour)
    ctx.fillStyle = faceCol;
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 2;
    ctx.fillRect(-hw, -hh, w, h);
    ctx.strokeRect(-hw, -hh, w, h);

    // Bottom sill band
    ctx.fillStyle = strokeCol;
    ctx.fillRect(-hw, hh - 5, w, 5);

    // Three lit windows (recognizable by shape!)
    for (const wx of [-hw + 8, -hw + 27.5, -hw + 47]) {
      ctx.fillStyle = strokeCol;
      ctx.fillRect(wx, -hh + 7, 13, 22);
      ctx.strokeStyle = faceCol;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(wx, -hh + 17);
      ctx.lineTo(wx + 13, -hh + 17);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawChunk(x, y, w, h, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const hw = w / 2;
    const hh = h / 2;
    // Torn cardboard chunk with extinguished windows (clear contour!)
    ctx.fillStyle = COLORS.wash;
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-hw, -hh);
    ctx.lineTo(hw - 3, -hh);
    ctx.lineTo(hw, -hh + 5);
    ctx.lineTo(hw - 2, hh);
    ctx.lineTo(-hw + 3, hh);
    ctx.lineTo(-hw, hh - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Extinguished window pane
    ctx.fillStyle = COLORS.windowDark;
    ctx.fillRect(-hw + 6, -hh + 5, Math.max(8, w - 14), Math.max(6, h - 11));
    ctx.restore();
  }

  function drawRoof(x, y, w, h, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const hw = w / 2;
    const hh = h / 2;
    ctx.fillStyle = COLORS.paper;
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-hw, 1);
    ctx.lineTo(hw, 1);
    ctx.lineTo(hw - 4, hh);
    ctx.lineTo(-hw + 4, hh);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = COLORS.wash;
    ctx.beginPath();
    ctx.moveTo(-hw + 7, 1);
    ctx.lineTo(-hw + 7, -4);
    ctx.lineTo(-16, -4);
    ctx.lineTo(-16, -hh);
    ctx.lineTo(16, -hh);
    ctx.lineTo(16, -4);
    ctx.lineTo(hw - 7, -4);
    ctx.lineTo(hw - 7, 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-11, -4);
    ctx.lineTo(11, -4);
    ctx.moveTo(-hw + 10, 5);
    ctx.lineTo(hw - 10, 5);
    ctx.stroke();
    ctx.restore();
  }

  function drawSpring(level, springState) {
    const sp = level.spring;
    const comp = springState.compression;
    const topY = sp.top + comp;
    const baseY = sp.baseY;
    const spent = springState.status === 'spent';
    const active = springState.status === 'compressing' || springState.status === 'rebounding';

    // Base plate
    ctx.fillStyle = COLORS.paper;
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 1.3;
    ctx.fillRect(sp.left - 2, baseY, sp.right - sp.left + 4, 7);
    ctx.strokeRect(sp.left - 2, baseY, sp.right - sp.left + 4, 7);

    // Accordion coils (dynamically compressed!)
    ctx.strokeStyle = spent ? COLORS.edge : COLORS.ink;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    for (const cx of [sp.left + 21, sp.right - 21]) {
      ctx.beginPath();
      const segs = 4;
      const span = Math.max(4, baseY - (topY + sp.thickness));
      ctx.moveTo(cx, baseY);
      for (let i = 1; i <= segs; i++) {
        const y = baseY - (span * i) / segs;
        const dx = i === segs ? 0 : (i % 2 ? 7 : -7);
        ctx.lineTo(cx + dx, y);
      }
      ctx.stroke();
    }

    // Cardboard top pad
    ctx.fillStyle = active ? COLORS.pinFace : COLORS.paper;
    ctx.strokeStyle = spent ? COLORS.darkEdge : COLORS.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sp.left, topY);
    ctx.lineTo(sp.right, topY);
    ctx.lineTo(sp.right - 5, topY + sp.thickness);
    ctx.lineTo(sp.left + 5, topY + sp.thickness);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Directional launch arrow (shape-readable + shows spent state!)
    const midX = (sp.left + sp.right) / 2;
    const ang = Math.atan2(sp.launchVy, sp.launchVx);
    ctx.save();
    ctx.translate(midX, topY - 12);
    ctx.rotate(ang);
    ctx.strokeStyle = spent ? COLORS.edge : (active ? COLORS.pin : COLORS.ink);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(10, 0);
    ctx.moveTo(4, -6);
    ctx.lineTo(10, 0);
    ctx.lineTo(4, 6);
    ctx.stroke();
    ctx.restore();
  }

  function drawAwning(x, y, w, h, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const hw = w / 2;
    const hh = h / 2;

    // Scalloped cardboard awning body
    ctx.fillStyle = COLORS.paper;
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-hw, -hh);
    ctx.lineTo(hw, -hh);
    ctx.lineTo(hw, 2);
    const teeth = 8;
    const step = w / teeth;
    for (let i = teeth; i > 0; i--) {
      const rx = -hw + i * step;
      ctx.lineTo(rx - step / 2, hh + 2);
      ctx.lineTo(rx - step, 2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Diagonal cardboard hatch lines
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 1;
    for (let hx = -hw + 6; hx < hw - 2; hx += 8) {
      ctx.beginPath();
      ctx.moveTo(hx, -hh + 1);
      ctx.lineTo(hx - 4, 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPin(x, y, highlighted) {
    ctx.save();
    ctx.translate(x, y);
    if (highlighted) {
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(188, 73, 27, 0.22)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.pinFace;
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = COLORS.pin;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.pin;
    ctx.fill();
    ctx.restore();
  }

  function drawBall(x, y, r, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Heavy ink-black bowling ball
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.ink;
    ctx.fill();
    // Subtle cardboard rim crease
    ctx.beginPath();
    ctx.arc(0, 0, r - 1.5, -Math.PI * 0.75, -Math.PI * 0.2);
    ctx.strokeStyle = 'rgba(247, 242, 232, 0.24)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Three paper-white finger holes (makes spin immediately readable!)
    ctx.fillStyle = COLORS.paper;
    for (const [hx, hy, hr] of [[-5, -4, 2.4], [1, -7, 2.2], [1, 0, 2.1]]) {
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDebugOverlay(state, alpha) {
    const S = state.level.scale;
    ctx.save();
    // 1. Collision shapes
    for (let body = state.world.getBodyList(); body; body = body.getNext()) {
      const ud = body.getUserData();
      const entry = ud && state.bodies.get(ud.id);
      const pos = entry ? interp(entry, alpha) : { x: body.getPosition().x * S, y: body.getPosition().y * S, angle: body.getAngle() };
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(pos.angle);
      ctx.strokeStyle = body.isDynamic() ? 'rgba(0, 145, 255, 0.85)' : 'rgba(16, 160, 90, 0.75)';
      ctx.lineWidth = 1.2;
      for (let fix = body.getFixtureList(); fix; fix = fix.getNext()) {
        const shape = fix.getShape();
        const type = shape.getType();
        if (type === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, shape.m_radius * S, 0, Math.PI * 2);
          ctx.stroke();
        } else if (type === 'polygon') {
          const verts = shape.m_vertices;
          ctx.beginPath();
          ctx.moveTo(verts[0].x * S, verts[0].y * S);
          for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x * S, verts[i].y * S);
          ctx.closePath();
          ctx.stroke();
        } else if (type === 'edge') {
          ctx.beginPath();
          ctx.moveTo(shape.m_vertex1.x * S, shape.m_vertex1.y * S);
          ctx.lineTo(shape.m_vertex2.x * S, shape.m_vertex2.y * S);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 2. Active joints
    ctx.strokeStyle = '#D91A72';
    ctx.fillStyle = '#D91A72';
    ctx.lineWidth = 1.4;
    for (let joint = state.world.getJointList(); joint; joint = joint.getNext()) {
      const a = joint.getAnchorA();
      const b = joint.getAnchorB();
      ctx.beginPath();
      ctx.moveTo(a.x * S, a.y * S);
      ctx.lineTo(b.x * S, b.y * S);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(a.x * S, a.y * S, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Contact impulses
    ctx.font = '600 9px ui-monospace, monospace';
    for (const imp of state.debugImpulses) {
      const fade = clamp(1 - imp.age / 1.2, 0, 1);
      ctx.fillStyle = 'rgba(188, 73, 27, ' + fade.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(imp.x, imp.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(imp.impulse.toFixed(1), imp.x + 5, imp.y - 3);
    }

    // 4. Fracture order badges
    ctx.font = '700 11px ui-monospace, monospace';
    for (const f of state.fractureOrder) {
      ctx.fillStyle = 'rgba(33, 104, 163, 0.9)';
      ctx.fillRect(f.x - 10, f.y - 9, 20, 16);
      ctx.fillStyle = COLORS.paper;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('#' + f.order, f.x, f.y);
    }
    ctx.restore();
  }

  function render(state, alpha = 1) {
    const level = state.level;
    resize(level);
    ctx.save();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, view.width, view.height);

    ctx.translate(view.offsetX + shake.x * view.scale, view.offsetY + shake.y * view.scale);
    ctx.scale(view.scale, view.scale);

    // Clip to logical 600x328 canvas frame
    ctx.beginPath();
    ctx.rect(0, 0, level.width, level.height);
    ctx.clip();

    drawBackground(level);

    // Dotted ball trail
    if (state.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(87, 88, 81, 0.55)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([2, 5]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(state.trail[0].x, state.trail[0].y);
      for (let i = 1; i < state.trail.length; i++) {
        ctx.lineTo(state.trail[i].x, state.trail[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Dust puffs (behind foreground bodies)
    for (const d of dusts) {
      const p = clamp(d.age / d.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.55 * (1 - p);
      ctx.fillStyle = COLORS.wash;
      ctx.strokeStyle = COLORS.edge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(d.x, d.y, lerp(d.r0, d.r1, p), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Springboard
    drawSpring(level, state.spring);

    // Intact target rooms
    level.rooms.forEach((room, idx) => {
      if (!state.roomsAlive[idx]) return;
      const entry = state.bodies.get(room.id);
      if (!entry) return;
      const pos = interp(entry, alpha);
      const hit = Boolean(previewHits && previewHits.rooms[idx]);
      drawRoom(pos.x, pos.y, room.width, room.height, pos.angle, hit);
    });

    // Broken colliding cardboard chunks
    for (const cid of state.chunks) {
      const entry = state.bodies.get(cid);
      if (!entry) continue;
      const pos = interp(entry, alpha);
      drawChunk(pos.x, pos.y, entry.meta.width, entry.meta.height, pos.angle);
    }

    // Roof cornices (real Box2D bodies)
    for (const roof of level.roofs) {
      const entry = state.bodies.get(roof.id);
      if (!entry) continue;
      const pos = interp(entry, alpha);
      drawRoof(pos.x, pos.y, roof.width, roof.height, pos.angle);
    }

    // Awning
    const awningEntry = state.bodies.get('awning');
    if (awningEntry) {
      const pos = interp(awningEntry, alpha);
      drawAwning(pos.x, pos.y, level.awning.width, level.awning.height, pos.angle);
    }

    // Attached pins
    level.pins.forEach((pin, idx) => {
      if (!state.attached[idx]) return;
      const hit = Boolean(previewHits && previewHits.pins[idx]);
      drawPin(pin.x, pin.y, hit);
    });

    // Visual-only small paper shards (max 6 per broken room)
    for (const s of shards) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.beginPath();
      if (s.large) {
        ctx.moveTo(-10, -5);
        ctx.lineTo(10, -5);
        ctx.lineTo(10, 2);
        ctx.lineTo(4, -1);
        ctx.lineTo(1, 5);
        ctx.lineTo(-10, 5);
        ctx.closePath();
        ctx.fillStyle = COLORS.windowFace;
        ctx.fill();
        ctx.strokeStyle = COLORS.target;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.moveTo(-5, -2);
        ctx.lineTo(5, -2);
        ctx.lineTo(3, 2);
        ctx.lineTo(-5, 2);
        ctx.closePath();
        ctx.fillStyle = COLORS.target;
        ctx.fill();
      }
      ctx.restore();
    }

    // Popped pins
    for (const p of poppedPins) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.pinFace;
      ctx.fill();
      ctx.strokeStyle = COLORS.pin;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 2.8, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.pin;
      ctx.fill();
      ctx.restore();
    }

    // Impact rings
    for (const r of rings) {
      const p = clamp(r.age / r.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.65 * (1 - p);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, lerp(r.r0, r.r1, p), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Spring launch chevrons
    for (const b of springBursts) {
      const p = clamp(b.age / b.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.65 * (1 - p);
      ctx.translate(b.x, b.y);
      ctx.rotate(0.5);
      ctx.scale(0.85 + 0.45 * p, 0.85 + 0.45 * p);
      ctx.strokeStyle = COLORS.darkEdge;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-10, 5);
      ctx.lineTo(0, -5);
      ctx.lineTo(10, 5);
      ctx.stroke();
      ctx.restore();
    }

    // Bowling ball
    const ballEntry = state.bodies.get('ball');
    if (ballEntry) {
      const pos = interp(ballEntry, alpha);
      drawBall(pos.x, pos.y, level.ball.radius, pos.angle);
    }

    // Fading slash mark after release
    for (const s of slashes) {
      const p = clamp(s.age / s.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.lineCap = 'round';
      ctx.strokeStyle = COLORS.pin;
      ctx.lineWidth = 6 * (1 - p * 0.7);
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      if (!s.reduced) {
        ctx.strokeStyle = COLORS.paper;
        ctx.lineWidth = 2.4 * (1 - p * 0.8);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Active drag stroke preview
    if (previewStroke) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = COLORS.paper;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(previewStroke.start.x, previewStroke.start.y);
      ctx.lineTo(previewStroke.end.x, previewStroke.end.y);
      ctx.stroke();

      ctx.strokeStyle = COLORS.pin;
      ctx.lineWidth = 3.5;
      ctx.stroke();

      if (previewStroke.capped) {
        ctx.beginPath();
        ctx.arc(previewStroke.end.x, previewStroke.end.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.paper;
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = COLORS.pin;
        ctx.stroke();
      }
      ctx.restore();
    }

    if (debug) drawDebugOverlay(state, alpha);
    ctx.restore();
  }

  return {
    resize,
    screenToWorld,
    worldToScreen,
    getScale,
    setDebug,
    getDebug,
    setPreview,
    clearPreview,
    resetFX,
    getFXCounts,
    flashCut,
    handleEvent,
    stepFX,
    render
  };
}
