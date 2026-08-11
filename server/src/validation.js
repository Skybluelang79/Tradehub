import { z } from 'zod';

export const signupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  avatar: z.string().url().optional().or(z.literal('')),
  location: z.object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    address: z.string().max(200).optional(),
  }).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const locationSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  address: z.string().max(200).optional(),
}).optional();

const variantSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.string().min(1)),
});

export const createItemSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional().default(''),
  price: z.number().positive('Price must be positive'),
  sale_price: z.number().positive().optional().nullable(),
  sale_ends_at: z.string().optional().nullable(),
  category: z.string().min(1, 'Category is required'),
  condition: z.string().optional().default('good'),
  images: z.array(z.string().url()).max(20).optional().default([]),
  location: locationSchema,
  quantity: z.number().int().positive().optional().default(1),
  variants: z.array(variantSchema).optional().default([]),
  boosted: z.boolean().optional().default(false),
  boost_expires_at: z.string().optional().nullable(),
  is_auction: z.boolean().optional().default(false),
  starting_bid: z.number().positive().optional().nullable(),
  min_increment: z.number().positive().optional().nullable(),
  auction_ends_at: z.string().optional().nullable(),
});

export const updateItemSchema = createItemSchema.partial();

export const placeBidSchema = z.object({
  amount: z.number().positive('Bid must be positive'),
});

export const createReviewSchema = z.object({
  revieweeId: z.string().min(1),
  itemId: z.string().optional(),
  rating: z.number().int().min(1).max(5),
  text: z.string().max(1000).optional().default(''),
});

export const createReportSchema = z.object({
  itemId: z.string().min(1),
  reason: z.string().min(1, 'Reason is required').max(500),
  description: z.string().max(2000).optional().default(''),
});

export const sendMessageSchema = z.object({
  text: z.string().min(1).max(5000),
  encrypted: z.boolean().optional().default(false),
  ciphertext: z.string().optional().nullable(),
  iv: z.string().optional().nullable(),
});

export const createConversationSchema = z.object({
  itemId: z.string().min(1),
  sellerId: z.string().min(1),
});

export const addPaymentMethodSchema = z.object({
  brand: z.string().min(1),
  last4: z.string().length(4),
  exp_month: z.number().int().min(1).max(12),
  exp_year: z.number().int().min(2024).max(2100),
  is_default: z.boolean().optional().default(false),
  stripe_payment_method_id: z.string().optional(),
});

export const createIntentSchema = z.object({
  itemId: z.string().min(1),
  paymentMethodId: z.string().optional(),
});

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Template name required').max(100),
  title: z.string().max(200).optional().default(''),
  description: z.string().max(2000).optional().default(''),
  price: z.string().optional().default(''),
  category: z.string().optional().default(''),
  condition: z.string().optional().default(''),
  quantity: z.number().int().positive().optional().default(1),
  sale_price: z.string().optional().default(''),
  variants: z.array(z.any()).optional().default([]),
});

export const createDisputeSchema = z.object({
  transactionId: z.string().min(1),
  reason: z.string().min(1, 'Reason is required').max(500),
  description: z.string().max(2000).optional().default(''),
});

export const blockUserSchema = z.object({
  userId: z.string().min(1),
});

export const createPromotionSchema = z.object({
  code: z.string().min(3).max(20),
  discount_type: z.enum(['percentage', 'fixed']),
  discount_value: z.number().positive(),
  max_uses: z.number().int().positive().optional(),
  expires_at: z.string().optional(),
  min_purchase: z.number().positive().optional(),
});

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      const messages = Object.entries(errors).map(([field, msgs]) =>
        `${field}: ${msgs.join(', ')}`
      );
      return res.status(400).json({ error: 'Validation failed', details: messages });
    }
    req.validatedBody = result.data;
    next();
  };
}

export default validate;
