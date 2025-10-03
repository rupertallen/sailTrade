import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const MAP_SIZE = 10000
const ISLAND_COUNT = 16
const MIN_ISLAND_GAP = 900
const TWO_PI = Math.PI * 2
const MAX_FORWARD_SPEED = 260 // world units per second
const ACCELERATION = 140
const BRAKE_DECELERATION = 220
const TURN_RATE = 1.8

const controlKeys = {
  forward: ['w', 'arrowup'],
  backward: ['s', 'arrowdown'],
  left: ['a', 'arrowleft'],
  right: ['d', 'arrowright'],
}

const BOAT_COLLISION_OUTLINE = [
  { x: 58, y: 0 },
  { x: 44, y: 18 },
  { x: 44, y: -18 },
  { x: 20, y: 26 },
  { x: 20, y: -26 },
  { x: -8, y: 30 },
  { x: -8, y: -30 },
  { x: -38, y: 18 },
  { x: -38, y: -18 },
  { x: -52, y: 0 },
]

const MAX_BOAT_EXTENT = BOAT_COLLISION_OUTLINE.reduce(
  (max, point) => Math.max(max, Math.hypot(point.x, point.y)),
  0,
)

const MINIMAP_WORLD_RADIUS = 2200
const COLLISION_EDGE_THRESHOLD = 6
const islandTextureCache = new WeakMap()

function generateRandomSeed() {
  if (typeof crypto !== 'undefined' && crypto?.getRandomValues) {
    const array = crypto.getRandomValues(new Uint32Array(2))
    return Array.from(array, (num) => num.toString(36)).join('').slice(0, 16)
  }
  return Math.random().toString(36).slice(2, 10)
}

function cyrb128(str) {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762

  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 597399067) >>> 0
    h2 = Math.imul(h2 ^ ch, 2869860233) >>> 0
    h3 = Math.imul(h3 ^ ch, 951274213) >>> 0
    h4 = Math.imul(h4 ^ ch, 2716044179) >>> 0
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067) >>> 0
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233) >>> 0
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213) >>> 0
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179) >>> 0

  return [h1, h2, h3, h4]
}

function sfc32(a, b, c, d) {
  return function random() {
    a >>>= 0
    b >>>= 0
    c >>>= 0
    d >>>= 0
    const t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = ((c << 21) | (c >>> 11)) >>> 0
    c = (c + t) | 0
    d = (d + 1) | 0
    const result = (t + d) | 0
    return (result >>> 0) / 4294967296
  }
}

function createSeededRng(seedValue) {
  const normalizedSeed = seedValue?.toString().trim() ?? ''
  const [a, b, c, d] = cyrb128(normalizedSeed)
  const random = sfc32(a, b, c, d)
  // Warm up the generator to disperse initial values
  for (let i = 0; i < 12; i += 1) {
    random()
  }
  return random
}

function createInitialBoatState() {
  return {
    x: MAP_SIZE / 2,
    y: MAP_SIZE / 2,
    heading: -Math.PI / 2,
    speed: 0,
    sailLevel: 0.4,
    sailTarget: 0.4,
    idleTime: 0,
    anchorState: 'stowed',
    anchorProgress: 0,
    wakeTimer: 0,
  }
}

function normalizeAngle(angle) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI
}

function shortestAngleDiff(a, b) {
  const wrapped = normalizeAngle(a - b + Math.PI)
  return wrapped - Math.PI
}

function gaussianFalloff(diff, width) {
  const ratio = diff / width
  return Math.exp(-(ratio * ratio))
}

function isAngleBetween(angle, start, end) {
  const diff = normalizeAngle(end - start)
  const offset = normalizeAngle(angle - start)
  return offset <= diff
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace('#', '')
  const parseValue = (value) => value * 17
  let r
  let g
  let b

  if (normalized.length === 3) {
    r = parseValue(parseInt(normalized[0], 16))
    g = parseValue(parseInt(normalized[1], 16))
    b = parseValue(parseInt(normalized[2], 16))
  } else {
    const intValue = parseInt(normalized, 16)
    r = (intValue >> 16) & 255
    g = (intValue >> 8) & 255
    b = intValue & 255
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function generateCoastlineShape(radius, random = Math.random) {
  const segments = 46 + Math.floor(random() * 20)
  const mainPhase = random() * TWO_PI
  const secondaryPhase = random() * TWO_PI
  const detailPhase = random() * TWO_PI
  const microPhase = random() * TWO_PI

  const mainAmplitude = 0.18 + random() * 0.08
  const secondaryAmplitude = 0.12 + random() * 0.06
  const detailAmplitude = 0.08 + random() * 0.04
  const microAmplitude = 0.05 + random() * 0.03
  const jitterStrength = 0.08 + random() * 0.06

  const headlands = Array.from({ length: 3 }, () => ({
    angle: random() * TWO_PI,
    width: 0.6 + random() * 0.6,
    strength: 0.16 + random() * 0.26,
  }))

  const coves = Array.from({ length: 2 }, () => ({
    angle: random() * TWO_PI,
    width: 0.8 + random() * 0.9,
    strength: 0.12 + random() * 0.22,
  }))

  const points = []

  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * TWO_PI
    let multiplier = 1

    multiplier += Math.sin(angle * 1.1 + mainPhase) * mainAmplitude
    multiplier += Math.sin(angle * 2.4 + secondaryPhase) * secondaryAmplitude
    multiplier += Math.sin(angle * 4.8 + detailPhase) * detailAmplitude
    multiplier += Math.sin(angle * 7.3 + microPhase) * microAmplitude

    for (const headland of headlands) {
      const diff = shortestAngleDiff(angle, headland.angle)
      multiplier += gaussianFalloff(diff, headland.width) * headland.strength
    }

    for (const cove of coves) {
      const diff = shortestAngleDiff(angle, cove.angle)
      multiplier -= gaussianFalloff(diff, cove.width) * cove.strength
    }

    multiplier += (random() - 0.5) * jitterStrength

    const clampedMultiplier = Math.max(0.48, Math.min(1.48, multiplier))
    const r = radius * clampedMultiplier
    points.push({
      angle,
      radius: r,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
    })
  }

  return points
}

function createInnerRing(points, scale, jitter, random = Math.random) {
  return points.map((point) => {
    const jitterAmount = 1 + (random() - 0.5) * jitter
    const r = Math.min(point.radius * 0.995, point.radius * scale * jitterAmount)
    return {
      angle: point.angle,
      radius: r,
      x: Math.cos(point.angle) * r,
      y: Math.sin(point.angle) * r,
    }
  })
}

function generateCliffs(random = Math.random) {
  const cliffs = []
  const cliffGroups = random() < 0.3 ? 0 : 1 + Math.floor(random() * 2)
  for (let i = 0; i < cliffGroups; i += 1) {
    const startAngle = random() * TWO_PI
    const width = 0.32 + random() * 0.55
    cliffs.push({
      startAngle,
      endAngle: startAngle + width,
      layers: 2 + Math.floor(random() * 3),
    })
  }
  return cliffs
}

function generateTreeClusters(canopyPoints, radius, random = Math.random) {
  const clusterCount = 4 + Math.floor(random() * 6)
  const clusters = []

  for (let i = 0; i < clusterCount; i += 1) {
    const anchor = canopyPoints[Math.floor(random() * canopyPoints.length)]
    const clusterRadius = radius * (0.09 + random() * 0.14)
    const treeCount = 10 + Math.floor(random() * 18)
    const trees = []

    for (let j = 0; j < treeCount; j += 1) {
      const angle = random() * TWO_PI
      const distance = Math.sqrt(random()) * clusterRadius
      const x = anchor.x + Math.cos(angle) * distance
      const y = anchor.y + Math.sin(angle) * distance
      const size = radius * (0.024 + random() * 0.045)
      const type = random() < 0.45 ? 'conifer' : 'broadleaf'
      const lean = (random() - 0.5) * 0.6
      const layers = type === 'conifer' ? 3 + Math.floor(random() * 3) : 2 + Math.floor(random() * 2)
      trees.push({ x, y, size, type, lean, layers })
    }

    clusters.push({ trees })
  }

  return clusters
}

function generateStreams(coastline, radius, random = Math.random) {
  const streams = []
  let streamCount = 0
  const roll = random()
  if (roll < 0.25) {
    streamCount = 2
  } else if (roll < 0.65) {
    streamCount = 1
  }

  for (let i = 0; i < streamCount; i += 1) {
    const outlet = coastline[Math.floor(random() * coastline.length)]
    const exit = {
      x: outlet.x * 0.92,
      y: outlet.y * 0.92,
    }

    const sourceAngle = normalizeAngle(outlet.angle + Math.PI + (random() - 0.5) * 0.7)
    const sourceRadius = radius * (0.1 + random() * 0.22)
    const start = {
      x: Math.cos(sourceAngle) * sourceRadius,
      y: Math.sin(sourceAngle) * sourceRadius,
    }

    const deltaX = exit.x - start.x
    const deltaY = exit.y - start.y
    const perpendicular = { x: -deltaY, y: deltaX }
    const length = Math.hypot(perpendicular.x, perpendicular.y) || 1
    const bend = radius * (0.05 + random() * 0.08)
    const bendDir = (random() > 0.5 ? 1 : -1)
    const offsetX = (perpendicular.x / length) * bend * bendDir
    const offsetY = (perpendicular.y / length) * bend * bendDir

    const control1 = {
      x: start.x + deltaX * 0.3 + offsetX,
      y: start.y + deltaY * 0.3 + offsetY,
    }
    const control2 = {
      x: start.x + deltaX * 0.7 + offsetX * 0.6,
      y: start.y + deltaY * 0.7 + offsetY * 0.6,
    }

    const width = 4 + random() * 3
    streams.push({ start, control1, control2, end: exit, width })
  }

  return streams
}

function generateMeadowHighlights(grassPoints, radius, random = Math.random) {
  const highlightCount = 3 + Math.floor(random() * 4)
  const highlights = []

  for (let i = 0; i < highlightCount; i += 1) {
    const anchor = grassPoints[Math.floor(random() * grassPoints.length)]
    const size = radius * (0.12 + random() * 0.16)
    highlights.push({ x: anchor.x, y: anchor.y, radius: size })
  }

  return highlights
}

function generateIslands(count, random = Math.random) {
  const islands = []
  let attempts = 0
  while (islands.length < count && attempts < count * 60) {
    attempts += 1
    const radius = 200 + random() * 320
    const x = random() * MAP_SIZE
    const y = random() * MAP_SIZE

    if (
      islands.some((existing) => {
        const dx = existing.x - x
        const dy = existing.y - y
        return Math.hypot(dx, dy) < existing.radius + radius + MIN_ISLAND_GAP
      })
    ) {
      continue
    }

    const coastline = generateCoastlineShape(radius, random)
    const beach = createInnerRing(coastline, 0.98, 0.02, random)
    const grass = createInnerRing(coastline, 0.68, 0.16, random)
    const canopy = createInnerRing(coastline, 0.5, 0.22, random)

    const palette = pickPalette(random)
    islands.push({
      id: `island-${islands.length}`,
      x,
      y,
      radius,
      points: coastline.map(({ x: px, y: py }) => ({ x: px, y: py })),
      coastline,
      beach,
      grass,
      canopy,
      palette,
      textureSeed: random() * 1000000,
      waveAnimation: {
        offset: random() * 400,
        speed: 0.6 + random() * 0.8,
        dash: 12 + random() * 10,
        glow: 0.22 + random() * 0.25,
      },
      cliffs: generateCliffs(random),
      treeClusters: generateTreeClusters(canopy, radius, random),
      streams: generateStreams(coastline, radius, random),
      highlights: generateMeadowHighlights(grass, radius, random),
    })
  }

  return islands
}

function pickPalette(random = Math.random) {
  const palettes = [
    {
      shore: '#f4d9a0',
      beach: '#f7e5b8',
      grass: '#63b365',
      canopy: '#2f7e4f',
      cliffs: '#8b5528',
      highlight: '#fffae5',
    },
    {
      shore: '#f5c874',
      beach: '#ffe7a9',
      grass: '#55c27c',
      canopy: '#1d7a5a',
      cliffs: '#a16c3c',
      highlight: '#fff2d0',
    },
    {
      shore: '#f1c082',
      beach: '#fddd9a',
      grass: '#6ccf8a',
      canopy: '#337a44',
      cliffs: '#82492a',
      highlight: '#ffe9c0',
    },
  ]
  return palettes[Math.floor(random() * palettes.length)]
}

function generateWaves(count, random = Math.random) {
  return Array.from({ length: count }, () => ({
    x: random() * MAP_SIZE,
    y: random() * MAP_SIZE,
    amplitude: 18 + random() * 24,
    length: 60 + random() * 120,
    speed: 12 + random() * 22,
    phase: random() * Math.PI * 2,
  }))
}

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })

  useEffect(() => {
    const handleResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight })
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return size
}

