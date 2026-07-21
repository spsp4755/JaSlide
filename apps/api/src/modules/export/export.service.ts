import { Injectable, Logger, NotFoundException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fontkit = require('fontkit');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PptxGenJS = require('pptxgenjs');



@Injectable()
export class ExportService {
    private rendererUrl: string;
    private readonly logger = new Logger(ExportService.name);

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
    ) {
        this.rendererUrl = this.configService.get<string>('RENDERER_URL') || 'http://localhost:8000';
    }

    private rendererError(error: any): string {
        const data = error.response?.data;
        const detail = data?.detail || data?.toString?.() || error.message || 'unknown error';
        return `${error.response?.status ?? 'request'} ${detail}`;
    }

    async exportToPptx(presentationId: string, userId: string) {
        const presentation = await this.getPresentation(presentationId, userId);

        try {
            // Try external renderer first
            const response = await axios.post(
                `${this.rendererUrl}/api/render/pptx`,
                {
                    presentation: {
                        id: presentation.id,
                        title: presentation.title,
                        slides: presentation.slides,
                        template: presentation.template,
                    },
                },
                {
                    responseType: 'arraybuffer',
                    timeout: 5000,
                },
            );

            return {
                buffer: response.data,
                filename: `${presentation.title}.pptx`,
                mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            };
        } catch (error: any) {
            this.logger.error(`PPTX export failed: ${this.rendererError(error)}`);
            throw new ServiceUnavailableException('Presentation renderer is unavailable');
        }
    }

    private async generatePptxNative(presentation: any) {
        const pptx = new PptxGenJS();
        pptx.title = presentation.title || 'Untitled Presentation';
        pptx.author = 'JaSlide';

        for (const slide of presentation.slides) {
            const pptxSlide = pptx.addSlide();
            const content = slide.content || {};

            let yPos = 0.3; // Start closer to top

            // Add title
            const title = content.heading || slide.title || '';
            if (title) {
                pptxSlide.addText(title, {
                    x: 0.4,
                    y: yPos,
                    w: '92%',
                    h: 0.8,
                    fontSize: 28,
                    bold: true,
                    color: '363636',
                });
                yPos += 0.9;
            }

            // Add subtitle/subheading
            const subheading = content.subheading || '';
            if (subheading) {
                pptxSlide.addText(subheading, {
                    x: 0.4,
                    y: yPos,
                    w: '92%',
                    h: 0.4,
                    fontSize: 16,
                    color: '666666',
                });
                yPos += 0.5;
            }

            // Add body text
            const body = content.body || '';
            if (body) {
                pptxSlide.addText(body, {
                    x: 0.4,
                    y: yPos,
                    w: '92%',
                    h: 1.5,
                    fontSize: 13,
                    color: '444444',
                    valign: 'top',
                });
                yPos += 1.6;
            }

            // Add bullet points
            const bullets = content.bullets || [];
            if (bullets.length > 0) {
                const bulletText = bullets.map((b: any) => ({
                    text: typeof b === 'string' ? b : b.text || '',
                    options: { bullet: true, indentLevel: 0 },
                }));
                pptxSlide.addText(bulletText, {
                    x: 0.4,
                    y: yPos,
                    w: '92%',
                    h: 4 - yPos, // Fill remaining space
                    fontSize: 13,
                    color: '444444',
                    valign: 'top',
                });
            }

            // Add slide notes if present
            if (slide.notes) {
                pptxSlide.addNotes(slide.notes);
            }
        }

        const buffer = await pptx.write({ outputType: 'nodebuffer' });

        return {
            buffer: buffer as Buffer,
            filename: `${presentation.title || 'presentation'}.pptx`,
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        };
    }

    async exportToPdf(presentationId: string, userId: string) {
        const presentation = await this.getPresentation(presentationId, userId);

        try {
            const response = await axios.post(
                `${this.rendererUrl}/api/render/pdf`,
                {
                    presentation: {
                        id: presentation.id,
                        title: presentation.title,
                        slides: presentation.slides,
                        template: presentation.template,
                    },
                },
                {
                    responseType: 'arraybuffer',
                    timeout: 5000,
                },
            );

            return {
                buffer: response.data,
                filename: `${presentation.title}.pdf`,
                mimeType: 'application/pdf',
            };
        } catch (error: any) {
            this.logger.error(`PDF export failed: ${this.rendererError(error)}`);
            throw new ServiceUnavailableException('Presentation renderer is unavailable');
        }
    }

    private async generatePdfNative(presentation: any): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
        // Use pdf-lib for reliable PDF generation without automatic page breaks
        const pdfDoc = await PDFDocument.create();

        // Register fontkit for custom fonts
        pdfDoc.registerFontkit(fontkit);

        // Load Korean font
        const fontPath = path.join(process.cwd(), 'src/assets/fonts');
        const regularFontBytes = fs.readFileSync(path.join(fontPath, 'NotoSansKR-Regular.otf'));
        const boldFontBytes = fs.readFileSync(path.join(fontPath, 'NotoSansKR-Bold.otf'));

        const regularFont = await pdfDoc.embedFont(regularFontBytes);
        const boldFont = await pdfDoc.embedFont(boldFontBytes);

        // A4 Landscape dimensions
        const pageWidth = 842;
        const pageHeight = 595;

        for (let i = 0; i < presentation.slides.length; i++) {
            const slide = presentation.slides[i];
            const page = pdfDoc.addPage([pageWidth, pageHeight]);

            const content = slide.content || {};
            let yPos = pageHeight - 50; // Start from top (PDF coordinates are bottom-up)

            // Title
            const title = content.heading || slide.title || '';
            if (title) {
                const titleSize = 26;
                page.drawText(title, {
                    x: 40,
                    y: yPos - titleSize,
                    size: titleSize,
                    font: boldFont,
                    color: rgb(0.21, 0.21, 0.21),
                    maxWidth: pageWidth - 80,
                });
                yPos -= titleSize + 20;
            }

            // Subheading
            const subheading = content.subheading || '';
            if (subheading) {
                const subSize = 15;
                page.drawText(subheading, {
                    x: 40,
                    y: yPos - subSize,
                    size: subSize,
                    font: regularFont,
                    color: rgb(0.4, 0.4, 0.4),
                    maxWidth: pageWidth - 80,
                });
                yPos -= subSize + 15;
            }

            // Body text
            const body = content.body || '';
            if (body) {
                const bodySize = 12;
                // Split body into lines for proper rendering
                const lines = this.wrapText(body, pageWidth - 80, bodySize, regularFont);
                for (const line of lines) {
                    if (yPos < 80) break; // Stop before page bottom
                    page.drawText(line, {
                        x: 40,
                        y: yPos - bodySize,
                        size: bodySize,
                        font: regularFont,
                        color: rgb(0.27, 0.27, 0.27),
                    });
                    yPos -= bodySize + 4;
                }
                yPos -= 10;
            }

            // Bullet points
            const bullets = content.bullets || [];
            if (bullets.length > 0) {
                const bulletSize = 12;
                for (const bullet of bullets) {
                    if (yPos < 80) break; // Stop before page bottom
                    const bulletText = typeof bullet === 'string' ? bullet : bullet.text || '';
                    if (bulletText) {
                        const fullText = `• ${bulletText}`;
                        const lines = this.wrapText(fullText, pageWidth - 100, bulletSize, regularFont);
                        for (const line of lines) {
                            if (yPos < 80) break;
                            page.drawText(line, {
                                x: 50,
                                y: yPos - bulletSize,
                                size: bulletSize,
                                font: regularFont,
                                color: rgb(0.27, 0.27, 0.27),
                            });
                            yPos -= bulletSize + 3;
                        }
                    }
                }
            }

            // Slide number at bottom
            const slideNum = `${i + 1} / ${presentation.slides.length}`;
            const numWidth = regularFont.widthOfTextAtSize(slideNum, 9);
            page.drawText(slideNum, {
                x: pageWidth - 40 - numWidth,
                y: 30,
                size: 9,
                font: regularFont,
                color: rgb(0.6, 0.6, 0.6),
            });
        }

        const pdfBytes = await pdfDoc.save();

        return {
            buffer: Buffer.from(pdfBytes),
            filename: `${presentation.title || 'presentation'}.pdf`,
            mimeType: 'application/pdf',
        };
    }

    // Helper function to wrap text
    private wrapText(text: string, maxWidth: number, fontSize: number, font: any): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const width = font.widthOfTextAtSize(testLine, fontSize);

            if (width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines;
    }

    async exportToGoogleSlides(presentationId: string, userId: string, accessToken: string) {
        const presentation = await this.getPresentation(presentationId, userId);

        // This would integrate with Google Slides API
        // For now, return placeholder
        return {
            success: true,
            googleSlidesUrl: `https://docs.google.com/presentation/d/placeholder`,
            message: 'Google Slides export would be created here',
        };
    }

    async getExportPreview(presentationId: string, userId: string, slideIndex?: number) {
        const presentation = await this.getPresentation(presentationId, userId);

        try {
            const response = await axios.post(
                `${this.rendererUrl}/api/render/preview`,
                {
                    presentation: {
                        id: presentation.id,
                        title: presentation.title,
                        slides: presentation.slides,
                        template: presentation.template,
                    },
                    slideIndex: slideIndex ?? 0,
                },
                {
                    responseType: 'arraybuffer',
                    timeout: 5000,
                },
            );

            return {
                buffer: response.data,
                mimeType: 'image/png',
            };
        } catch (error) {
            throw new BadRequestException('Failed to generate preview');
        }
    }

    private async getPresentation(id: string, userId: string) {
        const presentation = await this.prisma.presentation.findFirst({
            where: { id, userId },
            include: {
                slides: { orderBy: { order: 'asc' } },
                template: true,
            },
        });

        if (!presentation) {
            throw new NotFoundException('Presentation not found');
        }

        return presentation;
    }
}

