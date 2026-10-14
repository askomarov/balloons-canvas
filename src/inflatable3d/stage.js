import * as THREE from 'three/webgpu'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { uniforms as u } from '../inflatable/uniforms.js'

/**
 * Environment reflections, one shadow casting key light, a shadow catcher wall behind the letters
 * Distances are in world px, scaled by the current letter unit
 */
export function createStage({ renderer, scene })
{
    const settings = {
        lightX: - 0.22,
        lightY: 0.42,
        lightIntensity: 2.4,
        environmentIntensity: 0.9,
        wallDepth: 0.32,
        shadowOpacity: 0.32,
        shadowRadius: 6,
        // World px: the shadow map sees the faceted mesh while lighting uses the smooth field normal
        shadowBias: 3,
        shadowNormalBias: 3
    }

    const pmrem = new THREE.PMREMGenerator(renderer)
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    scene.environment = environment

    const light = new THREE.DirectionalLight(0xffffff, settings.lightIntensity)
    light.castShadow = true
    light.shadow.mapSize.set(2048, 2048)
    scene.add(light, light.target)

    const wallMaterial = new THREE.ShadowNodeMaterial({ color: 0x241717, transparent: true })
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial)
    wall.receiveShadow = true
    wall.renderOrder = 0
    scene.add(wall)

    const viewport = { width: 1, height: 1 }

    const update = () =>
    {
        const unit = u.unit.value
        const span = Math.max(viewport.width, viewport.height) * 1.6

        scene.environmentIntensity = settings.environmentIntensity

        wall.position.z = - settings.wallDepth * unit
        wall.scale.set(span * 2, span * 2, 1)
        wallMaterial.opacity = settings.shadowOpacity

        const direction = new THREE.Vector3(settings.lightX, settings.lightY, 1).normalize()
        const distance = span
        light.position.copy(direction).multiplyScalar(distance)
        light.target.position.set(0, 0, 0)
        light.intensity = settings.lightIntensity

        const shadowCamera = light.shadow.camera
        shadowCamera.left = - span / 2
        shadowCamera.right = span / 2
        shadowCamera.top = span / 2
        shadowCamera.bottom = - span / 2
        shadowCamera.near = distance * 0.25
        shadowCamera.far = distance * 2
        shadowCamera.updateProjectionMatrix()
        light.shadow.bias = - settings.shadowBias / (shadowCamera.far - shadowCamera.near)
        light.shadow.normalBias = settings.shadowNormalBias
        light.shadow.radius = settings.shadowRadius
        light.shadow.needsUpdate = true
    }

    const setViewport = (width, height) =>
    {
        viewport.width = width
        viewport.height = height
        update()
    }

    return { settings, update, setViewport }
}
