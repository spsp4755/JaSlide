import {
    IsString,
    IsOptional,
    IsInt,
    IsEnum,
    IsObject,
    IsArray,
    ValidateNested,
    ArrayMinSize,
    Min,
    Max,
} from 'class-validator';
import { Type } from 'class-transformer';
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

export class OutlineSlideDto {
    @ApiProperty({ example: 1 })
    @IsInt()
    order: number;

    @ApiProperty({ example: '시장 개요' })
    @IsString()
    title: string;

    @ApiProperty({ example: 'CONTENT' })
    @IsString()
    type: string;

    @ApiProperty({ type: [String], example: ['핵심 요점 1', '핵심 요점 2'] })
    @IsArray()
    @IsString({ each: true })
    keyPoints: string[];

    @ApiPropertyOptional({ example: 4, description: 'Selected ZIP template slide index, starting at zero' })
    @IsInt()
    @Min(0)
    @IsOptional()
    templateIndex?: number;
}

export class OutlineDto {
    @ApiProperty({ example: '2026년 사업 계획' })
    @IsString()
    title: string;

    @ApiProperty({ type: [OutlineSlideDto] })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => OutlineSlideDto)
    slides: OutlineSlideDto[];
}

// Outline-only request: generates an editable outline without creating any job.
export class GenerateOutlineDto {
    @ApiProperty({ enum: SourceType, example: SourceType.TEXT })
    @IsEnum(SourceType)
    @IsOptional()
    sourceType?: SourceType;

    @ApiProperty({ example: 'Content to generate an outline from...' })
    @IsString()
    content: string;

    @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 30 })
    @IsInt()
    @Min(1)
    @Max(30)
    @IsOptional()
    slideCount?: number;

    @ApiPropertyOptional({ example: 'ko' })
    @IsString()
    @IsOptional()
    language?: string;

    @ApiPropertyOptional({ description: '선택한 발표 Skill ID' })
    @IsString()
    @IsOptional()
    skillId?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    templateId?: string;

    @ApiPropertyOptional({ type: GenerationOptionsDto })
    @IsObject()
    @IsOptional()
    options?: GenerationOptionsDto;
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

    @ApiProperty({ example: 10, minimum: 1, maximum: 30 })
    @IsInt()
    @Min(1)
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

    @ApiPropertyOptional({ type: OutlineDto, description: '검토·수정한 아웃라인. 있으면 아웃라인 생성 단계를 건너뜁니다.' })
    @ValidateNested()
    @Type(() => OutlineDto)
    @IsOptional()
    outline?: OutlineDto;
}

export class AIEditDto {
    @ApiPropertyOptional({ description: 'Single slide to edit' })
    @IsOptional()
    @IsString()
    slideId?: string;

    @ApiPropertyOptional({ type: [String], description: 'Multiple slides to edit with the same instruction' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    slideIds?: string[];

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
