import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const MAP_SIZE = 3600
const ISLAND_COUNT = 22
const MAX_FORWARD_SPEED = 220 // world units per second
const MAX_REVERSE_SPEED = 60
const ACCELERATION = 160
const TURN_RATE = 1.6
const DRAG = 0.9

const controlKeys = {
  forward: ['w', 'arrowup'],
  backward: ['s', 'arrowdown'],
  left: ['a', 'arrowleft'],
  right: ['d', 'arrowright'],
}

function generateIslands(count) {
  const islands = []
  for (let i = 0; i < count; i += 1) {
    const radius = 120 + Math.random() * 240
    const x = Math.random() * MAP_SIZE
    const y = Math.random() * MAP_SIZE
    const segments = 12 + Math.floor(Math.random() * 8)
    const points = []

    for (let j = 0; j < segments; j += 1) {
      const angle = (j / segments) * Math.PI * 2
      const wobble = 0.65 + Math.random() * 0.55
      points.push({
        x: Math.cos(angle) * radius * wobble,
        y: Math.sin(angle) * radius * wobble,
      })
    }

    islands.push({
      id: `island-${i}`,
      x,
      y,
      radius,
      points,
      palette: pickPalette(),
      brushTexture: generateBrushTexture(),
    })
  }

  return islands
}

function pickPalette() {
  const palettes = [
    ['#d1c7a1', '#a58f6f', '#6f5d43'],
    ['#dcd2b8', '#bba177', '#7f704f'],
    ['#e0d3a2', '#b89961', '#8d7549'],
  ]
  return palettes[Math.floor(Math.random() * palettes.length)]
}

function generateBrushTexture() {
  return Array.from({ length: 24 }, () => ({
    angle: Math.random() * Math.PI * 2,
    distance: Math.random(),
    size: 0.6 + Math.random() * 0.9,
    opacity: 0.18 + Math.random() * 0.25,
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
  const wavesRef = useRef(generateWaves(220))
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
      } else if (commands.backward) {
        current.speed = Math.max(current.speed - ACCELERATION * dt * 0.6, -MAX_REVERSE_SPEED)
      } else {
        const dragFactor = Math.max(0, 1 - DRAG * dt)
        current.speed *= dragFactor
        if (Math.abs(current.speed) < 2) {
          current.speed = 0
        }
      }

      const turnStrength = 1 + Math.min(Math.abs(current.speed) / MAX_FORWARD_SPEED, 1)

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
        current.speed = Math.min(current.speed, 30)
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
        <div className="title">SailTrade — Shores of Promise</div>
        <div className="stats">
          <span>Speed: {Math.abs(Math.round(boatState.speed))} kn</span>
          <span>
            Heading: {Math.round((((boatState.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI))}
            °
          </span>
        </div>
        <div className="instructions">
          Steer with <strong>WASD</strong> or <strong>arrow keys</strong>. Explore the painted archipelago and find your own trade winds.
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

  paintSea(ctx, width, height, camera, waves)
  drawIslands(ctx, islands, camera)
  drawBoat(ctx, boat, camera)
  addVignette(ctx, width, height)
}

function paintSea(ctx, width, height, camera, waves) {
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#203244')
  gradient.addColorStop(0.4, '#1a4a63')
  gradient.addColorStop(1, '#112433')
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
    waveGradient.addColorStop(0, 'rgba(207, 231, 247, 0)')
    waveGradient.addColorStop(0.5, 'rgba(207, 231, 247, 0.18)')
    waveGradient.addColorStop(1, 'rgba(207, 231, 247, 0)')
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

    const path = new Path2D()
    island.points.forEach((point, index) => {
      if (index === 0) {
        path.moveTo(point.x, point.y)
      } else {
        path.lineTo(point.x, point.y)
      }
    })
    path.closePath()

    const [highlight, mid, shadow] = island.palette
    const fill = ctx.createRadialGradient(0, 0, island.radius * 0.1, 0, 0, island.radius * 1.1)
    fill.addColorStop(0, highlight)
    fill.addColorStop(0.55, mid)
    fill.addColorStop(1, shadow)
    ctx.fillStyle = fill
    ctx.fill(path)

    ctx.lineWidth = 6
    ctx.strokeStyle = 'rgba(62, 51, 35, 0.6)'
    ctx.stroke(path)

    ctx.save()
    ctx.globalCompositeOperation = 'overlay'
    for (const brush of island.brushTexture) {
      const length = island.radius * 0.6 * brush.size
      const offsetRadius = island.radius * 0.3 * brush.distance
      const bx = Math.cos(brush.angle) * offsetRadius
      const by = Math.sin(brush.angle) * offsetRadius
      ctx.save()
      ctx.translate(bx, by)
      ctx.rotate(brush.angle)
      const brushGradient = ctx.createLinearGradient(-length / 2, 0, length / 2, 0)
      brushGradient.addColorStop(0, 'rgba(255, 243, 214, 0)')
      brushGradient.addColorStop(0.5, `rgba(255, 243, 214, ${brush.opacity})`)
      brushGradient.addColorStop(1, 'rgba(255, 243, 214, 0)')
      ctx.fillStyle = brushGradient
      ctx.fillRect(-length / 2, -8, length, 16)
      ctx.restore()
    }
    ctx.restore()

    ctx.restore()
  }
}

function drawBoat(ctx, boat, camera) {
  const screenX = boat.x - camera.x
  const screenY = boat.y - camera.y
  ctx.save()
  ctx.translate(screenX, screenY)
  ctx.rotate(boat.heading)

  ctx.save()
  ctx.globalAlpha = 0.35
  ctx.fillStyle = 'rgba(240, 248, 255, 0.35)'
  ctx.beginPath()
  ctx.moveTo(-12, 28)
  ctx.quadraticCurveTo(-32, 16, -48, 0)
  ctx.quadraticCurveTo(-4, 12, 0, 0)
  ctx.quadraticCurveTo(4, 12, 48, 0)
  ctx.quadraticCurveTo(32, 16, 12, 28)
  ctx.fill()
  ctx.restore()

  const hullGradient = ctx.createLinearGradient(0, -36, 0, 36)
  hullGradient.addColorStop(0, '#f7f1da')
  hullGradient.addColorStop(0.45, '#d8c6a0')
  hullGradient.addColorStop(1, '#8f7257')
  ctx.fillStyle = hullGradient
  ctx.beginPath()
  ctx.moveTo(0, -36)
  ctx.quadraticCurveTo(22, -12, 16, 32)
  ctx.quadraticCurveTo(0, 44, -16, 32)
  ctx.quadraticCurveTo(-22, -12, 0, -36)
  ctx.fill()

  ctx.strokeStyle = 'rgba(62, 44, 33, 0.6)'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)'
  ctx.beginPath()
  ctx.moveTo(0, -30)
  ctx.lineTo(12, 8)
  ctx.lineTo(-12, 8)
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
