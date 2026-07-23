import axios from 'axios';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || '/api';

export const assetUrl = (url: string) => {
    if (!url.startsWith('/') || !apiBaseUrl.startsWith('http')) return url;
    return `${apiBaseUrl.replace(/\/api\/?$/, '')}${url}`;
};

const api = axios.create({
    baseURL: apiBaseUrl,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});

// Response interceptor for errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            if (typeof window !== 'undefined') {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

// Auth
export const authApi = {
    login: (data: { email: string; password: string }) =>
        api.post('/auth/login', data),
    register: (data: { email: string; password: string; name?: string }) =>
        api.post('/auth/register', data),
    logout: () => api.post('/auth/logout'),
    me: () => api.get('/auth/me'),
};

// Presentations
export const presentationsApi = {
    list: (page = 1, limit = 10) =>
        api.get('/presentations', { params: { page, limit } }),
    get: (id: string) => api.get(`/presentations/${id}`),
    create: (data: any) => api.post('/presentations', data),
    update: (id: string, data: any) => api.put(`/presentations/${id}`, data),
    delete: (id: string) => api.delete(`/presentations/${id}`),
    duplicate: (id: string) => api.post(`/presentations/${id}/duplicate`),
    share: (id: string) => api.post(`/presentations/${id}/share`),
};

// Slides
export const slidesApi = {
    list: (presentationId: string) =>
        api.get(`/presentations/${presentationId}/slides`),
    get: (presentationId: string, slideId: string) =>
        api.get(`/presentations/${presentationId}/slides/${slideId}`),
    create: (presentationId: string, data: any) =>
        api.post(`/presentations/${presentationId}/slides`, data),
    update: (presentationId: string, slideId: string, data: any) =>
        api.put(`/presentations/${presentationId}/slides/${slideId}`, data),
    delete: (presentationId: string, slideId: string) =>
        api.delete(`/presentations/${presentationId}/slides/${slideId}`),
    reorder: (presentationId: string, data: any) =>
        api.post(`/presentations/${presentationId}/slides/reorder`, data),
    duplicate: (slideId: string) =>
        api.post(`/slides/${slideId}/duplicate`),
    duplicateWithPresentation: (presentationId: string, slideId: string) =>
        api.post(`/presentations/${presentationId}/slides/${slideId}/duplicate`),
};


