'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { assetsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { Upload, Search, Image as ImageIcon, X, Loader2, Link } from 'lucide-react';

interface ImagePickerDialogProps {
    open: boolean;
    onClose: () => void;
    onSelect: (imageUrl: string) => void;
}

export function ImagePickerDialog({ open, onClose, onSelect }: ImagePickerDialogProps) {
    const [tab, setTab] = useState<'upload' | 'stock' | 'url'>('upload');
    const [uploading, setUploading] = useState(false);
    const [searching, setSearching] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [stockImages, setStockImages] = useState<any[]>([]);
    const [imageUrl, setImageUrl] = useState('');

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        if (acceptedFiles.length === 0) return;

        const file = acceptedFiles[0];
        setUploading(true);

        try {
            const response = await assetsApi.upload(file, 'IMAGE');
            onSelect(response.data.url);
            toast({ title: '업로드 완료', description: '이미지가 추가되었습니다.' });
            onClose();
        } catch (error) {
            toast({ title: '업로드 실패', variant: 'destructive' });
        } finally {
            setUploading(false);
        }
    }, [onSelect, onClose]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/png': ['.png'],
            'image/gif': ['.gif'],
            'image/webp': ['.webp'],
        },
        maxFiles: 1,
        maxSize: 10 * 1024 * 1024, // 10MB
    });

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);

        try {
            const response = await assetsApi.searchStock(searchQuery);
            setStockImages(response.data.images || []);
        } catch (error) {
            toast({ title: '검색 실패', variant: 'destructive' });
        } finally {
            setSearching(false);
        }
    };

    const handleUrlSubmit = () => {
        if (!imageUrl.trim()) return;
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
            toast({ title: '오류', description: '올바른 URL을 입력하세요.', variant: 'destructive' });
            return;
        }
        onSelect(imageUrl);
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>이미지 추가</DialogTitle>
                    <DialogDescription>
                        슬라이드에 추가할 이미지를 선택하세요.
                    </DialogDescription>
                </DialogHeader>

                {/* Tabs */}
                <div className="flex border-b">
                    <button
                        onClick={() => setTab('upload')}
                        className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'upload'
                                ? 'border-purple-500 text-purple-600'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Upload className="h-4 w-4 inline-block mr-1" />
                        업로드
                    </button>
                    <button
                        onClick={() => setTab('stock')}
                        className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'stock'
                                ? 'border-purple-500 text-purple-600'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Search className="h-4 w-4 inline-block mr-1" />
                        Stock 이미지
                    </button>
                    <button
                        onClick={() => setTab('url')}
                        className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'url'
                                ? 'border-purple-500 text-purple-600'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Link className="h-4 w-4 inline-block mr-1" />
                        URL
                    </button>
                </div>

                <div className="py-4 min-h-[300px]">
                    {/* Upload Tab */}
                    {tab === 'upload' && (
                        <div
                            {...getRootProps()}
                            className={`h-64 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors ${isDragActive
                                    ? 'border-purple-500 bg-purple-50'
                                    : 'border-border hover:border-purple-400'
                                }`}
                        >
                            <input {...getInputProps()} />
                            {uploading ? (
                                <Loader2 className="h-10 w-10 text-purple-500 animate-spin" />
                            ) : (
                                <>
                                    <ImageIcon className="h-10 w-10 text-muted-foreground mb-3" />
                                    <p className="text-muted-foreground font-medium">
                                        이미지를 드래그하거나 클릭하여 업로드
                                    </p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        JPG, PNG, GIF, WebP (최대 10MB)
                                    </p>
                                </>
                            )}
                        </div>
                    )}

                    {/* Stock Images Tab */}
                    {tab === 'stock' && (
                        <div>
                            <div className="flex gap-2 mb-4">
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                    placeholder="이미지 검색..."
                                    className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                />
                                <Button onClick={handleSearch} disabled={searching}>
                                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : '검색'}
                                </Button>
                            </div>

                            {stockImages.length > 0 ? (
                                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                                    {stockImages.map((image) => (
                                        <button
                                            key={image.id}
                                            onClick={() => {
                                                onSelect(image.url);
                                                onClose();
                                            }}
                                            className="aspect-video bg-gray-100 rounded overflow-hidden hover:ring-2 hover:ring-purple-500"
                                        >
                                            <img
                                                src={image.thumbnailUrl || image.url}
                                                alt=""
                                                className="w-full h-full object-cover"
                                            />
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-12 text-muted-foreground">
                                    검색어를 입력하여 이미지를 찾아보세요
                                </div>
                            )}
                        </div>
                    )}

                    {/* URL Tab */}
                    {tab === 'url' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-2">
                                    이미지 URL
                                </label>
                                <input
                                    type="url"
                                    value={imageUrl}
                                    onChange={(e) => setImageUrl(e.target.value)}
                                    placeholder="https://example.com/image.jpg"
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                />
                            </div>

                            {imageUrl && (
                                <div className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden">
                                    <img
                                        src={imageUrl}
                                        alt="Preview"
                                        className="w-full h-full object-contain"
                                        onError={() => toast({ title: '이미지 로드 실패', variant: 'destructive' })}
                                    />
                                </div>
                            )}

                            <Button onClick={handleUrlSubmit} disabled={!imageUrl.trim()} className="w-full">
                                이미지 추가
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
