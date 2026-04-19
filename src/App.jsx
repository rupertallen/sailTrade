import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const MAP_SIZE = 12000
const MIN_SETTLEMENT_COUNT = 5
const ISLAND_COUNT = 16
const MIN_ISLAND_GAP = 900
const MAP_EDGE_CLEARANCE = 900
const DOCKING_DISTANCE = 420
const TWO_PI = Math.PI * 2
const MAX_FORWARD_SPEED = 260 // world units per second
const ACCELERATION = 140
const BRAKE_DECELERATION = 220
const TURN_RATE = 1.8
const MIN_HEALTH = 0.05

const WIND_MIN_STRENGTH = 0.25
const WIND_MAX_STRENGTH = 1
const WIND_DIRECTION_VARIANCE = Math.PI / 3
const WIND_CHANGE_MIN = 48
const WIND_CHANGE_MAX = 92
const WIND_ADJUST_RATE = 0.12
const NO_GO_ANGLE_DEGREES = 20
const TACK_TARGET_DEGREES = 35
const TACK_TURN_RATE = 1.6
const TACK_PERIOD_MIN = 5.5
const TACK_PERIOD_MAX = 8.5
const WIND_SPEED_BASE_KNOTS = 6
const WIND_SPEED_MAX_KNOTS = 28

const DAMAGE_STATES = [
  { label: 'Sound', minHealth: 0.999, penalty: 0 },
  { label: 'Lightly Riddled', minHealth: 0.9, penalty: 0.1 },
  { label: 'Shaken', minHealth: 0.75, penalty: 0.25 },
  { label: 'Much Shattered', minHealth: 0.55, penalty: 0.45 },
  { label: 'Crippled', minHealth: 0.3, penalty: 0.7 },
  { label: 'A Wreck', minHealth: 0.15, penalty: 0.85 },
  { label: 'Foundering', minHealth: MIN_HEALTH, penalty: 0.95 },
]

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

const BOAT_LENGTH =
  Math.max(...BOAT_COLLISION_OUTLINE.map((point) => point.x)) -
  Math.min(...BOAT_COLLISION_OUTLINE.map((point) => point.x))
const BOAT_WIDTH =
  Math.max(...BOAT_COLLISION_OUTLINE.map((point) => point.y)) -
  Math.min(...BOAT_COLLISION_OUTLINE.map((point) => point.y))
const HOUSE_MAX_DIMENSION = BOAT_LENGTH / 3

const MINIMAP_WORLD_RADIUS = 2200
const COLLISION_EDGE_THRESHOLD = 10
const NAME_SYLLABLE_PREFIXES = [
  'Ash',
  'Beck',
  'Black',
  'Bracken',
  'Bright',
  'Cinder',
  'Cliff',
  'Crown',
  'Drift',
  'Eagle',
  'Fair',
  'Fog',
  'Fox',
  'Gale',
  'Glen',
  'Harbor',
  'High',
  'Iron',
  'King',
  'Lark',
  'Maple',
  'Oak',
  'Port',
  'Raven',
  'Red',
  'Salt',
  'Sea',
  'Silver',
  'Storm',
  'Summer',
  'Whit',
  'Wind',
  'Winter',
]

const NAME_SYLLABLE_SUFFIXES = [
  'bay',
  'bourne',
  'cliff',
  'cove',
  'ford',
  'gate',
  'haven',
  'holm',
  'mere',
  'mist',
  'moor',
  'point',
  'port',
  'reach',
  'rest',
  'rock',
  'shade',
  'shore',
  'stead',
  'ton',
  'view',
  'watch',
  'wick',
]

const NAME_SECOND_WORDS = [
  'Cove',
  'Harbor',
  'Haven',
  'Isle',
  'Island',
  'Key',
  'Lagoon',
  'Point',
  'Reach',
  'Sound',
  'Spire',
  'Watch',
]

const NAME_DESCRIPTORS = ['Isle', 'Island', 'Atoll', 'Cay']

const SETTLEMENT_SIZE_OPTIONS = [
  {
    id: 'village',
    label: 'Seaside Village',
    minRadius: 320,
    populationRange: [260, 640],
    buildingRange: [10, 16],
    dockLengthMultiplier: 0.52,
  },
  {
    id: 'harbor-town',
    label: 'Harbor Town',
    minRadius: 560,
    populationRange: [720, 1480],
    buildingRange: [18, 28],
    dockLengthMultiplier: 0.6,
  },
  {
    id: 'port-town',
    label: 'Port Town',
    minRadius: 700,
    populationRange: [1600, 3200],
    buildingRange: [30, 44],
    dockLengthMultiplier: 0.68,
  },
]

const SETTLEMENT_NAME_SUFFIXES = [
  'Harbor',
  'Landing',
  'Quay',
  'Wharf',
  'Bay',
  'Haven',
  'Port',
  'Harbour',
]

const SETTLEMENT_MARKET_THEMES = ['Spice', 'Timber', 'Fish', 'Sails', 'Charts', 'Trade']
const SETTLEMENT_DECOR_TYPES = ['crate', 'barrel', 'cart', 'stack', 'firepit', 'drying-rack']

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

function getDamageStateForHealth(health) {
  const normalized = Math.max(MIN_HEALTH, Math.min(1, health ?? 1))
  for (const state of DAMAGE_STATES) {
    if (normalized >= state.minHealth) {
      return state
    }
  }
  return DAMAGE_STATES[DAMAGE_STATES.length - 1]
}

function getMaxSpeedForHealth(health) {
  const state = getDamageStateForHealth(health)
  return MAX_FORWARD_SPEED * (1 - state.penalty)
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
    health: 1,
    anchorState: 'stowed',
    anchorProgress: 0,
    wakeTimer: 0,
    tackTimer: 0,
    tackDirection: 1,
    landStatus: {
      zone: 'sea',
      distance: Infinity,
      signedDistance: Infinity,
      normal: { x: 0, y: 0 },
      nearestPoint: null,
      islandId: null,
      penetration: 0,
      structureType: null,
    },
    wind: {
      direction: 0,
      strength: 0,
      angleToWind: 0,
      multiplier: 1,
      isTacking: false,
    },
    dockedSettlementId: null,
  }
}

function createInitialWindState(random = Math.random) {
  const direction = normalizeAngle(random() * TWO_PI)
  const strength = clamp(0.35 + random() * 0.4, WIND_MIN_STRENGTH, WIND_MAX_STRENGTH)
  const changeTimer = WIND_CHANGE_MIN + random() * (WIND_CHANGE_MAX - WIND_CHANGE_MIN)
  return {
    direction,
    strength,
    targetDirection: direction,
    targetStrength: strength,
    changeTimer,
  }
}

function updateWindState(wind, dt, random = Math.random) {
  const next = {
    direction: wind?.direction ?? 0,
    strength: wind?.strength ?? WIND_MIN_STRENGTH,
    targetDirection: wind?.targetDirection ?? wind?.direction ?? 0,
    targetStrength: wind?.targetStrength ?? wind?.strength ?? WIND_MIN_STRENGTH,
    changeTimer: wind?.changeTimer ?? 0,
  }

  next.changeTimer -= dt
  if (next.changeTimer <= 0) {
    const directionOffset = (random() - 0.5) * 2 * WIND_DIRECTION_VARIANCE
    next.targetDirection = normalizeAngle(next.direction + directionOffset)
    const strengthDelta = (random() - 0.5) * 0.45
    next.targetStrength = clamp(
      next.targetStrength + strengthDelta,
      WIND_MIN_STRENGTH,
      WIND_MAX_STRENGTH,
    )
    const interval = WIND_CHANGE_MIN + random() * (WIND_CHANGE_MAX - WIND_CHANGE_MIN)
    next.changeTimer = interval
  }

  const directionDiff = shortestAngleDiff(next.targetDirection, next.direction)
  next.direction = normalizeAngle(next.direction + directionDiff * dt * WIND_ADJUST_RATE)
  const strengthDiff = next.targetStrength - next.strength
  next.strength += strengthDiff * dt * WIND_ADJUST_RATE
  next.strength = clamp(next.strength, WIND_MIN_STRENGTH, WIND_MAX_STRENGTH)

  return next
}

const WIND_ANGLE_PROFILE = [
  { angle: 0, multiplier: 0 },
  { angle: 20, multiplier: 0 },
  { angle: 35, multiplier: 0.56 },
  { angle: 60, multiplier: 0.86 },
  { angle: 90, multiplier: 1.05 },
  { angle: 120, multiplier: 1.18 },
  { angle: 150, multiplier: 1.22 },
  { angle: 180, multiplier: 1.35 },
]

function getWindMultiplierForAngle(angleDegrees) {
  const clampedAngle = clamp(angleDegrees, 0, 180)
  for (let i = 0; i < WIND_ANGLE_PROFILE.length - 1; i += 1) {
    const current = WIND_ANGLE_PROFILE[i]
    const next = WIND_ANGLE_PROFILE[i + 1]
    if (clampedAngle >= current.angle && clampedAngle <= next.angle) {
      const range = next.angle - current.angle || 1
      const t = (clampedAngle - current.angle) / range
      return lerp(current.multiplier, next.multiplier, t)
    }
  }
  const last = WIND_ANGLE_PROFILE[WIND_ANGLE_PROFILE.length - 1]
  return last.multiplier
}

const CARDINAL_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function getCardinalDirection(degrees) {
  const normalized = ((degrees % 360) + 360) % 360
  const index = Math.round(normalized / 45) % CARDINAL_DIRECTIONS.length
  return CARDINAL_DIRECTIONS[index]
}

