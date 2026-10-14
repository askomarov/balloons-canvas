import { InflatableText } from '../inflatable/InflatableText.js'
import { createBalloonMesh } from './balloonMesh.js'

/**
 * Same simulation (layout, compute, strings), real geometry instead of screen locked planes
 * The field is rasterized denser than 2D: seen from the side or zoomed in, 180px fields show texel steps on the rim
 */
export class InflatableText3D extends InflatableText
{
    constructor({ onLayout = null, fontSize = 280, segments = 64, ...options })
    {
        super({ ...options, fontSize })
        this.onLayout = onLayout
        this.segments = segments
    }

    createMeshes({ buffers, fieldTexture })
    {
        return { letterMesh: createBalloonMesh({ buffers, fieldTexture, segments: this.segments }) }
    }

    applyLayout()
    {
        super.applyLayout()
        this.onLayout?.()
    }

    build(text)
    {
        super.build(text)

        // The wall receives real shadows, the flat fake one would float in mid air once the camera orbits
        this.strings.shadowMesh.visible = false
    }
}
