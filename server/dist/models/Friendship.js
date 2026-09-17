import mongoose, { Schema } from 'mongoose';
const FriendshipSchema = new Schema({
    userA: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userB: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });
FriendshipSchema.index({ userA: 1, userB: 1 }, { unique: true });
FriendshipSchema.index({ userA: 1 });
FriendshipSchema.index({ userB: 1 });
export const Friendship = mongoose.model('Friendship', FriendshipSchema);
//# sourceMappingURL=Friendship.js.map