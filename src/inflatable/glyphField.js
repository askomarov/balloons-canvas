import * as THREE from 'three/webgpu'

const INF = 1e20
const OUTSIDE_DISTANCE = 1000

/**
 * 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher)
 */
function edt1d(grid, offset, stride, length, f, v, z)
{
    v[0] = 0
    z[0] = - INF
    z[1] = INF
    f[0] = grid[offset]

    for(let q = 1, k = 0; q < length; q++)
    {
        f[q] = grid[offset + q * stride]
        const q2 = q * q
        let s
        do
        {
            const r = v[k]
            s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2
        }
        while(s <= z[k] && --k > - 1)

        k++
        v[k] = q
        z[k] = s
        z[k + 1] = INF
    }

    for(let q = 0, k = 0; q < length; q++)
    {
        while(z[k + 1] < q)
            k++

        const r = v[k]
        const qr = q - r
        grid[offset + q * stride] = f[r] + qr * qr
    }
}

function edt2d(grid, width, height)
{
    const size = Math.max(width, height)
    const f = new Float64Array(size)
    const v = new Uint16Array(size)
    const z = new Float64Array(size + 1)

    for(let x = 0; x < width; x++)
        edt1d(grid, x, width, height, f, v, z)

    for(let y = 0; y < height; y++)
        edt1d(grid, y * width, 1, width, f, v, z)
}

export function fontString(font, fontSize)
{
    return `${font.style} ${font.weight} ${fontSize}px ${font.family}`.trim()
}

/**
 * Glyph -> signed distance -> membrane under pressure (laplacian u = -2, u = 0 on the outline)
 * Rows are stored bottom-up (y up), coordinates are texels relative to the glyph plane center
 */
export function buildGlyphField(char, font, fontSize)
{
    const measureContext = document.createElement('canvas').getContext('2d')
    measureContext.font = fontString(font, fontSize)
    const metrics = measureContext.measureText(char)

    const left = Math.ceil(metrics.actualBoundingBoxLeft || 0)
    const right = Math.ceil(metrics.actualBoundingBoxRight || metrics.width)
    const ascent = Math.ceil(metrics.actualBoundingBoxAscent || fontSize * 0.7)
    const descent = Math.ceil(metrics.actualBoundingBoxDescent || 0)
    const padding = Math.round(fontSize * 0.3)

    const width = left + right + padding * 2
    const height = ascent + descent + padding * 2

    // Rasterize
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.font = fontString(font, fontSize)
    context.fillStyle = '#fff'
    context.textBaseline = 'alphabetic'
    context.fillText(char, padding + left, padding + ascent)
    const pixels = context.getImageData(0, 0, width, height).data

    // Signed distance (negative inside)
    const count = width * height
    const outsideGrid = new Float64Array(count)
    const insideGrid = new Float64Array(count)

    for(let i = 0; i < count; i++)
    {
        const coverage = pixels[i * 4 + 3] / 255

        if(coverage >= 1)
        {
            outsideGrid[i] = 0
            insideGrid[i] = INF
        }
        else if(coverage <= 0)
        {
            outsideGrid[i] = INF
            insideGrid[i] = 0
        }
        else
        {
            const outside = Math.max(0, 0.5 - coverage)
            const inside = Math.max(0, coverage - 0.5)
            outsideGrid[i] = outside * outside
            insideGrid[i] = inside * inside
        }
    }

    edt2d(outsideGrid, width, height)
    edt2d(insideGrid, width, height)

    const signedDistance = new Float32Array(count)
    for(let i = 0; i < count; i++)
        signedDistance[i] = Math.sqrt(outsideGrid[i]) - Math.sqrt(insideGrid[i])

    // Poisson solve inside the glyph (SOR), initial guess = sd^2
    let pressure = new Float32Array(count)
    const insideIndices = []

    for(let i = 0; i < count; i++)
    {
        if(signedDistance[i] < 0)
        {
            insideIndices.push(i)
            pressure[i] = signedDistance[i] * signedDistance[i]
        }
    }

    const inside = new Int32Array(insideIndices)
    const iterations = 90 + Math.round(fontSize * 0.35)
    const omega = 1.86

    for(let iteration = 0; iteration < iterations; iteration++)
    {
        for(let n = 0; n < inside.length; n++)
        {
            const i = inside[n]
            const average = (pressure[i - 1] + pressure[i + 1] + pressure[i - width] + pressure[i + width] + 2) * 0.25
            pressure[i] += omega * (average - pressure[i])
        }
    }

    // Light blur
    let blurred = new Float32Array(count)
    for(let pass = 0; pass < 2; pass++)
    {
        for(let y = 1; y < height - 1; y++)
        {
            for(let x = 1; x < width - 1; x++)
            {
                const i = y * width + x
                blurred[i] = (pressure[i] * 4 + pressure[i - 1] + pressure[i + 1] + pressure[i - width] + pressure[i + width]) / 8
            }
        }
        const swap = pressure
        pressure = blurred
        blurred = swap
    }

    // Pack (u, du/dx, du/dy, sd), bottom-up
    const field = new Float32Array(count * 4)
    for(let row = 0; row < height; row++)
    {
        const sourceRow = height - 1 - row
        for(let x = 0; x < width; x++)
        {
            const i = sourceRow * width + x
            const gradientX = x > 0 && x < width - 1 ? (pressure[i + 1] - pressure[i - 1]) * 0.5 : 0
            const gradientY = sourceRow > 0 && sourceRow < height - 1 ? (pressure[i - width] - pressure[i + width]) * 0.5 : 0
            const o = (row * width + x) * 4
            field[o] = pressure[i]
            field[o + 1] = gradientX
            field[o + 2] = gradientY
            field[o + 3] = signedDistance[i]
        }
    }

    // Ink bounds (source rows, y down)
    let minX = width, maxX = 0, minY = height, maxY = 0
    for(let y = 0; y < height; y++)
    {
        for(let x = 0; x < width; x++)
        {
            if(signedDistance[y * width + x] < 0)
            {
                minX = Math.min(minX, x)
                maxX = Math.max(maxX, x)
                minY = Math.min(minY, y)
                maxY = Math.max(maxY, y)
            }
        }
    }

    const empty = minX > maxX
    const ink = empty
        ? { x: 0, y: 0, halfWidth: fontSize * 0.2, halfHeight: fontSize * 0.3 }
        : {
            x: (minX + maxX) / 2 - width / 2,
            y: height / 2 - (minY + maxY) / 2,
            halfWidth: (maxX - minX) / 2,
            halfHeight: (maxY - minY) / 2
        }

    // String anchor: bottom-most ink column closest to the horizontal center
    let anchor = { x: 0, y: - fontSize * 0.3 }
    if(!empty)
    {
        const centerX = (minX + maxX) / 2
        const searchDepth = fontSize * 0.05
        let bestX = - 1
        let bestDistance = INF

        for(let x = minX; x <= maxX; x++)
        {
            for(let y = maxY; y >= maxY - searchDepth; y--)
            {
                if(signedDistance[y * width + x] < - fontSize * 0.02)
                {
                    const distance = Math.abs(x - centerX)
                    if(distance < bestDistance)
                    {
                        bestDistance = distance
                        bestX = x
                    }
                    break
                }
            }
        }

        if(bestX < 0)
            bestX = Math.round(centerX)

        let bottomY = maxY
        while(bottomY > minY && signedDistance[bottomY * width + bestX] >= 0)
            bottomY--

        anchor = {
            x: bestX - width / 2,
            y: height / 2 - (bottomY - fontSize * 0.035)
        }
    }

    return {
        char,
        width,
        height,
        field,
        ink,
        anchor,
        empty,
        advance: metrics.width,
        penX: padding + left - width / 2,
        penY: height / 2 - (padding + ascent)
    }
}

