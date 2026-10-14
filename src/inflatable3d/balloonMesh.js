import * as THREE from 'three/webgpu'
import { attribute, cameraViewMatrix, clamp, dot, exp, float, Fn, instanceIndex, max, mix, normalize, positionView, positionWorld, select, smoothstep, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl'
import { sampleField } from '../inflatable/letterBuffers.js'
import { BASE_FONT_SIZE, balloonSurface, rotationZXY } from '../inflatable/letterMaterial.js'
import { balloonColor, uniforms as u } from '../inflatable/uniforms.js'

export const materialSettings = {
    roughness: uniform(0.34),
    clearcoat: uniform(1),
    clearcoatRoughness: uniform(0.06),
    sheen: uniform(0.35),
    seamTint: uniform(0.55)
}

/**
 * Closed pillow: front sheet (z = +h) and mirrored back sheet (z = -h, reversed winding)
 * They meet on the glyph outline where h -> 0, the outline itself is cut per pixel from the signed distance
 */
function createPillowGeometry(segments)
{
    const plane = new THREE.PlaneGeometry(1, 1, segments, segments)
    const vertexCount = plane.attributes.position.count
    const planeIndex = plane.index.array

    const positions = new Float32Array(vertexCount * 6)
    positions.set(plane.attributes.position.array, 0)
    positions.set(plane.attributes.position.array, vertexCount * 3)

    const uvs = new Float32Array(vertexCount * 4)
    uvs.set(plane.attributes.uv.array, 0)
    uvs.set(plane.attributes.uv.array, vertexCount * 2)

    const sides = new Float32Array(vertexCount * 2)
    sides.fill(1, 0, vertexCount)
    sides.fill(- 1, vertexCount)

    const index = new Uint32Array(planeIndex.length * 2)
    index.set(planeIndex, 0)
    for(let i = 0; i < planeIndex.length; i += 3)
    {
        const o = planeIndex.length + i
        index[o] = planeIndex[i] + vertexCount
        index[o + 1] = planeIndex[i + 2] + vertexCount
        index[o + 2] = planeIndex[i + 1] + vertexCount
    }

    plane.dispose()

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setAttribute('side', new THREE.BufferAttribute(sides, 1))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))

    return geometry
}

/**
 * Grid vertices are moved along the distance gradient:
 * - outside the glyph they land on the outline (the seam), otherwise the two sheets end above z = 0 and leave a gap
 * - inside a band of width `band` their depth d becomes d^2 / band. The profile is ~sqrt(d) there,
 *   so the height turns linear in grid space and the rim no longer saw-tooths between rows at random depths
 * Returns vec3(moved tex, 1 if the vertex was outside)
 */
const relaxToOutline = (fieldTexture, tex, size, layer, band) =>
{
    const distanceAt = (offset) => sampleField(fieldTexture, clamp(tex.add(offset), vec2(0.5), size.sub(0.5)), layer).w
    const signedDistance = sampleField(fieldTexture, tex, layer).w
    const gradient = vec2(
        distanceAt(vec2(1, 0)).sub(distanceAt(vec2(- 1, 0))),
        distanceAt(vec2(0, 1)).sub(distanceAt(vec2(0, - 1)))
    ).add(vec2(0.00001, 0))

    const isOutside = signedDistance.greaterThan(0)
    const depth = signedDistance.negate()
    const relaxedDepth = select(isOutside, float(0), select(depth.lessThan(band), depth.mul(depth).div(band), depth))
    const moved = tex.add(normalize(gradient).mul(depth.sub(relaxedDepth)))

    return vec3(moved, select(isOutside, float(1), float(0)))
}

