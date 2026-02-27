'use strict';

const mongoose = require('mongoose');

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const BboxSchema = new mongoose.Schema({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  w: { type: Number, required: true },
  h: { type: Number, required: true }
}, { _id: false });

const InspectionZoneSchema = new mongoose.Schema({
  page:  { type: Number, default: 1 },
  label: { type: String, default: '' },
  bbox:  { type: BboxSchema, required: true }
}, { _id: false });

const FindingSchema = new mongoose.Schema({
  page:        { type: Number, default: 1 },
  type:        { type: String, enum: ['typography', 'color', 'graphic', 'content', 'layout', 'spelling'], default: 'content' },
  severity:    { type: String, enum: ['critical', 'important', 'minor', 'ignore', null], default: null },
  description: { type: String, default: '' },
  bbox:        { type: BboxSchema, required: true },
  color:       { type: String, enum: ['red', 'green', 'yellow', 'blue'], default: 'red' },
  comment:     { type: String, default: '' },
  status:      { type: String, enum: ['open', 'classified', 'resolved'], default: 'open' },
  severity_suggestion: { type: String, enum: ['critical', 'important', 'minor', null], default: null },
  pixel_diff_percent:  { type: Number, default: 0 },
  color_delta_e:       { type: Number, default: 0 },
  master_crop:         { type: String, default: '' },
  sample_crop:         { type: String, default: '' }
}, { _id: true });

const FileInfoSchema = new mongoose.Schema({
  filename:     { type: String, required: true },
  originalName: { type: String, required: true },
  fileSize:     { type: Number, default: 0 },
  format:       { type: String, default: 'pdf' }, // pdf, tiff, bmp, png, jpg
  pageCount:    { type: Number, default: 1 },
  imagesBase64: { type: [String], default: [] }
}, { _id: false });

const ColorSwatchSchema = new mongoose.Schema({
  hex:   { type: String },
  name:  { type: String, default: '' },
  usage: { type: String, default: '0%' }
}, { _id: false });

const AnalysisSchema = new mongoose.Schema({
  summary: { type: String, default: '' },
  totalFindings: { type: Number, default: 0 },
  criticalCount: { type: Number, default: 0 },
  importantCount: { type: Number, default: 0 },
  minorCount: { type: Number, default: 0 },
  ignoredCount: { type: Number, default: 0 },
  masterPalette:  { type: [ColorSwatchSchema], default: [] },
  samplePalette:  { type: [ColorSwatchSchema], default: [] },
  verdict: {
    type: String,
    enum: ['pass', 'review', 'fail'],
    default: 'review'
  },
  overallSsim: { type: Number, default: 0 }
}, { _id: false });

// ─── Main Inspection Schema ──────────────────────────────────────────────────

const InspectionSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      trim: true,
      maxlength: [100, 'Product ID cannot exceed 100 characters'],
      default: ''
    },
    productName: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [300, 'Product name cannot exceed 300 characters']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
      default: ''
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'inspected', 'error'],
      default: 'pending'
    },
    errorMessage: { type: String, default: '' },

    // Tolerance sliders (0-100)
    elementTolerance: { type: Number, min: 0, max: 100, default: 50 },
    accuracyLevel:    { type: Number, min: 0, max: 100, default: 50 },

    // Spelling check options
    checkSpelling:    { type: Boolean, default: false },
    spellingLanguage: { type: String, default: 'es' },

    masterFile:  { type: FileInfoSchema, required: true },
    sampleFile:  { type: FileInfoSchema, required: true },

    inspectionZones: { type: [InspectionZoneSchema], default: [] },
    findings:        { type: [FindingSchema], default: [] },
    diffImages:      { type: [String], default: [] },
    heatmaps:        { type: [String], default: [] },
    analysis:        { type: AnalysisSchema, default: null }
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

// ─── Indexes ──────────────────────────────────────────────────────────────────
InspectionSchema.index({ productName: 'text', productId: 'text' });
InspectionSchema.index({ createdAt: -1 });
InspectionSchema.index({ status: 1 });

module.exports = mongoose.model('Inspection', InspectionSchema);
