import * as THREE from 'three/webgpu'
import { abs, cameraProjectionMatrix, cameraViewMatrix, cos, cross, dot, exp, float, Fn, fwidth, If, instanceIndex, length, max, min, mix, normalize, pow, reflect, select, sin, smoothstep, sqrt, uv, varyingProperty, vec2, vec3, vec4 } from 'three/tsl'
import { sampleField } from './letterBuffers.js'
import { balloonColor, uniforms as u } from './uniforms.js'

export const BASE_FONT_SIZE = 180

/**
 * Folds of a part-filled balloon: ridges in three directions
 */
const crease = Fn(([p]) =>
{
    const a = abs(sin(dot(p, vec2(0.071, 0.052)).add(sin(p.y.mul(0.043)).mul(1.6))))
    const b = abs(sin(dot(p, vec2(- 0.049, 0.083)).add(sin(p.x.mul(0.037)).mul(1.3))))
    const c = abs(sin(dot(p, vec2(0.090, - 0.021)).add(1.7)))
    return float(1).sub(a.mul(b).mul(0.7).add(c.mul(0.3)))
})

/**
 * Inflated surface: vec4(height, height gradient.xy, signed distance), all in texels
 * sqrt(u) turns the membrane solution into a round profile: strokes become half tubes, wide areas dome higher
 */
export const balloonSurface = (fieldTexture) => Fn(([tex, layer, inflation, dent, dentCenter]) =>
{
    const field = sampleField(fieldTexture, tex, layer)
    const signedDistance = field.w
    const baseHeight = sqrt(max(field.x, 0).add(0.02))
    const baseGradient = field.yz.div(baseHeight.mul(2)).toVar()
    const gradientLength = length(baseGradient)

    If(gradientLength.greaterThan(7), () =>
    {
        baseGradient.mulAssign(float(7).div(gradientLength))
    })

    // Finger press with a soft rim around it, multiplied so it never punches through the seam
    const delta = tex.sub(dentCenter)
    const radius = u.dentRadius.mul(u.fontSize)
    const radius2 = radius.mul(radius)
    const q = dot(delta, delta).div(radius2)
    const g1 = exp(q.negate())
    const g2 = exp(q.mul(- 0.3))
    const shape = g1.sub(g2.mul(0.32)).div(0.68)
    const shapeGradient = delta.mul(g1.mul(- 2).div(radius2)).sub(delta.mul(g2.mul(0.32 * - 0.6).div(radius2))).div(0.68)
    const pressFactor = float(1).sub(dent.mul(shape))
    const pressGradient = shapeGradient.mul(dent.negate())

    // Pressing in lifts the rest of the letter
    const amplitude = u.puff.mul(max(inflation.add(1).add(max(dent, 0).mul(0.1)), 0.02))
    const height = amplitude.mul(baseHeight).mul(pressFactor).toVar()
    const gradient = baseGradient.mul(pressFactor).add(pressGradient.mul(baseHeight)).mul(amplitude).toVar()

    // Creases only while deflated
    const slack = inflation.negate().sub(0.25).mul(1.6).clamp()

    If(slack.greaterThan(0), () =>
    {
        // Folds are tuned in texels of a 180px field, p keeps them the same size relative to the glyph at any field resolution
        const texelScale = u.fontSize.div(BASE_FONT_SIZE)
        const p = tex.div(texelScale)
        const e = 1.5
        const k = slack.mul(u.puff).mul(u.creaseStrength).mul(smoothstep(0, texelScale.mul(8), signedDistance.negate()))
        height.addAssign(k.mul(texelScale).mul(crease(p)))
        gradient.addAssign(vec2(
            crease(p.add(vec2(e, 0))).sub(crease(p.sub(vec2(e, 0)))),
            crease(p.add(vec2(0, e))).sub(crease(p.sub(vec2(0, e))))
        ).mul(k).div(2 * e))
    })

    return vec4(height, gradient, signedDistance)
})

/**
 * Rotation for Euler order ZXY (same as Object3D.rotation.order = 'ZXY'), as matrix columns
 */
export const rotationZXY = (x, y, z) =>
{
    const a = cos(x), b = sin(x)
    const c = cos(y), d = sin(y)
    const e = cos(z), f = sin(z)
    const ce = c.mul(e), cf = c.mul(f), de = d.mul(e), df = d.mul(f)

    const columns = [
        vec3(ce.sub(df.mul(b)), cf.add(de.mul(b)), a.mul(d).negate()).toVar(),
        vec3(a.mul(f).negate(), a.mul(e), b).toVar(),
        vec3(de.add(cf.mul(b)), df.sub(ce.mul(b)), a.mul(c)).toVar()
    ]

    return {
        columns,
        apply: (v) => columns[0].mul(v.x).add(columns[1].mul(v.y)).add(columns[2].mul(v.z))
    }
}

/**
 * Soft rectangular light box in the reflection environment
 */
const softbox = Fn(([r, direction, size, softness]) =>
{
    const c = dot(r, direction)
    const tangent = normalize(cross(vec3(0, 1, 0), direction))
    const bitangent = cross(direction, tangent)
    const p = vec2(dot(r, tangent), dot(r, bitangent)).div(max(c, 0.0001))
    const q = abs(p).sub(size)
    const distance = length(max(q, 0)).add(min(max(q.x, q.y), 0))
    return select(c.greaterThan(0), smoothstep(softness.negate(), softness, distance).oneMinus(), float(0))
})

