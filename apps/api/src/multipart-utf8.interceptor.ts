import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * multer 1.4.x calls Busboy without `defParamCharset`, so Busboy falls back to
 * latin1 for every multipart text field and filename. A Korean template name
 * or file name therefore reaches the app as mojibake ("박태지" → "á...").
 *
 * Re-read those bytes as UTF-8 at the request boundary, before any controller
 * or DTO sees them. macOS sends decomposed Hangul, so compose it too.
 */
const toUtf8 = (value: string): string =>
    /[-ÿ]/.test(value) ? Buffer.from(value, 'latin1').toString('utf8').normalize('NFC') : value;

@Injectable()
export class MultipartUtf8Interceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        if (String(request?.headers?.['content-type'] || '').includes('multipart/form-data')) {
            for (const [key, value] of Object.entries(request.body || {})) {
                if (typeof value === 'string') request.body[key] = toUtf8(value);
            }
            for (const file of [request.file, ...(Array.isArray(request.files) ? request.files : [])]) {
                if (file?.originalname) file.originalname = toUtf8(file.originalname);
            }
        }
        return next.handle();
    }
}
