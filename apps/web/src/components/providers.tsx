'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, ReactNode } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { AuthBootstrap } from '@/components/providers/auth-bootstrap';
import Link from '@/lib/router';
import { LinkProvider, Theme } from '@astryxdesign/core';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

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
                {/* Astryx's Theme sets its own `color` on the wrapper it renders, which beats
                    the `text-foreground` on <body> for the whole tree: anything without an
                    explicit text color came out near-white and vanished in the light theme.
                    Hand the app's own token back so both themes stay readable. */}
                <div className="contents text-foreground">
                    <LinkProvider component={Link}>
                        <ThemeProvider>
                            <AuthBootstrap>{children}</AuthBootstrap>
                        </ThemeProvider>
                    </LinkProvider>
                </div>
            </Theme>
            <Toaster />
        </QueryClientProvider>
    );
}

