export interface JwtPayload {
    userId: string;
    username: string;
}
export declare function signToken(payload: JwtPayload): string;
export declare function verifyToken(token: string): JwtPayload;
//# sourceMappingURL=token.d.ts.map