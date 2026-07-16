import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';
import { PromptTemplateService } from './prompt-template.service';
import { PrismaService } from '../../prisma/prisma.service';

const outline = {
    title: '신규 서비스 제안',
    slides: [
        { order: 1, title: '제안 개요', type: 'TITLE', keyPoints: ['목표', '기대 효과'] },
        { order: 2, title: '실행 계획', type: 'CONTENT', keyPoints: ['분석', '출시'] },
    ],
};

describe('LlmService contracts', () => {
    let service: LlmService;

    const createService = async (responses: string[]) => {
        const client = {
            chat: {
                completions: {
                    create: jest.fn().mockImplementation(() => Promise.resolve({
                        choices: [{ message: { content: responses.shift() } }],
                    })),
                },
            },
        };

        const module = await Test.createTestingModule({
            providers: [
                LlmService,
                PromptTemplateService,
                { provide: ConfigService, useValue: {} },
                { provide: PrismaService, useValue: {} },
            ],
        }).compile();
        service = module.get(LlmService);
        jest.spyOn(service as any, 'getOpenAIClient').mockResolvedValue({ client, model: 'internal-model' });
        return client.chat.completions.create;
    };

    it('returns a valid Korean outline with exactly the requested slides', async () => {
        await createService([JSON.stringify(outline)]);

        await expect(service.generateOutline({ content: '신규 서비스 제안서', slideCount: 2, language: 'ko' }))
            .resolves.toEqual(outline);
    });

    it('repairs malformed outline JSON using one additional response', async () => {
        const create = await createService(['{not json', JSON.stringify(outline)]);

        await expect(service.generateOutline({ content: '신규 서비스 제안서', slideCount: 2, language: 'ko' }))
            .resolves.toEqual(outline);
        expect(create).toHaveBeenCalledTimes(2);
    });

    it('rejects an outline with a different slide count after one repair', async () => {
        const invalid = { ...outline, slides: [outline.slides[0]] };
        const create = await createService([JSON.stringify(invalid), JSON.stringify(invalid)]);

        await expect(service.generateOutline({ content: '신규 서비스 제안서', slideCount: 2, language: 'ko' }))
            .rejects.toThrow('expected 2 slides');
        expect(create).toHaveBeenCalledTimes(2);
    });

    it('rejects slide content with invalid bullet levels after one repair', async () => {
        const invalid = { heading: '실행 계획', bullets: [{ text: '첫 번째 항목', level: 2 }] };
        const create = await createService([JSON.stringify(invalid), JSON.stringify(invalid)]);

        await expect(service.generateSlideContent({
            title: '실행 계획', type: 'CONTENT', keyPoints: ['분석'], language: 'ko',
        })).rejects.toThrow('bullet level');
        expect(create).toHaveBeenCalledTimes(2);
    });
});
