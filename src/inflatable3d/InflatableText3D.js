import { InflatableText } from '../inflatable/InflatableText.js'
import { createBalloonMesh } from './balloonMesh.js'

/**
 * Same simulation (layout, compute, strings), real geometry instead of screen locked planes
 * The field is rasterized at twice the 2D resolution: seen from the side or zoomed in, 180px fields show texel steps on the rim
 */
export class InflatableText3D extends InflatableText
{
    constructor({ onLayout = null, fontSize = 360, ...options })
    {
        super({ ...options, fontSize })
        this.onLayout = onLayout
    }

    createMeshes({ buffers, fieldTexture })
    {
        return { letterMesh: createBalloonMesh({ buffers, fieldTexture }) }
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