// Generation
export const generationApi = {
    extractSource: async (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/generation/source/extract', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    outline: (data: any) => api.post('/generation/outline', data),
    start: (data: any) => api.post('/generation/start', data),
    status: (jobId: string) => api.get(`/generation/${jobId}/status`),
    cancel: (jobId: string) => api.post(`/generation/${jobId}/cancel`),
    edit: (data: { slideId?: string; slideIds?: string[]; instruction: string }, signal?: AbortSignal) =>
        api.post('/generation/edit', data, { signal }),
};

// Templates
export const templatesApi = {
    list: (category?: string) =>
        api.get('/templates', { params: { category } }),
    defaults: () => api.get('/templates/defaults'),
    get: (id: string) => api.get(`/templates/${id}`),
};

// Presentation skills are data-only guidance; they never load executable packages.
export const skillsApi = {
    list: (category?: string) =>
        api.get('/skills', { params: { category } }),
    create: (data: {
        name: string;
        category: string;
        audience: string;
        tone: string;
        purpose: string;
        outlineGuidance: string;
        recommendedSlideCount: number;
        description?: string;
    }) => api.post('/skills', data),
    importPptx: async (file: File, name?: string) => {
        const formData = new FormData();
        formData.append('file', file);
        if (name) formData.append('name', name);
        return api.post('/skills/import-pptx', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
};

// Export
export const exportApi = {
    pptx: (presentationId: string) =>
        api.post(`/export/${presentationId}/pptx`, {}, { responseType: 'blob' }),
    pdf: (presentationId: string) =>
        api.post(`/export/${presentationId}/pdf`, {}, { responseType: 'blob' }),
    googleSlides: (presentationId: string, accessToken: string) =>
        api.post(`/export/${presentationId}/google-slides`, null, {
            params: { accessToken },
        }),
    preview: (presentationId: string, slideIndex = 0) =>
        api.get(`/export/${presentationId}/preview`, {
            params: { slide: slideIndex },
            responseType: 'blob',
        }),
};

// Assets
export const assetsApi = {
    upload: async (file: File, type = 'IMAGE') => {
        const formData = new FormData();
        formData.append('file', file);
        const response = await api.post('/assets/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            params: { type },
        });
        response.data.url = assetUrl(response.data.url);
        response.data.thumbnailUrl = assetUrl(response.data.thumbnailUrl);
        return response;
    },
    list: async (type?: string) => {
        const response = await api.get('/assets', { params: { type } });
        response.data = response.data.map((asset: any) => ({
            ...asset,
            url: assetUrl(asset.url),
            thumbnailUrl: assetUrl(asset.thumbnailUrl),
        }));
        return response;
    },
    delete: (id: string) => api.delete(`/assets/${id}`),
    searchStock: (query: string) =>
        api.get('/assets/stock', { params: { q: query } }),
    searchIcons: (query: string) =>
        api.get('/assets/icons', { params: { q: query } }),
};

// Blocks
export const blocksApi = {
    list: (slideId: string) => api.get(`/slides/${slideId}/blocks`),
    get: (blockId: string) => api.get(`/blocks/${blockId}`),
    create: (slideId: string, data: any) => api.post(`/slides/${slideId}/blocks`, data),
    update: (blockId: string, data: any) => api.patch(`/blocks/${blockId}`, data),
    delete: (blockId: string) => api.delete(`/blocks/${blockId}`),
    reorder: (slideId: string, blockOrders: { blockId: string; order: number }[]) =>
        api.post(`/slides/${slideId}/blocks/reorder`, { blockOrders }),
    duplicate: (blockId: string) => api.post(`/blocks/${blockId}/duplicate`),
};

// Versions
export const versionsApi = {
    list: (presentationId: string) => api.get(`/presentations/${presentationId}/versions`),
    get: (versionId: string) => api.get(`/versions/${versionId}`),
    create: (presentationId: string, name?: string) =>
        api.post(`/presentations/${presentationId}/versions`, { name }),
    restore: (versionId: string) => api.post(`/versions/${versionId}/restore`),
    delete: (versionId: string) => api.delete(`/versions/${versionId}`),
    compare: (version1Id: string, version2Id: string) =>
        api.get(`/versions/${version1Id}/compare/${version2Id}`),
};

// Comments
export const commentsApi = {
    listByPresentation: (presentationId: string) =>
        api.get(`/presentations/${presentationId}/comments`),
    listBySlide: (slideId: string) => api.get(`/slides/${slideId}/comments`),
    create: (presentationId: string, data: { content: string; slideId?: string; parentId?: string }) =>
        api.post(`/presentations/${presentationId}/comments`, data),
    update: (commentId: string, data: { content?: string; isResolved?: boolean }) =>
        api.patch(`/comments/${commentId}`, data),
    delete: (commentId: string) => api.delete(`/comments/${commentId}`),
    resolve: (commentId: string) => api.post(`/comments/${commentId}/resolve`),
    unresolve: (commentId: string) => api.post(`/comments/${commentId}/unresolve`),
};

// Collaborators
export const collaboratorsApi = {
    list: (presentationId: string) =>
        api.get(`/presentations/${presentationId}/collaborators`),
    invite: (presentationId: string, data: { email: string; role?: string }) =>
        api.post(`/presentations/${presentationId}/collaborators`, data),
    update: (collaboratorId: string, data: { role: string }) =>
        api.patch(`/collaborators/${collaboratorId}`, data),
    remove: (collaboratorId: string) => api.delete(`/collaborators/${collaboratorId}`),
};

// Favorites
export const favoritesApi = {
    list: (type?: string) => api.get('/favorites', { params: { type } }),
    add: (resourceType: string, resourceId: string) =>
        api.post('/favorites', { resourceType, resourceId }),
    remove: (favoriteId: string) => api.delete(`/favorites/${favoriteId}`),
    reorder: (resourceType: string, orderedIds: string[]) =>
        api.post('/favorites/reorder', { resourceType, orderedIds }),
};

// Export Presets
export const exportPresetsApi = {
    list: () => api.get('/export-presets'),
    getDefault: (format: string) => api.get('/export-presets/default', { params: { format } }),
    get: (presetId: string) => api.get(`/export-presets/${presetId}`),
    create: (data: { name: string; format: string; config?: any; isDefault?: boolean }) =>
        api.post('/export-presets', data),
    update: (presetId: string, data: any) => api.patch(`/export-presets/${presetId}`, data),
    delete: (presetId: string) => api.delete(`/export-presets/${presetId}`),
};

// Users
export const usersApi = {
    getProfile: () => api.get('/users/me'),
    updateProfile: (data: { name?: string; image?: string; preferences?: any }) =>
        api.put('/users/me', data),
    uploadAvatar: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/assets/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            params: { type: 'IMAGE' },
        });
    },
};

export default api;
