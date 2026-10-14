/**
 * Short one-shot through Web Audio: decoded once up front, every play gets a slightly different pitch
 * The context starts suspended until unlock() is called from a user gesture
 */
export function createBalloonSound({ url, volume = 0.7, pitchVariation = 0.12 })
{
    const settings = { enabled: true, volume, pitchVariation }

    const context = new AudioContext()
    const output = context.createGain()
    output.connect(context.destination)

    const bufferPromise = fetch(url)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .catch((error) =>
        {
            console.warn(`Balloon sound "${url}" could not be loaded`, error)
            return null
        })

    const unlock = () =>
    {
        if(context.state === 'suspended')
            context.resume()
    }

    const play = async () =>
    {
        if(!settings.enabled)
            return

        unlock()
        const buffer = await bufferPromise
        if(!buffer)
            return

        const source = context.createBufferSource()
        source.buffer = buffer
        source.playbackRate.value = 1 + (Math.random() * 2 - 1) * settings.pitchVariation
        output.gain.value = settings.volume
        source.connect(output)
        source.start()
    }

    const ready = bufferPromise.then(() => undefined)

    return { settings, unlock, play, ready }
}
