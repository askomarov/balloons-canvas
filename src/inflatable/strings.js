import * as THREE from 'three/webgpu'
import { abs, cameraProjectionMatrix, cameraViewMatrix, color, cos, exp, float, floor, Fn, If, instanceIndex, instancedArray, int, length, Loop, max, min, pow, sin, uv, varyingProperty, vec2, vec3, vec4 } from 'three/tsl'
import { hash } from './layout.js'
import { rotate2 } from './letterBuffers.js'
import { balloonColor, uniforms as u } from './uniforms.js'

const POINTS = 12
const RIBBON_ROWS = 56
const CONSTRAINT_ITERATIONS = 6

const smooth01 = (x) =>
{
    const t = x.clamp()
    return t.mul(t).mul(t.mul(- 2).add(3))
}

/**
 * Curly ribbon strings: verlet chain per letter (compute) + ribbon rebuilt in the vertex stage
 */
export function createStrings({ buffers })
{
    const { count } = buffers

    // Per string constants: lean, curl phase, curl direction, curl turns
    const settingsArray = new Float32Array(count * 4)
    for(let i = 0; i < count; i++)
    {
        settingsArray.set([
            (hash(i * 4.1 + 7) - 0.5) * 0.5,
            hash(i * 5.7 + 9) * Math.PI * 2,
            hash(i * 2.3 + 4) > 0.5 ? 1 : - 1,
            2.6 + hash(i * 1.9 + 1) * 1.2
        ], i * 4)
    }

    const settingsBuffer = instancedArray(settingsArray, 'vec4')
    const pointsBuffer = instancedArray(count * POINTS, 'vec4') // position.xy, velocity.xy
    const previousBuffer = instancedArray(count * POINTS, 'vec2')

    const pointAt = (letterIndex, k) => pointsBuffer.element(int(letterIndex).mul(POINTS).add(k))
    const previousAt = (letterIndex, k) => previousBuffer.element(int(letterIndex).mul(POINTS).add(k))

    const segmentLength = () => u.unit.mul(0.56 / (POINTS - 1)).mul(u.stringLength)

    const anchorWorld = (index) =>
    {
        const letter = buffers.readLetter(index)
        return rotate2(letter.anchor.xy.mul(letter.scale.xy), letter.rotation).add(letter.position)
    }

    /**
     * Compute
     */
    const initCompute = Fn(() =>
    {
        const index = instanceIndex
        const anchor = anchorWorld(index)
        const lean = settingsBuffer.element(index).x
        const segment = segmentLength()

        Loop(POINTS, ({ i }) =>
        {
            const k = float(i)
            const position = anchor.add(vec2(lean.mul(segment).mul(k).mul(k).mul(0.08), segment.mul(k).negate()))
            pointAt(index, i).assign(vec4(position, 0, 0))
            previousAt(index, i).assign(position)
        })
    })().compute(count)

    const stepCompute = Fn(() =>
    {
        const index = instanceIndex
        const dt = u.simDeltaTime
        const lean = settingsBuffer.element(index).x
        const segment = segmentLength()
        const damping = exp(dt.mul(- 2.4))

        pointAt(index, 0).assign(vec4(anchorWorld(index), 0, 0))

        // Integrate
        Loop({ start: int(1), end: int(POINTS), type: 'int', condition: '<' }, ({ i }) =>
        {
            const point = pointAt(index, i).toVar()
            previousAt(index, i).assign(point.xy)

            const velocity = point.zw.add(vec2(lean.mul(120), u.stringGravity.negate()).mul(dt)).mul(damping)
            point.zw.assign(velocity)
            point.xy.addAssign(velocity.mul(dt))
            pointAt(index, i).assign(point)
        })

        // Distance constraints, first link pinned to the anchor
        Loop(CONSTRAINT_ITERATIONS, () =>
        {
            Loop({ start: int(1), end: int(POINTS), type: 'int', condition: '<' }, ({ i }) =>
            {
                const a = pointAt(index, i.sub(1))
                const b = pointAt(index, i)
                const delta = b.xy.sub(a.xy).toVar()
                const distance = max(length(delta), 0.0001)
                const correction = delta.mul(distance.sub(segment).div(distance)).toVar()

                If(i.equal(1), () =>
                {
                    b.xy.subAssign(correction)
                })
                    .Else(() =>
                    {
                        b.xy.subAssign(correction.mul(0.5))
                        a.xy.addAssign(correction.mul(0.5))
                    })
            })
        })

        // Velocity from the constrained motion
        Loop({ start: int(1), end: int(POINTS), type: 'int', condition: '<' }, ({ i }) =>
        {
            const point = pointAt(index, i)
            point.zw.assign(point.xy.sub(previousAt(index, i)).div(dt))
        })
    })().compute(count)

    /**
     * Ribbon geometry: rows along the string, 2 vertices per row (uv.x = side, uv.y = t)
     */
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(RIBBON_ROWS * 2 * 3)
    const uvs = new Float32Array(RIBBON_ROWS * 2 * 2)
    const indices = []

    for(let row = 0; row < RIBBON_ROWS; row++)
    {
        const t = row / (RIBBON_ROWS - 1)
        uvs.set([0, t, 1, t], row * 4)

        if(row < RIBBON_ROWS - 1)
        {
            const v = row * 2
            indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
        }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setIndex(indices)

    const createMaterial = (isShadow) =>
    {
        const vShade = varyingProperty('float', 'vStringShade')
        const vFade = varyingProperty('float', 'vStringFade')

        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthTest: ! isShadow,
            depthWrite: false,
            side: THREE.DoubleSide
        })

        material.vertexNode = Fn(() =>
        {
            const index = instanceIndex
            const settings = settingsBuffer.element(index)
            const t = uv().y
            const side = uv().x.mul(2).sub(1)

            // Catmull-Rom through the chain
            const f = t.mul(POINTS - 1)
            const segment = min(floor(f), POINTS - 2)
            const s = f.sub(segment)
            const segmentIndex = int(segment)
            const p0 = pointAt(index, max(segmentIndex.sub(1), int(0))).xy
            const p1 = pointAt(index, segmentIndex).xy
            const p2 = pointAt(index, segmentIndex.add(1)).xy
            const p3 = pointAt(index, min(segmentIndex.add(2), int(POINTS - 1))).xy

            const c1 = p2.sub(p0)
            const c2 = p0.mul(2).sub(p1.mul(5)).add(p2.mul(4)).sub(p3)
            const c3 = p1.mul(3).sub(p0).sub(p2.mul(3)).add(p3)
            const center = p1.mul(2).add(c1.mul(s)).add(c2.mul(s.mul(s))).add(c3.mul(s.mul(s).mul(s))).mul(0.5)
            const derivative = c1.add(c2.mul(s.mul(2))).add(c3.mul(s.mul(s).mul(3))).mul(0.5)
            const tangent = derivative.div(max(length(derivative), 0.0001))
            const normal = vec2(tangent.y.negate(), tangent.x)

            // Curl
            const angle = settings.y.add(t.mul(settings.w).mul(u.stringTurns).mul(Math.PI * 2).mul(settings.z))
            const amplitude = u.unit.mul(0.05).mul(u.stringCurl).mul(smooth01(t.mul(1.6))).mul(t.mul(0.45).add(0.55))
            const width = max(1.6, u.unit.mul(0.014)).mul(u.stringWidth).mul(abs(cos(angle)).mul(0.7).add(0.3)).mul(0.5)
            const position = center.add(normal.mul(sin(angle).mul(amplitude))).add(normal.mul(width.mul(side)))

            const offset = isShadow ? vec3(u.unit.mul(0.012), u.unit.mul(- 0.03), - 2) : vec3(0, 0, - 1)

            vShade.assign(cos(angle))
            vFade.assign(smooth01(t.sub(0.72).div(0.28)).oneMinus())

            return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(vec3(position, 0).add(offset), 1)))
        })()

        if(isShadow)
        {
            material.colorNode = color('#171717')
            material.opacityNode = vFade.mul(0.16).mul(u.shadowStrength)
        }
        else
        {
            const face = abs(vShade)
            const base = balloonColor.mul(0.5).mul(face.mul(0.5).add(0.5))
            const highlight = balloonColor.mul(0.5).add(0.5).mul(pow(face, 12)).mul(0.16)
            const ribbon = base.add(highlight)
            material.colorNode = ribbon.mul(ribbon.mul(2.51).add(0.03)).div(ribbon.mul(ribbon.mul(2.43).add(0.59)).add(0.14)).clamp()
            material.opacityNode = vFade
        }

        return material
    }

    const mesh = new THREE.Mesh(geometry, createMaterial(false))
    mesh.count = count
    mesh.frustumCulled = false
    mesh.renderOrder = 1.5

    const shadowMesh = new THREE.Mesh(geometry, createMaterial(true))
    shadowMesh.count = count
    shadowMesh.frustumCulled = false
    shadowMesh.renderOrder = 1

    const group = new THREE.Group()
    group.add(shadowMesh, mesh)

    return {
        group,
        mesh,
        shadowMesh,
        initCompute,
        stepCompute,
        dispose: () =>
        {
            geometry.dispose()
            mesh.material.dispose()
            shadowMesh.material.dispose()
            settingsBuffer.value.dispose()
            pointsBuffer.value.dispose()
            previousBuffer.value.dispose()
        }
    }
}
