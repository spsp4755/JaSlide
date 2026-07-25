/**
 * One source of truth for the insertable shapes and lines.
 *
 * Every `kind` is an OOXML preset geometry name (`roundRect`, `flowChartDecision`,
 * `wedgeEllipseCallout`, …), which is what the renderer feeds to
 * `MSO_SHAPE.from_xml()`. Previously the picker used app-invented names that the
 * renderer's 20-entry lookup table did not know, so 136 of the 156 shapes were
 * exported as a plain rectangle.
 *
 * `glyphPath` returns the shape's outline as an SVG path in a 0 0 100 100 box.
 * The picker draws it, and the HTML-template path draws the same one, so an icon
 * can never disagree with the shape it inserts.
 */

const points = (list: [number, number][]) =>
    list.map(([x, y], index) => `${index ? 'L' : 'M'}${round(x)} ${round(y)}`).join('') + 'Z';

const round = (value: number) => Math.round(value * 100) / 100;

/** Regular n-gon inscribed in the box, first vertex at the top. */
function polygon(sides: number, rotation = 0): string {
    return points(
        Array.from({ length: sides }, (_, index) => {
            const angle = (index / sides) * 2 * Math.PI - Math.PI / 2 + rotation;
            return [50 + 50 * Math.cos(angle), 50 + 50 * Math.sin(angle)] as [number, number];
        }),
    );
}

/** n-pointed star: outer vertices interleaved with inner ones. */
function star(tips: number, innerRatio = tips <= 5 ? 0.4 : 1 - 1.6 / tips): string {
    return points(
        Array.from({ length: tips * 2 }, (_, index) => {
            const angle = (index / (tips * 2)) * 2 * Math.PI - Math.PI / 2;
            const radius = 50 * (index % 2 ? innerRatio : 1);
            return [50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)] as [number, number];
        }),
    );
}

/** Right-pointing arrow; `rotate` turns it without a second point list. */
function arrow(rotation: number): string {
    const body: [number, number][] = [[0, 30], [58, 30], [58, 8], [100, 50], [58, 92], [58, 70], [0, 70]];
    const radians = (rotation * Math.PI) / 180;
    return points(body.map(([x, y]) => {
        const [dx, dy] = [x - 50, y - 50];
        return [50 + dx * Math.cos(radians) - dy * Math.sin(radians), 50 + dx * Math.sin(radians) + dy * Math.cos(radians)];
    }));
}

const RECT = 'M0 0L100 0L100 100L0 100Z';
const ELLIPSE = 'M50 0A50 50 0 0 1 50 100A50 50 0 0 1 50 0Z';