function App() {
  const canvasRef = useRef(null)
  const miniMapRef = useRef(null)
  const pressedKeys = useRef(new Set())
  const [seed, setSeed] = useState(() => generateRandomSeed())
  const [seedInput, setSeedInput] = useState(seed)
  const [copyStatus, setCopyStatus] = useState('')
  const [activeMenu, setActiveMenu] = useState(null)
  const [isMiniMapVisible, setMiniMapVisible] = useState(false)
  const copyTimeoutRef = useRef(null)

  const seedData = useMemo(() => {
    const random = createSeededRng(seed)
    return {
      islands: generateIslands(ISLAND_COUNT, random),
      waves: generateWaves(320, random),
    }
  }, [seed])

  const islands = seedData.islands
  const wavesRef = useRef(seedData.waves.map((wave) => ({ ...wave })))
  const shorelineTimeRef = useRef(0)
  useEffect(() => {
    wavesRef.current = seedData.waves.map((wave) => ({ ...wave }))
  }, [seedData.waves])

  const { width, height } = useWindowSize()

  const [boatState, setBoatState] = useState(() => createInitialBoatState())

  const boatRef = useRef(boatState)
  boatRef.current = boatState

  useEffect(() => {
    const resetState = createInitialBoatState()
    boatRef.current = resetState
    setBoatState(resetState)
    pressedKeys.current.clear()
    shorelineTimeRef.current = 0
  }, [seed])

  useEffect(() => {
    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase()
      if (Object.values(controlKeys).flat().includes(key)) {
        event.preventDefault()
        pressedKeys.current.add(key)
      }
    }

    const handleKeyUp = (event) => {
      const key = event.key.toLowerCase()
      if (pressedKeys.current.has(key)) {
        pressedKeys.current.delete(key)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useEffect(() => () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }

    let animationFrame
    let lastTimestamp

    const updateBoat = (dt) => {
      const current = { ...boatRef.current }
      const commands = {
        forward: isPressed(pressedKeys.current, controlKeys.forward),
        backward: isPressed(pressedKeys.current, controlKeys.backward),
        left: isPressed(pressedKeys.current, controlKeys.left),
        right: isPressed(pressedKeys.current, controlKeys.right),
      }

      if (commands.forward) {
        current.sailTarget = clamp(current.sailTarget + dt * 0.7, 0, 1)
      }

      if (commands.backward) {
        current.sailTarget = clamp(current.sailTarget - dt * 0.7, 0, 1)
      }

      const sailDiff = current.sailTarget - current.sailLevel
      if (Math.abs(sailDiff) > 0.0001) {
        const sailChangeRate = 1.6
        const delta = Math.sign(sailDiff) * Math.min(Math.abs(sailDiff), sailChangeRate * dt)
        current.sailLevel = clamp(current.sailLevel + delta, 0, 1)
      }

      const attemptingToMove = commands.forward || commands.left || commands.right
      const movingSpeedThreshold = 6
      const isMoving = current.speed > movingSpeedThreshold
      const anchorBlocking = ['dropping', 'anchored', 'weighing'].includes(current.anchorState)

      if (!anchorBlocking && !isMoving && !attemptingToMove) {
        current.idleTime += dt
      } else if (attemptingToMove || isMoving) {
        current.idleTime = 0
      }

      if (current.anchorState === 'stowed' && current.idleTime >= 3) {
        current.anchorState = 'dropping'
        current.anchorProgress = 0
      }

      if (current.anchorState === 'dropping') {
        current.anchorProgress = Math.min(1, current.anchorProgress + dt)
        current.speed = Math.max(0, current.speed - BRAKE_DECELERATION * dt)
        if (current.anchorProgress >= 1) {
          current.anchorState = 'anchored'
        }
      } else if (current.anchorState === 'anchored') {
        current.anchorProgress = 1
        current.speed = 0
        if (attemptingToMove) {
          current.anchorState = 'weighing'
          current.anchorProgress = 0
        }
      } else if (current.anchorState === 'weighing') {
        current.anchorProgress = Math.min(1, current.anchorProgress + dt)
        current.speed = 0
        if (current.anchorProgress >= 1) {
          current.anchorState = 'stowed'
          current.anchorProgress = 0
          current.idleTime = 0
        }
      }

      const canAccelerate = !['dropping', 'anchored', 'weighing'].includes(current.anchorState)
      const desiredSpeed = canAccelerate ? current.sailLevel * MAX_FORWARD_SPEED : 0

      if (current.speed < desiredSpeed) {
        current.speed = Math.min(desiredSpeed, current.speed + ACCELERATION * dt)
      } else if (current.speed > desiredSpeed) {
        current.speed = Math.max(desiredSpeed, current.speed - BRAKE_DECELERATION * dt)
      }

      if (desiredSpeed < 6 && current.speed < 6 && !attemptingToMove) {
        current.speed = 0
      }

      const canSteer = !['anchored', 'weighing'].includes(current.anchorState)
      const turnStrength = 0.6 + Math.min(current.speed / MAX_FORWARD_SPEED, 1)

      if (canSteer && commands.left) {
        current.heading -= TURN_RATE * dt * turnStrength
      }
      if (canSteer && commands.right) {
        current.heading += TURN_RATE * dt * turnStrength
      }

      const proposedX = current.x + Math.cos(current.heading) * current.speed * dt
      const proposedY = current.y + Math.sin(current.heading) * current.speed * dt

      const proposedBoat = { x: proposedX, y: proposedY, heading: current.heading }
      const collision = detectCollision(proposedBoat, islands)
      if (!collision) {
        current.x = clamp(proposedX, 0, MAP_SIZE)
        current.y = clamp(proposedY, 0, MAP_SIZE)
      } else {
        current.speed = Math.min(current.speed, 38)
      }

      current.wakeTimer = (current.wakeTimer + dt * (0.8 + Math.min(current.speed / MAX_FORWARD_SPEED, 1) * 3)) % 1000

      boatRef.current = current
      setBoatState(current)
      return current
    }

    const render = (timestamp) => {
      if (lastTimestamp == null) {
        lastTimestamp = timestamp
      }
      const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05)
      lastTimestamp = timestamp

      const boat = updateBoat(dt)
      updateWaves(wavesRef.current, dt)
      shorelineTimeRef.current = (shorelineTimeRef.current + dt) % 1000
      drawScene(
        ctx,
        { width: canvas.width, height: canvas.height },
        boat,
        islands,
        wavesRef.current,
        shorelineTimeRef.current,
      )

      if (isMiniMapVisible) {
        const miniMapCanvasCurrent = miniMapRef.current
        if (miniMapCanvasCurrent) {
          const miniMapCtx = miniMapCanvasCurrent.getContext('2d')
          if (miniMapCtx) {
            drawMiniMap(miniMapCtx, boat, islands)
          }
        }
      }

      animationFrame = requestAnimationFrame(render)
    }

    const resizeCanvas = () => {
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resizeCanvas()
    animationFrame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animationFrame)
    }
  }, [height, width, islands, isMiniMapVisible])

  useEffect(() => {
    const miniMapCanvas = miniMapRef.current
    if (!miniMapCanvas) {
      return
    }

    const baseSize = Math.min(260, Math.max(200, Math.min(width, height) * 0.22))
    const size = Math.round(baseSize)
    const dpr = window.devicePixelRatio || 1
    miniMapCanvas.width = size * dpr
    miniMapCanvas.height = size * dpr
    miniMapCanvas.style.width = `${size}px`
    miniMapCanvas.style.height = `${size}px`
  }, [width, height])

  const handleSeedSubmit = (event) => {
    event.preventDefault()
    const nextSeed = seedInput.trim()
    if (nextSeed.length === 0) {
      const randomSeed = generateRandomSeed()
      setSeed(randomSeed)
      setSeedInput(randomSeed)
      setCopyStatus('')
      return
    }
    setSeed(nextSeed)
    setSeedInput(nextSeed)
    setCopyStatus('')
  }

  const handleRandomSeed = () => {
    const randomSeed = generateRandomSeed()
    setSeed(randomSeed)
    setSeedInput(randomSeed)
    setCopyStatus('')
  }

  const handleCopySeed = async () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current)
    }

    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(seed)
        setCopyStatus('Seed copied!')
      } catch {
        setCopyStatus('Copy unavailable')
      }
    } else {
      setCopyStatus('Copy unavailable')
    }

    copyTimeoutRef.current = setTimeout(() => {
      setCopyStatus('')
    }, 2000)
  }

  const handleMenuToggle = (menuKey) => {
    setActiveMenu((current) => (current === menuKey ? null : menuKey))
  }

  const shipStatus = useMemo(() => {
    if (boatState.anchorState === 'dropping') {
      return 'Dropping anchor'
    }

    if (boatState.anchorState === 'anchored') {
      return 'At anchor'
    }

    if (boatState.anchorState === 'weighing') {
      return 'Weighing anchor'
    }

    if (boatState.speed > 10) {
      return 'Under way'
    }

    return 'Idle'
  }, [boatState.anchorState, boatState.speed])

  const speedKnots = Math.round(boatState.speed)
  const headingDegrees = Math.round(
    (((boatState.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI),
  )

  return (
    <div className="app">
      <canvas ref={canvasRef} className="world-canvas" />
      <div className="ui-layer">
        <div className={`top-menu glass-panel ${activeMenu ? 'top-menu--expanded' : ''}`}>
          <div className="top-menu-header">
            <div className="menu-brand">SailTrade</div>
            <div className="menu-actions">
              <button
                type="button"
                className={`menu-toggle-button ${activeMenu === 'seed' ? 'is-active' : ''}`}
                onClick={() => handleMenuToggle('seed')}
              >
                World Seed
              </button>
              <button
                type="button"
                className={`menu-toggle-button ${activeMenu === 'instructions' ? 'is-active' : ''}`}
                onClick={() => handleMenuToggle('instructions')}
              >
                Instructions
              </button>
              <button
                type="button"
                className={`menu-toggle-button ${isMiniMapVisible ? 'is-active' : ''}`}
                onClick={() => setMiniMapVisible((value) => !value)}
              >
                Mini Map
              </button>
            </div>
          </div>
          {activeMenu === 'seed' && (
            <div className="top-menu-content">
              <form className="seed-form" onSubmit={handleSeedSubmit}>
                <label htmlFor="seed-input" className="seed-label">
                  World Seed
                </label>
                <input
                  id="seed-input"
                  className="seed-input"
                  value={seedInput}
                  onChange={(event) => setSeedInput(event.target.value)}
                  placeholder="Enter or paste a seed"
                  spellCheck="false"
                />
                <div className="seed-buttons">
                  <button type="submit" className="seed-button">
                    Load
                  </button>
                  <button type="button" className="seed-button" onClick={handleRandomSeed}>
                    Random
                  </button>
                  <button type="button" className="seed-button" onClick={handleCopySeed}>
                    Copy
                  </button>
                </div>
              </form>
              <div className="seed-hint">
                <span>Share this seed to sail the same waters.</span>
                {copyStatus && <span className="seed-status">{copyStatus}</span>}
              </div>
            </div>
          )}
          {activeMenu === 'instructions' && (
            <div className="top-menu-content">
              <div className="menu-instructions">
                Catch the wind with <strong>↑</strong>/<strong>W</strong>, ease the sails with <strong>↓</strong>/<strong>S</strong>, and steer using
                {' '}
                <strong>←</strong>/<strong>→</strong> or <strong>A</strong>/<strong>D</strong>.
              </div>
            </div>
          )}
        </div>
        <div className="bottom-menu glass-panel">
          <div className="ship-title">Ship</div>
          <div className="ship-stats">
            <div className="ship-stat">
              <span className="ship-stat-label">Speed</span>
              <span className="ship-stat-value">{speedKnots} kn</span>
            </div>
            <div className="ship-stat">
              <span className="ship-stat-label">Heading</span>
              <span className="ship-stat-value">{headingDegrees}°</span>
            </div>
            <div className="ship-stat">
              <span className="ship-stat-label">Status</span>
              <span className="ship-stat-value">{shipStatus}</span>
            </div>
          </div>
        </div>
        <div className={`mini-map-wrapper ${isMiniMapVisible ? 'is-visible' : ''}`}>
          <canvas ref={miniMapRef} className="mini-map-canvas" />
        </div>
      </div>
    </div>
  )
}

function isPressed(set, keys) {
  return keys.some((key) => set.has(key))
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getBoatCollisionSamples(boat) {
  const samples = [{ x: boat.x, y: boat.y }]
  const cos = Math.cos(boat.heading)
  const sin = Math.sin(boat.heading)

  for (const offset of BOAT_COLLISION_OUTLINE) {
    const rotatedX = boat.x + offset.x * cos - offset.y * sin
    const rotatedY = boat.y + offset.x * sin + offset.y * cos
    samples.push({ x: rotatedX, y: rotatedY })
  }

  return samples
}

function isPointInsidePolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-7) + xi

    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

function isPointNearPolygonEdge(point, polygon, threshold) {
  const thresholdSq = threshold * threshold
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j]
    const b = polygon[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    let t = 0
    if (lengthSq > 0) {
      t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq
      t = Math.max(0, Math.min(1, t))
    }
    const closestX = a.x + dx * t
    const closestY = a.y + dy * t
    const distSq = (point.x - closestX) * (point.x - closestX) + (point.y - closestY) * (point.y - closestY)
    if (distSq <= thresholdSq) {
      return true
    }
  }
  return false
}

