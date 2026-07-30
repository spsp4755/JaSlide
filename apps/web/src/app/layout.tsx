import './globals.css';
import { Providers } from '@/components/providers';

// Kept as a plain React wrapper for code importing the old app-layout module.
// Vite mounts the same providers from main.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
    return <Providers>{children}</Providers>;
}