/** Shapes whose outline is not worth deriving from a formula. */
const PATHS: Record<string, string> = {
    rect: RECT,
    roundRect: 'M22 0L78 0Q100 0 100 22L100 78Q100 100 78 100L22 100Q0 100 0 78L0 22Q0 0 22 0Z',
    round1Rect: 'M0 0L78 0Q100 0 100 22L100 100L0 100Z',
    round2SameRect: 'M22 0L78 0Q100 0 100 22L100 100L0 100L0 22Q0 0 22 0Z',
    round2DiagRect: 'M22 0L100 0L100 78Q100 100 78 100L0 100L0 22Q0 0 22 0Z',
    snip1Rect: 'M0 0L74 0L100 26L100 100L0 100Z',
    snip2SameRect: 'M26 0L74 0L100 26L100 100L0 100L0 26Z',
    snip2DiagRect: 'M26 0L100 0L100 74L74 100L0 100L0 26Z',
    snipRoundRect: 'M26 0L74 0L100 26L100 100L0 100L0 22Q0 0 26 0Z',
    ellipse: ELLIPSE,
    triangle: polygon(3),
    rtTriangle: 'M0 0L0 100L100 100Z',
    diamond: polygon(4),
    parallelogram: points([[22, 0], [100, 0], [78, 100], [0, 100]]),
    trapezoid: points([[22, 0], [78, 0], [100, 100], [0, 100]]),
    pentagon: polygon(5),
    hexagon: polygon(6, Math.PI / 6),
    heptagon: polygon(7),
    octagon: polygon(8, Math.PI / 8),
    decagon: polygon(10),
    dodecagon: polygon(12),
    homePlate: points([[0, 0], [72, 0], [100, 50], [72, 100], [0, 100]]),
    chevron: points([[0, 0], [72, 0], [100, 50], [72, 100], [0, 100], [28, 50]]),
    plaque: 'M18 0L82 0Q82 18 100 18L100 82Q82 82 82 100L18 100Q18 82 0 82L0 18Q18 18 18 0Z',
    bevel: `${RECT}M14 14L86 14L86 86L14 86Z`,
    frame: `${RECT}M16 16L84 16L84 84L16 84Z`,
    halfFrame: 'M0 0L100 0L84 16L16 16L16 84L0 100Z',
    corner: 'M0 0L34 0L34 66L100 66L100 100L0 100Z',
    diagStripe: 'M0 100L0 60L60 0L100 0Z',
    can: 'M0 14A50 14 0 0 1 100 14L100 86A50 14 0 0 1 0 86Z',
    cube: 'M0 26L26 0L100 0L100 74L74 100L0 100Z',
    donut: `${ELLIPSE}M50 26A24 24 0 0 0 50 74A24 24 0 0 0 50 26Z`,
    pie: 'M50 50L100 50A50 50 0 1 1 15 15Z',
    chord: 'M15 15A50 50 0 1 1 85 85Z',
    arc: 'M50 0A50 50 0 0 1 100 50',
    blockArc: 'M0 50A50 50 0 0 1 100 50L74 50A24 24 0 0 0 26 50Z',
    teardrop: 'M50 0A50 50 0 0 1 100 50L100 0Z M50 0A50 50 0 0 0 50 100A50 50 0 0 0 50 0Z',
    foldedCorner: 'M0 0L100 0L100 72L72 100L0 100Z M100 72L72 72L72 100Z',
    noSmoking: `${ELLIPSE}M18 22L78 82`,
    wave: 'M0 22Q25 0 50 22Q75 44 100 22L100 78Q75 100 50 78Q25 56 0 78Z',
    doubleWave: 'M0 22Q12 4 25 22Q37 40 50 22Q62 4 75 22Q87 40 100 22L100 78Q87 96 75 78Q62 60 50 78Q37 96 25 78Q12 60 0 78Z',
    ribbon: 'M0 0L100 0L82 30L100 60L0 60L18 30Z',
    ribbon2: 'M0 60L18 30L0 0L100 0L82 30L100 60L60 60L50 78L40 60Z',
    ellipseRibbon: 'M0 10Q50 -6 100 10L82 40Q50 26 18 40Z M0 10L0 46L18 76L18 40Z M100 10L100 46L82 76L82 40Z',
    ellipseRibbon2: 'M0 90Q50 106 100 90L82 60Q50 74 18 60Z M0 90L0 54L18 24L18 60Z M100 90L100 54L82 24L82 60Z',
    horizontalScroll: 'M0 20Q0 8 12 8L100 8L100 80Q100 92 88 92L0 92Z',
    verticalScroll: 'M20 0Q8 0 8 12L8 100L80 100L80 0Z',
    heart: 'M50 100C10 68 0 46 0 28C0 10 14 0 28 0C40 0 48 8 50 16C52 8 60 0 72 0C86 0 100 10 100 28C100 46 90 68 50 100Z',
    cloud: 'M22 92Q0 92 0 72Q0 54 18 50Q14 26 38 20Q52 0 72 10Q92 6 94 30Q100 48 92 62Q92 92 70 92Z',
    sun: `M50 24A26 26 0 0 1 50 76A26 26 0 0 1 50 24Z${star(8, 0.62)}`,
    moon: 'M70 0A50 50 0 1 0 70 100A62 62 0 0 1 70 0Z',
    smileyFace: `${ELLIPSE}M32 36A5 5 0 0 1 32 46A5 5 0 0 1 32 36Z M68 36A5 5 0 0 1 68 46A5 5 0 0 1 68 36Z M26 64Q50 86 74 64`,
    lightningBolt: points([[42, 0], [78, 0], [56, 36], [80, 36], [30, 100], [44, 56], [24, 56]]),
    star4: star(4),
    star5: star(5),
    star6: star(6),
    star7: star(7),
    star8: star(8),
    star10: star(10),
    star12: star(12),
    star16: star(16),
    star24: star(24),
    star32: star(32),
    irregularSeal1: points([[38, 12], [50, 0], [58, 16], [76, 6], [76, 26], [96, 26], [86, 44], [100, 56], [82, 66], [92, 84], [70, 82], [64, 100], [50, 86], [36, 98], [30, 80], [10, 86], [16, 66], [0, 58], [14, 44], [4, 26], [24, 24], [22, 6]]),
    irregularSeal2: points([[44, 8], [56, 0], [62, 14], [80, 8], [78, 26], [96, 30], [84, 46], [100, 58], [80, 68], [90, 86], [68, 84], [62, 100], [48, 88], [34, 96], [30, 78], [10, 84], [18, 64], [0, 54], [16, 42], [6, 24], [26, 22], [26, 4]]),
    rightArrow: arrow(0),
    leftArrow: arrow(180),
    upArrow: arrow(-90),
    downArrow: arrow(90),
    leftRightArrow: points([[0, 50], [26, 14], [26, 32], [74, 32], [74, 14], [100, 50], [74, 86], [74, 68], [26, 68], [26, 86]]),
    upDownArrow: points([[50, 0], [86, 26], [68, 26], [68, 74], [86, 74], [50, 100], [14, 74], [32, 74], [32, 26], [14, 26]]),
    leftUpArrow: points([[50, 0], [78, 26], [64, 26], [64, 64], [26, 64], [26, 78], [0, 50], [26, 22], [26, 36], [36, 36], [36, 26]]),
    leftRightUpArrow: points([[50, 0], [72, 22], [60, 22], [60, 44], [78, 44], [78, 32], [100, 54], [78, 76], [78, 64], [22, 64], [22, 76], [0, 54], [22, 32], [22, 44], [40, 44], [40, 22], [28, 22]]),
    quadArrow: points([[50, 0], [72, 24], [58, 24], [58, 42], [76, 42], [76, 28], [100, 50], [76, 72], [76, 58], [58, 58], [58, 76], [72, 76], [50, 100], [28, 76], [42, 76], [42, 58], [24, 58], [24, 72], [0, 50], [24, 28], [24, 42], [42, 42], [42, 24], [28, 24]]),
    notchedRightArrow: points([[0, 30], [58, 30], [58, 8], [100, 50], [58, 92], [58, 70], [0, 70], [16, 50]]),
    stripedRightArrow: `M0 30L8 30L8 70L0 70Z M14 30L22 30L22 70L14 70Z M30 30L58 30L58 8L100 50L58 92L58 70L30 70Z`,
    bentArrow: 'M0 100L0 52Q0 24 28 24L64 24L64 4L100 34L64 64L64 44L28 44Q20 44 20 56L20 100Z',
    bentUpArrow: 'M0 68L0 96L64 96L64 30L82 30L50 0L18 30L36 30L36 68Z',
    uturnArrow: 'M0 100L0 40Q0 8 34 8Q68 8 68 40L68 66L86 66L52 100L18 66L36 66L36 40Q36 34 28 34Q20 34 20 40L20 100Z',
    curvedRightArrow: 'M0 8Q60 8 74 50L96 44L82 92L44 62L66 56Q54 26 0 26Z',
    curvedLeftArrow: 'M100 8Q40 8 26 50L4 44L18 92L56 62L34 56Q46 26 100 26Z',
    curvedUpArrow: 'M8 100Q8 40 50 26L44 4L92 18L62 56L56 34Q26 46 26 100Z',
    curvedDownArrow: 'M8 0Q8 60 50 74L44 96L92 82L62 44L56 66Q26 54 26 0Z',
    circularArrow: 'M78 22A38 38 0 1 0 92 56L74 56L88 26L100 56L92 56A46 46 0 1 1 84 16Z',
    mathPlus: points([[38, 0], [62, 0], [62, 38], [100, 38], [100, 62], [62, 62], [62, 100], [38, 100], [38, 62], [0, 62], [0, 38], [38, 38]]),
    plus: points([[30, 0], [70, 0], [70, 30], [100, 30], [100, 70], [70, 70], [70, 100], [30, 100], [30, 70], [0, 70], [0, 30], [30, 30]]),
    mathMinus: 'M0 40L100 40L100 60L0 60Z',
    mathMultiply: points([[18, 4], [50, 36], [82, 4], [96, 18], [64, 50], [96, 82], [82, 96], [50, 64], [18, 96], [4, 82], [36, 50], [4, 18]]),
    mathDivide: 'M42 6A8 8 0 0 1 58 6A8 8 0 0 1 42 6Z M0 42L100 42L100 58L0 58Z M42 94A8 8 0 0 1 58 94A8 8 0 0 1 42 94Z',
    mathEqual: 'M0 26L100 26L100 42L0 42Z M0 58L100 58L100 74L0 74Z',
    mathNotEqual: 'M0 26L100 26L100 42L0 42Z M0 58L100 58L100 74L0 74Z M36 96L64 4',
    leftBrace: 'M60 0Q40 0 40 22L40 40Q40 50 20 50Q40 50 40 60L40 78Q40 100 60 100',
    rightBrace: 'M40 0Q60 0 60 22L60 40Q60 50 80 50Q60 50 60 60L60 78Q60 100 40 100',
    bracePair: 'M34 0Q18 0 18 22L18 40Q18 50 2 50Q18 50 18 60L18 78Q18 100 34 100 M66 0Q82 0 82 22L82 40Q82 50 98 50Q82 50 82 60L82 78Q82 100 66 100',
    leftBracket: 'M62 0L38 0L38 100L62 100',
    rightBracket: 'M38 0L62 0L62 100L38 100',
    bracketPair: 'M34 0L14 0L14 100L34 100 M66 0L86 0L86 100L66 100',
    wedgeRectCallout: `M0 0L100 0L100 72L58 72L44 100L40 72L0 72Z`,
    wedgeRoundRectCallout: 'M16 0L84 0Q100 0 100 16L100 56Q100 72 84 72L58 72L44 100L40 72L16 72Q0 72 0 56L0 16Q0 0 16 0Z',
    wedgeEllipseCallout: 'M50 0A50 36 0 0 1 50 72L48 72L30 100L34 68A50 36 0 0 1 50 0Z',
    cloudCallout: 'M26 68Q6 68 6 50Q6 34 22 30Q18 8 40 4Q52 -8 70 2Q88 -2 90 20Q100 34 92 48Q92 68 72 68Z M30 76A7 7 0 0 1 30 90A7 7 0 0 1 30 76Z M16 90A5 5 0 0 1 16 100A5 5 0 0 1 16 90Z',
    rightArrowCallout: 'M0 0L64 0L64 22L78 22L100 50L78 78L64 78L64 100L0 100Z',
    leftArrowCallout: 'M100 0L36 0L36 22L22 22L0 50L22 78L36 78L36 100L100 100Z',
    upArrowCallout: 'M0 100L0 36L22 36L22 22L50 0L78 22L78 36L100 36L100 100Z',
    downArrowCallout: 'M0 0L0 64L22 64L22 78L50 100L78 78L78 64L100 64L100 0Z',
    leftRightArrowCallout: 'M22 0L78 0L78 22L86 22L100 50L86 78L78 78L78 100L22 100L22 78L14 78L0 50L14 22L22 22Z',
    quadArrowCallout: 'M28 28L28 14L50 0L72 14L72 28L86 28L100 50L86 72L72 72L72 86L50 100L28 86L28 72L14 72L0 50L14 28Z',
    flowChartProcess: RECT,
    flowChartAlternateProcess: 'M20 0L80 0Q100 0 100 20L100 80Q100 100 80 100L20 100Q0 100 0 80L0 20Q0 0 20 0Z',
    flowChartDecision: polygon(4),
    flowChartInputOutput: points([[22, 0], [100, 0], [78, 100], [0, 100]]),
    flowChartPredefinedProcess: `${RECT}M14 0L14 100 M86 0L86 100`,
    flowChartInternalStorage: `${RECT}M0 16L100 16 M16 0L16 100`,
    flowChartDocument: 'M0 0L100 0L100 84Q75 68 50 84Q25 100 0 84Z',
    flowChartMultidocument: 'M0 10L84 10L84 78Q63 64 42 78Q21 92 0 78Z M8 4L92 4L92 68 M16 0L100 0L100 60',
    flowChartTerminator: 'M26 0L74 0A26 50 0 0 1 74 100L26 100A26 50 0 0 1 26 0Z',
    flowChartPreparation: points([[22, 0], [78, 0], [100, 50], [78, 100], [22, 100], [0, 50]]),
    flowChartManualInput: 'M0 22L100 0L100 100L0 100Z',
    flowChartManualOperation: points([[0, 0], [100, 0], [78, 100], [22, 100]]),
    flowChartConnector: ELLIPSE,
    flowChartOffpageConnector: points([[0, 0], [100, 0], [100, 74], [50, 100], [0, 74]]),
    flowChartPunchedCard: points([[22, 0], [100, 0], [100, 100], [0, 100], [0, 22]]),
    flowChartPunchedTape: 'M0 14Q25 -6 50 14Q75 34 100 14L100 86Q75 106 50 86Q25 66 0 86Z',
    flowChartSummingJunction: `${ELLIPSE}M15 15L85 85 M85 15L15 85`,
    flowChartOr: `${ELLIPSE}M50 0L50 100 M0 50L100 50`,
    flowChartCollate: 'M0 0L100 0L50 50L100 100L0 100L50 50Z',
    flowChartSort: 'M50 0L100 50L50 100L0 50Z M0 50L100 50',
    flowChartExtract: polygon(3),
    flowChartMerge: 'M0 0L100 0L50 100Z',
    flowChartOnlineStorage: 'M14 0L100 0A22 50 0 0 0 100 100L14 100A22 50 0 0 1 14 0Z',
    flowChartMagneticTape: `${ELLIPSE}M62 88L100 88L100 100L54 100Z`,
    flowChartMagneticDisk: 'M0 14A50 14 0 0 1 100 14L100 86A50 14 0 0 1 0 86Z M0 14A50 14 0 0 0 100 14',
    flowChartMagneticDrum: 'M14 0A14 50 0 0 0 14 100L86 100A14 50 0 0 0 86 0Z M86 0A14 50 0 0 1 86 100',
    flowChartDisplay: 'M0 50L18 0L82 0A34 50 0 0 1 82 100L18 100Z',
    flowChartDelay: 'M0 0L60 0A50 50 0 0 1 60 100L0 100Z',
    flowChartOfflineStorage: `${polygon(3)}M22 66L78 66`,
};

