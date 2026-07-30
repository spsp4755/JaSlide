import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Providers } from '@/components/providers';
import { createAppRouter } from '@/router';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Providers>
            <RouterProvider router={createAppRouter()} />
        </Providers>
    </StrictMode>
);