function detectCollision(boat, islands) {
  const samples = getBoatCollisionSamples(boat)

  for (const island of islands) {
    const dx = boat.x - island.x
    const dy = boat.y - island.y
    const limit = island.radius + MAX_BOAT_EXTENT

    if (dx * dx + dy * dy > limit * limit) {
      continue
    }

    for (const sample of samples) {
      const localPoint = { x: sample.x - island.x, y: sample.y - island.y }
      if (
        isPointInsidePolygon(localPoint, island.coastline) ||
        isPointNearPolygonEdge(localPoint, island.coastline, COLLISION_EDGE_THRESHOLD)
      ) {
        return true
      }
    }
  }

  return false
}

function updateWaves(waves, dt) {
  for (const wave of waves) {
    wave.phase += dt * wave.speed * 0.4
    wave.x = (wave.x + Math.cos(wave.phase) * dt * wave.speed) % MAP_SIZE
    wave.y = (wave.y + Math.sin(wave.phase * 0.6) * dt * wave.speed) % MAP_SIZE

    if (wave.x < 0) wave.x += MAP_SIZE
    if (wave.y < 0) wave.y += MAP_SIZE
  }
}

function drawScene(ctx, viewport, boat, islands, waves, shorelineTime) {
  const { width, height } = viewport
  const camera = {
    x: boat.x - width / 2,
    y: boat.y - height / 2,
  }

  ctx.imageSmoothingEnabled = false
  paintSea(ctx, width, height, camera, waves)
  drawIslands(ctx, islands, camera, shorelineTime)
  drawBoatWake(ctx, boat, camera)
  drawBoat(ctx, boat, camera)
  addVignette(ctx, width, height)
}