export const SHAPE_GROUPS: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
    ['기본 도형', [
        ['rect', '사각형'], ['roundRect', '둥근 사각형'], ['round1Rect', '한쪽 둥근 사각형'], ['round2SameRect', '위쪽 둥근 사각형'], ['round2DiagRect', '대각 둥근 사각형'],
        ['snip1Rect', '한쪽 잘린 사각형'], ['snip2SameRect', '위쪽 잘린 사각형'], ['snip2DiagRect', '대각 잘린 사각형'], ['snipRoundRect', '잘리고 둥근 사각형'],
        ['ellipse', '타원'], ['triangle', '삼각형'], ['rtTriangle', '직각 삼각형'], ['diamond', '마름모'], ['parallelogram', '평행사변형'], ['trapezoid', '사다리꼴'],
        ['pentagon', '오각형'], ['hexagon', '육각형'], ['heptagon', '칠각형'], ['octagon', '팔각형'], ['decagon', '십각형'], ['dodecagon', '십이각형'],
        ['homePlate', '오각 화살표'], ['chevron', '갈매기표'], ['plaque', '명판'], ['bevel', '입체 사각형'], ['frame', '액자'], ['halfFrame', '반 액자'], ['corner', 'ㄴ자 모서리'],
        ['diagStripe', '대각선 띠'], ['can', '원통'], ['cube', '정육면체'], ['donut', '도넛'], ['pie', '부채꼴'], ['chord', '활 모양'], ['arc', '호'], ['blockArc', '두꺼운 호'],
        ['teardrop', '물방울'], ['foldedCorner', '접힌 모서리'], ['noSmoking', '금지 표시'], ['wave', '물결'], ['doubleWave', '이중 물결'],
        ['ribbon', '아래 리본'], ['ribbon2', '위 리본'], ['ellipseRibbon', '휘어진 리본'], ['ellipseRibbon2', '휘어진 아래 리본'],
        ['horizontalScroll', '가로 두루마리'], ['verticalScroll', '세로 두루마리'],
        ['heart', '하트'], ['cloud', '구름'], ['sun', '해'], ['moon', '달'], ['smileyFace', '웃는 얼굴'], ['lightningBolt', '번개'],
        ['star4', '별 4각'], ['star5', '별 5각'], ['star6', '별 6각'], ['star7', '별 7각'], ['star8', '별 8각'], ['star10', '별 10각'], ['star12', '별 12각'], ['star16', '별 16각'], ['star24', '별 24각'], ['star32', '별 32각'],
        ['irregularSeal1', '폭발 1'], ['irregularSeal2', '폭발 2'],
    ]],
    ['화살표', [
        ['rightArrow', '오른쪽 화살표'], ['leftArrow', '왼쪽 화살표'], ['upArrow', '위쪽 화살표'], ['downArrow', '아래쪽 화살표'],
        ['leftRightArrow', '좌우 화살표'], ['upDownArrow', '위아래 화살표'], ['leftUpArrow', '왼쪽 위 화살표'], ['leftRightUpArrow', '좌우 위 화살표'], ['quadArrow', '사방 화살표'],
        ['notchedRightArrow', '홈 화살표'], ['stripedRightArrow', '줄무늬 화살표'],
        ['bentArrow', '꺾인 화살표'], ['bentUpArrow', '위로 꺾인 화살표'], ['uturnArrow', 'U턴 화살표'],
        ['curvedRightArrow', '굽은 오른쪽 화살표'], ['curvedLeftArrow', '굽은 왼쪽 화살표'], ['curvedUpArrow', '굽은 위쪽 화살표'], ['curvedDownArrow', '굽은 아래쪽 화살표'],
        ['circularArrow', '원형 화살표'],
    ]],
    ['설명선', [
        ['wedgeRectCallout', '사각 말풍선'], ['wedgeRoundRectCallout', '둥근 말풍선'], ['wedgeEllipseCallout', '타원 말풍선'], ['cloudCallout', '구름 말풍선'],
        ['rightArrowCallout', '오른쪽 화살표 설명선'], ['leftArrowCallout', '왼쪽 화살표 설명선'], ['upArrowCallout', '위쪽 화살표 설명선'], ['downArrowCallout', '아래쪽 화살표 설명선'],
        ['leftRightArrowCallout', '좌우 화살표 설명선'], ['quadArrowCallout', '사방 화살표 설명선'],
    ]],
    ['순서도', [
        ['flowChartProcess', '처리'], ['flowChartAlternateProcess', '대체 처리'], ['flowChartDecision', '판단'], ['flowChartInputOutput', '데이터'],
        ['flowChartPredefinedProcess', '미리 정의된 처리'], ['flowChartInternalStorage', '내부 저장소'], ['flowChartDocument', '문서'], ['flowChartMultidocument', '여러 문서'],
        ['flowChartTerminator', '시작/종료'], ['flowChartPreparation', '준비'], ['flowChartManualInput', '수동 입력'], ['flowChartManualOperation', '수동 작업'],
        ['flowChartConnector', '연결자'], ['flowChartOffpageConnector', '다른 페이지 연결자'], ['flowChartPunchedCard', '카드'], ['flowChartPunchedTape', '천공 테이프'],
        ['flowChartSummingJunction', '논리합'], ['flowChartOr', '논리곱'], ['flowChartCollate', '분류'], ['flowChartSort', '정렬'], ['flowChartExtract', '추출'], ['flowChartMerge', '병합'],
        ['flowChartOnlineStorage', '저장 데이터'], ['flowChartMagneticTape', '순차 접근 저장소'], ['flowChartMagneticDisk', '자성 디스크'], ['flowChartMagneticDrum', '직접 접근 저장소'],
        ['flowChartDisplay', '표시'], ['flowChartDelay', '지연'], ['flowChartOfflineStorage', '오프라인 저장소'],
    ]],
    ['수식', [
        ['mathPlus', '더하기'], ['mathMinus', '빼기'], ['mathMultiply', '곱하기'], ['mathDivide', '나누기'], ['mathEqual', '등호'], ['mathNotEqual', '부등호'],
        ['plus', '십자'], ['leftBrace', '왼쪽 중괄호'], ['rightBrace', '오른쪽 중괄호'], ['bracePair', '중괄호 쌍'],
        ['leftBracket', '왼쪽 대괄호'], ['rightBracket', '오른쪽 대괄호'], ['bracketPair', '대괄호 쌍'],
    ]],
] as const;

