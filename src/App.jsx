import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const MAP_SIZE = 10000
const ISLAND_COUNT = 16
const MIN_ISLAND_GAP = 900
const MAX_FORWARD_SPEED = 260 // world units per second
const ACCELERATION = 140
const BRAKE_DECELERATION = 220
const TURN_RATE = 1.8
const DRAG = 0.8

const controlKeys = {
  forward: ['w', 'arrowup'],
  backward: ['s', 'arrowdown'],
  left: ['a', 'arrowleft'],
  right: ['d', 'arrowright'],
}

function generateIslands(count) {
  const islands = []
  let attempts = 0
  while (islands.length < count && attempts < count * 60) {
    attempts += 1
    const radius = 180 + Math.random() * 260
    const x = Math.random() * MAP_SIZE
    const y = Math.random() * MAP_SIZE

    if (
      islands.some((existing) => {
        const dx = existing.x - x
        const dy = existing.y - y
        return Math.hypot(dx, dy) < existing.radius + radius + MIN_ISLAND_GAP
      })
    ) {
      continue
    }

    const segments = 14 + Math.floor(Math.random() * 10)
    const points = []
    const contourNoise = 0.4 + Math.random() * 0.3

    for (let j = 0; j < segments; j += 1) {
      const angle = (j / segments) * Math.PI * 2
      const bump = 0.78 + Math.random() * 0.35
      const wobble = 1 + Math.sin(angle * 3 + Math.random() * 2) * contourNoise
      const r = radius * bump * wobble
      points.push({
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
      })
    }

    islands.push({
      id: `island-${islands.length}`,
      x,
      y,
      radius,
      points,
      palette: pickPalette(),
      detailPoints: generateDetailPoints(),
    })
  }

  return islands
}

function pickPalette() {
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
  return palettes[Math.floor(Math.random() * palettes.length)]
}

function generateDetailPoints() {
  return Array.from({ length: 18 }, () => ({
    angle: Math.random() * Math.PI * 2,
    distance: 0.2 + Math.random() * 0.6,
  }))
}

