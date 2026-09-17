import mongoose, { type InferSchemaType } from 'mongoose';
declare const BlockSchema: mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}, {
    blocker: mongoose.Types.ObjectId;
    blocked: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    blocker: mongoose.Types.ObjectId;
    blocked: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}>> & mongoose.FlatRecord<{
    blocker: mongoose.Types.ObjectId;
    blocked: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>;
export type BlockDoc = InferSchemaType<typeof BlockSchema> & {
    _id: mongoose.Types.ObjectId;
};
export declare const Block: mongoose.Model<{
    blocker: mongoose.Types.ObjectId;
    blocked: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}, {}, {}, {}, mongoose.Document<unknown, {}, {
    blocker: mongoose.Types.ObjectId;
    blocked: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}, {}, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}> & {
    blocker: mongoose.Types.ObjectId;
    blocked: mongoose.Types.ObjectId;
    createdAt: NativeDate;
} & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}, {
    blocker: mongoose.Types.ObjectId;
    blocked: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    blocker: mongoose.Types.ObjectId;
    blocked: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}>> & mongoose.FlatRecord<{
    blocker: mongoose.Types.ObjectId;
    blocked: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export {};
//# sourceMappingURL=Block.d.ts.map