function getRelativeWindDescription(angleDegrees) {
  if (angleDegrees == null) {
    return 'Calm'
  }
  if (angleDegrees < NO_GO_ANGLE_DEGREES) {
    return 'Headwind'
  }
  if (angleDegrees < 50) {
    return 'Close hauled'
  }
  if (angleDegrees < 80) {
    return 'Close reach'
  }
  if (angleDegrees < 110) {
    return 'Beam reach'
  }
  if (angleDegrees < 150) {
    return 'Broad reach'
  }
  return 'Running'
}

function normalizeAngle(angle) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI
}

function shortestAngleDiff(a, b) {
  const wrapped = normalizeAngle(a - b + Math.PI)
  return wrapped - Math.PI
}

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function radiansToDegrees(radians) {
  return (radians * 180) / Math.PI
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function gaussianFalloff(diff, width) {
  const ratio = diff / width
  return Math.exp(-(ratio * ratio))
}

function pseudoRandom2D(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return value - Math.floor(value)
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

function capitalize(word) {
  if (!word) {
    return ''
  }
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function generateIslandName(random = Math.random, usedNames = new Set()) {
  let attempt = 0
  while (attempt < 40) {
    attempt += 1

    const pattern = random()
    let candidate = ''

    if (pattern < 0.34) {
      const prefix = NAME_SYLLABLE_PREFIXES[Math.floor(random() * NAME_SYLLABLE_PREFIXES.length)]
      const suffix = NAME_SYLLABLE_SUFFIXES[Math.floor(random() * NAME_SYLLABLE_SUFFIXES.length)]
      const descriptor = NAME_DESCRIPTORS[Math.floor(random() * NAME_DESCRIPTORS.length)]
      candidate = `${capitalize(prefix + suffix)} ${descriptor}`
    } else if (pattern < 0.68) {
      const first = NAME_SYLLABLE_PREFIXES[Math.floor(random() * NAME_SYLLABLE_PREFIXES.length)]
      const second = NAME_SECOND_WORDS[Math.floor(random() * NAME_SECOND_WORDS.length)]
      candidate = `${capitalize(first)} ${second}`
    } else {
      const prefix = NAME_SYLLABLE_PREFIXES[Math.floor(random() * NAME_SYLLABLE_PREFIXES.length)]
      const suffix = NAME_SYLLABLE_SUFFIXES[Math.floor(random() * NAME_SYLLABLE_SUFFIXES.length)]
      candidate = capitalize(prefix + suffix)
    }

    if (!usedNames.has(candidate)) {
      usedNames.add(candidate)
      return candidate
    }
  }

  const fallback = `Isle ${usedNames.size + 1}`
  usedNames.add(fallback)
  return fallback
}

function generateSettlementName(random, usedNames, islandName) {
  let attempt = 0
  const baseName = islandName?.split(' ')[0]

  while (attempt < 60) {
    attempt += 1
    const pattern = random()
    const suffix = SETTLEMENT_NAME_SUFFIXES[Math.floor(random() * SETTLEMENT_NAME_SUFFIXES.length)]
    let candidate

    if (pattern < 0.45 && baseName) {
      candidate = `${baseName} ${suffix}`
    } else if (pattern < 0.78) {
      const prefix = NAME_SYLLABLE_PREFIXES[Math.floor(random() * NAME_SYLLABLE_PREFIXES.length)]
      candidate = `${capitalize(prefix)} ${suffix}`
    } else {
      const compositePrefix = NAME_SYLLABLE_PREFIXES[Math.floor(random() * NAME_SYLLABLE_PREFIXES.length)]
      const compositeSuffix = NAME_SYLLABLE_SUFFIXES[Math.floor(random() * NAME_SYLLABLE_SUFFIXES.length)]
      candidate = `Port ${capitalize(compositePrefix + compositeSuffix)}`
    }

    if (pattern > 0.88) {
      const theme = SETTLEMENT_MARKET_THEMES[Math.floor(random() * SETTLEMENT_MARKET_THEMES.length)]
      candidate = `${candidate} ${theme}`
    }

    if (!usedNames.has(candidate)) {
      usedNames.add(candidate)
      return candidate
    }
  }

  const fallback = `Harbor ${usedNames.size + 1}`
  usedNames.add(fallback)
  return fallback
}

function findPointClosestToAngle(points, angle) {
  if (!points?.length) {
    return { angle, radius: 0, x: Math.cos(angle), y: Math.sin(angle) }
  }

  let best = points[0]
  let smallest = Math.abs(shortestAngleDiff(angle, best.angle))
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]
    const diff = Math.abs(shortestAngleDiff(angle, point.angle))
    if (diff < smallest) {
      smallest = diff
      best = point
    }
  }
  return best
}

function averagePoint(points) {
  if (!points?.length) {
    return { x: 0, y: 0 }
  }

  const sum = points.reduce(
    (acc, point) => {
      acc.x += point.x
      acc.y += point.y
      return acc
    },
    { x: 0, y: 0 },
  )

  return { x: sum.x / points.length, y: sum.y / points.length }
}

function createDockStructure(angle, coastlinePoint, radius, sizeProfile, random) {
  const direction = { x: Math.cos(angle), y: Math.sin(angle) }
  const length = BOAT_LENGTH * 3
  const width = BOAT_WIDTH
  const retract = Math.min(radius * 0.08, 60)
  const landwardBase = {
    x: coastlinePoint.x - direction.x * retract,
    y: coastlinePoint.y - direction.y * retract,
  }
  const outerEnd = {
    x: landwardBase.x + direction.x * length,
    y: landwardBase.y + direction.y * length,
  }
  const halfWidth = width / 2
  const perpendicular = { x: -direction.y, y: direction.x }
  const polygon = [
    {
      x: landwardBase.x + perpendicular.x * halfWidth,
      y: landwardBase.y + perpendicular.y * halfWidth,
    },
    {
      x: landwardBase.x - perpendicular.x * halfWidth,
      y: landwardBase.y - perpendicular.y * halfWidth,
    },
    {
      x: outerEnd.x - perpendicular.x * halfWidth,
      y: outerEnd.y - perpendicular.y * halfWidth,
    },
    {
      x: outerEnd.x + perpendicular.x * halfWidth,
      y: outerEnd.y + perpendicular.y * halfWidth,
    },
  ]

  const berthFactor = 0.55 + (random?.() ?? Math.random()) * 0.1
  const approachMultiplier = 1.2 + (random?.() ?? Math.random()) * 0.3
  const berthPoint = {
    x: landwardBase.x + direction.x * (length * berthFactor),
    y: landwardBase.y + direction.y * (length * berthFactor),
  }

  const approachPoint = {
    x: outerEnd.x + direction.x * (BOAT_LENGTH * approachMultiplier),
    y: outerEnd.y + direction.y * (BOAT_LENGTH * approachMultiplier),
  }

  return {
    polygon,
    direction,
    landwardBase,
    berthPoint,
    approachPoint,
    width,
    length,
  }
}

function generateSettlementForIsland(island, random, usedNames, options = {}) {
  const { force = false } = options
  const candidates = SETTLEMENT_SIZE_OPTIONS.filter((option) => island.radius >= option.minRadius)
  if (!candidates.length) {
    return null
  }

  if (!force) {
    const spawnChance = Math.min(0.82, 0.45 + (island.radius - candidates[0].minRadius) / 1400)
    if (random() > spawnChance) {
      return null
    }
  }

  const choice = candidates[Math.floor(random() * candidates.length)]
  const placementAngle = random() * TWO_PI
  const coastlinePoint = findPointClosestToAngle(island.coastline, placementAngle)
  const dock = createDockStructure(placementAngle, coastlinePoint, island.radius, choice, random)

  const settlementRadius = coastlinePoint.radius * 0.48
  const center = {
    x: Math.cos(placementAngle) * settlementRadius,
    y: Math.sin(placementAngle) * settlementRadius,
  }

  const plazaRadius = Math.max(34, 36 + island.radius * 0.05)
  const roadEnd = {
    x: dock.landwardBase.x + dock.direction.x * 12,
    y: dock.landwardBase.y + dock.direction.y * 12,
  }

  const buildingCountRange = choice.buildingRange
  const buildingCount = buildingCountRange[0] + Math.floor(random() * (buildingCountRange[1] - buildingCountRange[0] + 1))
  const streetWidth = Math.max(12, HOUSE_MAX_DIMENSION * 0.35)
  const columnStreetWidth = Math.max(10, streetWidth * 0.6)
  const columnSpacing = HOUSE_MAX_DIMENSION * 0.95 + columnStreetWidth
  const maxPerRow = 4 + (choice.id === 'port-town' ? 3 : choice.id === 'harbor-town' ? 2 : 1)

  const rowPlans = []
  let allocated = 0
  while (allocated < buildingCount) {
    const remaining = buildingCount - allocated
    const rowCapacity = Math.min(maxPerRow, remaining)
    const rowPlan = []
    for (let column = 0; column < rowCapacity; column += 1) {
      const depth = HOUSE_MAX_DIMENSION * (0.42 + random() * 0.32)
      const width = HOUSE_MAX_DIMENSION * (0.46 + random() * 0.28)
      const roofHeight = 16 + random() * 10 + rowPlans.length * 4
      rowPlan.push({ depth, width, roofHeight, hueShift: random() })
    }
    rowPlans.push(rowPlan)
    allocated += rowCapacity
  }

  const direction = dock.direction
  const perpendicular = { x: -direction.y, y: direction.x }
  const buildings = []
  const rows = []
  const streets = []
  let offsetAlongDirection = 0

  for (let rowIndex = 0; rowIndex < rowPlans.length; rowIndex += 1) {
    const rowPlan = rowPlans[rowIndex]
    if (!rowPlan.length) {
      continue
    }

    const rowDepth = Math.max(...rowPlan.map((plan) => plan.depth))
    const anchorBase = {
      x: center.x - direction.x * offsetAlongDirection,
      y: center.y - direction.y * offsetAlongDirection,
    }

    const rowBuildings = []
    for (let column = 0; column < rowPlan.length; column += 1) {
      const plan = rowPlan[column]
      const offsetFromCenter = (column - (rowPlan.length - 1) / 2) * columnSpacing
      const frontCenter = {
        x: anchorBase.x + perpendicular.x * offsetFromCenter,
        y: anchorBase.y + perpendicular.y * offsetFromCenter,
      }
      const halfWidth = plan.width / 2
      const forward = { x: -direction.x * plan.depth, y: -direction.y * plan.depth }
      const left = { x: perpendicular.x * halfWidth, y: perpendicular.y * halfWidth }
      const right = { x: -perpendicular.x * halfWidth, y: -perpendicular.y * halfWidth }

      const frontLeft = { x: frontCenter.x + left.x, y: frontCenter.y + left.y }
      const frontRight = { x: frontCenter.x + right.x, y: frontCenter.y + right.y }
      const backLeft = { x: frontLeft.x + forward.x, y: frontLeft.y + forward.y }
      const backRight = { x: frontRight.x + forward.x, y: frontRight.y + forward.y }

      const building = {
        footprint: [frontLeft, frontRight, backRight, backLeft],
        roofHeight: plan.roofHeight,
        hueShift: plan.hueShift,
        row: rowIndex,
        column,
      }

      buildings.push(building)
      rowBuildings.push(building)
    }

    rows[rowIndex] = rowBuildings
    offsetAlongDirection += rowDepth + streetWidth
  }

  const streetColor = random() < 0.5 ? 'rgba(120, 108, 96, 0.78)' : 'rgba(102, 94, 84, 0.78)'
  const streetBorder = 'rgba(52, 41, 31, 0.28)'

  for (const rowBuildings of rows) {
    if (!rowBuildings?.length) {
      continue
    }
    for (let i = 0; i < rowBuildings.length - 1; i += 1) {
      const left = rowBuildings[i]
      const right = rowBuildings[i + 1]
      streets.push({
        polygon: [left.footprint[1], right.footprint[0], right.footprint[3], left.footprint[2]],
      })
    }
  }

  for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
    const current = rows[rowIndex]
    const next = rows[rowIndex + 1]
    if (!current?.length || !next?.length) {
      continue
    }
    streets.push({
      polygon: [
        averagePoint(current.map((building) => building.footprint[3])),
        averagePoint(current.map((building) => building.footprint[2])),
        averagePoint(next.map((building) => building.footprint[1])),
        averagePoint(next.map((building) => building.footprint[0])),
      ],
    })
  }

  if (rows[0]?.length) {
    const firstRow = rows[0]
    const frontLeftAvg = averagePoint(firstRow.map((building) => building.footprint[0]))
    const frontRightAvg = averagePoint(firstRow.map((building) => building.footprint[1]))
    const connectorHalfWidth = streetWidth * 0.8
    streets.push({
      polygon: [
        frontLeftAvg,
        frontRightAvg,
        {
          x: roadEnd.x - perpendicular.x * connectorHalfWidth,
          y: roadEnd.y - perpendicular.y * connectorHalfWidth,
        },
        {
          x: roadEnd.x + perpendicular.x * connectorHalfWidth,
          y: roadEnd.y + perpendicular.y * connectorHalfWidth,
        },
      ],
    })
  }

  const decor = []
  const detailCount = Math.min(30, Math.round(buildingCount * (0.5 + random() * 0.6)))
  for (let i = 0; i < detailCount; i += 1) {
    const building = buildings[Math.floor(random() * buildings.length)]
    if (!building) {
      continue
    }

    const [frontLeft, frontRight, backRight, backLeft] = building.footprint
    const edgeMid = random() < 0.5 ? averagePoint([frontLeft, frontRight]) : averagePoint([backLeft, backRight])
    const side = random() < 0.5 ? 1 : -1
    const depthDirection = random() < 0.5 ? -1 : 1
    const offsetAlongStreet = streetWidth * (0.35 + random() * 0.7)
    const offsetDepth = streetWidth * (0.1 + random() * 0.5)

    decor.push({
      type: SETTLEMENT_DECOR_TYPES[Math.floor(random() * SETTLEMENT_DECOR_TYPES.length)],
      x: edgeMid.x + perpendicular.x * side * offsetAlongStreet + direction.x * depthDirection * offsetDepth,
      y: edgeMid.y + perpendicular.y * side * offsetAlongStreet + direction.y * depthDirection * offsetDepth,
      rotation: random() * TWO_PI,
      size: 6 + random() * 8,
    })
  }

  const people = []
  const visitorCount = 4 + Math.floor(random() * 4) + Math.floor(buildingCount / 8)
  for (let i = 0; i < visitorCount; i += 1) {
    const theta = random() * TWO_PI
    const distance = plazaRadius * 0.25 + random() * plazaRadius * 0.5
    people.push({
      x: center.x + Math.cos(theta) * distance,
      y: center.y + Math.sin(theta) * distance,
      radius: 5 + random() * 3.5,
      tint: random(),
    })
  }

  const populationMin = choice.populationRange[0]
  const populationMax = choice.populationRange[1]
  const population = Math.round(
    populationMin + random() * (populationMax - populationMin),
  )

  const marketTheme = SETTLEMENT_MARKET_THEMES[Math.floor(random() * SETTLEMENT_MARKET_THEMES.length)]

  const name = generateSettlementName(random, usedNames, island.name)

  return {
    id: `${island.id}-settlement`,
    name,
    sizeId: choice.id,
    sizeLabel: choice.label,
    population,
    dock,
    center,
    plazaRadius,
    road: { start: center, end: roadEnd, width: streetWidth },
    buildings,
    streets,
    streetColor,
    streetBorder,
    decor,
    people,
    marketTheme,
  }
}

