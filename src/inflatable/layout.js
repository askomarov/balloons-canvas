export function hash(n)
{
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
    return x - Math.floor(x)
}

/**
 * "one|hundred" -> lines of words of chars
 */
export function parseText(text)
{
    return text
        .replace(/\r/g, '')
        .split(/\n|\|/)
        .map((line) => line.split(/\s+/).filter(Boolean).map((word) => Array.from(word)))
        .filter((line) => line.length)
}

/**
 * Places letters in a pixel space world (origin at the viewport center, y up)
 * letters: [{ glyph, line, word, index }]
 */
export function layoutLetters({ letters, lineCount, viewport, fontSize, spaceWidth, tracking, maxSize, withStrings })
{
    if(!letters.length)
        return { scale: 1, unit: fontSize }

    const trackingPx = tracking * fontSize

    // Line widths
    const lines = Array.from({ length: lineCount }, () => ({ width: 0, letters: [] }))
    letters.forEach((letter) => lines[letter.line].letters.push(letter))
    lines.forEach((line) =>
    {
        line.letters.forEach((letter, i) =>
        {
            const previous = line.letters[i - 1]
            if(previous)
                line.width += previous.word === letter.word ? trackingPx : spaceWidth
            line.width += letter.glyph.advance
        })
    })

    // Vertical metrics relative to the baseline
    let top = 0
    let bottom = 0
    letters.forEach(({ glyph }) =>
    {
        top = Math.max(top, glyph.ink.y + glyph.ink.halfHeight - glyph.penY)
        bottom = Math.min(bottom, glyph.ink.y - glyph.ink.halfHeight - glyph.penY)
    })
    const lineHeight = (top - Math.min(bottom, 0)) * 1.04

    // Fit
    const isNarrow = viewport.width < 640
    const marginX = Math.max(18, viewport.width * (isNarrow ? 0.05 : 0.07))
    const marginTop = 58
    const marginBottom = 86
    const availableWidth = viewport.width - marginX * 2
    const availableHeight = Math.max(80, (viewport.height - marginTop - marginBottom) * 0.84)
    const maxLineWidth = Math.max(...lines.map((line) => line.width), 1)
    const blockHeight = top - bottom + lineHeight * (lineCount - 1) + (withStrings ? fontSize * 0.6 : 0)

    let scale = Math.min(availableWidth / maxLineWidth, availableHeight / blockHeight)
    if(maxSize > 0)
        scale = Math.min(scale, maxSize / fontSize)

    const unit = fontSize * scale

    // Place
    const blockCenterY = (marginBottom - marginTop) / 2
    const blockTop = blockCenterY + blockHeight * scale / 2

    lines.forEach((line, lineIndex) =>
    {
        const baselineY = blockTop - top * scale - lineIndex * lineHeight * scale
        let penX = - line.width * scale / 2

        line.letters.forEach((letter, i) =>
        {
            const previous = line.letters[i - 1]
            if(previous)
                penX += (previous.word === letter.word ? trackingPx : spaceWidth) * scale

            const glyph = letter.glyph
            letter.homeX = penX - glyph.penX * scale
            letter.homeY = baselineY - glyph.penY * scale + (hash(letter.index * 3.1 + 2) - 0.5) * unit * 0.03
            letter.restRot = (hash(letter.index * 7.3 + 1) - 0.5) * 0.07
            letter.inkRadius = Math.max(glyph.ink.halfWidth, glyph.ink.halfHeight) * scale

            penX += glyph.advance * scale
        })
    })

    return { scale, unit }
}
