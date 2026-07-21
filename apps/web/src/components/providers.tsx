'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, ReactNode } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/components/providers/theme-provider';
import Link from 'next/link';
import { LinkProvider, Theme } from '@astryxdesign/core';
import { neutralTheme } from '@astryxdesign/theme-neutral';

export function Providers({ children }: { children: ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 60 * 1000, // 1 minute
                        refetchOnWindowFocus: false,
                    },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>
            <Theme theme={neutralTheme}>
                <LinkProvider component={Link}>
                    <ThemeProvider>{children}</ThemeProvider>
                </LinkProvider>
            </Theme>
            <Toaster />
        </QueryClientProvider>
    );
}

