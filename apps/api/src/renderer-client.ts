import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';

const logger = new Logger('RendererClient');

/**
 * POST a multipart form to the renderer and return its JSON body.
 *
 * A renderer that is unreachable, timing out, or erroring is an infrastructure
 * fault, not a bad upload. Every call site used to swallow the cause in a bare
 * `catch {}` and raise the same generic 400, so a renderer that had simply lost
 * its network looked exactly like a corrupt PPTX — undiagnosable from the UI or
 * the logs. Keep the two apart, and always log the underlying reason.
 */
export async function postToRenderer<T>(
    rendererUrl: string,
    path: string,
    form: FormData,
    options: { timeout: number; rejectedMessage: string },
): Promise<T> {
    try {
        const response = await axios.post(`${rendererUrl}${path}`, form, { timeout: options.timeout });
        return response.data as T;
    } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const detail = axios.isAxiosError(error) ? error.response?.data?.detail : undefined;
        logger.error(`Renderer ${path} failed (HTTP ${status ?? 'no response'}): ${error instanceof Error ? error.message : String(error)}`);

        // Only a 4xx means the renderer read the file and rejected it.
        if (status && status >= 400 && status < 500) {
            throw new BadRequestException(typeof detail === 'string' && detail ? detail : options.rejectedMessage);
        }
        throw new ServiceUnavailableException('렌더링 서비스에 연결할 수 없습니다. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.');
    }
}
