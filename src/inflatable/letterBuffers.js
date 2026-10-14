import { cos, float, Fn, instancedArray, int, select, sin, texture, vec2, vec3 } from 'three/tsl'
import { hash } from './layout.js'
import { uniforms } from './uniforms.js'

/**
 * Static per letter data, vec4 slots:
 * HOME   home.xy (world px), size.xy (texels)
 * INK    ink center.xy (texels from plane center, y up), ink half size.xy
 * ANCHOR string anchor.xy (texels), rest rotation, phase
 * MISC   ink radius (world px), field layer, idle rate, index
 */
export const STATIC_STRIDE = 4
export const STATIC = { HOME: 0, INK: 1, ANCHOR: 2, MISC: 3 }

/**
 * Dynamic per letter state, vec4 slots:
 * MOTION  position.xy, velocity.xy
 * SPIN    rotation, angular velocity, squash, squash velocity
 * TILT    tilt.xy, tilt velocity.xy
 * INFLATE inflation, inflation velocity, dent, dent velocity
 * DENT    dent center.xy (texels), dent target, last knock time
 * TARGET  tilt target.xy, pull.xy
 * FORCE   pair + wall force.xy, pressed flag, unused
 */
export const STATE_STRIDE = 7
export const STATE = { MOTION: 0, SPIN: 1, TILT: 2, INFLATE: 3, DENT: 4, TARGET: 5, FORCE: 6 }

export function createLetterBuffers(letters)
{
    const count = letters.length
    const staticBuffer = instancedArray(new Float32Array(count * STATIC_STRIDE * 4), 'vec4')
    const stateBuffer = instancedArray(count * STATE_STRIDE, 'vec4')

    const updateStatic = () =>
    {
        const array = staticBuffer.value.array

        letters.forEach((letter, i) =>
        {
            const { glyph } = letter
            const o = i * STATIC_STRIDE * 4

            array.set([letter.homeX, letter.homeY, glyph.width, glyph.height], o + STATIC.HOME * 4)
            array.set([glyph.ink.x, glyph.ink.y, glyph.ink.halfWidth, glyph.ink.halfHeight], o + STATIC.INK * 4)
            array.set([glyph.anchor.x, glyph.anchor.y, letter.restRot, hash(i + 3) * Math.PI * 2], o + STATIC.ANCHOR * 4)
            array.set([letter.inkRadius, letter.layer, 0.85 + hash(i * 9.1) * 0.5, i], o + STATIC.MISC * 4)
        })

        staticBuffer.value.needsUpdate = true
    }

    updateStatic()

    const staticAt = (index, slot) => staticBuffer.element(int(index).mul(STATIC_STRIDE).add(slot))
    const stateAt = (index, slot) => stateBuffer.element(int(index).mul(STATE_STRIDE).add(slot))

    // Render side view of a letter (vertex stage)
    const readLetter = (index) =>
    {
        const home = staticAt(index, STATIC.HOME)
        const misc = staticAt(index, STATIC.MISC)
        const motion = stateAt(index, STATE.MOTION)
        const spin = stateAt(index, STATE.SPIN)
        const inflate = stateAt(index, STATE.INFLATE)

        return {
            size: home.zw,
            ink: staticAt(index, STATIC.INK),
            anchor: staticAt(index, STATIC.ANCHOR),
            layer: misc.y,
            position: motion.xy,
            rotation: spin.x,
            squash: spin.z,
            tilt: stateAt(index, STATE.TILT).xy,
            inflation: inflate.x,
            dent: inflate.z,
            dentCenter: stateAt(index, STATE.DENT).xy,
            scale: letterScale(inflate.x, spin.z)
        }
    }

    const dispose = () =>
    {
        staticBuffer.value.dispose()
        stateBuffer.value.dispose()
    }

    return { count, staticBuffer, stateBuffer, staticAt, stateAt, updateStatic, readLetter, dispose }
}

/**
 * Shared TSL helpers
 */
export const rotate2 = Fn(([v, angle]) =>
{
    const c = cos(angle)
    const s = sin(angle)
    return vec2(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)))
})

export const letterScale = Fn(([inflation, squash]) =>
{
    const grow = inflation.mul(0.24).add(1).mul(uniforms.layoutScale)
    return vec3(grow.mul(squash.add(1)), grow.mul(squash.oneMinus()), grow)
})

// World px -> glyph texels (0..size, y up), ignores tilt
export const worldToTex = Fn(([world, position, rotation, scale, size]) =>
{
    return rotate2(world.sub(position), rotation.negate()).div(scale.xy).add(size.mul(0.5))
})

export const sampleField = (fieldTexture, tex, layer) =>
    texture(fieldTexture, tex.div(uniforms.cellSize)).depth(int(layer)).level(0)

// Signed distance with "far" outside the glyph rectangle
export const fieldDistance = (fieldTexture, tex, size, layer) =>
{
    const inside = tex.x.greaterThanEqual(0).and(tex.y.greaterThanEqual(0)).and(tex.x.lessThanEqual(size.x)).and(tex.y.lessThanEqual(size.y))
    return select(inside, sampleField(fieldTexture, tex, layer).w, float(1e4))
}
