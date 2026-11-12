import { useAuth } from '../context/AuthContext';
export declare function apiRequest(path: string, options?: RequestInit, token?: string | null): Promise<any>;
export declare const api: {
    get: (path: string, token?: string | null) => Promise<any>;
    post: (path: string, body: unknown, token?: string | null) => Promise<any>;
    delete: (path: string, token?: string | null) => Promise<any>;
};
export { useAuth };