/**
 * Signed distance at glyph texel coordinates (y up), "far" outside the glyph rectangle
 */
export function glyphDistance(glyph, x, y)
{
    const column = Math.round(x)
    const row = Math.round(y)
    if(column < 0 || row < 0 || column >= glyph.width || row >= glyph.height)
        return OUTSIDE_DISTANCE

    return glyph.field[(row * glyph.width + column) * 4 + 3]
}

/**
 * All glyph fields as layers of a single half float array texture
 * Each glyph sits in the bottom-left corner of its cell, the rest is "far outside"
 */
export function buildFieldArray(glyphs)
{
    const cellSize = glyphs.reduce((size, glyph) => Math.max(size, glyph.width, glyph.height), 1)
    const layers = Math.max(glyphs.length, 1)
    const layerSize = cellSize * cellSize * 4
    const data = new Uint16Array(layerSize * layers)

    const toHalf = THREE.DataUtils.toHalfFloat
    const zero = toHalf(0)
    const far = toHalf(OUTSIDE_DISTANCE)

    for(let i = 0; i < data.length; i += 4)
    {
        data[i] = zero
        data[i + 1] = zero
        data[i + 2] = zero
        data[i + 3] = far
    }

    glyphs.forEach((glyph, layer) =>
    {
        for(let y = 0; y < glyph.height; y++)
        {
            for(let x = 0; x < glyph.width; x++)
            {
                const source = (y * glyph.width + x) * 4
                const target = layer * layerSize + (y * cellSize + x) * 4
                data[target] = toHalf(glyph.field[source])
                data[target + 1] = toHalf(glyph.field[source + 1])
                data[target + 2] = toHalf(glyph.field[source + 2])
                data[target + 3] = toHalf(glyph.field[source + 3])
            }
        }
    })

    const texture = new THREE.DataArrayTexture(data, cellSize, cellSize, layers)
    texture.format = THREE.RGBAFormat
    texture.type = THREE.HalfFloatType
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.generateMipmaps = false
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true

    return { texture, cellSize }
}
