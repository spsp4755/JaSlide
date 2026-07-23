'use client';

import { useEffect, useState, useCallback, useRef, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Button } from '@/components/ui/button';
import { useEditorStore } from '@/stores/editor-store';
import { useAuthStore } from '@/stores/auth-store';
import { presentationsApi, slidesApi, exportApi, generationApi, templatesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { UndoRedoButtons } from '@/components/editor/undo-redo-buttons';
import { VersionHistory } from '@/components/editor/version-history';
import { CommentsPanel } from '@/components/editor/comments-panel';
import { SaveStatusIndicator } from '@/components/editor/save-status-indicator';
import { SlideThumbnail } from '@/components/editor/slide-thumbnail';
import { SlideTemplatesDialog } from '@/components/editor/slide-templates-dialog';
import {
    ArrowLeft,
    Save,
    Download,
    Share2,
    Plus,
    Trash2,
    Copy,
    MoreVertical,
    Sparkles,
    Layout,
    Type,
    List,
    Image as ImageIcon,
    BarChart2,
    Quote,
    History,
    MessageSquare,
    X,
    Link as LinkIcon,
    FileText,
    FileSpreadsheet,
    Loader2,
    Bold,
    Italic,
    Underline,
    Strikethrough,
    AlignLeft,
    AlignCenter,
    AlignRight,
    ListOrdered,
    Table2,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
} from 'lucide-react';

// Slide type icons mapping
const slideTypeIcons: Record<string, any> = {
    TITLE: Type,
    CONTENT: Layout,
    BULLET_LIST: List,
    TWO_COLUMN: Layout,
    IMAGE: ImageIcon,
    CHART: BarChart2,
    QUOTE: Quote,
    SECTION_HEADER: Type,
};

function resolveTemplateValue(value: string | undefined, html: string): string | undefined {
    const variables = Object.fromEntries([...html.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map(([, name, value]) => [name, value.trim()]));
    return value?.replace(/var\((--[\w-]+)\)/g, (_, name) => variables[name] || _).trim();
}

function getTemplatePreviewStyle(template: any): CSSProperties {
    const config = template?.config || {};
    const html = config.htmlTemplate || '';
    const background = resolveTemplateValue(config.colors?.background || html.match(/background(?:-color)?\s*:\s*([^;}]+)/)?.[1], html);
    const color = resolveTemplateValue(config.colors?.text || html.match(/(?:^|[;\s])color\s*:\s*([^;}]+)/)?.[1], html);
    const fontFamily = resolveTemplateValue(config.typography?.titleFont || html.match(/font-family\s*:\s*([^;}]+)/)?.[1], html);
    return { backgroundColor: background, color, fontFamily };
}

function resolveAiEditTargets(instruction: string, slides: Array<{ id: string }>): string[] {
    const numbers = new Set<number>();
    for (const match of instruction.matchAll(/(\d+)\s*[~〜-]\s*(\d+)\s*(?:번|페이지|슬라이드)?/g)) {
        const [start, end] = [Number(match[1]), Number(match[2])].sort((a, b) => a - b);
        for (let number = start; number <= end; number += 1) numbers.add(number);
    }
    for (const match of instruction.matchAll(/(\d+)\s*(?:번\s*(?:슬라이드)?|페이지|슬라이드)/g)) numbers.add(Number(match[1]));
    const ids = [...numbers].map((number) => slides[number - 1]?.id).filter((id): id is string => Boolean(id));
    return ids.length ? ids : slides.map((slide) => slide.id);
}

function htmlTextElements(document: Document): HTMLElement[] {
    const objectSelector = '[data-object="true"]';
    const objects = Array.from(document.querySelectorAll<HTMLElement>(objectSelector))
        .flatMap((element) => {
            if (element.dataset.objectType === 'shape' || element.dataset.objectType === 'image') return [element];
            const cells = Array.from(element.querySelectorAll<HTMLElement>('th, td')).filter((cell) => !!cell.textContent?.trim());
            return element.dataset.objectType === 'table' ? [element, ...cells] : cells.length ? cells : [element];
        })
        .filter((element) => (element.dataset.objectType === 'shape' || element.dataset.objectType === 'image' || !!element.textContent?.trim()) && !element.querySelector('[data-object="true"]'));
    const editableTextSelector = 'h1,h2,h3,h4,h5,h6,p,li,th,td,span,div';
    const generatedText = Array.from(document.querySelectorAll<HTMLElement>(editableTextSelector))
        .filter((element) => !element.closest(objectSelector) && !!element.textContent?.trim())
        .filter((element) => !element.querySelector(editableTextSelector));
    return [...objects, ...generatedText];
}

function getHtmlTextFields(html: string) {
    return htmlTextElements(new DOMParser().parseFromString(html, 'text/html')).map((element) => ({
        text: element.textContent?.trim() || '',
        left: element.style.left || '0',
        top: element.style.top || '0',
        width: element.style.width || '640',
        height: element.style.height || element.style.minHeight || '64',
        positionable: element.dataset.object === 'true',
        generated: element.dataset.object !== 'true',
        objectType: element.dataset.objectType || 'textbox',
        fontFamily: element.style.fontFamily || '', fontSize: element.style.fontSize || '24', color: element.style.color || '#1A1A1A',
        backgroundColor: element.style.backgroundColor || '#ffffff', borderColor: element.style.borderColor || '#000000',
        borderWidth: element.style.borderWidth || '0', textAlign: element.style.textAlign || 'left',
        fontWeight: element.style.fontWeight || '400', fontStyle: element.style.fontStyle || 'normal', textDecoration: element.style.textDecoration || 'none',
    }));
}

function getHtmlSelectionAreas(html: string) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const fields = htmlTextElements(document);
    return fields.map((element, index) => ({
        index,
        left: element.style.left || '0', top: element.style.top || '0',
        width: element.style.width || '0', height: element.style.height || '0',
    })).filter((area) => fields[area.index].dataset.object === 'true');
}

function updateHtmlObject(html: string, index: number, updates: Record<string, string | undefined>): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const element = htmlTextElements(document)[index];
    if (!element) return html;
    if (updates.text !== undefined) {
        element.replaceChildren(...updates.text.split('\n').flatMap((line, lineIndex) => lineIndex ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)]));
    }
    if (updates.left !== undefined) element.style.left = `${updates.left}px`;
    if (updates.top !== undefined) element.style.top = `${updates.top}px`;
    if (updates.width !== undefined) element.style.width = `${updates.width}px`;
    if (updates.height !== undefined) element.style.height = `${updates.height}px`;
    if (updates.fontFamily !== undefined) element.style.fontFamily = updates.fontFamily;
    if (updates.fontSize !== undefined) {
        const size = `${Math.max(1, Number(updates.fontSize) || 24)}px`;
        element.style.setProperty('font-size', size, 'important');
        element.querySelectorAll<HTMLElement>('*').forEach((child) => child.style.setProperty('font-size', size, 'important'));
    }
    if (updates.color !== undefined) element.style.color = updates.color;
    if (updates.backgroundColor !== undefined) element.style.backgroundColor = updates.backgroundColor;
    if (updates.borderColor !== undefined) element.style.borderColor = updates.borderColor;
    if (updates.borderWidth !== undefined) { element.style.borderStyle = 'solid'; element.style.borderWidth = `${updates.borderWidth}px`; }
    if (updates.textAlign !== undefined) element.style.textAlign = updates.textAlign;
    if (updates.fontWeight !== undefined) element.style.fontWeight = updates.fontWeight;
    if (updates.fontStyle !== undefined) element.style.fontStyle = updates.fontStyle;
    if (updates.textDecoration !== undefined) element.style.textDecoration = updates.textDecoration;
    if (updates.listStyleType !== undefined) element.style.listStyleType = updates.listStyleType;
    return document.documentElement.outerHTML;
}

function updateHtmlText(html: string, index: number, updates: Record<string, string | undefined>): string { return updateHtmlObject(html, index, updates); }

function editorFrameHtml(html: string): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll('script, iframe, object, embed').forEach((element) => element.remove());
    htmlTextElements(document).forEach((element, index) => element.dataset.taeslideEditorIndex = String(index));
    document.querySelectorAll<HTMLElement>('*').forEach((element) => {
        for (const attribute of [...element.attributes]) if (attribute.name.startsWith('on')) element.removeAttribute(attribute.name);
    });
    return `<!doctype html>${document.documentElement.outerHTML}`;
}

function addHtmlText(html: string): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const container = document.querySelector('.slide-container') || document.body;
    const element = document.createElement('div');
    element.dataset.object = 'true';
    element.dataset.objectType = 'textbox';
    element.style.cssText = 'position:absolute;left:120px;top:120px;width:640px;min-height:64px;font-size:32px;color:#1A1A1A;z-index:100';
    element.textContent = '새 텍스트';
    container.append(element);
    return document.documentElement.outerHTML;
}

const EDITOR_COLORS = ['#111827', '#374151', '#6B7280', '#FFFFFF', '#DC2626', '#EA580C', '#D97706', '#16A34A', '#2563EB', '#4F46E5', '#9333EA', '#DB2777'];
const ALL_SHAPE_GROUPS = [
    ['기본 도형', [['rectangle', '사각형'], ['rounded', '둥근 사각형'], ['round1Rectangle', '한쪽 둥근 사각형'], ['round2DiagonalRectangle', '대각 둥근 사각형'], ['round2SameRectangle', '양쪽 둥근 사각형'], ['snip1Rectangle', '한쪽 잘린 사각형'], ['snip2DiagonalRectangle', '대각 잘린 사각형'], ['snip2SameRectangle', '양쪽 잘린 사각형'], ['snipRoundRectangle', '잘린 둥근 사각형'], ['ellipse', '타원'], ['arc', '호'], ['blockArc', '블록 호'], ['triangle', '삼각형'], ['rightTriangle', '직각 삼각형'], ['diamond', '마름모'], ['trapezoid', '사다리꼴'], ['parallelogram', '평행사변형'], ['pentagon', '오각형'], ['hexagon', '육각형'], ['heptagon', '칠각형'], ['octagon', '팔각형'], ['decagon', '십각형'], ['dodecagon', '십이각형'], ['donut', '도넛'], ['pie', '파이'], ['chord', '현'], ['plaque', '명판'], ['bevel', '베벨'], ['can', '원통'], ['cube', '큐브'], ['frame', '프레임'], ['halfFrame', '반 프레임'], ['foldedCorner', '접힌 모서리'], ['corner', '모서리']]],
    ['화살표', [['arrow', '오른쪽 화살표'], ['leftArrow', '왼쪽 화살표'], ['upArrow', '위 화살표'], ['downArrow', '아래 화살표'], ['leftRightArrow', '양방향 화살표'], ['leftRightUpArrow', '좌우 위 화살표'], ['leftUpArrow', '왼쪽 위 화살표'], ['upDownArrow', '상하 화살표'], ['quadArrow', '사방 화살표'], ['bentArrow', '꺾인 화살표'], ['bentUpArrow', '위로 꺾인 화살표'], ['uturnArrow', 'U턴 화살표'], ['curvedLeftArrow', '곡선 왼쪽 화살표'], ['curvedRightArrow', '곡선 오른쪽 화살표'], ['curvedUpArrow', '곡선 위 화살표'], ['curvedDownArrow', '곡선 아래 화살표'], ['notchedRightArrow', '홈 화살표'], ['stripedRightArrow', '줄무늬 화살표'], ['arrowEast', '동쪽 화살표'], ['arrowNorthEast', '북동 화살표'], ['arrowNorth', '북쪽 화살표'], ['downArrowCallout', '아래 화살표 설명선'], ['leftArrowCallout', '왼쪽 화살표 설명선'], ['leftRightArrowCallout', '양방향 화살표 설명선'], ['quadArrowCallout', '사방 화살표 설명선'], ['rightArrowCallout', '오른쪽 화살표 설명선'], ['upArrowCallout', '위 화살표 설명선']]],
    ['설명·기호', [['cloud', '구름'], ['cloudCallout', '구름 설명선'], ['heart', '하트'], ['smileyFace', '스마일'], ['sun', '태양'], ['moon', '달'], ['lightningBolt', '번개'], ['star4', '4각 별'], ['star5', '5각 별'], ['star6', '6각 별'], ['star7', '7각 별'], ['star8', '8각 별'], ['star10', '10각 별'], ['star12', '12각 별'], ['star16', '16각 별'], ['star24', '24각 별'], ['star32', '32각 별'], ['irregularSeal1', '불규칙 인장 1'], ['irregularSeal2', '불규칙 인장 2'], ['starburst', '별 폭발'], ['speech', '말풍선'], ['wedgeRectangleCallout', '사각 말풍선'], ['wedgeRoundRectangleCallout', '둥근 말풍선'], ['wedgeEllipseCallout', '타원 말풍선'], ['bracePair', '중괄호 쌍'], ['bracketPair', '대괄호 쌍'], ['leftBrace', '왼쪽 중괄호'], ['rightBrace', '오른쪽 중괄호'], ['leftBracket', '왼쪽 대괄호'], ['rightBracket', '오른쪽 대괄호'], ['horizontalScroll', '가로 스크롤'], ['verticalScroll', '세로 스크롤'], ['ellipseRibbon', '타원 리본'], ['ellipseRibbon2', '타원 리본 2']]],
    ['순서도', [['flowChartProcess', '프로세스'], ['flowChartAlternateProcess', '대체 프로세스'], ['flowChartCollate', '수합'], ['flowChartDecision', '결정'], ['flowChartData', '데이터'], ['flowChartDocument', '문서'], ['flowChartMultidocument', '다중 문서'], ['flowChartExtract', '추출'], ['flowChartTerminator', '시작/끝'], ['flowChartPreparation', '준비'], ['flowChartManualInput', '수동 입력'], ['flowChartManualOperation', '수동 작업'], ['flowChartPredefinedProcess', '서브프로세스'], ['flowChartConnector', '커넥터'], ['flowChartOffpageConnector', '오프페이지 커넥터'], ['flowChartDelay', '지연'], ['flowChartDisplay', '표시'], ['flowChartMerge', '병합'], ['flowChartOr', 'OR'], ['flowChartSort', '정렬'], ['flowChartSummingJunction', '합류'], ['flowChartInternalStorage', '내부 저장소'], ['flowChartOnlineStorage', '온라인 저장소'], ['flowChartOfflineStorage', '오프라인 저장소'], ['flowChartMagneticDisk', '자기 디스크'], ['flowChartMagneticDrum', '자기 드럼'], ['flowChartMagneticTape', '자기 테이프'], ['flowChartPunchedCard', '천공 카드'], ['flowChartPunchedTape', '천공 테이프']]],
    ['수식·기타', [['mathPlus', '더하기'], ['plus', '플러스'], ['mathMinus', '빼기'], ['mathMultiply', '곱하기'], ['mathDivide', '나누기'], ['mathEqual', '같음'], ['mathNotEqual', '같지 않음'], ['diagonalStripe', '대각선 띠'], ['homePlate', '홈 플레이트'], ['ribbon', '리본'], ['ribbon2', '리본 2'], ['wave', '물결'], ['doubleWave', '이중 물결'], ['teardrop', '물방울'], ['noSmoking', '금지'], ['custom', '사용자 정의']]],
] as const;
const SHAPE_GROUPS = ALL_SHAPE_GROUPS;
const LINE_OPTIONS = [
    ['straightLine', '직선'], ['arrowLine', '화살표 선'], ['doubleArrowLine', '양방향 화살표 선'],
    ['elbowConnector', '꺾은 연결선'], ['bentConnector2', '꺾은 연결선 2'], ['bentConnector3', '꺾은 연결선 3'], ['bentConnector4', '꺾은 연결선 4'], ['bentConnector5', '꺾은 연결선 5'], ['elbowArrowConnector', '꺾은 화살표 연결선'],
    ['curvedConnector2', '곡선 연결선 2'], ['curvedConnector3', '곡선 연결선 3'], ['curvedConnector4', '곡선 연결선 4'], ['curvedConnector5', '곡선 연결선 5'], ['curvedArrowConnector', '곡선 화살표 연결선'],
    ['dashedLine', '점선'], ['dottedLine', '점선(원형)'],
] as const;

