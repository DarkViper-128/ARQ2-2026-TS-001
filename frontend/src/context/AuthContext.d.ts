import { ReactNode } from 'react';
interface AuthContextType {
    token: string | null;
    user: {
        username: string;
        role: string;
    } | null;
    isAuthenticated: boolean;
    login: (token: string, username: string, role: string) => void;
    logout: () => void;
}
export declare function AuthProvider({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
export declare function useAuth(): AuthContextType;
export {};
