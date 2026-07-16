import { redirect } from 'next/navigation';

// ponytail: old 5-step wizard replaced by the prompt-first home screen
export default function CreatePage() {
    redirect('/dashboard');
}