export function createBalloonMesh({ buffers, fieldTexture, segments = 64 })
{
    const surface = balloonSurface(fieldTexture)
    const side = attribute('side', 'float')

    // Instance data has to cross to the fragment stage as varyings (no instanceIndex there)
    const letter = buffers.readLetter(instanceIndex)
    const rimBand = letter.size.x.div(segments).mul(3)
    const snapped = relaxToOutline(fieldTexture, uv().mul(letter.size), letter.size, letter.layer, rimBand)
    const snappedTex = snapped.xy
    const vSize = varying(letter.size, 'vBalloonSize')
    const vPosition = varying(letter.position, 'vBalloonPosition')
    const vLayer = varying(letter.layer, 'vBalloonLayer')
    const vLetter = varying(vec4(letter.inflation, letter.dent, letter.dentCenter), 'vBalloonLetter')
    const vAngles = varying(vec3(letter.tilt, letter.rotation), 'vBalloonAngles')
    const vScale = varying(letter.scale, 'vBalloonScale')

    const material = new THREE.MeshPhysicalNodeMaterial({ side: THREE.FrontSide })

    material.positionNode = Fn(() =>
    {
        // Snapped vertices are the seam: both sheets meet exactly at z = 0
        // (the profile is near vertical there, half a texel of snapping error would open a gap of several texels)
        const surfaceHeight = surface(snappedTex, letter.layer, letter.inflation, letter.dent, letter.dentCenter).x
        const height = surfaceHeight.mul(snapped.z.oneMinus())
        const rotation = rotationZXY(letter.tilt.x, letter.tilt.y, letter.rotation)
        const local = vec3(snappedTex.sub(letter.size.mul(0.5)), height.mul(side))

        // Mesh stays at identity, the "local" position is already in world px
        return rotation.apply(local.mul(letter.scale)).add(vec3(letter.position, 0))
    })()

    // Field coordinate of the pixel from its exact world position, not interpolated from the vertices:
    // the rim layout is non linear, a linear varying would put kinks in the normals on every triangle edge
    const fragmentTex = Fn(() =>
    {
        const rotation = rotationZXY(vAngles.x, vAngles.y, vAngles.z)
        const relative = positionWorld.sub(vec3(vPosition, 0))
        const local = vec2(dot(rotation.columns[0], relative), dot(rotation.columns[1], relative))
        return local.div(vScale.xy).add(vSize.mul(0.5))
    })()

    const fragmentSurface = surface(fragmentTex, vLayer, vLetter.x, vLetter.y, vLetter.zw)
    const signedDistance = fragmentSurface.w

    const shadingNormal = Fn(() =>
    {
        // Inverse transpose of the (diagonal) squash scale, then the letter rotation
        const localNormal = vec3(fragmentSurface.yz.negate(), side).div(vScale)
        const rotation = rotationZXY(vAngles.x, vAngles.y, vAngles.z)
        const normal = normalize(cameraViewMatrix.mul(vec4(rotation.apply(localNormal), 0)).xyz)

        // On the seam the faceted geometry can face the camera while the smooth field normal already points away
        const view = normalize(positionView.negate())
        const facing = dot(normal, view)
        return normalize(normal.add(view.mul(max(facing.negate().add(0.02), 0))))
    })()

    // The geometry has no normal attribute, the clearcoat layer would fall back to flat faceted normals
    material.normalNode = shadingNormal
    material.clearcoatNormalNode = shadingNormal

    const occlusion = Fn(() =>
    {
        const seam = mix(u.seamDarkness.oneMinus(), 1, smoothstep(0, u.fontSize.div(BASE_FONT_SIZE).mul(9), signedDistance.negate()))
        const dentDelta = fragmentTex.sub(vLetter.zw)
        const dentRadius = u.dentRadius.mul(u.fontSize)
        const dent = float(1).sub(vLetter.y.clamp().mul(0.4).mul(exp(dot(dentDelta, dentDelta).div(dentRadius.mul(dentRadius)).negate())))
        return seam.mul(dent)
    })()

    material.colorNode = vec4(balloonColor.mul(mix(1, occlusion, materialSettings.seamTint)), 1)
    material.aoNode = occlusion
    material.roughnessNode = materialSettings.roughness
    material.metalnessNode = float(0)
    material.clearcoatNode = materialSettings.clearcoat
    material.clearcoatRoughnessNode = materialSettings.clearcoatRoughness
    material.sheenNode = balloonColor.mul(0.5).add(0.5).mul(materialSettings.sheen)
    material.sheenRoughnessNode = float(0.45)

    // The mesh border already sits on the outline (MSAA smooths it), this only trims triangles bridging concave parts
    material.maskNode = signedDistance.lessThan(1)

    const mesh = new THREE.Mesh(createPillowGeometry(segments), material)
    mesh.count = buffers.count
    mesh.frustumCulled = false
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.renderOrder = 2

    return mesh
}