function shapeStyle(kind: string) {
    const ink = '#202124';
    if (kind.includes('Connector')) return kind.startsWith('curved') ? `width:420px;height:180px;border:8px solid ${ink};border-left:0;border-bottom:0;border-radius:0 180px 0 0;background:transparent;` : `width:420px;height:160px;border:8px solid ${ink};border-left:0;border-bottom:0;background:transparent;`;
    if (/dashedLine|dottedLine/.test(kind)) return `width:420px;height:0;border-top:8px ${kind === 'dottedLine' ? 'dotted' : 'dashed'} ${ink};background:transparent;`;
    if (kind === 'straightLine' || kind === 'straightConnector') return `width:420px;height:0;border-top:8px solid ${ink};background:transparent;`;
    if (/arrowLine|ArrowConnector|doubleArrowLine/.test(kind)) return `width:420px;height:0;border-top:8px solid ${ink};background:transparent;`;
    if (kind === 'leftRightArrow') return `width:360px;height:180px;background:${ink};clip-path:polygon(0 50%,24% 0,24% 30%,76% 30%,76% 0,100% 50%,76% 100%,76% 70%,24% 70%,24% 100%);`;
    if (kind === 'arrow' || /Arrow$/.test(kind)) return `width:360px;height:180px;background:${ink};clip-path:polygon(0 32%,62% 32%,62% 0,100% 50%,62% 100%,62% 68%,0 68%);${kind.includes('left') || kind.includes('Left') ? 'transform:scaleX(-1);' : kind.includes('up') || kind.includes('Up') ? 'transform:rotate(-90deg);' : kind.includes('down') || kind.includes('Down') ? 'transform:rotate(90deg);' : ''}`;
    if (/ellipse|donut|pie|chord|moon|sun|smiley|connector|or$|disk|drum/i.test(kind)) return `width:220px;height:220px;background:#fff;border:3px solid ${ink};border-radius:50%;`;
    if (/diamond|decision|merge|sort|homePlate/i.test(kind)) return `width:220px;height:220px;background:#fff;box-shadow:inset 0 0 0 3px ${ink};clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);`;
    if (/triangle|offpage|preparation/i.test(kind)) return `width:260px;height:220px;background:#fff;box-shadow:inset 0 0 0 3px ${ink};clip-path:polygon(50% 0,100% 100%,0 100%);`;
    if (/trapezoid|parallelogram|inputOutput|manualInput/i.test(kind)) return `width:320px;height:180px;background:#fff;box-shadow:inset 0 0 0 3px ${ink};clip-path:polygon(14% 0,100% 0,86% 100%,0 100%);`;
    if (/pentagon/i.test(kind)) return `width:240px;height:220px;background:#fff;box-shadow:inset 0 0 0 3px ${ink};clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%);`;
    if (/hexagon/i.test(kind)) return `width:280px;height:200px;background:#fff;box-shadow:inset 0 0 0 3px ${ink};clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);`;
    if (/heptagon|octagon|decagon|dodecagon/i.test(kind)) return `width:240px;height:220px;background:#fff;box-shadow:inset 0 0 0 3px ${ink};clip-path:polygon(50% 0,82% 10%,100% 38%,94% 72%,68% 100%,32% 100%,6% 72%,0 38%,18% 10%);`;
    if (/star|seal|lightning/i.test(kind)) return `width:220px;height:220px;background:#fff;box-shadow:inset 0 0 0 3px ${ink};clip-path:polygon(50% 0,61% 34%,98% 35%,68% 57%,79% 92%,50% 70%,21% 92%,32% 57%,2% 35%,39% 34%);`;
    if (/heart/i.test(kind)) return `width:230px;height:200px;background:#fff;box-shadow:inset 0 0 0 3px ${ink};clip-path:polygon(50% 88%,8% 49%,0 25%,10% 4%,30% 0,50% 18%,70% 0,90% 4%,100% 25%,92% 49%);`;
    if (/cloud/i.test(kind)) return `width:320px;height:170px;background:#fff;border:3px solid ${ink};border-radius:90px;`;
    if (/speech/i.test(kind)) return `width:320px;height:180px;background:#fff;border:3px solid ${ink};border-radius:16px;`;
    if (/round|terminator|scroll|can|bevel|plaque/i.test(kind)) return `width:320px;height:180px;background:#fff;border:3px solid ${ink};border-radius:32px;`;
    if (/brace|bracket/i.test(kind)) return `width:180px;height:220px;background:#fff;box-shadow:inset 0 0 0 3px ${ink};clip-path:polygon(45% 0,100% 0,70% 25%,70% 42%,45% 50%,70% 58%,70% 75%,100% 100%,45% 100%,0 75%,20% 50%,0 25%);`;
    if (/mathPlus/i.test(kind)) return `width:220px;height:220px;background:#fff;box-shadow:inset 0 0 0 3px ${ink};clip-path:polygon(38% 0,62% 0,62% 38%,100% 38%,100% 62%,62% 62%,62% 100%,38% 100%,38% 62%,0 62%,0 38%,38% 38%);`;
    return `width:320px;height:180px;background:#fff;border:3px solid ${ink};`;
}

function shapePickerStyle(kind: string): CSSProperties {
    const stroke = '1.5px solid #202124';
    if (kind === 'straightLine' || kind === 'straightConnector') return { width: 24, borderTop: stroke };
    if (kind.includes('Connector')) return { width: 22, height: 16, borderTop: stroke, borderRight: stroke, borderRadius: kind.startsWith('curved') ? '0 12px 0 0' : 0 };
    if (/ellipse|donut|pie|chord|moon|sun|smiley|disk|drum/i.test(kind)) return { width: 20, height: 20, border: stroke, borderRadius: '999px' };
    if (/diamond|decision|merge|sort|homePlate/i.test(kind)) return { width: 17, height: 17, border: stroke, transform: 'rotate(45deg)' };
    if (/triangle|offpage|preparation/i.test(kind)) return { width: 22, height: 19, border: stroke, clipPath: 'polygon(50% 0,100% 100%,0 100%)' };
    if (/trapezoid|parallelogram|inputOutput|manualInput/i.test(kind)) return { width: 24, height: 16, border: stroke, clipPath: 'polygon(14% 0,100% 0,86% 100%,0 100%)' };
    if (/pentagon/i.test(kind)) return { width: 21, height: 20, border: stroke, clipPath: 'polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)' };
    if (/hexagon/i.test(kind)) return { width: 23, height: 18, border: stroke, clipPath: 'polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)' };
    if (/heart/i.test(kind)) return { width: 22, height: 19, border: stroke, clipPath: 'polygon(50% 100%,0 45%,0 15%,25% 0,50% 20%,75% 0,100% 15%,100% 45%)' };
    if (/star|seal|lightning/i.test(kind)) return { width: 21, height: 21, border: stroke, clipPath: 'polygon(50% 0,61% 34%,98% 35%,68% 57%,79% 92%,50% 70%,21% 92%,32% 57%,2% 35%,39% 34%)' };
    if (/cloud/i.test(kind)) return { width: 25, height: 15, border: stroke, borderRadius: 9 };
    if (/mathPlus|plus/i.test(kind)) return { width: 19, height: 19, border: stroke, clipPath: 'polygon(36% 0,64% 0,64% 36%,100% 36%,100% 64%,64% 64%,64% 100%,36% 100%,36% 64%,0 64%,0 36%,36% 36%)' };
    return { width: 25, height: 16, border: stroke, borderRadius: /round|terminator|scroll|can|bevel|plaque/i.test(kind) ? 5 : 0 };
}

function ShapePickerGlyph({ kind }: { kind: string }) {
    return <span aria-hidden="true" className="relative block h-6 w-7 overflow-hidden"><span ref={(node) => { if (node) node.style.cssText = `position:absolute;left:0;top:0;zoom:0.065;${shapeStyle(kind)}`; }} /></span>;
}

function addHtmlShape(html: string, kind = 'rectangle'): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const container = document.querySelector('.slide-container') || document.body;
    const element = document.createElement('div');
    element.dataset.object = 'true'; element.dataset.objectType = 'shape'; element.dataset.shapeType = kind;
    element.style.cssText = `position:absolute;left:180px;top:180px;border:0 solid #312E81;z-index:100;${shapeStyle(kind)}`;
    container.append(element);
    return document.documentElement.outerHTML;
}

function ColorSwatches({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    const [open, setOpen] = useState(false);
    return <div className="relative text-xs"><button type="button" aria-label={`${label} 메뉴`} onClick={() => setOpen((visible) => !visible)} className="flex h-8 items-center gap-1 rounded px-2 hover:bg-gray-100"><span>{label}</span><span className="h-3 w-4 border-b-4" style={{ borderColor: value }} /></button>{open && <div className="absolute left-0 top-9 z-50 w-52 rounded-lg border bg-white p-2 shadow-xl"><div className="grid grid-cols-6 gap-1">{EDITOR_COLORS.map((color) => <button key={color} type="button" aria-label={`${label} ${color}`} title={color} onClick={() => { onChange(color); setOpen(false); }} className={`h-6 w-6 rounded border ${value.toLowerCase() === color.toLowerCase() ? 'ring-2 ring-purple-500 ring-offset-1' : ''}`} style={{ backgroundColor: color }} />)}</div><label className="mt-2 flex items-center justify-between text-xs text-gray-600">사용자 색상 <input aria-label={`${label} 사용자 색상`} type="color" value={value} onChange={(event) => onChange(event.target.value)} /></label></div>}</div>;
}

function deleteHtmlObject(html: string, index: number): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    htmlTextElements(document)[index]?.remove();
    return document.documentElement.outerHTML;
}