// Pale room, large key box high left, tall strip right, wide box on top, darker floor
const studio = Fn(([r]) =>
{
    const environment = vec3(mix(0.2, 0.62, smoothstep(- 0.55, 0.75, r.y))).toVar()
    environment.addAssign(softbox(r, normalize(vec3(- 0.5, 0.58, 0.64)), vec2(0.46, 0.3), float(0.1)).mul(u.keyLight))
    environment.addAssign(softbox(r, normalize(vec3(0.86, 0.12, 0.5)), vec2(0.07, 0.62), float(0.06)).mul(u.stripLight))
    environment.addAssign(softbox(r, normalize(vec3(0.05, 0.95, 0.3)), vec2(0.6, 0.12), float(0.12)).mul(u.topLight))
    return environment
})

const aces = Fn(([x]) =>
{
    return x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)).clamp()
})

export function createLetterMesh({ buffers, fieldTexture, segments = 72 })
{
    const surface = balloonSurface(fieldTexture)

    const vTex = varyingProperty('vec2', 'vTex')
    const vViewPosition = varyingProperty('vec3', 'vViewPosition')
    const vLetter = varyingProperty('vec4', 'vLetter') // inflation, dent, dent center
    const vLayer = varyingProperty('float', 'vLayer')
    const vRotationX = varyingProperty('vec3', 'vRotationX')
    const vRotationY = varyingProperty('vec3', 'vRotationY')
    const vRotationZ = varyingProperty('vec3', 'vRotationZ')

    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true })
    material.alphaTest = 0.01

    material.vertexNode = Fn(() =>
    {
        const letter = buffers.readLetter(instanceIndex)
        const tex = uv().mul(letter.size)
        const height = surface(tex, letter.layer, letter.inflation, letter.dent, letter.dentCenter).x

        const rotation = rotationZXY(letter.tilt.x, letter.tilt.y, letter.rotation)
        const local = vec3(uv().sub(0.5).mul(letter.size), 0)
        const offset = vec3(letter.position, 0)

        const worldFlat = rotation.apply(local.mul(letter.scale)).add(offset)
        const world = rotation.apply(local.add(vec3(0, 0, height)).mul(letter.scale)).add(offset)

        // Keep every point on the screen position of the flat glyph: height only drives depth and light
        const viewFlat = cameraViewMatrix.mul(vec4(worldFlat, 1))
        const view = cameraViewMatrix.mul(vec4(world, 1)).toVar()
        view.xy.assign(viewFlat.xy.mul(view.z.div(viewFlat.z)))

        vTex.assign(tex)
        vViewPosition.assign(view.xyz)
        vLetter.assign(vec4(letter.inflation, letter.dent, letter.dentCenter))
        vLayer.assign(letter.layer)
        vRotationX.assign(rotation.columns[0])
        vRotationY.assign(rotation.columns[1])
        vRotationZ.assign(rotation.columns[2])

        return cameraProjectionMatrix.mul(view)
    })()

    const shading = Fn(() =>
    {
        const inflation = vLetter.x
        const dent = vLetter.y
        const dentCenter = vLetter.zw
        const result = surface(vTex, vLayer, inflation, dent, dentCenter)
        const gradient = result.yz
        const signedDistance = result.w

        // Anti-aliased outline from the signed distance
        const edgeWidth = fwidth(signedDistance).clamp(0.0001, 2)
        const alpha = select(signedDistance.lessThan(2), float(0.5).sub(signedDistance.div(edgeWidth)).clamp(), float(0))

        const localNormal = vec3(gradient.negate(), 1)
        const worldNormal = vRotationX.mul(localNormal.x).add(vRotationY.mul(localNormal.y)).add(vRotationZ.mul(localNormal.z))
        const N = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz)
        const V = normalize(vViewPosition.negate())
        const R = reflect(V.negate(), N)
        const NdV = dot(N, V).clamp()

        const L = normalize(vec3(- 0.5, 0.72, 0.48))
        const wrap = dot(N, L).add(0.3).div(1.3).clamp()
        const hemisphere = N.y.mul(0.5).add(0.5)
        const halfVector = normalize(L.add(V))
        const sheen = pow(dot(N, halfVector).clamp(), 18)

        // Thin vinyl: colour deepens where the surface turns away, seam darkens where it tucks in
        const edge = pow(NdV.oneMinus(), 2)
        const body = mix(balloonColor, balloonColor.mul(balloonColor).mul(0.9), edge.mul(0.8))
        const seamOcclusion = mix(u.seamDarkness.oneMinus(), 1, smoothstep(0, 9, signedDistance.negate()))
        const dentDelta = vTex.sub(dentCenter)
        const dentRadius = u.dentRadius.mul(u.fontSize)
        const dentOcclusion = float(1).sub(dent.clamp().mul(0.4).mul(exp(dot(dentDelta, dentDelta).div(dentRadius.mul(dentRadius)).negate())))
        const diffuse = body.mul(hemisphere.mul(0.22).add(wrap.mul(wrap).mul(1.12))).mul(seamOcclusion).mul(dentOcclusion)

        // Mostly white reflections with a bit of the balloon colour, reads as gloss not paint
        const fresnel = pow(NdV.oneMinus(), 5).mul(0.95).add(0.05)
        const tint = mix(vec3(1), balloonColor.mul(1.6).add(0.2), 0.35)
        const specular = studio(R).mul(tint).mul(mix(0.07, 1, fresnel)).mul(u.gloss).mul(mix(0.7, 1, seamOcclusion))

        const sheenColor = balloonColor.mul(0.5).add(0.5).mul(sheen.mul(0.22).mul(u.gloss).mul(seamOcclusion))
        const color = aces(diffuse.add(specular).add(sheenColor).mul(u.exposure))

        return vec4(color, alpha)
    })()

    material.colorNode = shading.rgb
    material.opacityNode = shading.a

    const geometry = new THREE.PlaneGeometry(1, 1, segments, segments)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.count = buffers.count
    mesh.frustumCulled = false
    mesh.renderOrder = 2

    return mesh
}
