import { Navigate } from 'react-router-dom';

// ponytail: old 5-step wizard replaced by the prompt-first home screen
export default function CreatePage() {
    return <Navigate to="/dashboard" replace />;
}
