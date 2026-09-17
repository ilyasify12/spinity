import mongoose, { Schema } from 'mongoose';
const UserSchema = new Schema({
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 24, match: /^[a-z0-9_.-]+$/ },
    displayName: { type: String, required: true, trim: true, maxlength: 40 },
    passwordHash: { type: String, required: true },
    avatarUrl: { type: String, default: null },
    lastSeenAt: { type: Date, default: null },
    status: { type: String, enum: ['offline', 'online', 'idle'], default: 'offline' }
}, { timestamps: true });
UserSchema.index({ username: 'text', displayName: 'text' });
export const User = mongoose.model('User', UserSchema);
//# sourceMappingURL=User.js.map