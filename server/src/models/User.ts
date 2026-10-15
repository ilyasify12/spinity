import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const UserSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 24, match: /^[a-z0-9_.-]+$/ },
    /** 1.0 cloud account identity: same email on every computer. Optional + sparse so pre-1.0 users still load. */
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true, maxlength: 254 },
    displayName: { type: String, required: true, trim: true, maxlength: 40 },
    passwordHash: { type: String, required: true },
    avatarUrl: { type: String, default: null },
    lastSeenAt: { type: Date, default: null },
    /** Effective presence (what friends see). */
    status: { type: String, enum: ['offline', 'online', 'idle', 'dnd'], default: 'offline' },
    /** The user's own choice; auto-detect derives `status` from it on connect. */
    statusPref: { type: String, enum: ['online', 'dnd', 'invisible'], default: 'online' }
  },
  { timestamps: true }
)

UserSchema.index({ username: 'text', displayName: 'text' })

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: mongoose.Types.ObjectId }
export const User = mongoose.model('User', UserSchema)
