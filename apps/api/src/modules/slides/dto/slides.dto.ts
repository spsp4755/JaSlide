import {
    IsString,
    IsOptional,
    IsInt,
    IsEnum,
    IsObject,
    IsArray,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SlideType {
    TITLE = 'TITLE',
    CONTENT = 'CONTENT',
    TWO_COLUMN = 'TWO_COLUMN',
    IMAGE = 'IMAGE',
    CHART = 'CHART',
    QUOTE = 'QUOTE',
    BULLET_LIST = 'BULLET_LIST',
    COMPARISON = 'COMPARISON',
    TIMELINE = 'TIMELINE',
    SECTION_HEADER = 'SECTION_HEADER',
    BLANK = 'BLANK',
}

export class CreateSlideDto {
    @ApiProperty({ enum: SlideType, example: SlideType.CONTENT })
    @IsEnum(SlideType)
    type: SlideType;

    @ApiPropertyOptional({ example: 'Slide Title' })
    @IsString()
    @IsOptional()
    title?: string;

    @ApiProperty({ example: { heading: 'Test', bullets: [] } })
    @IsObject()
    content: Record<string, any>;

    @ApiPropertyOptional({ example: 'center' })
    @IsString()
    @IsOptional()
    layout?: string;

    @ApiPropertyOptional({ example: 'Speaker notes here...' })
    @IsString()
    @IsOptional()
    notes?: string;

    @ApiPropertyOptional({ example: 0 })
    @IsInt()
    @IsOptional()
    order?: number;
}

export class UpdateSlideDto {
    @ApiPropertyOptional({ enum: SlideType })
    @IsEnum(SlideType)
    @IsOptional()
    type?: SlideType;

    @ApiPropertyOptional({ example: 'Updated Title' })
    @IsString()
    @IsOptional()
    title?: string;

    @ApiPropertyOptional()
    @IsObject()
    @IsOptional()
    content?: Record<string, any>;

    @ApiPropertyOptional({ example: 'left' })
    @IsString()
    @IsOptional()
    layout?: string;

    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    notes?: string;

    @ApiPropertyOptional()
    @IsInt()
    @IsOptional()
    order?: number;
}

export class SlideOrderItem {
    @ApiProperty()
    @IsString()
    slideId: string;

    @ApiProperty()
    @IsInt()
    order: number;
}

export class ReorderSlidesDto {
    @ApiProperty({ type: [SlideOrderItem] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SlideOrderItem)
    slideOrders: SlideOrderItem[];
}

export class SaveSceneDto {
    @ApiProperty({ description: 'The current SlideScene JSON' })
    @IsObject()
    scene: Record<string, any>;
}