function generateIslands(count, random = Math.random) {
  const islands = []
  const usedNames = new Set()
  const usedSettlementNames = new Set()
  let attempts = 0
  while (islands.length < count && attempts < count * 90) {
    attempts += 1
    let radius
    const sizeRoll = random()
    if (sizeRoll < 0.55) {
      radius = 200 + random() * 320
    } else if (sizeRoll < 0.85) {
      radius = 520 + random() * 220
    } else {
      radius = 740 + random() * 320
    }

    const x = random() * MAP_SIZE
    const y = random() * MAP_SIZE
    const borderDistance = Math.min(x, MAP_SIZE - x, y, MAP_SIZE - y)
    if (borderDistance < radius + MAP_EDGE_CLEARANCE) {
      continue
    }

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
    const beach = createInnerRing(coastline, 0.955, 0.015, random)
    const grass = createInnerRing(coastline, 0.8, 0.12, random)
    const canopy = createInnerRing(coastline, 0.58, 0.18, random)

    const palette = pickPalette(random)
    const name = generateIslandName(random, usedNames)
    const islandId = `island-${islands.length}`
    const island = {
      id: islandId,
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
      treeClusters: [],
      streams: generateStreams(coastline, radius, random),
      highlights: generateMeadowHighlights(grass, radius, random),
      name,
      structures: [],
      settlement: null,
    }

    const settlement = generateSettlementForIsland(island, random, usedSettlementNames)
    if (settlement) {
      island.settlement = settlement
      island.structures.push({ type: 'dock', polygon: settlement.dock.polygon })
    }

    islands.push(island)
  }

  let settlementCount = islands.filter((island) => island.settlement).length
  if (settlementCount < MIN_SETTLEMENT_COUNT) {
    const availableIslands = islands
      .filter((island) => !island.settlement)
      .sort((a, b) => b.radius - a.radius)
    for (const island of availableIslands) {
      if (settlementCount >= MIN_SETTLEMENT_COUNT) {
        break
      }
      const forcedSettlement = generateSettlementForIsland(island, random, usedSettlementNames, { force: true })
      if (forcedSettlement) {
        island.settlement = forcedSettlement
        island.structures.push({ type: 'dock', polygon: forcedSettlement.dock.polygon })
        settlementCount += 1
      }
    }
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
  const worldMapWrapperRef = useRef(null)
  const worldMapCanvasRef = useRef(null)
  const pressedKeys = useRef(new Set())
  const repairClicksRef = useRef(0)
  const [seed, setSeed] = useState(() => generateRandomSeed())
  const [seedInput, setSeedInput] = useState(seed)
  const [copyStatus, setCopyStatus] = useState('')
  const [activeMenu, setActiveMenu] = useState(null)
  const [isMiniMapVisible, setMiniMapVisible] = useState(false)
  const [isWorldMapVisible, setWorldMapVisible] = useState(false)
  const [isWeatherVisible, setWeatherVisible] = useState(true)
  const [isWeatherEnabled, setWeatherEnabled] = useState(true)
  const copyTimeoutRef = useRef(null)
  const worldMapStateRef = useRef({
    scale: 1,
    centerX: MAP_SIZE / 2,
    centerY: MAP_SIZE / 2,
    minScale: 0.01,
    maxScale: 1.2,
    baseScale: 0.05,
    isPanning: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  })
  const worldMapInitializedRef = useRef(false)

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

  const windRandomRef = useRef(createSeededRng(`${seed}-wind`))
  const [windState, setWindState] = useState(() => createInitialWindState(windRandomRef.current))
  const windRef = useRef(windState)
  windRef.current = windState

  const simulationTimeRef = useRef(0)

  useEffect(() => {
    const resetState = createInitialBoatState()
    boatRef.current = resetState
    setBoatState(resetState)
    pressedKeys.current.clear()
    shorelineTimeRef.current = 0
    repairClicksRef.current = 0
    windRandomRef.current = createSeededRng(`${seed}-wind`)
    const resetWind = createInitialWindState(windRandomRef.current)
    windRef.current = resetWind
    setWindState(resetWind)
    simulationTimeRef.current = 0
  }, [seed])

  useEffect(() => {
    if (isWorldMapVisible) {
      setMiniMapVisible(false)
    } else {
      worldMapInitializedRef.current = false
    }
  }, [isWorldMapVisible])

  useEffect(() => {
    worldMapInitializedRef.current = false
  }, [islands])

  useEffect(() => {
    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase()
      if (key === 'm') {
        event.preventDefault()
        setWorldMapVisible((value) => {
          const next = !value
          if (next) {
            setMiniMapVisible(false)
          }
          return next
        })
        return
      }
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

    const updateBoat = (dt, wind) => {
      const current = { ...boatRef.current }
      const wasOnLand = current.landStatus?.zone === 'land'
      let maxSpeedForHealth = getMaxSpeedForHealth(current.health)
      let damageIncurred = false
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
      const canSteer = !['anchored', 'weighing'].includes(current.anchorState)

      let windMultiplier = 1
      let relativeWindAngle = 0
      let relativeWindDegrees = 0
      let isTackingIntoWind = false

      if (wind) {
        const windStrength = clamp(wind.strength ?? 0, 0, 1)
        relativeWindAngle = Math.abs(shortestAngleDiff(current.heading, wind.direction))
        relativeWindDegrees = radiansToDegrees(relativeWindAngle)

        if (
          canSteer &&
          canAccelerate &&
          windStrength > 0.05 &&
          relativeWindDegrees < NO_GO_ANGLE_DEGREES
        ) {
          isTackingIntoWind = true
          const manualBias =
            commands.left && !commands.right ? -1 : commands.right && !commands.left ? 1 : 0
          if (!Number.isFinite(current.tackDirection) || current.tackDirection === 0) {
            current.tackDirection = manualBias || 1
          }
          if (manualBias !== 0) {
            current.tackDirection = manualBias
            current.tackTimer = 0
          }
          current.tackTimer = (current.tackTimer ?? 0) + dt
          const tackDuration = lerp(TACK_PERIOD_MIN, TACK_PERIOD_MAX, 1 - windStrength)
          if (current.tackTimer >= tackDuration) {
            current.tackTimer = 0
            if (manualBias === 0) {
              current.tackDirection *= -1
            }
          }

          const tackAngle = degreesToRadians(TACK_TARGET_DEGREES)
          const targetHeading = wind.direction + current.tackDirection * tackAngle
          const headingDiff = shortestAngleDiff(targetHeading, current.heading)
          const tackAdjustment = clamp(dt * TACK_TURN_RATE, 0, 1)
          current.heading = normalizeAngle(current.heading + headingDiff * tackAdjustment)

          relativeWindAngle = Math.abs(shortestAngleDiff(current.heading, wind.direction))
          relativeWindDegrees = radiansToDegrees(relativeWindAngle)
        } else {
          current.tackTimer = 0
        }

        const baseMultiplier = getWindMultiplierForAngle(relativeWindDegrees)
        windMultiplier = lerp(1, baseMultiplier, windStrength)
        if (isTackingIntoWind) {
          const tackFloor = 0.18 + windStrength * 0.22
          windMultiplier = Math.max(windMultiplier, tackFloor)
        }
      } else {
        current.tackTimer = 0
      }

      const effectiveMaxSpeed = maxSpeedForHealth * windMultiplier
      const desiredSpeed = canAccelerate ? current.sailLevel * effectiveMaxSpeed : 0

      if (current.speed < desiredSpeed) {
        current.speed = Math.min(desiredSpeed, current.speed + ACCELERATION * dt)
      } else if (current.speed > desiredSpeed) {
        current.speed = Math.max(desiredSpeed, current.speed - BRAKE_DECELERATION * dt)
      }

      if (desiredSpeed < 6 && current.speed < 6 && !attemptingToMove) {
        current.speed = 0
      }

      const speedRatio = effectiveMaxSpeed > 0 ? current.speed / effectiveMaxSpeed : 0
      const turnStrength = 0.6 + Math.min(speedRatio, 1)

      if (canSteer && commands.left) {
        current.heading -= TURN_RATE * dt * turnStrength
      }
      if (canSteer && commands.right) {
        current.heading += TURN_RATE * dt * turnStrength
      }

      current.heading = normalizeAngle(current.heading)

      const proposedX = current.x + Math.cos(current.heading) * current.speed * dt
      const proposedY = current.y + Math.sin(current.heading) * current.speed * dt

      current.speed = Math.min(current.speed, effectiveMaxSpeed)

      const proposedBoat = { x: proposedX, y: proposedY, heading: current.heading }
      const proposedSeaState = getBoatSeaState(proposedBoat, islands)
      if (proposedSeaState.zone === 'land') {
        const impactSpeed = current.speed
        if (!wasOnLand && impactSpeed > 0) {
          const damageAmount = impactSpeed > MAX_FORWARD_SPEED * 0.5 ? 0.1 : 0.05
          const newHealth = Math.max(MIN_HEALTH, current.health - damageAmount)
          if (newHealth < current.health) {
            current.health = newHealth
            maxSpeedForHealth = getMaxSpeedForHealth(current.health)
            damageIncurred = true
          }
        }

        if (damageIncurred) {
          current.sailLevel = 0
          current.sailTarget = 0
          current.speed = 0
        } else {
          current.speed = Math.min(current.speed, 38)
        }

        if (proposedSeaState.penetration > 0) {
          const pushBack = proposedSeaState.penetration + 1
          current.x -= proposedSeaState.normal.x * pushBack
          current.y -= proposedSeaState.normal.y * pushBack
        }
      } else {
        current.x = clamp(proposedX, 0, MAP_SIZE)
        current.y = clamp(proposedY, 0, MAP_SIZE)
      }

      current.x = clamp(current.x, 0, MAP_SIZE)
      current.y = clamp(current.y, 0, MAP_SIZE)

      let finalSeaState = getBoatSeaState(current, islands)
      if (finalSeaState.zone === 'land' && finalSeaState.penetration > 0) {
        const pushBack = finalSeaState.penetration + 1
        current.x = clamp(current.x - finalSeaState.normal.x * pushBack, 0, MAP_SIZE)
        current.y = clamp(current.y - finalSeaState.normal.y * pushBack, 0, MAP_SIZE)
        finalSeaState = getBoatSeaState(current, islands)
      }

      current.landStatus = finalSeaState

      if (current.anchorState === 'anchored') {
        let nearestDockId = null
        let nearestDockDistance = Infinity
        for (const island of islands) {
          const settlement = island.settlement
          if (!settlement?.dock) {
            continue
          }
          const berth = settlement.dock.berthPoint
          const worldBerth = { x: island.x + berth.x, y: island.y + berth.y }
          const berthDistance = Math.hypot(worldBerth.x - current.x, worldBerth.y - current.y)
          if (berthDistance < DOCKING_DISTANCE && berthDistance < nearestDockDistance) {
            nearestDockDistance = berthDistance
            nearestDockId = settlement.id
          }
        }
        current.dockedSettlementId = nearestDockId
      } else if (current.dockedSettlementId != null) {
        current.dockedSettlementId = null
      }

      if (wind) {
        current.wind = {
          direction: wind.direction ?? 0,
          strength: wind.strength ?? 0,
          angleToWind: relativeWindDegrees,
          multiplier: windMultiplier,
          isTacking: isTackingIntoWind,
        }
      } else {
        current.wind = {
          direction: 0,
          strength: 0,
          angleToWind: 0,
          multiplier: 1,
          isTacking: false,
        }
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

      const nextWind = updateWindState(windRef.current, dt, windRandomRef.current)
      windRef.current = nextWind
      setWindState(nextWind)

      const appliedWind = isWeatherEnabled ? nextWind : null
      const boat = updateBoat(dt, appliedWind)
      simulationTimeRef.current += dt
      updateWaves(wavesRef.current, dt)
      shorelineTimeRef.current = (shorelineTimeRef.current + dt) % 1000
      drawScene(
        ctx,
        { width: canvas.width, height: canvas.height },
        boat,
        islands,
        appliedWind,
        simulationTimeRef.current,
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

      if (isWorldMapVisible) {
        const worldMapCanvasCurrent = worldMapCanvasRef.current
        if (worldMapCanvasCurrent) {
          drawWorldMap(worldMapCanvasCurrent, worldMapStateRef.current, boat, islands)
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
  }, [
    height,
    width,
    islands,
    isMiniMapVisible,
    isWeatherEnabled,
    isWorldMapVisible,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return undefined
    }

    const handlePointerDown = (event) => {
      if (event.button !== 0) {
        return
      }

      const rect = canvas.getBoundingClientRect()
      const cssX = event.clientX - rect.left
      const cssY = event.clientY - rect.top
      const dpr = window.devicePixelRatio || 1
      const canvasX = cssX * dpr
      const canvasY = cssY * dpr

      const currentBoat = boatRef.current
      const cameraX = currentBoat.x - canvas.width / 2
      const cameraY = currentBoat.y - canvas.height / 2
      const worldPoint = {
        x: cameraX + canvasX,
        y: cameraY + canvasY,
      }

      const boatPolygon = getBoatHullPolygon(currentBoat)
      const isOnBoat = isPointInsidePolygon(worldPoint, boatPolygon)

      if (!isOnBoat) {
        return
      }

      if (currentBoat.health >= 1) {
        repairClicksRef.current = 0
        return
      }

      repairClicksRef.current += 1

      if (repairClicksRef.current >= 3) {
        repairClicksRef.current -= 3
        setBoatState((existing) => {
          const healedHealth = Math.min(1, existing.health + 0.05)
          if (healedHealth === existing.health) {
            return existing
          }
          const updated = { ...existing, health: healedHealth }
          boatRef.current = updated
          return updated
        })
      }
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [])

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

  useEffect(() => {
    if (!isWorldMapVisible) {
      return undefined
    }

    const container = worldMapWrapperRef.current
    const canvas = worldMapCanvasRef.current
    if (!container || !canvas) {
      return undefined
    }

    const state = worldMapStateRef.current

    const updateCanvasSize = (contentSize) => {
      const observedWidth = contentSize?.width
      const observedHeight = contentSize?.height
      const rawWidth = observedWidth ?? container.clientWidth
      const rawHeight = observedHeight ?? container.clientHeight
      const cssWidth = Math.max(0, Math.round(rawWidth))
      const cssHeight = Math.max(0, Math.round(rawHeight))

      if (cssWidth <= 0 || cssHeight <= 0) {
        return
      }

      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(cssWidth * dpr))
      canvas.height = Math.max(1, Math.round(cssHeight * dpr))
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`

      const padding = 80
      const paddedWidth = Math.max(0, cssWidth - padding)
      const paddedHeight = Math.max(0, cssHeight - padding)
      const edgeInset = 240
      const effectiveMapSize = Math.max(1, MAP_SIZE - edgeInset * 2)
      const widthScale = paddedWidth > 0 ? paddedWidth / effectiveMapSize : 0
      const heightScale = paddedHeight > 0 ? paddedHeight / effectiveMapSize : 0
      let fitScale = Math.min(widthScale, heightScale)
      if (!Number.isFinite(fitScale) || fitScale <= 0) {
        fitScale = Math.max(widthScale, heightScale)
      }
      const defaultScale = Math.max(0.02, fitScale || 0.02)

      state.baseScale = defaultScale
      state.minScale = defaultScale * 0.6
      state.maxScale = defaultScale * 12

      if (!worldMapInitializedRef.current) {
        state.scale = defaultScale
        state.centerX = MAP_SIZE / 2
        state.centerY = MAP_SIZE / 2
        worldMapInitializedRef.current = true
      }

      clampWorldMapView(state, cssWidth, cssHeight)
      drawWorldMap(canvas, state, boatRef.current, islands)
    }

    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target === container) {
          updateCanvasSize(entry.contentRect)
        }
      })
    })
    resizeObserver.observe(container)
    updateCanvasSize()

    const handlePointerDown = (event) => {
      if (event.button !== 0) {
        return
      }
      state.isPanning = true
      state.pointerId = event.pointerId
      state.lastX = event.clientX
      state.lastY = event.clientY
      canvas.classList.add('is-panning')
      canvas.setPointerCapture(event.pointerId)
    }

    const handlePointerMove = (event) => {
      if (!state.isPanning || event.pointerId !== state.pointerId) {
        return
      }

      const dx = event.clientX - state.lastX
      const dy = event.clientY - state.lastY
      state.lastX = event.clientX
      state.lastY = event.clientY
      state.centerX -= dx / state.scale
      state.centerY -= dy / state.scale
      const rect = canvas.getBoundingClientRect()
      clampWorldMapView(state, rect.width, rect.height)
      drawWorldMap(canvas, state, boatRef.current, islands)
    }

    const endPan = (event) => {
      if (state.pointerId !== event.pointerId) {
        return
      }
      state.isPanning = false
      state.pointerId = null
      canvas.classList.remove('is-panning')
      if (typeof canvas.hasPointerCapture === 'function') {
        if (canvas.hasPointerCapture(event.pointerId)) {
          canvas.releasePointerCapture(event.pointerId)
        }
      } else {
        canvas.releasePointerCapture?.(event.pointerId)
      }
    }

    const handleWheel = (event) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const width = canvas.width / dpr
      const height = canvas.height / dpr
      const offsetX = event.clientX - rect.left
      const offsetY = event.clientY - rect.top

      const zoomChange = Math.pow(1.1, -event.deltaY / 120)
      const nextScale = clamp(state.scale * zoomChange, state.minScale, state.maxScale)
      if (nextScale === state.scale) {
        return
      }

      const worldX = state.centerX + (offsetX - width / 2) / state.scale
      const worldY = state.centerY + (offsetY - height / 2) / state.scale

      state.scale = nextScale
      state.centerX = worldX - (offsetX - width / 2) / state.scale
      state.centerY = worldY - (offsetY - height / 2) / state.scale

      clampWorldMapView(state, rect.width, rect.height)
      drawWorldMap(canvas, state, boatRef.current, islands)
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', endPan)
    canvas.addEventListener('pointercancel', endPan)
    canvas.addEventListener('pointerleave', endPan)
    canvas.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      resizeObserver.disconnect()
      canvas.classList.remove('is-panning')
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', endPan)
      canvas.removeEventListener('pointercancel', endPan)
      canvas.removeEventListener('pointerleave', endPan)
      canvas.removeEventListener('wheel', handleWheel)
      state.isPanning = false
      state.pointerId = null
    }
  }, [boatRef, islands, isWorldMapVisible])

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

  const handleWeatherEnabledChange = (event) => {
    const nextEnabled = event.target.checked
    if (nextEnabled) {
      setWeatherEnabled(true)
      setWeatherVisible(true)
    } else {
      setWeatherEnabled(false)
      setWeatherVisible(false)
    }
  }

  const handleLeaveSettlement = () => {
    setBoatState((existing) => {
      if (
        existing.anchorState === 'weighing' &&
        existing.dockedSettlementId == null
      ) {
        return existing
      }

      const updated = {
        ...existing,
        anchorState: 'weighing',
        anchorProgress: 0,
        idleTime: 0,
        dockedSettlementId: null,
      }
      boatRef.current = updated
      return updated
    })
  }

  const shipStatus = useMemo(() => {
    if (boatState.anchorState === 'anchored' && boatState.dockedSettlementId) {
      return 'Docked'
    }

    if (boatState.landStatus?.zone === 'land') {
      return 'Run aground'
    }

    if (boatState.landStatus?.zone === 'shore' && boatState.speed > 10) {
      return 'Hugging the coast'
    }

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
  }, [boatState.anchorState, boatState.landStatus, boatState.speed])

  const landProximity = useMemo(() => {
    const status = boatState.landStatus
    if (!status) {
      return { zone: 'Unknown', range: '—' }
    }

    const distance = Number.isFinite(status.distance)
      ? Math.max(0, Math.round(status.distance))
      : null

    if (status.zone === 'land') {
      if (status.structureType === 'dock') {
        return {
          zone: 'Pier collision',
          range: 'Hull pressed to dock',
        }
      }
      return {
        zone: 'Grounded',
        range: `${Math.round(status.penetration)} m inland`,
      }
    }

    if (status.structureType === 'dock') {
      const zone = status.zone === 'shore' ? 'Harbor waters' : 'Harbor approach'
      return {
        zone,
        range: distance != null ? `${distance} m to dock` : '—',
      }
    }

    if (status.zone === 'shore') {
      return {
        zone: 'Coastal waters',
        range: distance != null ? `${distance} m to land` : '—',
      }
    }

    return {
      zone: 'Open sea',
      range: distance != null && distance < Infinity ? `${distance} m to land` : '—',
    }
  }, [boatState.landStatus])

  const dockedSettlementContext = useMemo(() => {
    if (!boatState.dockedSettlementId) {
      return null
    }

    for (const island of islands) {
      if (island.settlement?.id === boatState.dockedSettlementId) {
        return { settlement: island.settlement, island }
      }
    }

    return null
  }, [boatState.dockedSettlementId, islands])

  const damageState = useMemo(
    () => getDamageStateForHealth(boatState.health),
    [boatState.health],
  )
  const healthPercent = Math.max(Math.round((boatState.health ?? 1) * 100), Math.round(MIN_HEALTH * 100))
  const effectiveTopSpeedKnots = Math.round(getMaxSpeedForHealth(boatState.health))
  const damagePenaltyPercent = Math.round(damageState.penalty * 100)

  const speedKnots = Math.round(boatState.speed)
  const headingDegrees = Math.round(
    (((boatState.heading % TWO_PI) + TWO_PI) % TWO_PI) * (180 / Math.PI),
  )
  const windStrength = clamp(windState.strength ?? 0, 0, 1)
  const windSpeedKnots = Math.round(
    lerp(WIND_SPEED_BASE_KNOTS, WIND_SPEED_MAX_KNOTS, windStrength),
  )
  const windDirectionDegrees = Math.round(
    (((windState.direction % TWO_PI) + TWO_PI) % TWO_PI) * (180 / Math.PI),
  )
  const windDirectionLabel = getCardinalDirection(windDirectionDegrees)
  const relativeWindAngle = boatState.wind?.angleToWind ?? 0
  const relativeWindDescription = boatState.wind?.isTacking
    ? 'Tacking'
    : getRelativeWindDescription(relativeWindAngle)
  const windStatSubtitle = `${windDirectionLabel} · ${relativeWindDescription}`

  const dockedSettlement = dockedSettlementContext?.settlement
  const dockedPopulation = useMemo(() => {
    if (!dockedSettlement) {
      return null
    }
    try {
      return dockedSettlement.population.toLocaleString('en-US')
    } catch {
      return `${dockedSettlement.population}`
    }
  }, [dockedSettlement])
  const settlementPeople = useMemo(
    () => (dockedSettlement?.people ? dockedSettlement.people.slice(0, 6) : []),
    [dockedSettlement],
  )

  const windForecast = useMemo(() => {
    const changeTimer = Math.max(0, Math.round(windState.changeTimer ?? 0))
    const targetStrength = clamp(windState.targetStrength ?? windState.strength ?? 0, 0, 1)
    const targetKnots = Math.round(lerp(WIND_SPEED_BASE_KNOTS, WIND_SPEED_MAX_KNOTS, targetStrength))
    const targetDirectionDegrees = Math.round(
      (((windState.targetDirection % TWO_PI) + TWO_PI) % TWO_PI) * (180 / Math.PI),
    )
    const targetDirectionLabel = getCardinalDirection(targetDirectionDegrees)

    let trend = 'steady'
    if (targetKnots > windSpeedKnots + 1) {
      trend = 'building'
    } else if (targetKnots < windSpeedKnots - 1) {
      trend = 'easing'
    }

    let timing = 'soon'
    if (changeTimer >= 120) {
      const minutes = Math.round(changeTimer / 60)
      timing = `${minutes} min`
    } else if (changeTimer >= 10) {
      timing = `${changeTimer} s`
    } else if (changeTimer <= 3) {
      timing = 'imminent'
    } else {
      timing = `${changeTimer} s`
    }

    const headline =
      trend === 'building' ? 'Building winds' : trend === 'easing' ? 'Easing winds' : 'Steady winds'

    const detail = `Next: ${targetDirectionLabel} · ${targetKnots} kn`

    return {
      headline,
      detail,
      timing,
    }
  }, [
    windState.changeTimer,
    windState.targetDirection,
    windState.targetStrength,
    windState.strength,
    windSpeedKnots,
  ])

  const miniMapStyle = useMemo(() => {
    if (!isWeatherVisible || !isWeatherEnabled) {
      return undefined
    }
    return {
      '--mini-map-bottom-extra': 'calc(var(--mini-map-panel-height) + 1.25rem)',
    }
  }, [isWeatherVisible, isWeatherEnabled])

  return (
    <div className="app">
      <canvas ref={canvasRef} className="world-canvas" />
      <div className="ui-layer">
        <div className={`top-menu ${activeMenu ? 'top-menu--expanded' : ''}`}>
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
                className={`menu-toggle-button ${activeMenu === 'options' ? 'is-active' : ''}`}
                onClick={() => handleMenuToggle('options')}
              >
                Options
              </button>
              {isWeatherEnabled && (
                <button
                  type="button"
                  className={`menu-toggle-button ${isWeatherVisible ? 'is-active' : ''}`}
                  onClick={() => setWeatherVisible((value) => !value)}
                >
                  Weather
                </button>
              )}
              <button
                type="button"
                className={`menu-toggle-button ${isWorldMapVisible ? 'is-active' : ''}`}
                onClick={() =>
                  setWorldMapVisible((value) => {
                    const next = !value
                    if (next) {
                      setMiniMapVisible(false)
                    }
                    return next
                  })
                }
              >
                Map
              </button>
              <button
                type="button"
                className={`menu-toggle-button ${isMiniMapVisible ? 'is-active' : ''}`}
                onClick={() =>
                  setMiniMapVisible((value) => {
                    const next = !value
                    if (next) {
                      setWorldMapVisible(false)
                    }
                    return next
                  })
                }
              >
                Mini Map
              </button>
            </div>
          </div>
          {activeMenu === 'options' && (
            <div className="top-menu-content">
              <div className="options-menu">
                <label className="options-toggle">
                  <input
                    type="checkbox"
                    checked={isWeatherEnabled}
                    onChange={handleWeatherEnabledChange}
                  />
                  <span className="options-toggle-label">Weather Effects</span>
                </label>
                <p className="options-description">
                  Disable to sail without wind influence or weather indicators.
                </p>
              </div>
            </div>
          )}
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
                <p>
                  Catch the wind with <strong>↑</strong>/<strong>W</strong>, ease the sails with <strong>↓</strong>/<strong>S</strong>, and steer using{' '}
                  <strong>←</strong>/<strong>→</strong> or <strong>A</strong>/<strong>D</strong>.
                </p>
                <p>
                  When the hull is battered, click directly on your ship to patch it up. Every third click restores 5% of the lost durability, up to a sound vessel.
                </p>
              </div>
            </div>
          )}
        </div>
        {isWorldMapVisible && (
          <div className="world-map-wrapper">
            <div className="world-map-panel hud-panel">
              <div className="world-map-toolbar">
                <div className="world-map-title">World Chart</div>
                <div className="world-map-actions">
                  <button
                    type="button"
                    className="world-map-close"
                    onClick={() => setWorldMapVisible(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
              <div ref={worldMapWrapperRef} className="world-map-canvas-container">
                <canvas ref={worldMapCanvasRef} className="world-map-canvas" />
              </div>
            </div>
          </div>
        )}
        {dockedSettlement && (
          <div className="settlement-wrapper">
            <div
              className={`settlement-panel settlement-panel--${dockedSettlement.sizeId}`}
            >
              <div className="settlement-header">
                <div className="settlement-heading">
                  <div className="settlement-name">{dockedSettlement.name}</div>
                  <div className="settlement-meta">
                    <span className="settlement-size">{dockedSettlement.sizeLabel}</span>
                    {dockedPopulation && (
                      <span className="settlement-population">
                        Population <strong>{dockedPopulation}</strong>
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="settlement-leave"
                  onClick={handleLeaveSettlement}
                >
                  Leave Town
                </button>
              </div>
              <div className="settlement-body">
                <div className={`settlement-illustration settlement-illustration--${dockedSettlement.sizeId}`}>
                  <div className="settlement-illustration-sky" />
                  <div className="settlement-illustration-dock" />
                  <div className="settlement-illustration-water" />
                  <div className="settlement-illustration-harbor" />
                  <div className="settlement-illustration-buildings">
                    <span className="settlement-building settlement-building--hall" />
                    <span className="settlement-building settlement-building--shop" />
                    <span className="settlement-building settlement-building--market" />
                  </div>
                  <div className="settlement-illustration-people">
                    {settlementPeople.map((_, index) => (
                      <span
                        key={`person-${index}`}
                        className={`settlement-person settlement-person--${index % 3}`}
                        style={{ left: `${18 + index * 18}px` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="settlement-details">
                  <div className="settlement-detail">
                    <span className="settlement-detail-label">Harbor</span>
                    <span className="settlement-detail-value">{dockedSettlement.sizeLabel}</span>
                  </div>
                  <div className="settlement-detail">
                    <span className="settlement-detail-label">Population</span>
                    <span className="settlement-detail-value">{dockedPopulation ?? '—'}</span>
                  </div>
                  {dockedSettlement.marketTheme && (
                    <div className="settlement-detail">
                      <span className="settlement-detail-label">Known for</span>
                      <span className="settlement-detail-value">
                        {`${dockedSettlement.marketTheme} Trade`}
                      </span>
                    </div>
                  )}
                  <p className="settlement-description">
                    Drop anchor near the jetty to barter with merchants, recruit new hands, or simply
                    enjoy a warm meal ashore before returning to the open sea.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="bottom-panels">
          {isWeatherEnabled && isWeatherVisible && (
            <div className="weather-panel hud-panel">
              <div className="weather-title">Weather</div>
              <div className="weather-stats">
                <div className="weather-stat">
                  <span className="weather-stat-label">Wind</span>
                  <span className="weather-stat-value wind-value">
                    <span className="wind-speed">{windSpeedKnots} kn</span>
                    <span className="weather-stat-sub">{windStatSubtitle}</span>
                    <span className="wind-compass" aria-hidden="true">
                      <span
                        className="wind-compass-arrow"
                        style={{ transform: `rotate(${windDirectionDegrees}deg)` }}
                      />
                    </span>
                  </span>
                </div>
                <div className="weather-stat">
                  <span className="weather-stat-label">Forecast</span>
                  <span className="weather-stat-value">
                    {windForecast.headline}
                    <span className="weather-stat-sub">
                      {windForecast.detail} · {windForecast.timing}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}
          <div className="ship-panel hud-panel">
            <div className="ship-title">Ship</div>
            <div className="ship-stats">
              <div className="ship-stat">
                <span className="ship-stat-label">Speed</span>
                <span className="ship-stat-value">{speedKnots} kn</span>
              </div>
              <div className="ship-stat">
                <span className="ship-stat-label">Top Speed</span>
                <span className="ship-stat-value">
                  {effectiveTopSpeedKnots} kn
                  {damagePenaltyPercent > 0 && (
                    <span className="ship-stat-sub">−{damagePenaltyPercent}%</span>
                  )}
                </span>
              </div>
              <div className="ship-stat">
                <span className="ship-stat-label">Heading</span>
                <span className="ship-stat-value">{headingDegrees}°</span>
              </div>
              <div className="ship-stat">
                <span className="ship-stat-label">Status</span>
                <span className="ship-stat-value">{shipStatus}</span>
              </div>
              <div className="ship-stat">
                <span className="ship-stat-label">Hull</span>
                <span className="ship-stat-value">
                  {damageState.label}
                  <span className="ship-stat-sub">{healthPercent}%</span>
                </span>
              </div>
              <div className="ship-stat">
                <span className="ship-stat-label">Sea Zone</span>
                <span className="ship-stat-value">{landProximity.zone}</span>
              </div>
              <div className="ship-stat">
                <span className="ship-stat-label">Range</span>
                <span className="ship-stat-value">{landProximity.range}</span>
              </div>
            </div>
          </div>
        </div>
        <div
          className={`mini-map-wrapper ${isMiniMapVisible ? 'is-visible' : ''}`}
          style={miniMapStyle}
        >
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

  for (let i = 0; i < BOAT_COLLISION_OUTLINE.length; i += 1) {
    const offset = BOAT_COLLISION_OUTLINE[i]
    const next = BOAT_COLLISION_OUTLINE[(i + 1) % BOAT_COLLISION_OUTLINE.length]

    const rotatedX = boat.x + offset.x * cos - offset.y * sin
    const rotatedY = boat.y + offset.x * sin + offset.y * cos
    samples.push({ x: rotatedX, y: rotatedY })

    const mid = { x: (offset.x + next.x) / 2, y: (offset.y + next.y) / 2 }
    const midX = boat.x + mid.x * cos - mid.y * sin
    const midY = boat.y + mid.x * sin + mid.y * cos
    samples.push({ x: midX, y: midY })
  }

  return samples
}

function getBoatHullPolygon(boat) {
  const cos = Math.cos(boat.heading)
  const sin = Math.sin(boat.heading)
  return BOAT_COLLISION_OUTLINE.map((point) => ({
    x: boat.x + point.x * cos - point.y * sin,
    y: boat.y + point.x * sin + point.y * cos,
  }))
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

function getDistanceToPolygon(point, polygon) {
  if (!polygon?.length) {
    return {
      distance: Infinity,
      signedDistance: Infinity,
      closestPoint: point,
    }
  }

  let closestPoint = polygon[0]
  let closestDistSq = Infinity

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
    const deltaX = point.x - closestX
    const deltaY = point.y - closestY
    const distSq = deltaX * deltaX + deltaY * deltaY

    if (distSq < closestDistSq) {
      closestDistSq = distSq
      closestPoint = { x: closestX, y: closestY }
    }
  }

  const inside = isPointInsidePolygon(point, polygon)
  const distance = Math.sqrt(closestDistSq)
  return {
    distance,
    signedDistance: inside ? -distance : distance,
    closestPoint,
  }
}

function getPointLandProximity(point, islands) {
  let best = {
    zone: 'sea',
    priority: -1,
    distance: Infinity,
    signedDistance: Infinity,
    nearestPoint: null,
    normal: { x: 0, y: 0 },
    islandId: null,
    penetration: 0,
    structureType: null,
  }

  for (const island of islands) {
    const localPoint = { x: point.x - island.x, y: point.y - island.y }
    const approxDistanceFromCenter = Math.hypot(localPoint.x, localPoint.y) - island.radius

    if (best.priority >= 0 && approxDistanceFromCenter > best.distance + MAX_BOAT_EXTENT) {
      continue
    }

    const polygons = [
      { polygon: island.coastline, type: 'coastline' },
      ...((island.structures ?? []).map((structure) => ({
        polygon: structure.polygon,
        type: structure.type,
      })) ?? []),
    ]

    for (const { polygon, type } of polygons) {
      if (!polygon?.length) {
        continue
      }

      const { distance, signedDistance, closestPoint } = getDistanceToPolygon(localPoint, polygon)
      if (!Number.isFinite(distance)) {
        continue
      }

      const worldClosest = { x: closestPoint.x + island.x, y: closestPoint.y + island.y }
      let normalX = point.x - worldClosest.x
      let normalY = point.y - worldClosest.y
      let length = Math.hypot(normalX, normalY)
      if (length === 0) {
        normalX = localPoint.x
        normalY = localPoint.y
        length = Math.hypot(normalX, normalY) || 1
      }
      const normal = { x: normalX / length, y: normalY / length }

      let zone = 'sea'
      if (signedDistance <= 0) {
        zone = 'land'
      } else if (signedDistance <= COLLISION_EDGE_THRESHOLD) {
        zone = 'shore'
      }

      const priority = zone === 'land' ? 2 : zone === 'shore' ? 1 : 0
      const absoluteDistance = Math.abs(signedDistance)

      if (
        priority > best.priority ||
        (priority === best.priority && absoluteDistance < best.distance)
      ) {
        best = {
          zone,
          priority,
          distance: absoluteDistance,
          signedDistance,
          nearestPoint: worldClosest,
          normal,
          islandId: island.id,
          penetration: signedDistance < 0 ? -signedDistance : 0,
          structureType: type || null,
        }
      }
    }
  }

  return best
}

function getBoatSeaState(boat, islands) {
  const samples = getBoatCollisionSamples(boat)
  let nearest = {
    zone: 'sea',
    distance: Infinity,
    signedDistance: Infinity,
    nearestPoint: null,
    normal: { x: 0, y: 0 },
    islandId: null,
    penetration: 0,
    structureType: null,
  }
  let finalZone = 'sea'
  let deepestPenetration = null

  for (const sample of samples) {
    const proximity = getPointLandProximity(sample, islands)
    if (!proximity) {
      continue
    }

    if (proximity.zone === 'land') {
      if (!deepestPenetration || proximity.penetration > deepestPenetration.penetration) {
        deepestPenetration = proximity
      }
    } else if (proximity.zone === 'shore' && finalZone !== 'land') {
      finalZone = 'shore'
    }

    if (proximity.zone === 'land') {
      finalZone = 'land'
    }

    const isCloser = proximity.distance < nearest.distance
    if (isCloser || nearest.nearestPoint == null) {
      nearest = { ...proximity }
    }
  }

  const resolved = deepestPenetration ?? nearest
  return {
    zone: deepestPenetration ? 'land' : finalZone,
    distance: resolved.distance,
    signedDistance: deepestPenetration ? -deepestPenetration.penetration : resolved.signedDistance,
    nearestPoint: resolved.nearestPoint,
    normal: resolved.normal,
    islandId: resolved.islandId,
    penetration: deepestPenetration?.penetration ?? 0,
    structureType: resolved.structureType ?? null,
  }
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

function drawScene(ctx, viewport, boat, islands, wind, time) {
  const { width, height } = viewport
  const camera = {
    x: boat.x - width / 2,
    y: boat.y - height / 2,
  }

  paintSea(ctx, width, height)
  drawIslands(ctx, islands, camera)
  drawBoatWake(ctx, boat, camera)
  if (wind) drawWindIndicators(ctx, { width, height }, wind, time)
  drawBoat(ctx, boat, camera)
}

function buildSmoothPath(points) {
  const path = new Path2D()
  if (!points?.length) return path
  const first = points[0]
  const last = points[points.length - 1]
  path.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2)
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    path.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2)
  }
  path.closePath()
  return path
}

function drawIslands(ctx, islands, camera) {
  for (const island of islands) {
    const screenX = island.x - camera.x
    const screenY = island.y - camera.y
    if (
      screenX < -island.radius * 2 ||
      screenX > ctx.canvas.width + island.radius * 2 ||
      screenY < -island.radius * 2 ||
      screenY > ctx.canvas.height + island.radius * 2
    ) {
      continue
    }

    ctx.save()
    ctx.translate(screenX, screenY)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    const coastPath = buildSmoothPath(island.coastline)
    const grassPath = buildSmoothPath(island.grass)

    ctx.fillStyle = '#c4aa82'
    ctx.fill(coastPath)

    ctx.fillStyle = '#6e9960'
    ctx.fill(grassPath)

    ctx.strokeStyle = 'rgba(26, 53, 80, 0.35)'
    ctx.lineWidth = 1.5
    ctx.stroke(coastPath)

    if (island.settlement) {
      const c = island.settlement.center
      ctx.fillStyle = '#d44820'
      ctx.beginPath()
      ctx.arc(c.x, c.y, Math.max(4, island.radius * 0.012), 0, TWO_PI)
      ctx.fill()
    }

    ctx.restore()
  }
}

function drawBoatWake(ctx, boat, camera) {
  const wakeStrength = Math.min(boat.speed / MAX_FORWARD_SPEED, 1)
  if (wakeStrength <= 0.02) return

  const screenX = boat.x - camera.x
  const screenY = boat.y - camera.y

  ctx.save()
  ctx.translate(screenX, screenY)
  ctx.rotate(boat.heading)

  const wakeLength = 80 + wakeStrength * 100
  const wakeWidth = 14 + wakeStrength * 24

  ctx.globalAlpha = 0.18 * wakeStrength
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(-8, wakeWidth * 0.5)
  ctx.quadraticCurveTo(-wakeLength * 0.5, wakeWidth * 0.7, -wakeLength, 0)
  ctx.quadraticCurveTo(-wakeLength * 0.5, -wakeWidth * 0.7, -8, -wakeWidth * 0.5)
  ctx.closePath()
  ctx.fill()

  ctx.globalAlpha = 0.12 * wakeStrength
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1
  for (let i = 1; i <= 2; i += 1) {
    const t = i / 2
    const rx = -16 - t * (wakeLength - 20)
    const rw = wakeWidth * (0.4 + t * 0.7)
    ctx.beginPath()
    ctx.moveTo(rx, -rw)
    ctx.quadraticCurveTo(rx - wakeLength * 0.04, 0, rx, rw)
    ctx.stroke()
  }

  ctx.globalAlpha = 1
  ctx.restore()
}

function drawBoat(ctx, boat, camera) {
  const screenX = boat.x - camera.x
  const screenY = boat.y - camera.y
  ctx.save()
  ctx.translate(screenX, screenY)
  ctx.rotate(boat.heading)

  const speed = clamp(boat.speed / MAX_FORWARD_SPEED, 0, 1)

  // Wake glow when moving
  if (speed > 0.05) {
    ctx.globalAlpha = 0.12 * speed
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(-10, 18 * speed)
    ctx.lineTo(-50 * speed, 0)
    ctx.lineTo(-10, -18 * speed)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // Hull
  ctx.fillStyle = '#ddd0ba'
  ctx.strokeStyle = 'rgba(12, 24, 36, 0.8)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(52, 0)
  ctx.lineTo(16, -18)
  ctx.lineTo(-42, -16)
  ctx.lineTo(-46, 0)
  ctx.lineTo(-42, 16)
  ctx.lineTo(16, 18)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Deck line
  ctx.strokeStyle = 'rgba(12, 24, 36, 0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(46, 0)
  ctx.lineTo(-40, 0)
  ctx.stroke()

  // Sail
  const sail = clamp(boat.sailLevel ?? 0, 0, 1)
  if (sail > 0.05) {
    const eased = sail * sail * (3 - 2 * sail)
    const w = 8 + eased * 16
    ctx.globalAlpha = 0.25 + eased * 0.65
    ctx.fillStyle = '#f0ece4'
    ctx.strokeStyle = 'rgba(12,24,36,0.3)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(10, 0)
    ctx.lineTo(10 - w, -22)
    ctx.lineTo(10 - w, 22)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // Bow marker
  ctx.fillStyle = '#e8a030'
  ctx.beginPath()
  ctx.arc(40, 0, 3, 0, TWO_PI)
  ctx.fill()

  ctx.restore()
}

function drawWindIndicators(ctx, viewport, wind, time) {
  if (!wind) {
    return
  }

  const strength = clamp(wind.strength ?? 0, 0, 1)
  if (strength <= 0.01) {
    return
  }

  const { width, height } = viewport
  const spacing = 160
  const rowSpacing = 110
  const dx = Math.cos(wind.direction)
  const dy = Math.sin(wind.direction)
  const px = -dy
  const py = dx
  const travelSpeed = 30 + strength * 60
  const length = 32 + strength * 48
  const halfLength = length / 2
  const baseAlpha = 0.14 + strength * 0.18
  const lineWidth = 1.1 + strength * 0.9
  const strokeColor = 'rgba(255, 255, 255, 0.7)'

  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.strokeStyle = strokeColor

  let rowIndex = 0
  for (let y = -rowSpacing; y <= height + rowSpacing; y += rowSpacing) {
    let colIndex = 0
    for (let x = -spacing; x <= width + spacing; x += spacing) {
      const baseX = x + (rowIndex % 2) * spacing * 0.5
      const jitterSample = pseudoRandom2D(colIndex * 5.371 + 1, rowIndex * 9.137 + 5)
      const jitter = (jitterSample - 0.5) * spacing * 0.4
      const travelSample = pseudoRandom2D(colIndex * 8.913 + 7, rowIndex * 4.271 + 11)
      const travel =
        ((time * travelSpeed + travelSample * spacing) % spacing + spacing) % spacing - spacing / 2
      const centerX = baseX - dx * travel + px * jitter * 0.6
      const centerY = y - dy * travel + py * jitter * 0.6
      const brightness = 0.6 + pseudoRandom2D(colIndex * 3.19 + 13, rowIndex * 7.31 + 2) * 0.4

      ctx.globalAlpha = baseAlpha * brightness
      ctx.beginPath()
      ctx.moveTo(centerX - dx * halfLength, centerY - dy * halfLength)
      ctx.lineTo(centerX + dx * halfLength, centerY + dy * halfLength)
      ctx.stroke()
      colIndex += 1
    }
    rowIndex += 1
  }

  ctx.restore()
}

function drawGlobeMap(ctx, cx, cy, R, boat, islands, options = {}) {
  const { showLabels = false } = options

  // World-to-sphere mapping: x→lon, y→lat (y flipped)
  // lon ∈ [-60°, 60°], lat ∈ [-50°, 50°] — all points visible in front hemisphere
  const toSphere = (wx, wy) => ({
    lon: ((wx / MAP_SIZE) - 0.5) * (Math.PI * 2 / 3),
    lat: (0.5 - (wy / MAP_SIZE)) * (Math.PI * 5 / 9),
  })

  // Orthographic projection centered at equator
  const project = (lon, lat) => ({
    x: cx + R * Math.cos(lat) * Math.sin(lon),
    y: cy - R * Math.sin(lat),
  })

  // Ocean background
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, TWO_PI)
  ctx.fillStyle = '#1a3550'
  ctx.fill()
  ctx.clip()

  // Graticule
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)'
  ctx.lineWidth = 0.5
  for (let latDeg = -40; latDeg <= 40; latDeg += 20) {
    const lat = latDeg * Math.PI / 180
    ctx.beginPath()
    for (let lonDeg = -60; lonDeg <= 60; lonDeg += 3) {
      const p = project(lonDeg * Math.PI / 180, lat)
      lonDeg === -60 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }
  for (let lonDeg = -60; lonDeg <= 60; lonDeg += 20) {
    const lon = lonDeg * Math.PI / 180
    ctx.beginPath()
    for (let latDeg = -50; latDeg <= 50; latDeg += 3) {
      const p = project(lon, latDeg * Math.PI / 180)
      latDeg === -50 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }

  // Islands
  for (const island of islands) {
    if (!island.coastline?.length) continue

    // Coastline
    ctx.beginPath()
    island.coastline.forEach((pt, i) => {
      const sp = toSphere(island.x + pt.x, island.y + pt.y)
      const p = project(sp.lon, sp.lat)
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
    ctx.fillStyle = '#c4aa82'
    ctx.fill()

    // Interior
    if (island.grass?.length) {
      ctx.beginPath()
      island.grass.forEach((pt, i) => {
        const sp = toSphere(island.x + pt.x, island.y + pt.y)
        const p = project(sp.lon, sp.lat)
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
      })
      ctx.closePath()
      ctx.fillStyle = '#6e9960'
      ctx.fill()
    }

    // Settlement dot
    if (island.settlement) {
      const sc = island.settlement.center
      const sp = toSphere(island.x + sc.x, island.y + sc.y)
      const p = project(sp.lon, sp.lat)
      const dotR = Math.max(2, R * 0.018)
      ctx.fillStyle = '#d44820'
      ctx.beginPath()
      ctx.arc(p.x, p.y, dotR, 0, TWO_PI)
      ctx.fill()

      if (showLabels && R > 100) {
        const fontSize = Math.round(clamp(R * 0.052, 9, 14))
        ctx.font = `${fontSize}px system-ui, sans-serif`
        ctx.fillStyle = '#c8bba8'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(island.settlement.name, p.x + dotR + 3, p.y)
      }
    }
  }

  // Boat position
  if (boat) {
    const sp = toSphere(boat.x, boat.y)
    const p = project(sp.lon, sp.lat)
    const markerR = Math.max(3, R * 0.025)

    ctx.fillStyle = '#e8a030'
    ctx.beginPath()
    ctx.arc(p.x, p.y, markerR, 0, TWO_PI)
    ctx.fill()

    // Heading line
    const cos = Math.cos(boat.heading)
    const sin = Math.sin(boat.heading)
    const spAhead = toSphere(boat.x + cos * 600, boat.y + sin * 600)
    const pAhead = project(spAhead.lon, spAhead.lat)
    ctx.strokeStyle = '#e8a030'
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(pAhead.x, pAhead.y)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  ctx.restore()

  // Globe outline
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, TWO_PI)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  ctx.stroke()
}

function drawMiniMap(ctx, boat, islands) {
  const dpr = window.devicePixelRatio || 1
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const width = ctx.canvas.width / dpr
  const height = ctx.canvas.height / dpr
  ctx.clearRect(0, 0, width, height)

  const cx = width / 2
  const cy = height / 2
  const R = Math.min(cx, cy) - 2

  drawGlobeMap(ctx, cx, cy, R, boat, islands, { showLabels: false })

  ctx.restore()
}

function clampWorldMapView(state, width, height) {
  if (!state) {
    return
  }

  const scale = Math.max(state.scale || 0.0001, 0.0001)
  const halfWidthWorldRaw = width > 0 ? width / (2 * scale) : MAP_SIZE / 2
  const halfHeightWorldRaw = height > 0 ? height / (2 * scale) : MAP_SIZE / 2
  const maxHalfWidth = MAP_SIZE / 2
  const maxHalfHeight = MAP_SIZE / 2
  const halfWidthWorld = Math.min(Math.max(halfWidthWorldRaw, 0), maxHalfWidth)
  const halfHeightWorld = Math.min(Math.max(halfHeightWorldRaw, 0), maxHalfHeight)
  const minX = halfWidthWorld > 0 ? halfWidthWorld : maxHalfWidth
  const maxX = MAP_SIZE - minX
  const minY = halfHeightWorld > 0 ? halfHeightWorld : maxHalfHeight
  const maxY = MAP_SIZE - minY

  state.centerX = clamp(state.centerX ?? MAP_SIZE / 2, minX, maxX)
  state.centerY = clamp(state.centerY ?? MAP_SIZE / 2, minY, maxY)
}

function drawWorldMap(canvas, _state, boat, islands) {
  if (!canvas) {
    return
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }

  const dpr = window.devicePixelRatio || 1
  const width = canvas.width / dpr
  const height = canvas.height / dpr

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  ctx.fillStyle = '#0c1824'
  ctx.fillRect(0, 0, width, height)

  const R = Math.min(width, height) * 0.46
  const cx = width / 2
  const cy = height / 2

  drawGlobeMap(ctx, cx, cy, R, boat, islands, { showLabels: true })

  ctx.restore()
}

function paintSea(ctx, width, height) {
  ctx.fillStyle = '#1a3550'
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
  ctx.lineWidth = 1
  const gridSize = 120
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()
}


export default App