/**
 * Lines. `connector` is the MSO_CONNECTOR the renderer uses; `head`/`tail` become
 * arrowheads and `dash` becomes a preset dash, so the exported PPTX matches the icon.
 */
export const LINE_OPTIONS: readonly { kind: string; label: string; glyph: string }[] = [
    { kind: 'straightLine', label: '선', glyph: 'M4 96L96 4' },
    { kind: 'arrowLine', label: '화살표', glyph: 'M4 96L96 4 M96 4L70 10 M96 4L90 30' },
    { kind: 'doubleArrowLine', label: '양쪽 화살표', glyph: 'M4 96L96 4 M96 4L70 10 M96 4L90 30 M4 96L30 90 M4 96L10 70' },
    { kind: 'dashedLine', label: '파선', glyph: 'M4 96L26 74 M40 60L62 38 M76 24L96 4' },
    { kind: 'dottedLine', label: '점선', glyph: 'M4 96L10 90 M22 78L28 72 M40 60L46 54 M58 42L64 36 M76 24L82 18 M92 8L96 4' },
    { kind: 'elbowConnector', label: '꺾인 연결선', glyph: 'M4 96L4 50L96 50L96 4' },
    { kind: 'elbowArrowConnector', label: '꺾인 화살표 연결선', glyph: 'M4 96L4 50L96 50L96 4 M96 4L86 24 M96 4L106 24' },
    { kind: 'curvedConnector', label: '곡선 연결선', glyph: 'M4 96Q4 50 50 50Q96 50 96 4' },
    { kind: 'curvedArrowConnector', label: '곡선 화살표 연결선', glyph: 'M4 96Q4 50 50 50Q96 50 96 4 M96 4L86 24 M96 4L106 24' },
];

const LINE_GLYPHS = new Map(LINE_OPTIONS.map((line) => [line.kind, line.glyph]));

/** Outline of `kind` as an SVG path in a 0 0 100 100 box. */
export function glyphPath(kind: string): string {
    return LINE_GLYPHS.get(kind) || PATHS[kind] || RECT;
}

/** True when `kind` is drawn as a stroke rather than a filled outline. */
export function isStrokeOnly(kind: string): boolean {
    return LINE_GLYPHS.has(kind) || ['arc', 'leftBrace', 'rightBrace', 'bracePair', 'leftBracket', 'rightBracket', 'bracketPair'].includes(kind);
}

/** Inline SVG for the HTML-template insert path — same geometry as the icon. */
export function shapeSvgMarkup(kind: string, width: number, height: number, fill = '#FFFFFF', stroke = '#202124'): string {
    const stroked = isStrokeOnly(kind);
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
        + `<path d="${glyphPath(kind)}" fill="${stroked ? 'none' : fill}" stroke="${stroke}" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>`;
}
