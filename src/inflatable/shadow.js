import * as THREE from 'three/webgpu'
import { cameraProjectionMatrix, cameraViewMatrix, Fn, instanceIndex, uv, varyingProperty, vec2, vec3, vec4 } from 'three/tsl'
import { rotate2, sampleField } from './letterBuffers.js'
import { uniforms as u } from './uniforms.js'

const WALL_DEPTH = - 2

/**
 * Two shadows from one signed distance: a tight contact line and a wide soft one
 * Fuller balloons stand further from the wall: bigger offset, softer and stronger
 */
export function createShadowMesh({ buffers, fieldTexture })
{
    const vTex = varyingProperty('vec2', 'vShadowTex')
    const vLayer = varyingProperty('float', 'vShadowLayer')
    const vFullness = varyingProperty('float', 'vShadowFullness')

    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false })

    material.vertexNode = Fn(() =>
    {
        const letter = buffers.readLetter(instanceIndex)
        const fullness = letter.inflation.add(1).clamp(0.05, 1.8)
        const tex = uv().mul(letter.size)

        const local = uv().sub(0.5).mul(letter.size).mul(letter.scale.xy).mul(fullness.mul(0.02).add(1))
        const offset = vec2(u.shadowOffset.x, u.shadowOffset.y.mul(fullness)).mul(u.unit)
        const world = vec3(rotate2(local, letter.rotation).add(letter.position).add(offset), WALL_DEPTH)

        vTex.assign(tex)
        vLayer.assign(letter.layer)
        vFullness.assign(fullness)

        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1)))
    })()

    const alpha = Fn(() =>
    {
        const signedDistance = sampleField(fieldTexture, vTex, vLayer).w
        const softness = u.fontSize.mul(vFullness.mul(0.06).add(0.08)).mul(u.shadowSoftness)
        const strength = vFullness.clamp(0, 1.3).mul(u.shadowStrength)
        const contact = signedDistance.smoothstep(- 2, 4).oneMinus()
        const soft = signedDistance.smoothstep(softness.mul(- 0.5), softness).oneMinus()
        return strength.mul(contact.mul(0.3).add(soft.mul(soft).mul(0.2)))
    })()

    material.colorNode = u.shadowTint
    material.opacityNode = alpha
    material.alphaTest = 0.002

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    mesh.count = buffers.count
    mesh.frustumCulled = false
    mesh.renderOrder = 1

    return mesh
}