function generateWaves(count) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * MAP_SIZE,
    y: Math.random() * MAP_SIZE,
    amplitude: 18 + Math.random() * 24,
    length: 60 + Math.random() * 120,
    speed: 12 + Math.random() * 22,
    phase: Math.random() * Math.PI * 2,
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
  const pressedKeys = useRef(new Set())
  const wavesRef = useRef(generateWaves(320))
  const { width, height } = useWindowSize()

  const islands = useMemo(() => generateIslands(ISLAND_COUNT), [])

  const [boatState, setBoatState] = useState({
    x: MAP_SIZE / 2,
    y: MAP_SIZE / 2,
    heading: -Math.PI / 2,
    speed: 0,
  })

  const boatRef = useRef(boatState)
  boatRef.current = boatState

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
        current.speed = Math.min(current.speed + ACCELERATION * dt, MAX_FORWARD_SPEED)
      }

      if (commands.backward) {
        current.speed = Math.max(current.speed - BRAKE_DECELERATION * dt, 0)
      }

      if (!commands.forward && !commands.backward) {
        const dragFactor = Math.max(0, 1 - DRAG * dt)
        current.speed *= dragFactor
        if (current.speed < 2) {
          current.speed = 0
        }
      }

      const turnStrength = 0.6 + Math.min(current.speed / MAX_FORWARD_SPEED, 1)

      if (commands.left) {
        current.heading -= TURN_RATE * dt * turnStrength
      }
      if (commands.right) {
        current.heading += TURN_RATE * dt * turnStrength
      }

      const proposedX = current.x + Math.cos(current.heading) * current.speed * dt
      const proposedY = current.y + Math.sin(current.heading) * current.speed * dt

      const collision = detectCollision(proposedX, proposedY, islands)
      if (!collision) {
        current.x = clamp(proposedX, 0, MAP_SIZE)
        current.y = clamp(proposedY, 0, MAP_SIZE)
      } else {
        current.speed = Math.min(current.speed, 38)
      }

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
      drawScene(ctx, { width: canvas.width, height: canvas.height }, boat, islands, wavesRef.current)

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
  }, [height, width, islands])

  return (
    <div className="app">
      <canvas ref={canvasRef} className="world-canvas" />
      <div className="overlay">
        <div className="title">SailTrade</div>
        <div className="stats">
          <span>Speed: {Math.round(boatState.speed)} kn</span>
          <span>
            Heading: {Math.round((((boatState.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI))}
            °
          </span>
        </div>
        <div className="instructions">
          Press <strong>↑</strong>/<strong>W</strong> to catch more wind, <strong>↓</strong>/<strong>S</strong> to trim your sails, and use <strong>←</strong>/<strong>→</strong> or <strong>A</strong>/<strong>D</strong> to turn the bow.
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

function detectCollision(x, y, islands) {
  return islands.some((island) => {
    const dx = x - island.x
    const dy = y - island.y
    const limit = island.radius * 0.82
    return dx * dx + dy * dy < limit * limit
  })
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

function drawScene(ctx, viewport, boat, islands, waves) {
  const { width, height } = viewport
  const camera = {
    x: boat.x - width / 2,
    y: boat.y - height / 2,
  }

  ctx.imageSmoothingEnabled = false
  paintSea(ctx, width, height, camera, waves)
  drawIslands(ctx, islands, camera)
  drawBoat(ctx, boat, camera)
  addVignette(ctx, width, height)
}

function paintSea(ctx, width, height, camera, waves) {
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#102a4d')
  gradient.addColorStop(0.5, '#114b73')
  gradient.addColorStop(1, '#0a243b')
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

function drawIslands(ctx, islands, camera) {
  for (const island of islands) {
    const screenX = island.x - camera.x
    const screenY = island.y - camera.y
    if (screenX < -island.radius * 2 || screenX > ctx.canvas.width + island.radius * 2 || screenY < -island.radius * 2 || screenY > ctx.canvas.height + island.radius * 2) {
      continue
    }

    ctx.save()
    ctx.translate(screenX, screenY)

    const coastPath = buildPath(island.points)
    const beachPoints = scalePoints(island.points, 0.8)
    const grassPoints = scalePoints(island.points, 0.58)
    const canopyPoints = scalePoints(island.points, 0.4)

    ctx.fillStyle = island.palette.shore
    ctx.strokeStyle = `rgba(0, 0, 0, 0.45)`
    ctx.lineWidth = 4
    ctx.fill(coastPath)
    ctx.stroke(coastPath)

    ctx.fillStyle = island.palette.beach
    ctx.fill(buildPath(beachPoints))

    ctx.fillStyle = island.palette.grass
    ctx.fill(buildPath(grassPoints))

    ctx.save()
    ctx.fillStyle = island.palette.canopy
    const canopyPath = buildPath(canopyPoints)
    ctx.fill(canopyPath)
    addCanopyHighlights(ctx, canopyPoints, island.palette.highlight)
    ctx.restore()

    addCliffStrata(ctx, coastPath, island)
    sprinkleDetails(ctx, island)

    ctx.restore()
  }
}

function drawBoat(ctx, boat, camera) {
  const screenX = boat.x - camera.x
  const screenY = boat.y - camera.y
  ctx.save()
  ctx.translate(screenX, screenY)
  ctx.rotate(boat.heading)

  drawBoatShadow(ctx)
  drawBoatHull(ctx)
  drawDeckDetails(ctx)
  drawMastAndSails(ctx)

  ctx.restore()
}

function buildPath(points) {
  const path = new Path2D()
  points.forEach((point, index) => {
    if (index === 0) {
      path.moveTo(point.x, point.y)
    } else {
      path.lineTo(point.x, point.y)
    }
  })
  path.closePath()
  return path
}

function scalePoints(points, factor) {
  return points.map((point) => ({ x: point.x * factor, y: point.y * factor }))
}

function addCliffStrata(ctx, coastPath, island) {
  ctx.save()
  ctx.clip(coastPath)
  ctx.globalAlpha = 0.35
  ctx.fillStyle = island.palette.cliffs
  for (let i = -island.radius; i < island.radius; i += 18) {
    ctx.fillRect(-island.radius, i, island.radius * 2, 6)
  }
  ctx.restore()
}

function addCanopyHighlights(ctx, points, highlightColor) {
  ctx.save()
  ctx.fillStyle = highlightColor
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const midX = (a.x + b.x) / 2
    const midY = (a.y + b.y) / 2
    ctx.fillRect(midX - 2, midY - 2, 4, 4)
  }
  ctx.restore()
}

function sprinkleDetails(ctx, island) {
  ctx.save()
  ctx.fillStyle = island.palette.highlight
  island.detailPoints.forEach((detail) => {
    const radius = island.radius * detail.distance
    const x = Math.cos(detail.angle) * radius
    const y = Math.sin(detail.angle) * radius
    ctx.fillRect(x - 2, y - 2, 4, 4)
  })
  ctx.restore()
}

function drawBoatShadow(ctx) {
  ctx.save()
  ctx.globalAlpha = 0.25
  ctx.fillStyle = 'rgba(22, 32, 42, 0.35)'
  ctx.beginPath()
  ctx.moveTo(0, 42)
  ctx.quadraticCurveTo(24, 30, 32, 0)
  ctx.quadraticCurveTo(0, 18, -32, 0)
  ctx.quadraticCurveTo(-24, 30, 0, 42)
  ctx.fill()
  ctx.restore()
}

function drawBoatHull(ctx) {
  const hullGradient = ctx.createLinearGradient(0, -42, 0, 42)
  hullGradient.addColorStop(0, '#f4cfa5')
  hullGradient.addColorStop(0.4, '#b87a3b')
  hullGradient.addColorStop(1, '#6b3a16')
  ctx.fillStyle = hullGradient
  ctx.beginPath()
  ctx.moveTo(0, -46)
  ctx.lineTo(20, -14)
  ctx.lineTo(16, 34)
  ctx.lineTo(0, 48)
  ctx.lineTo(-16, 34)
  ctx.lineTo(-20, -14)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = '#341d0e'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.strokeStyle = '#ffe0b8'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, -40)
  ctx.lineTo(12, -12)
  ctx.lineTo(8, 28)
  ctx.lineTo(0, 36)
  ctx.lineTo(-8, 28)
  ctx.lineTo(-12, -12)
  ctx.closePath()
  ctx.stroke()
}

function drawDeckDetails(ctx) {
  ctx.fillStyle = '#d9a864'
  ctx.fillRect(-10, -6, 20, 18)
  ctx.fillStyle = '#8c592e'
  ctx.fillRect(-6, 6, 12, 10)

  ctx.fillStyle = '#fbe7c7'
  ctx.fillRect(-3, -24, 6, 10)
}

function drawMastAndSails(ctx) {
  ctx.fillStyle = '#5c3b1d'
  ctx.fillRect(-2, -42, 4, 36)
  ctx.fillRect(-1, -48, 2, 6)
  ctx.fillStyle = '#ff3b3b'
  ctx.fillRect(2, -46, 10, 6)
  ctx.fillStyle = '#f0f6ff'
  ctx.beginPath()
  ctx.moveTo(2, -38)
  ctx.lineTo(36, -6)
  ctx.lineTo(2, -6)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#cddff8'
  ctx.beginPath()
  ctx.moveTo(-2, -32)
  ctx.lineTo(-34, -2)
  ctx.lineTo(-2, -2)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = '#2b2f45'
  ctx.lineWidth = 2
  ctx.strokeRect(-2, -42, 4, 36)
}

function addVignette(ctx, width, height) {
  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.max(width, height) * 0.7)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(5, 10, 18, 0.4)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}

export default App
