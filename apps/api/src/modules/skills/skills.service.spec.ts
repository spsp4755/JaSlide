import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { SkillsService } from './skills.service';

jest.mock('axios');

describe('SkillsService', () => {
    const prisma = {
        presentationSkill: {
            create: jest.fn(),
            findMany: jest.fn(),
        },
        template: {
            create: jest.fn(),
        },
    };
    const storage = { upload: jest.fn() };
    const service = new SkillsService(prisma as any, { get: jest.fn().mockReturnValue('http://renderer.internal') } as any, storage as any);
    const user = { id: 'user-1', organizationId: 'org-1' };

    beforeEach(() => {
        jest.clearAllMocks();
        (global as any).Blob = class Blob {};
        (global as any).FormData = class FormData {
            append = jest.fn();
        };
    });

    it('lists public, own, and own-organization skills only', async () => {
        prisma.presentationSkill.findMany.mockResolvedValue([]);

        await expect(service.findVisible(user, 'BUSINESS')).resolves.toEqual([]);

        expect(prisma.presentationSkill.findMany).toHaveBeenCalledWith({
            where: {
                AND: [
                    { OR: [{ isPublic: true }, { userId: 'user-1' }, { organizationId: 'org-1' }] },
                    { category: 'BUSINESS' },
                ],
            },
            orderBy: { name: 'asc' },
        });
    });

    it('rejects unsupported executable package fields', async () => {
        await expect(service.create(user, {
            name: '임원 보고',
            category: 'BUSINESS',
            audience: '임원',
            tone: 'formal',
            purpose: '분기 실적 보고',
            outlineGuidance: '핵심 지표부터 제시한다.',
            recommendedSlideCount: 8,
            packageUrl: 'skill.zip',
        } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a reusable private Skill from extracted PPTX style tokens', async () => {
        (axios.post as jest.Mock).mockResolvedValue({
            data: { config: { colors: { primary: '#123456' }, typography: { titleFont: 'Noto Sans KR' } } },
        });
        prisma.template.create.mockResolvedValue({ id: 'template-1' });
        storage.upload.mockResolvedValue({ key: 'templates/executive-report.pptx' });
        prisma.presentationSkill.create.mockResolvedValue({ id: 'skill-1', templateId: 'template-1' });

        await expect(service.importPptx(user, {
            originalname: 'executive-report.pptx',
            mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            size: 1024,
            buffer: Buffer.from('pptx'),
        } as Express.Multer.File, '임원 보고 스타일')).resolves.toEqual({ id: 'skill-1', templateId: 'template-1' });

        expect(prisma.template.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                name: '임원 보고 스타일',
                category: 'BUSINESS',
                config: expect.objectContaining({ pptxTemplate: { storageKey: 'templates/executive-report.pptx', originalname: 'executive-report.pptx' }, source: expect.objectContaining({ storageKey: 'templates/executive-report.pptx' }) }),
                isPublic: false,
                organizationId: 'org-1',
            }),
        });
        expect(prisma.presentationSkill.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                name: '임원 보고 스타일',
                category: 'CUSTOM',
                templateId: 'template-1',
                userId: 'user-1',
                organizationId: 'org-1',
            }),
        });
    });
});