function drawMiniMap(ctx, boat, islands) {
  const dpr = window.devicePixelRatio || 1
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const width = ctx.canvas.width / dpr
  const height = ctx.canvas.height / dpr
  ctx.clearRect(0, 0, width, height)

  const centerX = width / 2
  const centerY = height / 2
  const mapRadius = Math.max(40, Math.min(centerX, centerY) - 12)
  const outerRadius = mapRadius + 4
  const scale = mapRadius / MINIMAP_WORLD_RADIUS

  ctx.fillStyle = 'rgba(4, 28, 42, 0.78)'
  ctx.fillRect(0, 0, width, height)

  ctx.beginPath()
  ctx.arc(centerX, centerY, outerRadius, 0, TWO_PI)
  ctx.fillStyle = 'rgba(6, 44, 60, 0.92)'
  ctx.fill()

  ctx.save()
  ctx.beginPath()
  ctx.arc(centerX, centerY, mapRadius, 0, TWO_PI)
  ctx.clip()

  ctx.fillStyle = 'rgba(13, 82, 112, 0.9)'
  ctx.fillRect(centerX - mapRadius, centerY - mapRadius, mapRadius * 2, mapRadius * 2)

  const traceRing = (points) => {
    if (!points?.length) {
      return false
    }
    ctx.beginPath()
    const first = points[0]
    ctx.moveTo(first.x * scale, first.y * scale)
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i]
      ctx.lineTo(point.x * scale, point.y * scale)
    }
    ctx.closePath()
    return true
  }

  for (const island of islands) {
    const dx = island.x - boat.x
    const dy = island.y - boat.y
    const distance = Math.hypot(dx, dy) - island.radius
    if (distance > MINIMAP_WORLD_RADIUS) {
      continue
    }

    ctx.save()
    ctx.translate(centerX + dx * scale, centerY + dy * scale)

    if (traceRing(island.coastline)) {
      ctx.globalAlpha = 0.9
      ctx.fillStyle = hexToRgba(island.palette.shore, 0.82)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    if (traceRing(island.beach)) {
      ctx.globalAlpha = 0.95
      ctx.fillStyle = hexToRgba(island.palette.beach, 0.95)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    if (traceRing(island.grass)) {
      ctx.globalAlpha = 0.9
      ctx.fillStyle = hexToRgba(island.palette.grass, 0.92)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    if (traceRing(island.canopy)) {
      ctx.globalAlpha = 0.85
      ctx.fillStyle = hexToRgba(island.palette.canopy, 0.88)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    if (traceRing(island.coastline)) {
      ctx.strokeStyle = hexToRgba(island.palette.shore, 0.8)
      ctx.lineWidth = Math.max(1, scale * 2.2)
      ctx.stroke()
    }

    ctx.restore()
  }

  ctx.restore()

  ctx.strokeStyle = 'rgba(224, 244, 255, 0.85)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(centerX, centerY, mapRadius, 0, TWO_PI)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(2, 12, 20, 0.88)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(centerX, centerY, outerRadius, 0, TWO_PI)
  ctx.stroke()

  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.rotate(boat.heading)
  ctx.fillStyle = '#ffe8a6'
  ctx.beginPath()
  ctx.moveTo(mapRadius * 0.32, 0)
  ctx.lineTo(-mapRadius * 0.2, mapRadius * 0.16)
  ctx.lineTo(-mapRadius * 0.2, -mapRadius * 0.16)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(12, 30, 42, 0.85)'
  ctx.lineWidth = 1.8
  ctx.stroke()
  ctx.restore()

  ctx.restore()
}

function paintSea(ctx, width, height, camera, waves) {
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#2bb9c6')
  gradient.addColorStop(0.55, '#1f9fb3')
  gradient.addColorStop(1, '#0b4969')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.globalCompositeOperation = 'lighter'
  for (const wave of waves) {
    const screenX = wave.x - camera.x
    const screenY = wave.y - camera.y
    if (screenX < -wave.length || screenX > width + wave.length || screenY < -wave.length || screenY > height + wave.length) {
      continue
    }
    const angle = Math.sin(wave.phase) * 0.6
    ctx.save()
    ctx.translate(screenX, screenY)
    ctx.rotate(angle)
    const waveGradient = ctx.createLinearGradient(-wave.length / 2, 0, wave.length / 2, 0)
    waveGradient.addColorStop(0, 'rgba(160, 212, 255, 0)')
    waveGradient.addColorStop(0.5, 'rgba(160, 212, 255, 0.22)')
    waveGradient.addColorStop(1, 'rgba(160, 212, 255, 0)')
    ctx.fillStyle = waveGradient
    ctx.fillRect(-wave.length / 2, -wave.amplitude / 2, wave.length, wave.amplitude)
    ctx.restore()
  }
  ctx.restore()
}

function drawIslands(ctx, islands, camera, shorelineTime = 0) {
  for (const island of islands) {
    const screenX = island.x - camera.x
    const screenY = island.y - camera.y
    if (screenX < -island.radius * 2 || screenX > ctx.canvas.width + island.radius * 2 || screenY < -island.radius * 2 || screenY > ctx.canvas.height + island.radius * 2) {
      continue
    }

    ctx.save()
    ctx.translate(screenX, screenY)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    const coastPath = buildSmoothPath(island.coastline)
    const beachPath = buildSmoothPath(island.beach)
    const grassPath = buildSmoothPath(island.grass)
    const canopyPath = buildSmoothPath(island.canopy)

    drawWaterHalo(ctx, island, coastPath)
    drawShore(ctx, island, coastPath)
    drawBeach(ctx, island, beachPath)
    drawShorelineWaves(ctx, island, coastPath, shorelineTime)
    drawCliffs(ctx, island, coastPath)
    drawGrass(ctx, island, grassPath)
    addMeadowHighlights(ctx, island, grassPath)
    drawStreamsOnIsland(ctx, island, grassPath)
    drawCanopyBase(ctx, island, canopyPath)
    drawTreeClusters(ctx, island, canopyPath)

    ctx.restore()
  }
}

function drawBoatWake(ctx, boat, camera) {
  const wakeStrength = Math.min(boat.speed / MAX_FORWARD_SPEED, 1)
  if (wakeStrength <= 0.02) {
    return
  }

  const screenX = boat.x - camera.x
  const screenY = boat.y - camera.y

  ctx.save()
  ctx.translate(screenX, screenY)
  ctx.rotate(boat.heading)

  const wakeLength = 90 + wakeStrength * 120
  const wakeWidth = 18 + wakeStrength * 32

  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.32 * wakeStrength
  const wakeGradient = ctx.createLinearGradient(0, 0, -wakeLength, 0)
  wakeGradient.addColorStop(0, 'rgba(200, 240, 255, 0.85)')
  wakeGradient.addColorStop(1, 'rgba(200, 240, 255, 0)')
  ctx.fillStyle = wakeGradient
  ctx.beginPath()
  ctx.moveTo(-10, wakeWidth * 0.55)
  ctx.quadraticCurveTo(-wakeLength * 0.55, wakeWidth * 0.8, -wakeLength, 0)
  ctx.quadraticCurveTo(-wakeLength * 0.55, -wakeWidth * 0.8, -10, -wakeWidth * 0.55)
  ctx.closePath()
  ctx.fill()

  ctx.globalAlpha = 0.28 * wakeStrength
  ctx.strokeStyle = 'rgba(225, 248, 255, 0.9)'
  ctx.lineWidth = 2
  for (let i = 1; i <= 3; i += 1) {
    const t = i / 3
    const rippleX = -18 - t * (wakeLength - 24)
    const rippleWidth = wakeWidth * (0.5 + t * 0.7)
    const pulse = Math.sin(boat.wakeTimer * 4 + i * 1.6) * 2
    ctx.beginPath()
    ctx.moveTo(rippleX, -rippleWidth + pulse)
    ctx.quadraticCurveTo(rippleX - wakeLength * 0.04, 0, rippleX, rippleWidth - pulse)
    ctx.stroke()
  }

  const sprayStrength = Math.min(boat.speed / (MAX_FORWARD_SPEED * 0.7), 1)
  if (sprayStrength > 0.05) {
    const eased = sprayStrength * sprayStrength * (3 - 2 * sprayStrength)

    for (const side of [-1, 1]) {
      ctx.globalAlpha = 0.26 * sprayStrength
      ctx.fillStyle = 'rgba(214, 242, 255, 0.88)'
      ctx.beginPath()
      ctx.moveTo(48, side * 4)
      ctx.quadraticCurveTo(40, side * (10 + eased * 8), 24, side * (16 + eased * 12))
      ctx.lineTo(20, side * (12 + eased * 8))
      ctx.quadraticCurveTo(36, side * (6 + eased * 6), 48, side * 2)
      ctx.closePath()
      ctx.fill()

      ctx.globalAlpha = 0.42 * sprayStrength
      ctx.strokeStyle = 'rgba(235, 252, 255, 0.95)'
      ctx.lineWidth = 1.5 + eased * 1.2

      for (let i = 0; i < 3; i += 1) {
        const flow = i / 2.4
        const startX = 50 - flow * 5.5
        const startY = side * (3 + flow * 2.6)
        const midX = 40 - eased * (8 + flow * 6)
        const midY = side * (8 + eased * 10 + flow * 5.5)
        const endX = 26 - eased * (11 + flow * 5.5)
        const endY = side * (15 + eased * 14 + flow * 5.5)
        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.quadraticCurveTo(midX, midY, endX, endY)
        ctx.stroke()
      }
    }

    ctx.globalAlpha = 0.3 * sprayStrength
    ctx.strokeStyle = 'rgba(190, 226, 244, 0.8)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(44, 0)
    ctx.quadraticCurveTo(32, 0, 18, 0)
    ctx.stroke()

    ctx.globalAlpha = 1
  }

  ctx.restore()
}

function drawBoat(ctx, boat, camera) {
  const screenX = boat.x - camera.x
  const screenY = boat.y - camera.y
  ctx.save()
  ctx.translate(screenX, screenY)
  ctx.rotate(boat.heading)

  drawBoatShadow(ctx, boat)
  drawBoatHull(ctx)
  drawDeckDetails(ctx)
  drawAnchor(ctx, boat)
  drawMastAndSails(ctx, boat)

  ctx.restore()
}

function buildSmoothPath(points) {
  const path = new Path2D()
  if (points.length === 0) {
    return path
  }

  const first = points[0]
  const last = points[points.length - 1]
  path.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2)

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    const midX = (current.x + next.x) / 2
    const midY = (current.y + next.y) / 2
    path.quadraticCurveTo(current.x, current.y, midX, midY)
  }

  path.closePath()
  return path
}

function getIslandTexture(ctx, island, type, config = {}) {
  let cache = islandTextureCache.get(island)
  if (!cache) {
    cache = {}
    islandTextureCache.set(island, cache)
  }

  let texture = cache[type]
  if (!texture) {
    const size = config.size ?? 160
    const offscreen = document.createElement('canvas')
    offscreen.width = size
    offscreen.height = size
    const textureCtx = offscreen.getContext('2d')

    if (textureCtx) {
      const rng = createSeededRng(`${island.id}-${type}-${island.textureSeed ?? 0}`)
      const highlightColor = config.highlightColor ?? 'rgba(255, 255, 255, 0.3)'
      const shadowColor = config.shadowColor ?? 'rgba(0, 0, 0, 0.35)'

      if (config.baseColor) {
        textureCtx.fillStyle = config.baseColor
        textureCtx.globalAlpha = config.baseAlpha ?? 0.08
        textureCtx.fillRect(0, 0, size, size)
        textureCtx.globalAlpha = 1
      }

      const density = config.density ?? 0.018
      const speckCount = Math.floor(size * size * density)
      for (let i = 0; i < speckCount; i += 1) {
        textureCtx.globalAlpha = (config.minAlpha ?? 0.05) + rng() * (config.maxAlpha ?? 0.22)
        textureCtx.fillStyle = rng() < (config.highlightChance ?? 0.5) ? highlightColor : shadowColor
        const radiusX = (config.dotSize ?? 1.4) * (0.4 + rng() * 1.8)
        const radiusY = radiusX * (0.55 + rng() * 0.9)
        const angle = rng() * TWO_PI
        const x = rng() * size
        const y = rng() * size
        textureCtx.beginPath()
        textureCtx.ellipse(x, y, radiusX, radiusY, angle, 0, TWO_PI)
        textureCtx.fill()
      }

      if (config.accentColor) {
        const accentCount = Math.floor(size * size * (config.accentDensity ?? 0.003))
        textureCtx.strokeStyle = config.accentColor
        textureCtx.lineWidth = config.accentWidth ?? 0.6
        textureCtx.globalAlpha = config.accentAlpha ?? 0.14
        for (let i = 0; i < accentCount; i += 1) {
          const x = rng() * size
          const y = rng() * size
          const length = (config.accentLength ?? 12) * (0.3 + rng() * 1.2)
          const angle = rng() * TWO_PI
          textureCtx.beginPath()
          textureCtx.moveTo(x, y)
          textureCtx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length)
          textureCtx.stroke()
        }
        textureCtx.globalAlpha = 1
      }

      const offsetX = -rng() * size
      const offsetY = -rng() * size
      texture = {
        offscreen,
        pattern: null,
        patternCanvas: null,
        offsetX,
        offsetY,
      }
    } else {
      texture = {
        offscreen,
        pattern: null,
        patternCanvas: null,
        offsetX: 0,
        offsetY: 0,
      }
    }

    cache[type] = texture
  }

  if (!texture.pattern || texture.patternCanvas !== ctx.canvas) {
    texture.pattern = ctx.createPattern(texture.offscreen, 'repeat')
    texture.patternCanvas = ctx.canvas
  }

  return texture
}

