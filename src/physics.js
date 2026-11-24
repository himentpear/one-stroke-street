import * as planck from 'planck';
import { clamp } from './level.js';

export const timeStep = 1 / 120;

const CAT_WORLD = 0x0001;
const CAT_BALL = 0x0002;
const CAT_AWNING = 0x0004;
const CAT_ROOM = 0x0008;
const CAT_DEBRIS = 0x0010;
const CAT_SPRING = 0x0020;

const { Vec2 } = planck;

export function createPhysicsWorld(level) {
  const S = level.scale;
  const toM = px => px / S;
  const toPx = m => m * S;

  const world = new planck.World({
    gravity: Vec2(0, level.gravity),
    allowSleep: true
  });

  const state = {
    level,
    world,
    phase: 'ready',
    time: 0,
    steps: 0,
    quiet: 0,
    hitStop: 0,
    smashed: 0,
    attached: level.pins.map(() => true),
    roomsAlive: level.rooms.map(() => true),
    fractureOrder: [],
    events: [],
    debugImpulses: [],
    trail: [],
    spring: {
      status: 'ready', // 'ready' | 'compressing' | 'rebounding' | 'spent'
      compression: 0,
      velocity: 0,
      triggeredAt: null
    },
    bodies: new Map(), // id -> { id, kind, body, prev, curr, meta }
    pinJoints: [],
    roomJoints: new Map(),
    roofJoints: new Map(),
    chunks: []
  };

  function registerBody(id, kind, body, meta = {}) {
    const pos = body.getPosition();
    const angle = body.getAngle();
    const entry = {
      id,
      kind,
      body,
      meta,
      prev: { x: toPx(pos.x), y: toPx(pos.y), angle },
      curr: { x: toPx(pos.x), y: toPx(pos.y), angle }
    };
    body.setUserData({ id, kind, meta });
    state.bodies.set(id, entry);
    return entry;
  }

  // Static ground & outer walls
  const ground = world.createBody({ type: 'static', position: Vec2(0, 0) });
  ground.setUserData({ id: 'ground', kind: 'world' });
  const floorFix = { friction: 0.65, restitution: 0.16, filterCategoryBits: CAT_WORLD, filterMaskBits: 0xffff };
  ground.createFixture(planck.Edge(Vec2(0, toM(level.floor)), Vec2(toM(level.width), toM(level.floor))), floorFix);
  ground.createFixture(planck.Edge(Vec2(0, toM(-140)), Vec2(0, toM(level.floor))), { ...floorFix, restitution: 0.25 });
  ground.createFixture(planck.Edge(Vec2(toM(level.width), toM(-140)), Vec2(toM(level.width), toM(level.floor))), { ...floorFix, restitution: 0.25 });

  // Static building blocks (left tower + right shop base)
  for (const block of level.staticBlocks) {
    const cx = block.x + block.width / 2;
    const cy = block.y + block.height / 2;
    const body = world.createBody({ type: 'static', position: Vec2(toM(cx), toM(cy)) });
    body.createFixture(planck.Box(toM(block.width / 2), toM(block.height / 2)), {
      friction: 0.55,
      restitution: 0.12,
      filterCategoryBits: CAT_WORLD,
      filterMaskBits: 0xffff
    });
    registerBody(block.id, 'static-block', body, { width: block.width, height: block.height });
  }

  // Springboard top plate (kinematic/static sensor-like solid surface)
  const sp = level.spring;
  const spW = sp.right - sp.left;
  const spCx = (sp.left + sp.right) / 2;
  const spCy = sp.top + sp.thickness / 2;
  const springBody = world.createBody({ type: 'kinematic', position: Vec2(toM(spCx), toM(spCy)) });
  springBody.createFixture(planck.Box(toM(spW / 2), toM(sp.thickness / 2)), {
    friction: 0.3,
    restitution: 0.1,
    filterCategoryBits: CAT_SPRING,
    filterMaskBits: CAT_BALL | CAT_DEBRIS | CAT_AWNING
  });
  registerBody(sp.id, 'spring', springBody, { width: spW, height: sp.thickness, baseTop: sp.top });

  // Awning dynamic body + two breakable RevoluteJoints
  const aw = level.awning;
  const awCx = aw.x + aw.width / 2;
  const awCy = aw.y + aw.height / 2;
  const awningBody = world.createBody({
    type: 'dynamic',
    position: Vec2(toM(awCx), toM(awCy)),
    angularDamping: 0.45,
    linearDamping: 0.05
  });
  awningBody.createFixture(planck.Box(toM(aw.width / 2), toM(aw.height / 2)), {
    density: aw.density,
    friction: aw.friction,
    restitution: aw.restitution,
    filterCategoryBits: CAT_AWNING,
    filterMaskBits: CAT_WORLD | CAT_BALL | CAT_SPRING | CAT_DEBRIS
  });
  registerBody('awning', 'awning', awningBody, { width: aw.width, height: aw.height });

  level.pins.forEach((pin, idx) => {
    const joint = world.createJoint(planck.RevoluteJoint({
      enableLimit: true,
      lowerAngle: -aw.maxTilt,
      upperAngle: aw.maxTilt,
      collideConnected: false
    }, ground, awningBody, Vec2(toM(pin.x), toM(pin.y))));
    state.pinJoints[idx] = joint;
  });

  // Bowling ball dynamic body with CCD (bullet: true)
  const b = level.ball;
  const ballBody = world.createBody({
    type: 'dynamic',
    position: Vec2(toM(b.x), toM(b.y)),
    bullet: true,
    angularDamping: b.angularDamping,
    linearDamping: 0.02
  });
  ballBody.createFixture(planck.Circle(toM(b.radius)), {
    density: b.density,
    friction: b.friction,
    restitution: b.restitution,
    filterCategoryBits: CAT_BALL,
    filterMaskBits: CAT_WORLD | CAT_AWNING | CAT_ROOM | CAT_SPRING | CAT_DEBRIS
  });
  registerBody(b.id, 'ball', ballBody, { radius: b.radius });

  // Target rooms (dynamic rigid bodies held by breakable WeldJoints)
  const roomEntries = new Map();
  level.rooms.forEach((room, index) => {
    const cx = room.x + room.width / 2;
    const cy = room.y + room.height / 2;
    const body = world.createBody({
      type: 'dynamic',
      position: Vec2(toM(cx), toM(cy)),
      linearDamping: 0.08,
      angularDamping: 0.12
    });
    body.createFixture(planck.Box(toM(room.width / 2), toM(room.height / 2)), {
      density: room.density,
      friction: 0.5,
      restitution: 0.05,
      filterCategoryBits: CAT_ROOM,
      filterMaskBits: CAT_WORLD | CAT_BALL | CAT_DEBRIS | CAT_ROOM
    });
    const entry = registerBody(room.id, 'room', body, {
      index,
      width: room.width,
      height: room.height,
      breakImpulse: room.breakImpulse
    });
    roomEntries.set(room.id, entry);

    const weld = world.createJoint(planck.WeldJoint({
      frequencyHz: 18,
      dampingRatio: 0.9
    }, ground, body, Vec2(toM(cx), toM(cy))));
    state.roomJoints.set(room.id, weld);
  });

  // Roof cornices (dynamic rigid bodies welded to their supporting room; fall & collide when room breaks!)
  for (const roof of level.roofs) {
    const body = world.createBody({
      type: 'dynamic',
      position: Vec2(toM(roof.x), toM(roof.y)),
      linearDamping: 0.06,
      angularDamping: 0.14
    });
    body.createFixture(planck.Box(toM(roof.width / 2), toM(roof.height / 2)), {
      density: roof.density,
      friction: 0.55,
      restitution: 0.18,
      filterCategoryBits: CAT_DEBRIS,
      filterMaskBits: CAT_WORLD | CAT_ROOM | CAT_DEBRIS | CAT_SPRING
    });
    registerBody(roof.id, 'roof', body, {
      width: roof.width,
      height: roof.height,
      supportRoomId: roof.supportRoomId
    });
    const support = roomEntries.get(roof.supportRoomId);
    if (support) {
      const weld = world.createJoint(planck.WeldJoint({
        frequencyHz: 16,
        dampingRatio: 0.85
      }, support.body, body, Vec2(toM(roof.x), toM(roof.y + roof.height / 2))));
      state.roofJoints.set(roof.id, weld);
    }
  }

  // Post-step mutation queues (deduplicated by stable IDs)
  const pendingFractures = new Map(); // roomId -> { roomId, index, x, y, vx, vy, impulse, hitBody }
  let pendingSpringTrigger = null; // { body, contactX, contactY }
  const pendingImpacts = [];

  world.on('post-solve', (contact, impulse) => {
    const fA = contact.getFixtureA();
    const fB = contact.getFixtureB();
    const bA = fA.getBody();
    const bB = fB.getBody();
    const dA = bA.getUserData();
    const dB = bB.getUserData();
    if (!dA || !dB) return;

    const normalImp = (impulse.normalImpulses[0] || 0) + (impulse.normalImpulses[1] || 0);
    if (normalImp < 0.05) return;

    const wm = contact.getWorldManifold(null);
    const cp = wm && wm.points && wm.points[0] ? wm.points[0] : bA.getPosition();
    const px = toPx(cp.x);
    const py = toPx(cp.y);

    if (normalImp > 0.45) {
      state.debugImpulses.push({ x: px, y: py, impulse: normalImp, age: 0 });
      if (state.debugImpulses.length > 24) state.debugImpulses.shift();
    }

    // 1. Check room fracture by impulse threshold
    for (const [roomBody, roomData, otherBody, otherData] of [[bA, dA, bB, dB], [bB, dB, bA, dA]]) {
      if (roomData.kind === 'room' && state.roomsAlive[roomData.meta.index]) {
        const threshold = roomData.meta.breakImpulse;
        if (normalImp >= threshold && !pendingFractures.has(roomData.id)) {
          const vel = otherBody.getLinearVelocity();
          pendingFractures.set(roomData.id, {
            roomId: roomData.id,
            index: roomData.meta.index,
            x: px,
            y: py,
            vx: toPx(vel.x),
            vy: toPx(vel.y),
            impulse: normalImp,
            otherBody,
            otherKind: otherData.kind
          });
        }
      }
    }

    // 2. Check one-shot springboard trigger (first qualifying heavy body falling onto top surface)
    if (state.spring.status === 'ready' && !pendingSpringTrigger) {
      for (const [spBody, spData, otherBody, otherData] of [[bA, dA, bB, dB], [bB, dB, bA, dA]]) {
        if (spData.kind === 'spring' && otherBody.isDynamic()) {
          const mass = otherBody.getMass();
          const pos = otherBody.getPosition();
          const vel = otherBody.getLinearVelocity();
          if (mass >= sp.minMass && toPx(pos.y) <= sp.top + 6 && vel.y >= -0.8) {
            pendingSpringTrigger = { body: otherBody, id: otherData.id, x: px, y: sp.top };
          }
        }
      }
    }

    // 3. Heavy landing / clack sound & dust events
    if (normalImp >= 1.6) {
      const isBall = dA.kind === 'ball' || dB.kind === 'ball';
      const isWorld = dA.kind === 'world' || dB.kind === 'world' || dA.kind === 'static-block' || dB.kind === 'static-block';
      const isAwning = dA.kind === 'awning' || dB.kind === 'awning';
      if (isBall && isWorld) {
        pendingImpacts.push({ type: 'land', x: px, y: py, impulse: normalImp });
      } else if (isAwning && isWorld) {
        pendingImpacts.push({ type: 'clack', x: px, y: py, impulse: normalImp });
      } else if ((dA.kind === 'roof' || dB.kind === 'roof') && isWorld && normalImp >= 2.2) {
        pendingImpacts.push({ type: 'land', x: px, y: py, impulse: normalImp * 0.7 });
      }
    }
  });

  function snapshotPrev() {
    for (const entry of state.bodies.values()) {
      entry.prev.x = entry.curr.x;
      entry.prev.y = entry.curr.y;
      entry.prev.angle = entry.curr.angle;
    }
  }

  function snapshotCurr() {
    for (const entry of state.bodies.values()) {
      const pos = entry.body.getPosition();
      entry.curr.x = toPx(pos.x);
      entry.curr.y = toPx(pos.y);
      entry.curr.angle = entry.body.getAngle();
    }
  }

  function fractureRoom(roomId, info) {
    const entry = state.bodies.get(roomId);
    if (!entry) return;
    const idx = entry.meta.index;
    if (!state.roomsAlive[idx]) return;

    state.roomsAlive[idx] = false;
    state.smashed++;
    state.fractureOrder.push({ id: roomId, index: idx, order: state.smashed, x: entry.curr.x, y: entry.curr.y });

    // Remove room weld joint
    const weld = state.roomJoints.get(roomId);
    if (weld) {
      world.destroyJoint(weld);
      state.roomJoints.delete(roomId);
    }

    // Release any roof cornice supported by this room (it stays a colliding dynamic rigid body!)
    for (const roof of level.roofs) {
      if (roof.supportRoomId === roomId) {
        const rj = state.roofJoints.get(roof.id);
        if (rj) {
          world.destroyJoint(rj);
          state.roofJoints.delete(roof.id);
        }
        const roofEntry = state.bodies.get(roof.id);
        if (roofEntry) {
          roofEntry.body.setAwake(true);
          const dir = idx === 0 ? -1 : 1;
          roofEntry.body.applyAngularImpulse(dir * 0.65, true);
        }
      }
    }

    // If ball punched through a light cardboard room, restore forward momentum cleanly
    if (info.otherKind === 'ball' && info.otherBody) {
      const curV = info.otherBody.getLinearVelocity();
      const targetVx = Math.abs(info.vx) > Math.abs(toPx(curV.x)) ? toM(info.vx * 0.94) : curV.x;
      const targetVy = Math.abs(info.vy) > Math.abs(toPx(curV.y)) ? toM(info.vy * 0.96) : curV.y;
      info.otherBody.setLinearVelocity(Vec2(targetVx, targetVy));
    }

    // Replace intact room body with 2 major colliding cardboard chunks (dynamic rigid bodies!)
    const roomPos = entry.body.getPosition();
    const rx = toPx(roomPos.x);
    const ry = toPx(roomPos.y);
    const rw = entry.meta.width;
    const rh = entry.meta.height;
    world.destroyBody(entry.body);
    state.bodies.delete(roomId);

    const impScale = clamp(info.impulse / 4.5, 0.5, 2.2);
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const cw = rw * 0.44;
      const ch = rh * 0.46;
      const cx = rx + sign * rw * 0.24;
      const cy = ry + (side === 0 ? -4 : 6);
      const chunkBody = world.createBody({
        type: 'dynamic',
        position: Vec2(toM(cx), toM(cy)),
        linearVelocity: Vec2(
          toM(clamp(info.vx * 0.22, -90, 90) + sign * 42 * impScale),
          toM(-40 * impScale + clamp(info.vy * 0.12, -50, 40))
        ),
        angularVelocity: sign * (2.2 + impScale * 1.4),
        linearDamping: 0.08,
        angularDamping: 0.14
      });
      chunkBody.createFixture(planck.Box(toM(cw / 2), toM(ch / 2)), {
        density: 0.55,
        friction: 0.55,
        restitution: 0.2,
        filterCategoryBits: CAT_DEBRIS,
        filterMaskBits: CAT_WORLD | CAT_ROOM | CAT_DEBRIS | CAT_SPRING
      });
      const cid = roomId + '-chunk-' + side;
      registerBody(cid, 'chunk', chunkBody, { width: cw, height: ch, side });
      state.chunks.push(cid);
    }

    if (state.smashed === level.rooms.length) {
      state.hitStop = 0.08;
    }

    state.events.push({
      type: 'break',
      id: roomId,
      index: idx,
      count: state.smashed,
      x: rx,
      y: ry,
      vx: info.vx,
      vy: info.vy,
      impulse: info.impulse,
      isFinal: state.smashed === level.rooms.length
    });
  }

  function applyCut(hits) {
    if (state.phase !== 'ready' || !(hits.pins.some(Boolean) || hits.rooms.some(Boolean))) {
      return false;
    }
    state.phase = 'moving';
    snapshotPrev();

    // Wake up awning & ball
    const awningEntry = state.bodies.get('awning');
    const ballEntry = state.bodies.get('ball');
    awningEntry.body.setAwake(true);
    ballEntry.body.setAwake(true);

    hits.pins.forEach((hit, idx) => {
      if (hit && state.attached[idx]) {
        state.attached[idx] = false;
        const joint = state.pinJoints[idx];
        if (joint) {
          world.destroyJoint(joint);
          state.pinJoints[idx] = null;
        }
        const pin = level.pins[idx];
        state.events.push({ type: 'pin', id: pin.id, index: idx, x: pin.x, y: pin.y });
      }
    });

    hits.rooms.forEach((hit, idx) => {
      if (hit && state.roomsAlive[idx]) {
        const room = level.rooms[idx];
        fractureRoom(room.id, {
          roomId: room.id,
          index: idx,
          x: room.x + room.width / 2,
          y: room.y + room.height / 2,
          vx: 0,
          vy: -30,
          impulse: 2.2,
          otherKind: 'stroke',
          otherBody: null
        });
      }
    });

    state.trail.push({ x: ballEntry.curr.x, y: ballEntry.curr.y });
    return true;
  }

  function stepSpringVisual(dt) {
    const spring = state.spring;
    if (spring.status === 'ready') return;
    const rest = 8;
    const k = 320;
    const c = 15;
    const disp = spring.compression - rest;
    const acc = -k * disp - c * spring.velocity;
    spring.velocity += acc * dt;
    spring.compression = clamp(spring.compression + spring.velocity * dt, 0, 16);
    if (spring.status === 'compressing' && spring.velocity < 0) {
      spring.status = 'rebounding';
    }
    if (Math.abs(disp) < 0.08 && Math.abs(spring.velocity) < 0.15) {
      spring.compression = rest;
      spring.velocity = 0;
      spring.status = 'spent';
    }
    // Sync kinematic springboard collider top with visual compression
    const spEntry = state.bodies.get(sp.id);
    if (spEntry) {
      spEntry.body.setPosition(Vec2(toM(spCx), toM(sp.top + sp.thickness / 2 + spring.compression)));
    }
  }

  function step() {
    if (state.phase !== 'moving') return false;
    if (state.hitStop > 0) {
      state.hitStop = Math.max(0, state.hitStop - timeStep);
      return false;
    }

    snapshotPrev();
    pendingFractures.clear();
    pendingSpringTrigger = null;
    pendingImpacts.length = 0;

    world.step(timeStep, 8, 3);
    state.time += timeStep;
    state.steps++;

    // Execute queued room fractures strictly post-step (deduplicated by stable room ID)
    for (const [roomId, info] of pendingFractures.entries()) {
      fractureRoom(roomId, info);
    }

    // Execute queued one-shot springboard launch post-step
    if (pendingSpringTrigger && state.spring.status === 'ready') {
      const { body, x, y } = pendingSpringTrigger;
      state.spring.status = 'compressing';
      state.spring.compression = 12;
      state.spring.velocity = 120;
      state.spring.triggeredAt = state.time;
      body.setBullet(true);
      body.setAwake(true);
      // Apply clean directional impulse matching target launch velocity
      const cur = body.getLinearVelocity();
      const mass = body.getMass();
      const impX = mass * (sp.launchVx - cur.x);
      const impY = mass * (sp.launchVy - cur.y);
      body.applyLinearImpulse(Vec2(impX, impY), body.getWorldCenter(), true);
      body.setAngularVelocity(5.5);
      state.events.push({ type: 'spring', x, y, impulse: Math.hypot(impX, impY) });
    }

    // Deduplicate & forward significant impact events
    if (pendingImpacts.length) {
      let best = pendingImpacts[0];
      for (const imp of pendingImpacts) {
        if (imp.impulse > best.impulse) best = imp;
      }
      if (!state._lastImpactTime || state.time - state._lastImpactTime > 0.055) {
        state._lastImpactTime = state.time;
        state.events.push(best);
      }
    }

    stepSpringVisual(timeStep);
    snapshotCurr();

    // Age debug impulses
    for (let i = state.debugImpulses.length - 1; i >= 0; i--) {
      state.debugImpulses[i].age += timeStep;
      if (state.debugImpulses[i].age > 1.2) state.debugImpulses.splice(i, 1);
    }

    // Record dotted ball trajectory & apply gentle rolling resistance on street floor
    const ballEntry = state.bodies.get('ball');
    if (ballEntry) {
      if (ballEntry.curr.y >= level.floor - level.ball.radius - 2.5) {
        const v = ballEntry.body.getLinearVelocity();
        if (Math.abs(v.y) < 0.35) {
          ballEntry.body.setLinearVelocity(Vec2(v.x * Math.exp(-1.9 * timeStep), v.y));
          ballEntry.body.setAngularVelocity(ballEntry.body.getAngularVelocity() * Math.exp(-1.9 * timeStep));
        }
      }
      if (state.steps % 4 === 0) {
        const last = state.trail[state.trail.length - 1];
        if (!last || Math.hypot(ballEntry.curr.x - last.x, ballEntry.curr.y - last.y) > 3.5) {
          state.trail.push({ x: ballEntry.curr.x, y: ballEntry.curr.y });
        }
      }
    }

    // Check if dynamic bodies have settled
    let movingCount = 0;
    for (const entry of state.bodies.values()) {
      if (!entry.body.isDynamic()) continue;
      if (entry.kind === 'room' && state.roomsAlive[entry.meta.index]) continue;
      const v = entry.body.getLinearVelocity();
      const w = Math.abs(entry.body.getAngularVelocity());
      if (Math.hypot(v.x, v.y) > 0.16 || w > 0.28) {
        movingCount++;
      }
    }
    const springCalm = state.spring.status === 'ready' || state.spring.status === 'spent';
    state.quiet = (movingCount === 0 && springCalm) ? state.quiet + timeStep : 0;
    if (state.quiet > 0.65 || state.time > 7.5) {
      state.phase = 'done';
    }
    return true;
  }

  return { state, applyCut, step };
}