function duplicateHtmlObject(html: string, index: number): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const source = htmlTextElements(document)[index];
    if (!source?.dataset.object || !source.parentElement) return html;
    const copy = source.cloneNode(true) as HTMLElement;
    copy.style.left = `${(parseFloat(source.style.left) || 0) + 32}px`;
    copy.style.top = `${(parseFloat(source.style.top) || 0) + 32}px`;
    source.parentElement.append(copy);
    return document.documentElement.outerHTML;
}

function setHtmlList(html: string, index: number, ordered: boolean): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const source = htmlTextElements(document)[index];
    if (!source?.dataset.object || source.dataset.objectType !== 'textbox' || !source.parentElement) return html;
    const list = document.createElement(ordered ? 'ol' : 'ul');
    list.dataset.object = 'true'; list.dataset.objectType = 'textbox';
    list.style.cssText = source.style.cssText;
    list.style.paddingLeft ||= '40px';
    const lines = Array.from(source.querySelectorAll(':scope > li')).map((item) => item.textContent || '')
        .concat(source.querySelector('li') ? [] : source.innerHTML.split(/<br\s*\/?\s*>/i).map((part) => {
            const node = document.createElement('div'); node.innerHTML = part; return node.textContent || '';
        }))
        .map((line) => line.trim()).filter(Boolean);
    for (const line of lines.length ? lines : [source.textContent || '목록 항목']) {
        const item = document.createElement('li'); item.textContent = line; list.append(item);
    }
    source.replaceWith(list);
    return document.documentElement.outerHTML;
}

function addHtmlTable(html: string): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const container = document.querySelector('.slide-container') || document.body;
    const table = document.createElement('table');
    table.dataset.object = 'true'; table.dataset.objectType = 'table';
    table.style.cssText = 'position:absolute;left:180px;top:220px;width:1000px;height:300px;border-collapse:collapse;background:#FFFFFF;border:1px solid #94A3B8;z-index:100';
    table.innerHTML = '<tbody><tr><th style="border:1px solid #94A3B8;padding:16px;background:#E2E8F0">항목</th><th style="border:1px solid #94A3B8;padding:16px;background:#E2E8F0">내용</th></tr><tr><td style="border:1px solid #94A3B8;padding:16px">새 항목</td><td style="border:1px solid #94A3B8;padding:16px">내용 입력</td></tr></tbody>';
    container.append(table);
    return document.documentElement.outerHTML;
}

function addHtmlList(html: string, ordered: boolean): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const container = document.querySelector('.slide-container') || document.body;
    const list = document.createElement(ordered ? 'ol' : 'ul');
    list.dataset.object = 'true'; list.dataset.objectType = 'textbox';
    list.style.cssText = 'position:absolute;left:180px;top:180px;width:720px;min-height:160px;padding-left:40px;font-size:28px;color:#1A1A1A;z-index:100';
    list.innerHTML = '<li>첫 번째 항목</li><li>두 번째 항목</li><li>세 번째 항목</li>';
    container.append(list);
    return document.documentElement.outerHTML;
}

function addHtmlImage(html: string, source: string): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const container = document.querySelector('.slide-container') || document.body;
    const image = document.createElement('img');
    image.dataset.object = 'true'; image.dataset.objectType = 'image';
    image.src = source; image.alt = '삽입 이미지';
    image.style.cssText = 'position:absolute;left:180px;top:180px;width:640px;height:360px;object-fit:cover;z-index:100';
    container.append(image);
    return document.documentElement.outerHTML;
}

interface DraggableSlideProps {
    slide: any;
    index: number;
    isSelected: boolean;
    isChecked: boolean;
    onSelect: () => void;
    onToggleCheck: () => void;
    onMove: (from: number, to: number) => void;
}

