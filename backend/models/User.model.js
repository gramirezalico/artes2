'use strict';

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      required: true,
      unique: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    name: {
      type: String,
      trim: true,
      default: ''
    },
    picture: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      }
    }
  }
);

UserSchema.index({ googleId: 1 });
UserSchema.index({ email: 1 });

module.exports = mongoose.model('User', UserSchema);