function applyTexture(ctx, path, island, type, options = {}) {
  const { opacity = 0.25, ...textureConfig } = options
  const texture = getIslandTexture(ctx, island, type, textureConfig)
  if (!texture?.pattern) {
    return
  }

  ctx.save()
  ctx.clip(path)
  ctx.globalAlpha = opacity
  ctx.translate(texture.offsetX, texture.offsetY)
  ctx.fillStyle = texture.pattern
  const extent = island.radius * 3
  ctx.fillRect(-extent, -extent, extent * 2, extent * 2)
  ctx.restore()
}

function drawShorelineWaves(ctx, island, coastPath, time) {
  const animation = island.waveAnimation ?? { offset: 0, speed: 1, dash: 16, glow: 0.3 }
  const dashLength = Math.max(8, animation.dash)
  const dashGap = dashLength * 1.2
  const travel = -((time * 60 * (animation.speed ?? 1)) + animation.offset)
  const swayX = Math.sin(time * 1.8 + animation.offset * 0.1) * 1.1
  const swayY = Math.cos(time * 1.4 + animation.offset * 0.08) * 0.9

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.setLineDash([dashLength, dashGap])
  ctx.lineDashOffset = travel
  ctx.lineWidth = 2.6
  ctx.globalAlpha = 0.55 * (animation.glow ?? 0.3)
  ctx.strokeStyle = 'rgba(220, 244, 255, 0.8)'
  ctx.shadowBlur = 12
  ctx.shadowColor = 'rgba(150, 210, 255, 0.45)'
  ctx.shadowOffsetX = swayX * 0.6
  ctx.shadowOffsetY = swayY * 0.6
  ctx.stroke(coastPath)

  ctx.shadowBlur = 0
  ctx.setLineDash([dashLength * 1.3, dashGap * 1.15])
  ctx.lineDashOffset = travel * 0.6
  ctx.lineWidth = 5.4
  ctx.globalAlpha = 0.28 * (animation.glow ?? 0.3)
  ctx.strokeStyle = 'rgba(130, 200, 236, 0.45)'
  ctx.stroke(coastPath)
  ctx.restore()
}

