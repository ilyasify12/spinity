import mongoose, { type InferSchemaType } from 'mongoose';
declare const FriendRequestSchema: mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    status: "pending" | "accepted" | "declined" | "cancelled";
    from: mongoose.Types.ObjectId;
    to: mongoose.Types.ObjectId;
    message?: string | null | undefined;
    respondedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    status: "pending" | "accepted" | "declined" | "cancelled";
    from: mongoose.Types.ObjectId;
    to: mongoose.Types.ObjectId;
    message?: string | null | undefined;
    respondedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    status: "pending" | "accepted" | "declined" | "cancelled";
    from: mongoose.Types.ObjectId;
    to: mongoose.Types.ObjectId;
    message?: string | null | undefined;
    respondedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>;
export type FriendRequestDoc = InferSchemaType<typeof FriendRequestSchema> & {
    _id: mongoose.Types.ObjectId;
};
export declare const FriendRequest: mongoose.Model<{
    status: "pending" | "accepted" | "declined" | "cancelled";
    from: mongoose.Types.ObjectId;
    to: mongoose.Types.ObjectId;
    message?: string | null | undefined;
    respondedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    status: "pending" | "accepted" | "declined" | "cancelled";
    from: mongoose.Types.ObjectId;
    to: mongoose.Types.ObjectId;
    message?: string | null | undefined;
    respondedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    status: "pending" | "accepted" | "declined" | "cancelled";
    from: mongoose.Types.ObjectId;
    to: mongoose.Types.ObjectId;
    message?: string | null | undefined;
    respondedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    status: "pending" | "accepted" | "declined" | "cancelled";
    from: mongoose.Types.ObjectId;
    to: mongoose.Types.ObjectId;
    message?: string | null | undefined;
    respondedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    status: "pending" | "accepted" | "declined" | "cancelled";
    from: mongoose.Types.ObjectId;
    to: mongoose.Types.ObjectId;
    message?: string | null | undefined;
    respondedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    status: "pending" | "accepted" | "declined" | "cancelled";
    from: mongoose.Types.ObjectId;
    to: mongoose.Types.ObjectId;
    message?: string | null | undefined;
    respondedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export {};
//# sourceMappingURL=FriendRequest.d.ts.map