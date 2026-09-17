import mongoose, { type InferSchemaType } from 'mongoose';
declare const FriendshipSchema: mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}, {
    userA: mongoose.Types.ObjectId;
    userB: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    userA: mongoose.Types.ObjectId;
    userB: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}>> & mongoose.FlatRecord<{
    userA: mongoose.Types.ObjectId;
    userB: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>;
export type FriendshipDoc = InferSchemaType<typeof FriendshipSchema> & {
    _id: mongoose.Types.ObjectId;
};
export declare const Friendship: mongoose.Model<{
    userA: mongoose.Types.ObjectId;
    userB: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}, {}, {}, {}, mongoose.Document<unknown, {}, {
    userA: mongoose.Types.ObjectId;
    userB: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}, {}, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}> & {
    userA: mongoose.Types.ObjectId;
    userB: mongoose.Types.ObjectId;
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
    userA: mongoose.Types.ObjectId;
    userB: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    userA: mongoose.Types.ObjectId;
    userB: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}>> & mongoose.FlatRecord<{
    userA: mongoose.Types.ObjectId;
    userB: mongoose.Types.ObjectId;
    createdAt: NativeDate;
}> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export {};
//# sourceMappingURL=Friendship.d.ts.map