function drawWaterHalo(ctx, island, coastPath) {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.2
  ctx.strokeStyle = 'rgba(223, 248, 255, 0.7)'
  ctx.lineWidth = 6
  ctx.stroke(coastPath)
  ctx.globalAlpha = 0.12
  ctx.lineWidth = 12
  ctx.stroke(coastPath)
  ctx.restore()
}

function drawShore(ctx, island, coastPath) {
  ctx.save()
  ctx.fillStyle = island.palette.shore
  ctx.fill(coastPath)
  applyTexture(ctx, coastPath, island, 'shore', {
    opacity: 0.32,
    baseColor: hexToRgba(island.palette.highlight, 0.18),
    baseAlpha: 0.06,
    highlightColor: hexToRgba('#ffffff', 0.65),
    shadowColor: hexToRgba(island.palette.cliffs, 0.35),
    density: 0.012,
    dotSize: 1.6,
    minAlpha: 0.05,
    maxAlpha: 0.2,
  })
  ctx.strokeStyle = 'rgba(32, 42, 48, 0.32)'
  ctx.lineWidth = 3.2
  ctx.stroke(coastPath)

  ctx.clip(coastPath)
  const glow = ctx.createRadialGradient(0, 0, island.radius * 0.3, 0, 0, island.radius * 1.05)
  glow.addColorStop(0, 'rgba(255, 255, 255, 0)')
  glow.addColorStop(0.65, 'rgba(255, 255, 255, 0)')
  glow.addColorStop(1, hexToRgba(island.palette.highlight, 0.3))
  ctx.globalAlpha = 0.55
  ctx.fillStyle = glow
  ctx.fillRect(-island.radius, -island.radius, island.radius * 2, island.radius * 2)
  ctx.restore()
}

function drawBeach(ctx, island, beachPath) {
  ctx.save()
  ctx.fillStyle = island.palette.beach
  ctx.fill(beachPath)
  applyTexture(ctx, beachPath, island, 'beach', {
    opacity: 0.34,
    baseColor: hexToRgba(island.palette.shore, 0.2),
    baseAlpha: 0.05,
    highlightColor: hexToRgba('#ffffff', 0.7),
    shadowColor: hexToRgba(island.palette.cliffs, 0.28),
    density: 0.02,
    dotSize: 1.2,
    minAlpha: 0.06,
    maxAlpha: 0.22,
    accentColor: hexToRgba(island.palette.highlight, 0.55),
    accentDensity: 0.0014,
    accentWidth: 0.55,
    accentAlpha: 0.1,
    accentLength: 6,
  })

  ctx.clip(beachPath)
  const warmth = ctx.createLinearGradient(-island.radius, -island.radius, island.radius, island.radius)
  warmth.addColorStop(0, 'rgba(255, 255, 255, 0.4)')
  warmth.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)')
  warmth.addColorStop(1, hexToRgba(island.palette.cliffs, 0.18))
  ctx.globalAlpha = 0.45
  ctx.fillStyle = warmth
  ctx.fillRect(-island.radius, -island.radius, island.radius * 2, island.radius * 2)

  ctx.restore()
}

function drawGrass(ctx, island, grassPath) {
  ctx.save()
  ctx.fillStyle = island.palette.grass
  ctx.fill(grassPath)
  applyTexture(ctx, grassPath, island, 'grass', {
    opacity: 0.26,
    baseColor: hexToRgba(island.palette.highlight, 0.2),
    baseAlpha: 0.04,
    highlightColor: hexToRgba(island.palette.highlight, 0.75),
    shadowColor: 'rgba(10, 64, 36, 0.6)',
    density: 0.024,
    dotSize: 1.9,
    minAlpha: 0.05,
    maxAlpha: 0.18,
    accentColor: 'rgba(255, 255, 255, 0.28)',
    accentDensity: 0.0012,
    accentWidth: 0.6,
    accentAlpha: 0.12,
    accentLength: 10,
  })

  ctx.clip(grassPath)
  const gradient = ctx.createRadialGradient(0, 0, island.radius * 0.22, 0, 0, island.radius * 0.92)
  gradient.addColorStop(0, hexToRgba(island.palette.highlight, 0.32))
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.24)')
  ctx.globalAlpha = 0.5
  ctx.fillStyle = gradient
  ctx.fillRect(-island.radius, -island.radius, island.radius * 2, island.radius * 2)
  ctx.restore()
}

function addMeadowHighlights(ctx, island, grassPath) {
  if (!island.highlights?.length) {
    return
  }

  ctx.save()
  ctx.clip(grassPath)
  for (const highlight of island.highlights) {
    const meadow = ctx.createRadialGradient(highlight.x, highlight.y, 0, highlight.x, highlight.y, highlight.radius)
    meadow.addColorStop(0, hexToRgba(island.palette.highlight, 0.48))
    meadow.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = meadow
    ctx.beginPath()
    ctx.arc(highlight.x, highlight.y, highlight.radius, 0, TWO_PI)
    ctx.fill()
  }
  ctx.restore()
}

