import axios from 'axios';
import { AdminOperationsService } from './admin-operations.service';

jest.mock('axios');

describe('AdminOperationsService', () => {
    const prisma = {
        llmModel: { findUnique: jest.fn() },
    };
    const axiosGet = axios.get as jest.Mock;
    let service: AdminOperationsService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new AdminOperationsService(prisma as any);
        process.env.INTERNAL_LLM_API_KEY = 'test-key';
    });

    afterEach(() => {
        delete process.env.INTERNAL_LLM_API_KEY;
    });

    it('checks an OpenAI-compatible model endpoint without returning its API key', async () => {
        prisma.llmModel.findUnique.mockResolvedValue({
            id: 'model-1',
            name: 'Internal Ollama',
            provider: 'ollama',
            endpoint: 'http://ollama:11434/v1/',
            apiKey: null,
            apiKeyEnvVar: 'INTERNAL_LLM_API_KEY',
        });
        axiosGet.mockResolvedValue({ status: 200 });

        const result = await service.testModel('model-1');

        expect(axiosGet).toHaveBeenCalledWith('http://ollama:11434/v1/models', {
            headers: { Authorization: 'Bearer test-key' },
            timeout: 10_000,
        });
        expect(result).toEqual(expect.objectContaining({ success: true, model: 'Internal Ollama' }));
        expect(JSON.stringify(result)).not.toContain('test-key');
    });

    it('reports a missing endpoint instead of claiming the model is healthy', async () => {
        prisma.llmModel.findUnique.mockResolvedValue({
            id: 'model-1',
            name: 'Internal vLLM',
            provider: 'vllm',
            endpoint: null,
            apiKey: null,
            apiKeyEnvVar: null,
        });

        await expect(service.testModel('model-1')).resolves.toEqual({
            success: false,
            error: 'Model endpoint is not configured',
        });
        expect(axiosGet).not.toHaveBeenCalled();
    });
});
