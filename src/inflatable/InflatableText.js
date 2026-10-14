import * as THREE from 'three/webgpu'
import { buildFieldArray, buildGlyphField, fontString, glyphDistance } from './glyphField.js'
import { layoutLetters, parseText } from './layout.js'
import { createLetterBuffers, STATE, STATE_STRIDE } from './letterBuffers.js'
import { createLettersCompute } from './lettersCompute.js'
import { createLetterMesh } from './letterMaterial.js'
import { createShadowMesh } from './shadow.js'
import { createStrings } from './strings.js'
import { uniforms } from './uniforms.js'

const FIXED_STEP = 1 / 120
const MAX_FRAME_DELTA = 0.05

export class InflatableText
{
    constructor({ renderer, scene, font, fontSize = 180 })
    {
        this.renderer = renderer
        this.scene = scene
        this.font = font
        this.fontSize = fontSize
        this.viewport = { width: 1, height: 1 }

        this.settings = {
            tracking: - 0.01,
            maxSize: 0,
            strings: true
        }

        this.glyphCache = new Map()
        this.group = new THREE.Group()
        this.scene.add(this.group)

        uniforms.fontSize.value = fontSize
    }

    getGlyph(char)
    {
        const key = `${fontString(this.font, this.fontSize)}|${char}`
        if(!this.glyphCache.has(key))
            this.glyphCache.set(key, buildGlyphField(char, this.font, this.fontSize))
        return this.glyphCache.get(key)
    }

    build(text)
    {
        this.disposeLetters()

        this.text = text
        const lines = parseText(text)
        if(!lines.length)
            lines.push([Array.from('hello')])

        // Letters + unique glyph layers
        const glyphs = []
        const layers = new Map()
        this.letters = []

        lines.forEach((words, line) =>
        {
            words.forEach((chars, w) =>
            {
                chars.forEach((char) =>
                {
                    const glyph = this.getGlyph(char)
                    if(!layers.has(glyph))
                    {
                        layers.set(glyph, glyphs.length)
                        glyphs.push(glyph)
                    }

                    this.letters.push({ glyph, line, word: `${line}-${w}`, layer: layers.get(glyph), index: this.letters.length })
                })
            })
        })

        this.lineCount = lines.length

        const measureContext = document.createElement('canvas').getContext('2d')
        measureContext.font = fontString(this.font, this.fontSize)
        this.spaceWidth = measureContext.measureText(' ').width

        // GPU resources
        const { texture, cellSize } = buildFieldArray(glyphs)
        this.fieldTexture = texture
        uniforms.cellSize.value = cellSize
        uniforms.letterCount.value = this.letters.length

        this.applyLayout()

        this.buffers = createLetterBuffers(this.letters)
        this.computes = createLettersCompute({ buffers: this.buffers, fieldTexture: texture })

        const { letterMesh, shadowMesh = null } = this.createMeshes({ buffers: this.buffers, fieldTexture: texture })
        this.letterMesh = letterMesh
        this.shadowMesh = shadowMesh
        this.strings = createStrings({ buffers: this.buffers })
        this.strings.group.visible = this.settings.strings

        this.group.add(...[this.shadowMesh, this.strings.group, this.letterMesh].filter(Boolean))

        this.renderer.compute(this.computes.initCompute)
        this.renderer.compute(this.strings.initCompute)
        uniforms.introStart.value = uniforms.simTime.value
    }

    // Override point for other renderings of the same simulation
    createMeshes({ buffers, fieldTexture })
    {
        return {
            letterMesh: createLetterMesh({ buffers, fieldTexture }),
            shadowMesh: createShadowMesh({ buffers, fieldTexture })
        }
    }

    applyLayout()
    {
        const { scale, unit } = layoutLetters({
            letters: this.letters,
            lineCount: this.lineCount,
            viewport: this.viewport,
            fontSize: this.fontSize,
            spaceWidth: this.spaceWidth,
            tracking: this.settings.tracking,
            maxSize: this.settings.maxSize,
            withStrings: this.settings.strings
        })

        uniforms.layoutScale.value = scale
        uniforms.unit.value = unit
    }

    setViewport(width, height)
    {
        this.viewport.width = width
        this.viewport.height = height
        uniforms.viewport.value.set(width, height)

        if(this.letters)
            this.relayout()
    }

    relayout()
    {
        this.applyLayout()
        this.buffers.updateStatic()
    }

    setStringsVisible(visible)
    {
        this.settings.strings = visible
        if(this.strings)
            this.strings.group.visible = visible
        if(this.letters)
            this.relayout()
    }

    /**
     * Letter under a world px point (z = 0 plane, tilt ignored like the compute side), or null
     * Positions live on the GPU, so this reads the state buffer back (async, a frame or two late)
     */
    async hitTest(x, y)
    {
        if(!this.buffers)
            return null

        const { buffers, letters } = this
        const state = new Float32Array(await this.renderer.getArrayBufferAsync(buffers.stateBuffer.value))
        if(buffers !== this.buffers)
            return null

        const layoutScale = uniforms.layoutScale.value

        for(let i = letters.length - 1; i >= 0; i--)
        {
            const o = i * STATE_STRIDE * 4
            const positionX = state[o + STATE.MOTION * 4]
            const positionY = state[o + STATE.MOTION * 4 + 1]
            const rotation = state[o + STATE.SPIN * 4]
            const squash = state[o + STATE.SPIN * 4 + 2]
            const inflation = state[o + STATE.INFLATE * 4]

            const grow = (inflation * 0.24 + 1) * layoutScale
            const dx = x - positionX
            const dy = y - positionY
            const cos = Math.cos(rotation)
            const sin = Math.sin(rotation)
            const { glyph } = letters[i]
            const texX = (dx * cos + dy * sin) / (grow * (1 + squash)) + glyph.width / 2
            const texY = (dy * cos - dx * sin) / (grow * (1 - squash)) + glyph.height / 2

            if(glyphDistance(glyph, texX, texY) < 0)
                return letters[i]
        }

        return null
    }

    replayIntro()
    {
        if(!this.computes)
            return

        this.renderer.compute(this.computes.initCompute)
        this.renderer.compute(this.strings.initCompute)
        uniforms.introStart.value = uniforms.simTime.value
    }

    update(deltaTime)
    {
        if(!this.computes)
            return

        const frameDelta = Math.min(deltaTime, MAX_FRAME_DELTA)
        const steps = Math.max(1, Math.ceil(frameDelta / FIXED_STEP))
        const step = frameDelta / steps

        uniforms.frameDeltaTime.value = frameDelta
        uniforms.simDeltaTime.value = step

        this.renderer.compute(this.computes.interactCompute)

        for(let i = 0; i < steps; i++)
        {
            uniforms.simTime.value += step
            this.renderer.compute(this.computes.forceCompute)
            this.renderer.compute(this.computes.integrateCompute)
            if(this.settings.strings)
                this.renderer.compute(this.strings.stepCompute)
        }
    }

    disposeLetters()
    {
        if(!this.letterMesh)
            return

        this.group.clear()
        for(const mesh of [this.letterMesh, this.shadowMesh].filter(Boolean))
        {
            mesh.geometry.dispose()
            mesh.material.dispose()
        }
        this.strings.dispose()
        this.fieldTexture.dispose()

        this.computes.initCompute.dispose?.()
        this.computes.interactCompute.dispose?.()
        this.computes.forceCompute.dispose?.()
        this.computes.integrateCompute.dispose?.()
        this.strings.initCompute.dispose?.()
        this.strings.stepCompute.dispose?.()

        this.letterMesh = null
        this.shadowMesh = null
        this.computes = null
    }
}