function drawStreamsOnIsland(ctx, island, grassPath) {
  if (!island.streams?.length) {
    return
  }

  ctx.save()
  ctx.clip(grassPath)
  ctx.lineCap = 'round'
  for (const stream of island.streams) {
    ctx.strokeStyle = 'rgba(45, 136, 172, 0.78)'
    ctx.lineWidth = stream.width
    ctx.beginPath()
    ctx.moveTo(stream.start.x, stream.start.y)
    ctx.bezierCurveTo(stream.control1.x, stream.control1.y, stream.control2.x, stream.control2.y, stream.end.x, stream.end.y)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(215, 242, 255, 0.75)'
    ctx.lineWidth = stream.width * 0.45
    ctx.beginPath()
    ctx.moveTo(stream.start.x, stream.start.y)
    ctx.bezierCurveTo(stream.control1.x, stream.control1.y, stream.control2.x, stream.control2.y, stream.end.x, stream.end.y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawCanopyBase(ctx, island, canopyPath) {
  ctx.save()
  ctx.fillStyle = hexToRgba(island.palette.canopy, 0.92)
  ctx.fill(canopyPath)
  applyTexture(ctx, canopyPath, island, 'canopy', {
    opacity: 0.22,
    baseColor: hexToRgba(island.palette.highlight, 0.25),
    baseAlpha: 0.05,
    highlightColor: hexToRgba(island.palette.highlight, 0.82),
    shadowColor: 'rgba(6, 38, 24, 0.7)',
    density: 0.028,
    dotSize: 1.5,
    minAlpha: 0.05,
    maxAlpha: 0.16,
    accentColor: 'rgba(12, 60, 32, 0.55)',
    accentDensity: 0.0018,
    accentWidth: 0.8,
    accentAlpha: 0.16,
    accentLength: 9,
  })

  ctx.clip(canopyPath)
  const depth = ctx.createRadialGradient(0, 0, island.radius * 0.14, 0, 0, island.radius * 0.6)
  depth.addColorStop(0, hexToRgba(island.palette.highlight, 0.35))
  depth.addColorStop(1, 'rgba(0, 0, 0, 0.35)')
  ctx.globalAlpha = 0.55
  ctx.fillStyle = depth
  ctx.fillRect(-island.radius, -island.radius, island.radius * 2, island.radius * 2)
  ctx.restore()
}

function drawBroadleafTree(ctx, tree, palette) {
  const canopyWidth = tree.size * 2.8
  const canopyHeight = tree.size * 2.1
  const trunkHeight = tree.size * 1.25
  const trunkWidth = tree.size * 0.5

  ctx.save()
  ctx.translate(tree.x, tree.y)
  ctx.rotate(tree.lean * 0.18)

  ctx.save()
  ctx.translate(tree.size * 0.28, canopyHeight * 0.6)
  ctx.fillStyle = 'rgba(15, 42, 28, 0.32)'
  ctx.beginPath()
  ctx.ellipse(0, 0, canopyWidth * 0.52, canopyHeight * 0.3, 0, 0, TWO_PI)
  ctx.fill()
  ctx.restore()

  const trunkGradient = ctx.createLinearGradient(0, canopyHeight * 0.1, 0, canopyHeight * 0.1 + trunkHeight)
  trunkGradient.addColorStop(0, hexToRgba(palette.cliffs, 0.85))
  trunkGradient.addColorStop(1, 'rgba(44, 26, 16, 0.9)')
  ctx.fillStyle = trunkGradient
  ctx.beginPath()
  ctx.moveTo(-trunkWidth / 2, canopyHeight * 0.1)
  ctx.lineTo(-trunkWidth / 2, canopyHeight * 0.1 + trunkHeight)
  ctx.quadraticCurveTo(0, canopyHeight * 0.1 + trunkHeight + tree.size * 0.35, trunkWidth / 2, canopyHeight * 0.1 + trunkHeight)
  ctx.lineTo(trunkWidth / 2, canopyHeight * 0.1)
  ctx.closePath()
  ctx.fill()

  const canopyGradient = ctx.createRadialGradient(
    -canopyWidth * 0.3,
    -canopyHeight * 0.8,
    tree.size * 0.35,
    0,
    0,
    canopyWidth,
  )
  canopyGradient.addColorStop(0, hexToRgba(palette.highlight, 0.95))
  canopyGradient.addColorStop(0.5, hexToRgba(palette.canopy, 0.98))
  canopyGradient.addColorStop(1, 'rgba(14, 48, 30, 0.95)')
  ctx.fillStyle = canopyGradient
  ctx.beginPath()
  ctx.moveTo(0, -canopyHeight)
  ctx.bezierCurveTo(
    canopyWidth * 0.5,
    -canopyHeight * 0.65,
    canopyWidth * 0.7,
    canopyHeight * 0.05,
    canopyWidth * 0.2,
    canopyHeight * 0.65,
  )
  ctx.bezierCurveTo(
    canopyWidth * 0.05,
    canopyHeight * 0.85,
    -canopyWidth * 0.05,
    canopyHeight * 0.85,
    -canopyWidth * 0.2,
    canopyHeight * 0.65,
  )
  ctx.bezierCurveTo(
    -canopyWidth * 0.7,
    canopyHeight * 0.05,
    -canopyWidth * 0.5,
    -canopyHeight * 0.65,
    0,
    -canopyHeight,
  )
  ctx.closePath()
  ctx.fill()

  ctx.globalAlpha = 0.45
  ctx.strokeStyle = hexToRgba(palette.highlight, 0.4)
  ctx.lineWidth = tree.size * 0.18
  ctx.beginPath()
  ctx.moveTo(-canopyWidth * 0.18, -canopyHeight * 0.35)
  ctx.quadraticCurveTo(0, -canopyHeight * 0.7, canopyWidth * 0.22, -canopyHeight * 0.15)
  ctx.stroke()
  ctx.globalAlpha = 1

  ctx.restore()
}

function drawConiferTree(ctx, tree, palette) {
  const height = tree.size * 3.6
  const baseWidth = tree.size * 1.65

  ctx.save()
  ctx.translate(tree.x, tree.y)
  ctx.rotate(tree.lean * 0.15)

  ctx.save()
  ctx.translate(tree.size * 0.12, tree.size * 1.05)
  ctx.fillStyle = 'rgba(15, 42, 28, 0.28)'
  ctx.beginPath()
  ctx.ellipse(0, 0, baseWidth * 0.85, tree.size * 0.55, 0, 0, TWO_PI)
  ctx.fill()
  ctx.restore()

  const trunkHeight = tree.size * 1.1
  const trunkWidth = tree.size * 0.35
  const trunkGradient = ctx.createLinearGradient(0, height * 0.25, 0, height * 0.25 + trunkHeight)
  trunkGradient.addColorStop(0, hexToRgba(palette.cliffs, 0.75))
  trunkGradient.addColorStop(1, 'rgba(40, 22, 12, 0.92)')
  ctx.fillStyle = trunkGradient
  ctx.beginPath()
  ctx.moveTo(-trunkWidth / 2, height * 0.25)
  ctx.lineTo(-trunkWidth / 2, height * 0.25 + trunkHeight)
  ctx.lineTo(trunkWidth / 2, height * 0.25 + trunkHeight)
  ctx.lineTo(trunkWidth / 2, height * 0.25)
  ctx.closePath()
  ctx.fill()

  const layers = tree.layers ?? 4
  for (let i = 0; i < layers; i += 1) {
    const t = layers === 1 ? 0 : i / (layers - 1)
    const layerHeight = height * (0.12 + (1 - t) * 0.24)
    const y = -height * 0.42 + t * height * 0.72
    const width = baseWidth * (1 - t * 0.5)
    const gradient = ctx.createLinearGradient(0, y - layerHeight, 0, y + layerHeight)
    gradient.addColorStop(0, hexToRgba(palette.highlight, 0.85))
    gradient.addColorStop(0.55, hexToRgba(palette.canopy, 0.95))
    gradient.addColorStop(1, 'rgba(10, 48, 30, 0.95)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(0, y - layerHeight)
    ctx.bezierCurveTo(width * 0.52, y - layerHeight * 0.05, width * 0.5, y + layerHeight * 0.45, 0, y + layerHeight)
    ctx.bezierCurveTo(-width * 0.5, y + layerHeight * 0.45, -width * 0.52, y - layerHeight * 0.05, 0, y - layerHeight)
    ctx.closePath()
    ctx.fill()
  }

  ctx.globalAlpha = 0.5
  ctx.strokeStyle = hexToRgba(palette.highlight, 0.35)
  ctx.lineWidth = tree.size * 0.12
  ctx.beginPath()
  ctx.moveTo(0, -height * 0.48)
  ctx.lineTo(0, height * 0.2)
  ctx.stroke()
  ctx.globalAlpha = 1

  ctx.restore()
}

function drawTreeClusters(ctx, island, canopyPath) {
  if (!island.treeClusters?.length) {
    return
  }

  ctx.save()
  ctx.clip(canopyPath)
  for (const cluster of island.treeClusters) {
    for (const tree of cluster.trees) {
      if (tree.type === 'conifer') {
        drawConiferTree(ctx, tree, island.palette)
      } else {
        drawBroadleafTree(ctx, tree, island.palette)
      }
    }
  }
  ctx.restore()
}

function drawCliffs(ctx, island, coastPath) {
  if (!island.cliffs?.length) {
    return
  }

  ctx.save()
  ctx.clip(coastPath)
  ctx.lineCap = 'round'
  for (const cliff of island.cliffs) {
    const cliffPoints = island.coastline.filter((point) => isAngleBetween(point.angle, cliff.startAngle, cliff.endAngle))
    if (cliffPoints.length < 2) {
      continue
    }

    const interiorScale = Math.max(0.72, 0.9 - cliff.layers * 0.04)
    const shadeColor = hexToRgba(island.palette.cliffs, Math.min(0.65, 0.24 + cliff.layers * 0.12))
    const highlight = hexToRgba(island.palette.highlight, 0.35)

    for (const point of cliffPoints) {
      ctx.strokeStyle = shadeColor
      ctx.lineWidth = 3.2 + cliff.layers * 0.25
      ctx.beginPath()
      ctx.moveTo(point.x, point.y)
      ctx.lineTo(point.x * interiorScale, point.y * interiorScale)
      ctx.stroke()
    }

    ctx.strokeStyle = highlight
    ctx.lineWidth = 2.1
    ctx.beginPath()
    ctx.moveTo(cliffPoints[0].x * interiorScale, cliffPoints[0].y * interiorScale)
    for (let i = 1; i < cliffPoints.length; i += 1) {
      const point = cliffPoints[i]
      ctx.lineTo(point.x * interiorScale, point.y * interiorScale)
    }
    ctx.stroke()
  }
  ctx.restore()
}

function drawBoatShadow(ctx, boat) {
  ctx.save()
  const stretch = Math.min(boat.speed / MAX_FORWARD_SPEED, 1)
  ctx.globalAlpha = 0.22 + stretch * 0.08
  ctx.fillStyle = 'rgba(22, 32, 42, 0.4)'
  const bowLength = 46 + stretch * 18
  ctx.beginPath()
  ctx.moveTo(bowLength, 0)
  ctx.quadraticCurveTo(28, 20, -40, 16)
  ctx.quadraticCurveTo(-52, 0, -40, -16)
  ctx.quadraticCurveTo(28, -20, bowLength, 0)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawBoatHull(ctx) {
  const hullGradient = ctx.createLinearGradient(-48, 0, 52, 0)
  hullGradient.addColorStop(0, '#6b3a16')
  hullGradient.addColorStop(0.35, '#b87a3b')
  hullGradient.addColorStop(0.7, '#e7c493')
  hullGradient.addColorStop(1, '#f7dcb1')
  ctx.fillStyle = hullGradient
  ctx.beginPath()
  ctx.moveTo(54, 0)
  ctx.quadraticCurveTo(40, -20, 8, -24)
  ctx.quadraticCurveTo(-30, -22, -46, -8)
  ctx.quadraticCurveTo(-56, 0, -46, 8)
  ctx.quadraticCurveTo(-30, 22, 8, 24)
  ctx.quadraticCurveTo(40, 20, 54, 0)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = '#392010'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255, 236, 204, 0.85)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(36, -12)
  ctx.quadraticCurveTo(10, -18, -32, -10)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(36, 12)
  ctx.quadraticCurveTo(10, 18, -32, 10)
  ctx.stroke()
}

function drawDeckDetails(ctx) {
  ctx.save()

  ctx.fillStyle = '#d2a369'
  ctx.beginPath()
  ctx.moveTo(44, 0)
  ctx.quadraticCurveTo(28, -12, -30, -10)
  ctx.quadraticCurveTo(-36, 0, -30, 10)
  ctx.quadraticCurveTo(28, 12, 44, 0)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#c28d4f'
  ctx.beginPath()
  ctx.moveTo(-12, -10)
  ctx.lineTo(-30, -9)
  ctx.quadraticCurveTo(-34, 0, -30, 9)
  ctx.lineTo(-12, 10)
  ctx.quadraticCurveTo(-6, 0, -12, -10)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#f6e3bb'
  ctx.fillRect(-8, -6, 44, 12)

  ctx.strokeStyle = 'rgba(92, 58, 30, 0.45)'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(-28, -8)
  ctx.lineTo(38, -4)
  ctx.moveTo(-28, 8)
  ctx.lineTo(38, 4)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255, 245, 220, 0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(-36, 0)
  ctx.lineTo(36, 0)
  ctx.stroke()

  ctx.fillStyle = '#855b34'
  ctx.beginPath()
  ctx.moveTo(-26, -7)
  ctx.quadraticCurveTo(-34, 0, -26, 7)
  ctx.lineTo(-10, 7)
  ctx.quadraticCurveTo(-4, 0, -10, -7)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#f0f7ff'
  ctx.fillRect(-18, -4, 6, 8)

  ctx.fillStyle = '#fff3d0'
  ctx.beginPath()
  ctx.moveTo(36, 0)
  ctx.lineTo(24, -8)
  ctx.lineTo(24, 8)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = 'rgba(220, 60, 46, 0.9)'
  ctx.beginPath()
  ctx.moveTo(42, 0)
  ctx.lineTo(30, -10)
  ctx.lineTo(30, 10)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

function drawAnchor(ctx, boat) {
  if (boat.anchorState === 'stowed' && boat.anchorProgress === 0) {
    return
  }

  let progress = 0
  if (boat.anchorState === 'dropping') {
    progress = boat.anchorProgress
  } else if (boat.anchorState === 'anchored') {
    progress = 1
  } else if (boat.anchorState === 'weighing') {
    progress = 1 - boat.anchorProgress
  }

  const eased = progress * progress * (3 - 2 * progress)
  const lineLength = (26 + eased * 46) * 0.5
  const lateralLean = (6 + eased * 18) * 0.5
  const sway = Math.sin(boat.wakeTimer * 1.4) * (1 + eased * 2)

  ctx.save()
  ctx.translate(-22, 16)

  ctx.fillStyle = '#b48b56'
  ctx.beginPath()
  ctx.arc(0, 0, 5.5, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(240, 228, 198, 0.9)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(-lateralLean * 0.45 - sway, lineLength * 0.55, -lateralLean - sway * 0.3, lineLength)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(172, 146, 110, 0.35)'
  ctx.lineWidth = 3.2
  ctx.beginPath()
  ctx.moveTo(-2, 0)
  ctx.quadraticCurveTo(-lateralLean * 0.5 - sway, lineLength * 0.52, -lateralLean - sway * 0.28, lineLength)
  ctx.stroke()

  ctx.restore()
}

function drawMastAndSails(ctx, boat) {
  const { sailLevel } = boat
  ctx.save()
  ctx.translate(-4, 0)

  ctx.fillStyle = '#5b3a20'
  ctx.fillRect(-2, -26, 4, 52)
  ctx.fillStyle = '#a06a38'
  ctx.fillRect(-1, -26, 2, 52)

  const boomLength = 28 + sailLevel * 8
  ctx.fillStyle = '#7a4c27'
  ctx.fillRect(-2, -3, boomLength, 6)

  if (sailLevel < 0.08) {
    const bundled = 20
    ctx.fillStyle = '#dce3ed'
    ctx.fillRect(-2, -6, bundled, 12)
    ctx.strokeStyle = '#c6ccd8'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-2, -4)
    ctx.lineTo(bundled - 2, -4)
    ctx.moveTo(-2, 4)
    ctx.lineTo(bundled - 2, 4)
    ctx.stroke()
  } else {
    const eased = sailLevel * sailLevel * (3 - 2 * sailLevel)
    const sailReach = 18 + eased * 22
    const footDrop = 10 + eased * 10
    const billow = 6 + eased * 14

    ctx.fillStyle = '#f1f5ff'
    ctx.beginPath()
    ctx.moveTo(0, -24)
    ctx.quadraticCurveTo(-sailReach * 0.28, -24 - billow * 0.15, -sailReach, -6)
    ctx.lineTo(-sailReach, footDrop)
    ctx.quadraticCurveTo(-sailReach * 0.36, footDrop - billow * 0.25, 0, 12)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = '#cfdcee'
    ctx.lineWidth = 1.8
    ctx.stroke()

    ctx.strokeStyle = 'rgba(204, 222, 248, 0.7)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-sailReach * 0.78, -2)
    ctx.quadraticCurveTo(-sailReach * 0.54, -2 + billow * 0.45, -sailReach * 0.2, footDrop - 4)
    ctx.stroke()

    ctx.globalAlpha = 0.35
    ctx.fillStyle = '#e4ecf8'
    ctx.beginPath()
    ctx.moveTo(0, -20)
    ctx.quadraticCurveTo(-sailReach * 0.4, -10, -sailReach * 0.2, 6)
    ctx.lineTo(0, 8)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
  }

  ctx.fillStyle = '#ff5b5b'
  ctx.beginPath()
  ctx.moveTo(0, -26)
  ctx.lineTo(12, -32)
  ctx.lineTo(0, -18)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

function addVignette(ctx, width, height) {
  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.max(width, height) * 0.7)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(5, 10, 18, 0.4)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}

export default App
