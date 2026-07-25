import { MultipartUtf8Interceptor } from './multipart-utf8.interceptor';

const run = (request: any) => {
    const next = { handle: jest.fn().mockReturnValue('handled') };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    new MultipartUtf8Interceptor().intercept(context, next as any);
    return request;
};

const multipart = (body: any, file?: any) => ({
    headers: { 'content-type': 'multipart/form-data; boundary=x' },
    body,
    file,
});

// Busboy hands multer latin1-decoded bytes, so this is exactly what a Korean
// name looks like by the time a controller sees it.
const mojibake = (value: string) => Buffer.from(value, 'utf8').toString('latin1');

describe('MultipartUtf8Interceptor', () => {
    it('restores Korean text fields mangled by busboy latin1 decoding', () => {
        const request = run(multipart({ name: mojibake('주간 업무 보고'), category: 'CUSTOM' }));

        expect(request.body.name).toBe('주간 업무 보고');
        expect(request.body.category).toBe('CUSTOM');
    });

    it('restores the uploaded file name and composes decomposed Hangul', () => {
        // macOS sends NFD, which renders as broken jamo in the template list.
        const request = run(multipart({}, { originalname: mojibake('박태지_보고.pptx'.normalize('NFD')) }));

        expect(request.file.originalname).toBe('박태지_보고.pptx');
    });

    it('leaves JSON requests alone', () => {
        const body = { name: '주간 업무 보고' };
        const request = run({ headers: { 'content-type': 'application/json' }, body });

        expect(request.body.name).toBe('주간 업무 보고');
    });

    it('leaves plain ASCII multipart values untouched', () => {
        const request = run(multipart({ name: 'Quarterly Review' }));

        expect(request.body.name).toBe('Quarterly Review');
    });
});
