'use client';

import Link from '@/lib/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FileUp, LayoutTemplate, MoreVertical, PencilLine, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { skillsApi, usersApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

type Skill = {
    id: string;
    name: string;
    description?: string;
    category: string;
    audience: string;
    tone: string;
    purpose: string;
    recommendedSlideCount: number;
    isPublic: boolean;
    organizationId: string | null;
    templateId: string | null;
};

type Scope = 'private' | 'organization' | 'public';

const scopeOf = (skill: Skill): Scope => (skill.isPublic ? 'public' : skill.organizationId ? 'organization' : 'private');

const nextScope = (current: Scope, hasOrganization: boolean): Scope => {
    if (current === 'private') return hasOrganization ? 'organization' : 'public';
    if (current === 'organization') return 'public';
    return 'private';
};

const scopeLabel: Record<Scope, string> = { private: '비공개', organization: '조직공개', public: '전체공개' };
const scopeBadgeClass: Record<Scope, string> = {
    private: 'bg-secondary text-muted-foreground',
    organization: 'bg-blue-100 text-blue-700',
    public: 'bg-green-100 text-green-700',
};

export function SkillsGallery({ preview = false }: { preview?: boolean }) {
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(!preview);
    const [showCreator, setShowCreator] = useState(false);
    const [creating, setCreating] = useState(false);
    const [importing, setImporting] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [deleting, setDeleting] = useState(false);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [renamingSkill, setRenamingSkill] = useState<Skill | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [renaming, setRenaming] = useState(false);
    const [deletingSkill, setDeletingSkill] = useState<Skill | null>(null);
    const [deletingOne, setDeletingOne] = useState(false);
    const [userOrganizationId, setUserOrganizationId] = useState<string | null>(null);
    const [scopeFilter, setScopeFilter] = useState<'all' | Scope>('all');
    const pptxInputRef = useRef<HTMLInputElement>(null);
    const [form, setForm] = useState({
        name: '', category: '기업 전략', audience: '의사결정자', tone: '명확하고 단정하게',
        purpose: '', outlineGuidance: '문제와 목표를 먼저 제시하고, 근거와 실행 계획으로 마무리합니다.', recommendedSlideCount: 10,
    });

    useEffect(() => {
        if (preview) return;
        skillsApi.list()
            .then((response) => setSkills(Array.isArray(response.data) ? response.data : []))
            .catch(() => setSkills([]))
            .finally(() => setLoading(false));
    }, [preview]);

    useEffect(() => {
        if (preview) return;
        usersApi.getProfile()
            .then((response) => setUserOrganizationId(response.data?.organizationId ?? null))
            .catch(() => setUserOrganizationId(null));
    }, [preview]);

    const displayedSkills = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return skills.filter((skill) => {
            if (scopeFilter !== 'all' && scopeOf(skill) !== scopeFilter) return false;
            if (!needle) return true;
            return `${skill.name} ${skill.description || ''} ${skill.category} ${skill.purpose}`.toLowerCase().includes(needle);
        });
    }, [skills, query, scopeFilter]);

    const deleteSelected = async () => {
        if (!selectedIds.length || !window.confirm(`선택한 ${selectedIds.length}개 Skill을 삭제할까요?`)) return;
        setDeleting(true);
        try {
            const response = await skillsApi.deleteMany(selectedIds);
            const deleted = Number(response.data?.deleted || 0);
            setSkills((current) => current.filter((skill) => !selectedIds.includes(skill.id)));
            setSelectedIds([]);
            toast({ title: `${deleted}개 Skill을 삭제했습니다.` });
        } catch (error: any) {
            toast({ title: 'Skill 삭제 실패', description: error.response?.data?.message || '다시 시도해주세요.', variant: 'destructive' });
        } finally {
            setDeleting(false);
        }
    };

    const submitRename = async () => {
        if (!renamingSkill || !renameValue.trim()) return;
        setRenaming(true);
        try {
            const response = await skillsApi.update(renamingSkill.id, { name: renameValue.trim() });
            setSkills((current) => current.map((item) => (item.id === renamingSkill.id ? response.data : item)));
            setRenamingSkill(null);
        } catch (error: any) {
            toast({ title: '이름 변경 실패', description: error.response?.data?.message || '다시 시도해주세요.', variant: 'destructive' });
        } finally {
            setRenaming(false);
        }
    };

    const deleteSkill = async (skill: Skill) => {
        setDeletingOne(true);
        try {
            await skillsApi.delete(skill.id);
            setSkills((current) => current.filter((item) => item.id !== skill.id));
            setDeletingSkill(null);
            toast({ title: 'Skill을 삭제했습니다' });
        } catch (error: any) {
            toast({ title: '삭제 실패', description: error.response?.data?.message || '다시 시도해주세요.', variant: 'destructive' });
        } finally {
            setDeletingOne(false);
        }
    };

    const cycleScope = async (skill: Skill) => {
        const scope = nextScope(scopeOf(skill), Boolean(userOrganizationId));
        try {
            const response = await skillsApi.update(skill.id, { scope });
            setSkills((current) => current.map((item) => (item.id === skill.id ? response.data : item)));
        } catch (error: any) {
            toast({ title: '공개 범위 변경 실패', description: error.response?.data?.message || '다시 시도해주세요.', variant: 'destructive' });
        }
    };

    const createSkill = async () => {
        if (!form.name.trim() || !form.purpose.trim()) {
            toast({ title: '내용을 확인해주세요', description: 'Skill 이름과 사용 목적은 필수입니다.', variant: 'destructive' });
            return;
        }
        setCreating(true);
        try {
            const response = await skillsApi.create(form);
            setSkills((current) => [response.data, ...current]);
            setShowCreator(false);
            setForm((current) => ({ ...current, name: '', purpose: '' }));
            toast({ title: 'Skill을 만들었습니다', description: '다음 생성부터 이 가이드를 선택할 수 있습니다.' });
        } catch (error: any) {
            toast({ title: 'Skill 생성 실패', description: error.response?.data?.message || '다시 시도해주세요.', variant: 'destructive' });
        } finally {
            setCreating(false);
        }
    };

    const importPptxSkill = async (file: File | undefined) => {
        if (!file) return;
        setImporting(true);
        try {
            const response = await skillsApi.importPptx(file);
            setSkills((current) => [response.data, ...current]);
            toast({ title: 'PPTX Skill을 만들었습니다', description: '추출한 스타일을 다음 프레젠테이션에 적용할 수 있습니다.' });
        } catch (error: any) {
            toast({ title: 'PPTX Skill 생성 실패', description: error.response?.data?.message || '20MB 이하 PPTX인지 확인해주세요.', variant: 'destructive' });
        } finally {
            setImporting(false);
            if (pptxInputRef.current) pptxInputRef.current.value = '';
        }
    };

    const actionClass = 'group min-h-[230px] rounded-2xl border border-border bg-card p-5 text-left transition hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-sm';

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="border-b border-border bg-card/90">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
                    <Link href={preview ? '/demo' : '/dashboard'} className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
                        <Sparkles className="h-5 w-5" /> TaeSlide
                    </Link>
                    {preview ? <Link href="/login" className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background">로그인</Link> : <Link href="/dashboard?focus=1" className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background">새 슬라이드</Link>}
                </div>
            </header>

            <main className="mx-auto max-w-7xl px-6 py-10">
                {!preview && <input ref={pptxInputRef} type="file" accept=".pptx" className="hidden" onChange={(event) => importPptxSkill(event.target.files?.[0])} />}
                <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="mb-2 text-sm font-medium text-muted-foreground">오프라인 배포용 · 실행 패키지 없이 안전하게</p>
                        <h1 className="font-display text-4xl font-black tracking-tight">Skills</h1>
                        <p className="mt-2 text-muted-foreground">표현 방식과 구성 원칙을 저장해, 팀의 발표 품질을 일관되게 만드세요.</p>
                    </div>
                    {preview && <span className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground">공개 미리보기 · 저장은 로그인 후 가능</span>}
                </div>

                {!preview && <div className="mb-7 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center">
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Skill 검색" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground sm:max-w-sm" />
                    <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as 'all' | Scope)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                        <option value="all">전체 범위</option>
                        <option value="private">비공개</option>
                        <option value="organization">조직공개</option>
                        <option value="public">전체공개</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={displayedSkills.length > 0 && displayedSkills.every((skill) => selectedIds.includes(skill.id))} onChange={(event) => setSelectedIds(event.target.checked ? displayedSkills.map((skill) => skill.id) : [])} /> 현재 목록 전체 선택</label>
                    <button type="button" disabled={!selectedIds.length || deleting} onClick={deleteSelected} className="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive disabled:opacity-40 sm:ml-auto"><Trash2 className="h-4 w-4" /> 선택 삭제{selectedIds.length ? ` (${selectedIds.length})` : ''}</button>
                </div>}

                <section aria-labelledby="new-skill" className="mb-10">
                    <h2 id="new-skill" className="mb-4 font-display text-xl font-bold">새 Skill</h2>
                    <div className="grid gap-4 md:grid-cols-3">
                        {preview ? (
                            <Link href="/login" className={actionClass}><FileUp className="mb-8 h-7 w-7" /><h3 className="text-lg font-bold">PPTX에서 만들기</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">기존 발표자료를 올려 시각 토큰과 레이아웃 원칙을 재사용합니다.</p><span className="mt-7 inline-flex text-sm font-medium underline underline-offset-4">로그인 후 사용</span></Link>
                        ) : (
                            <button type="button" disabled={importing} onClick={() => pptxInputRef.current?.click()} className={`${actionClass} disabled:cursor-wait disabled:opacity-60`}><FileUp className="mb-8 h-7 w-7" /><h3 className="text-lg font-bold">PPTX에서 만들기</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">기존 발표자료에서 색상·글꼴·레이아웃 원칙을 추출해 재사용합니다.</p><span className="mt-7 inline-flex text-sm font-medium underline underline-offset-4">{importing ? '스타일 추출 중' : 'PPTX 업로드'}</span></button>
                        )}
                        <button type="button" onClick={() => preview ? undefined : setShowCreator(true)} className={`${actionClass} ${preview ? 'cursor-default' : ''}`}><PencilLine className="mb-8 h-7 w-7" /><h3 className="text-lg font-bold">직접 만들기</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">목적, 대상, 말투, 목차 가이드를 직접 정의합니다.</p><span className="mt-7 inline-flex text-sm font-medium underline underline-offset-4">{preview ? '로그인 후 사용' : '새 Skill 작성'}</span></button>
                        <Link href={preview ? '/demo' : '/dashboard'} className={actionClass}><LayoutTemplate className="mb-8 h-7 w-7" /><h3 className="text-lg font-bold">템플릿 갤러리에서 선택</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">검증된 템플릿을 기준으로 목적에 맞는 Skill을 시작합니다.</p><span className="mt-7 inline-flex text-sm font-medium underline underline-offset-4">템플릿 보기</span></Link>
                    </div>
                </section>

                <section aria-labelledby="my-skills">
                    <div className="mb-4 flex items-center gap-2"><BookOpen className="h-5 w-5" /><h2 id="my-skills" className="font-display text-xl font-bold">내 Skill</h2></div>
                    {loading ? <p className="py-10 text-sm text-muted-foreground">Skills를 불러오는 중입니다.</p> : (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {displayedSkills.map((skill) => <article key={skill.id} className="relative overflow-hidden rounded-2xl border border-border bg-card">
                                {!preview && <label className="absolute left-3 top-3 z-10 rounded bg-card/90 p-1.5"><input type="checkbox" checked={selectedIds.includes(skill.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, skill.id] : current.filter((id) => id !== skill.id))} aria-label={`${skill.name} 선택`} /></label>}
                                {!preview && <div className="absolute right-3 top-3 z-10">
                                    <button type="button" onClick={() => setOpenMenuId(openMenuId === skill.id ? null : skill.id)} className="rounded bg-card/90 p-1.5 hover:bg-secondary" aria-label={`${skill.name} 메뉴`}><MoreVertical className="h-4 w-4" /></button>
                                    {openMenuId === skill.id && <div className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                                        <button type="button" onClick={() => { setRenamingSkill(skill); setRenameValue(skill.name); setOpenMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"><PencilLine className="h-3.5 w-3.5" /> 이름 변경</button>
                                        <button type="button" onClick={() => { setDeletingSkill(skill); setOpenMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-secondary"><Trash2 className="h-3.5 w-3.5" /> 삭제</button>
                                    </div>}
                                </div>}
                                <div className="h-32 bg-[linear-gradient(135deg,#1d1d1b_0%,#393731_50%,#d8c8aa_50%,#f7f1e5_100%)] p-4"><div className="flex h-full flex-col justify-between rounded-lg border border-white/30 bg-card/10 p-3 text-white backdrop-blur"><span className="text-[10px] uppercase tracking-[0.18em]">TaeSlide Skill</span><strong className="font-display text-xl leading-tight">{skill.purpose}</strong></div></div>
                                <div className="p-4"><span className="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">{skill.category}</span>{!preview && <button type="button" onClick={() => cycleScope(skill)} title="클릭해서 공개 범위 변경" className={`ml-2 rounded-full px-2 py-1 text-xs ${scopeBadgeClass[scopeOf(skill)]}`}>{scopeLabel[scopeOf(skill)]}</button>}<h3 className="mt-3 font-bold">{skill.name}</h3><p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{skill.description || `${skill.audience}을 위한 ${skill.tone} 발표 가이드입니다.`}</p><div className="mt-4 flex items-center justify-between text-xs text-muted-foreground"><span>{skill.audience}</span><span>{skill.recommendedSlideCount}장 추천</span></div>{preview ? <Link href="/login" className="mt-4 inline-flex text-sm font-medium underline underline-offset-4">로그인 후 사용</Link> : <Link href={`/dashboard?skillId=${skill.id}`} className="mt-4 inline-flex text-sm font-medium underline underline-offset-4">이 Skill로 만들기</Link>}</div>
                            </article>)}
                            {openMenuId && <button type="button" className="fixed inset-0 z-[5] cursor-default" aria-label="메뉴 닫기" onClick={() => setOpenMenuId(null)} />}
                        </div>
                    )}
                </section>
            </main>

            {showCreator && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div role="dialog" aria-modal="true" aria-label="새 Skill 만들기" className="w-full max-w-xl rounded-2xl bg-card p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-display text-2xl font-bold">새 Skill 만들기</h2><p className="mt-1 text-sm text-muted-foreground">실행 코드가 아닌 작성 가이드만 저장됩니다.</p></div><button type="button" onClick={() => setShowCreator(false)} className="rounded-lg p-2 hover:bg-secondary" aria-label="닫기"><X className="h-5 w-5" /></button></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium sm:col-span-2">이름<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal outline-none focus:border-foreground" placeholder="예: 공공 정책 브리핑" /></label><label className="text-sm font-medium">분류<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal"><option>기업 전략</option><option>교육</option><option>B2B 영업</option><option>데이터 & KPI</option><option>마케팅</option><option>공공 정책</option></select></label><label className="text-sm font-medium">대상<input value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal" /></label><label className="text-sm font-medium sm:col-span-2">사용 목적<input value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal" placeholder="예: 정책 추진 배경과 실행 계획을 설명" /></label><label className="text-sm font-medium sm:col-span-2">구성 가이드<textarea value={form.outlineGuidance} onChange={(event) => setForm({ ...form, outlineGuidance: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 font-normal" /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShowCreator(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">취소</button><button type="button" disabled={creating} onClick={createSkill} className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"><Plus className="h-4 w-4" />{creating ? '저장 중' : 'Skill 만들기'}</button></div></div></div>}

            {renamingSkill && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div role="dialog" aria-modal="true" aria-label="Skill 이름 변경" className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl"><div className="mb-4 flex items-center justify-between"><h2 className="font-display text-lg font-bold">이름 변경</h2><button type="button" onClick={() => setRenamingSkill(null)} className="rounded-lg p-2 hover:bg-secondary" aria-label="닫기"><X className="h-5 w-5" /></button></div><input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-foreground" /><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setRenamingSkill(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">취소</button><button type="button" disabled={renaming || !renameValue.trim()} onClick={submitRename} className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">{renaming ? '저장 중' : '저장'}</button></div></div></div>}

            {deletingSkill && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div role="dialog" aria-modal="true" aria-label="Skill 삭제 확인" className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl"><h2 className="mb-2 font-display text-lg font-bold">삭제 확인</h2><p className="text-sm text-muted-foreground">&quot;{deletingSkill.name}&quot;을(를) 삭제할까요? 이 Skill로 만든 발표자료는 남지만 템플릿 연결은 사라집니다.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDeletingSkill(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">취소</button><button type="button" disabled={deletingOne} onClick={() => deleteSkill(deletingSkill)} className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50">{deletingOne ? '삭제 중' : '삭제'}</button></div></div></div>}
        </div>
    );
}
