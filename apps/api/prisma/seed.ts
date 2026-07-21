import { PrismaClient, UserRole, UserStatus, OrganizationPlan, PresentationStatus, SourceType, SlideType, TemplateCategory, AssetType, GenerationStatus, BlockType, CollaboratorRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database with realistic Korean data...');

    // Clean existing data
    await prisma.$executeRaw`TRUNCATE TABLE "PromptTemplateVersion" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "PromptRegistry" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "LlmModel" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "User" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Organization" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Template" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Role" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "ColorPalette" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "FontSet" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "SystemPolicy" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "LayoutRule" CASCADE`;

    // ============================================
    // Organizations
    // ============================================
    const orgs = await Promise.all([
        prisma.organization.create({
            data: {
                name: '삼성전자',
                slug: 'samsung-electronics',
                domain: 'samsung.com',
                plan: OrganizationPlan.ENTERPRISE,
                brandSettings: { primaryColor: '#1428A0', logo: '/logos/samsung.png' },
            },
        }),
        prisma.organization.create({
            data: {
                name: '네이버',
                slug: 'naver',
                domain: 'naver.com',
                plan: OrganizationPlan.PROFESSIONAL,
                brandSettings: { primaryColor: '#03C75A', logo: '/logos/naver.png' },
            },
        }),
        prisma.organization.create({
            data: {
                name: '카카오',
                slug: 'kakao',
                domain: 'kakao.com',
                plan: OrganizationPlan.PROFESSIONAL,
                brandSettings: { primaryColor: '#FEE500', logo: '/logos/kakao.png' },
            },
        }),
    ]);

    // ============================================
    // Users
    // ============================================
    const adminPassword = await bcrypt.hash('admin123', 10);
    const userPassword = await bcrypt.hash('password123', 10);

    const users = await Promise.all([
        prisma.user.create({
            data: {
                email: 'admin@jaslide.com',
                name: '김관리자',
                password: adminPassword,
                role: UserRole.ADMIN,
                status: UserStatus.ACTIVE,
                preferences: { theme: 'dark', language: 'ko' },
            },
        }),
        prisma.user.create({
            data: {
                email: 'jihye.kim@samsung.com',
                name: '김지혜',
                password: userPassword,
                role: UserRole.ORG_ADMIN,
                status: UserStatus.ACTIVE,
                organizationId: orgs[0].id,
                preferences: { theme: 'light', language: 'ko' },
            },
        }),
        prisma.user.create({
            data: {
                email: 'minho.park@naver.com',
                name: '박민호',
                password: userPassword,
                role: UserRole.USER,
                status: UserStatus.ACTIVE,
                organizationId: orgs[1].id,
            },
        }),
        prisma.user.create({
            data: {
                email: 'soyeon.lee@kakao.com',
                name: '이소연',
                password: userPassword,
                role: UserRole.USER,
                status: UserStatus.ACTIVE,
                organizationId: orgs[2].id,
            },
        }),
        prisma.user.create({
            data: {
                email: 'youngho.choi@gmail.com',
                name: '최영호',
                password: userPassword,
                role: UserRole.USER,
                status: UserStatus.ACTIVE,
            },
        }),
    ]);

    // ============================================
    // Roles
    // ============================================
    await Promise.all([
        prisma.role.create({
            data: {
                name: 'super_admin',
                description: '시스템 전체 관리자',
                permissions: ['*'],
                isSystem: true,
            },
        }),
        prisma.role.create({
            data: {
                name: 'org_manager',
                description: '조직 관리자',
                permissions: ['org:read', 'org:write', 'users:read', 'users:write'],
                isSystem: true,
            },
        }),
        prisma.role.create({
            data: {
                name: 'premium_user',
                description: '프리미엄 사용자',
                permissions: ['presentations:*', 'templates:read', 'assets:*'],
                isSystem: false,
            },
        }),
    ]);

    // ============================================
    // Templates
    // ============================================
    const templates = await Promise.all([
        prisma.template.create({
            data: {
                name: '비즈니스 프로페셔널',
                description: '기업 발표용 깔끔한 템플릿',
                category: TemplateCategory.BUSINESS,
                thumbnail: '/templates/business-pro.png',
                isPublic: true,
                config: {
                    colors: { primary: '#2C3E50', secondary: '#3498DB', accent: '#E74C3C' },
                    fonts: { title: 'Pretendard', body: 'Noto Sans KR' },
                    layouts: ['title', 'content', 'two-column', 'chart'],
                },
            },
        }),
        prisma.template.create({
            data: {
                name: '스타트업 피치덱',
                description: '투자 유치용 임팩트 있는 템플릿',
                category: TemplateCategory.BUSINESS,
                thumbnail: '/templates/startup-pitch.png',
                isPublic: true,
                config: {
                    colors: { primary: '#6C5CE7', secondary: '#00CEC9', accent: '#FDCB6E' },
                    fonts: { title: 'Montserrat', body: 'Pretendard' },
                    layouts: ['title', 'problem', 'solution', 'market', 'team'],
                },
            },
        }),
        prisma.template.create({
            data: {
                name: '교육 프레젠테이션',
                description: '온라인 강의 및 교육용 템플릿',
                category: TemplateCategory.EDUCATION,
                thumbnail: '/templates/education.png',
                isPublic: true,
                config: {
                    colors: { primary: '#00B894', secondary: '#0984E3', accent: '#FDCB6E' },
                    fonts: { title: 'Nanum Gothic', body: 'Noto Sans KR' },
                    layouts: ['title', 'lesson', 'quiz', 'summary'],
                },
            },
        }),
        prisma.template.create({
            data: {
                name: '마케팅 캠페인',
                description: '마케팅 제안서용 화려한 템플릿',
                category: TemplateCategory.MARKETING,
                thumbnail: '/templates/marketing.png',
                isPublic: true,
                config: {
                    colors: { primary: '#E17055', secondary: '#00CEC9', accent: '#FFEAA7' },
                    fonts: { title: 'Spoqa Han Sans', body: 'Pretendard' },
                    layouts: ['title', 'strategy', 'metrics', 'timeline'],
                },
            },
        }),
        prisma.template.create({
            data: {
                name: '미니멀 화이트',
                description: '심플하고 깔끔한 미니멀 템플릿',
                category: TemplateCategory.MINIMAL,
                thumbnail: '/templates/minimal-white.png',
                isPublic: true,
                config: {
                    colors: { primary: '#2D3436', secondary: '#636E72', accent: '#74B9FF' },
                    fonts: { title: 'Pretendard', body: 'Pretendard' },
                    layouts: ['title', 'content', 'image'],
                },
            },
        }),
        prisma.template.create({
            data: {
                name: '테크 컨퍼런스',
                description: '기술 발표용 모던 템플릿',
                category: TemplateCategory.TECH,
                thumbnail: '/templates/tech-conf.png',
                isPublic: true,
                config: {
                    colors: { primary: '#0A0A0A', secondary: '#00D4FF', accent: '#FF6B6B' },
                    fonts: { title: 'JetBrains Mono', body: 'Pretendard' },
                    layouts: ['title', 'code', 'architecture', 'demo'],
                },
            },
        }),
    ]);

    // ============================================
    // Presentation Skills (seeded, public — cover the first-gallery categories)
    // ============================================
    await Promise.all([
        prisma.presentationSkill.create({
            data: {
                name: '임원 전략 보고',
                description: '핵심 의사결정과 실행 우선순위를 빠르게 전달합니다.',
                category: '기업 전략',
                audience: '경영진',
                tone: '명확하고 단정하게',
                purpose: '전략 보고',
                outlineGuidance: '핵심 결론을 먼저 제시하고, 근거 데이터와 리스크, 실행 계획 순으로 전개합니다. 각 슬라이드는 하나의 의사결정 포인트만 다룹니다.',
                recommendedSlideCount: 10,
                isPublic: true,
                templateId: templates[0].id,
            },
        }),
        prisma.presentationSkill.create({
            data: {
                name: '교육 과정 안내',
                description: '학습 목표와 과정 흐름을 이해하기 쉽게 구성합니다.',
                category: '교육',
                audience: '학습자',
                tone: '친절하고 구조적으로',
                purpose: '교육',
                outlineGuidance: '학습 목표 제시 후 단계별 커리큘럼, 예제, 요약 순으로 구성합니다. 전문 용어는 풀어서 설명합니다.',
                recommendedSlideCount: 12,
                isPublic: true,
                templateId: templates[2].id,
            },
        }),
        prisma.presentationSkill.create({
            data: {
                name: 'B2B 제안서',
                description: '고객 문제, 해결 방식, 도입 효과를 설득력 있게 연결합니다.',
                category: 'B2B 영업',
                audience: '의사결정자',
                tone: '신뢰감 있게',
                purpose: '제안',
                outlineGuidance: '고객의 문제 정의, 제안 솔루션, 기대 효과, 도입 절차 순으로 전개하며 각 주장에 수치 근거를 포함합니다.',
                recommendedSlideCount: 11,
                isPublic: true,
                templateId: templates[1].id,
            },
        }),
        prisma.presentationSkill.create({
            data: {
                name: '데이터 & KPI 리뷰',
                description: '지표 변화와 다음 액션을 한눈에 읽히도록 정리합니다.',
                category: '데이터 & KPI',
                audience: '운영 리더',
                tone: '간결하고 근거 중심으로',
                purpose: '성과 리뷰',
                outlineGuidance: '기간별 핵심 지표 변화, 원인 분석, 다음 액션 순으로 구성합니다. 슬라이드마다 하나의 지표만 강조합니다.',
                recommendedSlideCount: 9,
                isPublic: true,
                templateId: templates[4].id,
            },
        }),
        prisma.presentationSkill.create({
            data: {
                name: '기술 검토 보고',
                description: '아키텍처와 트레이드오프를 근거와 함께 설명합니다.',
                category: '기술 검토',
                audience: '엔지니어링 리더',
                tone: '정확하고 근거 중심으로',
                purpose: '기술 검토',
                outlineGuidance: '문제 정의, 검토한 대안, 선택 근거, 트레이드오프, 롤아웃 계획 순으로 구성합니다.',
                recommendedSlideCount: 10,
                isPublic: true,
                templateId: templates[5].id,
            },
        }),
        prisma.presentationSkill.create({
            data: {
                name: '마케팅 캠페인 제안',
                description: '캠페인 컨셉과 기대 성과를 설득력 있게 전달합니다.',
                category: '마케팅',
                audience: '마케팅 의사결정자',
                tone: '설득력 있고 생동감 있게',
                purpose: '캠페인 제안',
                outlineGuidance: '시장 배경, 캠페인 컨셉, 채널 전략, 예산과 기대 성과 순으로 구성합니다.',
                recommendedSlideCount: 8,
                isPublic: true,
                templateId: templates[3].id,
            },
        }),
    ]);

    // ============================================
    // Presentations & Slides
    // ============================================
    const presentations = await Promise.all([
        prisma.presentation.create({
            data: {
                title: '2024 Q4 사업 실적 보고',
                description: '4분기 매출 및 성과 분석 자료',
                userId: users[1].id,
                templateId: templates[0].id,
                status: PresentationStatus.COMPLETED,
                sourceType: SourceType.TEXT,
                isPublic: false,
                slides: {
                    create: [
                        { order: 0, type: SlideType.TITLE, title: '2024 Q4 사업 실적 보고', content: { subtitle: '삼성전자 반도체사업부' }, layout: 'center' },
                        { order: 1, type: SlideType.CONTENT, title: '목차', content: { items: ['매출 현황', '시장 점유율', '신제품 출시', '2025 전략'] }, layout: 'left' },
                        { order: 2, type: SlideType.CHART, title: 'Q4 매출 현황', content: { chartType: 'bar', data: { labels: ['10월', '11월', '12월'], values: [45, 52, 61] } }, layout: 'center' },
                        { order: 3, type: SlideType.TWO_COLUMN, title: '시장 점유율 분석', content: { left: { title: '메모리', share: '43.2%' }, right: { title: '시스템LSI', share: '12.8%' } }, layout: 'center' },
                        { order: 4, type: SlideType.BULLET_LIST, title: '2025년 전략', content: { items: ['AI 반도체 투자 확대', 'HBM4 양산 준비', '파운드리 2나노 공정 개발'] }, layout: 'left' },
                    ],
                },
            },
        }),
        prisma.presentation.create({
            data: {
                title: 'AI 스타트업 투자 제안서',
                description: '시리즈 A 투자 유치용 피치덱',
                userId: users[2].id,
                templateId: templates[1].id,
                status: PresentationStatus.COMPLETED,
                sourceType: SourceType.DOCX,
                isPublic: true,
                shareToken: 'pitch-deck-2024',
                slides: {
                    create: [
                        { order: 0, type: SlideType.TITLE, title: 'DeepMind Korea', content: { tagline: 'AI로 비즈니스를 혁신합니다' }, layout: 'center' },
                        { order: 1, type: SlideType.CONTENT, title: '문제 정의', content: { problem: '기업의 80%가 AI 도입에 실패', reason: '전문 인력 부족과 높은 비용' }, layout: 'center' },
                        { order: 2, type: SlideType.CONTENT, title: '솔루션', content: { solution: 'No-code AI 플랫폼', features: ['드래그앤드롭 모델 학습', '자동 최적화', '실시간 배포'] }, layout: 'center' },
                        { order: 3, type: SlideType.CHART, title: '시장 규모', content: { chartType: 'line', tam: '50조원', sam: '5조원', som: '5000억원' }, layout: 'center' },
                        { order: 4, type: SlideType.CONTENT, title: '팀 소개', content: { members: [{ name: '김대표', role: 'CEO', background: 'Google AI 출신' }] }, layout: 'center' },
                    ],
                },
            },
        }),
        prisma.presentation.create({
            data: {
                title: 'Python 기초 강의 1주차',
                description: '프로그래밍 입문자를 위한 파이썬 기초',
                userId: users[3].id,
                templateId: templates[2].id,
                status: PresentationStatus.COMPLETED,
                sourceType: SourceType.MARKDOWN,
                isPublic: true,
                slides: {
                    create: [
                        { order: 0, type: SlideType.TITLE, title: 'Python 기초 1주차', content: { subtitle: '변수와 자료형' }, layout: 'center' },
                        { order: 1, type: SlideType.CONTENT, title: '학습 목표', content: { objectives: ['변수 선언 방법', '기본 자료형 이해', '형변환 활용'] }, layout: 'left' },
                        { order: 2, type: SlideType.CONTENT, title: '변수란?', content: { definition: '데이터를 저장하는 공간', example: 'name = "홍길동"' }, layout: 'center' },
                    ],
                },
            },
        }),
        prisma.presentation.create({
            data: {
                title: '2025 신제품 마케팅 전략',
                description: '카카오 신규 서비스 런칭 마케팅 계획',
                userId: users[3].id,
                templateId: templates[3].id,
                status: PresentationStatus.DRAFT,
                sourceType: SourceType.TEXT,
                slides: {
                    create: [
                        { order: 0, type: SlideType.TITLE, title: '2025 신제품 마케팅 전략', content: { subtitle: 'KakaoTalk 비즈니스' }, layout: 'center' },
                        { order: 1, type: SlideType.TIMELINE, title: '런칭 타임라인', content: { events: [{ date: '1월', event: '베타 테스트' }, { date: '3월', event: '정식 출시' }] }, layout: 'center' },
                    ],
                },
            },
        }),
    ]);

    // ============================================
    // LLM Models
    // ============================================
    await Promise.all([
        prisma.llmModel.create({ data: { name: 'GPT-4 Turbo', provider: 'openai', modelId: 'gpt-4-turbo-preview', apiKeyEnvVar: 'OPENAI_API_KEY', maxTokens: 128000, costPerToken: 0.00003, isDefault: false } }),
        prisma.llmModel.create({ data: { name: 'GPT-3.5 Turbo', provider: 'openai', modelId: 'gpt-3.5-turbo', apiKeyEnvVar: 'OPENAI_API_KEY', maxTokens: 16384, costPerToken: 0.000002 } }),
        prisma.llmModel.create({ data: { name: 'GPT-4o', provider: 'openai', modelId: 'gpt-4o', apiKeyEnvVar: 'OPENAI_API_KEY', maxTokens: 128000, costPerToken: 0.000025 } }),
        prisma.llmModel.create({ data: { name: 'Claude 3 Opus', provider: 'anthropic', modelId: 'claude-3-opus-20240229', apiKeyEnvVar: 'ANTHROPIC_API_KEY', maxTokens: 200000, costPerToken: 0.00006 } }),
        prisma.llmModel.create({ data: { name: 'Claude 3.5 Sonnet', provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022', apiKeyEnvVar: 'ANTHROPIC_API_KEY', maxTokens: 200000, costPerToken: 0.000015 } }),
        prisma.llmModel.create({ data: { name: 'Gemini Pro', provider: 'google', modelId: 'gemini-pro', apiKeyEnvVar: 'GOOGLE_AI_KEY', maxTokens: 32768, costPerToken: 0.00001 } }),
        prisma.llmModel.create({ data: { name: 'Gemini 1.5 Pro', provider: 'google', modelId: 'gemini-1.5-pro', apiKeyEnvVar: 'GOOGLE_AI_KEY', maxTokens: 1000000, costPerToken: 0.000007 } }),
        prisma.llmModel.create({ data: { name: 'vLLM Llama 3.1', provider: 'vllm', modelId: 'meta-llama/Llama-3.1-70B-Instruct', endpoint: 'http://localhost:8000/v1', apiKeyEnvVar: 'VLLM_API_KEY', maxTokens: 128000, costPerToken: 0.0000015 } }),
        prisma.llmModel.create({ data: { name: 'vLLM Qwen 2.5', provider: 'vllm', modelId: 'Qwen/Qwen2.5-72B-Instruct', endpoint: 'http://localhost:8000/v1', apiKeyEnvVar: 'VLLM_API_KEY', maxTokens: 32768, costPerToken: 0.000002 } }),
        prisma.llmModel.create({ data: { name: 'Azure GPT-4', provider: 'azure', modelId: 'gpt-4', endpoint: 'https://your-resource.openai.azure.com/', apiKeyEnvVar: 'AZURE_OPENAI_KEY', maxTokens: 8192, costPerToken: 0.00003 } }),
        // Local LLM models (no API key required)
        prisma.llmModel.create({ data: { name: 'Ollama GPT-OSS 20B', provider: 'ollama', modelId: 'gpt-oss:20b', endpoint: 'http://localhost:11434/v1', maxTokens: 32768, costPerToken: 0, isDefault: true } }),
        prisma.llmModel.create({ data: { name: 'vLLM GPT-OSS', provider: 'vllm', modelId: 'vllm/gptoss', endpoint: 'https://vllm.xxxxxxx.com/v1', maxTokens: 32768, costPerToken: 0 } }),
    ]);

    // ============================================
    // Prompt Templates
    // ============================================
    const prompts = await Promise.all([
        prisma.promptRegistry.create({
            data: {
                name: 'presentation_outline',
                category: 'outline',
                description: '프레젠테이션 개요 생성용 프롬프트',
                versions: {
                    create: {
                        version: 1,
                        content: '다음 주제에 대한 프레젠테이션 개요를 작성해주세요:\n주제: {{topic}}\n목적: {{purpose}}\n대상: {{audience}}\n슬라이드 수: {{slideCount}}',
                        variables: ['topic', 'purpose', 'audience', 'slideCount'],
                        isActive: true,
                    },
                },
            },
        }),
        prisma.promptRegistry.create({
            data: {
                name: 'slide_content',
                category: 'content',
                description: '개별 슬라이드 내용 생성용 프롬프트',
                versions: {
                    create: {
                        version: 1,
                        content: '다음 슬라이드의 내용을 작성해주세요:\n제목: {{title}}\n유형: {{slideType}}\n키포인트: {{keyPoints}}',
                        variables: ['title', 'slideType', 'keyPoints'],
                        isActive: true,
                    },
                },
            },
        }),
        prisma.promptRegistry.create({
            data: {
                name: 'design_suggestion',
                category: 'design',
                description: '슬라이드 디자인 제안용 프롬프트',
                versions: {
                    create: {
                        version: 1,
                        content: '다음 슬라이드에 적합한 디자인 요소를 제안해주세요:\n슬라이드 유형: {{slideType}}\n내용: {{content}}\n브랜드 컬러: {{brandColor}}\n분위기: {{mood}}',
                        variables: ['slideType', 'content', 'brandColor', 'mood'],
                        isActive: true,
                    },
                },
            },
        }),
        prisma.promptRegistry.create({
            data: {
                name: 'speaker_notes',
                category: 'content',
                description: '발표자 노트 생성용 프롬프트',
                versions: {
                    create: {
                        version: 1,
                        content: '다음 슬라이드에 대한 발표자 노트를 작성해주세요:\n슬라이드 제목: {{title}}\n슬라이드 내용: {{content}}\n발표 시간: {{duration}}분\n청중 수준: {{audienceLevel}}',
                        variables: ['title', 'content', 'duration', 'audienceLevel'],
                        isActive: true,
                    },
                },
            },
        }),
        prisma.promptRegistry.create({
            data: {
                name: 'document_summary',
                category: 'generation',
                description: '문서 요약 및 핵심 추출용 프롬프트',
                versions: {
                    create: {
                        version: 1,
                        content: '다음 문서의 핵심 내용을 요약하고 프레젠테이션에 사용할 주요 포인트를 추출해주세요:\n문서 유형: {{documentType}}\n문서 내용: {{documentContent}}\n목표 슬라이드 수: {{targetSlides}}',
                        variables: ['documentType', 'documentContent', 'targetSlides'],
                        isActive: true,
                    },
                },
            },
        }),
        prisma.promptRegistry.create({
            data: {
                name: 'chart_recommendation',
                category: 'design',
                description: '데이터 시각화 차트 추천용 프롬프트',
                versions: {
                    create: {
                        version: 1,
                        content: '다음 데이터에 가장 적합한 차트 유형을 추천하고 시각화 방법을 제안해주세요:\n데이터 유형: {{dataType}}\n데이터 포인트 수: {{dataPoints}}\n비교 목적: {{comparisonGoal}}\n청중: {{audience}}',
                        variables: ['dataType', 'dataPoints', 'comparisonGoal', 'audience'],
                        isActive: true,
                    },
                },
            },
        }),
    ]);

    // ============================================
    // Color Palettes & Font Sets
    // ============================================
    await Promise.all([
        prisma.colorPalette.create({ data: { name: '코퍼레이트 블루', colors: ['#1E3A5F', '#3D5A80', '#98C1D9', '#E0FBFC', '#293241'], isPublic: true } }),
        prisma.colorPalette.create({ data: { name: '네이처 그린', colors: ['#2D6A4F', '#40916C', '#52B788', '#95D5B2', '#D8F3DC'], isPublic: true } }),
        prisma.colorPalette.create({ data: { name: '선셋 오렌지', colors: ['#D00000', '#DC2F02', '#E85D04', '#F48C06', '#FFBA08'], isPublic: true } }),
        prisma.colorPalette.create({ data: { name: '모던 퍼플', colors: ['#7400B8', '#6930C3', '#5E60CE', '#5390D9', '#4EA8DE'], isPublic: true } }),
    ]);

    await Promise.all([
        prisma.fontSet.create({ data: { name: '프로페셔널 한글', titleFont: 'Pretendard', bodyFont: 'Noto Sans KR', headingFont: 'Pretendard', isPublic: true } }),
        prisma.fontSet.create({ data: { name: '클래식 한글', titleFont: 'Nanum Myeongjo', bodyFont: 'Nanum Gothic', headingFont: 'Nanum Myeongjo', isPublic: true } }),
        prisma.fontSet.create({ data: { name: '모던 믹스', titleFont: 'Montserrat', bodyFont: 'Pretendard', headingFont: 'Poppins', isPublic: true } }),
    ]);

    // ============================================
    // System Policies
    // ============================================
    await Promise.all([
        prisma.systemPolicy.create({ data: { category: 'security', key: 'session_timeout', value: { minutes: 60 }, description: '세션 타임아웃 시간' } }),
        prisma.systemPolicy.create({ data: { category: 'limits', key: 'max_slides_per_presentation', value: { limit: 50 }, description: '프레젠테이션당 최대 슬라이드 수' } }),
        prisma.systemPolicy.create({ data: { category: 'limits', key: 'max_file_upload_size', value: { mb: 100 }, description: '최대 파일 업로드 크기' } }),
        prisma.systemPolicy.create({ data: { category: 'retention', key: 'deleted_presentation_retention', value: { days: 30 }, description: '삭제된 프레젠테이션 보관 기간' } }),
    ]);

    // ============================================
    // Assets
    // ============================================
    await Promise.all([
        prisma.asset.create({ data: { type: AssetType.LOGO, name: '삼성전자 로고', url: '/assets/samsung-logo.png', size: 45000, mimeType: 'image/png', organizationId: orgs[0].id } }),
        prisma.asset.create({ data: { type: AssetType.BACKGROUND, name: '그라데이션 배경 1', url: '/assets/gradient-bg-1.jpg', size: 250000, mimeType: 'image/jpeg', userId: users[0].id } }),
        prisma.asset.create({ data: { type: AssetType.ICON, name: '비즈니스 아이콘 팩', url: '/assets/business-icons.svg', size: 12000, mimeType: 'image/svg+xml', userId: users[0].id } }),
    ]);

    // ============================================
    // Layout Rules
    // ============================================
    await Promise.all([
        prisma.layoutRule.create({ data: { name: '타이틀 중앙 정렬', slideType: 'TITLE', config: { titleAlign: 'center', subtitleAlign: 'center', verticalAlign: 'middle' }, isDefault: true } }),
        prisma.layoutRule.create({ data: { name: '콘텐츠 좌측 정렬', slideType: 'CONTENT', config: { titleAlign: 'left', contentAlign: 'left', padding: 40 }, isDefault: true } }),
        prisma.layoutRule.create({ data: { name: '차트 중앙 배치', slideType: 'CHART', config: { chartPosition: 'center', legendPosition: 'bottom', animateData: true }, isDefault: true } }),
    ]);

    console.log('✅ Seed completed successfully!');
    console.log(`   - ${orgs.length} organizations`);
    console.log(`   - ${users.length} users`);
    console.log(`   - ${templates.length} templates`);
    console.log(`   - ${presentations.length} presentations`);
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
