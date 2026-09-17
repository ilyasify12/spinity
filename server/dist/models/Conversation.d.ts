import mongoose, { type InferSchemaType } from 'mongoose';
declare const ConversationSchema: mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    participants: mongoose.Types.ObjectId[];
    lastMessageAt?: NativeDate | null | undefined;
    lastMessagePreview?: string | null | undefined;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    participants: mongoose.Types.ObjectId[];
    lastMessageAt?: NativeDate | null | undefined;
    lastMessagePreview?: string | null | undefined;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    participants: mongoose.Types.ObjectId[];
    lastMessageAt?: NativeDate | null | undefined;
    lastMessagePreview?: string | null | undefined;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>;
export type ConversationDoc = InferSchemaType<typeof ConversationSchema> & {
    _id: mongoose.Types.ObjectId;
};
export declare const Conversation: mongoose.Model<{
    participants: mongoose.Types.ObjectId[];
    lastMessageAt?: NativeDate | null | undefined;
    lastMessagePreview?: string | null | undefined;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    participants: mongoose.Types.ObjectId[];
    lastMessageAt?: NativeDate | null | undefined;
    lastMessagePreview?: string | null | undefined;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    participants: mongoose.Types.ObjectId[];
    lastMessageAt?: NativeDate | null | undefined;
    lastMessagePreview?: string | null | undefined;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    participants: mongoose.Types.ObjectId[];
    lastMessageAt?: NativeDate | null | undefined;
    lastMessagePreview?: string | null | undefined;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    participants: mongoose.Types.ObjectId[];
    lastMessageAt?: NativeDate | null | undefined;
    lastMessagePreview?: string | null | undefined;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    participants: mongoose.Types.ObjectId[];
    lastMessageAt?: NativeDate | null | undefined;
    lastMessagePreview?: string | null | undefined;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export {};
//# sourceMappingURL=Conversation.d.ts.map