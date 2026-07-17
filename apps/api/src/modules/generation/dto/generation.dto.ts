import {
    IsString,
    IsOptional,
    IsInt,
    IsEnum,
    IsObject,
    Min,
    Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SourceType {
    TEXT = 'TEXT',
    DOCX = 'DOCX',
    PDF = 'PDF',
    MARKDOWN = 'MARKDOWN',
    CSV = 'CSV',
    URL = 'URL',
}

export class GenerationOptionsDto {
    @ApiPropertyOptional({ example: true })
    @IsOptional()
    includeImages?: boolean;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    includeCharts?: boolean;

    @ApiPropertyOptional({ enum: ['professional', 'casual', 'academic', 'creative'] })
    @IsString()
    @IsOptional()
    style?: string;

    @ApiPropertyOptional({ enum: ['formal', 'friendly', 'persuasive', 'informative'] })
    @IsString()
    @IsOptional()
    tone?: string;
}

export class StartGenerationDto {
    @ApiPropertyOptional({ example: 'My Presentation' })
    @IsString()
    @IsOptional()
    title?: string;

    @ApiProperty({ enum: SourceType, example: SourceType.TEXT })
    @IsEnum(SourceType)
    sourceType: SourceType;

    @ApiProperty({ example: 'Content to generate slides from...' })
    @IsString()
    content: string;

    @ApiProperty({ example: 10, minimum: 3, maximum: 30 })
    @IsInt()
    @Min(3)
    @Max(30)
    slideCount: number;

    @ApiPropertyOptional({ example: 'ko' })
    @IsString()
    @IsOptional()
    language?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    templateId?: string;

    @ApiPropertyOptional({ description: '선택한 발표 Skill ID' })
    @IsString()
    @IsOptional()
    skillId?: string;

    @ApiPropertyOptional({ type: GenerationOptionsDto })
    @IsObject()
    @IsOptional()
    options?: GenerationOptionsDto;
}

export class AIEditDto {
    @ApiProperty()
    @IsString()
    slideId: string;

    @ApiProperty({ example: 'Make this more concise' })
    @IsString()
    instruction: string;
}

export class EstimateCostDto {
    @ApiProperty({ example: 10 })
    @IsInt()
    @Min(1)
    @Max(50)
    slideCount: number;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    includeImages?: boolean;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    includeCharts?: boolean;

    @ApiPropertyOptional({ enum: ['pptx', 'pdf', 'google-slides'] })
    @IsString()
    @IsOptional()
    exportFormat?: string;
}
