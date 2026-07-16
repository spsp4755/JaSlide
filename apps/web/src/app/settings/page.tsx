'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore, useTranslation, Theme, Language } from '@/stores/settings-store';
import { usersApi } from '@/lib/api';
import { AppShell } from '@/components/layout/app-shell';
import {
    User,
    Palette,
    Bell,
    Shield,
    Keyboard,
    Globe,
    Save,
    Check,
    Moon,
    Sun,
    Monitor,
    Upload,
    AlertTriangle,
} from 'lucide-react';

type SettingSection = 'profile' | 'appearance' | 'notifications' | 'privacy' | 'shortcuts' | 'language';

export default function SettingsPage() {
    const router = useRouter();
    const { user, isAuthenticated, hasHydrated: authHydrated } = useAuthStore();
    const {
        settings,
        hasHydrated: settingsHydrated,
        setSettings,
        setTheme,
        setLanguage,
        updateNotification,
        updatePrivacy,
        toggleShortcuts,
    } = useSettingsStore();
    const t = useTranslation();

    const [activeSection, setActiveSection] = useState<SettingSection>('profile');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!authHydrated) return;

        if (!isAuthenticated) {
            router.push('/login');
            return;
        }

        // Initialize display name from user or settings
        if (user?.name) {
            setDisplayName(user.name);
        } else if (settings.displayName) {
            setDisplayName(settings.displayName);
        }
    }, [authHydrated, isAuthenticated, router, user, settings.displayName]);

    const handleSave = async () => {
        setSaving(true);
        try {
            // Save to backend
            await usersApi.updateProfile({
                name: displayName,
                image: settings.avatarUrl || undefined,
                preferences: {
                    theme: settings.theme,
                    language: settings.language,
                    notifications: settings.notifications,
                    privacy: settings.privacy,
                    shortcuts: settings.shortcuts,
                },
            });

            // Update local settings
            setSettings({ displayName, email: user?.email || '' });

            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (error) {
            console.error('Failed to save settings:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Preview
        const reader = new FileReader();
        reader.onloadend = () => {
            setAvatarPreview(reader.result as string);
        };
        reader.readAsDataURL(file);

        try {
            const response = await usersApi.uploadAvatar(file);
            setSettings({ avatarUrl: response.data.url });
        } catch (error) {
            console.error('Failed to upload avatar:', error);
        }
    };

    const handleDeleteAccount = async () => {
        if (!deleteConfirm) {
            setDeleteConfirm(true);
            return;
        }
        // TODO: Implement account deletion API
        alert('계정 삭제 기능은 곧 지원될 예정입니다.');
        setDeleteConfirm(false);
    };

    const sections = [
        { id: 'profile' as const, label: t.settings.profile, icon: User },
        { id: 'appearance' as const, label: t.settings.appearance, icon: Palette },
        { id: 'notifications' as const, label: t.settings.notifications, icon: Bell },
        { id: 'privacy' as const, label: t.settings.privacy, icon: Shield },
        { id: 'shortcuts' as const, label: t.settings.shortcuts, icon: Keyboard },
        { id: 'language' as const, label: t.settings.language, icon: Globe },
    ];

    const themeOptions: { id: Theme; label: string; icon: typeof Sun }[] = [
        { id: 'light', label: t.appearance.light, icon: Sun },
        { id: 'dark', label: t.appearance.dark, icon: Moon },
        { id: 'system', label: t.appearance.system, icon: Monitor },
    ];

    const languageOptions: { id: Language; label: string; flag: string }[] = [
        { id: 'ko', label: '한국어', flag: '🇰🇷' },
        { id: 'en', label: 'English', flag: '🇺🇸' },
        { id: 'ja', label: '日本語', flag: '🇯🇵' },
    ];

    const shortcutsList = [
        { keys: ['Ctrl', 'N'], description: t.shortcuts.newPresentation },
        { keys: ['Ctrl', 'S'], description: t.shortcuts.save },
        { keys: ['Ctrl', 'Z'], description: t.shortcuts.undo },
        { keys: ['Ctrl', 'Y'], description: t.shortcuts.redo },
        { keys: ['Ctrl', 'D'], description: t.shortcuts.duplicate },
        { keys: ['Delete'], description: t.shortcuts.delete },
        { keys: ['←', '→'], description: t.shortcuts.navigate },
    ];

    if (!authHydrated || !settingsHydrated || !isAuthenticated) {
        return (
            <AppShell>
                <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                </div>
            </AppShell>
        );
    }

    return (
        <AppShell>
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
            <div className="container mx-auto px-4 py-8">
                <div className="max-w-5xl mx-auto">
                    <div className="flex items-center justify-between mb-8">
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.settings.title}</h1>
                        <Button
                            onClick={handleSave}
                            disabled={saving}
                            className="bg-gray-900 hover:bg-gray-700 min-w-[100px]"
                        >
                            {saving ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                            ) : saved ? (
                                <>
                                    <Check className="h-4 w-4 mr-2" />
                                    {t.settings.saved}
                                </>
                            ) : (
                                <>
                                    <Save className="h-4 w-4 mr-2" />
                                    {t.settings.save}
                                </>
                            )}
                        </Button>
                    </div>

                    <div className="flex flex-col md:flex-row gap-8">
                        {/* Sidebar */}
                        <nav className="md:w-64 flex-shrink-0">
                            <ul className="space-y-1">
                                {sections.map((section) => {
                                    const Icon = section.icon;
                                    return (
                                        <li key={section.id}>
                                            <button
                                                onClick={() => setActiveSection(section.id)}
                                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${activeSection === section.id
                                                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-500 font-medium'
                                                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                                                    }`}
                                            >
                                                <Icon className="h-5 w-5" />
                                                {section.label}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </nav>

                        {/* Main Content */}
                        <main className="flex-1 bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-6 shadow-sm">
                            {/* Profile Section */}
                            {activeSection === 'profile' && (
                                <div className="animate-in">
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
                                        {t.profile.title}
                                    </h2>

                                    <div className="space-y-6">
                                        {/* Avatar */}
                                        <div className="flex items-center gap-4">
                                            <div className="w-20 h-20 bg-gradient-to-br from-gray-800 to-gray-600 rounded-full flex items-center justify-center overflow-hidden">
                                                {avatarPreview || settings.avatarUrl ? (
                                                    <img
                                                        src={avatarPreview || settings.avatarUrl || ''}
                                                        alt="Avatar"
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <span className="text-2xl font-bold text-white">
                                                        {displayName?.[0] || user?.email?.[0] || 'U'}
                                                    </span>
                                                )}
                                            </div>
                                            <div>
                                                <input
                                                    type="file"
                                                    ref={fileInputRef}
                                                    onChange={handleAvatarUpload}
                                                    accept="image/*"
                                                    className="hidden"
                                                />
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => fileInputRef.current?.click()}
                                                >
                                                    <Upload className="h-4 w-4 mr-2" />
                                                    {t.profile.changePhoto}
                                                </Button>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                                    {t.profile.photoHint}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Display Name */}
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t.profile.displayName}
                                            </label>
                                            <input
                                                type="text"
                                                value={displayName}
                                                onChange={(e) => setDisplayName(e.target.value)}
                                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-gray-400 focus:border-transparent outline-none transition-all"
                                                placeholder="이름을 입력하세요"
                                            />
                                        </div>

                                        {/* Email */}
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t.profile.email}
                                            </label>
                                            <input
                                                type="email"
                                                value={user?.email || ''}
                                                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                                                disabled
                                            />
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                                {t.profile.emailHint}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Appearance Section */}
                            {activeSection === 'appearance' && (
                                <div className="animate-in">
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
                                        {t.appearance.title}
                                    </h2>

                                    <div className="space-y-6">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
                                                {t.appearance.theme}
                                            </label>
                                            <div className="grid grid-cols-3 gap-4">
                                                {themeOptions.map((theme) => {
                                                    const Icon = theme.icon;
                                                    return (
                                                        <button
                                                            key={theme.id}
                                                            onClick={() => setTheme(theme.id)}
                                                            className={`flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all ${settings.theme === theme.id
                                                                    ? 'border-gray-900 bg-gray-100 dark:bg-gray-800'
                                                                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                                                                }`}
                                                        >
                                                            <Icon className={`h-6 w-6 ${settings.theme === theme.id
                                                                    ? 'text-gray-900 dark:text-gray-300'
                                                                    : 'text-gray-500 dark:text-gray-400'
                                                                }`} />
                                                            <span className={`text-sm font-medium ${settings.theme === theme.id
                                                                    ? 'text-gray-700 dark:text-gray-500'
                                                                    : 'text-gray-600 dark:text-gray-400'
                                                                }`}>
                                                                {theme.label}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Notifications Section */}
                            {activeSection === 'notifications' && (
                                <div className="animate-in">
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
                                        {t.notifications.title}
                                    </h2>

                                    <div className="space-y-4">
                                        {[
                                            { key: 'email' as const, label: t.notifications.email, description: t.notifications.emailDesc },
                                            { key: 'push' as const, label: t.notifications.push, description: t.notifications.pushDesc },
                                            { key: 'marketing' as const, label: t.notifications.marketing, description: t.notifications.marketingDesc },
                                        ].map((item) => (
                                            <div key={item.key} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                                <div>
                                                    <p className="font-medium text-gray-900 dark:text-white">{item.label}</p>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">{item.description}</p>
                                                </div>
                                                <button
                                                    onClick={() => updateNotification(item.key, !settings.notifications[item.key])}
                                                    className={`relative w-12 h-6 rounded-full transition-colors ${settings.notifications[item.key]
                                                            ? 'bg-gray-900'
                                                            : 'bg-gray-300 dark:bg-gray-600'
                                                        }`}
                                                >
                                                    <span
                                                        className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${settings.notifications[item.key]
                                                                ? 'translate-x-7'
                                                                : 'translate-x-1'
                                                            }`}
                                                    />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Privacy Section */}
                            {activeSection === 'privacy' && (
                                <div className="animate-in">
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
                                        {t.privacy.title}
                                    </h2>

                                    <div className="space-y-4">
                                        {[
                                            { key: 'shareAnalytics' as const, label: t.privacy.shareAnalytics, description: t.privacy.shareAnalyticsDesc },
                                            { key: 'showProfile' as const, label: t.privacy.showProfile, description: t.privacy.showProfileDesc },
                                        ].map((item) => (
                                            <div key={item.key} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                                <div>
                                                    <p className="font-medium text-gray-900 dark:text-white">{item.label}</p>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">{item.description}</p>
                                                </div>
                                                <button
                                                    onClick={() => updatePrivacy(item.key, !settings.privacy[item.key])}
                                                    className={`relative w-12 h-6 rounded-full transition-colors ${settings.privacy[item.key]
                                                            ? 'bg-gray-900'
                                                            : 'bg-gray-300 dark:bg-gray-600'
                                                        }`}
                                                >
                                                    <span
                                                        className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${settings.privacy[item.key]
                                                                ? 'translate-x-7'
                                                                : 'translate-x-1'
                                                            }`}
                                                    />
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="mt-8 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-900/50">
                                        <div className="flex items-center gap-2 mb-2">
                                            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                                            <h3 className="font-medium text-red-800 dark:text-red-300">{t.privacy.dangerZone}</h3>
                                        </div>
                                        <p className="text-sm text-red-600 dark:text-red-400 mb-4">
                                            {t.privacy.deleteWarning}
                                        </p>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={handleDeleteAccount}
                                        >
                                            {deleteConfirm ? '정말 삭제하시겠습니까?' : t.privacy.deleteAccount}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Shortcuts Section */}
                            {activeSection === 'shortcuts' && (
                                <div className="animate-in">
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
                                        {t.shortcuts.title}
                                    </h2>

                                    <div className="mb-6">
                                        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                            <div>
                                                <p className="font-medium text-gray-900 dark:text-white">{t.shortcuts.enable}</p>
                                                <p className="text-sm text-gray-500 dark:text-gray-400">{t.shortcuts.enableDesc}</p>
                                            </div>
                                            <button
                                                onClick={toggleShortcuts}
                                                className={`relative w-12 h-6 rounded-full transition-colors ${settings.shortcuts.enabled
                                                        ? 'bg-gray-900'
                                                        : 'bg-gray-300 dark:bg-gray-600'
                                                    }`}
                                            >
                                                <span
                                                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${settings.shortcuts.enabled
                                                            ? 'translate-x-7'
                                                            : 'translate-x-1'
                                                        }`}
                                                />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                                            {t.shortcuts.available}
                                        </h3>
                                        {shortcutsList.map((shortcut, index) => (
                                            <div key={index} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                                                <span className="text-gray-600 dark:text-gray-400">{shortcut.description}</span>
                                                <div className="flex items-center gap-1">
                                                    {shortcut.keys.map((key, i) => (
                                                        <span key={i} className="flex items-center">
                                                            <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-xs font-mono text-gray-700 dark:text-gray-300">
                                                                {key}
                                                            </kbd>
                                                            {i < shortcut.keys.length - 1 && (
                                                                <span className="mx-1 text-gray-400">+</span>
                                                            )}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Language Section */}
                            {activeSection === 'language' && (
                                <div className="animate-in">
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
                                        {t.language.title}
                                    </h2>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
                                            {t.language.interfaceLanguage}
                                        </label>
                                        <div className="space-y-3">
                                            {languageOptions.map((lang) => (
                                                <button
                                                    key={lang.id}
                                                    onClick={() => setLanguage(lang.id)}
                                                    className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${settings.language === lang.id
                                                            ? 'border-gray-900 bg-gray-100 dark:bg-gray-800'
                                                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                                                        }`}
                                                >
                                                    <span className="text-2xl">{lang.flag}</span>
                                                    <span className={`font-medium ${settings.language === lang.id
                                                            ? 'text-gray-700 dark:text-gray-500'
                                                            : 'text-gray-700 dark:text-gray-300'
                                                        }`}>
                                                        {lang.label}
                                                    </span>
                                                    {settings.language === lang.id && (
                                                        <Check className="h-5 w-5 text-gray-900 dark:text-gray-300 ml-auto" />
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </main>
                    </div>
                </div>
            </div>
            </div>
        </AppShell>
    );
}
