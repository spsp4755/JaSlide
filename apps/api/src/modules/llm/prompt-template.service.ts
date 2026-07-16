import { Injectable } from '@nestjs/common';
import { GenerateOutlineInput, GenerateSlideContentInput } from './llm.service';

@Injectable()
export class PromptTemplateService {
    getOutlinePrompt(input: GenerateOutlineInput): string {
        const language = input.language === 'ko' ? '모든 내용을 한국어로 작성하세요.' : 'Write all content in English.';
        return `당신은 전문 프레젠테이션 컨설턴트입니다. 아래 콘텐츠로 정확히 ${input.slideCount}장의 슬라이드 개요를 만드세요.
${language}

입력 콘텐츠:
---
${input.content.slice(0, 10000)}
---

type은 TITLE, CONTENT, BULLET_LIST, TWO_COLUMN, IMAGE, CHART, QUOTE, COMPARISON, SECTION_HEADER 중 하나만 사용하세요.
반드시 JSON 객체만 반환하세요. markdown이나 설명을 추가하지 마세요.
계약: title은 비어 있지 않은 문자열, slides는 정확히 ${input.slideCount}개, 각 order는 1부터 순서대로, 각 slide title은 비어 있지 않은 문자열, keyPoints는 비어 있지 않은 문자열 2~5개입니다.

{
  "title": "프레젠테이션 제목",
  "slides": [{ "order": 1, "title": "슬라이드 제목", "type": "TITLE", "keyPoints": ["핵심 사항 1", "핵심 사항 2"] }]
}`;
    }

    getSlideContentPrompt(input: GenerateSlideContentInput): string {
        const language = input.language === 'ko' ? '모든 내용을 한국어로 작성하세요.' : 'Write all content in English.';
        return `다음 슬라이드의 콘텐츠를 생성하세요.
${language}
제목: ${input.title}
type: ${input.type}
핵심 사항: ${input.keyPoints.join(', ')}
${this.getTypeInstructions(input.type)}

반드시 JSON 객체만 반환하세요. markdown이나 설명을 추가하지 마세요.
계약: heading은 비어 있지 않은 문자열입니다. bullets는 선택 사항이며 최대 5개입니다. 각 bullet의 text는 비어 있지 않은 문자열이고 level은 0 또는 1입니다.

{
  "heading": "메인 제목",
  "subheading": "부제목",
  "body": "본문 텍스트",
  "bullets": [{ "text": "글머리표 내용", "level": 0 }]
}`;
    }

    private getTypeInstructions(type: string): string {
        const instructions: Record<string, string> = {
            TITLE: '제목과 부제목만 작성하고 글머리표는 비워 두세요.',
            CONTENT: '제목, 본문, 필요하면 글머리표를 작성하세요.',
            BULLET_LIST: '제목과 3~5개의 글머리표를 작성하세요.',
            TWO_COLUMN: '두 관점을 비교할 수 있도록 글머리표를 작성하세요.',
            IMAGE: '제목과 이미지를 설명할 짧은 본문을 작성하세요.',
            CHART: '제목과 데이터 해석을 위한 간결한 본문을 작성하세요.',
            QUOTE: '인용문과 출처를 본문에 작성하세요.',
            COMPARISON: '비교 항목을 글머리표로 작성하세요.',
            SECTION_HEADER: '섹션 제목만 작성하세요.',
        };
        return instructions[type] || instructions.CONTENT;
    }

    getEditPrompt(currentContent: string, instruction: string): string {
        return `현재 콘텐츠:
---
${currentContent}
---
편집 지시:
${instruction}
지시에 따라 콘텐츠를 수정하고 JSON으로 반환하세요.
{ "content": "수정된 콘텐츠" }`;
    }

    getSummaryPrompt(text: string, maxLength: number): string {
        return `다음 텍스트를 ${maxLength}자 이내로 요약하세요.
${text}
JSON으로 반환하세요:
{ "summary": "요약 내용" }`;
    }

    getImageSearchPrompt(slideContent: string): string {
        return `다음 슬라이드 내용에 어울리는 이미지를 찾기 위한 검색어 3개를 제안하세요.
${slideContent}
JSON으로 반환하세요:
{ "keywords": ["검색어 1", "검색어 2", "검색어 3"] }`;
    }
}
