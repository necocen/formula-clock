"""Create IN-MEMORY SVG glyph data from local STIX Two fonts for offline tests.

This is a MathJax 3 compatibility fixture, not the production font loader.
The shipped clock uses MathJax 4's own STIX2 font set and \\oldstyle variant.
No fonts or generated glyph tables are bundled or copied into the app.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen


def substitutions(font, tag):
    mapping = {}
    for record in font['GSUB'].table.FeatureList.FeatureRecord:
        if record.FeatureTag != tag:
            continue
        for index in record.Feature.LookupListIndex:
            for sub in font['GSUB'].table.LookupList.Lookup[index].SubTable:
                while hasattr(sub, 'ExtSubTable'):
                    sub = sub.ExtSubTable
                mapping.update(getattr(sub, 'mapping', {}))
    return mapping


def data_for(font, char, variant=None):
    name = font.getBestCmap()[char]
    if variant:
        name = variant.get(name, name)
    glyphs = font.getGlyphSet()
    glyph = glyphs[name]
    scale = 1000 / font['head'].unitsPerEm
    path = SVGPathPen(glyphs)
    bounds = BoundsPen(glyphs)
    glyph.draw(TransformPen(path, (scale, 0, 0, scale, 0, 0)))
    glyph.draw(TransformPen(bounds, (scale, 0, 0, scale, 0, 0)))
    x0, y0, x1, y1 = bounds.bounds
    commands = path.getCommands()
    assert commands[0] == 'M'
    # MathJax's path option excludes the initial M and final Z.
    return [y1/1000, -y0/1000, glyph.width*scale/1000,
            {'p': commands[1:].rstrip('Zz')}]


def make_fixture(directory):
    directory = Path(directory)
    text = TTFont(directory/'STIXTwoText-Regular.otf')
    math = TTFont(directory/'STIXTwoMath-Regular.otf')
    oldstyle = substitutions(text, 'onum')
    assert all(text.getBestCmap()[char] in oldstyle for char in range(48, 58))
    chars = list(range(48, 58)) + [0x21, 0x28, 0x29, 0x2B, 0x3A, 0x3D, 0xD7, 0xF7, 0x2212, 0x221A]
    return {
        'normal': {str(c): data_for(math, c) for c in chars},
        'oldstyle': {str(c): data_for(text, c, oldstyle) for c in range(48, 58)},
        'axis': math['MATH'].table.MathConstants.AxisHeight.Value / math['head'].unitsPerEm,
        'fontVersion': text['name'].getDebugName(5),
    }
