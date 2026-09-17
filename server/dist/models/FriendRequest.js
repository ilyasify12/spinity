import mongoose, { Schema } from 'mongoose';
const FriendRequestSchema = new Schema({
    from: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined', 'cancelled'], default: 'pending', required: true },
    message: { type: String, maxlength: 200, default: null },
    respondedAt: { type: Date, default: null }
}, { timestamps: true });
FriendRequestSchema.index({ from: 1, to: 1 }, { unique: true });
FriendRequestSchema.index({ to: 1, status: 1 });
FriendRequestSchema.index({ from: 1, status: 1 });
export const FriendRequest = mongoose.model('FriendRequest', FriendRequestSchema);
//# sourceMappingURL=FriendRequest.js.map