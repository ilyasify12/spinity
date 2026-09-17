import mongoose, { type InferSchemaType } from 'mongoose';
declare const UserSchema: mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    status: "offline" | "online" | "idle";
    username: string;
    displayName: string;
    passwordHash: string;
    avatarUrl?: string | null | undefined;
    lastSeenAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    status: "offline" | "online" | "idle";
    username: string;
    displayName: string;
    passwordHash: string;
    avatarUrl?: string | null | undefined;
    lastSeenAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    status: "offline" | "online" | "idle";
    username: string;
    displayName: string;
    passwordHash: string;
    avatarUrl?: string | null | undefined;
    lastSeenAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>;
export type UserDoc = InferSchemaType<typeof UserSchema> & {
    _id: mongoose.Types.ObjectId;
};
export declare const User: mongoose.Model<{
    status: "offline" | "online" | "idle";
    username: string;
    displayName: string;
    passwordHash: string;
    avatarUrl?: string | null | undefined;
    lastSeenAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    status: "offline" | "online" | "idle";
    username: string;
    displayName: string;
    passwordHash: string;
    avatarUrl?: string | null | undefined;
    lastSeenAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    status: "offline" | "online" | "idle";
    username: string;
    displayName: string;
    passwordHash: string;
    avatarUrl?: string | null | undefined;
    lastSeenAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    status: "offline" | "online" | "idle";
    username: string;
    displayName: string;
    passwordHash: string;
    avatarUrl?: string | null | undefined;
    lastSeenAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    status: "offline" | "online" | "idle";
    username: string;
    displayName: string;
    passwordHash: string;
    avatarUrl?: string | null | undefined;
    lastSeenAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    status: "offline" | "online" | "idle";
    username: string;
    displayName: string;
    passwordHash: string;
    avatarUrl?: string | null | undefined;
    lastSeenAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export {};
//# sourceMappingURL=User.d.ts.map