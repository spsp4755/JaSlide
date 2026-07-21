import { IsString, IsOptional, IsInt, IsNumber, Min, Max, IsEnum, IsEmail, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

// Pagination DTO
export class PaginationDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    @Type(() => Number)
    page?: number = 1;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(100)
    @Type(() => Number)
    limit?: number = 20;

    @IsOptional()
    @IsString()
    sortBy?: string;

    @IsOptional()
    @IsEnum(['asc', 'desc'])
    sortOrder?: 'asc' | 'desc' = 'desc';
}

// User Admin DTOs
export class AdminCreateUserDto {
    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    password?: string;

    @IsOptional()
    @IsString()
    organizationId?: string;

    @IsOptional()
    @IsEnum(['USER', 'ADMIN', 'ORG_ADMIN'])
    role?: 'USER' | 'ADMIN' | 'ORG_ADMIN';
}

export class AdminUpdateUserDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    image?: string;

    @IsOptional()
    @IsEnum(['USER', 'ADMIN', 'ORG_ADMIN'])
    role?: 'USER' | 'ADMIN' | 'ORG_ADMIN';

    @IsOptional()
    @IsEnum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING'])
    status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';

    @IsOptional()
    @IsString()
    organizationId?: string;
}

export class AdminUserFilterDto extends PaginationDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsEnum(['USER', 'ADMIN', 'ORG_ADMIN'])
    role?: 'USER' | 'ADMIN' | 'ORG_ADMIN';

    @IsOptional()
    @IsEnum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING'])
    status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';

    @IsOptional()
    @IsString()
    organizationId?: string;
}

// Organization Admin DTOs
export class AdminCreateOrganizationDto {
    @IsString()
    name: string;

    @IsString()
    slug: string;

    @IsOptional()
    @IsString()
    domain?: string;

    @IsOptional()
    @IsString()
    logo?: string;

    @IsOptional()
    brandSettings?: Record<string, any>;

    @IsOptional()
    @IsEnum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'])
    plan?: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
}

export class AdminUpdateOrganizationDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    domain?: string;

    @IsOptional()
    @IsString()
    logo?: string;

    @IsOptional()
    brandSettings?: Record<string, any>;

    @IsOptional()
    @IsEnum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'])
    plan?: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
}

// Role DTOs
export class AdminCreateRoleDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    permissions?: string[];
}

export class AdminUpdateRoleDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    permissions?: string[];
}

// LLM Model DTOs
export class AdminCreateLlmModelDto {
    @IsString()
    name: string;

    @IsString()
    provider: string;

    @IsString()
    modelId: string;

    @IsOptional()
    @IsString()
    endpoint?: string;

    @IsOptional()
    @IsString()
    apiKey?: string;

    @IsOptional()
    @IsString()
    apiKeyEnvVar?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    maxTokens?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    rateLimit?: number;

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    costPerToken: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;

    @IsOptional()
    config?: Record<string, any>;
}

export class AdminUpdateLlmModelDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    provider?: string;

    @IsOptional()
    @IsString()
    modelId?: string;

    @IsOptional()
    @IsString()
    endpoint?: string;

    @IsOptional()
    @IsString()
    apiKey?: string;

    @IsOptional()
    @IsString()
    apiKeyEnvVar?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    maxTokens?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    rateLimit?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    costPerToken?: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;

    @IsOptional()
    config?: Record<string, any>;
}

// Prompt Registry DTOs
export class AdminCreatePromptDto {
    @IsString()
    name: string;

    @IsString()
    category: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsString()
    content: string;

    @IsOptional()
    variables?: string[];
}

export class AdminCreatePromptVersionDto {
    @IsString()
    content: string;

    @IsOptional()
    variables?: string[];
}

// System Policy DTOs
export class AdminCreatePolicyDto {
    @IsString()
    category: string;

    @IsString()
    key: string;

    value: any;

    @IsOptional()
    @IsString()
    description?: string;
}

export class AdminUpdatePolicyDto {
    @IsOptional()
    value?: any;

    @IsOptional()
    @IsString()
    description?: string;
}

// Alert Config DTOs
export class AdminCreateAlertDto {
    @IsString()
    name: string;

    @IsString()
    eventType: string;

    @IsString()
    channel: string;

    config: Record<string, any>;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class AdminUpdateAlertDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    config?: Record<string, any>;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

// Log Filter DTOs
export class AdminAuditLogFilterDto extends PaginationDto {
    @IsOptional()
    @IsString()
    userId?: string;

    @IsOptional()
    @IsString()
    action?: string;

    @IsOptional()
    @IsString()
    resource?: string;

    @IsOptional()
    @IsString()
    startDate?: string;

    @IsOptional()
    @IsString()
    endDate?: string;
}

export class AdminApiLogFilterDto extends PaginationDto {
    @IsOptional()
    @IsString()
    userId?: string;

    @IsOptional()
    @IsString()
    path?: string;

    @IsOptional()
    @IsInt()
    statusCode?: number;

    @IsOptional()
    @IsString()
    startDate?: string;

    @IsOptional()
    @IsString()
    endDate?: string;
}

// Job Filter DTOs
export class AdminJobFilterDto extends PaginationDto {
    @IsOptional()
    @IsString()
    userId?: string;

    @IsOptional()
    @IsEnum(['QUEUED', 'PROCESSING', 'GENERATING_OUTLINE', 'GENERATING_CONTENT', 'APPLYING_DESIGN', 'RENDERING', 'COMPLETED', 'FAILED', 'CANCELLED'])
    status?: string;

    @IsOptional()
    @IsString()
    startDate?: string;

    @IsOptional()
    @IsString()
    endDate?: string;
}

// Document Filter DTOs
export class AdminDocumentFilterDto extends PaginationDto {
    @IsOptional()
    @IsString()
    userId?: string;

    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsEnum(['DRAFT', 'GENERATING', 'COMPLETED', 'FAILED'])
    status?: string;

    @IsOptional()
    @IsString()
    startDate?: string;

    @IsOptional()
    @IsString()
    endDate?: string;
}