function DraggableSlide({ slide, index, isSelected, isChecked, onSelect, onToggleCheck, onMove }: DraggableSlideProps) {
    const [{ isDragging }, drag] = useDrag({
        type: 'SLIDE',
        item: { index },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    const [, drop] = useDrop({
        accept: 'SLIDE',
        hover: (item: { index: number }) => {
            if (item.index !== index) {
                onMove(item.index, index);
                item.index = index;
            }
        },
    });

    const Icon = slideTypeIcons[slide.type] || Layout;

    // Combine drag and drop refs properly
    const setRefs = (node: HTMLDivElement | null) => {
        drag(drop(node));
    };

    return (
        <div
            ref={setRefs}
            onClick={onSelect}
            className={`slide-panel relative p-2 cursor-move ${isSelected ? 'active' : ''} ${isDragging ? 'opacity-50' : ''
                }`}
        >
            <input
                type="checkbox"
                checked={isChecked}
                onClick={(e) => e.stopPropagation()}
                onChange={onToggleCheck}
                title="AI 편집 대상으로 선택"
                className="absolute top-1 left-1 z-10 h-4 w-4 cursor-pointer accent-purple-600"
            />
            <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-50 rounded flex items-center justify-center mb-2">
                <Icon className="h-6 w-6 text-gray-400" />
            </div>
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600 truncate">
                    {index + 1}. {slide.title || 'Untitled'}
                </span>
            </div>
        </div>
    );
}

export default function EditorPage() {
    const params = useParams();
    const router = useRouter();
    const presentationId = params.id as string;
    const { isAuthenticated, hasHydrated } = useAuthStore();
    const {
        presentation,
        selectedSlideId,
        isDirty,
        canUndo,
        canRedo,
        setPresentation,
        setSelectedSlide,
        updateSlide,
        reorderSlides,
        removeSlide,
        setDirty,
        undo,
        redo,
    } = useEditorStore();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showSlideTypes, setShowSlideTypes] = useState(false);
    const [showVersionHistory, setShowVersionHistory] = useState(false);
    const [showCommentsPanel, setShowCommentsPanel] = useState(false);
    const [showShareDialog, setShowShareDialog] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [shareUrl, setShareUrl] = useState('');
    const [rightTab, setRightTab] = useState<'edit' | 'chat'>('chat');
    const [ribbonTab, setRibbonTab] = useState<'home' | 'insert'>('home');
    const [showShapePicker, setShowShapePicker] = useState(false);
    const [shapePickerGroup, setShapePickerGroup] = useState(0);
    const [showLinePicker, setShowLinePicker] = useState(false);
    const [isFocusMode, setIsFocusMode] = useState(false);
    const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
    const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
    const [aiChatInput, setAiChatInput] = useState('');
    const [aiChatBusy, setAiChatBusy] = useState(false);
    const aiEditAbortRef = useRef<AbortController | null>(null);
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const [aiChatMessages, setAiChatMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
    const [isExporting, setIsExporting] = useState(false);
    const [isDuplicating, setIsDuplicating] = useState(false);
    const [showTemplatesDialog, setShowTemplatesDialog] = useState(false);
    const [multiSelectedSlides, setMultiSelectedSlides] = useState<string[]>([]);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewVersion, setPreviewVersion] = useState(0);
    const previewCacheRef = useRef(new Map<string, string>());
    const previewPendingRef = useRef(new Map<string, Promise<string | null>>());
    const previewSlideIdRef = useRef<string | null>(null);
    const [selectedHtmlTextIndex, setSelectedHtmlTextIndex] = useState<number | null>(null);
    const [selectedNativeObjectId, setSelectedNativeObjectId] = useState<string | null>(null);
    const [leftPanelWidth, setLeftPanelWidth] = useState(208);
    const [rightPanelWidth, setRightPanelWidth] = useState(336);

    useEffect(() => {
        if (window.innerWidth < 1180) setIsFocusMode(true);
    }, []);

    const selectedSlide = presentation?.slides.find((s) => s.id === selectedSlideId);
    const selectedHtmlObject = selectedSlide?.content?.html && selectedHtmlTextIndex !== null
        ? getHtmlTextFields(selectedSlide.content.html)[selectedHtmlTextIndex] : null;
    const nativeObjects = presentation?.template?.config?.source?.kind === 'pptx' && selectedSlide
        ? (presentation.template.config.source.slides?.[selectedSlide.content?.templateIndex ?? selectedSlide.order]?.objects || [])
        : [];
    const selectedNativeObject = nativeObjects.find((item: any) => item.id === selectedNativeObjectId);
    const navigateSlide = (direction: -1 | 1) => {
        const index = presentation?.slides.findIndex((slide) => slide.id === selectedSlideId) ?? -1;
        const target = presentation?.slides[index + direction];
        if (!target) return;
        setSelectedSlide(target.id);
        setSelectedHtmlTextIndex(null);
        setSelectedNativeObjectId(null);
    };
    const updateSelectedHtmlObject = (updates: Record<string, string>) => {
        if (!selectedSlide?.content?.html || selectedHtmlTextIndex === null) return;
        const content = { ...selectedSlide.content, html: updateHtmlObject(selectedSlide.content.html, selectedHtmlTextIndex, updates) };
        updateSlide(selectedSlide.id, { content });
        handleSaveSlideDelayed(selectedSlide.id, { content });
    };
    const updateNativeObject = (objectId: string, updates: Record<string, any>) => {
        if (!selectedSlide) return;
        const objectEdits = [...(selectedSlide.content?.objectEdits || [])];
        const index = objectEdits.findIndex((item: any) => item.objectId === objectId);
        const base = { objectId, slide: selectedSlide.content?.templateIndex ?? selectedSlide.order ?? 0 };
        if (index >= 0) objectEdits[index] = { ...objectEdits[index], ...updates };
        else objectEdits.push({ ...base, ...updates });
        const content = { ...selectedSlide.content, objectEdits };
        updateSlide(selectedSlide.id, { content });
        handleSaveSlideDelayed(selectedSlide.id, { content });
    };

    const loadPreview = useCallback((slideIndex: number) => {
        const key = `${previewVersion}:${slideIndex}`;
        const cached = previewCacheRef.current.get(key);
        if (cached) return Promise.resolve(cached);
        const pending = previewPendingRef.current.get(key);
        if (pending) return pending;
        const request = exportApi.preview(presentationId, slideIndex)
            .then((response) => {
                const url = URL.createObjectURL(response.data);
                previewCacheRef.current.set(key, url);
                return url;
            })
            .catch(() => null)
            .finally(() => previewPendingRef.current.delete(key));
        previewPendingRef.current.set(key, request);
        return request;
    }, [presentationId, previewVersion]);

    const startPanelResize = (side: 'left' | 'right') => (event: any) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = side === 'left' ? leftPanelWidth : rightPanelWidth;
        const move = (moveEvent: PointerEvent) => {
            const delta = moveEvent.clientX - startX;
            const width = side === 'left' ? startWidth + delta : startWidth - delta;
            (side === 'left' ? setLeftPanelWidth : setRightPanelWidth)(Math.max(side === 'left' ? 208 : 288, Math.min(side === 'left' ? 420 : 600, width)));
        };
        const stop = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (canUndo) undo();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                if (canRedo) redo();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                e.preventDefault();
                if (selectedHtmlTextIndex !== null) duplicateSelectedHtmlObject();
                else if (selectedSlideId) handleDuplicateSlide();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                deleteSelectedHtmlObject();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [canUndo, canRedo, undo, redo, selectedSlideId, selectedHtmlTextIndex, selectedSlide]);

    useEffect(() => {
        // Wait for hydration before checking auth
        if (!hasHydrated) return;

        if (!isAuthenticated) {
            router.push('/login');
            return;
        }
        fetchPresentation();
    }, [presentationId, isAuthenticated, hasHydrated]);

    useEffect(() => {
        if (!presentation || !selectedSlideId) return;
        const slideIndex = presentation.slides.findIndex((slide) => slide.id === selectedSlideId);
        let active = true;
        const key = `${previewVersion}:${slideIndex}`;
        const cached = previewCacheRef.current.get(key);
        if (cached) {
            previewSlideIdRef.current = selectedSlideId;
            setPreviewUrl(cached);
        } else if (previewSlideIdRef.current !== selectedSlideId) {
            previewSlideIdRef.current = null;
            setPreviewUrl(null);
        }
        void loadPreview(slideIndex).then((url) => {
            if (active && url) {
                previewSlideIdRef.current = selectedSlideId;
                setPreviewUrl(url);
            }
        });
        for (let index = 0; index < presentation.slides.length; index += 1) {
            if (index !== slideIndex) void loadPreview(index);
        }
        return () => { active = false; };
    }, [presentation, selectedSlideId, previewVersion, loadPreview]);

    useEffect(() => () => {
        for (const url of previewCacheRef.current.values()) URL.revokeObjectURL(url);
        previewCacheRef.current.clear();
    }, []);

    const fetchPresentation = async () => {
        try {
            const response = await presentationsApi.get(presentationId);
            // Older presentations can have a template relation omitted from their
            // response. Fetching it by ID keeps ZIP/HTML layouts available in the
            // editor instead of silently falling back to the generic canvas.
            const template = response.data.template || (response.data.templateId
                ? (await templatesApi.get(response.data.templateId)).data
                : null);
            setPresentation({
                id: response.data.id,
                title: response.data.title,
                slides: response.data.slides,
                templateId: response.data.templateId,
                template,
            });
        } catch (error) {
            toast({ title: '오류', description: '프레젠테이션을 불러올 수 없습니다.', variant: 'destructive' });
            router.push('/dashboard');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!presentation || !isDirty) return;
        setSaving(true);
        try {
            // Save individual slide changes
            const savePromises = presentation.slides.map((slide) =>
                slidesApi.update(presentationId, slide.id, {
                    type: slide.type,
                    title: slide.title,
                    content: slide.content,
                    layout: slide.layout,
                    notes: slide.notes,
                    order: slide.order,
                })
            );
            await Promise.all(savePromises);
            setDirty(false);
            toast({ title: '저장 완료', description: '변경사항이 저장되었습니다.' });
        } catch (error) {
            toast({ title: '저장 실패', description: '저장 중 오류가 발생했습니다.', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    // Save individual slide changes
    const handleSaveSlide = async (slide: any) => {
        if (!slide || !presentationId) return;
        try {
            await slidesApi.update(presentationId, slide.id, {
                type: slide.type,
                title: slide.title,
                content: slide.content,
                layout: slide.layout,
                notes: slide.notes,
                order: slide.order,
            });
            setDirty(false);
            setPreviewVersion((version) => version + 1);
        } catch (error) {
            console.error('Failed to save slide:', error);
        }
    };

    // Debounced save for select/dropdown changes
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const handleSaveSlideDelayed = (slideId: string, updates: Partial<any>) => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(async () => {
            const slide = presentation?.slides.find((s) => s.id === slideId);
            if (slide) {
                try {
                    // Only send allowed fields to the API
                    await slidesApi.update(presentationId, slideId, {
                        type: updates.type ?? slide.type,
                        title: updates.title ?? slide.title,
                        content: updates.content ?? slide.content,
                        layout: updates.layout ?? slide.layout,
                        notes: updates.notes ?? slide.notes,
                        order: updates.order ?? slide.order,
                    });
                    setDirty(false);
                    setPreviewVersion((version) => version + 1);
                } catch (error) {
                    console.error('Failed to save slide:', error);
                }
            }
        }, 500);
    };

    const persistHistoryState = async () => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }
        const restored = useEditorStore.getState().presentation;
        if (!restored) return;
        setSaving(true);
        try {
            const listed = await slidesApi.list(presentationId);
            const serverSlides = listed.data as Array<{ id: string }>;
            const restoredIds = new Set(restored.slides.map((slide) => slide.id));
            const missingSlides = restored.slides.filter((slide) => !serverSlides.some((serverSlide) => serverSlide.id === slide.id));
            const removedSlides = serverSlides.filter((serverSlide) => !restoredIds.has(serverSlide.id));

            await Promise.all(removedSlides.map((slide) => slidesApi.delete(presentationId, slide.id)));
            const recreated = await Promise.all(missingSlides.map(async (slide) => {
                const response = await slidesApi.create(presentationId, {
                    type: slide.type, title: slide.title, content: slide.content,
                    layout: slide.layout, notes: slide.notes, order: slide.order,
                });
                return [slide.id, response.data.id] as const;
            }));

            if (recreated.length > 0) {
                const ids = new Map(recreated);
                const slides = restored.slides.map((slide) => ids.has(slide.id) ? { ...slide, id: ids.get(slide.id)! } : slide);
                const currentSelectedSlideId = useEditorStore.getState().selectedSlideId;
                const selectedSlideId = currentSelectedSlideId ? ids.get(currentSelectedSlideId) || currentSelectedSlideId : null;
                setPresentation({ ...restored, slides });
                setSelectedSlide(selectedSlideId);
            }

            const synchronized = useEditorStore.getState().presentation;
            if (!synchronized) return;
            await Promise.all(synchronized.slides.map((slide) => slidesApi.update(presentationId, slide.id, {
                type: slide.type, title: slide.title, content: slide.content,
                layout: slide.layout, notes: slide.notes, order: slide.order,
            })));
            setDirty(false);
            setPreviewVersion((version) => version + 1);
        } catch (error) {
            toast({ title: '저장 실패', description: '실행 취소 내용을 저장하지 못했습니다.', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteSlide = async () => {
        if (!selectedSlideId || !presentation) return;
        if (presentation.slides.length <= 1) {
            toast({ title: '삭제 불가', description: '최소 1개의 슬라이드가 필요합니다.', variant: 'destructive' });
            return;
        }

        try {
            removeSlide(selectedSlideId);
            await persistHistoryState();
            toast({ title: '삭제 완료', description: '슬라이드가 삭제되었습니다.' });
        } catch (error) {
            toast({ title: '삭제 실패', variant: 'destructive' });
        }
    };

    const handleAddSlide = async (type: string) => {
        try {
            const response = await slidesApi.create(presentationId, {
                type,
                order: presentation?.slides.length || 0,
                content: { heading: '새 슬라이드' },
                layout: 'center',
            });
            // Refresh presentation to get new slide
            fetchPresentation();
            setShowSlideTypes(false);
            toast({ title: '슬라이드 추가됨' });
        } catch (error) {
            toast({ title: '슬라이드 추가 실패', variant: 'destructive' });
        }
    };

    // Share handler
    const handleShare = async () => {
        try {
            const response = await presentationsApi.share(presentationId);
            const shareToken = response.data.shareToken;
            const url = `${window.location.origin}/presentations/shared/${shareToken}`;
            setShareUrl(url);
            setShowShareDialog(true);
        } catch (error) {
            toast({ title: '공유 링크 생성 실패', variant: 'destructive' });
        }
    };

    // Copy share URL to clipboard
    const handleCopyShareUrl = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            toast({ title: '링크 복사됨', description: '클립보드에 복사되었습니다.' });
        } catch (error) {
            toast({ title: '복사 실패', variant: 'destructive' });
        }
    };

    // Export handler
    const handleExport = async (format: 'pptx' | 'pdf') => {
        try {
            setIsExporting(true);
            setShowExportMenu(false);

            const response = format === 'pptx'
                ? await exportApi.pptx(presentationId)
                : await exportApi.pdf(presentationId);

            // Create download link
            const blob = new Blob([response.data], {
                type: format === 'pptx'
                    ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                    : 'application/pdf'
            });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${presentation?.title || 'presentation'}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            toast({ title: '내보내기 완료', description: `${format.toUpperCase()} 파일이 다운로드되었습니다.` });
        } catch (error) {
            toast({ title: '내보내기 실패', variant: 'destructive' });
        } finally {
            setIsExporting(false);
        }
    };

    // AI Edit handler — edits the checked slides, or the current one if none checked.
    const handleAiChat = async () => {
        const instruction = aiChatInput.trim();
        const targets = presentation ? resolveAiEditTargets(instruction, presentation.slides) : [];
        if (!targets.length || !instruction) {
            toast({ title: '편집할 슬라이드와 지시를 입력해주세요.', variant: 'destructive' });
            return;
        }

        // Non-blocking: close the dialog right away so the user can keep working or
        // navigate away while the edit runs. A toast reports the result when it lands.
        setAiChatMessages((messages) => [...messages, { role: 'user', text: instruction }]);
        setAiChatInput('');
        setAiChatBusy(true);
        const abortController = new AbortController();
        aiEditAbortRef.current = abortController;
        toast({ title: 'AI 편집 중...', description: `${targets.length}개 슬라이드를 편집하고 있습니다.` });

        try {
            const response = await generationApi.edit({ slideIds: targets, instruction }, abortController.signal);
            const editedSlides = response.data.slides ?? [];
            if (presentation) setPresentation({
                ...presentation,
                slides: presentation.slides.map((slide) => editedSlides.find((edited: any) => edited.id === slide.id) ?? slide),
            });
            setPreviewVersion((version) => version + 1);
            setAiChatMessages((messages) => [...messages, { role: 'assistant', text: `${targets.length}개 슬라이드를 수정했습니다.` }]);
            toast({ title: 'AI 편집 완료', description: `${targets.length}개 슬라이드가 업데이트되었습니다.` });
            void fetchPresentation();
        } catch {
            const cancelled = abortController.signal.aborted;
            setAiChatMessages((messages) => [...messages, { role: 'assistant', text: cancelled ? '수정 요청을 중지했습니다.' : '수정에 실패했습니다. 잠시 후 다시 요청해 주세요.' }]);
            toast({ title: cancelled ? 'AI 편집 중지됨' : 'AI 편집 실패', variant: cancelled ? undefined : 'destructive' });
        } finally {
            if (aiEditAbortRef.current === abortController) aiEditAbortRef.current = null;
            setAiChatBusy(false);
        }
    };

    const insertHtmlObject = (mutate: (html: string) => string) => {
        if (!selectedSlide?.content?.html) {
            toast({ title: 'HTML 템플릿 슬라이드가 필요합니다', description: '현재 슬라이드는 편집 가능한 HTML 템플릿이 아닙니다.', variant: 'destructive' });
            return;
        }
        const nextIndex = getHtmlTextFields(selectedSlide.content.html).length;
        const content = { ...selectedSlide.content, html: mutate(selectedSlide.content.html) };
        updateSlide(selectedSlide.id, { content });
        handleSaveSlideDelayed(selectedSlide.id, { content });
        setSelectedHtmlTextIndex(nextIndex);
        setRibbonTab('home');
    };

    const handleImageInsert = (file: File | undefined) => {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => insertHtmlObject((html) => addHtmlImage(html, String(reader.result)));
        reader.readAsDataURL(file);
    };

    const deleteSelectedHtmlObject = () => {
        if (!selectedSlide?.content?.html || selectedHtmlTextIndex === null) return;
        const content = { ...selectedSlide.content, html: deleteHtmlObject(selectedSlide.content.html, selectedHtmlTextIndex) };
        updateSlide(selectedSlide.id, { content });
        handleSaveSlideDelayed(selectedSlide.id, { content });
        setSelectedHtmlTextIndex(null);
    };

    const duplicateSelectedHtmlObject = () => {
        if (!selectedSlide?.content?.html || selectedHtmlTextIndex === null) return;
        const nextIndex = getHtmlTextFields(selectedSlide.content.html).length;
        const content = { ...selectedSlide.content, html: duplicateHtmlObject(selectedSlide.content.html, selectedHtmlTextIndex) };
        updateSlide(selectedSlide.id, { content });
        handleSaveSlideDelayed(selectedSlide.id, { content });
        setSelectedHtmlTextIndex(nextIndex);
    };

    const setSelectedHtmlList = (ordered: boolean) => {
        if (!selectedSlide?.content?.html || selectedHtmlTextIndex === null) return;
        const content = { ...selectedSlide.content, html: setHtmlList(selectedSlide.content.html, selectedHtmlTextIndex, ordered) };
        updateSlide(selectedSlide.id, { content });
        handleSaveSlideDelayed(selectedSlide.id, { content });
    };

    const handleCancelAiChat = () => aiEditAbortRef.current?.abort();

    // Duplicate slide handler
    const handleDuplicateSlide = async () => {
        if (!selectedSlideId || !presentationId) return;

        try {
            setIsDuplicating(true);
            // Use the correct API path with presentationId
            await slidesApi.duplicateWithPresentation(presentationId, selectedSlideId);
            toast({ title: '슬라이드 복제됨' });
            fetchPresentation();
        } catch (error) {
            toast({ title: '복제 실패', variant: 'destructive' });
        } finally {
            setIsDuplicating(false);
        }
    };

    if (!hasHydrated || loading) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
        );
    }

    if (!presentation) {
        return null;
    }

    return (
        <DndProvider backend={HTML5Backend}>
            <div className="h-screen flex flex-col bg-gray-100">
                {/* Header */}
                <header className="bg-white border-b px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/dashboard" className="p-2 hover:bg-gray-100 rounded-lg">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <div>
                            <h1 className="font-medium">{presentation.title}</h1>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">
                                    {presentation.slides.length} 슬라이드
                                </span>
                                <SaveStatusIndicator presentationId={presentationId} isDirty={isDirty} />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <UndoRedoButtons onUndo={() => { void persistHistoryState(); }} onRedo={() => { void persistHistoryState(); }} />
                        <div className="w-px h-6 bg-gray-200" />
                        <Button variant={rightTab === 'edit' ? 'secondary' : 'outline'} size="sm" onClick={() => setRightTab('edit')}>
                            <Type className="h-4 w-4 mr-1" />
                            수동 편집
                        </Button>
                        <Button variant={isFocusMode ? 'secondary' : 'outline'} size="sm" onClick={() => setIsFocusMode((value) => !value)}>
                            {isFocusMode ? '일반 보기' : '집중 보기'}
                        </Button>
                        <Button
                            variant={showVersionHistory ? 'secondary' : 'outline'}
                            size="sm"
                            onClick={() => {
                                setShowVersionHistory(!showVersionHistory);
                                setShowCommentsPanel(false);
                            }}
                        >
                            <History className="h-4 w-4 mr-1" />
                            버전
                        </Button>
                        <Button
                            variant={showCommentsPanel ? 'secondary' : 'outline'}
                            size="sm"
                            onClick={() => {
                                setShowCommentsPanel(!showCommentsPanel);
                                setShowVersionHistory(false);
                            }}
                        >
                            <MessageSquare className="h-4 w-4 mr-1" />
                            댓글
                        </Button>
                        <div className="w-px h-6 bg-gray-200" />
                        <Button variant="outline" size="sm" onClick={handleSave} disabled={!isDirty || saving}>
                            <Save className="h-4 w-4 mr-1" />
                            {saving ? '저장 중...' : '저장'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleShare}>
                            <Share2 className="h-4 w-4 mr-1" />
                            공유
                        </Button>
                        <div className="relative">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowExportMenu(!showExportMenu)}
                                disabled={isExporting}
                            >
                                {isExporting ? (
                                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                    <Download className="h-4 w-4 mr-1" />
                                )}
                                내보내기
                            </Button>
                            {showExportMenu && (
                                <div className="absolute right-0 top-10 w-48 bg-white rounded-lg shadow-lg border p-2 z-50">
                                    <button
                                        onClick={() => handleExport('pptx')}
                                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded text-sm"
                                    >
                                        <FileSpreadsheet className="h-4 w-4 text-orange-500" />
                                        PowerPoint (.pptx)
                                    </button>
                                    <button
                                        onClick={() => handleExport('pdf')}
                                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded text-sm"
                                    >
                                        <FileText className="h-4 w-4 text-red-500" />
                                        PDF (.pdf)
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <div className="flex min-h-14 shrink-0 items-center gap-3 overflow-visible border-b bg-white px-4 text-sm">
                    <div className="flex self-stretch items-center gap-1 border-r pr-3">
                        <button type="button" onClick={() => setRibbonTab('home')} className={`h-full px-2 font-medium ${ribbonTab === 'home' ? 'border-b-2 border-purple-600 text-purple-700' : 'text-gray-500'}`}>홈</button>
                        <button type="button" onClick={() => setRibbonTab('insert')} className={`h-full px-2 font-medium ${ribbonTab === 'insert' ? 'border-b-2 border-purple-600 text-purple-700' : 'text-gray-500'}`}>삽입</button>
                    </div>
                    {ribbonTab === 'home' ? (selectedHtmlObject ? <>
                        {selectedHtmlObject.objectType !== 'shape' && selectedHtmlObject.objectType !== 'image' && <>
                            <select aria-label="글꼴" value={selectedHtmlObject.fontFamily} onChange={(event) => updateSelectedHtmlObject({ fontFamily: event.target.value })} className="h-8 rounded border px-2"><option value="Noto Sans KR">Noto Sans KR</option><option value="NanumGothic">나눔고딕</option><option value="나눔고딕">나눔고딕 (PPTX)</option><option value="HY헤드라인M">HY헤드라인M</option><option value="Arial">Arial</option><option value="Pretendard">Pretendard</option></select>
                            <input aria-label="글자 크기" type="number" value={parseFloat(selectedHtmlObject.fontSize) || 24} onChange={(event) => updateSelectedHtmlObject({ fontSize: event.target.value })} className="h-8 w-16 rounded border px-2" />
                            <Button aria-label="굵게" type="button" size="icon" variant={selectedHtmlObject.fontWeight === '700' || selectedHtmlObject.fontWeight === 'bold' ? 'secondary' : 'ghost'} onClick={() => updateSelectedHtmlObject({ fontWeight: selectedHtmlObject.fontWeight === '700' || selectedHtmlObject.fontWeight === 'bold' ? '400' : '700' })}><Bold className="h-4 w-4" /></Button>
                            <Button aria-label="기울임" type="button" size="icon" variant={selectedHtmlObject.fontStyle === 'italic' ? 'secondary' : 'ghost'} onClick={() => updateSelectedHtmlObject({ fontStyle: selectedHtmlObject.fontStyle === 'italic' ? 'normal' : 'italic' })}><Italic className="h-4 w-4" /></Button>
                            <Button aria-label="밑줄" type="button" size="icon" variant={selectedHtmlObject.textDecoration.includes('underline') ? 'secondary' : 'ghost'} onClick={() => updateSelectedHtmlObject({ textDecoration: selectedHtmlObject.textDecoration.includes('underline') ? 'none' : 'underline' })}><Underline className="h-4 w-4" /></Button>
                            <Button aria-label="취소선" type="button" size="icon" variant={selectedHtmlObject.textDecoration.includes('line-through') ? 'secondary' : 'ghost'} onClick={() => updateSelectedHtmlObject({ textDecoration: selectedHtmlObject.textDecoration.includes('line-through') ? 'none' : 'line-through' })}><Strikethrough className="h-4 w-4" /></Button>
                            {selectedHtmlObject.objectType === 'textbox' && <><Button aria-label="글머리 목록" type="button" size="icon" variant="ghost" onClick={() => setSelectedHtmlList(false)}><List className="h-4 w-4" /></Button><Button aria-label="번호 목록" type="button" size="icon" variant="ghost" onClick={() => setSelectedHtmlList(true)}><ListOrdered className="h-4 w-4" /></Button></>}
                            <Button aria-label="왼쪽 정렬" type="button" size="icon" variant={selectedHtmlObject.textAlign === 'left' ? 'secondary' : 'ghost'} onClick={() => updateSelectedHtmlObject({ textAlign: 'left' })}><AlignLeft className="h-4 w-4" /></Button>
                            <Button aria-label="가운데 정렬" type="button" size="icon" variant={selectedHtmlObject.textAlign === 'center' ? 'secondary' : 'ghost'} onClick={() => updateSelectedHtmlObject({ textAlign: 'center' })}><AlignCenter className="h-4 w-4" /></Button>
                            <Button aria-label="오른쪽 정렬" type="button" size="icon" variant={selectedHtmlObject.textAlign === 'right' ? 'secondary' : 'ghost'} onClick={() => updateSelectedHtmlObject({ textAlign: 'right' })}><AlignRight className="h-4 w-4" /></Button>
                        </>}
                        <ColorSwatches label="글자색" value={selectedHtmlObject.color} onChange={(color) => updateSelectedHtmlObject({ color })} />
                        <ColorSwatches label="채우기" value={selectedHtmlObject.backgroundColor} onChange={(backgroundColor) => updateSelectedHtmlObject({ backgroundColor })} />
                        <ColorSwatches label="윤곽선" value={selectedHtmlObject.borderColor} onChange={(borderColor) => updateSelectedHtmlObject({ borderColor })} />
                        <Button aria-label="선택한 객체 복제" type="button" size="sm" variant="ghost" onClick={duplicateSelectedHtmlObject}><Copy className="mr-1 h-4 w-4" />복제</Button>
                        <Button aria-label="선택한 객체 삭제" type="button" size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={deleteSelectedHtmlObject}><Trash2 className="mr-1 h-4 w-4" />삭제</Button>
                    </> : <span className="text-xs text-gray-400">객체를 선택하면 글꼴, 목록, 정렬, 색상 서식을 적용할 수 있습니다.</span>) : <>
                        <Button type="button" size="sm" variant="outline" onClick={() => insertHtmlObject(addHtmlText)}><Type className="mr-1 h-4 w-4" />텍스트</Button>
                        <div className="relative"><Button type="button" size="sm" variant="outline" onClick={() => { setShowShapePicker((open) => !open); setShowLinePicker(false); }}><Layout className="mr-1 h-4 w-4" />도형</Button>{showShapePicker && <div className="absolute left-0 top-10 z-50 flex w-[330px] overflow-hidden rounded border bg-white shadow-lg"><nav className="w-28 border-r p-1">{SHAPE_GROUPS.map(([group], index) => <button key={group} type="button" onMouseEnter={() => setShapePickerGroup(index)} onFocus={() => setShapePickerGroup(index)} className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${shapePickerGroup === index ? 'bg-gray-100 text-gray-900' : 'text-gray-700 hover:bg-gray-50'}`}><span>{group}</span><span>›</span></button>)}</nav><div className="w-[202px] p-2"><div className="grid grid-cols-5 gap-1">{SHAPE_GROUPS[shapePickerGroup][1].map(([kind, label]) => <button key={kind} type="button" aria-label={label} title={label} onClick={() => { insertHtmlObject((html) => addHtmlShape(html, kind)); setShowShapePicker(false); }} className="flex h-8 items-center justify-center rounded hover:bg-gray-100"><ShapePickerGlyph kind={kind} /></button>)}</div></div></div>}</div>
                        <div className="relative"><Button type="button" size="sm" variant="outline" onClick={() => { setShowLinePicker((open) => !open); setShowShapePicker(false); }}>선</Button>{showLinePicker && <div className="absolute left-0 top-10 z-50 w-36 rounded border bg-white p-2 shadow-lg"><div className="grid grid-cols-3 gap-1">{LINE_OPTIONS.map(([kind, label]) => <button key={kind} type="button" aria-label={label} title={label} onClick={() => { insertHtmlObject((html) => addHtmlShape(html, kind)); setShowLinePicker(false); }} className="flex h-8 items-center justify-center rounded hover:bg-gray-100"><ShapePickerGlyph kind={kind} /></button>)}</div></div>}</div>
                        <Button type="button" size="sm" variant="outline" onClick={() => insertHtmlObject((html) => addHtmlList(html, false))}><List className="mr-1 h-4 w-4" />글머리</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => insertHtmlObject((html) => addHtmlList(html, true))}><ListOrdered className="mr-1 h-4 w-4" />번호 목록</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => insertHtmlObject(addHtmlTable)}><Table2 className="mr-1 h-4 w-4" />표</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => imageInputRef.current?.click()}><ImageIcon className="mr-1 h-4 w-4" />그림</Button>
                        <input ref={imageInputRef} aria-label="그림 파일 선택" type="file" accept="image/*" className="hidden" onChange={(event) => { handleImageInsert(event.target.files?.[0]); event.currentTarget.value = ''; }} />
                    </>}
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {!isFocusMode && isLeftPanelOpen ? <>
                    {/* Slide List Panel */}
                    <aside className="shrink-0 bg-white border-r p-3 overflow-auto" style={{ width: leftPanelWidth }}>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-medium text-gray-700">슬라이드</span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => setShowTemplatesDialog(true)}
                                title="슬라이드 추가 (템플릿 선택)"
                            >
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>

                        <div className="space-y-2">
                            {presentation.slides.map((slide, index) => (
                                <DraggableSlide
                                    key={slide.id}
                                    slide={slide}
                                    index={index}
                                    isSelected={slide.id === selectedSlideId}
                                    isChecked={multiSelectedSlides.includes(slide.id)}
                                    onSelect={() => {
                                        setSelectedSlide(slide.id);
                                        setSelectedHtmlTextIndex(null);
                                    }}
                                    onToggleCheck={() => setMultiSelectedSlides((prev) =>
                                        prev.includes(slide.id) ? prev.filter((id) => id !== slide.id) : [...prev, slide.id]
                                    )}
                                    onMove={reorderSlides}
                                />
                            ))}
                        </div>
                    </aside>
                    <div role="separator" aria-label="슬라이드 목록 너비 조절" aria-orientation="vertical" onPointerDown={startPanelResize('left')} className="relative w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-purple-400 active:bg-purple-500">
                        <button type="button" aria-label="슬라이드 패널 접기" title="슬라이드 패널 접기" onPointerDown={(event) => event.stopPropagation()} onClick={() => setIsLeftPanelOpen(false)} className="absolute left-1/2 top-1/2 z-10 flex h-7 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded border bg-white text-gray-500 shadow-sm hover:bg-gray-50"><PanelLeftClose className="h-3.5 w-3.5" /></button>
                    </div>
                    </> : !isFocusMode ? <div className="flex w-8 shrink-0 items-start justify-center border-r bg-white pt-3"><button type="button" aria-label="슬라이드 패널 펼치기" title="슬라이드 패널 펼치기" onClick={() => setIsLeftPanelOpen(true)} className="flex h-8 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100"><PanelLeftOpen className="h-4 w-4" /></button></div> : null}

                    {/* Main Editor Area */}
                    <main className="flex-1 min-w-0 overflow-auto p-4">
                        <div className={isFocusMode ? 'mx-auto w-full max-w-[1280px]' : 'mx-auto w-[1100px] min-w-[960px]'}>
                            {/* Slide Preview */}
                            <div className="editor-canvas bg-white shadow-lg rounded-lg overflow-hidden">
                                {selectedSlide ? (
                                    <EditableSlidePreview
                                        slide={selectedSlide}
                                        template={presentation.template}
                                        previewUrl={previewUrl}
                                        selectedHtmlTextIndex={selectedHtmlTextIndex}
                                        onSelectHtmlText={setSelectedHtmlTextIndex}
                                        nativeObjects={nativeObjects}
                                        selectedNativeObjectId={selectedNativeObjectId}
                                        onSelectNativeObject={setSelectedNativeObjectId}
                                        onNavigate={navigateSlide}
                                        onUpdate={(updates) => {
                                            updateSlide(selectedSlide.id, updates);
                                            if (updates.content) handleSaveSlideDelayed(selectedSlide.id, updates);
                                        }}
                                        onSave={() => handleSaveSlide(selectedSlide)}
                                    />
                                ) : (
                                    <div className="h-full flex items-center justify-center text-gray-400">
                                        슬라이드를 선택하세요
                                    </div>
                                )}
                            </div>

                            {/* Slide Actions */}
                            {selectedSlide && (
                                <div className="mt-4 flex items-center justify-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleDuplicateSlide}
                                        disabled={isDuplicating}
                                    >
                                        {isDuplicating ? (
                                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                        ) : (
                                            <Copy className="h-4 w-4 mr-1" />
                                        )}
                                        복제
                                    </Button>
                                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={handleDeleteSlide}>
                                        <Trash2 className="h-4 w-4 mr-1" />
                                        삭제
                                    </Button>
                                </div>
                            )}
                        </div>
                    </main>

                    {!isFocusMode && isRightPanelOpen ? <>
                    <div role="separator" aria-label="AI 패널 너비 조절" aria-orientation="vertical" onPointerDown={startPanelResize('right')} className="relative w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-purple-400 active:bg-purple-500">
                        <button type="button" aria-label="AI 패널 접기" title="AI 패널 접기" onPointerDown={(event) => event.stopPropagation()} onClick={() => setIsRightPanelOpen(false)} className="absolute left-1/2 top-1/2 z-10 flex h-7 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded border bg-white text-gray-500 shadow-sm hover:bg-gray-50"><PanelRightClose className="h-3.5 w-3.5" /></button>
                    </div>

                    {/* AI Chat / Manual Edit Panel */}
                    <aside className="flex shrink-0 flex-col bg-white border-l p-4 overflow-hidden" style={{ width: rightPanelWidth }}>
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="font-medium text-gray-900">{rightTab === 'chat' ? 'AI 채팅' : '수동 편집'}</h3>
                            {rightTab === 'edit' && <Button variant="ghost" size="sm" onClick={() => setRightTab('chat')}>AI 채팅으로</Button>}
                        </div>
                        {rightTab === 'chat' && (
                            <div className="flex min-h-0 flex-1 flex-col gap-3">
                                <p className="rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-900">전체 슬라이드 대상 · “3번 슬라이드”, “2~4번”처럼 번호를 적으면 해당 슬라이드만 수정합니다.</p>
                                <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl bg-gray-50 p-3">
                                    {aiChatMessages.length === 0 && <div className="rounded-2xl bg-white p-3 text-sm text-gray-600 shadow-sm">무엇을 바꿀지 자연어로 요청해 주세요.<br /><span className="text-xs text-gray-400">예: 3번 슬라이드의 표를 더 간결하게 정리해줘</span></div>}
                                    {aiChatMessages.map((message, index) => <div key={index} className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm shadow-sm ${message.role === 'user' ? 'ml-auto bg-purple-600 text-white' : 'bg-white text-gray-700'}`}>{message.text}</div>)}
                                </div>
                                <div className="rounded-2xl border bg-white p-2 shadow-sm focus-within:ring-2 focus-within:ring-purple-500">
                                    <textarea value={aiChatInput} onChange={(event) => setAiChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleAiChat(); } }} rows={3} placeholder="수정 요청을 입력하세요" className="w-full resize-none border-0 px-2 py-1 text-sm outline-none" />
                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-xs text-gray-400">Enter 전송 · Shift+Enter 줄바꿈</span>
                                        {aiChatBusy ? <Button size="sm" variant="outline" onClick={handleCancelAiChat}>중지</Button> : <Button size="sm" onClick={handleAiChat} disabled={!aiChatInput.trim()}>보내기</Button>}
                                    </div>
                                </div>
                            </div>
                        )}
                        {rightTab === 'edit' && (<div className="overflow-auto">
                        {selectedSlide ? (nativeObjects.length ? (
                            <div className="space-y-3">
                                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">원본 PPTX 객체를 선택해 텍스트, 표, 위치와 크기를 직접 수정합니다.</div>
                                <select value={selectedNativeObjectId ?? ''} onChange={(event) => setSelectedNativeObjectId(event.target.value || null)} className="w-full rounded-lg border px-3 py-2 text-sm">
                                    <option value="">수정할 PPTX 객체 선택</option>
                                    {nativeObjects.filter((item: any) => item.kind === 'text' || item.kind === 'table').map((item: any, index: number) => <option key={item.id} value={item.id}>{item.kind === 'table' ? '표' : '텍스트'} {index + 1}</option>)}
                                </select>
                                {selectedNativeObject ? <div className="space-y-3">
                                    <label className="block text-xs font-medium text-gray-600">{selectedNativeObject.kind === 'table' ? '표 내용 (줄마다 첫 번째 열)' : '텍스트'}</label>
                                    <textarea
                                        value={selectedNativeObject.kind === 'table' ? ((selectedSlide.content?.objectEdits || []).find((item: any) => item.objectId === selectedNativeObject.id)?.cells || selectedNativeObject.cells || []).map((row: string[]) => row.join(' | ')).join('\n') : ((selectedSlide.content?.objectEdits || []).find((item: any) => item.objectId === selectedNativeObject.id)?.text ?? selectedNativeObject.text ?? '')}
                                        rows={selectedNativeObject.kind === 'table' ? 6 : 4}
                                        onChange={(event) => updateNativeObject(selectedNativeObject.id, selectedNativeObject.kind === 'table' ? { cells: event.target.value.split('\n').map((row) => row.split('|').map((cell) => cell.trim())) } : { text: event.target.value })}
                                        className="w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        {(['left', 'top', 'width', 'height'] as const).map((property) => <label key={property} className="text-xs text-gray-600">{{ left: 'X', top: 'Y', width: 'W', height: 'H' }[property]}<input type="number" value={(selectedSlide.content?.objectEdits || []).find((item: any) => item.objectId === selectedNativeObject.id)?.[property] ?? selectedNativeObject[property] ?? 0} onChange={(event) => updateNativeObject(selectedNativeObject.id, { [property]: Number(event.target.value) })} className="mt-1 w-full rounded border px-2 py-1 text-sm" /></label>)}
                                    </div>
                                </div> : <p className="text-sm text-gray-500">슬라이드 위의 텍스트나 표를 클릭하면 바로 편집할 수 있습니다.</p>}
                            </div>
                        ) : selectedSlide.content?.html ? (
                            <div className="space-y-3">
                                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                                    텍스트를 직접 수정해도 템플릿의 레이아웃과 디자인은 유지됩니다.
                            </div>
                                <div className="space-y-3">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full"
                                    onClick={() => {
                                        const content = { ...selectedSlide.content, html: addHtmlText(selectedSlide.content.html) };
                                        updateSlide(selectedSlide.id, { content });
                                        handleSaveSlideDelayed(selectedSlide.id, { content });
                                        setSelectedHtmlTextIndex(getHtmlTextFields(selectedSlide.content.html).length);
                                    }}
                                >
                                    <Plus className="mr-1 h-4 w-4" /> 텍스트 추가
                                </Button>
                                <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => {
                                    const content = { ...selectedSlide.content, html: addHtmlShape(selectedSlide.content.html) };
                                    updateSlide(selectedSlide.id, { content }); handleSaveSlideDelayed(selectedSlide.id, { content });
                                    setSelectedHtmlTextIndex(getHtmlTextFields(selectedSlide.content.html).length);
                                }}><Layout className="mr-1 h-4 w-4" /> 도형 추가</Button>
                                <select
                                    value={selectedHtmlTextIndex ?? ''}
                                    onChange={(event) => setSelectedHtmlTextIndex(event.target.value === '' ? null : Number(event.target.value))}
                                    className="w-full rounded-lg border px-3 py-2 text-sm"
                                >
                                    <option value="">편집할 텍스트 선택</option>
                                    {getHtmlTextFields(selectedSlide.content.html).map((item, index) => (
                                        <option key={index} value={index}>{item.generated ? 'AI 텍스트' : item.positionable ? '텍스트' : '표 셀'} {index + 1}: {item.text.slice(0, 28)}</option>
                                    ))}
                                </select>
                                {selectedHtmlTextIndex === null ? (
                                    <p className="text-sm text-gray-500">AI 텍스트와 템플릿 텍스트를 선택해 내용을 수정할 수 있습니다.</p>
                                ) : getHtmlTextFields(selectedSlide.content.html).map((item, index) => index === selectedHtmlTextIndex ? (
                                    <div key={index}>
                                        <label className="mb-1 block text-xs font-medium text-gray-600">텍스트 {index + 1}</label>
                                        <textarea
                                            value={item.text}
                                            rows={Math.min(5, Math.max(2, item.text.split('\n').length))}
                                            onChange={(event) => {
                                                const content = { ...selectedSlide.content, html: updateHtmlText(selectedSlide.content.html, index, { text: event.target.value }) };
                                                updateSlide(selectedSlide.id, { content });
                                                handleSaveSlideDelayed(selectedSlide.id, { content });
                                            }}
                                            className="w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        />
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                            {(['fontFamily', 'fontSize', 'color', 'backgroundColor', 'borderColor', 'borderWidth'] as const).map((property) => (
                                                <label key={property} className="text-xs text-gray-600">{property}
                                                    <input type={property.includes('Color') || property === 'color' ? 'color' : property === 'fontFamily' ? 'text' : 'number'} value={property.includes('Color') || property === 'color' ? item[property] : property === 'fontFamily' ? item[property] : parseFloat(item[property]) || 0} onChange={(event) => { const content = { ...selectedSlide.content, html: updateHtmlObject(selectedSlide.content.html, index, { [property]: event.target.value }) }; updateSlide(selectedSlide.id, { content }); handleSaveSlideDelayed(selectedSlide.id, { content }); }} className="mt-1 w-full rounded border px-2 py-1 text-sm" />
                                                </label>
                                            ))}
                                        </div>
                                        {item.positionable && <div className="mt-2 grid grid-cols-2 gap-2">
                                            {(['left', 'top', 'width', 'height'] as const).map((property) => (
                                                <label key={property} className="text-xs text-gray-600">
                                                    {{ left: 'X', top: 'Y', width: 'W', height: 'H' }[property]}
                                                    <input
                                                        type="number"
                                                        value={parseFloat(item[property]) || 0}
                                                        onChange={(event) => {
                                                            const content = { ...selectedSlide.content, html: updateHtmlText(selectedSlide.content.html, index, { [property]: event.target.value }) };
                                                            updateSlide(selectedSlide.id, { content });
                                                            handleSaveSlideDelayed(selectedSlide.id, { content });
                                                        }}
                                                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                                                    />
                                                </label>
                                            ))}
                                        </div>}
                                        <Button type="button" variant="destructive" size="sm" className="mt-3 w-full" onClick={deleteSelectedHtmlObject}><Trash2 className="mr-1 h-4 w-4" /> 삭제</Button>
                                    </div>
                                ) : null)}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">타입</label>
                                    <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded">
                                        {selectedSlide.type}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                                    <input
                                        type="text"
                                        value={selectedSlide.title || ''}
                                        onChange={(e) => {
                                            updateSlide(selectedSlide.id, { title: e.target.value });
                                        }}
                                        onBlur={() => handleSaveSlide(selectedSlide)}
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">레이아웃</label>
                                    <select
                                        value={selectedSlide.layout || 'center'}
                                        onChange={(e) => {
                                            updateSlide(selectedSlide.id, { layout: e.target.value });
                                            // Auto-save on layout change
                                            handleSaveSlideDelayed(selectedSlide.id, { layout: e.target.value });
                                        }}
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    >
                                        <option value="center">중앙</option>
                                        <option value="left">왼쪽</option>
                                        <option value="right">오른쪽</option>
                                        <option value="two-column-equal">2단 (균등)</option>
                                        <option value="image-left">이미지 왼쪽</option>
                                        <option value="image-right">이미지 오른쪽</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">노트</label>
                                    <textarea
                                        value={selectedSlide.notes || ''}
                                        onChange={(e) => {
                                            updateSlide(selectedSlide.id, { notes: e.target.value });
                                        }}
                                        onBlur={() => handleSaveSlide(selectedSlide)}
                                        rows={4}
                                        placeholder="발표자 노트..."
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                                    />
                                </div>
                                {selectedSlide.type === 'CHART' && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                                        <label className="block text-sm font-medium text-gray-800">차트 데이터</label>
                                        {selectedSlide.content?.chart?.isExample && (
                                            <p className="text-xs text-amber-800">예시 데이터입니다. 실제 수치로 수정하세요.</p>
                                        )}
                                        <input
                                            type="text"
                                            value={(selectedSlide.content?.chart?.labels || []).join(', ')}
                                            onChange={(e) => {
                                                const chart = selectedSlide.content?.chart || {};
                                                const content = {
                                                    ...selectedSlide.content,
                                                    chart: { ...chart, labels: e.target.value.split(',').map((value: string) => value.trim()).filter(Boolean) },
                                                };
                                                updateSlide(selectedSlide.id, { content });
                                                handleSaveSlideDelayed(selectedSlide.id, { content });
                                            }}
                                            placeholder="항목 (쉼표로 구분)"
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        />
                                        <input
                                            type="text"
                                            value={(selectedSlide.content?.chart?.values || []).join(', ')}
                                            onChange={(e) => {
                                                const chart = selectedSlide.content?.chart || {};
                                                const content = {
                                                    ...selectedSlide.content,
                                                    chart: { ...chart, values: e.target.value.split(',').map((value: string) => Number(value.trim())).filter(Number.isFinite), isExample: false },
                                                };
                                                updateSlide(selectedSlide.id, { content });
                                                handleSaveSlideDelayed(selectedSlide.id, { content });
                                            }}
                                            placeholder="수치 (쉼표로 구분)"
                                            inputMode="decimal"
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        />
                                    </div>
                                )}
                            </div>
                        )
                        ) : (
                            <p className="text-sm text-gray-500">슬라이드를 선택하면 속성을 편집할 수 있습니다.</p>
                        )}
                        </div>)}
                    </aside>
                    </> : !isFocusMode ? <div className="flex w-8 shrink-0 items-start justify-center border-l bg-white pt-3"><button type="button" aria-label="AI 패널 펼치기" title="AI 패널 펼치기" onClick={() => setIsRightPanelOpen(true)} className="flex h-8 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100"><PanelRightOpen className="h-4 w-4" /></button></div> : null}

                    {/* Version History Panel */}
                    {showVersionHistory && (
                        <VersionHistory
                            presentationId={presentationId}
                            onClose={() => setShowVersionHistory(false)}
                        />
                    )}

                    {/* Comments Panel */}
                    {showCommentsPanel && (
                        <CommentsPanel
                            presentationId={presentationId}
                            slideId={selectedSlideId || undefined}
                            onClose={() => setShowCommentsPanel(false)}
                        />
                    )}
                </div>

                {/* Share Dialog */}
                {showShareDialog && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-medium">공유 링크</h3>
                                <button
                                    onClick={() => setShowShareDialog(false)}
                                    className="p-1 hover:bg-gray-100 rounded"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <p className="text-sm text-gray-600 mb-4">
                                이 링크를 공유하면 누구나 프레젠테이션을 볼 수 있습니다.
                            </p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={shareUrl}
                                    readOnly
                                    className="flex-1 px-3 py-2 border rounded-lg text-sm bg-gray-50"
                                />
                                <Button onClick={handleCopyShareUrl}>
                                    <LinkIcon className="h-4 w-4 mr-1" />
                                    복사
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Slide Templates Dialog */}
                <SlideTemplatesDialog
                    isOpen={showTemplatesDialog}
                    onClose={() => setShowTemplatesDialog(false)}
                    onSelectTemplate={handleAddSlide}
                />
            </div>
        </DndProvider>
    );
}

