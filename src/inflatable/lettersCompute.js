import { abs, clamp, float, Fn, hash, If, instanceIndex, int, length, Loop, max, min, mix, pow, select, sin, vec2, vec4 } from 'three/tsl'
import { fieldDistance, letterScale, STATE, STATIC, worldToTex } from './letterBuffers.js'
import { stringWorldLength } from './strings.js'
import { uniforms as u } from './uniforms.js'

const DEFLATED = - 0.94

const smooth01 = (x) => x.mul(x).mul(float(3).sub(x.mul(2)))

// Staggered intro: swell over the whole duration, lift off once partly inflated
const introPhase = (letterIndex) =>
{
    const progress = u.simTime.sub(u.introStart).sub(letterIndex.mul(u.introStagger)).div(u.introDuration).clamp()
    const lift = progress.sub(u.introLiftDelay).div(max(u.introLiftDelay.oneMinus(), 0.001)).clamp()
    return { inflate: smooth01(progress), lift: smooth01(lift) }
}

// Grounded start: balloon sits one string length below home
const liftOffset = (lift) => vec2(0, stringWorldLength().mul(u.introLift).mul(lift.oneMinus()).negate())

export function createLettersCompute({ buffers, fieldTexture })
{
    const { count, staticAt, stateAt } = buffers

    /**
     * Init
     */
    const initCompute = Fn(() =>
    {
        const index = instanceIndex
        const home = staticAt(index, STATIC.HOME)
        const anchor = staticAt(index, STATIC.ANCHOR)

        stateAt(index, STATE.MOTION).assign(vec4(home.xy.add(liftOffset(float(0))), 0, 0))
        stateAt(index, STATE.SPIN).assign(vec4(anchor.z, 0, 0, 0))
        stateAt(index, STATE.TILT).assign(vec4(0))
        stateAt(index, STATE.INFLATE).assign(vec4(DEFLATED, 0, 0, 0))
        stateAt(index, STATE.DENT).assign(vec4(home.zw.mul(0.5), 0, - 10))
        stateAt(index, STATE.TARGET).assign(vec4(0))
        stateAt(index, STATE.FORCE).assign(vec4(0))
    })().compute(count)

    /**
     * Cursor interaction (once per frame): hover / press dent, tilt, pull, knock, pump, fling
     */
    const interactCompute = Fn(() =>
    {
        const index = instanceIndex
        const home = staticAt(index, STATIC.HOME)
        const ink = staticAt(index, STATIC.INK)
        const misc = staticAt(index, STATIC.MISC)
        const size = home.zw
        const inkRadius = misc.x
        const layer = misc.y

        const motion = stateAt(index, STATE.MOTION).toVar()
        const spin = stateAt(index, STATE.SPIN).toVar()
        const inflate = stateAt(index, STATE.INFLATE).toVar()
        const dent = stateAt(index, STATE.DENT).toVar()
        const target = stateAt(index, STATE.TARGET).toVar()
        const force = stateAt(index, STATE.FORCE).toVar()

        const scale = letterScale(inflate.x, spin.z)
        const toTex = (world) => worldToTex(world, motion.xy, spin.x, scale, size)
        const distanceAt = (world) => fieldDistance(fieldTexture, toTex(world), size, layer)

        const isDown = u.cursorDown.greaterThan(0.5)
        const isPressed = () => force.z.greaterThan(0.5)

        // Press start
        If(u.pressStart.greaterThan(0.5).and(distanceAt(u.downPosition).lessThan(6)), () =>
        {
            force.z.assign(1)
        })

        // Hover / hold
        const isHovered = u.cursorInside.greaterThan(0.5)
            .and(isDown.not())
            .and(u.cursorIsMouse.greaterThan(0.5))
            .and(distanceAt(u.cursorPosition).lessThan(0))
        const isHeld = isDown.and(isPressed())

        If(isHovered.or(isHeld), () =>
        {
            const point = clamp(toTex(u.cursorPosition), vec2(0), size)
            const follow = float(1).sub(pow(float(0.65), u.frameDeltaTime.mul(60)))

            dent.z.assign(select(isDown, u.pressDent, u.hoverDent))
            dent.xy.assign(mix(dent.xy, point, follow))

            const offset = clamp(dent.xy.sub(size.mul(0.5)).sub(ink.xy).div(max(ink.zw, vec2(1))), vec2(- 1), vec2(1))
            const amount = u.tiltAmount.mul(max(inflate.z, 0))
            target.x.assign(offset.y.negate().mul(amount))
            target.y.assign(offset.x.mul(amount))

            const pullLimit = vec2(u.unit.mul(0.16))
            const pull = clamp(u.cursorPosition.sub(u.downPosition).mul(u.pullAmount), pullLimit.negate(), pullLimit)
            target.zw.assign(select(isDown, pull, vec2(0)))
        })
            .Else(() =>
            {
                dent.z.assign(0)
                target.assign(vec4(0))
            })

        // Knock (fast sweep)
        const speed = length(u.cursorVelocity)
        const canKnock = u.knockStrength.greaterThan(0)
            .and(speed.greaterThan(u.knockSpeed))
            .and(u.cursorInside.greaterThan(0.5))
            .and(isPressed().not())
            .and(u.simTime.sub(dent.w).greaterThan(0.14))

        If(canKnock, () =>
        {
            const hit = float(0).toVar()
            const hitTex = vec2(0).toVar()

            Loop(8, ({ i: step }) =>
            {
                If(hit.lessThan(0.5), () =>
                {
                    const sampleTex = toTex(mix(u.cursorPrevious, u.cursorPosition, float(step).add(1).div(8)))

                    If(fieldDistance(fieldTexture, sampleTex, size, layer).lessThan(2), () =>
                    {
                        hit.assign(1)
                        hitTex.assign(sampleTex)
                    })
                })
            })

            If(hit.greaterThan(0.5), () =>
            {
                const velocity = u.cursorVelocity
                const strength = min(speed, 1500).div(speed).mul(0.34).mul(u.knockStrength)
                const arm = hitTex.sub(size.mul(0.5)).sub(ink.xy).mul(u.layoutScale)
                const torque = arm.x.mul(velocity.y).sub(arm.y.mul(velocity.x)).mul(strength).div(max(inkRadius.mul(inkRadius), 1)).mul(0.9)
                const squashSign = select(abs(velocity.x).greaterThan(abs(velocity.y)), float(1), float(- 1))

                motion.zw.addAssign(velocity.mul(strength))
                spin.y.addAssign(clamp(torque, - 6, 6))
                spin.w.addAssign(clamp(speed.div(2000), 0, 0.9).mul(squashSign).mul(1.1))
                inflate.w.addAssign(clamp(speed.div(900), 0, 1.6).mul(3.2))
                dent.xy.assign(hitTex)
                dent.w.assign(u.simTime)
            })
        })

        // Release: tap = pump, drag = fling
        If(u.releaseTap.greaterThan(0.5).and(isPressed()), () =>
        {
            inflate.y.addAssign(select(inflate.x.greaterThan(0.3), float(2.6), float(7.2)).mul(u.pumpStrength))
            spin.w.addAssign(float(1.6).mul(u.pumpStrength))
            spin.y.addAssign(hash(u.simTime.mul(1000).add(float(index).mul(7919))).sub(0.5).mul(1.2))
            motion.w.addAssign(u.unit.mul(0.55).mul(u.pumpStrength))
        })

        If(u.releaseFling.greaterThan(0.5).and(isPressed()), () =>
        {
            motion.zw.addAssign(u.cursorVelocity.mul(0.08).mul(u.knockStrength))
        })

        If(u.releaseTap.add(u.releaseFling).greaterThan(0.5), () =>
        {
            force.z.assign(0)
        })

        stateAt(index, STATE.MOTION).assign(motion)
        stateAt(index, STATE.SPIN).assign(spin)
        stateAt(index, STATE.INFLATE).assign(inflate)
        stateAt(index, STATE.DENT).assign(dent)
        stateAt(index, STATE.TARGET).assign(target)
        stateAt(index, STATE.FORCE).assign(force)
    })().compute(count)

    /**
     * Neighbours pushing each other (compression only) + soft viewport walls
     * Every letter only writes its own force, no races
     */
    const forceCompute = Fn(() =>
    {
        const index = instanceIndex
        const homeA = staticAt(index, STATIC.HOME)
        const inkA = staticAt(index, STATIC.INK)
        const inkRadiusA = staticAt(index, STATIC.MISC).x
        const positionA = stateAt(index, STATE.MOTION).xy
        const growA = stateAt(index, STATE.INFLATE).x.mul(0.24)
        const inkHomeA = homeA.xy.add(inkA.xy.mul(u.layoutScale))
        const inkPositionA = positionA.add(inkA.xy.mul(u.layoutScale))

        const force = vec2(0).toVar()

        Loop({ start: int(0), end: u.letterCount, type: 'int', condition: '<' }, ({ i }) =>
        {
            If(i.notEqual(int(index)), () =>
            {
                const homeB = staticAt(i, STATIC.HOME)
                const inkB = staticAt(i, STATIC.INK)
                const inkRadiusB = staticAt(i, STATIC.MISC).x
                const rest = length(homeB.xy.add(inkB.xy.mul(u.layoutScale)).sub(inkHomeA))

                If(rest.lessThan(inkRadiusA.add(inkRadiusB).mul(1.25)), () =>
                {
                    const growB = stateAt(i, STATE.INFLATE).x.mul(0.24)
                    const delta = stateAt(i, STATE.MOTION).xy.add(inkB.xy.mul(u.layoutScale)).sub(inkPositionA)
                    const distance = max(length(delta), 0.001)
                    const compression = rest.mul(growA.add(growB).mul(0.5).add(1)).sub(distance)

                    If(compression.greaterThan(0), () =>
                    {
                        force.subAssign(delta.div(distance).mul(compression).mul(u.pairStiffness))
                    })
                })
            })
        })

        // Walls (faded in with the lift, a grounded balloon may start below the viewport)
        const limit = u.viewport.mul(0.5).sub(inkRadiusA.mul(0.6))
        const overflow = max(positionA.sub(limit), 0).add(min(positionA.add(limit), 0))
        force.subAssign(overflow.mul(400).mul(introPhase(staticAt(index, STATIC.MISC).w).lift))

        const forceState = stateAt(index, STATE.FORCE)
        forceState.xy.assign(force)
    })().compute(count)

    /**
     * Springs (per substep)
     */
    const integrateCompute = Fn(() =>
    {
        const index = instanceIndex
        const dt = u.simDeltaTime
        const time = u.simTime

        const home = staticAt(index, STATIC.HOME)
        const anchor = staticAt(index, STATIC.ANCHOR)
        const misc = staticAt(index, STATIC.MISC)
        const restRotation = anchor.z
        const phase = anchor.w
        const rate = misc.z.mul(u.idleSpeed)
        const letterIndex = misc.w

        const motion = stateAt(index, STATE.MOTION).toVar()
        const spin = stateAt(index, STATE.SPIN).toVar()
        const tilt = stateAt(index, STATE.TILT).toVar()
        const inflate = stateAt(index, STATE.INFLATE).toVar()
        const dent = stateAt(index, STATE.DENT)
        const target = stateAt(index, STATE.TARGET)
        const force = stateAt(index, STATE.FORCE).xy

        // Idle sway targets
        const idleX = sin(time.mul(rate).mul(0.63).add(phase.mul(2.3))).mul(u.unit).mul(0.008)
        const idleY = sin(time.mul(rate).add(phase)).mul(u.unit).mul(0.02)
        const idleRotation = sin(time.mul(rate).mul(0.74).add(phase.mul(1.7))).mul(0.018)
        const intro = introPhase(letterIndex)
        const idle = vec2(idleX, idleY).mul(u.idleAmplitude).mul(intro.lift)
        const positionTarget = home.xy.add(liftOffset(intro.lift)).add(target.zw).add(idle)
        const rotationTarget = restRotation.add(idleRotation.mul(u.idleAmplitude))
        const inflateTarget = mix(float(DEFLATED), float(0), intro.inflate)

        // Position
        const acceleration = positionTarget.sub(motion.xy).mul(u.positionStiffness).sub(motion.zw.mul(u.positionDamping)).add(force)
        motion.zw.addAssign(acceleration.mul(dt))
        motion.xy.addAssign(motion.zw.mul(dt))

        // Rotation
        spin.y.addAssign(rotationTarget.sub(spin.x).mul(u.rotationStiffness).sub(spin.y.mul(u.rotationDamping)).mul(dt))
        spin.x.addAssign(spin.y.mul(dt))

        // Squash
        spin.w.addAssign(spin.z.negate().mul(u.squashStiffness).sub(spin.w.mul(u.squashDamping)).mul(dt))
        spin.z.assign(spin.z.add(spin.w.mul(dt)).clamp(- 0.12, 0.12))

        // Tilt
        tilt.zw.addAssign(target.xy.sub(tilt.xy).mul(u.tiltStiffness).sub(tilt.zw.mul(u.tiltDamping)).mul(dt))
        tilt.xy.addAssign(tilt.zw.mul(dt))

        // Inflation
        inflate.y.addAssign(inflateTarget.sub(inflate.x).mul(u.inflateStiffness).sub(inflate.y.mul(u.inflateDamping)).mul(dt))
        inflate.x.assign(inflate.x.add(inflate.y.mul(dt)).clamp(- 0.96, 0.75))

        // Dent
        inflate.w.addAssign(dent.z.sub(inflate.z).mul(u.dentStiffness).sub(inflate.w.mul(u.dentDamping)).mul(dt))
        inflate.z.assign(inflate.z.add(inflate.w.mul(dt)).clamp(- 0.35, 0.92))

        stateAt(index, STATE.MOTION).assign(motion)
        stateAt(index, STATE.SPIN).assign(spin)
        stateAt(index, STATE.TILT).assign(tilt)
        stateAt(index, STATE.INFLATE).assign(inflate)
    })().compute(count)

    return { initCompute, interactCompute, forceCompute, integrateCompute }
}
