import { Injectable } from '@nestjs/common';
import { GenerateOutlineInput, GenerateSlideContentInput, GenerateSlideHtmlInput } from './llm.service';

@Injectable()
export class PromptTemplateService {
    getOutlinePrompt(input: GenerateOutlineInput): string {
        const language = input.language === 'ko' ? 'Write all content in Korean.' : 'Write all content in English.';
        const usedIndexes = new Set(input.usedTemplateIndexes ?? []);
        const templateCatalog = input.templateSlides?.length
            ? `\nTemplate slides (zero-based index):\n${input.templateSlides.map((name, index) => `${index}${usedIndexes.has(index) ? ' (already used)' : ''}: ${name}`).join('\n')}\nChoose the single best templateIndex for each slide based on its purpose, drawing from across the full list above — not only the first few. Do not simply follow sequence. Prefer an index marked "already used" only when no better match exists for that slide's content.\n`
            : '';
        const continuation = input.priorSlideTitles?.length
            ? `\nThis is a continuation of a longer deck. Slides already planned, in order: ${input.priorSlideTitles.map((title, index) => `${index + 1}. ${title}`).join('; ')}. Continue the narrative from here — do not repeat these titles or their themes.\n`
            : '';
        return `You are a professional presentation consultant. Create exactly ${input.slideCount} slides from the source below.
${language}

Source:
---
${input.content.slice(0, 10000)}
---

Use one type per slide: TITLE, CONTENT, BULLET_LIST, TWO_COLUMN, IMAGE, CHART, QUOTE, COMPARISON, SECTION_HEADER.
Make keyPoints specific enough for a writer to create a useful slide: include claims, rationale, implications, examples, or actions rather than generic labels. Give each slide 3 to 5 detailed key points except concise title or section divider slides.${templateCatalog}${continuation}
Return JSON only. Every slide must have consecutive order starting at 1, a non-empty title, a valid type, and 2 to 5 non-empty keyPoints.

{
  "title": "Presentation title",
  "slides": [{ "order": 1, "title": "Slide title", "type": "TITLE", "keyPoints": ["Specific point 1", "Specific point 2"], "templateIndex": 0 }]
}`;
    }

    getSlideContentPrompt(input: GenerateSlideContentInput): string {
        const language = input.language === 'ko' ? 'Write all content in Korean.' : 'Write all content in English.';
        const chartField = input.type === 'CHART'
            ? ',\n  "chart": { "labels": ["Before", "After"], "values": [48, 11], "series": "Safety score" }'
            : '';
        return `Create the content for this presentation slide.
${language}
Title: ${input.title}
Type: ${input.type}
Key points: ${input.keyPoints.join('; ')}
${this.getTypeInstructions(input.type)}
Turn each key point into a specific, concrete bullet — a claim, reason, implication, example, or action — not a restatement of the key point. Keep the slide scannable: 3 to 5 short bullets, each roughly one line (under ~120 characters). Keep body to one short sentence or omit it entirely. Avoid long paragraphs and dense prose; a slide is not a document.

Return JSON only:
{
  "heading": "Main heading",
  "subheading": "Optional subheading",
  "body": "Short explanatory paragraph",
  "bullets": [{ "text": "Concrete bullet", "level": 0 }]${chartField}
}`;
    }

    getSlideHtmlPrompt(input: GenerateSlideHtmlInput): string {
        const language = input.language === 'ko' ? 'Write Korean text.' : 'Write English text.';
        return `Rewrite this complete HTML presentation slide for the requested content. ${language}
Keep the same DOM structure, classes, inline styles, positions, colors, and data-object attributes. Change only human-readable text; do not add markdown.
Title: ${input.title}
Key points: ${input.keyPoints.join('; ')}
Template HTML:
---
${input.templateHtml}
---
Return JSON only: {"html":"complete HTML slide"}`;
    }

    getSlideHtmlEditPrompt(html: string, instruction: string): string {
        return `Edit this complete HTML presentation slide. Keep all structure, classes, inline styles, positions, and data-object attributes unchanged; alter only human-readable text.
Instruction: ${instruction}
HTML:
---
${html}
---
Return JSON only: {"html":"complete HTML slide"}`;
    }

    private getTypeInstructions(type: string): string {
        return ({
            TITLE: 'Write a title and subtitle only.',
            BULLET_LIST: 'Write 3 to 5 detailed bullets.',
            TWO_COLUMN: 'Write balanced comparison bullets.',
            CHART: 'Include a chart object with 2 to 6 numeric labels and values. Use source-supported figures when present. If the source has no numeric figures, use a clearly-labelled editable example chart so the presenter can replace its numbers; do not omit the chart.',
            SECTION_HEADER: 'Write a concise section title only.',
        } as Record<string, string>)[type] || 'Write a short body and useful bullets.';
    }

    getEditPrompt(currentContent: string, instruction: string): string {
        return `You are editing one presentation slide. Its current content as JSON:
---
${currentContent}
---
Apply this instruction: ${instruction}

Return the COMPLETE edited slide as JSON with the same fields (heading, subheading, body, bullets, chart). Keep any field you are not changing. Favor concise, scannable bullets over long paragraphs. Return JSON only:
{
  "heading": "Main heading",
  "subheading": "Optional subheading",
  "body": "Optional short paragraph",
  "bullets": [{ "text": "Concrete bullet", "level": 0 }]
}`;
    }

    getSummaryPrompt(text: string, maxLength: number): string {
        return `Summarize in ${maxLength} characters or fewer:\n${text}\nReturn JSON only: { "summary": "summary" }`;
    }

    getImageSearchPrompt(slideContent: string): string {
        return `Suggest three image search queries for this slide:\n${slideContent}\nReturn JSON only: { "keywords": ["query 1", "query 2", "query 3"] }`;
    }
}
