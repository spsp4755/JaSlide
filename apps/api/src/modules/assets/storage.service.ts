import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';
import { mkdir, unlink, writeFile, readFile } from 'fs/promises';
import { basename, dirname, join, resolve, sep } from 'path';

export interface UploadResult {
    key: string;
    url: string;
    publicUrl: string;
}

@Injectable()
export class StorageService {
    private readonly logger = new Logger(StorageService.name);
    private s3Client: S3Client | null = null;
    private bucket: string;
    private region: string;
    private useLocal: boolean;
    private localDirectory: string;

    constructor(private configService: ConfigService) {
        const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
        const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
        this.bucket = this.configService.get<string>('S3_BUCKET') || 'jaslide-assets';
        this.region = this.configService.get<string>('AWS_REGION') || 'ap-northeast-2';
        this.localDirectory = resolve(this.configService.get<string>('LOCAL_STORAGE_PATH') || join(process.cwd(), 'uploads'));

        // Use local storage if S3 credentials not available
        this.useLocal = !accessKeyId || !secretAccessKey;

        if (!this.useLocal && accessKeyId && secretAccessKey) {
            this.s3Client = new S3Client({
                region: this.region,
                credentials: {
                    accessKeyId: accessKeyId as string,
                    secretAccessKey: secretAccessKey as string,
                },
            });
        }
    }

    async upload(
        file: Express.Multer.File,
        folder: string = 'uploads',
    ): Promise<UploadResult> {
        const key = `${folder}/${uuid()}-${basename(file.originalname)}`;

        if (this.useLocal) {
            // Local file storage fallback
            return this.uploadLocal(file, key);
        }

        try {
            const command = new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: file.buffer,
                ContentType: file.mimetype,
                ACL: 'public-read',
            });

            await this.s3Client!.send(command);

            const publicUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;

            return {
                key,
                url: publicUrl,
                publicUrl,
            };
        } catch (error) {
            this.logger.error('S3 upload failed', error);
            // Fallback to local storage
            return this.uploadLocal(file, key);
        }
    }

    private async uploadLocal(file: Express.Multer.File, key: string): Promise<UploadResult> {
        const destination = this.localPath(key);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.buffer);
        const localUrl = `/uploads/${key}`;

        return {
            key,
            url: localUrl,
            publicUrl: localUrl,
        };
    }

    async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
        if (this.useLocal) {
            return `/uploads/${key}`;
        }

        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        return getSignedUrl(this.s3Client!, command, { expiresIn });
    }

    async delete(key: string): Promise<void> {
        if (this.useLocal) {
            try {
                await unlink(this.localPath(key));
            } catch (error: any) {
                if (error.code !== 'ENOENT') throw error;
            }
            return;
        }

        const command = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        await this.s3Client!.send(command);
    }

    async uploadFromUrl(imageUrl: string, folder: string = 'images'): Promise<UploadResult> {
        try {
            const response = await fetch(imageUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            const contentType = response.headers.get('content-type') || 'image/jpeg';
            const extension = contentType.split('/')[1] || 'jpg';

            const file = {
                buffer,
                originalname: `downloaded.${extension}`,
                mimetype: contentType,
            } as Express.Multer.File;

            return this.upload(file, folder);
        } catch (error) {
            this.logger.error('Failed to upload from URL', error);
            throw error;
        }
    }

    async getBuffer(key: string): Promise<Buffer> {
        if (this.useLocal) return readFile(this.localPath(key));
        const response = await this.s3Client!.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        if (!response.Body) throw new Error('Stored file is empty');
        return Buffer.from(await response.Body.transformToByteArray());
    }

    private localPath(key: string): string {
        const destination = resolve(this.localDirectory, key);
        if (!destination.startsWith(`${this.localDirectory}${sep}`)) {
            throw new Error('Invalid storage key');
        }
        return destination;
    }
}
