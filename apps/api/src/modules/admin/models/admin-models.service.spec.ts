// ponytail: this suite still fails to load — the service reaches the OpenAI SDK,
// which needs a Web Fetch runtime jest's node environment withholds, and its
// `openai/shims/node` fix is itself a file jest cannot parse. Needs a
// transformIgnorePatterns entry for openai; left alone because changing the global
// transform broke all fifteen suites when tried.
import { AdminModelsService } from './admin-models.service';

describe('AdminModelsService cache invalidation', () => {
    const prisma = {
        llmModel: {
            create: jest.fn().mockResolvedValue({ id: 'model-1' }),
            update: jest.fn().mockResolvedValue({ id: 'model-1' }),
            delete: jest.fn().mockResolvedValue({ id: 'model-1' }),
            findUnique: jest.fn().mockResolvedValue({ id: 'model-1' }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    const llmService = { invalidateClientCache: jest.fn() };
    let service: AdminModelsService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new AdminModelsService(prisma as any, llmService as any);
    });

    // A changed endpoint/API key/maxTokens must apply immediately — otherwise the
    // running API process silently keeps using the previous config for up to the
    // 5-minute client cache TTL, which looks like the admin's edit did nothing.
    it('invalidates the cached LLM client after create', async () => {
        await service.create({ name: 'Model', provider: 'ollama', modelId: 'm', costPerToken: 0 } as any);
        expect(llmService.invalidateClientCache).toHaveBeenCalledTimes(1);
    });

    it('invalidates the cached LLM client after update', async () => {
        await service.update('model-1', { maxTokens: 140000 } as any);
        expect(llmService.invalidateClientCache).toHaveBeenCalledTimes(1);
    });

    it('invalidates the cached LLM client after delete', async () => {
        await service.delete('model-1');
        expect(llmService.invalidateClientCache).toHaveBeenCalledTimes(1);
    });

    it('invalidates the cached LLM client after setDefault', async () => {
        await service.setDefault('model-1');
        expect(llmService.invalidateClientCache).toHaveBeenCalledTimes(1);
    });
});
