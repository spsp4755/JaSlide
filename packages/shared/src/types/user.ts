// User types

export interface User {
    id: string;
    email: string;
    name?: string;
    image?: string;
    organizationId?: string;
    role: UserRole;
    preferences: UserPreferences;
    createdAt: Date;
    updatedAt: Date;
}

export enum UserRole {
    USER = 'USER',
    ADMIN = 'ADMIN',
    ORG_ADMIN = 'ORG_ADMIN',
}

export interface UserPreferences {
    defaultLanguage: string;
    defaultTemplateId?: string;
    defaultSlideCount: number;
    emailNotifications: boolean;
    theme: 'light' | 'dark' | 'system';
}

export interface Organization {
    id: string;
    name: string;
    slug: string;
    logo?: string;
    brandSettings: BrandSettings;
    plan: OrganizationPlan;
    createdAt: Date;
    updatedAt: Date;
}

export interface BrandSettings {
    primaryColor: string;
    secondaryColor: string;
    logoUrl?: string;
    fontFamily?: string;
    customTemplateIds: string[];
}

export enum OrganizationPlan {
    FREE = 'FREE',
    STARTER = 'STARTER',
    PROFESSIONAL = 'PROFESSIONAL',
    ENTERPRISE = 'ENTERPRISE',
}

export interface UpdateUserInput {
    name?: string;
    preferences?: Partial<UserPreferences>;
}

export interface UpdateOrganizationInput {
    name?: string;
    logo?: string;
    brandSettings?: Partial<BrandSettings>;
}
