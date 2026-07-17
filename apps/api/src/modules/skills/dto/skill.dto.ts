import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateSkillDto {
    @IsString()
    name: string;

    @IsString()
    category: string;

    @IsString()
    audience: string;

    @IsString()
    tone: string;

    @IsString()
    purpose: string;

    @IsString()
    outlineGuidance: string;

    @IsInt()
    @Min(3)
    @Max(30)
    recommendedSlideCount: number;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    thumbnail?: string;

    @IsOptional()
    @IsString()
    templateId?: string;

    @IsOptional()
    @IsBoolean()
    isPublic?: boolean;
}