// Editable Slide Preview Component
interface EditableSlidePreviewProps {
    slide: any;
    template?: any;
    previewUrl?: string | null;
    selectedHtmlTextIndex: number | null;
    onSelectHtmlText: (index: number | null) => void;
    nativeObjects: any[];
    selectedNativeObjectId: string | null;
    onSelectNativeObject: (id: string | null) => void;
    onNavigate: (direction: -1 | 1) => void;
    onUpdate: (updates: Partial<any>) => void;
    onSave: () => void;
}

function EditableSlidePreview({ slide, template, previewUrl, selectedHtmlTextIndex, onSelectHtmlText, nativeObjects, selectedNativeObjectId, onSelectNativeObject, onNavigate, onUpdate, onSave }: EditableSlidePreviewProps) {
    const content = slide.content || {};
    const heading = content.heading || slide.title || '';
    const subheading = content.subheading || '';
    const body = content.body || '';
    const bullets = content.bullets || [];
    const previewStyle = getTemplatePreviewStyle(template);
    const htmlTextFields = typeof content.html === 'string' ? getHtmlTextFields(content.html) : [];
    const htmlSelectionAreas = typeof content.html === 'string' ? getHtmlSelectionAreas(content.html) : [];
    const [inlineTextIndex, setInlineTextIndex] = useState<number | null>(null);
    const htmlFrameRef = useRef<HTMLIFrameElement>(null);
    const htmlCanvasRef = useRef<HTMLDivElement>(null);
    const latestContentRef = useRef(content);
    const latestOnUpdateRef = useRef(onUpdate);
    const latestOnSelectRef = useRef(onSelectHtmlText);
    const lastFrameHtmlRef = useRef<string | null>(null);
    const [frameHtml, setFrameHtml] = useState(() => typeof content.html === 'string' ? editorFrameHtml(content.html) : '');
    const [frameScale, setFrameScale] = useState(1);

    useEffect(() => { latestContentRef.current = content; latestOnUpdateRef.current = onUpdate; latestOnSelectRef.current = onSelectHtmlText; }, [content, onUpdate, onSelectHtmlText]);
    useEffect(() => {
        if (typeof content.html === 'string' && content.html !== lastFrameHtmlRef.current) setFrameHtml(editorFrameHtml(content.html));
    }, [slide.id, content.html]);
    useEffect(() => {
        const canvas = htmlCanvasRef.current;
        if (!canvas || !content.html) return;
        const resize = () => setFrameScale(Math.min(canvas.clientWidth / 1920, canvas.clientHeight / 1080));
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        return () => observer.disconnect();
    }, [content.html]);

    const startSlideSwipe = (event: any) => {
        if ((event.target as HTMLElement).closest('[data-editable-object]')) return;
        const startX = event.clientX;
        const startY = event.clientY;
        const stop = (endEvent: PointerEvent) => {
            const dx = endEvent.clientX - startX;
            const dy = endEvent.clientY - startY;
            if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)) onNavigate(dx < 0 ? 1 : -1);
            window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointerup', stop, { once: true });
    };

    const startHtmlFrameEditing = () => {
        const document = htmlFrameRef.current?.contentDocument;
        if (!document) return;
        document.body.contentEditable = 'true';
        document.body.spellcheck = false;
        document.body.setAttribute('data-taeslide-editing-surface', 'true');
        let selectedElement: HTMLElement | null = null;
        const editableSelector = 'th,td,h1,h2,h3,h4,h5,h6,p,li,span';
        const targetFor = (node: EventTarget | null): HTMLElement | null => {
            const candidate = node as Node | null;
            let element = candidate?.nodeType === 1 ? candidate as HTMLElement : candidate?.nodeType === 3 ? candidate.parentElement : null;
            if (!element) return null;
            const indexed = element.closest<HTMLElement>('[data-taeslide-editor-index]');
            if (indexed) return indexed;
            const cell = element.closest<HTMLElement>('th,td');
            if (cell) return cell;
            while (element && element !== document.body) {
                if (element.matches(editableSelector) || (!element.querySelector(editableSelector) && !!element.textContent?.trim())) return element;
                element = element.parentElement;
            }
            return null;
        };
        const persist = () => {
            const copy = document.documentElement.cloneNode(true) as HTMLElement;
            copy.querySelectorAll('[data-taeslide-selected], [data-taeslide-editing], [data-taeslide-editor-index]').forEach((element) => {
                element.removeAttribute('data-taeslide-selected'); element.removeAttribute('data-taeslide-editing');
                element.removeAttribute('data-taeslide-editor-index');
                (element as HTMLElement).contentEditable = 'inherit';
            });
            const html = `<!doctype html>${copy.outerHTML}`;
            lastFrameHtmlRef.current = html;
            latestOnUpdateRef.current({ content: { ...latestContentRef.current, html } });
        };
        const select = (element: HTMLElement | null) => {
            document.querySelectorAll('[data-taeslide-selected]').forEach((item) => item.removeAttribute('data-taeslide-selected'));
            element?.setAttribute('data-taeslide-selected', 'true');
            selectedElement = element;
            const index = Number(element?.dataset.taeslideEditorIndex);
            latestOnSelectRef.current(Number.isInteger(index) ? index : null);
        };
        const styles = document.createElement('style');
        styles.textContent = '[data-taeslide-selected="true"]{outline:2px solid #7c3aed!important;outline-offset:2px;box-shadow:0 0 0 2px rgba(124,58,237,.28)!important}[data-taeslide-selected="true"][data-object-type="shape"], [data-taeslide-selected="true"][data-object-type="image"]{cursor:move!important}[data-taeslide-editing="true"]{cursor:text!important;caret-color:#111827}';
        document.head.append(styles);
        if (selectedHtmlTextIndex !== null) {
            select(document.querySelector<HTMLElement>(`[data-taeslide-editor-index="${selectedHtmlTextIndex}"]`));
        }
        document.addEventListener('pointerdown', (event) => {
            const element = targetFor(event.target);
            select(element);
            if (!event.altKey || !element || element.dataset.object !== 'true') return;
            event.preventDefault();
            const startX = event.clientX;
            const startY = event.clientY;
            const left = parseFloat(element.style.left) || 0;
            const top = parseFloat(element.style.top) || 0;
            const width = element.offsetWidth;
            const height = element.offsetHeight;
            const move = (moveEvent: PointerEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                if (moveEvent.shiftKey) {
                    element.style.width = `${Math.max(24, width + dx)}px`;
                    element.style.height = `${Math.max(24, height + dy)}px`;
                } else {
                    element.style.left = `${left + dx}px`;
                    element.style.top = `${top + dy}px`;
                }
            };
            const stop = () => { document.removeEventListener('pointermove', move); persist(); };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', stop, { once: true });
        });
        document.addEventListener('dblclick', (event) => {
            const element = targetFor(event.target);
            if (!element) return;
            event.preventDefault();
            select(element);
            element.contentEditable = 'true';
            element.setAttribute('data-taeslide-editing', 'true');
            element.focus();
        });
        document.addEventListener('input', persist);
        document.addEventListener('focusout', (event) => {
            const element = event.target as HTMLElement;
            if (element?.getAttribute('contenteditable') === 'true') {
                element.contentEditable = 'inherit'; element.removeAttribute('data-taeslide-editing'); persist();
            }
        });
        document.addEventListener('selectionchange', () => select(targetFor(document.getSelection()?.anchorNode ?? null)));
        document.addEventListener('keydown', (event) => {
            if ((event.key === 'Delete' || event.key === 'Backspace') && selectedElement?.dataset.objectType && ['shape', 'image'].includes(selectedElement.dataset.objectType)) {
                event.preventDefault();
                selectedElement.remove();
                selectedElement = null;
                persist();
                return;
            }
            if ((event.ctrlKey || event.metaKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
                event.preventDefault();
                document.execCommand(event.key.toLowerCase() === 'b' ? 'bold' : event.key.toLowerCase() === 'i' ? 'italic' : 'underline');
                persist();
                return;
            }
            if (event.key !== 'Escape') return;
            const element = targetFor(event.target);
            if (element?.getAttribute('contenteditable') === 'true') { element.contentEditable = 'inherit'; element.blur(); }
        });
    };

    if (content.html) {
        return (
            <div ref={htmlCanvasRef} className="relative h-full w-full overflow-hidden bg-white" data-html-canvas onPointerDown={startSlideSwipe}>
                <iframe
                    ref={htmlFrameRef}
                    data-html-editor-frame
                    title={slide.title || '슬라이드 편집 캔버스'}
                    srcDoc={frameHtml}
                    onLoad={startHtmlFrameEditing}
                    className="absolute left-0 top-0 border-0 bg-white"
                    style={{ width: 1920, height: 1080, transform: `scale(${frameScale})`, transformOrigin: 'top left' }}
                />
            </div>
        );
    }

    const startHtmlTransform = (event: any, index: number, resizing: boolean) => {
        event.preventDefault();
        event.stopPropagation();
        const canvas = (event.currentTarget as HTMLElement).closest('[data-html-canvas]') as HTMLElement | null;
        const field = htmlTextFields[index];
        if (!canvas || !field) return;
        const bounds = canvas.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const initial = {
            left: parseFloat(field.left) || 0,
            top: parseFloat(field.top) || 0,
            width: parseFloat(field.width) || 0,
            height: parseFloat(field.height) || 0,
        };
        const move = (moveEvent: PointerEvent) => {
            const dx = (moveEvent.clientX - startX) * 1920 / bounds.width;
            const dy = (moveEvent.clientY - startY) * 1080 / bounds.height;
            const updates = resizing
                ? { width: String(Math.max(40, Math.round(initial.width + dx))), height: String(Math.max(24, Math.round(initial.height + dy))) }
                : { left: String(Math.round(initial.left + dx)), top: String(Math.round(initial.top + dy)) };
            onUpdate({ content: { ...content, html: updateHtmlText(content.html, index, updates) } });
        };
        const stop = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
    };

    const startNativeTransform = (event: any, object: any, resizing: boolean) => {
        event.preventDefault();
        event.stopPropagation();
        const canvas = (event.currentTarget as HTMLElement).closest('[data-html-canvas]') as HTMLElement | null;
        if (!canvas) return;
        const bounds = canvas.getBoundingClientRect();
        const current = (content.objectEdits || []).find((item: any) => item.objectId === object.id) || {};
        const initial = { left: current.left ?? object.left ?? 0, top: current.top ?? object.top ?? 0, width: current.width ?? object.width ?? 0, height: current.height ?? object.height ?? 0 };
        const startX = event.clientX;
        const startY = event.clientY;
        const move = (moveEvent: PointerEvent) => {
            const dx = (moveEvent.clientX - startX) * 1920 / bounds.width;
            const dy = (moveEvent.clientY - startY) * 1080 / bounds.height;
            const transform = resizing ? { width: Math.max(40, Math.round(initial.width + dx)), height: Math.max(24, Math.round(initial.height + dy)) } : { left: Math.round(initial.left + dx), top: Math.round(initial.top + dy) };
            const objectEdits = [...(content.objectEdits || [])];
            const index = objectEdits.findIndex((item: any) => item.objectId === object.id);
            if (index >= 0) objectEdits[index] = { ...objectEdits[index], ...transform };
            else objectEdits.push({ objectId: object.id, slide: content.templateIndex ?? slide.order ?? 0, ...transform });
            onUpdate({ content: { ...content, objectEdits } });
        };
        const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
    };

    if (previewUrl && !content.html) {
        return (
            <div className="relative h-full w-full touch-pan-y" data-html-canvas onPointerDown={startSlideSwipe}>
                <img src={previewUrl} alt={slide.title || '슬라이드 미리보기'} className="h-full w-full object-contain" />
                {nativeObjects.map((object: any) => {
                    const edit = (content.objectEdits || []).find((item: any) => item.objectId === object.id) || {};
                    const left = edit.left ?? object.left ?? 0;
                    const top = edit.top ?? object.top ?? 0;
                    const width = edit.width ?? object.width ?? 0;
                    const height = edit.height ?? object.height ?? 0;
                    const selected = selectedNativeObjectId === object.id;
                    return <div key={object.id} data-editable-object data-native-object className={`absolute cursor-move ${selected ? 'border-2 border-purple-500 bg-purple-500/5' : 'border border-transparent hover:border-purple-400/70'}`} style={{ left: `${left / 19.2}%`, top: `${top / 10.8}%`, width: `${Math.max(1, width) / 19.2}%`, height: `${Math.max(1, height) / 10.8}%` }} onPointerDown={(event) => { onSelectNativeObject(object.id); startNativeTransform(event, object, false); }}>
                        {selected && <button type="button" aria-label="native object resize" className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border border-purple-700 bg-white" onPointerDown={(event) => startNativeTransform(event, object, true)} />}
                    </div>;
                })}
                {htmlSelectionAreas.map((area) => {
                    const field = htmlTextFields[area.index];
                    return field && (
                    <div
                        key={area.index}
                        data-editable-object
                        className={`absolute ${field.positionable ? 'cursor-move' : 'cursor-pointer'} ${selectedHtmlTextIndex === area.index ? 'border border-purple-500/70 bg-purple-500/5 hover:bg-purple-500/15' : ''}`}
                        style={{ left: `${(parseFloat(area.left) || 0) / 19.2}%`, top: `${(parseFloat(area.top) || 0) / 10.8}%`, width: `${Math.max(1, parseFloat(area.width) || 0) / 19.2}%`, height: `${Math.max(1, parseFloat(area.height) || 0) / 10.8}%` }}
                        onPointerDown={(event) => {
                            onSelectHtmlText(area.index);
                            if (field.positionable) startHtmlTransform(event, area.index, false);
                        }}
                        onDoubleClick={(event) => {
                            if (field.objectType === 'shape' || field.objectType === 'image') return;
                            event.preventDefault();
                            event.stopPropagation();
                            onSelectHtmlText(area.index);
                            setInlineTextIndex(area.index);
                        }}
                    >
                        {inlineTextIndex === area.index && <textarea
                            autoFocus
                            aria-label="슬라이드 텍스트 직접 편집"
                            value={field.text}
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={(event) => onUpdate({ content: { ...content, html: updateHtmlText(content.html, area.index, { text: event.target.value }) } })}
                            onBlur={() => { setInlineTextIndex(null); }}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') { setInlineTextIndex(null); (event.currentTarget as HTMLTextAreaElement).blur(); }
                                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { setInlineTextIndex(null); (event.currentTarget as HTMLTextAreaElement).blur(); }
                            }}
                            className="absolute inset-0 h-full w-full resize-none border-2 border-purple-600 bg-white/95 p-1 text-inherit leading-tight outline-none"
                            style={{ color: field.color, fontFamily: field.fontFamily, fontSize: `${Math.max(12, (parseFloat(field.fontSize) || 24) / 4)}px`, textAlign: field.textAlign as any }}
                        />}
                        {selectedHtmlTextIndex === area.index && field.positionable && <button
                            type="button"
                            aria-label="텍스트 크기 조절"
                            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border border-purple-700 bg-white"
                            onPointerDown={(event) => {
                                onSelectHtmlText(area.index);
                                startHtmlTransform(event, area.index, true);
                            }}
                        />
                        }
                    </div>
                    );
                })}
            </div>
        );
    }
    if (previewUrl) {
        return <img src={previewUrl} alt={`${slide.title || '슬라이드'} 미리보기`} className="h-full w-full object-contain" />;
    }

    if (content.html) {
        return <div className="flex h-full items-center justify-center bg-gray-50 text-sm text-gray-400">템플릿 미리보기 불러오는 중…</div>;
    }

    const handleHeadingChange = (newHeading: string) => {
        onUpdate({
            title: newHeading,
            content: { ...content, heading: newHeading }
        });
    };

    const handleSubheadingChange = (newSubheading: string) => {
        onUpdate({
            content: { ...content, subheading: newSubheading }
        });
    };

    const handleBodyChange = (newBody: string) => {
        onUpdate({
            content: { ...content, body: newBody }
        });
    };

    const handleBulletChange = (index: number, newText: string) => {
        const newBullets = [...bullets];
        if (typeof bullets[index] === 'string') {
            newBullets[index] = newText;
        } else {
            newBullets[index] = { ...bullets[index], text: newText };
        }
        onUpdate({
            content: { ...content, bullets: newBullets }
        });
    };

    const handleAddBullet = () => {
        const newBullets = [...bullets, '새 항목'];
        onUpdate({
            content: { ...content, bullets: newBullets }
        });
    };

    const handleRemoveBullet = (index: number) => {
        const newBullets = bullets.filter((_: any, i: number) => i !== index);
        onUpdate({
            content: { ...content, bullets: newBullets }
        });
    };

    // Common editable input styles
    const editableStyle = "bg-transparent border-none outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 rounded px-2 py-1 w-full";

    // Render based on slide type
    switch (slide.type) {
        case 'TITLE':
            return (
                <div className="relative h-full overflow-hidden flex flex-col items-center justify-center p-12 text-center" style={previewStyle}>
                    <input
                        type="text"
                        value={heading}
                        onChange={(e) => handleHeadingChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="제목을 입력하세요"
                        className={`${editableStyle} text-4xl font-bold text-gray-900 mb-4 text-center`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                    <input
                        type="text"
                        value={subheading}
                        onChange={(e) => handleSubheadingChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="부제목을 입력하세요"
                        className={`${editableStyle} text-xl text-gray-600 text-center`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                </div>
            );

        case 'SECTION_HEADER':
            return (
                <div className="relative h-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-purple-600 to-purple-800 p-12" style={previewStyle}>
                    <input
                        type="text"
                        value={heading}
                        onChange={(e) => handleHeadingChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="섹션 제목을 입력하세요"
                        className={`${editableStyle} text-3xl font-bold text-white text-center bg-white/10`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                </div>
            );

        case 'QUOTE':
            return (
                <div className="relative h-full overflow-hidden flex flex-col items-center justify-center p-12" style={previewStyle}>
                    <textarea
                        value={body || heading}
                        onChange={(e) => handleBodyChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="인용문을 입력하세요"
                        rows={4}
                        className={`${editableStyle} text-2xl italic text-gray-700 text-center max-w-2xl resize-none`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                </div>
            );

        case 'BULLET_LIST':
        case 'CONTENT':
        default:
            return (
                <div className="relative h-full overflow-hidden p-8" style={previewStyle}>
                    <input
                        type="text"
                        value={heading}
                        onChange={(e) => handleHeadingChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="제목을 입력하세요"
                        className={`${editableStyle} text-2xl font-bold text-gray-900 mb-6`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                    <textarea
                        value={body}
                        onChange={(e) => handleBodyChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="본문 내용을 입력하세요 (선택사항)"
                        rows={2}
                        className={`${editableStyle} text-gray-600 mb-4 resize-none`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                    <ul className="space-y-2">
                        {bullets.map((bullet: any, index: number) => (
                            <li key={index} className="flex items-start gap-2 group">
                                <span className="text-purple-600 font-bold mt-2">•</span>
                                <input
                                    type="text"
                                    value={typeof bullet === 'string' ? bullet : bullet.text}
                                    onChange={(e) => handleBulletChange(index, e.target.value)}
                                    onBlur={onSave}
                                    placeholder="항목 내용"
                                    className={`${editableStyle} text-gray-700 flex-1`}
                                    style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                                />
                                <button
                                    onClick={() => handleRemoveBullet(index)}
                                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 p-1 transition-opacity"
                                    title="항목 삭제"
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                    <button
                        onClick={handleAddBullet}
                        className="mt-4 text-purple-600 hover:text-purple-800 text-sm flex items-center gap-1"
                    >
                        <span>+</span>
                        <span>항목 추가</span>
                    </button>
                </div>
            );
    }
}

// Read-only Slide Preview Component (for thumbnails, etc.)
function SlidePreview({ slide }: { slide: any }) {
    const content = slide.content || {};
    const heading = content.heading || slide.title || '';
    const subheading = content.subheading || '';
    const body = content.body || '';
    const bullets = content.bullets || [];

    // Render based on slide type
    switch (slide.type) {
        case 'TITLE':
            return (
                <div className="h-full flex flex-col items-center justify-center p-12 text-center">
                    <h1 className="text-4xl font-bold text-gray-900 mb-4">{heading}</h1>
                    {subheading && <p className="text-xl text-gray-600">{subheading}</p>}
                </div>
            );

        case 'SECTION_HEADER':
            return (
                <div className="h-full flex items-center justify-center bg-gradient-to-br from-purple-600 to-purple-800">
                    <h2 className="text-3xl font-bold text-white">{heading}</h2>
                </div>
            );

        case 'QUOTE':
            return (
                <div className="h-full flex items-center justify-center p-12">
                    <blockquote className="text-2xl italic text-gray-700 text-center max-w-2xl">
                        "{body || heading}"
                    </blockquote>
                </div>
            );

        case 'BULLET_LIST':
        case 'CONTENT':
        default:
            return (
                <div className="h-full p-8">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6">{heading}</h2>
                    {body && <p className="text-gray-600 mb-4">{body}</p>}
                    {bullets.length > 0 && (
                        <ul className="space-y-2">
                            {bullets.map((bullet: any, index: number) => (
                                <li key={index} className="flex items-start gap-2">
                                    <span className="text-purple-600 font-bold">•</span>
                                    <span className="text-gray-700">{typeof bullet === 'string' ? bullet : bullet.text}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            );
    }
}

